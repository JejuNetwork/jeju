/**
 * Bazaar Development Server
 *
 * Simple Bun-based dev server - no shared package dependencies.
 * Builds frontend, serves static files, proxies API requests.
 */

import { existsSync, watch } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import {
  CORE_PORTS,
  getCoreAppUrl,
  getCQLBlockProducerUrl,
  getIndexerGraphqlUrl,
  getRpcUrl,
} from '@jejunetwork/config'
import { createBazaarApp } from '../api/worker'

const FRONTEND_PORT = CORE_PORTS.BAZAAR.get()
const API_PORT = CORE_PORTS.BAZAAR_API.get()
const DWS_URL = getCoreAppUrl('DWS_API')
const USE_DWS = process.env.USE_DWS === 'true'

// Browser externals - packages that can't run in browser
const EXTERNALS = [
  // Node.js built-ins
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

let buildInProgress = false

async function buildFrontend(): Promise<void> {
  if (buildInProgress) return
  buildInProgress = true
  const start = Date.now()

  const result = await Bun.build({
    entrypoints: ['./web/client.tsx'],
    outdir: './dist/dev',
    target: 'browser',
    splitting: false, // Disabled due to Bun duplicate export bug with secp256k1
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
        name: 'browser-pino-stub',
        setup(build) {
          // Replace pino imports with a browser-safe stub
          build.onResolve({ filter: /^pino$/ }, () => ({
            path: 'pino',
            namespace: 'pino-stub',
          }))
          build.onLoad({ filter: /.*/, namespace: 'pino-stub' }, () => ({
            contents: `
              const noop = () => {};
              const createChild = () => logger;
              const logger = {
                debug: console.debug.bind(console),
                info: console.info.bind(console),
                warn: console.warn.bind(console),
                error: console.error.bind(console),
                fatal: console.error.bind(console),
                trace: console.trace.bind(console),
                child: createChild,
                level: 'info',
                levels: { values: { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } },
              };
              export default function pino() { return logger; }
              export const levels = logger.levels;
            `,
            loader: 'js',
          }))

          // Dedupe React - force all react imports to resolve to the same location
          const reactPath = require.resolve('react')
          const reactDomPath = require.resolve('react-dom')
          const reactJsxPath = require.resolve('react/jsx-runtime')
          const reactJsxDevPath = require.resolve('react/jsx-dev-runtime')

          build.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }))
          build.onResolve({ filter: /^react-dom$/ }, () => ({
            path: reactDomPath,
          }))
          build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
            path: reactJsxPath,
          }))
          build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
            path: reactJsxDevPath,
          }))

          // Resolve workspace packages to source files
          const { resolve } = require('node:path')
          build.onResolve({ filter: /^@jejunetwork\/auth$/ }, () => ({
            path: resolve(process.cwd(), '../../packages/auth/src/index.ts'),
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
              return {
                path: resolve(
                  process.cwd(),
                  `../../packages/auth/src/${subpath}.ts`,
                ),
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
    DWS_URL: DWS_URL,
    GATEWAY_URL: getCoreAppUrl('NODE_EXPLORER_API'),
    INDEXER_URL: getIndexerGraphqlUrl(),
    COVENANTSQL_NODES: getCQLBlockProducerUrl(),
    COVENANTSQL_DATABASE_ID:
      process.env.COVENANTSQL_DATABASE_ID || 'dev-bazaar',
    COVENANTSQL_PRIVATE_KEY: process.env.COVENANTSQL_PRIVATE_KEY || '',
  })

  app.listen(API_PORT, () => {
    console.log(`[Bazaar] API: http://localhost:${API_PORT}`)
  })
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
      if (path !== '/' && !path.includes('.')) {
        // SPA fallback
      }
      const publicFile = Bun.file(`./public${path}`)
      if (path !== '/' && (await publicFile.exists())) {
        return new Response(publicFile)
      }

      // Serve index.html (with Tailwind CDN for dev)
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
  <script>
    // Process polyfill for browser
    window.process = window.process || { env: { NODE_ENV: 'development' } };
  </script>
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
