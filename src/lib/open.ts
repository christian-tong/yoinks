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

function launch(command: string, args: string[]): void {
  try {
    const child = spawn(command, args, {stdio: 'ignore', detached: true})
    child.on('error', () => {})
    child.unref()
  } catch {
    // no opener on this system — nothing useful to do from a TUI
  }
}

/** Open an http(s) url in the default browser. Best effort — never throws. */
export function openExternal(url: string | undefined): void {
  if (!url || !isProbablyUrl(url)) return
  const [command, args] = OPENER
  launch(command, [...args, url])
}

/** Show a folder in the file manager. Best effort — never throws. */
export function openFolder(dir: string): void {
  if (process.platform === 'win32') launch('explorer.exe', [dir])
  else launch(OPENER[0], [dir])
}
