/**
 * Production build script for Bazaar
 *
 * Builds:
 * 1. Static frontend (dist/static/) - for IPFS/CDN deployment
 * 2. Worker bundle (dist/worker/) - for DWS serverless deployment
 *
 * Uses shared build utilities from @jejunetwork/shared
 */

import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BunPlugin } from 'bun'
import { buildCSS } from './build-css'

const DIST_DIR = './dist'
const STATIC_DIR = `${DIST_DIR}/static`
const WORKER_DIR = `${DIST_DIR}/worker`

// Plugin to shim server-only modules, dedupe React/@noble/curves, and resolve workspace packages
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

    // Dedupe @noble/curves to prevent duplicate exports
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

    // Resolve workspace packages to their source files to ensure proper bundling
    build.onResolve({ filter: /^@jejunetwork\/oauth3$/ }, () => ({
      path: resolve('../../packages/oauth3/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/oauth3\/react$/ }, () => ({
      path: resolve('../../packages/oauth3/src/react/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/oauth3\/(.*)$/ }, (args) => {
      const subpath = args.path.replace('@jejunetwork/oauth3/', '')
      return { path: resolve(`../../packages/oauth3/src/${subpath}.ts`) }
    })
    build.onResolve({ filter: /^@jejunetwork\/shared$/ }, () => ({
      path: resolve('../../packages/shared/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/shared\/(.*)$/ }, (args) => ({
      path: resolve(`../../packages/shared/src/${args.path.split('/')[1]}.ts`),
    }))
    build.onResolve({ filter: /^@jejunetwork\/types$/ }, () => ({
      path: resolve('../../packages/types/src/index.ts'),
    }))
  },
}

// External packages that should not be bundled for browser
// Only include Node.js-specific packages that truly cannot run in browser
const BROWSER_EXTERNALS = [
  // Node.js builtins that have no browser equivalent
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
  // Server-only packages
  '@jejunetwork/deployment',
  '@jejunetwork/db',
  '@jejunetwork/kms',
  'elysia',
  '@elysiajs/*',
  'ioredis',
  'pino',
  'pino-pretty',
]

// External packages for worker build
const WORKER_EXTERNALS = [
  'bun:sqlite',
  'child_process',
  'node:child_process',
  'node:fs',
  'node:path',
  'node:crypto',
]

async function buildFrontend(): Promise<void> {
  console.log('Building static frontend...')

  const result = await Bun.build({
    entrypoints: ['./web/client.tsx'],
    outdir: STATIC_DIR,
    target: 'browser',
    splitting: false, // Disable splitting to ensure defines apply correctly
    packages: 'bundle', // Bundle all packages
    minify: true,
    sourcemap: 'external',
    external: BROWSER_EXTERNALS,
    plugins: [browserPlugin],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env.PUBLIC_API_URL': JSON.stringify(
        process.env.PUBLIC_API_URL || '',
      ),
      'process.browser': 'true',
      'globalThis.process': JSON.stringify({
        env: {
          NODE_ENV: 'production',
          PUBLIC_API_URL: process.env.PUBLIC_API_URL || '',
        },
        browser: true,
      }),
      process: JSON.stringify({
        env: {
          NODE_ENV: 'production',
          PUBLIC_API_URL: process.env.PUBLIC_API_URL || '',
        },
        browser: true,
      }),
      // Vite-style environment variables
      'import.meta.env': JSON.stringify({
        VITE_NETWORK: 'localnet',
        MODE: 'production',
        DEV: false,
        PROD: true,
      }),
      'import.meta.env.VITE_NETWORK': JSON.stringify('localnet'),
    },
    naming: {
      entry: '[name]-[hash].js',
      chunk: 'chunks/[name]-[hash].js',
      asset: 'assets/[name]-[hash].[ext]',
    },
  })

  if (!result.success) {
    console.error('Frontend build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error('Frontend build failed')
  }

  // Find the main entry file
  const mainEntry = result.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('client'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'client.js'

  // Build CSS with Tailwind (properly processed, no CDN)
  console.log('Processing Tailwind CSS...')
  const cssContent = await buildCSS()
  await Bun.write(`${STATIC_DIR}/styles.css`, cssContent)

  // Create index.html (no Tailwind CDN - CSS is bundled)
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="theme-color" content="#0D0B14" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#FFFBF7" media="(prefers-color-scheme: light)">
  <title>Bazaar - Agent Marketplace on the Network</title>
  <meta name="description" content="The fun, light-hearted marketplace for tokens, NFTs, prediction markets, and more.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <script>
    // Theme detection
    (function() {
      try {
        const savedTheme = localStorage.getItem('bazaar-theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const shouldBeDark = savedTheme ? savedTheme === 'dark' : prefersDark;
        if (shouldBeDark) {
          document.documentElement.classList.add('dark');
        }
      } catch (e) {}
    })();
    // Runtime config
    window.__JEJU_CONFIG__ = ${JSON.stringify({
      apiUrl: process.env.PUBLIC_API_URL || '',
      network: process.env.NETWORK || 'localnet',
    })};
  </script>
</head>
<body class="font-sans antialiased">
  <div id="root"></div>
  <script type="module" src="/${mainFileName}"></script>
</body>
</html>`

  await Bun.write(`${STATIC_DIR}/index.html`, html)

  // Copy public assets
  if (existsSync('./public')) {
    const { cp } = await import('node:fs/promises')
    await cp('./public', `${STATIC_DIR}/public`, { recursive: true })
  }

  console.log(`Frontend built to ${STATIC_DIR}/`)
}

async function buildWorker(): Promise<void> {
  console.log('Building API worker...')

  const result = await Bun.build({
    entrypoints: ['./api/worker.ts'],
    outdir: WORKER_DIR,
    target: 'bun',
    minify: true,
    sourcemap: 'external',
    external: WORKER_EXTERNALS,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  })

  if (!result.success) {
    console.error('Worker build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error('Worker build failed')
  }

  // Get git info for metadata
  let gitCommit = 'unknown'
  let gitBranch = 'unknown'
  try {
    const commitResult = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'])
    if (commitResult.success) {
      gitCommit = new TextDecoder().decode(commitResult.stdout).trim()
    }
    const branchResult = Bun.spawnSync([
      'git',
      'rev-parse',
      '--abbrev-ref',
      'HEAD',
    ])
    if (branchResult.success) {
      gitBranch = new TextDecoder().decode(branchResult.stdout).trim()
    }
  } catch {
    // Git not available
  }

  const metadata = {
    name: 'bazaar-api',
    version: '2.0.0',
    entrypoint: 'worker.js',
    compatibilityDate: '2025-06-01',
    buildTime: new Date().toISOString(),
    git: {
      commit: gitCommit,
      branch: gitBranch,
    },
    runtime: 'workerd',
  }

  await Bun.write(
    `${WORKER_DIR}/metadata.json`,
    JSON.stringify(metadata, null, 2),
  )

  console.log(`Worker built to ${WORKER_DIR}/`)
}

async function createDeploymentBundle(): Promise<void> {
  console.log('Creating deployment bundle...')

  // Create deployment manifest
  const deploymentManifest = {
    name: 'bazaar',
    version: '2.0.0',
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
        routes: ['/api/*', '/health', '/.well-known/*'],
      },
    },
    dws: {
      regions: ['global'],
      tee: { preferred: true, required: false },
      database: {
        type: 'covenantsql',
        migrations: 'migrations/',
      },
    },
    compatibilityDate: '2025-06-01',
  }

  await Bun.write(
    `${DIST_DIR}/deployment.json`,
    JSON.stringify(deploymentManifest, null, 2),
  )

  console.log('Deployment bundle created')
}

async function build(): Promise<void> {
  console.log('Building Bazaar for decentralized deployment...\n')

  // Clean dist directory
  if (existsSync(DIST_DIR)) {
    await rm(DIST_DIR, { recursive: true })
  }

  // Create directories
  const { mkdir } = await import('node:fs/promises')
  await mkdir(STATIC_DIR, { recursive: true })
  await mkdir(WORKER_DIR, { recursive: true })

  // Build frontend and worker in parallel
  await Promise.all([buildFrontend(), buildWorker()])

  // Create deployment bundle
  await createDeploymentBundle()

  console.log('\nBuild complete.')
  console.log('   Static frontend: ./dist/static/')
  console.log('   API worker: ./dist/worker/')
  console.log('   Deployment manifest: ./dist/deployment.json')
}

build().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})
