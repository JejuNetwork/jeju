#!/usr/bin/env bun

/**
 * Indexer Production Build Script
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { $ } from 'bun'

const APP_DIR = resolve(import.meta.dir, '..')
const outdir = resolve(APP_DIR, 'dist')

async function build() {
  console.log('[Indexer] Building for production...')
  const startTime = Date.now()

  // Clean lib directory
  await rm(resolve(APP_DIR, 'lib'), { recursive: true, force: true })

  // Run pre-build script
  console.log('[Indexer] Running pre-build...')
  await $`bun scripts/pre-build.ts`.cwd(APP_DIR)

  // Run TypeScript compilation
  console.log('[Indexer] Compiling TypeScript...')
  await $`bunx tsc`.cwd(APP_DIR)

  // Setup model symlink
  console.log('[Indexer] Setting up model symlink...')
  await rm(resolve(APP_DIR, 'lib/model'), { recursive: true, force: true })
  await $`ln -s ${resolve(APP_DIR, 'src/model')} ${resolve(APP_DIR, 'lib/model')}`

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
      'process.browser': 'true',
    },
  })

  if (!frontendResult.success) {
    console.error('[Indexer] Frontend build failed:')
    for (const log of frontendResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Find the main entry file with hash
  const mainEntry = frontendResult.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('main'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'main.js'

  const indexHtml = readFileSync(resolve(APP_DIR, 'index.html'), 'utf-8')
  const updatedHtml = indexHtml
    .replace('/web/main.tsx', `/dist/web/${mainFileName}`)
    .replace('/web/styles/index.css', '/dist/web/index.css')

  writeFileSync(join(outdir, 'index.html'), updatedHtml)

  console.log('[Indexer] Frontend built successfully')

  const duration = Date.now() - startTime
  console.log('')
  console.log(`[Indexer] Build complete in ${duration}ms`)
  console.log('[Indexer] Output:')
  console.log('  lib/        - Compiled TypeScript')
  console.log(`  dist/web/${mainFileName} - Frontend bundle`)
  console.log('  dist/index.html - Entry HTML')
}

build().catch((err) => {
  console.error('[Indexer] Build error:', err)
  process.exit(1)
})
