/**
 * Development server script
 * Uses Bun.serve for API and Bun.build for client
 */

import { watch } from 'node:fs'

const PORT = Number(process.env.PORT) || 4006

// Build the client
async function buildClient() {
  console.log('🔨 Building client...')
  const result = await Bun.build({
    entrypoints: ['./src/client.tsx'],
    outdir: './dist',
    target: 'browser',
    splitting: true,
    minify: false,
    sourcemap: 'external',
    external: [
      // Node.js builtins
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
      // Packages with Node.js-specific code - externalize all
      '@jejunetwork/config',
      '@jejunetwork/shared',
      '@jejunetwork/sdk',
      '@jejunetwork/oauth3',
      '@jejunetwork/deployment',
      '@jejunetwork/contracts',
    ],
    define: {
      'process.env.NODE_ENV': JSON.stringify(
        process.env.NODE_ENV || 'development',
      ),
      'process.env.PUBLIC_API_URL': JSON.stringify(
        process.env.PUBLIC_API_URL || 'http://localhost:4007',
      ),
    },
  })

  if (!result.success) {
    console.error('Build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    return false
  }

  console.log('✅ Client built successfully')
  return true
}

// Copy CSS (for now, we'll handle Tailwind separately)
async function copyAssets() {
  // Copy CSS
  const css = await Bun.file('./src/globals.css').text()
  await Bun.write('./dist/globals.css', css)
  console.log('📄 Assets copied')
}

// HTML template
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="theme-color" content="#0D0B14" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#FFFBF7" media="(prefers-color-scheme: light)">
  <title>Bazaar - Agent Marketplace on the network</title>
  <meta name="description" content="The fun, light-hearted marketplace for tokens, NFTs, prediction markets, and more.">
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
  <link rel="stylesheet" href="/globals.css">
</head>
<body class="font-sans antialiased">
  <div id="root"></div>
  <script type="module" src="/client.js"></script>
</body>
</html>`

// Start dev server
async function startServer() {
  // Initial build
  const buildSuccess = await buildClient()
  if (!buildSuccess) {
    console.error('Initial build failed, starting server anyway...')
  }
  await copyAssets()

  const server = Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      // API proxy to separate API server
      if (path.startsWith('/api/')) {
        const apiUrl = new URL(path + url.search, 'http://localhost:4007')
        return fetch(apiUrl, {
          method: req.method,
          headers: req.headers,
          body: req.body,
        })
      }

      // Static files from dist
      if (path.startsWith('/client.js') || path.endsWith('.js.map')) {
        const file = Bun.file(`./dist${path}`)
        if (await file.exists()) {
          return new Response(await file.arrayBuffer(), {
            headers: { 'Content-Type': 'application/javascript' },
          })
        }
      }

      if (path === '/globals.css') {
        const file = Bun.file('./dist/globals.css')
        if (await file.exists()) {
          return new Response(await file.arrayBuffer(), {
            headers: { 'Content-Type': 'text/css' },
          })
        }
      }

      // Public assets
      if (path.startsWith('/agent-card.json')) {
        const file = Bun.file('./public/agent-card.json')
        if (await file.exists()) {
          return Response.json(await file.json())
        }
      }

      // SPA fallback - serve index.html for all routes
      return new Response(html, {
        headers: { 'Content-Type': 'text/html' },
      })
    },
  })

  console.log(`🏝️ Bazaar dev server running at http://localhost:${PORT}`)

  // Watch for changes and rebuild
  const watcher = watch(
    './src',
    { recursive: true },
    async (_event, filename) => {
      console.log(`\n📝 ${filename} changed, rebuilding...`)
      await buildClient()
      await copyAssets()
    },
  )

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...')
    watcher.close()
    server.stop()
    process.exit(0)
  })
}

startServer()
