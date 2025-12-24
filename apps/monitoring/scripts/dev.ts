/** Development server - Vite frontend (5173) + Elysia API (9091). */

import { existsSync, watch } from 'node:fs'
import { mkdir } from 'node:fs/promises'

const FRONTEND_PORT = Number(process.env.PORT) || 5173
const API_PORT = Number(process.env.API_PORT) || 9091

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
  'pg',
  'node:url',
  'node:fs',
  'node:path',
  'node:crypto',
  'node:events',
  '@jejunetwork/config',
  '@jejunetwork/shared',
  '@jejunetwork/db',
]

let buildInProgress = false

async function buildFrontend(): Promise<void> {
  if (buildInProgress) return
  buildInProgress = true

  const startTime = Date.now()

  const result = await Bun.build({
    entrypoints: ['./web/main.tsx'],
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
    console.error('Build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    return
  }

  console.log(`Frontend rebuilt in ${Date.now() - startTime}ms`)
}

async function createDevHtml(): Promise<string> {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="theme-color" content="#0D0B14" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#FFFBF7" media="(prefers-color-scheme: light)">
  <meta name="description" content="Network Monitoring - Real-time blockchain metrics, alerts, and system health">
  <title>Network Monitoring - Dev</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            jeju: {
              primary: '#FF6B35',
              'primary-dark': '#E85A2A',
              'primary-light': '#FF8F66',
              accent: '#00D9C0',
              'accent-dark': '#00B8A3',
              'accent-light': '#4AEADB',
              purple: '#7C3AED',
              'purple-dark': '#6D28D9',
              'purple-light': '#A78BFA',
              success: '#10B981',
              error: '#EF4444',
              warning: '#F59E0B',
              info: '#3B82F6',
            },
            light: {
              bg: '#FFFBF7',
              'bg-secondary': '#FFF5ED',
              'bg-tertiary': '#FFEDE0',
              surface: '#FFFFFF',
              'surface-elevated': '#FFFFFF',
              border: '#FFE4D4',
              'border-strong': '#FFD0B8',
              text: '#1A1523',
              'text-secondary': '#635E69',
              'text-tertiary': '#9D97A5',
            },
            dark: {
              bg: '#0D0B14',
              'bg-secondary': '#161222',
              'bg-tertiary': '#1E1830',
              surface: '#1E1830',
              'surface-elevated': '#2A2440',
              border: '#3D3558',
              'border-strong': '#4D4570',
              text: '#FAFAFA',
              'text-secondary': '#B8B4C0',
              'text-tertiary': '#7D7888',
            },
          },
        },
      },
    }
  </script>
  <script>
    (function() {
      try {
        const savedTheme = localStorage.getItem('jeju-monitoring-theme');
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

    /* CSS Variables for theming */
    :root {
      --color-primary: #FF6B35;
      --color-primary-dark: #E85A2A;
      --color-primary-light: #FF8F66;
      --color-accent: #00D9C0;
      --color-accent-dark: #00B8A3;
      --color-accent-light: #4AEADB;
      --color-purple: #7C3AED;
      --color-purple-dark: #6D28D9;
      --color-purple-light: #A78BFA;
      --color-success: #10B981;
      --color-error: #EF4444;
      --color-warning: #F59E0B;
      --color-info: #3B82F6;
      --bg-primary: #FFFBF7;
      --bg-secondary: #FFF5ED;
      --bg-tertiary: #FFEDE0;
      --surface: #FFFFFF;
      --surface-elevated: #FFFFFF;
      --border: #FFE4D4;
      --border-strong: #FFD0B8;
      --text-primary: #1A1523;
      --text-secondary: #635E69;
      --text-tertiary: #9D97A5;
      --shadow-card: 0 4px 20px rgba(0, 0, 0, 0.08);
      --shadow-card-hover: 0 8px 30px rgba(255, 107, 53, 0.15);
      --font-outfit: 'Outfit', system-ui, sans-serif;
      --font-display: 'Space Grotesk', system-ui, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }

    .dark {
      --bg-primary: #0D0B14;
      --bg-secondary: #161222;
      --bg-tertiary: #1E1830;
      --surface: #1E1830;
      --surface-elevated: #2A2440;
      --border: #3D3558;
      --border-strong: #4D4570;
      --text-primary: #FAFAFA;
      --text-secondary: #B8B4C0;
      --text-tertiary: #7D7888;
      --shadow-card: 0 4px 20px rgba(0, 0, 0, 0.4);
      --shadow-card-hover: 0 8px 30px rgba(255, 107, 53, 0.2);
    }

    body {
      font-family: var(--font-outfit);
      background-color: var(--bg-primary);
      color: var(--text-primary);
    }

    /* Card styles */
    .card, .card-static {
      background-color: var(--surface);
      border: 1px solid var(--border);
      border-radius: 1rem;
      box-shadow: var(--shadow-card);
    }

    .card:hover {
      border-color: var(--color-primary);
      box-shadow: var(--shadow-card-hover);
    }

    /* Button styles */
    .btn {
      padding: 0.75rem 1.5rem;
      border-radius: 0.75rem;
      font-weight: 600;
      transition: all 0.2s;
    }

    .btn-primary {
      background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
      color: white;
    }

    .btn-secondary {
      background-color: var(--surface);
      border: 1px solid var(--border);
      color: var(--text-primary);
    }

    /* Input styles */
    .input {
      width: 100%;
      padding: 0.75rem 1rem;
      border-radius: 0.75rem;
      background-color: var(--bg-secondary);
      border: 1px solid var(--border);
      color: var(--text-primary);
      transition: all 0.2s;
    }

    .input:focus {
      outline: none;
      border-color: var(--color-primary);
    }

    .input::placeholder {
      color: var(--text-tertiary);
    }

    /* Badge styles */
    .badge {
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
    }

    .badge-success { background-color: rgba(16, 185, 129, 0.15); color: var(--color-success); }
    .badge-error { background-color: rgba(239, 68, 68, 0.15); color: var(--color-error); }
    .badge-warning { background-color: rgba(245, 158, 11, 0.15); color: var(--color-warning); }
    .badge-info { background-color: rgba(59, 130, 246, 0.15); color: var(--color-info); }
    .badge-primary { background-color: rgba(255, 107, 53, 0.15); color: var(--color-primary); }

    /* Text gradient */
    .text-gradient {
      background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-purple) 50%, var(--color-accent) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    /* Status indicators */
    .status-dot { width: 0.625rem; height: 0.625rem; border-radius: 9999px; }
    .status-dot-lg { width: 0.75rem; height: 0.75rem; border-radius: 9999px; }
    .status-online { background-color: var(--color-success); box-shadow: 0 0 8px rgba(16, 185, 129, 0.6); }
    .status-offline { background-color: var(--color-error); box-shadow: 0 0 8px rgba(239, 68, 68, 0.6); }
    .status-warning { background-color: var(--color-warning); box-shadow: 0 0 8px rgba(245, 158, 11, 0.6); }

    /* Shimmer loading */
    .shimmer {
      position: relative;
      overflow: hidden;
      background: linear-gradient(90deg, var(--bg-secondary) 0%, var(--bg-tertiary) 50%, var(--bg-secondary) 100%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }

    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* Container */
    .container-app {
      max-width: 80rem;
      margin-left: auto;
      margin-right: auto;
      padding-left: 1rem;
      padding-right: 1rem;
    }

    @media (min-width: 640px) {
      .container-app { padding-left: 1.5rem; padding-right: 1.5rem; }
    }

    @media (min-width: 1024px) {
      .container-app { padding-left: 2rem; padding-right: 2rem; }
    }

    /* Safe areas */
    .safe-top { padding-top: env(safe-area-inset-top); }
    .safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
  </style>
</head>
<body class="font-sans antialiased">
  <div id="root"></div>
  <script type="module" src="/main.js"></script>
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
        const targetUrl = `http://localhost:${API_PORT}${pathname}${url.search}`

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

      // Check dist/dev first
      const devFile = Bun.file(`./dist/dev${filePath}`)
      if (await devFile.exists()) {
        return new Response(devFile, {
          headers: {
            'Content-Type': getContentType(filePath),
            'Cache-Control': 'no-cache',
          },
        })
      }

      // Serve CSS from web directory
      if (filePath.endsWith('.css')) {
        const webCss = Bun.file(`./web${filePath}`)
        if (await webCss.exists()) {
          return new Response(webCss, {
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

  console.log(`Frontend: http://localhost:${FRONTEND_PORT}`)

  // Watch for changes and rebuild
  const watchDirs = ['./web', './lib']

  for (const dir of watchDirs) {
    if (existsSync(dir)) {
      watch(dir, { recursive: true }, (_eventType, filename) => {
        if (
          filename &&
          (filename.endsWith('.ts') || filename.endsWith('.tsx'))
        ) {
          console.log(`${filename} changed, rebuilding...`)
          buildFrontend()
        }
      })
    }
  }
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
  console.log('Starting Monitoring development server...\n')

  await startFrontendServer()

  console.log('\nDevelopment server ready.')
  console.log(`   Frontend: http://localhost:${FRONTEND_PORT}`)
  console.log(`   API: http://localhost:${API_PORT}`)
}

main()
