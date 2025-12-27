/**
 * Crucible Production Build
 *
 * Builds frontend and API for deployment.
 * CSS is processed inline using Tailwind CLI.
 *
 * Usage:
 *   bun run scripts/build.ts
 *   jeju build --app crucible
 */

import { existsSync } from 'node:fs'
import { mkdir, rm, cp } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BunPlugin } from 'bun'

const DIST_DIR = './dist'
const WEB_DIR = `${DIST_DIR}/web`
const API_DIR = `${DIST_DIR}/api`

// Browser plugin for shimming and deduplication
const browserPlugin: BunPlugin = {
  name: 'browser-plugin',
  setup(build) {
    // Shim pino
    build.onResolve({ filter: /^pino(-pretty)?$/ }, () => ({
      path: resolve('./scripts/shims/pino.ts'),
    }))

    // Dedupe React
    const reactPath = require.resolve('react')
    const reactDomPath = require.resolve('react-dom')
    build.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }))
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: require.resolve('react/jsx-runtime') }))
    build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({ path: require.resolve('react/jsx-dev-runtime') }))
    build.onResolve({ filter: /^react-dom$/ }, () => ({ path: reactDomPath }))
    build.onResolve({ filter: /^react-dom\/client$/ }, () => ({ path: require.resolve('react-dom/client') }))

    // Resolve workspace packages
    build.onResolve({ filter: /^@jejunetwork\/shared$/ }, () => ({ path: resolve('../../packages/shared/src/index.ts') }))
    build.onResolve({ filter: /^@jejunetwork\/types$/ }, () => ({ path: resolve('../../packages/types/src/index.ts') }))
    build.onResolve({ filter: /^@jejunetwork\/sdk$/ }, () => ({ path: resolve('../../packages/sdk/src/index.ts') }))
    build.onResolve({ filter: /^@jejunetwork\/config$/ }, () => ({ path: resolve('../../packages/config/index.ts') }))
  },
}

const BROWSER_EXTERNALS = [
  'bun:sqlite', 'child_process', 'http2', 'tls', 'dgram', 'fs', 'net', 'dns', 'stream', 'crypto', 'module', 'worker_threads',
  'node:url', 'node:fs', 'node:path', 'node:crypto', 'node:events', 'node:module', 'node:worker_threads',
  '@jejunetwork/deployment', '@jejunetwork/db', '@jejunetwork/kms', 'elysia', '@elysiajs/*', 'ioredis', 'pino', 'pino-pretty',
]

async function buildCSS(): Promise<void> {
  console.log('  Building CSS...')
  const proc = Bun.spawn(
    ['bunx', 'tailwindcss', '-i', './web/globals.css', '-o', `${WEB_DIR}/globals.css`, '--minify'],
    { stdout: 'pipe', stderr: 'pipe', cwd: process.cwd() },
  )

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`Tailwind CSS build failed: ${stderr}`)
  }
}

async function buildFrontend(): Promise<void> {
  console.log('Building frontend...')

  await mkdir(WEB_DIR, { recursive: true })

  const result = await Bun.build({
    entrypoints: ['./web/client.tsx'],
    outdir: WEB_DIR,
    target: 'browser',
    splitting: true,
    packages: 'bundle',
    minify: true,
    sourcemap: 'external',
    external: BROWSER_EXTERNALS,
    plugins: [browserPlugin],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.browser': 'true',
    },
    naming: { entry: '[name]-[hash].js', chunk: 'chunks/[name]-[hash].js', asset: 'assets/[name]-[hash].[ext]' },
  })

  if (!result.success) {
    console.error('Frontend build failed:')
    for (const log of result.logs) console.error(log)
    throw new Error('Frontend build failed')
  }

  const mainEntry = result.outputs.find((o) => o.kind === 'entry-point' && o.path.includes('client'))
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'client.js'

  await buildCSS()

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="theme-color" content="#0A0E17" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#F8FAFC" media="(prefers-color-scheme: light)">
  <title>Crucible - Agent Orchestration Platform</title>
  <meta name="description" content="Decentralized agent orchestration platform for autonomous AI agents.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Sora:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="./globals.css">
  <script>
    if (typeof process === 'undefined') window.process = { env: { NODE_ENV: 'production' }, browser: true };
    (function() {
      try {
        const savedTheme = localStorage.getItem('crucible-theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (savedTheme ? savedTheme === 'dark' : prefersDark) document.documentElement.classList.add('dark');
      } catch (e) {}
    })();
  </script>
</head>
<body class="font-sans antialiased">
  <div id="root"></div>
  <script type="module" src="./${mainFileName}"></script>
</body>
</html>`

  await Bun.write(`${WEB_DIR}/index.html`, html)

  if (existsSync('./public')) {
    await cp('./public', `${WEB_DIR}/public`, { recursive: true })
  }

  console.log(`  Frontend: ${WEB_DIR}/`)
}

async function buildApi(): Promise<void> {
  console.log('Building API...')

  await mkdir(API_DIR, { recursive: true })

  const result = await Bun.build({
    entrypoints: ['./api/index.ts'],
    outdir: API_DIR,
    target: 'bun',
    minify: true,
    sourcemap: 'external',
    external: ['bun:sqlite', 'child_process', 'node:child_process', 'node:fs', 'node:path', 'node:crypto'],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  })

  if (!result.success) {
    console.error('API build failed:')
    for (const log of result.logs) console.error(log)
    throw new Error('API build failed')
  }

  console.log(`  API: ${API_DIR}/`)
}

async function build(): Promise<void> {
  console.log('Building Crucible for production...\n')

  if (existsSync(DIST_DIR)) {
    await rm(DIST_DIR, { recursive: true })
  }

  await Promise.all([buildFrontend(), buildApi()])

  console.log('\nBuild complete.')
}

build().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})
