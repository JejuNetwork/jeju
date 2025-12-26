/**
 * Development server for example app frontend
 * Serves static files, transpiles TypeScript, and proxies API requests to the backend
 */

const FRONTEND_PORT = 4501
const API_PORT = 4500

// Build and cache the bundled app.js
let cachedBundle: string | null = null
let lastBuildTime = 0

async function buildBundle(): Promise<string> {
  const now = Date.now()
  // Rebuild if cache is stale (more than 500ms old) or doesn't exist
  if (cachedBundle && now - lastBuildTime < 500) {
    return cachedBundle
  }

  const result = await Bun.build({
    entrypoints: ['./web/app.ts'],
    target: 'browser',
    format: 'esm',
    minify: false,
    sourcemap: 'inline',
  })

  if (!result.success) {
    console.error('Build failed:', result.logs)
    throw new Error('Bundle build failed')
  }

  cachedBundle = await result.outputs[0].text()
  lastBuildTime = now
  return cachedBundle
}

const server = Bun.serve({
  port: FRONTEND_PORT,
  async fetch(req) {
    const url = new URL(req.url)
    let path = url.pathname

    // Proxy API requests to backend
    if (
      path.startsWith('/api/') ||
      path.startsWith('/a2a') ||
      path.startsWith('/mcp') ||
      path.startsWith('/x402') ||
      path.startsWith('/auth') ||
      path === '/health'
    ) {
      const backendUrl = `http://localhost:${API_PORT}${path}${url.search}`
      const headers = new Headers(req.headers)
      headers.delete('host')

      const response = await fetch(backendUrl, {
        method: req.method,
        headers,
        body:
          req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
        redirect: 'follow',
      })

      const responseHeaders = new Headers(response.headers)
      responseHeaders.set('Access-Control-Allow-Origin', '*')

      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      })
    }

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods':
            'GET, POST, PUT, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, X-Payment, x-jeju-address, x-jeju-timestamp, x-jeju-signature, x-oauth3-session',
        },
      })
    }

    // Serve index.html for root
    if (path === '/') {
      path = '/index.html'
    }

    // Serve bundled app.ts as JavaScript
    if (path === '/app.ts' || path === '/app.js') {
      const bundle = await buildBundle()
      return new Response(bundle, {
        headers: { 'Content-Type': 'application/javascript' },
      })
    }

    // Try to serve static file from web directory
    const file = Bun.file(`./web${path}`)
    if (await file.exists()) {
      const contentType = getContentType(path)
      return new Response(file, {
        headers: contentType ? { 'Content-Type': contentType } : undefined,
      })
    }

    // SPA fallback - return index.html for unknown routes
    return new Response(Bun.file('./web/index.html'), {
      headers: { 'Content-Type': 'text/html' },
    })
  },
})

function getContentType(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  const types: Record<string, string> = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
  }
  return ext ? types[ext] : undefined
}

console.log(`Example frontend dev server: http://localhost:${server.port}`)
console.log(`  Proxying API requests to: http://localhost:${API_PORT}`)
