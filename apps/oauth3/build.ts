/**
 * Build script for auth app
 */

import { $ } from 'bun'

async function build() {
  console.log('Building auth app...')

  // Build API
  await Bun.build({
    entrypoints: ['./api/index.ts'],
    outdir: './dist/api',
    target: 'bun',
    minify: true,
  })

  // Build web frontend
  await Bun.build({
    entrypoints: ['./web/app.ts'],
    outdir: './dist/web',
    target: 'browser',
    minify: true,
  })

  // Copy HTML
  await $`cp web/index.html dist/web/index.html`

  // Copy manifest
  await $`cp jeju-manifest.json dist/jeju-manifest.json`

  console.log('Build complete.')
}

build()
