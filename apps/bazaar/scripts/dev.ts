/**
 * Bazaar Development Server
 *
 * Runs:
 * 1. Static file server for frontend (port 4006)
 * 2. Elysia API server (port 4007)
 * 3. Optionally connects to local DWS for TEE worker simulation
 *
 * All API requests are proxied to the backend.
 */

import { existsSync, watch } from 'node:fs'
import { mkdir } from 'node:fs/promises'

const FRONTEND_PORT = Number(process.env.PORT) || 4006
const API_PORT = Number(process.env.API_PORT) || 4007
const DWS_URL = process.env.DWS_URL || 'http://localhost:4030'
const USE_DWS = process.env.USE_DWS === 'true'

// External packages for browser build
const BROWSER_EXTERNALS = [
  'bun:sqlite',
  'child_process',
  'http2',
  'tls',
  'dgram',
  'fs',
  'net',
  'dns',
  'stream',
  'crypto',
  'node:url',
  'node:fs',
  'node:path',
  'node:crypto',
  'node:events',
  '@jejunetwork/config',
  '@jejunetwork/shared',
  '@jejunetwork/sdk',
  '@jejunetwork/oauth3',
  '@jejunetwork/deployment',
  '@jejunetwork/contracts',
]

let buildInProgress = false

async function buildFrontend(): Promise<void> {
  if (buildInProgress) return
  buildInProgress = true

  const startTime = Date.now()

  const result = await Bun.build({
    entrypoints: ['./src/client.tsx'],
    outdir: './dist/dev',
    target: 'browser',
    splitting: true,
    minify: false,
    sourcemap: 'inline',
    external: BROWSER_EXTERNALS,
    define: {
      'process.env.NODE_ENV': JSON.stringify('development'),
      'process.env.PUBLIC_API_URL': JSON.stringify(
        `http://localhost:${API_PORT}`,
      ),
    },
  })

  buildInProgress = false

  if (!result.success) {
    console.error('❌ Build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    return
  }

  console.log(`📦 Frontend rebuilt in ${Date.now() - startTime}ms`)
}

async function createDevHtml(): Promise<string> {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="theme-color" content="#0D0B14" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#FFFBF7" media="(prefers-color-scheme: light)">
  <title>Bazaar - Dev</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            'bazaar-primary': '#FF6B35',
            'bazaar-accent': '#00D9C0',
            'bazaar-purple': '#7C3AED',
          }
        }
      }
    }
  </script>
  <script>
    (function() {
      try {
        const savedTheme = localStorage.getItem('bazaar-theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const shouldBeDark = savedTheme ? savedTheme === 'dark' : prefersDark;
        if (shouldBeDark) {
          document.documentElement.classList.add('dark');
        }
      } catch (e) {}
    })();
  </script>
  <style>
    /* Dev-time TailwindCSS base styles */
    *, ::before, ::after { box-sizing: border-box; }
    html { line-height: 1.5; -webkit-text-size-adjust: 100%; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body class="font-sans antialiased">
  <div id="root"></div>
  <script type="module" src="/client.js"></script>
</body>
</html>`
}

async function startFrontendServer(): Promise<void> {
  await mkdir('./dist/dev', { recursive: true })
  await buildFrontend()

  Bun.serve({
    port: FRONTEND_PORT,
    async fetch(req) {
      const url = new URL(req.url)
      const pathname = url.pathname

      // Proxy API requests to backend
      if (
        pathname.startsWith('/api/') ||
        pathname.startsWith('/health') ||
        pathname.startsWith('/.well-known/')
      ) {
        const targetUrl = USE_DWS
          ? `${DWS_URL}/workers/bazaar-api${pathname}${url.search}`
          : `http://localhost:${API_PORT}${pathname}${url.search}`

        const proxyResponse = await fetch(targetUrl, {
          method: req.method,
          headers: req.headers,
          body:
            req.method !== 'GET' && req.method !== 'HEAD'
              ? req.body
              : undefined,
        }).catch((error) => {
          console.error('Proxy error:', error.message)
          return new Response(
            JSON.stringify({ error: 'Backend unavailable' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          )
        })

        return proxyResponse
      }

      // Serve static files
      if (pathname !== '/' && !pathname.includes('.')) {
        // SPA fallback for client-side routes
        return new Response(await createDevHtml(), {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      // Serve built files
      const filePath = pathname === '/' ? '/index.html' : pathname

      if (filePath === '/index.html') {
        return new Response(await createDevHtml(), {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      // Check dist/dev first, then src for CSS
      const devFile = Bun.file(`./dist/dev${filePath}`)
      if (await devFile.exists()) {
        return new Response(devFile, {
          headers: {
            'Content-Type': getContentType(filePath),
            'Cache-Control': 'no-cache',
          },
        })
      }

      // Serve CSS from src
      if (filePath.endsWith('.css')) {
        const srcCss = Bun.file(`./src${filePath}`)
        if (await srcCss.exists()) {
          return new Response(srcCss, {
            headers: {
              'Content-Type': 'text/css',
              'Cache-Control': 'no-cache',
            },
          })
        }
      }

      // Serve public files
      const publicFile = Bun.file(`./public${filePath}`)
      if (await publicFile.exists()) {
        return new Response(publicFile, {
          headers: { 'Content-Type': getContentType(filePath) },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  console.log(`🌐 Frontend: http://localhost:${FRONTEND_PORT}`)

  // Watch for changes and rebuild
  const watchDirs = [
    './src',
    './components',
    './hooks',
    './lib',
    './config',
    './schemas',
  ]

  for (const dir of watchDirs) {
    if (existsSync(dir)) {
      watch(dir, { recursive: true }, (_eventType, filename) => {
        if (
          filename &&
          (filename.endsWith('.ts') || filename.endsWith('.tsx'))
        ) {
          console.log(`🔄 ${filename} changed, rebuilding...`)
          buildFrontend()
        }
      })
    }
  }
}

async function startApiServer(): Promise<void> {
  if (USE_DWS) {
    console.log(`🔌 API proxied through DWS: ${DWS_URL}/workers/bazaar-api`)
    return
  }

  // Import and start the API server
  const { createBazaarApp } = await import('../api/worker')

  const app = createBazaarApp({
    NETWORK: 'localnet',
    TEE_MODE: 'simulated',
    TEE_PLATFORM: 'local',
    TEE_REGION: 'local',
    RPC_URL: process.env.RPC_URL || 'http://localhost:6545',
    DWS_URL: DWS_URL,
    GATEWAY_URL: process.env.GATEWAY_URL || 'http://localhost:4002',
    INDEXER_URL: process.env.INDEXER_URL || 'http://localhost:4003',
    COVENANTSQL_NODES: process.env.COVENANTSQL_NODES || 'http://localhost:4661',
    COVENANTSQL_DATABASE_ID:
      process.env.COVENANTSQL_DATABASE_ID || 'dev-bazaar',
    COVENANTSQL_PRIVATE_KEY: process.env.COVENANTSQL_PRIVATE_KEY || '',
  })

  app.listen(API_PORT, () => {
    console.log(`🔌 API: http://localhost:${API_PORT}`)
  })
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

async function main(): Promise<void> {
  console.log('🚀 Starting Bazaar development servers...\n')

  if (USE_DWS) {
    console.log(
      '📡 DWS mode enabled - API requests will be proxied to DWS workers\n',
    )
  }

  // Start both servers
  await Promise.all([startFrontendServer(), startApiServer()])

  console.log('\n✅ Development servers ready!')
  console.log(`   Frontend: http://localhost:${FRONTEND_PORT}`)
  console.log(
    `   API: ${USE_DWS ? `${DWS_URL}/workers/bazaar-api` : `http://localhost:${API_PORT}`}`,
  )
}

main()
