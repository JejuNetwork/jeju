#!/usr/bin/env bun
/**
 * Otto Production Build Script
 */

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { reportBundleSizes } from '@jejunetwork/shared'

const APP_DIR = resolve(import.meta.dir, '..')
const outdir = resolve(APP_DIR, 'dist')
const webOutdir = resolve(outdir, 'web')
const workerOutdir = resolve(outdir, 'worker')

async function build() {
  console.log('[Otto] Building for production...')
  const startTime = Date.now()

  // Clean dist directory
  await rm(outdir, { recursive: true, force: true })
  await mkdir(outdir, { recursive: true })
  await mkdir(webOutdir, { recursive: true })
  await mkdir(workerOutdir, { recursive: true })

  // Build frontend
  console.log('[Otto] Building frontend...')
  const webEntrypoint = resolve(APP_DIR, 'web/main.tsx')

  if (existsSync(webEntrypoint)) {
    const webResult = await Bun.build({
      entrypoints: [webEntrypoint],
      outdir: webOutdir,
      target: 'browser',
      minify: true,
      sourcemap: 'external',
      splitting: false,
      packages: 'bundle',
      drop: ['debugger'],
      naming: {
        entry: '[name]-[hash].js',
        chunk: 'chunks/[name]-[hash].js',
        asset: 'assets/[name]-[hash].[ext]',
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    })

    if (!webResult.success) {
      console.error('[Otto] Frontend build failed:')
      for (const log of webResult.logs) {
        console.error(log)
      }
      process.exit(1)
    }

    reportBundleSizes(webResult, 'Otto Frontend')

    // Find the main entry file
    const mainEntry = webResult.outputs.find(
      (o) => o.kind === 'entry-point' && o.path.includes('main'),
    )
    const mainFileName = mainEntry?.path.split('/').pop() ?? 'main.js'

    // Copy and update index.html
    const indexHtml = await readFile(resolve(APP_DIR, 'index.html'), 'utf-8')
    const updatedHtml = indexHtml.replace('/web/main.tsx', `/${mainFileName}`)
    await writeFile(resolve(webOutdir, 'index.html'), updatedHtml)

    // Copy CSS if exists
    const cssPath = resolve(APP_DIR, 'web/globals.css')
    if (existsSync(cssPath)) {
      await copyFile(cssPath, resolve(webOutdir, 'globals.css'))
    }

    console.log('[Otto] Frontend built successfully')
  } else {
    console.log('[Otto] No frontend entry found, skipping')
  }

  // Build server
  console.log('[Otto] Building server...')
  const serverResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'api/server.ts')],
    outdir,
    target: 'bun',
    minify: true,
    sourcemap: 'external',
    drop: ['debugger'],
    naming: 'server.js',
  })

  if (!serverResult.success) {
    console.error('[Otto] Server build failed:')
    for (const log of serverResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  reportBundleSizes(serverResult, 'Otto Server')
  console.log('[Otto] Server built successfully')

  // Build main index
  console.log('[Otto] Building main index...')
  const indexResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'api/index.ts')],
    outdir,
    target: 'bun',
    minify: true,
    sourcemap: 'external',
    drop: ['debugger'],
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

  // Build worker
  const workerEntry = resolve(APP_DIR, 'api/worker.ts')
  if (existsSync(workerEntry)) {
    console.log('[Otto] Building worker...')
    const workerResult = await Bun.build({
      entrypoints: [workerEntry],
      outdir: workerOutdir,
      target: 'bun',
      minify: true,
      sourcemap: 'external',
      drop: ['debugger'],
      naming: 'worker.js',
    })

    if (!workerResult.success) {
      console.error('[Otto] Worker build failed:')
      for (const log of workerResult.logs) {
        console.error(log)
      }
      process.exit(1)
    }
  } else {
    console.log('[Otto] No worker.ts found, skipping worker build')
  }

  // Create worker metadata
  const metadata = {
    name: 'otto-api',
    version: '1.0.0',
    entrypoint: 'worker.js',
    compatibilityDate: new Date().toISOString().split('T')[0],
    buildTime: new Date().toISOString(),
  }
  await writeFile(
    resolve(workerOutdir, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
  )
  console.log('[Otto] Worker built successfully')

  const duration = Date.now() - startTime
  console.log('')
  console.log(`[Otto] Build complete in ${duration}ms`)
  console.log('[Otto] Output:')
  console.log('  dist/web/         - Frontend static files')
  console.log('  dist/server.js    - Main server')
  console.log('  dist/index.js     - Library entry')
  console.log('  dist/worker/      - Worker bundle')
  process.exit(0)
}

build().catch((err) => {
  console.error('[Otto] Build error:', err)
  process.exit(1)
})
