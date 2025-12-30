#!/usr/bin/env bun
/**
 * Example Production Build Script
 */

import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const APP_DIR = resolve(import.meta.dir, '..')
const outdir = resolve(APP_DIR, 'dist')

async function build() {
  console.log('[Example] Building for production...')
  const startTime = Date.now()

  // Clean dist directory
  await rm(outdir, { recursive: true, force: true })
  await mkdir(join(outdir, 'api'), { recursive: true })
  await mkdir(join(outdir, 'web'), { recursive: true })

  // Build API
  console.log('[Example] Building API...')
  const apiResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'api/index.ts')],
    outdir: join(outdir, 'api'),
    target: 'bun',
    minify: true,
    sourcemap: 'external',
  })

  if (!apiResult.success) {
    console.error('[Example] API build failed:')
    for (const log of apiResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  console.log('[Example] API built successfully')

  // Build frontend
  console.log('[Example] Building frontend...')
  const frontendResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'web/app.ts')],
    outdir: join(outdir, 'web'),
    target: 'browser',
    minify: true,
    sourcemap: 'external',
    splitting: false,
    packages: 'bundle',
    naming: '[name].[hash].[ext]',
    external: ['bun:sqlite', 'node:*', 'elysia', '@elysiajs/*'],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.browser': 'true',
    },
  })

  if (!frontendResult.success) {
    console.error('[Example] Frontend build failed:')
    for (const log of frontendResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  console.log('[Example] Frontend built successfully')

  // Find the main entry file with hash
  const mainEntry = frontendResult.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('main'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'main.js'

  const indexHtml = await readFile(resolve(APP_DIR, 'web/index.html'), 'utf-8')
  const updatedHtml = indexHtml.replace('/main.ts', `/web/${mainFileName}`)

  await writeFile(join(outdir, 'index.html'), updatedHtml)

  const duration = Date.now() - startTime
  console.log('')
  console.log(`[Example] Build complete in ${duration}ms`)
  console.log('[Example] Output:')
  console.log('  dist/api/index.js    - API server')
  console.log(`  dist/web/${mainFileName} - Frontend bundle`)
  console.log('  dist/index.html      - Entry HTML')
}

build().catch((err) => {
  console.error('[Example] Build error:', err)
  process.exit(1)
})
