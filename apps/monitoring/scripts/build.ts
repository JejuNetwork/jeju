#!/usr/bin/env bun
/**
 * Monitoring Production Build Script
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const APP_DIR = resolve(import.meta.dir, '..')
const outdir = resolve(APP_DIR, 'dist')

async function build() {
  console.log('[Monitoring] Building for production...')
  const startTime = Date.now()

  // Clean dist directory
  await rm(outdir, { recursive: true, force: true })
  mkdirSync(join(outdir, 'api'), { recursive: true })
  mkdirSync(join(outdir, 'web'), { recursive: true })

  // Build API
  console.log('[Monitoring] Building API...')
  const apiResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'api/a2a.ts')],
    outdir: join(outdir, 'api'),
    target: 'bun',
    minify: true,
    sourcemap: 'external',
  })

  if (!apiResult.success) {
    console.error('[Monitoring] API build failed:')
    for (const log of apiResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  console.log('[Monitoring] API built successfully')

  // Build frontend
  console.log('[Monitoring] Building frontend...')
  const frontendResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'web/main.tsx')],
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
    console.error('[Monitoring] Frontend build failed:')
    for (const log of frontendResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  console.log('[Monitoring] Frontend built successfully')

  // Find the main entry file with hash
  const mainEntry = frontendResult.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('main'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'main.js'

  const cssEntry = frontendResult.outputs.find((o) => o.path.endsWith('.css'))
  const cssFileName = cssEntry ? cssEntry.path.split('/').pop() : null

  const indexHtml = readFileSync(resolve(APP_DIR, 'index.html'), 'utf-8')
  let updatedHtml = indexHtml.replace('/web/main.tsx', `/web/${mainFileName}`)

  if (cssFileName) {
    updatedHtml = updatedHtml.replace(
      '</head>',
      `  <link rel="stylesheet" href="/web/${cssFileName}">\n  </head>`,
    )
  }

  writeFileSync(join(outdir, 'index.html'), updatedHtml)

  const duration = Date.now() - startTime
  console.log('')
  console.log(`[Monitoring] Build complete in ${duration}ms`)
  console.log('[Monitoring] Output:')
  console.log('  dist/api/a2a.js      - API server')
  console.log(`  dist/web/${mainFileName} - Frontend bundle`)
  console.log('  dist/index.html      - Entry HTML')
}

build().catch((err) => {
  console.error('[Monitoring] Build error:', err)
  process.exit(1)
})
