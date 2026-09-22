#!/usr/bin/env node
/**
 * Generates the application icons.
 *
 *   build/icon.png         1024x1024 — electron-builder derives the .icns and .ico
 *   build/icons/<n>.png    the hicolor set Linux desktop environments index
 *
 * The drawing is the site's favicon at size: the same dark plate, the same ring
 * and pupil, the same accent. They are generated from one description here
 * rather than exported from a drawing tool so that the app in the dock and the
 * tab in the browser cannot drift apart.
 *
 * The Linux set is written out explicitly because electron-builder, given a
 * single PNG, shipped exactly one 1024x1024 entry in the .deb — which leaves
 * every 16- and 24-pixel slot in a panel scaling a megapixel image down.
 *
 *   node scripts/make-app-icon.mjs            write the icons
 *   node scripts/make-app-icon.mjs --check    fail if the drawing has changed
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { encodePng, disc, roundRect, pixelHash, recordHash, checkHash } from './png.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// --chrome to --bg from styles.css, and --accent for the mark, so the icon and
// the app it opens are the same two colours.
const PLATE_TOP = [0x12, 0x16, 0x1c]
const PLATE_BOTTOM = [0x07, 0x09, 0x0c]
const ACCENT = [0x4c, 0xc9, 0xf0]

/**
 * The mark, at any size.
 *
 * macOS expects the icon to carry its own rounded shape with a little margin
 * rather than a full-bleed square, and the same drawing reads correctly in a
 * Linux panel. The favicon is a ring of radius 9 with a 2-wide stroke and a
 * pupil of radius 3.5 in a 32-unit box; these fractions are those proportions.
 */
function draw(size) {
  const margin = size * 0.08
  const radius = size * 0.22
  const centre = size / 2
  const ringOuter = size * 0.3
  const ringInner = size * 0.24
  const pupil = size * 0.105

  const px = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1)
    const bg = [0, 1, 2].map((i) => Math.round(PLATE_TOP[i] + (PLATE_BOTTOM[i] - PLATE_TOP[i]) * t))
    for (let x = 0; x < size; x++) {
      const plate = roundRect(x, y, margin, margin, size - margin, size - margin, radius)
      if (plate <= 0) continue

      const ring = Math.max(
        0,
        disc(x, y, centre, centre, ringOuter) - disc(x, y, centre, centre, ringInner),
      )
      const mark = Math.min(1, ring + disc(x, y, centre, centre, pupil))

      const i = (y * size + x) * 4
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(bg[c] + (ACCENT[c] - bg[c]) * mark)
      px[i + 3] = Math.round(plate * 255)
    }
  }
  return px
}

// 1024 first: it is build/icon.png as well as the largest of the set.
const SIZES = [1024, 512, 256, 128, 64, 48, 32, 24, 16]
const check = process.argv.includes('--check')
const iconsDir = join(root, 'build', 'icons')
if (!check) mkdirSync(iconsDir, { recursive: true })

// Hashed per size rather than over the set as a whole, so a mismatch names the
// drawing that moved. checkHash exits on the first one it finds.
for (const size of SIZES) {
  const px = draw(size)
  const hash = pixelHash(px)
  if (check) {
    checkHash(root, String(size), hash)
    continue
  }
  const png = encodePng(px, size)
  writeFileSync(join(iconsDir, `${size}x${size}.png`), png)
  if (size === 1024) writeFileSync(join(root, 'build', 'icon.png'), png)
  recordHash(root, String(size), hash)
}

if (!check) console.log(`wrote build/icon.png and build/icons/ (${SIZES.join(', ')})`)
