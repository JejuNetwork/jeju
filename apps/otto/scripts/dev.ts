#!/usr/bin/env bun
/**
 * Otto Development Server
 *
 * Starts the Otto bot API server with hot reload.
 * Also serves the built web frontend.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getLocalhostHost } from '@jejunetwork/config'
import type { Server, Subprocess } from 'bun'

const APP_DIR = resolve(import.meta.dir, '..')
const API_PORT = Number(process.env.OTTO_PORT) || 4050
const WEB_PORT = Number(process.env.OTTO_WEB_PORT) || 4051

let apiProcess: Subprocess | null = null
let webServer: Server | null = null
let shuttingDown = false

function cleanup() {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\n[Otto] Shutting down...')
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill()
  }
  if (webServer) {
    webServer.stop()
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

async function buildFrontend(): Promise<boolean> {
  const host = getLocalhostHost()
  console.log('[Otto] Building frontend...')
  
  const distWebDir = resolve(APP_DIR, 'dist/web')
  
  // Run build if dist doesn't exist
  if (!existsSync(distWebDir)) {
    const result = Bun.spawnSync(['bun', 'run', 'scripts/build.ts'], {
      cwd: APP_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    if (result.exitCode !== 0) {
      console.error('[Otto] Failed to build frontend')
      return false
    }
  }
  
  return true
}

function getMimeType(pathname: string): string {
  const ext = pathname.split('.').pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    ico: 'image/x-icon',
    map: 'application/json',
  }
  return mimeTypes[ext ?? ''] ?? 'application/octet-stream'
}

async function startWebServer() {
  const host = getLocalhostHost()
  const distWebDir = resolve(APP_DIR, 'dist/web')
  
  webServer = Bun.serve({
    hostname: host,
    port: WEB_PORT,
    async fetch(req) {
      const url = new URL(req.url)
      let pathname = url.pathname

      // Proxy API requests to API server
      if (pathname.startsWith('/api')) {
        const apiUrl = `http://${host}:${API_PORT}${pathname}${url.search}`
        const apiResponse = await fetch(apiUrl, {
          method: req.method,
          headers: req.headers,
          body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
        })
        return new Response(apiResponse.body, {
          status: apiResponse.status,
          headers: apiResponse.headers,
        })
      }

      // Serve static files from dist/web
      if (pathname === '/') pathname = '/index.html'

      const filePath = resolve(distWebDir, pathname.slice(1))
      const file = Bun.file(filePath)
      
      if (await file.exists()) {
        return new Response(file, {
          headers: { 'Content-Type': getMimeType(pathname) },
        })
      }

      // SPA fallback - serve index.html for client-side routing
      const indexPath = resolve(distWebDir, 'index.html')
      const indexFile = Bun.file(indexPath)
      if (await indexFile.exists()) {
        return new Response(indexFile, {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  console.log(`[Otto] Frontend server running on http://${host}:${WEB_PORT}`)
}

async function main() {
  const host = getLocalhostHost()
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║              Otto Development Server                        ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  // Build frontend first
  const frontendBuilt = await buildFrontend()
  if (!frontendBuilt) {
    process.exit(1)
  }

  console.log(`[Otto] Starting API server on port ${API_PORT}...`)

  apiProcess = Bun.spawn(['bun', '--watch', 'api/server.ts'], {
    cwd: APP_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      OTTO_PORT: String(API_PORT),
    },
  })

  const ready = await waitForPort(API_PORT, 30000)
  if (!ready) {
    console.error('[Otto] Failed to start API server')
    cleanup()
    process.exit(1)
  }

  // Start frontend server
  await startWebServer()

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    Otto is ready                            ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(
    `║  Web:       http://${host}:${WEB_PORT}                          ║`,
  )
  console.log(
    `║  API:       http://${host}:${API_PORT}                          ║`,
  )
  console.log(
    `║  Health:    http://${host}:${API_PORT}/health                   ║`,
  )
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('Press Ctrl+C to stop')

  await apiProcess.exited
}

main().catch((err) => {
  console.error('[Otto] Error:', err)
  cleanup()
})
