#!/usr/bin/env bun
/**
 * Autocrat Production Build Script
 *
 * Builds frontend and API worker for deployment:
 * - Frontend: Static SPA to dist/static/ (for IPFS/CDN deployment)
 * - Worker: Elysia API to dist/worker/ (for DWS workerd deployment)
 *
 * Usage:
 *   bun run scripts/build.ts
 *   jeju build --app autocrat
 */

import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getCurrentNetwork } from '@jejunetwork/config'
import { reportBundleSizes } from '@jejunetwork/shared'
import type { BunPlugin } from 'bun'

const APP_DIR = resolve(import.meta.dir, '..')
const DIST_DIR = resolve(APP_DIR, 'dist')
const STATIC_DIR = `${DIST_DIR}/static`
const WORKER_DIR = `${DIST_DIR}/worker`

const network = getCurrentNetwork()

// Build Tailwind CSS
async function buildCSS(): Promise<string> {
  const globalsPath = resolve(APP_DIR, 'web/app/globals.css')
  if (!existsSync(globalsPath)) {
    throw new Error(`CSS input file not found: ${globalsPath}`)
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'autocrat-css-'))
  const inputPath = join(tempDir, 'input.css')
  const outputPath = join(tempDir, 'output.css')

  let globalsContent = await readFile(globalsPath, 'utf-8')
  globalsContent = globalsContent.replace(
    '@import "tailwindcss";',
    `@tailwind base;\n@tailwind components;\n@tailwind utilities;`,
  )

  await writeFile(inputPath, globalsContent)

  const proc = Bun.spawn(
    [
      'bunx',
      'tailwindcss',
      '-i',
      inputPath,
      '-o',
      outputPath,
      '-c',
      resolve(APP_DIR, 'tailwind.config.ts'),
      '--content',
      resolve(APP_DIR, 'web/**/*.{ts,tsx}'),
      '--minify',
    ],
    { stdout: 'pipe', stderr: 'pipe', cwd: APP_DIR },
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

    // Dedupe @noble/curves
    build.onResolve({ filter: /^@noble\/curves\/secp256k1$/ }, () => ({
      path: require.resolve('@noble/curves/secp256k1'),
    }))
    build.onResolve({ filter: /^@noble\/curves\/p256$/ }, () => ({
      path: require.resolve('@noble/curves/p256'),
    }))
    build.onResolve({ filter: /^@noble\/curves$/ }, () => ({
      path: require.resolve('@noble/curves'),
    }))
    build.onResolve({ filter: /^@noble\/hashes/ }, (args) => ({
      path: require.resolve(args.path),
    }))

    // Handle Node.js crypto for browser - return empty module
    build.onResolve({ filter: /^node:crypto$/ }, () => ({
      path: 'crypto-empty',
      namespace: 'crypto-polyfill',
    }))
    build.onResolve({ filter: /^crypto$/ }, () => ({
      path: 'crypto-empty',
      namespace: 'crypto-polyfill',
    }))
    build.onLoad({ filter: /.*/, namespace: 'crypto-polyfill' }, () => ({
      contents: `
        const crypto = globalThis.crypto || {};
        export const randomBytes = (size) => {
          const bytes = new Uint8Array(size);
          globalThis.crypto.getRandomValues(bytes);
          return bytes;
        };
        export const createHash = () => ({
          update: () => ({ digest: () => '' }),
        });
        export default crypto;
      `,
      loader: 'js',
    }))
  },
}

// Node.js built-ins that need to be external for browser builds
// @elysiajs/eden is NOT external - it's the browser client and must be bundled
const BROWSER_EXTERNALS = [
  '@google-cloud/*',
  '@grpc/*',
  'google-gax',
  'google-auth-library',
  'native-dns',
  'native-dns-cache',
  '@farcaster/hub-nodejs',
  '@opentelemetry/*',
  'bun:sqlite',
  'node:*',
  'typeorm',
  '@jejunetwork/db',
  '@jejunetwork/dws',
  '@jejunetwork/kms',
  '@jejunetwork/deployment',
  '@jejunetwork/training',
  'elysia', // Server-only, not needed in browser
  '@elysiajs/cors', // Server-only
  '@elysiajs/swagger', // Server-only
  '@elysiajs/static', // Server-only
  // @elysiajs/eden is intentionally NOT here - it's the browser client
  'ioredis',
  'croner',
  'opossum',
  'ws',
  'generic-pool',
  'c-kzg',
  'kzg-wasm',
  '@aws-sdk/*',
  '@huggingface/*',
  '@solana/*',
  'borsh',
  'tweetnacl',
  'p-retry',
  'yaml',
  'prom-client',
  'child_process',
  'http2',
  'tls',
  'dgram',
  'fs',
  'net',
  'dns',
  'stream',
  'module',
  'worker_threads',
]

const WORKER_EXTERNALS = [
  'bun:sqlite',
  'child_process',
  'node:child_process',
  'node:fs',
  'node:path',
  'node:crypto',
]

// Plugin to replace viem/chains imports with custom chain definitions
// This prevents bundling issues where viem/chains uses process.env at runtime
const viemChainsPlugin: BunPlugin = {
  name: 'viem-chains-replace',
  setup(build) {
    build.onResolve({ filter: /^viem\/chains$/ }, () => ({
      path: 'viem-chains-stub',
      namespace: 'viem-chains-stub',
    }))
    build.onLoad({ filter: /.*/, namespace: 'viem-chains-stub' }, () => ({
      contents: `
        // Custom chain definitions to avoid viem/chains bundling issues
        export const base = {
          id: 8453,
          name: 'Base',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: ['https://mainnet.base.org'] } },
        };
        export const baseSepolia = {
          id: 84532,
          name: 'Base Sepolia',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: ['https://sepolia.base.org'] } },
          testnet: true,
        };
        export const localhost = {
          id: 31337,
          name: 'Localhost',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: ['http://localhost:8545'] } },
        };
        export const mainnet = {
          id: 1,
          name: 'Ethereum',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: ['https://eth.llamarpc.com'] } },
        };
        export const sepolia = {
          id: 11155111,
          name: 'Sepolia',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: ['https://rpc.sepolia.org'] } },
          testnet: true,
        };
        export const foundry = localhost;
      `,
      loader: 'js',
    }))
  },
}

async function buildFrontend(): Promise<void> {
  console.log('[Autocrat] Building frontend...')

  const result = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'web/main.tsx')],
    outdir: STATIC_DIR,
    target: 'browser',
    splitting: false,
    packages: 'bundle',
    minify: true,
    sourcemap: 'external',
    external: BROWSER_EXTERNALS,
    plugins: [browserPlugin],
    drop: ['debugger'],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env.JEJU_NETWORK': JSON.stringify(network),
      'process.env.PUBLIC_API_URL': JSON.stringify(
        process.env.PUBLIC_API_URL || '',
      ),
      'process.browser': 'true',
      'globalThis.process': JSON.stringify({
        env: {
          NODE_ENV: 'production',
          JEJU_NETWORK: network,
          PUBLIC_API_URL: process.env.PUBLIC_API_URL || '',
        },
        browser: true,
      }),
      process: JSON.stringify({
        env: {
          NODE_ENV: 'production',
          JEJU_NETWORK: network,
          PUBLIC_API_URL: process.env.PUBLIC_API_URL || '',
        },
        browser: true,
      }),
      'import.meta.env': JSON.stringify({
        PUBLIC_NETWORK: network,
        VITE_NETWORK: network,
        MODE: 'production',
        DEV: false,
        PROD: true,
      }),
      'import.meta.env.PUBLIC_NETWORK': JSON.stringify(network),
      'import.meta.env.VITE_NETWORK': JSON.stringify(network),
    },
    naming: {
      entry: '[name]-[hash].js',
      chunk: 'chunks/[name]-[hash].js',
      asset: 'assets/[name]-[hash].[ext]',
    },
  })

  if (!result.success) {
    console.error('[Autocrat] Frontend build failed:')
    for (const log of result.logs) console.error(log)
    throw new Error('Frontend build failed')
  }

  reportBundleSizes(result, 'Autocrat Frontend')

  const mainEntry = result.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('main'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'main.js'

  console.log('[Autocrat] Building CSS...')
  const cssContent = await buildCSS()
  await Bun.write(`${STATIC_DIR}/styles.css`, cssContent)

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="theme-color" content="#0D0B14" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#FFFBF7" media="(prefers-color-scheme: light)">
  <title>Autocrat - AI-Powered Governance</title>
  <meta name="description" content="Multi-tenant DAO governance with AI Directors, futarchy, and deep funding.">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <script>
    (function() {
      try {
        const savedTheme = localStorage.getItem('autocrat-theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (savedTheme ? savedTheme === 'dark' : prefersDark) document.documentElement.classList.add('dark');
      } catch (e) {}
    })();
    window.__JEJU_CONFIG__ = ${JSON.stringify({ apiUrl: process.env.PUBLIC_API_URL || '', network })};
  </script>
</head>
<body class="font-sans antialiased">
  <div id="root"></div>
  <script type="module" src="/${mainFileName}"></script>
</body>
</html>`

  await Bun.write(`${STATIC_DIR}/index.html`, html)

  if (existsSync(resolve(APP_DIR, 'public'))) {
    await cp(resolve(APP_DIR, 'public'), STATIC_DIR, {
      recursive: true,
    })
  }

  console.log(`[Autocrat] Frontend: ${STATIC_DIR}/`)
}

async function buildWorker(): Promise<void> {
  console.log('[Autocrat] Building API worker...')

  const result = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'api/worker.ts')],
    outdir: WORKER_DIR,
    target: 'bun',
    minify: true,
    sourcemap: 'external',
    external: WORKER_EXTERNALS,
    plugins: [viemChainsPlugin],
    drop: ['debugger'],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  })

  if (!result.success) {
    console.error('[Autocrat] Worker build failed:')
    for (const log of result.logs) console.error(log)
    throw new Error('Worker build failed')
  }

  reportBundleSizes(result, 'Autocrat Worker')

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
    name: 'autocrat-api',
    version: '3.0.0',
    entrypoint: 'worker.js',
    compatibilityDate: '2025-06-01',
    buildTime: new Date().toISOString(),
    git: { commit: gitCommit, branch: gitBranch },
    runtime: 'workerd',
  }

  await Bun.write(
    `${WORKER_DIR}/metadata.json`,
    JSON.stringify(metadata, null, 2),
  )
  console.log(`[Autocrat] Worker: ${WORKER_DIR}/`)
}

async function createDeploymentBundle(): Promise<void> {
  const manifest = {
    name: 'autocrat',
    version: '3.0.0',
    architecture: {
      frontend: {
        type: 'static',
        path: 'static',
        spa: true,
        fallback: 'index.html',
      },
      worker: {
        type: 'elysia',
        path: 'worker',
        entrypoint: 'worker.js',
        adapter: 'cloudflare',
        routes: ['/api/*', '/a2a/*', '/mcp/*', '/health', '/.well-known/*'],
      },
    },
    dws: {
      regions: ['global'],
      tee: { preferred: true, required: true },
      database: { type: 'sqlit', migrations: 'migrations/' },
    },
    compatibilityDate: '2025-06-01',
  }

  await Bun.write(
    `${DIST_DIR}/deployment.json`,
    JSON.stringify(manifest, null, 2),
  )
  console.log(`[Autocrat] Manifest: ${DIST_DIR}/deployment.json`)
}

async function build(): Promise<void> {
  console.log('[Autocrat] Building for production...\n')

  if (existsSync(DIST_DIR)) {
    await rm(DIST_DIR, { recursive: true })
  }

  await mkdir(STATIC_DIR, { recursive: true })
  await mkdir(WORKER_DIR, { recursive: true })

  await Promise.all([buildFrontend(), buildWorker()])
  await createDeploymentBundle()

  console.log('\n[Autocrat] Build complete.')
  process.exit(0)
}

build().catch((error) => {
  console.error('[Autocrat] Build failed:', error)
  process.exit(1)
})
