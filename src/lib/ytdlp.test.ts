import assert from 'node:assert/strict'
import test from 'node:test'
import {musicChoice, musicTemplate, platformFolder, safeSegment, videoTemplate} from './ytdlp.js'

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

test('music goes into artist folders, albums get their own numbered folder', () => {
  assert.equal(musicTemplate(), '%(artist,uploader)s/%(track,title)s.%(ext)s')
  assert.equal(
    musicTemplate({title: 'Hits: 100%', index: 3}),
    '%(artist,uploader)s/Hits 100%%/03 %(track,title)s.%(ext)s',
  )
  const args = musicChoice({title: 'Hits: 50% Off', index: 7}).args
  assert.ok(args.includes('--embed-thumbnail') && args.includes('--embed-metadata'))
  assert.ok(args.includes('Hits\\: 50%% Off:(?P<album>.+)') && args.includes('7:(?P<track_number>.+)'))
})
