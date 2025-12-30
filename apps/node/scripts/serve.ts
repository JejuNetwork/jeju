#!/usr/bin/env bun
/**
 * Node Production Serve Script
 *
 * Serves the built static frontend for production testing.
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getLocalhostHost } from '@jejunetwork/config'

const APP_DIR = resolve(import.meta.dir, '..')
const PORT = Number(process.env.PORT) || 1420
const STATIC_DIR = resolve(APP_DIR, 'dist/static')

async function main() {
  const host = getLocalhostHost()
  console.log('[Node] Starting production server...')

  // Check if build exists
  if (!existsSync(resolve(STATIC_DIR, 'index.html'))) {
    console.log('[Node] Build not found, running build first...')
    const buildProc = Bun.spawn(['bun', 'run', 'scripts/build.ts'], {
      cwd: APP_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    await buildProc.exited
  }

  Bun.serve({
    port: PORT,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url)
      let path = url.pathname

      // Health check
      if (path === '/health') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // SPA fallback
      if (path === '/' || !path.includes('.')) {
        path = '/index.html'
      }

      const file = Bun.file(join(STATIC_DIR, path))
      if (await file.exists()) {
        const contentType = path.endsWith('.js')
          ? 'application/javascript'
          : path.endsWith('.css')
            ? 'text/css'
            : path.endsWith('.html')
              ? 'text/html'
              : 'application/octet-stream'
        return new Response(file, {
          headers: { 'Content-Type': contentType },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║            Node Production Server Ready                     ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(`║  Server:    http://${host}:${PORT}                         ║`)
  console.log(`║  Health:    http://${host}:${PORT}/health                  ║`)
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('Press Ctrl+C to stop')
}

main().catch((err) => {
  console.error('[Node] Error:', err)
  process.exit(1)
})
