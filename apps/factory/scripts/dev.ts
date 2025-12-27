/**
 * Factory Development Server
 *
 * Builds frontend with HMR, serves static files, proxies API requests.
 * For full-stack dev with infrastructure, use: jeju dev
 *
 * Usage:
 *   bun run dev                    # Frontend + API
 *   bun run scripts/dev.ts         # Frontend only
 */

import { existsSync, watch, mkdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { CORE_PORTS, getChainId, getIpfsApiUrl, getRpcUrl, getWsUrl } from '@jejunetwork/config'
import type { BunPlugin } from 'bun'

const FRONTEND_PORT = CORE_PORTS.FACTORY.get()
const API_PORT = CORE_PORTS.FACTORY_API.get()

const EXTERNALS = [
  'bun:sqlite', 'child_process', 'http2', 'tls', 'dgram', 'fs', 'net', 'dns', 'stream', 'crypto', 'module', 'worker_threads',
  'node:url', 'node:fs', 'node:path', 'node:crypto', 'node:events', 'node:module', 'node:worker_threads',
  '@jejunetwork/deployment', '@jejunetwork/db', '@jejunetwork/kms', '@jejunetwork/dws', '@jejunetwork/training', '@jejunetwork/sdk',
  'elysia', '@elysiajs/*', 'ioredis', 'typeorm',
  '@google-cloud/*', '@grpc/*', 'google-gax', 'google-auth-library',
  '@farcaster/hub-nodejs', '@opentelemetry/*', '@aws-sdk/*', '@huggingface/*', '@solana/*',
  'ws', 'croner', 'opossum', 'generic-pool', 'c-kzg', 'kzg-wasm', 'borsh', 'tweetnacl', 'p-retry', 'yaml', 'prom-client',
]

// Browser plugin
const browserPlugin: BunPlugin = {
  name: 'browser-plugin',
  setup(build) {
    // Shim node:crypto
    build.onResolve({ filter: /^node:crypto$/ }, () => ({
      path: resolve('./web/shims/node-crypto.ts'),
    }))

    // Pino stub
    build.onResolve({ filter: /^pino$/ }, () => ({ path: 'pino', namespace: 'pino-stub' }))
    build.onLoad({ filter: /.*/, namespace: 'pino-stub' }, () => ({
      contents: `
        const logger = {
          debug: console.debug.bind(console),
          info: console.info.bind(console),
          warn: console.warn.bind(console),
          error: console.error.bind(console),
          fatal: console.error.bind(console),
          trace: console.trace.bind(console),
          child: () => logger,
          level: 'info',
        };
        export default function pino() { return logger; }
      `,
      loader: 'js',
    }))

    // Dedupe React
    const reactPath = require.resolve('react')
    const reactDomPath = require.resolve('react-dom')
    build.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }))
    build.onResolve({ filter: /^react-dom$/ }, () => ({ path: reactDomPath }))
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: require.resolve('react/jsx-runtime') }))
    build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({ path: require.resolve('react/jsx-dev-runtime') }))
  },
}

let buildInProgress = false

async function buildFrontend(): Promise<boolean> {
  if (buildInProgress) return true
  buildInProgress = true
  const start = Date.now()

  const result = await Bun.build({
    entrypoints: ['./web/main.tsx'],
    outdir: './dist/dev',
    target: 'browser',
    minify: false,
    sourcemap: 'inline',
    external: EXTERNALS,
    plugins: [browserPlugin],
    define: {
      'process.env': JSON.stringify({ NODE_ENV: 'development', JEJU_NETWORK: 'localnet' }),
      'import.meta.env.VITE_NETWORK': JSON.stringify('localnet'),
      'import.meta.env.PUBLIC_NETWORK': JSON.stringify('localnet'),
      'import.meta.env.PUBLIC_CHAIN_ID': JSON.stringify(String(getChainId('localnet'))),
      'import.meta.env.PUBLIC_RPC_URL': JSON.stringify(getRpcUrl('localnet')),
      'import.meta.env.PUBLIC_WS_URL': JSON.stringify(getWsUrl('localnet')),
      'import.meta.env.PUBLIC_IPFS_API': JSON.stringify(getIpfsApiUrl()),
      'import.meta.env.PUBLIC_IPFS_GATEWAY': JSON.stringify('http://127.0.0.1:4180'),
      'import.meta.env.PUBLIC_INDEXER_URL': JSON.stringify(`http://127.0.0.1:${CORE_PORTS.INDEXER_GRAPHQL.get()}/graphql`),
      'import.meta.env.MODE': JSON.stringify('development'),
      'import.meta.env.DEV': JSON.stringify(true),
      'import.meta.env.PROD': JSON.stringify(false),
    },
  })

  buildInProgress = false

  if (!result.success) {
    console.error('[Factory] Build failed:')
    for (const log of result.logs) console.error(log)
    return false
  }

  // Copy CSS to dist/dev
  if (!existsSync('./dist/dev/styles')) {
    mkdirSync('./dist/dev/styles', { recursive: true })
  }
  const css = await Bun.file('./web/styles/globals.css').text()
  await Bun.write('./dist/dev/styles/globals.css', css)

  console.log(`[Factory] Built in ${Date.now() - start}ms`)
  return true
}

async function startServer(): Promise<void> {
  await mkdir('./dist/dev', { recursive: true })
  if (!(await buildFrontend())) {
    process.exit(1)
  }

  const indexHtml = await Bun.file('./web/index.html').text()
  const devHtml = indexHtml
    .replace('./main.tsx', '/main.js')
    .replace('./styles/globals.css', '/styles/globals.css')
    // Inject Tailwind CDN for dev
    .replace('</head>', `  <script src="https://cdn.tailwindcss.com"></script>\n  </head>`)

  Bun.serve({
    port: FRONTEND_PORT,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      // Proxy API requests
      if (path.startsWith('/api/') || path === '/health' || path.startsWith('/.well-known/') || path.startsWith('/swagger') || path.startsWith('/a2a') || path.startsWith('/mcp')) {
        return fetch(`http://localhost:${API_PORT}${path}${url.search}`, {
          method: req.method,
          headers: req.headers,
          body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
        }).catch(() => new Response('Backend unavailable', { status: 503 }))
      }

      // Serve built JS
      if (path === '/main.js' || path.endsWith('.js') || path.endsWith('.js.map')) {
        const filePath = path === '/main.js' ? './dist/dev/main.js' : `./dist/dev${path}`
        const file = Bun.file(filePath)
        if (await file.exists()) {
          return new Response(file, { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' } })
        }
      }

      // Serve CSS
      if (path.endsWith('.css')) {
        const file = Bun.file(`./dist/dev${path}`)
        if (await file.exists()) {
          return new Response(file, { headers: { 'Content-Type': 'text/css', 'Cache-Control': 'no-cache' } })
        }
        // Fallback to web directory
        const webFile = Bun.file(`./web${path}`)
        if (await webFile.exists()) {
          return new Response(webFile, { headers: { 'Content-Type': 'text/css', 'Cache-Control': 'no-cache' } })
        }
      }

      // Serve public files
      const publicFile = Bun.file(`./public${path}`)
      if (path !== '/' && (await publicFile.exists())) {
        return new Response(publicFile)
      }

      // Serve index.html (SPA fallback)
      return new Response(devHtml, { headers: { 'Content-Type': 'text/html' } })
    },
  })

  console.log(`[Factory] Frontend: http://localhost:${FRONTEND_PORT}`)

  // Watch for changes
  watch('./web', { recursive: true }, async (_, file) => {
    if (file?.endsWith('.ts') || file?.endsWith('.tsx')) {
      console.log(`[Factory] ${file} changed, rebuilding...`)
      await buildFrontend()
    }
  })
}

console.log('[Factory] Starting dev server...\n')
startServer()

