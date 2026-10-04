import assert from 'node:assert/strict'
import test from 'node:test'
import {extractUrls} from './links.js'

test('pulls links out of plain text and markdown, trimming trailing punctuation', () => {
  const text = [
    '# videos',
    '- [rick](https://youtu.be/dQw4w9WgXcQ)',
    'see https://x.com/user/status/123. also <https://vimeo.com/1>',
    'not a link: ftp://nope.com or www.nope.com',
  ].join('\n')
  assert.deepEqual(extractUrls(text), [
    'https://youtu.be/dQw4w9WgXcQ',
    'https://x.com/user/status/123',
    'https://vimeo.com/1',
  ])
})

test('splits links glued together and dedupes', () => {
  assert.deepEqual(extractUrls('https://a.com/1https://b.com/2 https://a.com/1'), [
    'https://a.com/1',
    'https://b.com/2',
  ])
})

test('keeps query strings intact', () => {
  assert.deepEqual(extractUrls('https://youtube.com/watch?v=abc&t=10'), ['https://youtube.com/watch?v=abc&t=10'])
})
