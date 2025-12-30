#!/usr/bin/env bun
/**
 * OAuth3 Development Server
 *
 * Starts both API and frontend with hot reload:
 * - API: Bun with --watch on port 4200
 * - Frontend: Dev server with HMR on port 4201
 */

import { watch } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getLocalhostHost } from '@jejunetwork/config'
import type { Subprocess } from 'bun'

const APP_DIR = resolve(import.meta.dir, '..')
const API_PORT = Number(process.env.PORT) || 4200
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 4201

interface ProcessInfo {
  name: string
  process: Subprocess
}

const processes: ProcessInfo[] = []
let shuttingDown = false

function cleanup() {
  if (shuttingDown) return
  shuttingDown = true

  console.log('\n[OAuth3] Shutting down...')

  for (const { name, process } of processes) {
    console.log(`[OAuth3] Stopping ${name}...`)
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
  console.log(`[OAuth3] Starting API server on port ${API_PORT}...`)

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
    console.error('[OAuth3] Failed to start API server')
    return false
  }

  console.log(`[OAuth3] API server started on port ${API_PORT}`)
  return true
}

async function startFrontendServer(): Promise<boolean> {
  console.log(`[OAuth3] Starting frontend dev server on port ${FRONTEND_PORT}...`)

  await mkdir(resolve(APP_DIR, 'dist/dev'), { recursive: true })

  // Build frontend initially
  const buildSuccess = await buildFrontend()
  if (!buildSuccess) {
    console.error('[OAuth3] Initial frontend build failed')
    return false
  }

  // Read the original index.html
  const indexHtml = await readFile(resolve(APP_DIR, 'web/index.html'), 'utf-8')
  const devHtml = indexHtml.replace('/app.ts', '/app.js')

  const host = getLocalhostHost()

  Bun.serve({
    port: FRONTEND_PORT,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url)
      const pathname = url.pathname

      // Proxy API requests to the API server
      if (
        pathname.startsWith('/api') ||
        pathname.startsWith('/auth') ||
        pathname.startsWith('/oauth') ||
        pathname.startsWith('/wallet') ||
        pathname.startsWith('/farcaster') ||
        pathname.startsWith('/session') ||
        pathname.startsWith('/client') ||
        pathname === '/health' ||
        pathname.startsWith('/.well-known')
      ) {
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
          console.error('[OAuth3] Proxy error:', (error as Error).message)
          return new Response(
            JSON.stringify({ error: 'Backend unavailable' }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
      }

      // Serve index.html for root and callback
      if (pathname === '/' || pathname === '/callback') {
        return new Response(devHtml, {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      // Serve built JS from dist/dev
      if (pathname === '/app.js') {
        const file = Bun.file(resolve(APP_DIR, 'dist/dev/app.js'))
        if (await file.exists()) {
          return new Response(file, {
            headers: {
              'Content-Type': 'application/javascript',
              'Cache-Control': 'no-cache',
            },
          })
        }
      }

      // Serve static files from web/
      const webFile = Bun.file(resolve(APP_DIR, `web${pathname}`))
      if (await webFile.exists()) {
        return new Response(webFile, {
          headers: { 'Content-Type': getContentType(pathname) },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  console.log(`[OAuth3] Frontend dev server started on port ${FRONTEND_PORT}`)

  // Watch for changes
  watch(resolve(APP_DIR, 'web'), { recursive: true }, (_eventType, filename) => {
    if (filename && (filename.endsWith('.ts') || filename.endsWith('.html'))) {
      console.log(`[OAuth3] ${filename} changed, rebuilding...`)
      buildFrontend()
    }
  })

  return true
}

let buildInProgress = false

async function buildFrontend(): Promise<boolean> {
  if (buildInProgress) return false
  buildInProgress = true

  const startTime = Date.now()

  const result = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'web/app.ts')],
    outdir: resolve(APP_DIR, 'dist/dev'),
    target: 'browser',
    minify: false,
    sourcemap: 'inline',
  })

  buildInProgress = false

  if (!result.success) {
    console.error('[OAuth3] Frontend build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    return false
  }

  const duration = Date.now() - startTime
  console.log(`[OAuth3] Frontend built in ${duration}ms`)
  return true
}

function getContentType(path: string): string {
  if (path.endsWith('.js')) return 'application/javascript'
  if (path.endsWith('.ts')) return 'application/typescript'
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
  console.log('║              OAuth3 Development Server                      ║')
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
  console.log('║                    OAuth3 is ready                          ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(`║  API:       http://${host}:${API_PORT}                          ║`)
  console.log(`║  Frontend:  http://${host}:${FRONTEND_PORT}                          ║`)
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('Press Ctrl+C to stop all services')

  // Keep the process running
  await Promise.all(processes.map((p) => p.process.exited))
}

main().catch((err) => {
  console.error('[OAuth3] Error:', err)
  cleanup()
  process.exit(1)
})
