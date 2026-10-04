import React from 'react'
import {createRequire} from 'node:module'
import {render} from 'ink'
import {App, type Outcome} from './app.js'
import {captureFrames} from './lib/click-map.js'
import {parseArgs} from './lib/args.js'
import {extractUrls, MAX_LINKS, readLinkFile} from './lib/links.js'
import {readClipboard} from './lib/clipboard.js'
import {isProbablyUrl} from './lib/platforms.js'

// read at runtime from the shipped package.json so npm version bumps
// can't drift from a hardcoded constant
const VERSION: string = createRequire(import.meta.url)('../package.json').version

const HELP = `
  yoinks — yoink any video. paste. yoink. done.

  Usage
    $ yoinks [url | file ...]

  Examples
    $ yoinks https://youtu.be/dQw4w9WgXcQ
    $ yoinks https://x.com/user/status/123456 https://youtu.be/dQw4w9WgXcQ
    $ yoinks links.txt       (every link in a .txt / .md / any text file)
    $ yoinks                 (prompts for a url — paste one or many)

  Options
    --theme <mode>  use auto, light, or dark for this run
    -h, --help      show this help
    -v, --version   show version

  Downloads are saved to ~/Downloads.
  Powered by yt-dlp — YouTube, X, Instagram, Threads, TikTok & 1800+ sites.
`

const args = parseArgs(process.argv.slice(2))

if (args.error) {
  console.error(`yoinks: ${args.error}\nTry “yoinks --help” for usage.`)
  process.exit(1)
}

if (args.help) {
  console.log(HELP)
  process.exit(0)
}

if (args.version) {
  console.log(VERSION)
  process.exit(0)
}

function fail(message: string): never {
  console.error(`yoinks: ${message}`)
  process.exit(1)
}

// a positional that isn't a url is a file of links
const initialRejected: string[] = []
let initialDuplicates = 0
function expandInput(input: string): string[] {
  if (isProbablyUrl(input)) return [input]
  const list = readLinkFile(input)
  if ('error' in list) fail(list.error)
  initialRejected.push(...list.rejected)
  initialDuplicates += list.duplicates
  return list.urls
}

const allUrls = args.inputs.flatMap(expandInput)
const initialUrls = [...new Set(allUrls)]
initialDuplicates += allUrls.length - initialUrls.length
if (initialUrls.length > MAX_LINKS) fail(`${initialUrls.length} links is too many — ${MAX_LINKS} max per run`)
if (args.inputs.length > 0 && initialUrls.length === 0) fail(`no usable links — not valid: ${initialRejected.join(', ')}`)
const initialThemeMode = args.themeMode ?? 'auto'

const isTTY = Boolean(process.stdout.isTTY)

// no url given — offer the clipboard's links (⇥ to paste) when it holds some
let clipboardUrls: string[] = []
if (initialUrls.length === 0 && isTTY) {
  clipboardUrls = extractUrls(readClipboard()).slice(0, MAX_LINKS)
}
const enterAltScreen = () => process.stdout.write('\x1b[?1049h\x1b[H')
// also switch mouse tracking off — a crash can skip React effect cleanup
const leaveAltScreen = () => process.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[?1049l')

if (isTTY) {
  enterAltScreen()
  process.on('exit', leaveAltScreen)
  // restore the terminal BEFORE a crash prints, or the stack trace is
  // wiped along with the alternate screen and the app looks like it
  // silently quit
  for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
    process.on(event, (error: unknown) => {
      leaveAltScreen()
      console.error(error)
      process.exit(1)
    })
  }
}

let outcome: Outcome = {filepaths: []}
const {waitUntilExit} = render(
  <App
    initialUrls={initialUrls}
    clipboardUrls={clipboardUrls}
    initialThemeMode={initialThemeMode}
    initialMusic={Boolean(args.music)}
    initialRejected={initialRejected}
    initialDuplicates={initialDuplicates}
    onOutcome={result => (outcome = result)}
  />,
  // keep a copy of every frame so clicks can be hit-tested against it
  {stdout: captureFrames(process.stdout)},
)

await waitUntilExit()

if (isTTY) leaveAltScreen()
for (const filepath of outcome.filepaths) {
  console.log(`✓ yoinked → ${filepath}`)
}
