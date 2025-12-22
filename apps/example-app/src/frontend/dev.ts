/**
 * Frontend Development Server
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '4501', 10)
const frontendDir = join(import.meta.dir)

const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.ts': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

// Sanitize path to prevent directory traversal attacks
function sanitizePath(pathname: string): string | null {
  // Normalize and decode the path
  let normalized = decodeURIComponent(pathname)

  // Remove any null bytes (poison null byte attack)
  normalized = normalized.replace(/\0/g, '')

  // Resolve the path relative to frontendDir
  const resolved = join(frontendDir, normalized)

  // Ensure the resolved path is still within frontendDir
  // Use realpath-like check by comparing normalized prefixes
  const resolvedNormalized = resolved.replace(/\\/g, '/')
  const frontendDirNormalized = frontendDir.replace(/\\/g, '/')

  if (
    !resolvedNormalized.startsWith(`${frontendDirNormalized}/`) &&
    resolvedNormalized !== frontendDirNormalized
  ) {
    return null // Path traversal attempt detected
  }

  return resolved
}

Bun.serve({
  port: FRONTEND_PORT,
  async fetch(req) {
    const url = new URL(req.url)
    let pathname = url.pathname

    // Serve index.html for root
    if (pathname === '/') {
      pathname = '/index.html'
    }

    // Sanitize the path to prevent directory traversal
    const safePath = sanitizePath(pathname)
    if (!safePath) {
      return new Response('Forbidden', { status: 403 })
    }

    // Handle TypeScript -> JavaScript transpilation
    if (pathname.endsWith('.ts')) {
      if (existsSync(safePath)) {
        const transpiled = await Bun.build({
          entrypoints: [safePath],
          target: 'browser',
        })

        if (transpiled.success) {
          const output = await transpiled.outputs[0].text()
          return new Response(output, {
            headers: { 'Content-Type': 'application/javascript' },
          })
        }
      }
    }

    // Serve static files
    if (existsSync(safePath)) {
      const content = readFileSync(safePath)
      const ext = pathname.split('.').pop() || ''
      const contentType = mimeTypes[`.${ext}`] || 'application/octet-stream'
      return new Response(content, {
        headers: { 'Content-Type': contentType },
      })
    }

    // 404
    return new Response('Not Found', { status: 404 })
  },
})

console.log(`Frontend dev server running at http://localhost:${FRONTEND_PORT}`)
