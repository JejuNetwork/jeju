import { existsSync } from 'node:fs'
import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getCurrentNetwork } from '@jejunetwork/config'
import { reportBundleSizes } from '@jejunetwork/shared'
import type { BunPlugin } from 'bun'

const DIST_DIR = './dist'
const WEB_DIR = `${DIST_DIR}/web`
const API_DIR = `${DIST_DIR}/api`

const network = getCurrentNetwork()

// Browser plugin for shimming and deduplication
const browserPlugin: BunPlugin = {
  name: 'browser-plugin',
  setup(build) {
    // Stub server-side packages for browser builds
    const serverOnlyStub = resolve('./web/stubs/empty.ts')

    build.onResolve({ filter: /^@jejunetwork\/kms/ }, () => ({
      path: serverOnlyStub,
    }))
    build.onResolve({ filter: /^@jejunetwork\/db/ }, () => ({
      path: serverOnlyStub,
    }))
    build.onResolve({ filter: /^@jejunetwork\/deployment/ }, () => ({
      path: serverOnlyStub,
    }))
    build.onResolve({ filter: /^@jejunetwork\/messaging/ }, () => ({
      path: serverOnlyStub,
    }))
    build.onResolve({ filter: /^ioredis/ }, () => ({ path: serverOnlyStub }))
    build.onResolve({ filter: /^elysia/ }, () => ({ path: serverOnlyStub }))
    build.onResolve({ filter: /^@elysiajs\// }, () => ({
      path: serverOnlyStub,
    }))

    // Stub auth providers that use server-side modules
    const authProvidersStub = resolve('./web/stubs/auth-providers.ts')
    build.onResolve({ filter: /providers\/farcaster/ }, () => ({
      path: authProvidersStub,
    }))
    build.onResolve({ filter: /farcaster-utils/ }, () => ({
      path: authProvidersStub,
    }))
    build.onResolve({ filter: /providers\/email/ }, () => ({
      path: authProvidersStub,
    }))
    build.onResolve({ filter: /providers\/phone/ }, () => ({
      path: authProvidersStub,
    }))

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

    // Resolve workspace packages
    build.onResolve({ filter: /^@jejunetwork\/shared$/ }, () => ({
      path: resolve('../../packages/shared/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/types$/ }, () => ({
      path: resolve('../../packages/types/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/sdk$/ }, () => ({
      path: resolve('../../packages/sdk/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/config$/ }, () => ({
      path: resolve('../../packages/config/index.ts'),
    }))
    // Browser-safe contracts exports (avoid Node-only deployment helpers)
    build.onResolve({ filter: /^@jejunetwork\/contracts$/ }, () => ({
      path: resolve('./web/stubs/contracts.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/auth\/react$/ }, () => ({
      path: resolve('../../packages/auth/src/react/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/auth$/ }, () => ({
      path: resolve('../../packages/auth/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/auth\/types$/ }, () => ({
      path: resolve('../../packages/auth/src/types.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/auth\/(.*)$/ }, (args) => {
      const subpath = args.path.replace('@jejunetwork/auth/', '')
      return { path: resolve(`../../packages/auth/src/${subpath}.ts`) }
    })
    build.onResolve({ filter: /^@jejunetwork\/ui$/ }, () => ({
      path: resolve('../../packages/ui/src/index.ts'),
    }))
  },
}

// Node.js built-ins that need to be external for browser builds
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
]

async function buildCSS(): Promise<void> {
  console.log('  Building CSS...')
  const proc = Bun.spawn(
    [
      'bunx',
      'tailwindcss',
      '-i',
      './web/globals.css',
      '-o',
      `${WEB_DIR}/globals.css`,
      '--minify',
    ],
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
    // splitting: false produces smaller bundles (5MB vs 105MB with splitting)
    // Code splitting duplicates shared deps like TensorFlow.js model shards
    // Only enable splitting for apps with lazy routes where initial load matters
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
      'process.browser': 'true',
      'globalThis.process': JSON.stringify({
        env: { NODE_ENV: 'production', JEJU_NETWORK: network },
        browser: true,
      }),
      'import.meta.env': JSON.stringify({
        VITE_NETWORK: network,
        MODE: 'production',
        DEV: false,
        PROD: true,
      }),
      'import.meta.env.VITE_NETWORK': JSON.stringify(network),
    },
    naming: {
      entry: '[name]-[hash].js',
      chunk: 'chunks/[name]-[hash].js',
      asset: 'assets/[name]-[hash].[ext]',
    },
  })

  if (!result.success) {
    console.error('Frontend build failed:')
    for (const log of result.logs) console.error(log)
    throw new Error('Frontend build failed')
  }

  reportBundleSizes(result, 'Crucible Frontend')

  const mainEntry = result.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('client'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'client.js'

  await buildCSS()

  // IMPORTANT: Use absolute paths (leading /) for SPA routing
  // Relative paths like ./globals.css break when navigating to /agents/new
  // because the browser resolves them relative to /agents/ instead of root
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
  <link rel="stylesheet" href="/globals.css">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔥</text></svg>">
  <script>
    window.__JEJU_CONFIG__ = { network: '${network}' };
    if (typeof process === 'undefined') window.process = { env: { NODE_ENV: 'production', JEJU_NETWORK: '${network}' }, browser: true };
    if (typeof globalThis !== 'undefined' && !globalThis.import) {
      globalThis.import = { meta: { env: { VITE_NETWORK: '${network}', MODE: 'production', DEV: false, PROD: true } } };
    }
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
  <script type="module" src="/${mainFileName}"></script>
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

  // Build the worker.ts which has the fetch handler for workerd/DWS deployment
  const result = await Bun.build({
    entrypoints: ['./api/worker.ts'],
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
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env.JEJU_NETWORK': JSON.stringify(network),
    },
    naming: {
      entry: 'index.js', // Deploy script expects index.js
    },
  })

  if (!result.success) {
    console.error('API build failed:')
    for (const log of result.logs) console.error(log)
    throw new Error('API build failed')
  }

  reportBundleSizes(result, 'Crucible API')
  console.log(`  API: ${API_DIR}/`)
}

async function build(): Promise<void> {
  console.log('Building Crucible for production...\n')

  if (existsSync(DIST_DIR)) {
    await rm(DIST_DIR, { recursive: true })
  }

  await Promise.all([buildFrontend(), buildApi()])

  console.log('\nBuild complete.')
  process.exit(0)
}

build().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})
