/**
 * Generate extension icons as SVG-based PNG placeholders
 * Run: bun scripts/generate-icons.ts
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ICONS_DIR = join(import.meta.dir, '../public/icons')

if (!existsSync(ICONS_DIR)) {
  mkdirSync(ICONS_DIR, { recursive: true })
}

// Create simple SVG icons for different sizes
const sizes = [16, 32, 48, 128]

const createSvgIcon = (size: number): string => {
  const padding = Math.round(size * 0.1)
  const innerSize = size - padding * 2
  const fontSize = Math.round(innerSize * 0.6)
  const radius = Math.round(size * 0.15)

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366f1;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect x="${padding}" y="${padding}" width="${innerSize}" height="${innerSize}" rx="${radius}" ry="${radius}" fill="url(#grad)"/>
  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold" font-size="${fontSize}">J</text>
</svg>`
}

// For browsers, we need actual PNG files
// Since we can't use canvas in Bun directly without extra deps,
// we'll create SVG files and note that they should be converted to PNG
// In production, you'd use sharp or canvas

for (const size of sizes) {
  const svg = createSvgIcon(size)
  const svgPath = join(ICONS_DIR, `icon${size}.svg`)
  writeFileSync(svgPath, svg)
  console.log(`Created ${svgPath}`)

  // Create a simple PNG placeholder (1x1 purple pixel)
  // In real usage, convert SVG to PNG with sharp
  const pngPath = join(ICONS_DIR, `icon${size}.png`)

  // Simple PNG (purple square) - this is a minimal valid PNG
  // In production, use sharp to convert SVG to PNG
  const pngData = createMinimalPng(size)
  writeFileSync(pngPath, pngData)
  console.log(`Created ${pngPath}`)
}

function createMinimalPng(size: number): Buffer {
  // Create a minimal PNG with purple gradient
  // This is a simplified approach - in production use sharp
  const width = size
  const height = size

  // PNG signature
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ])

  // IHDR chunk
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData.writeUInt8(8, 8) // bit depth
  ihdrData.writeUInt8(2, 9) // color type (RGB)
  ihdrData.writeUInt8(0, 10) // compression
  ihdrData.writeUInt8(0, 11) // filter
  ihdrData.writeUInt8(0, 12) // interlace

  const ihdr = createChunk('IHDR', ihdrData)

  // Create image data (purple gradient)
  const rawData: number[] = []
  for (let y = 0; y < height; y++) {
    rawData.push(0) // filter byte
    for (let x = 0; x < width; x++) {
      // Gradient from #6366f1 to #8b5cf6
      const t = (x + y) / (width + height)
      const r = Math.round(99 + t * (139 - 99))
      const g = Math.round(102 + t * (92 - 102))
      const b = Math.round(241 + t * (246 - 241))
      rawData.push(r, g, b)
    }
  }

  // Compress with zlib (deflate)
  const { deflateSync } = require('node:zlib')
  const compressed = deflateSync(Buffer.from(rawData))
  const idat = createChunk('IDAT', compressed)

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdr, idat, iend])
}

function createChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)

  const typeBuffer = Buffer.from(type)
  const crc = crc32(Buffer.concat([typeBuffer, data]))

  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc, 0)

  return Buffer.concat([length, typeBuffer, data, crcBuffer])
}

function crc32(data: Buffer): number {
  const { crc32 } = require('node:zlib')
  return crc32(data)
}

console.log('Icons generated successfully.')
console.log(
  'Note: For production, convert SVG files to high-quality PNGs using sharp.',
)
