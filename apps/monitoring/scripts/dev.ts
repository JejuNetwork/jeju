/**
 * Monitoring Development Server
 *
 * Uses shared dev server infrastructure with custom HTML template.
 * Frontend (5173) + Elysia API (9091).
 */

import { existsSync, watch } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import {
  DEFAULT_BROWSER_EXTERNALS,
  MONITORING_THEME,
} from '@jejunetwork/shared/dev-server'

const FRONTEND_PORT = Number(process.env.PORT) || 5173
const API_PORT = Number(process.env.API_PORT) || 9091

// Additional browser externals for monitoring
const EXTERNALS = [
  ...DEFAULT_BROWSER_EXTERNALS,
  'pg',
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
    external: EXTERNALS,
    define: {
      'process.env.NODE_ENV': JSON.stringify('development'),
      'process.env.PUBLIC_API_URL': JSON.stringify(
        `http://localhost:${API_PORT}`,
      ),
    },
  })

  buildInProgress = false

  if (!result.success) {
    console.error('[Monitoring] Build failed:')
    for (const log of result.logs) console.error(log)
    return
  }

  console.log(`[Monitoring] Frontend rebuilt in ${Date.now() - startTime}ms`)
}

// Custom HTML with monitoring-specific styles
function createDevHtml(): string {
  const theme = MONITORING_THEME
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="theme-color" content="${theme.dark.bg}" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="${theme.light.bg}" media="(prefers-color-scheme: light)">
  <meta name="description" content="Network Monitoring - Real-time blockchain metrics, alerts, and system health">
  <title>Network Monitoring - Dev</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${theme.fonts.google}" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            jeju: {
              primary: '${theme.colors.primary}',
              'primary-dark': '${theme.colors.primaryDark}',
              'primary-light': '${theme.colors.primaryLight}',
              accent: '${theme.colors.accent}',
              'accent-dark': '${theme.colors.accentDark}',
              'accent-light': '${theme.colors.accentLight}',
              purple: '${theme.colors.purple}',
              'purple-dark': '${theme.colors.purpleDark}',
              'purple-light': '${theme.colors.purpleLight}',
              success: '#10B981',
              error: '#EF4444',
              warning: '#F59E0B',
              info: '#3B82F6',
            },
            light: {
              bg: '${theme.light.bg}',
              'bg-secondary': '${theme.light.bgSecondary}',
              'bg-tertiary': '${theme.light.bgTertiary}',
              surface: '${theme.light.surface}',
              'surface-elevated': '${theme.light.surfaceElevated}',
              border: '${theme.light.border}',
              'border-strong': '${theme.light.borderStrong}',
              text: '${theme.light.text}',
              'text-secondary': '${theme.light.textSecondary}',
              'text-tertiary': '${theme.light.textTertiary}',
            },
            dark: {
              bg: '${theme.dark.bg}',
              'bg-secondary': '${theme.dark.bgSecondary}',
              'bg-tertiary': '${theme.dark.bgTertiary}',
              surface: '${theme.dark.surface}',
              'surface-elevated': '${theme.dark.surfaceElevated}',
              border: '${theme.dark.border}',
              'border-strong': '${theme.dark.borderStrong}',
              text: '${theme.dark.text}',
              'text-secondary': '${theme.dark.textSecondary}',
              'text-tertiary': '${theme.dark.textTertiary}',
            },
          },
        },
      },
    }
  </script>
  <script>
    (function() {
      try {
        const savedTheme = localStorage.getItem('${theme.storageKey}');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (savedTheme ? savedTheme === 'dark' : prefersDark) {
          document.documentElement.classList.add('dark');
        }
      } catch (e) {}
    })();
  </script>
  <style>
    :root {
      --color-primary: ${theme.colors.primary};
      --color-primary-dark: ${theme.colors.primaryDark};
      --color-accent: ${theme.colors.accent};
      --color-success: #10B981;
      --color-error: #EF4444;
      --color-warning: #F59E0B;
      --color-info: #3B82F6;
      --bg-primary: ${theme.light.bg};
      --bg-secondary: ${theme.light.bgSecondary};
      --surface: ${theme.light.surface};
      --border: ${theme.light.border};
      --text-primary: ${theme.light.text};
      --text-secondary: ${theme.light.textSecondary};
      --shadow-card: 0 4px 20px rgba(0, 0, 0, 0.08);
      --font-outfit: '${theme.fonts.sans}', system-ui, sans-serif;
      --font-display: '${theme.fonts.display}', system-ui, sans-serif;
      --font-mono: '${theme.fonts.mono}', monospace;
    }
    .dark {
      --bg-primary: ${theme.dark.bg};
      --bg-secondary: ${theme.dark.bgSecondary};
      --surface: ${theme.dark.surface};
      --border: ${theme.dark.border};
      --text-primary: ${theme.dark.text};
      --text-secondary: ${theme.dark.textSecondary};
      --shadow-card: 0 4px 20px rgba(0, 0, 0, 0.4);
    }
    body { font-family: var(--font-outfit); background-color: var(--bg-primary); color: var(--text-primary); }
    .card { background-color: var(--surface); border: 1px solid var(--border); border-radius: 1rem; box-shadow: var(--shadow-card); }
    .card:hover { border-color: var(--color-primary); }
    .badge { padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .badge-success { background-color: rgba(16, 185, 129, 0.15); color: var(--color-success); }
    .badge-error { background-color: rgba(239, 68, 68, 0.15); color: var(--color-error); }
    .badge-warning { background-color: rgba(245, 158, 11, 0.15); color: var(--color-warning); }
    .status-dot { width: 0.625rem; height: 0.625rem; border-radius: 9999px; }
    .status-online { background-color: var(--color-success); box-shadow: 0 0 8px rgba(16, 185, 129, 0.6); }
    .status-offline { background-color: var(--color-error); box-shadow: 0 0 8px rgba(239, 68, 68, 0.6); }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .shimmer { background: linear-gradient(90deg, var(--bg-secondary) 0%, var(--surface) 50%, var(--bg-secondary) 100%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
  </style>
</head>
<body class="font-sans antialiased">
  <div id="root"></div>
  <script type="module" src="/main.js"></script>
</body>
</html>`
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

async function startFrontendServer(): Promise<void> {
  await mkdir('./dist/dev', { recursive: true })
  await buildFrontend()

  Bun.serve({
    port: FRONTEND_PORT,
    async fetch(req) {
      const url = new URL(req.url)
      const pathname = url.pathname

      // Proxy API requests
      if (
        pathname.startsWith('/api/') ||
        pathname.startsWith('/health') ||
        pathname.startsWith('/.well-known/')
      ) {
        const targetUrl = `http://localhost:${API_PORT}${pathname}${url.search}`
        return fetch(targetUrl, {
          method: req.method,
          headers: req.headers,
          body:
            req.method !== 'GET' && req.method !== 'HEAD'
              ? req.body
              : undefined,
        }).catch((error) => {
          console.error('[Monitoring] Proxy error:', error.message)
          return new Response(
            JSON.stringify({ error: 'Backend unavailable' }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        })
      }

      // SPA fallback
      if (pathname !== '/' && !pathname.includes('.')) {
        return new Response(createDevHtml(), {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      // Index
      if (pathname === '/' || pathname === '/index.html') {
        return new Response(createDevHtml(), {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      // Built files
      const devFile = Bun.file(`./dist/dev${pathname}`)
      if (await devFile.exists()) {
        return new Response(devFile, {
          headers: {
            'Content-Type': getContentType(pathname),
            'Cache-Control': 'no-cache',
          },
        })
      }

      // CSS from web
      if (pathname.endsWith('.css')) {
        const webCss = Bun.file(`./web${pathname}`)
        if (await webCss.exists()) {
          return new Response(webCss, {
            headers: {
              'Content-Type': 'text/css',
              'Cache-Control': 'no-cache',
            },
          })
        }
      }

      // Public files
      const publicFile = Bun.file(`./public${pathname}`)
      if (await publicFile.exists()) {
        return new Response(publicFile, {
          headers: { 'Content-Type': getContentType(pathname) },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  console.log(`[Monitoring] Frontend: http://localhost:${FRONTEND_PORT}`)

  // Watch for changes
  const watchDirs = ['./web', './lib']
  for (const dir of watchDirs) {
    if (existsSync(dir)) {
      watch(dir, { recursive: true }, (_eventType, filename) => {
        if (
          filename &&
          (filename.endsWith('.ts') || filename.endsWith('.tsx'))
        ) {
          console.log(`[Monitoring] ${filename} changed, rebuilding...`)
          buildFrontend()
        }
      })
    }
  }
}

async function main(): Promise<void> {
  console.log('[Monitoring] Starting development server...\n')
  await startFrontendServer()
  console.log('\n[Monitoring] Development server ready.')
  console.log(`   Frontend: http://localhost:${FRONTEND_PORT}`)
  console.log(`   API: http://localhost:${API_PORT}`)
}

main()
