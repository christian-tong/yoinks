import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {extractUrls, looksLikeFile, parseLinks, readLinkFile} from './links.js'

test('pulls links out of plain text and markdown, trimming trailing punctuation', () => {
  const text = [
    '- [rick](https://youtu.be/dQw4w9WgXcQ)',
    'see https://x.com/user/status/123. also <https://vimeo.com/1>',
    'not a link: www or archivo.txt',
  ].join('\n')
  assert.deepEqual(extractUrls(text), [
    'https://youtu.be/dQw4w9WgXcQ',
    'https://x.com/user/status/123',
    'https://vimeo.com/1',
  ])
})

test('splits on spaces, commas, newlines and glued links; counts duplicates', () => {
  const list = parseLinks('https://a.com/1,https://b.com/2 , https://c.com/3\nhttps://a.com/1https://d.com/4')
  assert.deepEqual(list.urls, ['https://a.com/1', 'https://b.com/2', 'https://c.com/3', 'https://d.com/4'])
  assert.equal(list.duplicates, 1)
})

test('skips comment lines and trailing comments but keeps url fragments', () => {
  const text = [
    '# mis videos',
    '// pendientes',
    'https://youtube.com/watch?v=abc&t=10#t=5 # el de la boda',
    'https://a.com/x // otro',
  ].join('\n')
  assert.deepEqual(extractUrls(text), ['https://youtube.com/watch?v=abc&t=10#t=5', 'https://a.com/x'])
})

test('adds a missing scheme and reports broken links', () => {
  const list = parseLinks('youtube.com/watch?v=x www.tiktok.com/@a/video/1 htps://bad.com/1 https//bad.com/2')
  assert.deepEqual(list.urls, ['https://youtube.com/watch?v=x', 'https://www.tiktok.com/@a/video/1'])
  assert.deepEqual(list.rejected, ['htps://bad.com/1', 'https//bad.com/2'])
})

test('reads a quoted file path and errors on missing or link-less files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoinks-'))
  const file = path.join(dir, 'links.md')
  fs.writeFileSync(file, '# lista\nhttps://a.com/1, https://b.com/2\n')
  assert.deepEqual(readLinkFile(`"${file}"`), {urls: ['https://a.com/1', 'https://b.com/2'], rejected: [], duplicates: 0})
  assert.equal(looksLikeFile(`"${file}"`), true)
  assert.equal(looksLikeFile('https://a.com/1'), false)
  assert.match((readLinkFile(path.join(dir, 'nope.txt')) as {error: string}).error, /isn't a link or a file/)
  fs.writeFileSync(file, 'nada\n')
  assert.match((readLinkFile(file) as {error: string}).error, /no links found/)
  fs.rmSync(dir, {recursive: true})
})
