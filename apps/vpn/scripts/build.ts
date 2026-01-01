#!/usr/bin/env bun
/**
 * VPN Production Build Script
 *
 * Builds API, frontend (dashboard), and lander for production deployment.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const APP_DIR = resolve(import.meta.dir, '..')
const outdir = resolve(APP_DIR, 'dist')

async function build() {
  console.log('[VPN] Building for production...')
  const startTime = Date.now()

  // Clean dist directory
  await rm(outdir, { recursive: true, force: true })
  mkdirSync(join(outdir, 'api'), { recursive: true })
  mkdirSync(join(outdir, 'web'), { recursive: true })
  mkdirSync(join(outdir, 'lander'), { recursive: true })

  // Build API
  console.log('[VPN] Building API...')
  const apiResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'api/index.ts')],
    outdir: join(outdir, 'api'),
    target: 'bun',
    minify: true,
    sourcemap: 'external',
  })

  if (!apiResult.success) {
    console.error('[VPN] API build failed:')
    for (const log of apiResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  console.log('[VPN] API built successfully')

  // Build frontend (dashboard)
  console.log('[VPN] Building frontend...')
  const frontendResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'web/main.tsx')],
    outdir: join(outdir, 'web'),
    target: 'browser',
    minify: true,
    sourcemap: 'external',
    splitting: false,
    packages: 'bundle',
    naming: '[name].[hash].[ext]',
    external: ['bun:sqlite', 'node:*', '@tauri-apps/*'],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.browser': 'true',
    },
  })

  if (!frontendResult.success) {
    console.error('[VPN] Frontend build failed:')
    for (const log of frontendResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  console.log('[VPN] Frontend built successfully')

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

  // Build lander
  const landerEntry = resolve(APP_DIR, 'lander/main.tsx')
  if (existsSync(landerEntry)) {
    console.log('[VPN] Building lander...')
    const landerResult = await Bun.build({
      entrypoints: [landerEntry],
      outdir: join(outdir, 'lander'),
      target: 'browser',
      minify: true,
      sourcemap: 'external',
      splitting: false,
      packages: 'bundle',
      naming: '[name].[hash].[ext]',
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    })

    if (!landerResult.success) {
      console.error('[VPN] Lander build failed:')
      for (const log of landerResult.logs) {
        console.error(log)
      }
      process.exit(1)
    }

    // Find the main lander entry
    const landerMainEntry = landerResult.outputs.find(
      (o) => o.kind === 'entry-point' && o.path.includes('main'),
    )
    const landerMainFileName = landerMainEntry ? landerMainEntry.path.split('/').pop() : 'main.js'

    // Copy and update lander index.html
    const landerHtml = readFileSync(resolve(APP_DIR, 'lander/index.html'), 'utf-8')
    const updatedLanderHtml = landerHtml.replace('/main.tsx', `/${landerMainFileName}`)
    writeFileSync(join(outdir, 'lander', 'index.html'), updatedLanderHtml)

    console.log('[VPN] Lander built successfully')
  }

  const duration = Date.now() - startTime
  console.log('')
  console.log(`[VPN] Build complete in ${duration}ms`)
  console.log('[VPN] Output:')
  console.log('  dist/api/index.js    - API server')
  console.log(`  dist/web/${mainFileName} - Frontend bundle`)
  console.log('  dist/index.html      - Dashboard entry')
  if (existsSync(landerEntry)) {
    console.log('  dist/lander/         - Landing page')
  }
}

build().catch((err) => {
  console.error('[VPN] Build error:', err)
  process.exit(1)
})
