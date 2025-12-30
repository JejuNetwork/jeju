/**
 * Bazaar Production Build
 *
 * Builds frontend and API worker for deployment.
 * CSS is processed inline using Tailwind CLI.
 *
 * Usage:
 *   bun run scripts/build.ts
 *   jeju build --app bazaar
 */

import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getCurrentNetwork } from '@jejunetwork/config'
import type { BunPlugin } from 'bun'

const DIST_DIR = './dist'
const STATIC_DIR = `${DIST_DIR}/static`
const WORKER_DIR = `${DIST_DIR}/worker`

const network = getCurrentNetwork()

// Build Tailwind CSS
async function buildCSS(): Promise<string> {
  const globalsPath = './web/globals.css'
  if (!existsSync(globalsPath)) {
    throw new Error(`CSS input file not found: ${globalsPath}`)
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'bazaar-css-'))
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
      './tailwind.config.ts',
      '--content',
      './web/**/*.{ts,tsx}',
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

    // Resolve workspace packages
    build.onResolve({ filter: /^@jejunetwork\/auth$/ }, () => ({
      path: resolve('../../packages/auth/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/auth\/react$/ }, () => ({
      path: resolve('../../packages/auth/src/react/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/auth\/(.*)$/ }, (args) => {
      const subpath = args.path.replace('@jejunetwork/auth/', '')
      return { path: resolve(`../../packages/auth/src/${subpath}.ts`) }
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
    build.onResolve({ filter: /^@jejunetwork\/sdk$/ }, () => ({
      path: resolve('../../packages/sdk/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/ui$/ }, () => ({
      path: resolve('../../packages/ui/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/config$/ }, () => ({
      path: resolve('../../packages/config/index.ts'),
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
  '@jejunetwork/deployment',
  '@jejunetwork/db',
  '@jejunetwork/kms',
  'elysia',
  '@elysiajs/*',
  'ioredis',
  'pino',
  'pino-pretty',
]

const WORKER_EXTERNALS = [
  'bun:sqlite',
  'child_process',
  'node:child_process',
  'node:fs',
  'node:path',
  'node:crypto',
]

async function buildFrontend(): Promise<void> {
  console.log('Building frontend...')

  const result = await Bun.build({
    entrypoints: ['./web/client.tsx'],
    outdir: STATIC_DIR,
    target: 'browser',
    splitting: false,
    packages: 'bundle',
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
      'import.meta.env': JSON.stringify({
        PUBLIC_NETWORK: network,
        MODE: 'production',
        DEV: false,
        PROD: true,
      }),
      'import.meta.env.PUBLIC_NETWORK': JSON.stringify(network),
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

  const mainEntry = result.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('client'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'client.js'

  console.log('Building CSS...')
  const cssContent = await buildCSS()
  await Bun.write(`${STATIC_DIR}/styles.css`, cssContent)

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="theme-color" content="#0D0B14" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#FFFBF7" media="(prefers-color-scheme: light)">
  <title>Bazaar - Agent Marketplace</title>
  <meta name="description" content="The marketplace for tokens, collectibles, prediction markets, and more.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <script>
    (function() {
      try {
        const savedTheme = localStorage.getItem('bazaar-theme');
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

  if (existsSync('./public')) {
    await cp('./public', `${STATIC_DIR}/public`, { recursive: true })
  }

  console.log(`  Frontend: ${STATIC_DIR}/`)
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
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  })

  if (!result.success) {
    console.error('Worker build failed:')
    for (const log of result.logs) console.error(log)
    throw new Error('Worker build failed')
  }

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
    name: 'bazaar-api',
    version: '2.0.0',
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
  console.log(`  Worker: ${WORKER_DIR}/`)
}

async function createDeploymentBundle(): Promise<void> {
  const manifest = {
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
      database: { type: 'sqlit', migrations: 'migrations/' },
    },
    compatibilityDate: '2025-06-01',
  }

  await Bun.write(
    `${DIST_DIR}/deployment.json`,
    JSON.stringify(manifest, null, 2),
  )
  console.log(`  Manifest: ${DIST_DIR}/deployment.json`)
}

async function build(): Promise<void> {
  console.log('Building Bazaar for production...\n')

  if (existsSync(DIST_DIR)) {
    await rm(DIST_DIR, { recursive: true })
  }

  await mkdir(STATIC_DIR, { recursive: true })
  await mkdir(WORKER_DIR, { recursive: true })

  await Promise.all([buildFrontend(), buildWorker()])
  await createDeploymentBundle()

  console.log('\nBuild complete.')
}

build().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})
