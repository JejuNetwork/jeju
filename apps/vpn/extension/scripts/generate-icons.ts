/**
 * Generate extension icons from SVG
 * Uses sharp to create PNG icons in multiple sizes
 */

import { writeFileSync } from 'node:fs'

// Icon SVG (shield with lock)
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">
  <defs>
    <linearGradient id="shield-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00ff88"/>
      <stop offset="100%" stop-color="#00cc66"/>
    </linearGradient>
  </defs>
  <path d="M64 8L16 28v36c0 32 48 56 48 56s48-24 48-56V28L64 8z" 
        fill="url(#shield-gradient)" opacity="0.2"/>
  <path d="M64 8L16 28v36c0 32 48 56 48 56s48-24 48-56V28L64 8z" 
        stroke="#00ff88" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="48" y="52" width="32" height="28" rx="4" 
        stroke="#00ff88" stroke-width="5" stroke-linecap="round"/>
  <path d="M54 52V44c0-5.523 4.477-10 10-10s10 4.477 10 10v8" 
        stroke="#00ff88" stroke-width="5" stroke-linecap="round"/>
  <circle cx="64" cy="64" r="4" fill="#00ff88"/>
</svg>`

const sizes = [16, 32, 48, 128]

async function main() {
  // Check if sharp is available
  let sharp: typeof import('sharp')
  try {
    sharp = (await import('sharp')).default
  } catch {
    console.log('sharp not available, writing placeholder icons')

    // Write SVG as fallback for each size
    for (const size of sizes) {
      const svgWithSize = SVG.replace(
        'viewBox="0 0 128 128"',
        `viewBox="0 0 128 128" width="${size}" height="${size}"`,
      )
      writeFileSync(`icons/icon${size}.svg`, svgWithSize)
      console.log(`Generated icons/icon${size}.svg`)
    }

    console.log('\nTo generate PNG icons, install sharp: bun add -d sharp')
    console.log('Then run: bun scripts/generate-icons.ts')
    return
  }

  const svgBuffer = Buffer.from(SVG)

  for (const size of sizes) {
    const pngBuffer = await sharp(svgBuffer).resize(size, size).png().toBuffer()

    writeFileSync(`icons/icon${size}.png`, pngBuffer)
    console.log(`Generated icons/icon${size}.png`)
  }

  console.log('\nAll icons generated successfully.')
}

main().catch(console.error)
