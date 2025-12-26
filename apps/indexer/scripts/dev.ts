/**
 * Dev server for the indexer frontend
 * Builds and serves the React app with hot reloading
 */

import { watch } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $ } from 'bun'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, '..')

const PORT = Number(process.env.PORT) || 4355

async function killPort(port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid port number')
  }

  const result = await $`lsof -ti:${port}`.nothrow().quiet()
  if (result.exitCode === 0 && result.stdout.toString().trim()) {
    const pids = result.stdout.toString().trim().split('\n').filter(Boolean)
    for (const pid of pids) {
      if (/^\d+$/.test(pid)) {
        await $`kill -9 ${pid}`.nothrow().quiet()
      }
    }
  }
}

// Build the frontend
async function build(): Promise<boolean> {
  const result = await Bun.build({
    entrypoints: [join(rootDir, 'web/main.tsx')],
    outdir: join(rootDir, 'dist/web'),
    target: 'browser',
    minify: false,
    sourcemap: 'external',
    external: [
      // Server-only packages that should never be in browser bundle
      '@google-cloud/*',
      '@grpc/*',
      'google-gax',
      'google-auth-library',
      'native-dns',
      'native-dns-cache',
      '@farcaster/hub-nodejs',
      '@opentelemetry/*',
      'bun:sqlite',
      'node:*',
      'typeorm',
      '@jejunetwork/db',
      'pg',
      '@subsquid/*',
    ],
    define: {
      'process.env.NODE_ENV': JSON.stringify('development'),
      'import.meta.env.MODE': JSON.stringify('development'),
      'import.meta.env.DEV': JSON.stringify(true),
      'import.meta.env.PROD': JSON.stringify(false),
      'import.meta.env.SSR': JSON.stringify(false),
    },
  })

  if (!result.success) {
    console.error('Build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    return false
  }
  return true
}

// Kill any existing process on the port
console.log(`Checking port ${PORT}...`)
await killPort(PORT)

// Initial build
console.log('Building frontend...')
if (!(await build())) {
  process.exit(1)
}
console.log('Build complete.')

// Read index.html and inject the built script + CSS
const indexHtml = await Bun.file(join(rootDir, 'index.html')).text()

// Find the CSS file in dist/web (has hash in filename)
const distDir = join(rootDir, 'dist/web')
const distFiles = await Array.fromAsync(new Bun.Glob('*.css').scan(distDir))
const cssFile = distFiles[0]

// Transform HTML to use built assets
let transformedHtml = indexHtml
  .replace('/web/main.tsx', '/dist/web/main.js')
  .replace('/web/styles/index.css', cssFile ? `/dist/web/${cssFile}` : '/web/styles/index.css')

const REST_PORT = Number(process.env.REST_PORT) || 4352

// Serve the frontend
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    // Proxy /api requests to REST server
    if (path.startsWith('/api')) {
      const restUrl = `http://localhost:${REST_PORT}${path}${url.search}`
      try {
        const response = await fetch(restUrl, {
          method: req.method,
          headers: req.headers,
          body: req.body,
        })
        return new Response(response.body, {
          status: response.status,
          headers: response.headers,
        })
      } catch {
        return new Response(JSON.stringify({ error: 'REST API unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Serve index.html for root and SPA routes
    if (path === '/' || !path.includes('.')) {
      return new Response(transformedHtml, {
        headers: { 'Content-Type': 'text/html' },
      })
    }

    // Serve static assets
    const filePath = join(rootDir, path)
    const file = Bun.file(filePath)
    if (await file.exists()) {
      return new Response(file)
    }

    // Try with dist/web prefix
    const distPath = join(rootDir, 'dist/web', path.replace('/dist/web/', ''))
    const distFile = Bun.file(distPath)
    if (await distFile.exists()) {
      return new Response(distFile)
    }

    // Try public directory
    const publicPath = join(rootDir, 'public', path)
    const publicFile = Bun.file(publicPath)
    if (await publicFile.exists()) {
      return new Response(publicFile)
    }

    return new Response('Not Found', { status: 404 })
  },
})

console.log(`Dev server running at http://localhost:${PORT}`)

// Watch for changes and rebuild
const watcher = watch(
  join(rootDir, 'web'),
  { recursive: true },
  async (_event, filename) => {
    if (
      filename &&
      (filename.endsWith('.tsx') ||
        filename.endsWith('.ts') ||
        filename.endsWith('.css'))
    ) {
      console.log(`File changed: ${filename}, rebuilding...`)
      await build()
    }
  },
)

async function cleanup(): Promise<void> {
  console.log('\nShutting down...')
  watcher.close()
  server.stop()
  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
