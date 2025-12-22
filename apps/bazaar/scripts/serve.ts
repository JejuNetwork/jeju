/**
 * Production server script
 * Serves the built static files
 */

const PORT = Number(process.env.PORT) || 4006

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    let path = url.pathname

    // API proxy
    if (path.startsWith('/api/')) {
      const apiUrl = process.env.API_URL || 'http://localhost:4007'
      return fetch(new URL(path + url.search, apiUrl), {
        method: req.method,
        headers: req.headers,
        body: req.body,
      })
    }

    // Try to serve static file
    if (path === '/') {
      path = '/index.html'
    }

    const file = Bun.file(`./dist${path}`)
    if (await file.exists()) {
      const contentType = getContentType(path)
      return new Response(await file.arrayBuffer(), {
        headers: { 'Content-Type': contentType },
      })
    }

    // SPA fallback
    const indexFile = Bun.file('./dist/index.html')
    if (await indexFile.exists()) {
      return new Response(await indexFile.arrayBuffer(), {
        headers: { 'Content-Type': 'text/html' },
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
  return 'application/octet-stream'
}

console.log(`🏝️ Bazaar running at http://localhost:${PORT}`)
