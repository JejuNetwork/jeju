#!/usr/bin/env bun
/**
 * OAuth3 Production Build Script
 *
 * Builds both API and frontend for production deployment:
 * - API: Bundled for Bun runtime
 * - Frontend: Minified browser bundle
 */

import { copyFile, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const APP_DIR = resolve(import.meta.dir, '..')

async function build() {
  console.log('[OAuth3] Building for production...')
  const startTime = Date.now()

  // Clean dist directory
  await rm(resolve(APP_DIR, 'dist'), { recursive: true, force: true })
  await mkdir(resolve(APP_DIR, 'dist/api'), { recursive: true })
  await mkdir(resolve(APP_DIR, 'dist/web'), { recursive: true })

  // Build API
  console.log('[OAuth3] Building API...')
  const apiResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'api/index.ts')],
    outdir: resolve(APP_DIR, 'dist/api'),
    target: 'bun',
    minify: true,
    sourcemap: 'external',
  })

  if (!apiResult.success) {
    console.error('[OAuth3] API build failed:')
    for (const log of apiResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  console.log('[OAuth3] API built successfully')

  // Build worker entrypoint (for DWS deployment)
  console.log('[OAuth3] Building worker...')
  const workerResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'api/worker.ts')],
    outdir: resolve(APP_DIR, 'dist/api'),
    target: 'bun',
    minify: true,
    sourcemap: 'external',
  })

  if (!workerResult.success) {
    console.error('[OAuth3] Worker build failed:')
    for (const log of workerResult.logs) {
      console.error(log)
    }
    // Non-fatal - worker is optional for DWS
    console.warn('[OAuth3] Worker build failed, continuing...')
  } else {
    console.log('[OAuth3] Worker built successfully')
  }

  // Build frontend
  console.log('[OAuth3] Building frontend...')
  const frontendResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'web/app.ts')],
    outdir: resolve(APP_DIR, 'dist/web'),
    target: 'browser',
    minify: true,
    sourcemap: 'external',
  })

  if (!frontendResult.success) {
    console.error('[OAuth3] Frontend build failed:')
    for (const log of frontendResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  console.log('[OAuth3] Frontend built successfully')

  // Copy static files
  await copyFile(
    resolve(APP_DIR, 'web/index.html'),
    resolve(APP_DIR, 'dist/web/index.html'),
  )
  await copyFile(
    resolve(APP_DIR, 'jeju-manifest.json'),
    resolve(APP_DIR, 'dist/jeju-manifest.json'),
  )

  const duration = Date.now() - startTime
  console.log('')
  console.log(`[OAuth3] Build complete in ${duration}ms`)
  console.log('[OAuth3] Output:')
  console.log('  dist/api/index.js    - API server')
  console.log('  dist/api/worker.js   - DWS worker (if successful)')
  console.log('  dist/web/            - Frontend assets')
}

build().catch((err) => {
  console.error('[OAuth3] Build error:', err)
  process.exit(1)
})
