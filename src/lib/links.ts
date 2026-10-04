import fs from 'node:fs'
import {isProbablyUrl} from './platforms.js'

/** Most links one run takes — past this a batch is a script's job, not a TUI's. */
export const MAX_LINKS = 100
const MAX_FILE_BYTES = 1024 * 1024

// stops at markdown/html delimiters and the start of a glued-on next url —
// a paste can lose its newlines and arrive as `https://a…https://b…`
const URL_PATTERN = /https?:\/\/(?:(?!https?:\/\/)[^\s<>()[\]"'`,])+/g
// whole-line comments, and trailing ` # note` / ` // note` (a url's own `#t=10`
// or `https://` never has whitespace right before it)
const COMMENT_LINE = /^\s*(?:#|\/\/)/
const INLINE_COMMENT = /\s(?:#|\/\/).*$/
// `youtube.com/watch?v=…` or `www.tiktok.com/…` — a link missing its scheme
const BARE_LINK = /^(?:www\.\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/\S*)$/i
// `htps://…`, `https//…`, `ftp://…` — meant as a link, but not one we can use
const BROKEN_LINK = /^(?:[a-z]+:?\/\/\S|ht+ps?:)/i

export type LinkList = {
  urls: string[]
  /** entries that look like links but aren't usable ones */
  rejected: string[]
  /** links that appeared more than once and were dropped */
  duplicates: number
}

const trimTrailing = (url: string) => url.replace(/[.,;:!?*_]+$/, '')
const unwrap = (token: string) => token.replace(/^[(<[{"'`]+|[)>\]}"'`.,;:!?]+$/g, '')

/**
 * Every link in free text (plain, .txt, .md) in order. Links may be split by
 * spaces, newlines or commas; `#` and `//` start comments.
 */
export function parseLinks(text: string): LinkList {
  const found: string[] = []
  const rejected: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    if (COMMENT_LINE.test(rawLine)) continue
    for (const token of rawLine.replace(INLINE_COMMENT, '').split(/[\s,]+/)) {
      const matches = (token.match(URL_PATTERN) ?? []).map(trimTrailing).filter(isProbablyUrl)
      if (matches.length > 0) {
        found.push(...matches)
        continue
      }
      const bare = unwrap(token)
      if (!bare) continue
      if (BARE_LINK.test(bare) && isProbablyUrl(`https://${bare}`)) found.push(`https://${bare}`)
      else if (BROKEN_LINK.test(bare)) rejected.push(bare)
    }
  }
  const urls = [...new Set(found)]
  return {urls, rejected: [...new Set(rejected)], duplicates: found.length - urls.length}
}

export function extractUrls(text: string): string[] {
  return parseLinks(text).urls
}

/**
 * Read a file of links. Dragging a file onto Windows Terminal pastes its path
 * in quotes, so those are stripped.
 */
export function readLinkFile(input: string): LinkList | {error: string} {
  const filepath = input.trim().replace(/^(["'])(.*)\1$/, '$2')
  let stat: fs.Stats
  try {
    stat = fs.statSync(filepath)
  } catch {
    return {error: `“${filepath}” isn't a link or a file`}
  }
  if (!stat.isFile()) return {error: `“${filepath}” isn't a file`}
  if (stat.size > MAX_FILE_BYTES) return {error: `“${filepath}” is too big — keep link files under 1 MB`}
  const list = parseLinks(fs.readFileSync(filepath, 'utf8'))
  if (list.urls.length === 0 && list.rejected.length === 0) return {error: `no links found in “${filepath}”`}
  return list
}

/** Does this look like a file path rather than links? (for pasted/dragged input) */
export function looksLikeFile(input: string): boolean {
  const value = input.trim().replace(/^(["'])(.*)\1$/, '$2')
  if (!value || extractUrls(value).length > 0) return false
  try {
    return fs.statSync(value).isFile()
  } catch {
    return false
  }
}
