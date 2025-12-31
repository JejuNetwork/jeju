/**
 * Bazaar Development Server
 *
 * Builds frontend with HMR, serves static files, proxies API requests.
 * For full-stack dev with infrastructure, use: jeju dev
 *
 * Usage:
 *   bun run dev                    # Frontend + API
 *   bun run scripts/dev.ts         # Frontend only
 */

import { existsSync, watch } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  CORE_PORTS,
  getCoreAppUrl,
  getIndexerGraphqlUrl,
  getRpcUrl,
  getSQLitBlockProducerUrl,
} from '@jejunetwork/config'

import { createBazaarApp } from '../api/worker'

const FRONTEND_PORT = CORE_PORTS.BAZAAR.get()
const API_PORT = CORE_PORTS.BAZAAR_API.get()
const DWS_URL = getCoreAppUrl('DWS_API')
const USE_DWS = process.env.USE_DWS === 'true'

const EXTERNALS = [
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
  'node:process',
  'node:util/types',
  'node:worker_threads',
  '@jejunetwork/deployment',
  '@jejunetwork/db',
  '@jejunetwork/kms',
  '@jejunetwork/messaging',
  '@xmtp/node-sdk',
  '@xmtp/node-bindings',
  'elysia',
  '@elysiajs/*',
  'ioredis',
  'pino',
  'pino-pretty',
]

let buildInProgress = false

async function buildFrontend(): Promise<void> {
  if (buildInProgress) return
  buildInProgress = true
  const start = Date.now()

  const result = await Bun.build({
    entrypoints: ['./web/client.tsx'],
    outdir: './dist/dev',
    target: 'browser',
    splitting: false,
    minify: false,
    sourcemap: 'inline',
    external: EXTERNALS,
    define: {
      'process.env.NODE_ENV': JSON.stringify('development'),
      'process.env.PUBLIC_API_URL': JSON.stringify(
        `http://localhost:${API_PORT}`,
      ),
      'process.env': JSON.stringify({
        NODE_ENV: 'development',
        PUBLIC_API_URL: `http://localhost:${API_PORT}`,
      }),
      'globalThis.process': JSON.stringify({
        env: { NODE_ENV: 'development' },
      }),
    },
    plugins: [
      {
        name: 'browser-shims',
        setup(build) {
          // Pino stub - use real file to avoid duplicate export issues
          build.onResolve({ filter: /^pino$/ }, () => ({
            path: resolve(process.cwd(), './web/stubs/pino.ts'),
          }))

          // Server-side package stubs
          build.onResolve({ filter: /^@jejunetwork\/kms/ }, () => ({
            path: resolve(process.cwd(), './web/stubs/kms.ts'),
          }))
          build.onResolve({ filter: /^@jejunetwork\/messaging/ }, () => ({
            path: resolve(process.cwd(), './web/stubs/empty.ts'),
          }))
          build.onResolve({ filter: /^@jejunetwork\/db/ }, () => ({
            path: resolve(process.cwd(), './web/stubs/db.ts'),
          }))
          build.onResolve({ filter: /^@jejunetwork\/deployment/ }, () => ({
            path: resolve(process.cwd(), './web/stubs/empty.ts'),
          }))
          build.onResolve({ filter: /^@jejunetwork\/shared/ }, () => ({
            path: resolve(process.cwd(), './web/stubs/shared.ts'),
          }))
          build.onResolve({ filter: /^@xmtp\// }, () => ({
            path: resolve(process.cwd(), './web/stubs/empty.ts'),
          }))
          build.onResolve({ filter: /^ioredis/ }, () => ({
            path: resolve(process.cwd(), './web/stubs/empty.ts'),
          }))
          build.onResolve({ filter: /^elysia/ }, () => ({
            path: resolve(process.cwd(), './web/stubs/empty.ts'),
          }))
          build.onResolve({ filter: /^@elysiajs\// }, () => ({
            path: resolve(process.cwd(), './web/stubs/empty.ts'),
          }))

          // Dedupe React
          const reactPath = require.resolve('react')
          const reactDomPath = require.resolve('react-dom')
          build.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }))
          build.onResolve({ filter: /^react-dom$/ }, () => ({
            path: reactDomPath,
          }))
          build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
            path: require.resolve('react/jsx-runtime'),
          }))
          build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
            path: require.resolve('react/jsx-dev-runtime'),
          }))

          // Workspace packages - auth browser-only exports
          build.onResolve({ filter: /^@jejunetwork\/auth$/ }, () => ({
            path: resolve(
              process.cwd(),
              '../../packages/auth/src/react/index.ts',
            ),
          }))
          build.onResolve({ filter: /^@jejunetwork\/auth\/react$/ }, () => ({
            path: resolve(
              process.cwd(),
              '../../packages/auth/src/react/index.ts',
            ),
          }))
          build.onResolve(
            { filter: /^@jejunetwork\/auth\/(.*)$/ },
            (args: { path: string }) => {
              const subpath = args.path.replace('@jejunetwork/auth/', '')
              // Only allow react subfolder for browser
              if (
                subpath.startsWith('react') ||
                subpath.startsWith('types') ||
                subpath.startsWith('validation') ||
                subpath.startsWith('utils')
              ) {
                return {
                  path: resolve(
                    process.cwd(),
                    `../../packages/auth/src/${subpath}.ts`,
                  ),
                }
              }
              // Server-only modules get empty stub
              return {
                path: resolve(process.cwd(), './web/stubs/empty.ts'),
              }
            },
          )
        },
      },
    ],
  })

  buildInProgress = false

  if (!result.success) {
    console.error('[Bazaar] Build failed:')
    for (const log of result.logs) console.error(log)
    return
  }

  console.log(`[Bazaar] Built in ${Date.now() - start}ms`)
}

async function startApiServer(): Promise<void> {
  if (USE_DWS) {
    console.log(
      `[Bazaar] API proxied through DWS: ${DWS_URL}/workers/bazaar-api`,
    )
    return
  }

  const app = createBazaarApp({
    NETWORK: 'localnet',
    TEE_MODE: 'simulated',
    TEE_PLATFORM: 'local',
    TEE_REGION: 'local',
    RPC_URL: getRpcUrl('localnet'),
    DWS_URL,
    GATEWAY_URL: getCoreAppUrl('NODE_EXPLORER_API'),
    INDEXER_URL: getIndexerGraphqlUrl(),
    SQLIT_NODES: getSQLitBlockProducerUrl(),
    SQLIT_DATABASE_ID: process.env.SQLIT_DATABASE_ID || 'dev-bazaar',
    SQLIT_PRIVATE_KEY: process.env.SQLIT_PRIVATE_KEY || '',
  })

  app.listen(API_PORT, () =>
    console.log(`[Bazaar] API: http://localhost:${API_PORT}`),
  )
}

async function startFrontendServer(): Promise<void> {
  await mkdir('./dist/dev', { recursive: true })
  await buildFrontend()

  const apiUrl = USE_DWS
    ? `${DWS_URL}/workers/bazaar-api`
    : `http://localhost:${API_PORT}`

  Bun.serve({
    port: FRONTEND_PORT,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      // Proxy API requests
      if (
        path.startsWith('/api/') ||
        path === '/health' ||
        path.startsWith('/.well-known/')
      ) {
        return fetch(`${apiUrl}${path}${url.search}`, {
          method: req.method,
          headers: req.headers,
          body:
            req.method !== 'GET' && req.method !== 'HEAD'
              ? req.body
              : undefined,
        }).catch(() => new Response('Backend unavailable', { status: 503 }))
      }

      // Serve built JS
      if (path.endsWith('.js') || path.endsWith('.js.map')) {
        const file = Bun.file(`./dist/dev${path}`)
        if (await file.exists()) {
          return new Response(file, {
            headers: {
              'Content-Type': 'application/javascript',
              'Cache-Control': 'no-cache',
            },
          })
        }
      }

      // Serve CSS
      if (path.endsWith('.css')) {
        const file = Bun.file(`./web${path}`)
        if (await file.exists()) {
          return new Response(file, {
            headers: {
              'Content-Type': 'text/css',
              'Cache-Control': 'no-cache',
            },
          })
        }
      }

      // Serve public files
      const publicFile = Bun.file(`./public${path}`)
      if (path !== '/' && (await publicFile.exists())) {
        return new Response(publicFile)
      }

      // Serve index.html (SPA fallback)
      return new Response(generateDevHtml(), {
        headers: { 'Content-Type': 'text/html' },
      })
    },
  })

  console.log(`[Bazaar] Frontend: http://localhost:${FRONTEND_PORT}`)

  // Watch for changes
  for (const dir of ['./web', './components', './hooks', './lib']) {
    if (existsSync(dir)) {
      watch(dir, { recursive: true }, (_, file) => {
        if (file?.endsWith('.ts') || file?.endsWith('.tsx')) {
          console.log(`[Bazaar] ${file} changed, rebuilding...`)
          buildFrontend()
        }
      })
    }
  }
}

function generateDevHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0D0B14" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#FFFBF7" media="(prefers-color-scheme: light)">
  <title>Bazaar - Dev</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script>window.process = window.process || { env: { NODE_ENV: 'development' } };</script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = { darkMode: 'class' }
    const saved = localStorage.getItem('bazaar-theme');
    if (saved === 'dark' || (!saved && matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  </script>
  <link rel="stylesheet" href="/globals.css">
</head>
<body class="font-sans antialiased">
  <div id="root"></div>
  <script type="module" src="/client.js"></script>
</body>
</html>`
}

async function main() {
  console.log('[Bazaar] Starting dev server...\n')
  await startApiServer()
  await startFrontendServer()
  console.log('\n[Bazaar] Ready.')
}

main()
