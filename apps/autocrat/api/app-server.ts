/**
 * Autocrat App - Production Server
 *
 * Serves the built React SPA and proxies API requests to the council backend.
 * For development, use `bun ./index.html` directly.
 */

const PORT = parseInt(process.env.PORT || '3010', 10)
const API_URL = process.env.COUNCIL_API_URL || 'http://localhost:8010'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

async function proxyRequest(request: Request, path: string): Promise<Response> {
  const url = new URL(request.url)
  const targetUrl = `${API_URL}${path}${url.search}`

  const headers = new Headers(request.headers)
  headers.delete('host')

  const response = await fetch(targetUrl, {
    method: request.method,
    headers,
    body:
      request.method !== 'GET' && request.method !== 'HEAD'
        ? await request.text()
        : undefined,
  })

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

async function serveStatic(pathname: string): Promise<Response | null> {
  const distPath = `${import.meta.dir}/dist`

  const filePath = `${distPath}${pathname}`
  const file = Bun.file(filePath)

  if (await file.exists()) {
    const ext = pathname.substring(pathname.lastIndexOf('.'))
    return new Response(file, {
      headers: {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': pathname.includes('-')
          ? 'public, max-age=31536000'
          : 'no-cache',
      },
    })
  }

  return null
}

async function serveIndex(): Promise<Response> {
  const indexPath = `${import.meta.dir}/dist/index.html`
  const file = Bun.file(indexPath)

  if (await file.exists()) {
    return new Response(file, {
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' },
    })
  }

  return new Response('Not found - run bun run build first', { status: 404 })
}

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url)
    const pathname = url.pathname

    // Proxy API requests
    if (
      pathname.startsWith('/api/') ||
      pathname.startsWith('/a2a') ||
      pathname.startsWith('/mcp/')
    ) {
      return proxyRequest(request, pathname)
    }

    // Try to serve static files
    const staticResponse = await serveStatic(pathname)
    if (staticResponse) {
      return staticResponse
    }

    // SPA fallback - serve index.html for all routes
    return serveIndex()
  },
})

console.log(`🏛️ Autocrat running at http://localhost:${server.port}`)
