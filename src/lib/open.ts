import {spawn} from 'node:child_process'
import {isProbablyUrl} from './platforms.js'

// no shell anywhere — the url comes from yt-dlp output, so `&` and friends
// must reach the browser as data, not as cmd.exe syntax
const OPENER: [string, string[]] =
  process.platform === 'win32'
    ? ['rundll32', ['url.dll,FileProtocolHandler']]
    : process.platform === 'darwin'
      ? ['open', []]
      : ['xdg-open', []]

/** Open an http(s) url in the default browser. Best effort — never throws. */
export function openExternal(url: string | undefined): void {
  if (!url || !isProbablyUrl(url)) return
  try {
    const [command, args] = OPENER
    const child = spawn(command, [...args, url], {stdio: 'ignore', detached: true})
    child.on('error', () => {})
    child.unref()
  } catch {
    // no opener on this system — nothing useful to do from a TUI
  }
}
