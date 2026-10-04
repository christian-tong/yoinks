import React, {useCallback, useEffect, useRef, useState} from 'react'
import os from 'node:os'
import path from 'node:path'
import {Box, Text, useApp, useInput, useStdout} from 'ink'
import SelectInput, {type IndicatorProps, type ItemProps} from 'ink-select-input'
import Spinner from 'ink-spinner'
import {FramedInput} from './components/framed-input.js'
import {FullScreen} from './components/fullscreen.js'
import {Logo} from './components/logo.js'
import {Panel} from './components/panel.js'
import {ProgressBar} from './components/progress-bar.js'
import {Shortcuts} from './components/shortcuts.js'
import {TextInput} from './components/text-input.js'
import {clickTargetAt, findFrameRow, frameRowSpan, type ClickTarget} from './lib/click-map.js'
import {formatBytes, formatDuration, formatEta, formatSpeed, shortenPath, truncate, wrapText} from './lib/format.js'
import {loadConfig} from './lib/config.js'
import {addToHistory, loadHistory} from './lib/history.js'
import {extractUrls, MAX_LINKS} from './lib/links.js'
import {openExternal} from './lib/open.js'
import {detectPlatform, type Platform} from './lib/platforms.js'
import {useMouseClick} from './lib/use-mouse-click.js'
import {nextThemeMode, ThemeProvider, type ThemeMode, useTheme} from './theme.js'
import {
  BATCH_PRESETS,
  buildChoices,
  discardInfoJson,
  downloadWithRetry,
  ensureYtDlp,
  estimateSize,
  findFfmpeg,
  probe,
  videoTemplate,
  type DownloadChoice,
  type DownloadProgress,
  type VideoInfo,
} from './lib/ytdlp.js'

const YOINK_BUTTON = 'yoink'
const DONE_LABEL = '↵ yoink another'
const TAGLINE = 'yoink any video. paste. yoink. done.'
// ponytail: fixed pool — quick enough without tripping site rate limits
const PROBE_CONCURRENCY = 3

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

const choiceLabel = (choice: DownloadChoice) => `${choice.kind === 'audio' ? '♪ ' : '▶ '}${choice.label}`

function ChoiceIndicator({isSelected}: IndicatorProps) {
  const theme = useTheme()
  return (
    <Box marginRight={1}>
      <Text color={theme.primary}>{isSelected ? '❯' : ' '}</Text>
    </Box>
  )
}

function ChoiceItem({isSelected, label}: ItemProps) {
  const theme = useTheme()
  return (
    <Text color={theme.primary} bold={isSelected}>
      {label}
    </Text>
  )
}

// explicit blank lines — empty <Box height={1}/> spacers can collapse, and
// ink boxes default to flexShrink=1, so spacers are the first thing yoga
// crushes when content overflows the terminal
const Gap = ({lines = 1}: {lines?: number}) => (
  <Box flexDirection="column" flexShrink={0}>
    {Array.from({length: lines}, (_, i) => (
      <Text key={i}> </Text>
    ))}
  </Box>
)

// fixed-width slots — the centered line must not change width as values tick,
// otherwise the whole layout shifts on every progress update
function partLabel(progress: DownloadProgress): string {
  // explains the bar resetting between files (video, then audio)
  return progress.totalParts > 1 ? `part ${progress.part + 1}/${progress.totalParts}  ` : ''
}

function downloadMeta(progress: DownloadProgress): string {
  const speed = progress.speed ? formatSpeed(progress.speed) : ''
  const eta = progress.eta ? `${formatEta(progress.eta)} left` : ''
  return `${partLabel(progress)}${speed.padStart(10)}  ${eta.padEnd(12)}`
}

function indeterminateMeta(progress: DownloadProgress): string {
  const bytes = formatBytes(progress.downloadedBytes)
  const speed = progress.speed ? formatSpeed(progress.speed) : ''
  return `${partLabel(progress)}${bytes.padStart(8)}  ${speed.padEnd(10)}`
}

export type Outcome = {filepaths: string[]}

type BatchItem = {
  url: string
  status: 'probing' | 'ok' | 'error'
  selected: boolean
  info?: VideoInfo
  infoJsonPath?: string
  error?: string
}

const isReady = (item: BatchItem) => item.status === 'ok'
const isPicked = (item: BatchItem) => item.status === 'ok' && item.selected

function reviewRow(item: BatchItem, width: number): string {
  if (item.status === 'probing') return truncate(`  ⋯  ${item.url}`, width)
  if (item.status === 'error') return truncate(`  ✗  ${item.error} · ${item.url}`, width)
  const info = item.info!
  const size = estimateSize(info)
  const meta = [
    detectPlatform(item.url).label,
    info.duration ? formatDuration(info.duration) : '',
    info.uploader ?? '',
    size ? `~${formatBytes(size)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const mark = item.selected ? '[x]' : '[ ]'
  const title = truncate(info.title, Math.max(12, width - meta.length - 9))
  return truncate(`${mark} ${title} · ${meta}`, width)
}

type Phase =
  | {name: 'input'; warning?: string}
  | {name: 'probing'; status: string}
  | {name: 'picking'}
  | ({name: 'downloading'} & DownloadState)
  | {name: 'done'; filepath: string}
  | {name: 'error'; message: string}
  | {name: 'reviewing'}
  | {name: 'batch-picking'}
  | ({name: 'batch-downloading'; index: number; total: number; title: string} & DownloadState)
  | {name: 'batch-done'; saved: string[]; failed: Array<{title: string; message: string}>}

type DownloadState = {
  choice: DownloadChoice
  progress?: DownloadProgress
  processing: boolean
  refreshing?: boolean
}

const isDownloading = (phase: Phase): phase is Extract<Phase, DownloadState> =>
  phase.name === 'downloading' || phase.name === 'batch-downloading'

const HINTS: Record<Phase['name'], Array<[string, string]>> = {
  input: [
    ['↵', 'yoink'],
    ['^c', 'quit'],
  ],
  probing: [
    ['esc', 'cancel'],
    ['^c', 'quit'],
  ],
  picking: [
    ['↑↓', 'choose'],
    ['↵', 'yoink'],
    ['esc', 'back'],
    ['^c', 'quit'],
  ],
  downloading: [
    ['esc', 'cancel'],
    ['^c', 'quit'],
  ],
  done: [['^c', 'quit']],
  error: [
    ['↵', 'try again'],
    ['^c', 'quit'],
  ],
  reviewing: [
    ['↑↓', 'move'],
    ['space', 'pick'],
    ['a', 'all'],
    ['o', 'preview'],
    ['↵', 'next'],
    ['esc', 'back'],
  ],
  'batch-picking': [
    ['↑↓', 'choose'],
    ['↵', 'yoink all'],
    ['esc', 'back'],
    ['^c', 'quit'],
  ],
  'batch-downloading': [
    ['esc', 'cancel'],
    ['^c', 'quit'],
  ],
  'batch-done': [['^c', 'quit']],
}

// every branch is exactly three rows — bar, gap, meta — so the layout never jumps
function DownloadRows({state}: {state: DownloadState}) {
  const theme = useTheme()
  const {progress, processing, refreshing} = state
  if (processing) {
    return (
      <>
        <ProgressBar percent={1} />
        <Gap />
        <Text>
          <Text color={theme.primary}>
            <Spinner type="dots" />
          </Text>
          <Text color={theme.gray} dimColor={theme.dimSecondary}> processing…</Text>
        </Text>
      </>
    )
  }
  if (progress?.totalBytes) {
    return (
      <>
        <ProgressBar percent={progress.downloadedBytes / progress.totalBytes} />
        <Gap />
        <Text color={theme.gray} dimColor={theme.dimSecondary}>{downloadMeta(progress)}</Text>
      </>
    )
  }
  if (progress) {
    return (
      <>
        <Text>
          <Text color={theme.primary}>
            <Spinner type="dots" />
          </Text>
          <Text color={theme.gray} dimColor={theme.dimSecondary}> downloading…</Text>
        </Text>
        <Gap />
        <Text color={theme.gray} dimColor={theme.dimSecondary}>{indeterminateMeta(progress)}</Text>
      </>
    )
  }
  return (
    <>
      <ProgressBar percent={0} />
      <Gap />
      <Text>
        <Text color={theme.primary}>
          <Spinner type="dots" />
        </Text>
        <Text color={theme.gray} dimColor={theme.dimSecondary}>
          {refreshing ? ' link expired — grabbing a fresh one…' : ' starting download…'}
        </Text>
      </Text>
    </>
  )
}

type AppProps = {
  initialUrls: string[]
  clipboardUrls: string[]
  initialThemeMode?: ThemeMode
  onOutcome: (outcome: Outcome) => void
}

export function App({initialThemeMode = 'auto', ...props}: AppProps) {
  const [themeMode, setThemeMode] = useState(initialThemeMode)
  const cycleTheme = useCallback(() => {
    setThemeMode(nextThemeMode)
  }, [])

  return (
    <ThemeProvider mode={themeMode}>
      <AppContent {...props} cycleTheme={cycleTheme} />
    </ThemeProvider>
  )
}

function AppContent({
  initialUrls,
  clipboardUrls,
  onOutcome,
  cycleTheme,
}: {
  initialUrls: string[]
  clipboardUrls: string[]
  onOutcome: (outcome: Outcome) => void
  cycleTheme: () => void
}) {
  const theme = useTheme()
  const {exit} = useApp()
  const {stdout} = useStdout()
  // the link being yoinked — every link, space-separated, for a batch
  const [url, setUrl] = useState(initialUrls.join(' '))
  const [urlInput, setUrlInput] = useState('')
  const [history, setHistory] = useState(loadHistory)
  const [config] = useState(loadConfig)
  const [platform, setPlatform] = useState<Platform>()
  const [info, setInfo] = useState<VideoInfo>()
  const [choices, setChoices] = useState<DownloadChoice[]>([])
  const [batch, setBatch] = useState<BatchItem[]>([])
  const [reviewCursor, setReviewCursor] = useState(0)
  const ytdlpRef = useRef('')
  const highlightRef = useRef(0) // choice under the cursor, for the ↵ hint click
  const infoJsonRef = useRef<string | undefined>(undefined)
  const abortRef = useRef<AbortController | undefined>(undefined)
  const [phase, setPhase] = useState<Phase>(
    initialUrls.length > 0 ? {name: 'probing', status: 'warming up…'} : {name: 'input'},
  )

  const columns = stdout?.columns && stdout.columns > 0 ? stdout.columns : 80
  const boxWidth = Math.max(14, Math.min(64, columns - 6))
  const contentWidth = Math.max(10, Math.min(columns - 4, 78))
  const rows = stdout?.rows && stdout.rows > 0 ? stdout.rows : 24
  // what's left after logo, tagline, summary and shortcuts
  const listRows = Math.max(3, rows - 16)

  const startProbe = useCallback(async (targetUrl: string) => {
    const controller = new AbortController()
    abortRef.current = controller
    setPlatform(detectPlatform(targetUrl))
    setPhase({name: 'probing', status: 'warming up…'})
    try {
      const ytdlp =
        ytdlpRef.current ||
        (await ensureYtDlp(status => setPhase({name: 'probing', status}), controller.signal))
      ytdlpRef.current = ytdlp
      if (controller.signal.aborted) return
      setPhase({name: 'probing', status: 'fetching video info…'})
      const {info: videoInfo, infoJsonPath} = await probe(ytdlp, targetUrl, controller.signal)
      if (controller.signal.aborted) return
      infoJsonRef.current = infoJsonPath
      setInfo(videoInfo)
      setChoices(buildChoices(videoInfo))
      highlightRef.current = 0
      setPhase({name: 'picking'})
    } catch (error) {
      if (controller.signal.aborted) return
      setPhase({name: 'error', message: errorMessage(error)})
    }
  }, [])

  const startBatch = useCallback(async (urls: string[]) => {
    const controller = new AbortController()
    abortRef.current = controller
    setPlatform({key: 'batch', label: `${urls.length} links`})
    setPhase({name: 'probing', status: 'warming up…'})
    try {
      const ytdlp =
        ytdlpRef.current ||
        (await ensureYtDlp(status => setPhase({name: 'probing', status}), controller.signal))
      ytdlpRef.current = ytdlp
      if (controller.signal.aborted) return
      setBatch(urls.map(url => ({url, status: 'probing', selected: true})))
      setReviewCursor(0)
      setPhase({name: 'reviewing'})
      const update = (index: number, patch: Partial<BatchItem>) =>
        setBatch(prev => prev.map((item, i) => (i === index ? {...item, ...patch} : item)))
      let next = 0
      const worker = async () => {
        while (next < urls.length && !controller.signal.aborted) {
          const index = next++
          try {
            const {info: videoInfo, infoJsonPath} = await probe(ytdlp, urls[index]!, controller.signal)
            if (controller.signal.aborted) return void discardInfoJson(infoJsonPath)
            update(index, {status: 'ok', info: videoInfo, infoJsonPath})
          } catch (error) {
            if (controller.signal.aborted) return
            // one bad link shouldn't sink the rest — it just can't be picked
            update(index, {status: 'error', selected: false, error: errorMessage(error)})
          }
        }
      }
      await Promise.all(Array.from({length: Math.min(PROBE_CONCURRENCY, urls.length)}, worker))
    } catch (error) {
      if (controller.signal.aborted) return
      setPhase({name: 'error', message: errorMessage(error)})
    }
  }, [])

  useEffect(() => {
    if (initialUrls.length === 1) void startProbe(initialUrls[0]!)
    else if (initialUrls.length > 1) void startBatch(initialUrls)
  }, [initialUrls, startProbe, startBatch])

  const resetToInput = useCallback(() => {
    // cached probe info for anything that wasn't downloaded
    for (const item of batch) if (item.infoJsonPath) void discardInfoJson(item.infoJsonPath)
    if (infoJsonRef.current) void discardInfoJson(infoJsonRef.current)
    infoJsonRef.current = undefined
    setUrl('')
    setUrlInput('')
    setPlatform(undefined)
    setInfo(undefined)
    setChoices([])
    setBatch([])
    setPhase({name: 'input'})
  }, [batch])

  const cancelRun = useCallback(() => {
    abortRef.current?.abort()
    resetToInput()
    setUrlInput(url) // keep the link around so a cancel isn't destructive
  }, [resetToInput, url])

  // probes or downloads may be running — leaving has to abort them
  const busy =
    phase.name === 'probing' ||
    phase.name === 'downloading' ||
    phase.name === 'reviewing' ||
    phase.name === 'batch-downloading'
  const goBack = busy ? cancelRun : phase.name === 'batch-picking' ? () => setPhase({name: 'reviewing'}) : resetToInput

  const togglePick = (index: number) =>
    setBatch(prev => prev.map((item, i) => (i === index && isReady(item) ? {...item, selected: !item.selected} : item)))
  const toggleAll = () =>
    setBatch(prev => {
      const all = prev.filter(isReady).every(item => item.selected)
      return prev.map(item => (isReady(item) ? {...item, selected: !all} : item))
    })
  // the thumbnail is the quickest "is this the right video?" check
  const previewCurrent = () => openExternal(batch[reviewCursor]?.info?.thumbnail ?? batch[reviewCursor]?.url)
  const reviewDone = batch.length > 0 && !batch.some(item => item.status === 'probing')
  const continueBatch = () => {
    if (!reviewDone || !batch.some(isPicked)) return
    highlightRef.current = 0
    setPhase({name: 'batch-picking'})
  }

  useInput(
    (input, key) => {
      if (key.ctrl && input === 't') {
        cycleTheme()
        return
      }
      if (key.escape && phase.name !== 'input') goBack()
      if (key.return && (phase.name === 'error' || phase.name === 'done' || phase.name === 'batch-done')) resetToInput()
      if (phase.name === 'reviewing') {
        if (key.upArrow) setReviewCursor(cursor => Math.max(0, cursor - 1))
        if (key.downArrow) setReviewCursor(cursor => Math.min(batch.length - 1, cursor + 1))
        if (input === ' ') togglePick(reviewCursor)
        if (input === 'a') toggleAll()
        if (input === 'o') previewCurrent()
        if (key.return) continueBatch()
      }
    },
    {isActive: Boolean(process.stdin.isTTY)},
  )

  const handleUrlSubmit = (value: string) => {
    const urls = extractUrls(value).slice(0, MAX_LINKS)
    if (urls.length === 0) {
      setPhase({name: 'input', warning: 'that doesn’t look like a link — paste a full url'})
      return
    }
    setUrl(urls.join(' '))
    if (urls.length === 1) void startProbe(urls[0]!)
    else void startBatch(urls)
  }

  const clipboardText = clipboardUrls.join(' ')
  const clipboardOffered = clipboardUrls.length > 0 && urlInput === ''
  const clipboardAccepted = clipboardUrls.length > 0 && urlInput === clipboardText

  const downloadHandlers = {
    onProgress: (progress: DownloadProgress) =>
      setPhase(prev => (isDownloading(prev) ? {...prev, progress, processing: false} : prev)),
    onProcessing: () => setPhase(prev => (isDownloading(prev) ? {...prev, processing: true} : prev)),
    onRefresh: () =>
      setPhase(prev => (isDownloading(prev) ? {...prev, progress: undefined, refreshing: true} : prev)),
  }

  const handlePick = (item: {value: number}) => {
    const choice = choices[item.value]!
    const controller = new AbortController()
    abortRef.current = controller
    setPhase({name: 'downloading', choice, processing: false})
    void (async () => {
      try {
        const ffmpegLocation = await findFfmpeg()
        const infoJsonPath = infoJsonRef.current
        infoJsonRef.current = undefined // downloadWithRetry cleans it up
        const filepath = await downloadWithRetry(
          {
            ytdlp: ytdlpRef.current,
            ffmpegLocation,
            url,
            infoJsonPath,
            choice,
            outDir: config.videoDir,
            outTemplate: videoTemplate(url),
          },
          downloadHandlers,
          controller.signal,
        )
        onOutcome({filepaths: [filepath]})
        setHistory(addToHistory(url))
        setPhase({name: 'done', filepath})
      } catch (error) {
        if (controller.signal.aborted) return
        setPhase({name: 'error', message: errorMessage(error)})
      }
    })()
  }

  // one at a time — keeps progress readable and the single active yt-dlp child valid
  const startBatchDownload = (choice: DownloadChoice) => {
    const picked = batch.filter(isPicked)
    const controller = new AbortController()
    abortRef.current = controller
    // downloadWithRetry removes each cached info file — don't discard them twice
    setBatch(prev => prev.map(item => (isPicked(item) ? {...item, infoJsonPath: undefined} : item)))
    const saved: string[] = []
    const failed: Array<{title: string; message: string}> = []
    void (async () => {
      const ffmpegLocation = await findFfmpeg()
      for (const [index, item] of picked.entries()) {
        if (controller.signal.aborted) return
        const title = item.info?.title ?? item.url
        setPhase({name: 'batch-downloading', index, total: picked.length, title, choice, processing: false})
        try {
          const filepath = await downloadWithRetry(
            {
              ytdlp: ytdlpRef.current,
              ffmpegLocation,
              url: item.url,
              infoJsonPath: item.infoJsonPath,
              choice,
              outDir: config.videoDir,
              outTemplate: videoTemplate(item.url),
            },
            downloadHandlers,
            controller.signal,
          )
          saved.push(filepath)
          // report as we go, so quitting mid-batch still lists what landed
          onOutcome({filepaths: [...saved]})
          setHistory(addToHistory(item.url))
        } catch (error) {
          if (controller.signal.aborted) return
          failed.push({title, message: errorMessage(error)})
        }
      }
      setPhase({name: 'batch-done', saved, failed})
    })()
  }

  let hints: Array<[string, string]> = [...HINTS[phase.name], ['^t', `theme:${theme.mode}`]]
  if (phase.name === 'input' && history.length > 0) {
    hints = [hints[0]!, ['↑', 'history'], ...hints.slice(1)]
  }

  // Anything a mouse user would expect to press is clickable. Targets are
  // found by their text in the rendered frame (see lib/click-map.ts), so
  // there is no layout math to keep in sync.
  const hintAction = (key: string): (() => void) | undefined => {
    if (key === '^c') return () => exit()
    if (key === '^t') return cycleTheme
    if (key === 'esc') return goBack
    if (key === '↵') {
      if (phase.name === 'input') return () => handleUrlSubmit(urlInput)
      if (phase.name === 'picking') return () => handlePick({value: highlightRef.current})
      if (phase.name === 'reviewing') return continueBatch
      if (phase.name === 'batch-picking') return () => startBatchDownload(BATCH_PRESETS[highlightRef.current]!)
      if (phase.name === 'error' || phase.name === 'done' || phase.name === 'batch-done') return resetToInput
    }
    if (phase.name === 'reviewing') {
      if (key === 'space') return () => togglePick(reviewCursor)
      if (key === 'a') return toggleAll
      if (key === 'o') return previewCurrent
    }
    return undefined // ↑↓ / ↑ stay keyboard-only
  }
  const clickTargets: ClickTarget[] = []
  if (phase.name === 'input') {
    // the frame button rows above/below the label are part of the button
    clickTargets.push({match: `  ${YOINK_BUTTON}  `, padY: 1, action: () => handleUrlSubmit(urlInput)})
  }
  if (phase.name === 'picking') {
    for (const [index, choice] of choices.entries()) {
      clickTargets.push({match: choiceLabel(choice), action: () => handlePick({value: index})})
    }
  }
  if (phase.name === 'batch-picking') {
    for (const choice of BATCH_PRESETS) {
      clickTargets.push({match: choiceLabel(choice), action: () => startBatchDownload(choice)})
    }
  }
  if (phase.name === 'done' || phase.name === 'batch-done') {
    clickTargets.push({match: DONE_LABEL, padX: 4, padY: 1, action: resetToInput})
  }
  for (const [key, label] of hints) {
    const action = hintAction(key)
    if (action) clickTargets.push({match: `${key} ${label}`, action})
  }

  useMouseClick(
    (x, y) => {
      // the logo takes you home — it's the 3 rows one gap above the tagline
      const taglineRow = findFrameRow(TAGLINE)
      if (taglineRow > 3 && y - 1 >= taglineRow - 4 && y - 1 <= taglineRow - 2) {
        const span = frameRowSpan(y - 1)
        if (span && x >= span[0] - 1 && x <= span[1] + 1) {
          if (busy) cancelRun()
          else if (phase.name !== 'input') resetToInput()
          return
        }
      }
      clickTargetAt(x, y, clickTargets)?.action()
    },
    Boolean(process.stdin.isTTY),
  )

  // keep the cursor's row in view when the list is taller than the screen
  const listStart = Math.max(0, Math.min(reviewCursor - Math.floor(listRows / 2), batch.length - listRows))
  const pickedItems = batch.filter(isPicked)
  const pickedSize = pickedItems.reduce((total, item) => total + (estimateSize(item.info!) ?? 0), 0)
  const loadingCount = batch.filter(item => item.status === 'probing').length
  const failedCount = batch.filter(item => item.status === 'error').length
  const reviewSummary = [
    `${pickedItems.length}/${batch.filter(isReady).length} picked`,
    pickedSize ? `~${formatBytes(pickedSize)}` : '',
    loadingCount ? `checking ${loadingCount} more…` : '',
    failedCount ? `${failedCount} unavailable` : '',
    batch.length > listRows ? `${reviewCursor + 1}/${batch.length}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <FullScreen>
      <Logo />
      <Gap />
      <Text color={theme.primary}>{TAGLINE}</Text>
      <Text color={theme.gray} dimColor={theme.dimSecondary}>youtube · x · instagram · threads · tiktok · +1800 more</Text>
      <Gap />

      {phase.name === 'input' && (
        <Box flexDirection="column" alignItems="center">
          <FramedInput title="Paste a link" width={boxWidth} button={YOINK_BUTTON}>
            <TextInput
              value={urlInput}
              onChange={setUrlInput}
              onSubmit={handleUrlSubmit}
              placeholder="https://youtube.com/watch?v=…"
              width={boxWidth - 6}
              history={history}
              submitOnPaste={value => extractUrls(value).length > 0}
              onTab={() => {
                if (clipboardOffered) setUrlInput(clipboardText)
              }}
            />
          </FramedInput>
          {phase.warning ? (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>✗ {phase.warning}</Text>
          ) : clipboardOffered ? (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>
              {clipboardUrls.length === 1
                ? 'link in your clipboard — ⇥ to paste it'
                : `${clipboardUrls.length} links in your clipboard — ⇥ to paste them`}
            </Text>
          ) : clipboardAccepted ? (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>
              {clipboardUrls.length === 1 ? 'from your clipboard — ↵ to yoink it' : 'from your clipboard — ↵ to review them'}
            </Text>
          ) : null}
        </Box>
      )}

      {phase.name === 'probing' && (
        <Box flexDirection="column" alignItems="center">
          <FramedInput title={platform ? platform.label : 'Paste a link'} width={boxWidth} button={YOINK_BUTTON} buttonDim>
            <Text color={theme.gray} dimColor={theme.dimSecondary}>{url.length > boxWidth - 8 ? `${url.slice(0, boxWidth - 9)}…` : url}</Text>
          </FramedInput>
        </Box>
      )}

      {phase.name === 'picking' && platform && (
        <Box width={contentWidth}>
          <Box flexDirection="column" flexGrow={1} flexBasis={0} paddingTop={1} paddingRight={3}>
            {/* wrapped by hand so continuation lines stay flush left —
                ink's wrapping keeps the break's space as a 1-cell indent */}
            {wrapText(info?.title ?? '', Math.max(10, contentWidth - 41)).map((line, index) => (
              <Text key={index} bold color={theme.primary}>
                {line}
              </Text>
            ))}
            <Gap />
            <Text color={theme.gray} dimColor={theme.dimSecondary}>
              ▸ {platform.label}
              {info?.duration ? ` · ${formatDuration(info.duration)}` : ''}
              {info?.uploader ? ` · ${info.uploader}` : ''}
            </Text>
          </Box>
          <Panel title="Download" width={38}>
            <SelectInput
              indicatorComponent={ChoiceIndicator}
              itemComponent={ChoiceItem}
              items={choices.map((choice, index) => ({
                key: String(index),
                label: choiceLabel(choice),
                value: index,
              }))}
              onSelect={handlePick}
              onHighlight={item => (highlightRef.current = item.value)}
            />
          </Panel>
        </Box>
      )}

      {phase.name === 'downloading' && (
        <Box flexDirection="column" alignItems="center">
          <Text color={theme.gray} dimColor={theme.dimSecondary}>
            {info?.title ? `${truncate(info.title, 42)} · ` : ''}
            {phase.choice.label}
          </Text>
          <Gap />
          <DownloadRows state={phase} />
        </Box>
      )}

      {phase.name === 'reviewing' && (
        <Box flexDirection="column" width={contentWidth}>
          {batch.slice(listStart, listStart + listRows).map((item, offset) => {
            const current = listStart + offset === reviewCursor
            return (
              <Text
                key={item.url}
                bold={current}
                color={item.status === 'ok' ? theme.primary : theme.gray}
                dimColor={item.status !== 'ok' && theme.dimSecondary}
              >
                {current ? '❯ ' : '  '}
                {reviewRow(item, contentWidth - 2)}
              </Text>
            )
          })}
          <Gap />
          <Text color={theme.gray} dimColor={theme.dimSecondary}>{reviewSummary}</Text>
        </Box>
      )}

      {phase.name === 'batch-picking' && (
        <Box width={contentWidth}>
          <Box flexDirection="column" flexGrow={1} flexBasis={0} paddingTop={1} paddingRight={3}>
            <Text bold color={theme.primary}>
              {batch.filter(isPicked).length} videos
            </Text>
            <Gap />
            <Text color={theme.gray} dimColor={theme.dimSecondary}>
              ▸ one quality for all — each falls back to its best if it can’t reach it
            </Text>
          </Box>
          <Panel title="Download all as" width={38}>
            <SelectInput
              indicatorComponent={ChoiceIndicator}
              itemComponent={ChoiceItem}
              items={BATCH_PRESETS.map((choice, index) => ({
                key: String(index),
                label: choiceLabel(choice),
                value: index,
              }))}
              onSelect={item => startBatchDownload(BATCH_PRESETS[item.value]!)}
              onHighlight={item => (highlightRef.current = item.value)}
            />
          </Panel>
        </Box>
      )}

      {phase.name === 'batch-downloading' && (
        <Box flexDirection="column" alignItems="center">
          <Text color={theme.gray} dimColor={theme.dimSecondary}>
            {`${phase.index + 1}/${phase.total} · ${truncate(phase.title, 36)} · ${phase.choice.label}`}
          </Text>
          <Gap />
          <DownloadRows state={phase} />
        </Box>
      )}

      {phase.name === 'batch-done' && (
        <Box flexDirection="column" alignItems="center">
          <Text>
            <Text bold color={theme.primary}>✓ {phase.saved.length} yoinked</Text>
            {phase.failed.length > 0 ? <Text color={theme.primary}> · ✗ {phase.failed.length} failed</Text> : null}
          </Text>
          <Text color={theme.gray} dimColor={theme.dimSecondary}>{shortenPath(config.videoDir, os.homedir(), 60)}</Text>
          {phase.failed.slice(0, 5).map(({title, message}, index) => (
            <Text key={index} color={theme.gray} dimColor={theme.dimSecondary}>
              ✗ {truncate(`${title}: ${message}`, contentWidth - 2)}
            </Text>
          ))}
          <Gap />
          <Box
            borderStyle="round"
            borderColor={theme.gray}
            borderDimColor={theme.dimSecondary}
            borderBackgroundColor={theme.background}
            paddingX={3}
          >
            <Text bold color={theme.primary}>{DONE_LABEL}</Text>
          </Box>
        </Box>
      )}

      {phase.name === 'done' && (
        <Box flexDirection="column" alignItems="center">
          <Text>
            <Text bold color={theme.primary}>✓ yoinked! </Text>
            <Text color={theme.primary}>find your file in:</Text>
          </Text>
          <Text color={theme.gray} dimColor={theme.dimSecondary}>{shortenPath(phase.filepath, os.homedir(), 60)}</Text>
          <Gap />
          <Box
            borderStyle="round"
            borderColor={theme.gray}
            borderDimColor={theme.dimSecondary}
            borderBackgroundColor={theme.background}
            paddingX={3}
          >
            <Text bold color={theme.primary}>{DONE_LABEL}</Text>
          </Box>
        </Box>
      )}

      {phase.name === 'error' && (
        <Box flexDirection="column" alignItems="center" width={Math.max(10, Math.min(columns - 6, 72))}>
          <Text bold color={theme.primary}>✗ {phase.message}</Text>
        </Box>
      )}

      {hints.length > 0 ? (
        <>
          <Gap lines={2} />
          <Shortcuts
            items={hints}
            leading={
              phase.name === 'probing' ? (
                <Text>
                  <Text color={theme.primary}>
                    <Spinner type="dots" />
                  </Text>
                  <Text color={theme.gray} dimColor={theme.dimSecondary}> {phase.status}</Text>
                </Text>
              ) : undefined
            }
          />
        </>
      ) : null}
    </FullScreen>
  )
}
