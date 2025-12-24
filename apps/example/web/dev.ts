import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '4501', 10)
const API_PORT = parseInt(process.env.PORT || '4500', 10)
const API_URL = process.env.API_URL || `http://localhost:${API_PORT}`

const frontendDir = import.meta.dir
const distDir = join(frontendDir, '../dist/dev')

const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.ts': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const buildCache: Map<string, { content: string; mtime: number }> = new Map()

async function buildFile(filePath: string): Promise<string | null> {
  const stat = Bun.file(filePath)
  const exists = await stat.exists()
  if (!exists) return null

  const mtime = stat.lastModified
  const cached = buildCache.get(filePath)
  if (cached && cached.mtime === mtime) {
    return cached.content
  }

  const result = await Bun.build({
    entrypoints: [filePath],
    target: 'browser',
    minify: false,
    sourcemap: 'inline',
    define: {
      'process.env.NODE_ENV': JSON.stringify('development'),
      'process.env.API_URL': JSON.stringify(API_URL),
    },
  })

  if (!result.success) {
    console.error(`❌ Build failed for ${filePath}:`)
    for (const log of result.logs) {
      console.error(log)
    }
    return null
  }

  const content = await result.outputs[0].text()
  buildCache.set(filePath, { content, mtime })
  return content
}

/**
 * Sanitize path to prevent directory traversal attacks
 */
function sanitizePath(pathname: string): string | null {
  let normalized = decodeURIComponent(pathname)
  normalized = normalized.replace(/\0/g, '')

  const resolved = join(frontendDir, normalized)
  const resolvedNormalized = resolved.replace(/\\/g, '/')
  const frontendDirNormalized = frontendDir.replace(/\\/g, '/')

  if (
    !resolvedNormalized.startsWith(`${frontendDirNormalized}/`) &&
    resolvedNormalized !== frontendDirNormalized
  ) {
    return null
  }

  return resolved
}

/**
 * Proxy API requests to backend
 */
async function proxyToApi(req: Request, pathname: string): Promise<Response> {
  const url = new URL(req.url)
  const targetUrl = `${API_URL}${pathname}${url.search}`

  const proxyResponse = await fetch(targetUrl, {
    method: req.method,
    headers: req.headers,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
  }).catch((error) => {
    console.error(`[Proxy] Error: ${error.message}`)
    return new Response(JSON.stringify({ error: 'Backend unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  return proxyResponse
}

/**
 * Start the development server
 */
async function startServer(): Promise<void> {
  await mkdir(distDir, { recursive: true })

  // Pre-build main entry point
  const mainEntry = join(frontendDir, 'app.ts')
  const buildResult = await buildFile(mainEntry)
  if (buildResult) {
    console.log(`📦 Built app.ts (${buildResult.length} bytes)`)
  }

  Bun.serve({
    port: FRONTEND_PORT,
    async fetch(req) {
      const url = new URL(req.url)
      let pathname = url.pathname

      // Proxy API requests to backend
      if (
        pathname.startsWith('/api/') ||
        pathname.startsWith('/a2a') ||
        pathname.startsWith('/mcp') ||
        pathname.startsWith('/x402') ||
        pathname.startsWith('/auth') ||
        pathname.startsWith('/health') ||
        pathname.startsWith('/docs') ||
        pathname.startsWith('/webhooks')
      ) {
        return proxyToApi(req, pathname)
      }

      // Serve index.html for root
      if (pathname === '/') {
        pathname = '/index.html'
      }

      // Sanitize path
      const safePath = sanitizePath(pathname)
      if (!safePath) {
        return new Response('Forbidden', { status: 403 })
      }

      // Handle TypeScript transpilation
      if (pathname.endsWith('.ts')) {
        const content = await buildFile(safePath)
        if (content) {
          return new Response(content, {
            headers: {
              'Content-Type': 'application/javascript',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
            },
          })
        }
      }

      // Serve static files
      const file = Bun.file(safePath)
      if (await file.exists()) {
        const ext = pathname.split('.').pop() || ''
        const contentType = mimeTypes[`.${ext}`] || 'application/octet-stream'
        return new Response(file, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              FRONTEND DEV SERVER                              ║
╠══════════════════════════════════════════════════════════════╣
║  URL:          http://localhost:${FRONTEND_PORT}                       ║
║  API Proxy:    ${API_URL.padEnd(43)}║
╠══════════════════════════════════════════════════════════════╣
║  HMR:          Enabled (bun --watch)                          ║
║  Sourcemaps:   Inline                                         ║
╚══════════════════════════════════════════════════════════════╝
`)
}

startServer()
