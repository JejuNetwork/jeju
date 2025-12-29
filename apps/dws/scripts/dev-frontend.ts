/**
 * DWS Frontend Dev Server
 *
 * Custom dev server with proper externals to avoid bundling server-only code.
 */

import { existsSync, watch } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getDWSUrl, getLocalhostHost } from '@jejunetwork/config'
import type { BunPlugin } from 'bun'

const PORT =
  Number(typeof process !== 'undefined' ? process.env.PORT : undefined) || 4031
const API_URL =
  (typeof process !== 'undefined' ? process.env.API_URL : undefined) ||
  getDWSUrl() ||
  `http://${getLocalhostHost()}:4030`

// Resolve paths for React and ReactDOM to ensure a single instance
const reactPath = require.resolve('react')
const reactDomPath = require.resolve('react-dom')

// Plugin to replace server-only modules with browser shims
const browserShimPlugin: BunPlugin = {
  name: 'browser-shims',
  setup(build) {
    // Shim pino and pino-pretty
    build.onResolve({ filter: /^pino(-pretty)?$/ }, () => ({
      path: resolve('./web/shims/pino.ts'),
    }))

    // Resolve workspace packages to their source for proper bundling
    build.onResolve({ filter: /^@jejunetwork\/oauth3$/ }, () => ({
      path: resolve('../../packages/auth/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/shared$/ }, () => ({
      path: resolve('../../packages/shared/src/index.ts'),
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

    // Ensure React and ReactDOM resolve to the same instance
    build.onResolve({ filter: /^react$/ }, () => ({
      path: reactPath,
    }))
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
      path: require.resolve('react/jsx-runtime'),
    }))
    build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
      path: require.resolve('react/jsx-dev-runtime'),
    }))
    build.onResolve({ filter: /^react-dom$/ }, () => ({
      path: reactDomPath,
    }))
    build.onResolve({ filter: /^react-dom\/client$/ }, () => ({
      path: require.resolve('react-dom/client'),
    }))
  },
}

// Server-only packages that should not be bundled for browser
const EXTERNALS = [
  // Node builtins
  'bun:sqlite',
  'node:*',
  'fs',
  'path',
  'crypto',
  'http',
  'https',
  'net',
  'tls',
  'dns',
  'stream',
  'child_process',
  'worker_threads',
  'module',

  // Server-only Jeju packages
  '@jejunetwork/db',
  '@jejunetwork/kms',
  '@jejunetwork/deployment',
  '@jejunetwork/training',

  // Server frameworks
  'elysia',
  '@elysiajs/*',

  // Server dependencies
  'ioredis',
  'pino',
  'pino-pretty',
  'croner',
  'cockatiel',
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

  // Other server-only
  '@google-cloud/*',
  '@grpc/*',
  'google-gax',
  'google-auth-library',
  'native-dns',
  'native-dns-cache',
  '@farcaster/hub-nodejs',
  '@opentelemetry/*',
  'typeorm',
]

let buildInProgress = false

async function buildFrontend(): Promise<boolean> {
  if (buildInProgress) return false
  buildInProgress = true

  const startTime = Date.now()

  const result = await Bun.build({
    entrypoints: ['./web/main.tsx'],
    outdir: './dist/dev',
    target: 'browser',
    splitting: false, // Disable splitting to match production build
    packages: 'bundle', // Bundle all packages to match production
    minify: false,
    sourcemap: 'inline',
    external: EXTERNALS,
    plugins: [browserShimPlugin],
    define: {
      'process.env.NODE_ENV': JSON.stringify('development'),
      'process.browser': 'true',
      process: JSON.stringify({
        env: { NODE_ENV: 'development' },
        browser: true,
      }),
    },
  })

  buildInProgress = false

  if (!result.success) {
    console.error('[DWS Frontend] Build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    return false
  }

  const duration = Date.now() - startTime
  console.log(`[DWS Frontend] Built in ${duration}ms`)
  return true
}

function getContentType(path: string): string {
  if (path.endsWith('.js')) return 'application/javascript'
  if (path.endsWith('.css')) return 'text/css'
  if (path.endsWith('.html')) return 'text/html'
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.woff2')) return 'font/woff2'
  if (path.endsWith('.woff')) return 'font/woff'
  return 'application/octet-stream'
}

async function main() {
  await mkdir('./dist/dev', { recursive: true })

  const success = await buildFrontend()
  if (!success) {
    console.error('Initial build failed')
    process.exit(1)
  }

  // Read the original index.html and update the script path
  const indexHtml = await readFile('./index.html', 'utf-8')
  const devHtml = indexHtml.replace('/web/main.tsx', '/main.js')

  Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url)
      const pathname = url.pathname

      // Proxy API requests
      if (
        pathname.startsWith('/api/') ||
        pathname === '/health' ||
        pathname.startsWith('/.well-known/')
      ) {
        const targetUrl = `${API_URL}${pathname}${url.search}`
        const proxyResponse = await fetch(targetUrl, {
          method: req.method,
          headers: req.headers,
          body:
            req.method !== 'GET' && req.method !== 'HEAD'
              ? req.body
              : undefined,
        }).catch((error) => {
          console.error('[DWS] Proxy error:', error.message)
          return new Response(
            JSON.stringify({ error: 'Backend unavailable' }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        })
        return proxyResponse
      }

      // SPA fallback for client-side routes
      if (pathname !== '/' && !pathname.includes('.')) {
        return new Response(devHtml, {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      // Serve index.html
      if (pathname === '/' || pathname === '/index.html') {
        return new Response(devHtml, {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      // Serve from dist/dev
      const devFile = Bun.file(`./dist/dev${pathname}`)
      if (await devFile.exists()) {
        return new Response(devFile, {
          headers: {
            'Content-Type': getContentType(pathname),
            'Cache-Control': 'no-cache',
          },
        })
      }

      // Serve CSS from web/styles
      if (pathname.endsWith('.css')) {
        const cssFile = Bun.file(`./web/styles${pathname}`)
        if (await cssFile.exists()) {
          return new Response(cssFile, {
            headers: {
              'Content-Type': 'text/css',
              'Cache-Control': 'no-cache',
            },
          })
        }
        // Also try web directly
        const webCss = Bun.file(`./web${pathname}`)
        if (await webCss.exists()) {
          return new Response(webCss, {
            headers: {
              'Content-Type': 'text/css',
              'Cache-Control': 'no-cache',
            },
          })
        }
      }

      // Serve public files
      const publicFile = Bun.file(`./public${pathname}`)
      if (await publicFile.exists()) {
        return new Response(publicFile, {
          headers: { 'Content-Type': getContentType(pathname) },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  console.log(`[DWS Frontend] http://localhost:${PORT}`)
  console.log(`[DWS Frontend] API proxy: ${API_URL}`)

  // Watch for changes
  for (const dir of ['./web', './lib']) {
    if (existsSync(dir)) {
      watch(dir, { recursive: true }, (_eventType, filename) => {
        if (
          filename &&
          (filename.endsWith('.ts') ||
            filename.endsWith('.tsx') ||
            filename.endsWith('.css'))
        ) {
          console.log(`[DWS] ${filename} changed, rebuilding...`)
          buildFrontend()
        }
      })
    }
  }
}

main()
