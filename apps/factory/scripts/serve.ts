/**
 * Factory Production Server
 *
 * Serves the built static files from dist/client/
 * and proxies API requests to the standalone API server.
 */

import { CORE_PORTS } from '@jejunetwork/config'

const PORT = CORE_PORTS.FACTORY.get()
const API_PORT = CORE_PORTS.FACTORY_API.get()
const STATIC_DIR = './dist/client'

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    let path = url.pathname

    // API proxy
    if (
      path.startsWith('/api/') ||
      path.startsWith('/health') ||
      path.startsWith('/.well-known/') ||
      path.startsWith('/swagger') ||
      path.startsWith('/a2a') ||
      path.startsWith('/mcp')
    ) {
      return fetch(`http://localhost:${API_PORT}${path}${url.search}`, {
        method: req.method,
        headers: req.headers,
        body:
          req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      }).catch(
        () =>
          new Response(JSON.stringify({ error: 'Backend unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
      )
    }

    // Normalize path
    if (path === '/') path = '/index.html'

    // Try to serve static file
    const file = Bun.file(`${STATIC_DIR}${path}`)
    if (await file.exists()) {
      return new Response(await file.arrayBuffer(), {
        headers: {
          'Content-Type': getContentType(path),
          'Cache-Control': getCacheControl(path),
        },
      })
    }

    // Check for chunks directory
    if (path.startsWith('/chunks/')) {
      const chunkFile = Bun.file(`${STATIC_DIR}${path}`)
      if (await chunkFile.exists()) {
        return new Response(await chunkFile.arrayBuffer(), {
          headers: {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        })
      }
    }

    // SPA fallback
    const indexFile = Bun.file(`${STATIC_DIR}/index.html`)
    if (await indexFile.exists()) {
      return new Response(await indexFile.arrayBuffer(), {
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' },
      })
    }

    return new Response('Not Found', { status: 404 })
  },
})

function getContentType(path: string): string {
  if (path.endsWith('.js')) return 'application/javascript'
  if (path.endsWith('.css')) return 'text/css'
  if (path.endsWith('.html')) return 'text/html'
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.map')) return 'application/json'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.woff2')) return 'font/woff2'
  if (path.endsWith('.woff')) return 'font/woff'
  return 'application/octet-stream'
}

function getCacheControl(path: string): string {
  // Hash-named files are immutable
  if (path.match(/-[a-f0-9]{8,}\.(js|css)$/)) {
    return 'public, max-age=31536000, immutable'
  }
  if (path.endsWith('.js') || path.endsWith('.css')) {
    return 'public, max-age=86400'
  }
  if (path.endsWith('.html')) {
    return 'no-cache'
  }
  return 'public, max-age=3600'
}

console.log(`Factory serving on http://localhost:${PORT}`)
console.log(`  API: http://localhost:${API_PORT}`)
console.log(`  Static: ${STATIC_DIR}`)
