import {isProbablyUrl} from './platforms.js'

/** Most links one run takes — past this a batch is a script's job, not a TUI's. */
export const MAX_LINKS = 100

// stops at whitespace, markdown/html delimiters, and the start of a glued-on
// next url — a paste can lose its newlines and arrive as `https://a…https://b…`
const URL_PATTERN = /https?:\/\/(?:(?!https?:\/\/)[^\s<>()[\]"'`])+/g

/** Every http(s) link in free text (plain, .txt, .md), deduped, in order. */
export function extractUrls(text: string): string[] {
  const urls = (text.match(URL_PATTERN) ?? []).map(url => url.replace(/[.,;:!?*_]+$/, ''))
  return [...new Set(urls.filter(isProbablyUrl))]
}
