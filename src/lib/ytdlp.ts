import {spawn, type ChildProcess} from 'node:child_process'
import {createWriteStream} from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {formatBytes} from './format.js'
import {detectPlatform} from './platforms.js'

const YOINKS_DIR = path.join(os.homedir(), '.yoinks', 'bin')
const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

function ytDlpAssetName(): string {
  if (process.platform === 'win32') return 'yt-dlp.exe'
  if (process.platform === 'darwin') return 'yt-dlp_macos'
  return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'
}

// async on purpose: a spawnSync here blocks the event loop, which freezes
// ink mid-frame — the user hits enter and sees nothing until it returns
function commandWorks(cmd: string, args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(cmd, args, {stdio: 'ignore', timeout: 10_000})
    } catch {
      resolve(false)
      return
    }
    child.on('error', () => resolve(false))
    child.on('close', code => resolve(code === 0))
  })
}

/**
 * Resolve a usable yt-dlp binary: system install first, then a previously
 * downloaded copy, then download the standalone binary from GitHub releases.
 */
export async function ensureYtDlp(onStatus: (message: string) => void, signal?: AbortSignal): Promise<string> {
  if (await commandWorks('yt-dlp', ['--version'])) return 'yt-dlp'

  const local = path.join(YOINKS_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  if (await commandWorks(local, ['--version'])) return local

  onStatus('first run: fetching yt-dlp…')
  await fs.mkdir(YOINKS_DIR, {recursive: true})

  const url = `${RELEASE_BASE}/${ytDlpAssetName()}`
  const response = await fetch(url, {signal})
  if (!response.ok || !response.body) {
    throw new Error(`Could not download yt-dlp (${response.status}). Check your connection and try again.`)
  }

  const tmp = `${local}.download`
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(tmp), {signal})
  await fs.chmod(tmp, 0o755)
  await fs.rename(tmp, local)
  return local
}

/**
 * Find ffmpeg for stream merging / mp3 extraction: system install first,
 * ffmpeg-static as fallback. Returns undefined if neither exists — yt-dlp
 * still works for single-file formats without it.
 */
export async function findFfmpeg(): Promise<string | undefined> {
  if (await commandWorks('ffmpeg', ['-version'])) return undefined // on PATH, yt-dlp finds it itself
  try {
    const mod = await import('ffmpeg-static')
    const ffmpegPath = (mod.default ?? mod) as unknown as string | null
    if (ffmpegPath && (await commandWorks(ffmpegPath, ['-version']))) return ffmpegPath
  } catch {
    // ffmpeg-static not installed or unsupported platform
  }
  return undefined
}

export type VideoInfo = {
  id?: string
  title: string
  uploader?: string
  /** music metadata — set for YouTube Music tracks */
  artist?: string
  track?: string
  album?: string
  duration?: number
  webpage_url?: string
  thumbnail?: string
  filesize_approx?: number
  extractor_key?: string
  formats?: RawFormat[]
  channel?: string
  /** 'playlist' when the url was an album/playlist probed with `playlist: true` */
  _type?: string
  entries?: FlatEntry[]
}

/** A playlist entry from --flat-playlist: enough to list it, not to download it. */
export type FlatEntry = {
  id?: string
  url?: string
  title?: string
  duration?: number
  uploader?: string
  channel?: string
}

type RawFormat = {
  format_id: string
  ext?: string
  vcodec?: string
  acodec?: string
  height?: number
  width?: number
  abr?: number
  tbr?: number
  filesize?: number
  filesize_approx?: number
}

export type ProbeResult = {
  info: VideoInfo
  /** Raw -J output saved to disk so downloads can skip re-extraction via --load-info-json. */
  infoJsonPath: string
}

export async function probe(
  ytdlp: string,
  url: string,
  signal?: AbortSignal,
  /** list an album/playlist's songs (cheap, flat) instead of one video */
  {playlist = false} = {},
): Promise<ProbeResult> {
  const mode = playlist ? ['--flat-playlist'] : ['--no-playlist']
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(ytdlp, ['-J', ...mode, '--no-warnings', url], {signal})
    let out = ''
    let stderr = ''
    child.stdout.on('data', chunk => (out += chunk))
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(cleanYtDlpError(stderr) || `yt-dlp exited with code ${code}`))
      } else {
        resolve(out)
      }
    })
  })

  let info: VideoInfo
  try {
    info = JSON.parse(stdout) as VideoInfo
  } catch {
    throw new Error('Could not parse video info from yt-dlp.')
  }

  const infoJsonPath = path.join(os.tmpdir(), `yoinks-info-${process.pid}-${Date.now()}.json`)
  await fs.writeFile(infoJsonPath, stdout)
  return {info, infoJsonPath}
}

/**
 * Text made safe to use literally inside a yt-dlp output template: no
 * characters Windows rejects in file names, and `%` escaped.
 */
export function safeSegment(text: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim()
  return (clean || '_').replaceAll('%', '%%')
}

const PLATFORM_FOLDERS: Record<string, string> = {x: 'X', youtube: 'YouTube'}

/** Per-platform folder name, so Instagram and TikTok videos don't mix. */
export function platformFolder(url: string): string {
  const platform = detectPlatform(url)
  if (platform.key === 'generic') return safeSegment(platform.label.replace(/^www\./, ''))
  return safeSegment(PLATFORM_FOLDERS[platform.key] ?? platform.label)
}

/** Output template for a video, relative to the videos folder. */
export const videoTemplate = (url: string) => `${platformFolder(url)}/%(title).60s [%(id)s].%(ext)s`

// a literal for --parse-metadata's FROM side: `%` is a template escape, `:` splits FROM:TO
const metadataLiteral = (text: string) => text.replaceAll('%', '%%').replaceAll(':', '\\:')

/** Where a track sits in an album or playlist being downloaded song by song. */
export type AlbumSlot = {title: string; index: number}

// crops the 16:9 video thumbnail to a centered square, like real cover art
const SQUARE_COVER = `ThumbnailsConvertor+FFmpeg_o:-c:v mjpeg -vf crop="'if(gt(ih,iw),iw,ih)':'if(gt(iw,ih),ih,iw)'"`

/**
 * mp3 with cover art and tags. Artist comes from YouTube Music's metadata,
 * else the channel (minus " - Topic"), else an "Artist - Song" title.
 */
export function musicChoice(album?: AlbumSlot): DownloadChoice {
  const args = [
    '-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0',
    '--embed-metadata', '--embed-thumbnail', '--convert-thumbnails', 'jpg', '--ppa', SQUARE_COVER,
    '--parse-metadata', '%(artist,uploader)s:(?P<artist>.+?)(?: - Topic)?$',
    '--parse-metadata', '%(track,title)s:(?P<artist>.+?) - (?P<track>.+)',
    '--replace-in-metadata', 'track', String.raw`(?i)\s*[(\[](?:official|lyrics?|audio|video|visualizer|hd|4k)[^)\]]*[)\]]`, '',
  ]
  if (album) {
    args.push(
      '--parse-metadata', `${metadataLiteral(album.title)}:(?P<album>.+)`,
      '--parse-metadata', `${album.index}:(?P<track_number>.+)`,
    )
  }
  return {kind: 'audio', label: 'mp3 · cover + tags', args}
}

/** Artist/Song.mp3, or Artist/Album/01 Song.mp3 — relative to the music folder. */
export function musicTemplate(album?: AlbumSlot): string {
  const song = '%(track,title)s.%(ext)s'
  if (!album) return `%(artist,uploader)s/${song}`
  return `%(artist,uploader)s/${safeSegment(album.title)}/${String(album.index).padStart(2, '0')} ${song}`
}

export type DownloadChoice = {
  label: string
  kind: 'video' | 'audio'
  args: string[]
}

const MAX_VIDEO_CHOICES = 8

export function buildChoices(info: VideoInfo): DownloadChoice[] {
  const formats = info.formats ?? []
  const choices: DownloadChoice[] = []

  const audioOnly = formats.filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
  const bestAudio = [...audioOnly].sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))[0]
  const audioSize = bestAudio?.filesize ?? bestAudio?.filesize_approx

  const videos = formats.filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
  const heights = [...new Set(videos.map(f => f.height as number))].sort((a, b) => b - a)

  for (const height of heights.slice(0, MAX_VIDEO_CHOICES)) {
    const candidates = videos.filter(f => f.height === height)
    const best = [...candidates].sort((a, b) => scoreVideo(b) - scoreVideo(a))[0]
    const muxed = best.acodec && best.acodec !== 'none'
    const size = (best.filesize ?? best.filesize_approx ?? 0) + (muxed ? 0 : audioSize ?? 0)
    const sizeLabel = size > 0 ? ` · ~${formatBytes(size)}` : ''
    choices.push({
      kind: 'video',
      label: `${height}p · mp4${sizeLabel}`,
      args: [
        '-f',
        `bv*[height=${height}]+ba/b[height=${height}]/bv*[height<=${height}]+ba/b`,
        '--merge-output-format',
        'mp4',
      ],
    })
  }

  if (choices.length === 0) {
    choices.push({
      kind: 'video',
      label: 'best available · mp4',
      args: ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'],
    })
  }

  const audioSizeLabel = audioSize ? ` · ~${formatBytes(audioSize)}` : ''
  choices.push({
    kind: 'audio',
    label: `audio only · mp3${audioSizeLabel}`,
    args: ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0'],
  })

  return choices
}

const capped = (height: number): DownloadChoice => ({
  kind: 'video',
  label: `up to ${height}p · mp4`,
  args: ['-f', `bv*[height<=${height}]+ba/b[height<=${height}]/bv*+ba/b`, '--merge-output-format', 'mp4'],
})

/** One quality for a whole batch — each video falls back to its best when it can't reach the cap. */
export const BATCH_PRESETS: DownloadChoice[] = [
  {kind: 'video', label: 'best available · mp4', args: ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4']},
  capped(1080),
  capped(720),
  {kind: 'audio', label: 'audio only · mp3', args: ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0']},
]

/** Rough size of the best video+audio, for the batch review list. */
export function estimateSize(info: VideoInfo): number | undefined {
  if (info.filesize_approx) return info.filesize_approx
  const formats = info.formats ?? []
  const size = (f?: RawFormat) => f?.filesize ?? f?.filesize_approx ?? 0
  const best = (list: RawFormat[], score: (f: RawFormat) => number) => [...list].sort((a, b) => score(b) - score(a))[0]
  const video = best(formats.filter(f => f.vcodec && f.vcodec !== 'none'), f => (f.height ?? 0) * 1e6 + (f.tbr ?? 0))
  const muxed = video?.acodec && video.acodec !== 'none'
  const audio = muxed ? undefined : best(formats.filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')), f => f.abr ?? f.tbr ?? 0)
  return size(video) + size(audio) || undefined
}

function scoreVideo(f: RawFormat): number {
  let score = f.tbr ?? 0
  if (f.ext === 'mp4') score += 10_000
  if (f.vcodec?.startsWith('avc')) score += 5_000
  return score
}

export type DownloadProgress = {
  downloadedBytes: number
  totalBytes?: number
  speed?: number
  eta?: number
  part: number
  /** How many files this download resolves to (video+audio merges are 2). */
  totalParts: number
}

export type DownloadHandlers = {
  onProgress: (progress: DownloadProgress) => void
  onProcessing: () => void
}

const PROGRESS_PREFIX = 'YOINK|'
const PROGRESS_TEMPLATE = `${PROGRESS_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`

let activeChild: ChildProcess | undefined
process.on('exit', () => activeChild?.kill('SIGTERM'))

export type DownloadOptions = {
  ytdlp: string
  ffmpegLocation?: string
  url: string
  /** When set, reuse the probe's metadata instead of re-extracting — starts much faster. */
  infoJsonPath?: string
  choice: DownloadChoice
  outDir: string
  /** yt-dlp output template, relative to outDir */
  outTemplate?: string
}

/**
 * download() reusing the probe's metadata first. Media urls in that cached
 * info can expire, so a failure retries once with a fresh extraction. The
 * cached info file is removed afterwards either way.
 */
export async function downloadWithRetry(
  opts: DownloadOptions,
  handlers: DownloadHandlers & {onRefresh: () => void},
  signal?: AbortSignal,
): Promise<string> {
  try {
    return await download(opts, handlers, signal)
  } catch (error) {
    if (signal?.aborted || !opts.infoJsonPath) throw error
    handlers.onRefresh()
    return await download({...opts, infoJsonPath: undefined}, handlers, signal)
  } finally {
    if (opts.infoJsonPath) void discardInfoJson(opts.infoJsonPath)
  }
}

/** Remove a probe's cached info file — they'd otherwise pile up in tmp. */
export function discardInfoJson(infoJsonPath: string): Promise<void> {
  return fs.rm(infoJsonPath, {force: true}).catch(() => {})
}

export function download(opts: DownloadOptions, handlers: DownloadHandlers, signal?: AbortSignal): Promise<string> {
  const args = [
    ...(opts.infoJsonPath ? ['--load-info-json', opts.infoJsonPath] : [opts.url]),
    ...opts.choice.args,
    '--no-playlist',
    '--no-warnings',
    '--newline',
    // --print implies --quiet, which suppresses progress bars and the
    // [Merger]/[ExtractAudio] lines we detect the processing phase from
    '--no-quiet',
    '--progress',
    '--progress-template',
    `download:${PROGRESS_TEMPLATE}`,
    '--print',
    'after_move:filepath',
    '--no-simulate',
    '-o',
    path.join(opts.outDir, opts.outTemplate ?? '%(title).60s.%(ext)s'),
  ]
  if (opts.ffmpegLocation) args.push('--ffmpeg-location', opts.ffmpegLocation)

  return new Promise((resolve, reject) => {
    const child = spawn(opts.ytdlp, args, {signal})
    activeChild = child

    let stderr = ''
    let filepath = ''
    let part = 0
    let totalParts = 1
    let lastDownloaded = 0
    let buffer = ''
    // every file yt-dlp writes this run, so a cancel can clean up after itself
    const destinations: string[] = []

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        if (line.startsWith(PROGRESS_PREFIX)) {
          const [downloaded, total, totalEstimate, speed, eta] = line.slice(PROGRESS_PREFIX.length).split('|')
          const downloadedBytes = toNumber(downloaded) ?? 0
          if (downloadedBytes < lastDownloaded) part++
          lastDownloaded = downloadedBytes
          handlers.onProgress({
            downloadedBytes,
            totalBytes: toNumber(total) ?? toNumber(totalEstimate),
            speed: toNumber(speed),
            eta: toNumber(eta),
            part,
            totalParts,
          })
        } else if (line.includes('Downloading 1 format(s):')) {
          // "[info] xxx: Downloading 1 format(s): 395+251" — each id is one file
          totalParts = (line.split('format(s):')[1] ?? '').trim().split('+').length
        } else if (line.includes('[Merger]') || line.includes('[ExtractAudio]')) {
          const merging = /^\[Merger\] Merging formats into "(.+)"$/.exec(line)?.[1]
          const extracting = /^\[ExtractAudio\] Destination: (.+)$/.exec(line)?.[1]
          const target = merging ?? extracting
          if (target) destinations.push(target)
          handlers.onProcessing()
        } else if (line.startsWith('[download] Destination: ')) {
          destinations.push(line.slice('[download] Destination: '.length))
        } else if (path.isAbsolute(line)) {
          filepath = line
        }
      }
    })
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', reject)
    child.on('close', code => {
      activeChild = undefined
      if (signal?.aborted) {
        // cancelled on purpose — don't leave half-written files behind
        void removePartials(destinations)
        reject(new Error('Download cancelled.'))
        return
      }
      if (code === 0 && filepath) {
        resolve(filepath)
      } else {
        reject(new Error(cleanYtDlpError(stderr) || `Download failed (yt-dlp exit code ${code}).`))
      }
    })
  })
}

function removePartials(destinations: string[]): Promise<unknown> {
  return Promise.allSettled(
    destinations
      .flatMap(dest => [dest, `${dest}.part`, `${dest}.ytdl`])
      .map(file => fs.rm(file, {force: true})),
  )
}

function toNumber(value: string | undefined): number | undefined {
  if (!value || value === 'NA' || value === 'None') return undefined
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : undefined
}

function cleanYtDlpError(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('ERROR:'))
  const last = lines.at(-1)
  return last ? last.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '') : ''
}
