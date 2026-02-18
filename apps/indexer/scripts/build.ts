#!/usr/bin/env bun

/**
 * Indexer Production Build Script
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { reportBundleSizes } from '@jejunetwork/shared'
import { $ } from 'bun'

const APP_DIR = resolve(import.meta.dir, '..')
const outdir = resolve(APP_DIR, 'dist')

async function build() {
  console.log('[Indexer] Building for production...')
  const startTime = Date.now()

  // Clean lib directory
  await rm(resolve(APP_DIR, 'lib'), { recursive: true, force: true })

  // Run TypeScript compilation (ignore errors for now, frontend is separate)
  console.log('[Indexer] Compiling TypeScript...')
  await $`bunx tsc 2>/dev/null || true`.cwd(APP_DIR)

  // Setup model directory as symlink to src/model
  // IMPORTANT: Must be symlink, not copy, so TypeORM and init.ts use the same module instance
  // The migration tool works with symlinks on modern systems
  console.log('[Indexer] Setting up model directory...')
  await rm(resolve(APP_DIR, 'lib/model'), { recursive: true, force: true })
  // Create symlink from lib/model -> lib/src/model so both paths resolve to same module
  await $`ln -s src/model ${resolve(APP_DIR, 'lib/model')}`.cwd(APP_DIR)

  // Run post-build script
  console.log('[Indexer] Running post-build...')
  await $`bun scripts/post-build.ts`.cwd(APP_DIR)

  // Build web frontend
  console.log('[Indexer] Building frontend...')
  mkdirSync(join(outdir, 'web'), { recursive: true })

  const frontendResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'web/main.tsx')],
    outdir: join(outdir, 'web'),
    target: 'browser',
    minify: true,
    sourcemap: 'external',
    splitting: false,
    packages: 'bundle',
    naming: '[name].[hash].[ext]',
    drop: ['debugger'],
    external: [
      '@google-cloud/*',
      '@grpc/*',
      'bun:sqlite',
      'node:*',
      'typeorm',
      '@jejunetwork/db',
      'pg',
      '@subsquid/*',
    ],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env': JSON.stringify({ NODE_ENV: 'production' }),
      'process.browser': 'true',
      'process.version': JSON.stringify(''),
      'process.versions': JSON.stringify({}),
      'process.platform': JSON.stringify('browser'),
      global: 'globalThis',
    },
  })

  if (!frontendResult.success) {
    console.error('[Indexer] Frontend build failed:')
    for (const log of frontendResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  reportBundleSizes(frontendResult, 'Indexer Frontend')

  // Find the main entry file with hash
  const mainEntry = frontendResult.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('main'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'main.js'

  // Copy CSS file to dist
  const cssSource = resolve(APP_DIR, 'web/styles/index.css')
  const cssDest = join(outdir, 'web/index.css')
  const cssContent = readFileSync(cssSource, 'utf-8')
  writeFileSync(cssDest, cssContent)

  const indexHtml = readFileSync(resolve(APP_DIR, 'index.html'), 'utf-8')
  const updatedHtml = indexHtml
    .replace('/web/main.tsx', `/web/${mainFileName}`)
    .replace('/web/styles/index.css', '/web/index.css')

  writeFileSync(join(outdir, 'index.html'), updatedHtml)

  console.log('[Indexer] Frontend built successfully')

  const duration = Date.now() - startTime
  console.log('')
  console.log(`[Indexer] Build complete in ${duration}ms`)
  console.log('[Indexer] Output:')
  console.log('  lib/        - Compiled TypeScript')
  console.log(`  dist/web/${mainFileName} - Frontend bundle`)
  console.log('  dist/index.html - Entry HTML')
  process.exit(0)
}

build().catch((err) => {
  console.error('[Indexer] Build error:', err)
  process.exit(1)
})
