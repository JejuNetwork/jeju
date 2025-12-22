#!/usr/bin/env bun
/**
 * Generate app icons for all platforms
 * Requires: sharp (optional, falls back to placeholders)
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const ICON_SVG = `<svg width="SIZE" height="SIZE" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#10B981"/>
      <stop offset="100%" style="stop-color:#0D9488"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#grad)"/>
  <text x="256" y="340" font-size="280" text-anchor="middle" fill="white" font-family="system-ui,-apple-system,sans-serif" font-weight="bold">J</text>
</svg>`

const TAURI_ICONS_DIR = join(import.meta.dir, '../src-tauri/icons')

// Minimal 1x1 green PNG as placeholder (base64)
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function main() {
  // Ensure directories exist
  if (!existsSync(TAURI_ICONS_DIR)) {
    mkdirSync(TAURI_ICONS_DIR, { recursive: true })
  }

  const sizes = [
    { name: '32x32.png', size: 32 },
    { name: '128x128.png', size: 128 },
    { name: '128x128@2x.png', size: 256 },
  ]

  const svgBuffer = Buffer.from(ICON_SVG.replace(/SIZE/g, '512'))

  for (const { name, size } of sizes) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(join(TAURI_ICONS_DIR, name))
    console.log(`Generated ${name}`)
  }

  // Generate icon.png for general use
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(join(TAURI_ICONS_DIR, 'icon.png'))
  console.log('Generated icon.png')

  // Generate ICO for Windows (multi-size)
  const icoSizes = [16, 32, 48, 256]
  const icoBuffers = await Promise.all(
    icoSizes.map((size) =>
      sharp(svgBuffer).resize(size, size).png().toBuffer(),
    ),
  )

  // Write ico file (simplified - actual ICO requires proper header)
  writeFileSync(join(TAURI_ICONS_DIR, 'icon.ico'), icoBuffers[1]) // Use 32x32 for now
  console.log('Generated icon.ico (placeholder)')

  // For ICNS, we need macOS tools - create placeholder
  writeFileSync(join(TAURI_ICONS_DIR, 'icon.icns'), PLACEHOLDER_PNG)
  console.log(
    'Generated icon.icns (placeholder - generate with iconutil on macOS)',
  )

  console.log('Icons generated successfully!')
}

main().catch(console.error)
