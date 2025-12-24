/**
 * Crucible Production Server
 *
 * Serves the built frontend and API from dist/
 */

const PORT = Number(process.env.PORT) || 4020

async function main(): Promise<void> {
  Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url)
      const pathname = url.pathname

      // API routes - proxy to the API process or serve directly
      if (
        pathname.startsWith('/api/') ||
        pathname.startsWith('/health') ||
        pathname.startsWith('/info') ||
        pathname.startsWith('/metrics') ||
        pathname.startsWith('/.well-known/')
      ) {
        // In production, API is served from the same process
        // This script is just for the static frontend
        return new Response(
          JSON.stringify({ error: 'API not available in static mode' }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      // Serve static files from dist/web
      const filePath =
        pathname === '/' || !pathname.includes('.') ? '/index.html' : pathname
      const file = Bun.file(`./dist/web${filePath}`)

      if (await file.exists()) {
        const contentType = getContentType(filePath)
        return new Response(file, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control':
              filePath === '/index.html'
                ? 'no-cache'
                : 'public, max-age=31536000, immutable',
          },
        })
      }

      // SPA fallback
      const indexFile = Bun.file('./dist/web/index.html')
      if (await indexFile.exists()) {
        return new Response(indexFile, {
          headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  console.log(`Crucible serving on http://localhost:${PORT}`)
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

main()
