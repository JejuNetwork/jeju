#!/usr/bin/env bun
/**
 * Monitoring Production Build Script
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { reportBundleSizes } from '@jejunetwork/shared'

const APP_DIR = resolve(import.meta.dir, '..')
const outdir = resolve(APP_DIR, 'dist')

// Process shim to inject into browser bundles
const PROCESS_SHIM = `
if (typeof globalThis.process === 'undefined') {
  globalThis.process = {
    env: { NODE_ENV: 'production' },
    browser: true,
    version: '',
    versions: {},
    platform: 'browser',
    nextTick: (fn) => setTimeout(fn, 0),
    cwd: () => '/',
    stderr: { write: console.error },
    stdout: { write: console.log },
  };
}
`

async function build() {
  console.log('[Monitoring] Building for production...')
  const startTime = Date.now()

  // Clean dist directory
  await rm(outdir, { recursive: true, force: true })
  mkdirSync(join(outdir, 'api'), { recursive: true })
  mkdirSync(join(outdir, 'web'), { recursive: true })

  // Build API (for local Bun runtime)
  console.log('[Monitoring] Building API...')
  const apiResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'api/a2a.ts')],
    outdir: join(outdir, 'api'),
    target: 'bun',
    minify: true,
    sourcemap: 'external',
    drop: ['debugger'],
  })

  if (!apiResult.success) {
    console.error('[Monitoring] API build failed:')
    for (const log of apiResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  reportBundleSizes(apiResult, 'Monitoring API')
  console.log('[Monitoring] API built successfully')

  // Build Worker (for DWS/workerd deployment)
  console.log('[Monitoring] Building Worker...')
  const workerResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'api/worker.ts')],
    outdir: join(outdir, 'api'),
    target: 'browser', // workerd uses browser-compatible bundles
    minify: true,
    sourcemap: 'external',
    drop: ['debugger'],
    naming: 'worker.[ext]',
    external: ['node:*'],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  })

  if (!workerResult.success) {
    console.error('[Monitoring] Worker build failed:')
    for (const log of workerResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  reportBundleSizes(workerResult, 'Monitoring Worker')
  console.log('[Monitoring] Worker built successfully')

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
    drop: ['debugger'],
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
  reportBundleSizes(frontendResult, 'Monitoring Frontend')
  console.log('[Monitoring] Frontend built successfully')

  // Find the main entry file with hash
  const mainEntry = frontendResult.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('main'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'main.js'
  const mainFilePath = mainEntry?.path ?? join(outdir, 'web', mainFileName)

  const cssEntry = frontendResult.outputs.find((o) => o.path.endsWith('.css'))
  const cssFileName = cssEntry ? cssEntry.path.split('/').pop() : null

  // Inject process shim at the start of the main bundle
  console.log('[Monitoring] Injecting process shim...')
  const mainContent = readFileSync(mainFilePath, 'utf-8')
  writeFileSync(mainFilePath, PROCESS_SHIM + mainContent)

  // Copy and process globals.css (remove Tailwind directives that CDN handles)
  console.log('[Monitoring] Processing globals.css...')
  const globalsCss = readFileSync(resolve(APP_DIR, 'web/globals.css'), 'utf-8')
  const processedCss = globalsCss
    .replace(/@tailwind base;/g, '/* Tailwind base loaded via CDN */')
    .replace(
      /@tailwind components;/g,
      '/* Tailwind components loaded via CDN */',
    )
    .replace(/@tailwind utilities;/g, '/* Tailwind utilities loaded via CDN */')
    .replace(
      /@apply\s+([^;]+);/g,
      '/* @apply $1 - processed by Tailwind CDN */',
    )
    .replace(/@layer\s+(\w+)\s*\{/g, '/* @layer $1 { */')
  writeFileSync(join(outdir, 'web', 'globals.css'), processedCss)

  // Create favicon SVG
  console.log('[Monitoring] Creating favicon...')
  const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#FF6B35"/>
      <stop offset="100%" style="stop-color:#7C3AED"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="45" fill="url(#g)"/>
  <path d="M30 50 L45 65 L70 35" stroke="white" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`
  writeFileSync(join(outdir, 'favicon.svg'), faviconSvg)

  // Update index.html with correct paths
  let indexHtml = readFileSync(resolve(APP_DIR, 'index.html'), 'utf-8')
  indexHtml = indexHtml
    .replace('./web/main.tsx', `/web/${mainFileName}`)
    .replace('./web/globals.css', '/web/globals.css')

  // Add favicon link if not present
  if (!indexHtml.includes('favicon')) {
    indexHtml = indexHtml.replace(
      '</head>',
      '  <link rel="icon" type="image/svg+xml" href="/favicon.svg">\n  </head>',
    )
  }

  if (cssFileName) {
    indexHtml = indexHtml.replace(
      '</head>',
      `  <link rel="stylesheet" href="/web/${cssFileName}">\n  </head>`,
    )
  }

  writeFileSync(join(outdir, 'index.html'), indexHtml)

  const duration = Date.now() - startTime
  console.log('')
  console.log(`[Monitoring] Build complete in ${duration}ms`)
  console.log('[Monitoring] Output:')
  console.log('  dist/api/a2a.js      - API server')
  console.log(`  dist/web/${mainFileName} - Frontend bundle`)
  console.log('  dist/index.html      - Entry HTML')
  process.exit(0)
}

build().catch((err) => {
  console.error('[Monitoring] Build error:', err)
  process.exit(1)
})
