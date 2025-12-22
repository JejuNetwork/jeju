#!/usr/bin/env bun
/**
 * Web Build Script
 *
 * Builds the wallet web app with proper Tailwind CSS processing.
 */

import { resolve } from 'node:path'
import type { BunPlugin } from 'bun'
import tw from 'bun-plugin-tailwind'

const ROOT = resolve(import.meta.dir, '..')
const isProduction = process.env.NODE_ENV === 'production'

const tailwindPlugin: BunPlugin = tw

console.log('Building wallet web app...')

const result = await Bun.build({
  entrypoints: [resolve(ROOT, 'index.html')],
  outdir: resolve(ROOT, 'dist'),
  minify: isProduction,
  sourcemap: isProduction ? 'none' : 'linked',
  target: 'browser',
  plugins: [tailwindPlugin],
  define: {
    'process.env.NODE_ENV': JSON.stringify(
      isProduction ? 'production' : 'development',
    ),
  },
})

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log('Build succeeded:')
for (const output of result.outputs) {
  const size =
    output.size > 1024 * 1024
      ? `${(output.size / (1024 * 1024)).toFixed(2)} MB`
      : `${(output.size / 1024).toFixed(2)} KB`
  console.log(`  ${output.path.replace(`${ROOT}/`, '')} - ${size}`)
}
