#!/usr/bin/env bun
/**
 * Otto Production Build Script
 */

import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const APP_DIR = resolve(import.meta.dir, '..')
const outdir = resolve(APP_DIR, 'dist')

async function build() {
  console.log('[Otto] Building for production...')
  const startTime = Date.now()

  // Clean dist directory
  await rm(outdir, { recursive: true, force: true })
  await mkdir(outdir, { recursive: true })

  // Build server
  console.log('[Otto] Building server...')
  const serverResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'api/server.ts')],
    outdir,
    target: 'bun',
    minify: true,
    sourcemap: 'external',
    naming: 'server.js',
  })

  if (!serverResult.success) {
    console.error('[Otto] Server build failed:')
    for (const log of serverResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  console.log('[Otto] Server built successfully')

  // Build main index
  console.log('[Otto] Building main index...')
  const indexResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'api/index.ts')],
    outdir,
    target: 'bun',
    minify: true,
    sourcemap: 'external',
    naming: 'index.js',
  })

  if (!indexResult.success) {
    console.error('[Otto] Index build failed:')
    for (const log of indexResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  console.log('[Otto] Index built successfully')

  const duration = Date.now() - startTime
  console.log('')
  console.log(`[Otto] Build complete in ${duration}ms`)
  console.log('[Otto] Output:')
  console.log('  dist/server.js - Main server')
  console.log('  dist/index.js  - Library entry')
}

build().catch((err) => {
  console.error('[Otto] Build error:', err)
  process.exit(1)
})
