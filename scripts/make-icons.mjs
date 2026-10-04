// Builds the desktop-shortcut icons from 16×16 pixel grids — the same blocky
// "y" as the logo, so it stays crisp at the 16–48px Windows actually shows.
// No dependencies: PNGs via zlib, wrapped in a PNG-entry .ico.
//
//   npm run icons   →   assets/icon(.ico|.png), assets/icon-music(.ico|.png)

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

// . background   # ink   % dithered ink (the logo's ▓)   n accent
const ICONS = {
  icon: [
    '................',
    '................',
    '...%%%....###...',
    '...%%%....###...',
    '...%%%....###...',
    '...%%%....###...',
    '...##########...',
    '....########....',
    '......####......',
    '......####......',
    '......####......',
    '......####......',
    '......####......',
    '......####......',
    '................',
    '................',
  ],
  // the "y" shifts left to make room for an eighth note beside its stem
  'icon-music': [
    '................',
    '................',
    '..%%%....###....',
    '..%%%....###....',
    '..%%%....###....',
    '..%%%....###....',
    '..##########....',
    '...########.....',
    '.....####...nn..',
    '.....####...n.n.',
    '.....####...n...',
    '.....####...n...',
    '.....####.nnn...',
    '.....####.nnn...',
    '................',
    '................',
  ],
}

const PALETTE = {
  background: [0xff, 0xff, 0xff],
  border: [0xd4, 0xd4, 0xd8], // keeps the white tile visible on light wallpapers
  ink: [0x18, 0x18, 0x1b],
  accent: [0x16, 0xa3, 0x4a],
}
const SIZES = [16, 32, 48, 64, 128, 256]
const GRID = 16
const SUPERSAMPLE = 4 // per axis, for the rounded corners' antialiasing

function insideRoundedRect(px, py, size, inset, radius) {
  const lo = inset
  const hi = size - inset
  if (px < lo || py < lo || px > hi || py > hi) return false
  const cx = Math.min(Math.max(px, lo + radius), hi - radius)
  const cy = Math.min(Math.max(py, lo + radius), hi - radius)
  return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2
}

/** RGBA pixels for one grid at one size. */
function render(grid, size) {
  const scale = size / GRID
  // the logo's ▓ is a 4-per-cell checkerboard; never finer than one pixel
  const check = Math.max(1, scale / 4)
  const radius = size * (3 / GRID)
  const border = Math.max(1, size / 64)
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let outer = 0
      let inner = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const px = x + (sx + 0.5) / SUPERSAMPLE
          const py = y + (sy + 0.5) / SUPERSAMPLE
          if (insideRoundedRect(px, py, size, 0, radius)) outer++
          if (insideRoundedRect(px, py, size, border, radius - border)) inner++
        }
      }
      const samples = SUPERSAMPLE ** 2
      // blend border → background by how much of the pixel is inside the inner edge
      const t = inner / Math.max(outer, 1)
      let rgb = PALETTE.border.map((b, i) => Math.round(b + (PALETTE.background[i] - b) * t))
      const cell = grid[Math.floor(y / scale)][Math.floor(x / scale)]
      const dithered = (Math.floor(x / check) + Math.floor(y / check)) % 2 === 0
      if (cell === '#' || (cell === '%' && dithered)) rgb = PALETTE.ink
      if (cell === 'n') rgb = PALETTE.accent
      const offset = (y * size + x) * 4
      pixels.set([...rgb, Math.round((outer / samples) * 255)], offset)
    }
  }
  return pixels
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

function png(pixels, size) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA, no interlace
  // every scanline starts with filter type 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** .ico holding one PNG per size (supported since Windows Vista). */
function ico(images) {
  const dir = Buffer.alloc(6 + images.length * 16)
  dir.writeUInt16LE(1, 2) // type: icon
  dir.writeUInt16LE(images.length, 4)
  let offset = dir.length
  images.forEach(({size, data}, index) => {
    const entry = 6 + index * 16
    dir.writeUInt8(size % 256, entry) // 0 means 256
    dir.writeUInt8(size % 256, entry + 1)
    dir.writeUInt16LE(1, entry + 4) // planes
    dir.writeUInt16LE(32, entry + 6) // bits per pixel
    dir.writeUInt32LE(data.length, entry + 8)
    dir.writeUInt32LE(offset, entry + 12)
    offset += data.length
  })
  return Buffer.concat([dir, ...images.map(image => image.data)])
}

const outDir = path.join(import.meta.dirname, '..', 'assets')
for (const [name, grid] of Object.entries(ICONS)) {
  if (grid.length !== GRID || grid.some(row => row.length !== GRID)) throw new Error(`${name}: grid must be ${GRID}×${GRID}`)
  const images = SIZES.map(size => ({size, data: png(render(grid, size), size)}))
  fs.writeFileSync(path.join(outDir, `${name}.ico`), ico(images))
  fs.writeFileSync(path.join(outDir, `${name}.png`), images.at(-1).data)
  console.log(`assets/${name}.ico (${SIZES.join(', ')}px) + assets/${name}.png`)
}
