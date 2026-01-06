#!/usr/bin/env bun

/**
 * Example App Development Server
 *
 * Starts both API and frontend with hot reload.
 */

import { watch } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getLocalhostHost } from '@jejunetwork/config'
import type { BunPlugin, Subprocess } from 'bun'

const APP_DIR = resolve(import.meta.dir, '..')

// React paths for browser build
const reactPath = require.resolve('react')
const reactDomPath = require.resolve('react-dom')

// Plugin to resolve workspace packages for browser builds
const browserPlugin: BunPlugin = {
  name: 'browser-resolve',
  setup(build) {
    // Resolve React properly
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

    // Resolve workspace packages from source
    build.onResolve({ filter: /^@jejunetwork\/shared$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/shared/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/types$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/types/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/sdk$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/sdk/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/config$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/config/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/auth\/react$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/auth/src/react/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/auth\/types$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/auth/src/types.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/auth$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/auth/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/ui\/auth$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/ui/src/auth/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/ui$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/ui/src/index.ts'),
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
  'elysia',
  '@elysiajs/*',
]
const API_PORT = Number(process.env.API_PORT) || 3001
const FRONTEND_PORT = Number(process.env.PORT) || 3000

interface ProcessInfo {
  name: string
  process: Subprocess
}

const processes: ProcessInfo[] = []
let shuttingDown = false

function cleanup() {
  if (shuttingDown) return
  shuttingDown = true

  console.log('\n[Example] Shutting down...')

  for (const { name, process } of processes) {
    console.log(`[Example] Stopping ${name}...`)
    try {
      process.kill()
    } catch {
      // Process may have already exited
    }
  }

  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

async function waitForPort(port: number, timeout = 30000): Promise<boolean> {
  const host = getLocalhostHost()
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://${host}:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      })
      if (response.ok) return true
    } catch {
      // Port not ready yet
    }
    await Bun.sleep(500)
  }
  return false
}

async function startAPIServer(): Promise<boolean> {
  console.log(`[Example] Starting API server on port ${API_PORT}...`)

  const proc = Bun.spawn(['bun', '--watch', 'api/index.ts'], {
    cwd: APP_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      PORT: String(API_PORT),
    },
  })

  processes.push({ name: 'api', process: proc })

  const ready = await waitForPort(API_PORT, 30000)
  if (!ready) {
    console.error('[Example] Failed to start API server')
    return false
  }

  console.log(`[Example] API server started on port ${API_PORT}`)
  return true
}

let buildInProgress = false

async function buildFrontend(): Promise<boolean> {
  if (buildInProgress) return false
  buildInProgress = true

  const startTime = Date.now()

  const result = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'web/main.tsx')],
    outdir: resolve(APP_DIR, 'dist/dev'),
    target: 'browser',
    minify: false,
    sourcemap: 'inline',
    external: BROWSER_EXTERNALS,
    plugins: [browserPlugin],
    define: {
      'process.env.NODE_ENV': JSON.stringify('development'),
      'process.browser': 'true',
      'globalThis.process': JSON.stringify({
        env: { NODE_ENV: 'development' },
        browser: true,
      }),
    },
    naming: 'app.js',
  })

  buildInProgress = false

  if (!result.success) {
    console.error('[Example] Frontend build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    return false
  }

  const duration = Date.now() - startTime
  console.log(`[Example] Frontend built in ${duration}ms`)
  return true
}

async function startFrontendServer(): Promise<boolean> {
  console.log(
    `[Example] Starting frontend dev server on port ${FRONTEND_PORT}...`,
  )

  await mkdir(resolve(APP_DIR, 'dist/dev'), { recursive: true })

  const buildSuccess = await buildFrontend()
  if (!buildSuccess) {
    console.error('[Example] Initial frontend build failed')
    return false
  }

  const indexHtml = await readFile(resolve(APP_DIR, 'web/index.html'), 'utf-8')
  // Replace ./main.tsx with /app.js to serve the built bundle
  const devHtml = indexHtml.replace('./main.tsx', '/app.js')

  const host = getLocalhostHost()

  Bun.serve({
    port: FRONTEND_PORT,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url)
      const pathname = url.pathname

      // Proxy API requests
      if (pathname.startsWith('/api') || pathname === '/health') {
        const targetUrl = `http://${host}:${API_PORT}${pathname}${url.search}`
        try {
          const proxyResponse = await fetch(targetUrl, {
            method: req.method,
            headers: req.headers,
            body:
              req.method !== 'GET' && req.method !== 'HEAD'
                ? req.body
                : undefined,
          })
          return proxyResponse
        } catch (error) {
          console.error('[Example] Proxy error:', (error as Error).message)
          return new Response(
            JSON.stringify({ error: 'Backend unavailable' }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
      }

      // SPA fallback
      if (pathname === '/' || !pathname.includes('.')) {
        return new Response(devHtml, {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      // Serve compiled app.js from dist/dev
      if (pathname === '/app.js') {
        const bundleFile = Bun.file(resolve(APP_DIR, 'dist/dev/app.js'))
        if (await bundleFile.exists()) {
          return new Response(bundleFile, {
            headers: {
              'Content-Type': 'application/javascript',
              'Cache-Control': 'no-cache',
            },
          })
        }
      }

      // Serve from dist/dev
      const devFile = Bun.file(resolve(APP_DIR, `dist/dev${pathname}`))
      if (await devFile.exists()) {
        return new Response(devFile, {
          headers: {
            'Content-Type': getContentType(pathname),
            'Cache-Control': 'no-cache',
          },
        })
      }

      // Serve from web/
      const webFile = Bun.file(resolve(APP_DIR, `web${pathname}`))
      if (await webFile.exists()) {
        return new Response(webFile, {
          headers: { 'Content-Type': getContentType(pathname) },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  console.log(`[Example] Frontend dev server started on port ${FRONTEND_PORT}`)

  // Watch for changes
  watch(
    resolve(APP_DIR, 'web'),
    { recursive: true },
    (_eventType, filename) => {
      if (filename && (filename.endsWith('.ts') || filename.endsWith('.tsx'))) {
        console.log(`[Example] ${filename} changed, rebuilding...`)
        buildFrontend()
      }
    },
  )

  return true
}

function getContentType(path: string): string {
  if (path.endsWith('.js')) return 'application/javascript'
  if (path.endsWith('.css')) return 'text/css'
  if (path.endsWith('.html')) return 'text/html'
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  return 'application/octet-stream'
}

async function main() {
  const host = getLocalhostHost()
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║             Example Development Server                      ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  // Start API server first
  if (!(await startAPIServer())) {
    cleanup()
    process.exit(1)
  }

  // Start frontend dev server
  if (!(await startFrontendServer())) {
    cleanup()
    process.exit(1)
  }

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                   Example is ready                          ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(
    `║  API:       http://${host}:${API_PORT}                          ║`,
  )
  console.log(
    `║  Frontend:  http://${host}:${FRONTEND_PORT}                          ║`,
  )
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('Press Ctrl+C to stop all services')

  // Keep running
  await Promise.all(processes.map((p) => p.process.exited))
}

main().catch((err) => {
  console.error('[Example] Error:', err)
  cleanup()
  process.exit(1)
})
