import assert from 'node:assert/strict'
import test from 'node:test'
import {platformFolder, safeSegment, videoTemplate} from './ytdlp.js'

test('safeSegment strips characters windows rejects and escapes template percent signs', () => {
  assert.equal(safeSegment('AC/DC: Live? "100%" <hits>|*'), 'ACDC Live 100%% hits')
  assert.equal(safeSegment('trailing dots...'), 'trailing dots')
  assert.equal(safeSegment('///'), '_')
})

test('platformFolder gives each site its own folder', () => {
  assert.equal(platformFolder('https://www.instagram.com/reel/abc'), 'Instagram')
  assert.equal(platformFolder('https://vm.tiktok.com/xyz'), 'TikTok')
  assert.equal(platformFolder('https://youtu.be/abc'), 'YouTube')
  assert.equal(platformFolder('https://x.com/u/status/1'), 'X')
  assert.equal(platformFolder('https://www.dailymotion.com/video/x1'), 'dailymotion.com')
  assert.equal(videoTemplate('https://youtu.be/abc'), 'YouTube/%(title).60s [%(id)s].%(ext)s')
})
