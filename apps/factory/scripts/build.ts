/**
 * Factory Production Build
 *
 * Builds frontend and API for deployment.
 * CSS is processed inline using Tailwind CLI.
 *
 * Usage:
 *   bun run scripts/build.ts
 *   jeju build --app factory
 */

import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getCurrentNetwork, getEnvVar } from '@jejunetwork/config'
import { reportBundleSizes } from '@jejunetwork/shared'
import type { BunPlugin } from 'bun'

const DIST_DIR = './dist'
const CLIENT_DIR = `${DIST_DIR}/client`
const API_DIR = `${DIST_DIR}/api`
const WORKER_DIR = `${DIST_DIR}/worker`

const network = getCurrentNetwork()

// Build Tailwind CSS
async function buildCSS(): Promise<string> {
  const globalsPath = './web/styles/globals.css'
  if (!existsSync(globalsPath)) {
    throw new Error(`CSS input file not found: ${globalsPath}`)
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'factory-css-'))
  const inputPath = join(tempDir, 'input.css')
  const outputPath = join(tempDir, 'output.css')

  const globalsContent = await readFile(globalsPath, 'utf-8')
  const inputContent = `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n${globalsContent}`
  await writeFile(inputPath, inputContent)

  const proc = Bun.spawn(
    [
      'bunx',
      'tailwindcss',
      '-i',
      inputPath,
      '-o',
      outputPath,
      '-c',
      './tailwind.config.ts',
      '--content',
      './web/**/*.{ts,tsx,html}',
      '--minify',
    ],
    { stdout: 'pipe', stderr: 'pipe', cwd: process.cwd() },
  )

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    await rm(tempDir, { recursive: true })
    throw new Error(`Tailwind CSS build failed: ${stderr}`)
  }

  const css = await readFile(outputPath, 'utf-8')
  await rm(tempDir, { recursive: true })
  return css
}

// Browser plugin for shimming and deduplication
const browserPlugin: BunPlugin = {
  name: 'browser-plugin',
  setup(build) {
    // Shim pino
    build.onResolve({ filter: /^pino(-pretty)?$/ }, () => ({
      path: resolve('./scripts/shims/pino.ts'),
    }))

    // Shim node:crypto
    build.onResolve({ filter: /^node:crypto$/ }, () => ({
      path: resolve('./web/shims/node-crypto.ts'),
    }))

    // Shim @jejunetwork/contracts for browser (not available at runtime)
    build.onResolve({ filter: /^@jejunetwork\/contracts$/ }, () => ({
      path: resolve('./web/shims/contracts.ts'),
    }))

    // Dedupe React
    const reactPath = require.resolve('react')
    const reactDomPath = require.resolve('react-dom')
    build.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }))
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
      path: require.resolve('react/jsx-runtime'),
    }))
    build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
      path: require.resolve('react/jsx-dev-runtime'),
    }))
    build.onResolve({ filter: /^react-dom$/ }, () => ({ path: reactDomPath }))
    build.onResolve({ filter: /^react-dom\/client$/ }, () => ({
      path: require.resolve('react-dom/client'),
    }))

    // Resolve workspace packages
    build.onResolve({ filter: /^@jejunetwork\/shared$/ }, () => ({
      path: resolve('../../packages/shared/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/types$/ }, () => ({
      path: resolve('../../packages/types/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/config$/ }, () => ({
      path: resolve('../../packages/config/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/ui$/ }, () => ({
      path: resolve('../../packages/ui/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/auth$/ }, () => ({
      path: resolve('../../packages/auth/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/auth\/react$/ }, () => ({
      path: resolve('../../packages/auth/src/react/index.ts'),
    }))
    // SDK needs to be resolved to source for browser builds
    build.onResolve({ filter: /^@jejunetwork\/sdk$/ }, () => ({
      path: resolve('../../packages/sdk/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/token$/ }, () => ({
      path: resolve('../../packages/token/src/index.ts'),
    }))
  },
}

const BROWSER_EXTERNALS = [
  'bun:sqlite',
  'child_process',
  'http2',
  'tls',
  'dgram',
  'fs',
  'net',
  'dns',
  'stream',
  'crypto',
  'module',
  'worker_threads',
  'node:url',
  'node:fs',
  'node:path',
  'node:crypto',
  'node:events',
  'node:module',
  'node:worker_threads',
  // '@jejunetwork/contracts' - shimmed in browserPlugin instead
  '@jejunetwork/deployment',
  '@jejunetwork/db',
  '@jejunetwork/kms',
  '@jejunetwork/dws',
  '@jejunetwork/training',
  'elysia',
  '@elysiajs/cors',
  '@elysiajs/openapi',
  '@elysiajs/static',
  'ioredis',
  'pino',
  'pino-pretty',
  'typeorm',
  '@google-cloud/*',
  '@grpc/*',
  'google-gax',
  'google-auth-library',
  '@farcaster/hub-nodejs',
  '@opentelemetry/*',
  '@aws-sdk/*',
  '@huggingface/*',
  '@solana/*',
  'ws',
  'croner',
  'opossum',
  'generic-pool',
  'c-kzg',
  'kzg-wasm',
  'borsh',
  'tweetnacl',
  'p-retry',
  'yaml',
  'prom-client',
]

async function buildFrontend(): Promise<void> {
  console.log('Building frontend...')

  await mkdir(CLIENT_DIR, { recursive: true })

  const result = await Bun.build({
    entrypoints: ['./web/main.tsx'],
    outdir: CLIENT_DIR,
    target: 'browser',
    splitting: false,
    packages: 'bundle',
    minify: true,
    sourcemap: 'external',
    external: BROWSER_EXTERNALS,
    plugins: [browserPlugin],
    drop: ['debugger'],
    naming: {
      entry: '[name]-[hash].js',
      chunk: 'chunks/[name]-[hash].js',
      asset: 'assets/[name]-[hash].[ext]',
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env.PUBLIC_NETWORK': JSON.stringify(network),
      'process.browser': 'true',
      'import.meta.env': JSON.stringify({
        VITE_NETWORK: network,
        VITE_WALLETCONNECT_PROJECT_ID:
          getEnvVar('VITE_WALLETCONNECT_PROJECT_ID') ?? '',
        MODE: 'production',
        DEV: false,
        PROD: true,
      }),
      'import.meta.env.VITE_WALLETCONNECT_PROJECT_ID': JSON.stringify(
        getEnvVar('VITE_WALLETCONNECT_PROJECT_ID') ?? '',
      ),
    },
  })

  if (!result.success) {
    console.error('Frontend build failed:')
    for (const log of result.logs) console.error(log)
    throw new Error('Frontend build failed')
  }

  reportBundleSizes(result, 'Factory Frontend')

  const mainEntry = result.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('main'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'main.js'

  console.log('  Building CSS...')
  const cssContent = await buildCSS()
  await Bun.write(`${CLIENT_DIR}/styles.css`, cssContent)

  const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Factory | Jeju Developer Hub</title>
  <meta name="description" content="Bounties, jobs, git, packages, containers, models - developer coordination powered by Jeju">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="./styles.css">
  <script>
    if (typeof process === 'undefined') window.process = { env: { NODE_ENV: 'production' }, browser: true };
  </script>
</head>
<body class="min-h-screen bg-factory-950 text-factory-100 antialiased">
  <div id="root"></div>
  <script type="module" src="./${mainFileName}"></script>
</body>
</html>`

  await Bun.write(`${CLIENT_DIR}/index.html`, html)

  if (existsSync('./public')) {
    await cp('./public', `${CLIENT_DIR}/public`, { recursive: true })
  }

  console.log(`  Frontend: ${CLIENT_DIR}/`)
}

async function buildApi(): Promise<void> {
  console.log('Building API (server)...')

  await mkdir(API_DIR, { recursive: true })

  const result = await Bun.build({
    entrypoints: ['./api/server.ts'],
    outdir: API_DIR,
    target: 'bun',
    minify: true,
    sourcemap: 'external',
    drop: ['debugger'],
    external: [
      'bun:sqlite',
      'child_process',
      'node:child_process',
      'node:fs',
      'node:path',
      'node:crypto',
    ],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  })

  if (!result.success) {
    console.error('API build failed:')
    for (const log of result.logs) console.error(log)
    throw new Error('API build failed')
  }

  reportBundleSizes(result, 'Factory API')
  console.log(`  API: ${API_DIR}/`)
}

// Packages that use native bindings and must be excluded from worker bundles
const WORKER_EXTERNALS = [
  // Node.js built-ins
  'bun:sqlite',
  'child_process',
  'node:child_process',
  'node:fs',
  'node:path',
  'node:crypto',
  // Farcaster hub uses native proto bindings
  '@farcaster/hub-nodejs',
  // SQLit uses native bindings in some modes
  '@jejunetwork/sqlit',
  '@jejunetwork/db',
  // Other native packages
  'better-sqlite3',
  'libsql',
  '@libsql/*',
  'pino',
  'pino-pretty',
]

async function buildWorker(): Promise<void> {
  console.log('Building API (worker)...')

  await mkdir(WORKER_DIR, { recursive: true })

  const result = await Bun.build({
    entrypoints: ['./api/worker.ts'],
    outdir: WORKER_DIR,
    target: 'bun',
    minify: true,
    sourcemap: 'external',
    drop: ['debugger'],
    external: WORKER_EXTERNALS,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  })

  if (!result.success) {
    console.error('Worker build failed:')
    for (const log of result.logs) console.error(log)
    throw new Error('Worker build failed')
  }

  reportBundleSizes(result, 'Factory Worker')

  // Create deployment metadata
  let gitCommit = 'unknown'
  let gitBranch = 'unknown'
  try {
    const commitResult = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'])
    if (commitResult.success)
      gitCommit = new TextDecoder().decode(commitResult.stdout).trim()
    const branchResult = Bun.spawnSync([
      'git',
      'rev-parse',
      '--abbrev-ref',
      'HEAD',
    ])
    if (branchResult.success)
      gitBranch = new TextDecoder().decode(branchResult.stdout).trim()
  } catch {
    /* Git not available */
  }

  const metadata = {
    name: 'factory-api',
    version: '1.0.0',
    entrypoint: 'worker.js',
    compatibilityDate: '2025-06-01',
    buildTime: new Date().toISOString(),
    git: { commit: gitCommit, branch: gitBranch },
    runtime: 'bun',
  }

  await Bun.write(
    `${WORKER_DIR}/metadata.json`,
    JSON.stringify(metadata, null, 2),
  )
  console.log(`  Worker: ${WORKER_DIR}/`)
}

async function build(): Promise<void> {
  console.log('Building Factory for production...\n')

  if (existsSync(DIST_DIR)) {
    await rm(DIST_DIR, { recursive: true })
  }

  await Promise.all([buildFrontend(), buildApi(), buildWorker()])

  console.log('\nBuild complete.')
  process.exit(0)
}

build().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})
