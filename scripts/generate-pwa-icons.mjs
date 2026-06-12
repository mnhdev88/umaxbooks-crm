// Generates the PWA icon set in public/ from app/icon.svg.
// Run: node scripts/generate-pwa-icons.mjs
import sharp from 'sharp'
import { readFileSync } from 'node:fs'

const svg = readFileSync(new URL('../app/icon.svg', import.meta.url))
const BG = '#080f1e'

// Standard icons — the SVG's own rounded-rect background, transparent corners.
await sharp(svg, { density: 300 }).resize(192, 192).png().toFile('public/icon-192.png')
await sharp(svg, { density: 300 }).resize(512, 512).png().toFile('public/icon-512.png')

// Maskable: full-bleed background with the logo inside the ~80% safe zone.
const logo = await sharp(svg, { density: 300 }).resize(358, 358).png().toBuffer()
await sharp({ create: { width: 512, height: 512, channels: 4, background: BG } })
  .composite([{ input: logo, gravity: 'center' }])
  .png()
  .toFile('public/icon-512-maskable.png')

// Apple touch icon: 180px, opaque (iOS rounds the corners itself).
const logo180 = await sharp(svg, { density: 300 }).resize(150, 150).png().toBuffer()
await sharp({ create: { width: 180, height: 180, channels: 4, background: BG } })
  .composite([{ input: logo180, gravity: 'center' }])
  .flatten({ background: BG })
  .png()
  .toFile('public/apple-touch-icon.png')

// Monochrome badge for Android notification tray (white glyph on transparent).
const badgeSrc = readFileSync(new URL('../app/icon.svg', import.meta.url), 'utf8')
  .replace(/stroke="url\(#g\)"/, 'stroke="#ffffff"')
  .replace(/<rect[^/]*\/>/, '')
await sharp(Buffer.from(badgeSrc), { density: 300 }).resize(96, 96).png().toFile('public/badge-96.png')

console.log('PWA icons written to public/')
