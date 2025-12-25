/**
 * Crucible Development Server
 *
 * Simple Bun-based dev server - serves static HTML and builds frontend.
 * API is started separately via package.json scripts.
 */

import { existsSync, watch } from 'node:fs'
import { mkdir } from 'node:fs/promises'

const FRONTEND_PORT = Number(process.env.PORT) || 4020
const API_PORT = Number(process.env.API_PORT) || 4021

// Browser externals
const EXTERNALS = [
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
  'module',
  'worker_threads',
  'node:url',
  'node:fs',
  'node:path',
  'node:crypto',
  'node:events',
  'node:module',
  'pino',
  'pino-pretty',
]

let buildInProgress = false

async function buildFrontend(): Promise<void> {
  if (buildInProgress) return
  buildInProgress = true
  const start = Date.now()

  const result = await Bun.build({
    entrypoints: ['./web/client.tsx'],
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
    console.error('[Crucible] Build failed:')
    for (const log of result.logs) console.error(log)
    return
  }

  console.log(`[Crucible] Built in ${Date.now() - start}ms`)
}

function generateDevHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="theme-color" content="#0A0E17" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#F8FAFC" media="(prefers-color-scheme: light)">
  <title>Crucible - Agent Orchestration Platform</title>
  <meta name="description" content="Decentralized agent orchestration platform for autonomous AI agents. Start, create, and manage agents on the network.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Sora:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script>
    (function() {
      try {
        const savedTheme = localStorage.getItem('crucible-theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const shouldBeDark = savedTheme ? savedTheme === 'dark' : prefersDark;
        if (shouldBeDark) {
          document.documentElement.classList.add('dark');
        }
      } catch (e) {}
    })();
  </script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'system-ui', 'sans-serif'],
            display: ['Sora', 'system-ui', 'sans-serif'],
            mono: ['JetBrains Mono', 'monospace'],
          },
          colors: {
            crucible: {
              primary: '#3B82F6',
              'primary-dark': '#2563EB',
              'primary-light': '#60A5FA',
              accent: '#06B6D4',
              'accent-dark': '#0891B2',
              'accent-light': '#22D3EE',
              purple: '#8B5CF6',
              'purple-dark': '#7C3AED',
              'purple-light': '#A78BFA',
              ember: '#F97316',
              success: '#10B981',
              error: '#EF4444',
              warning: '#F59E0B',
              info: '#3B82F6',
            },
            light: {
              bg: '#F8FAFC',
              'bg-secondary': '#F1F5F9',
              'bg-tertiary': '#E2E8F0',
              surface: '#FFFFFF',
              'surface-elevated': '#FFFFFF',
              border: '#E2E8F0',
              'border-strong': '#CBD5E1',
              text: '#0F172A',
              'text-secondary': '#475569',
              'text-tertiary': '#94A3B8',
            },
            dark: {
              bg: '#0A0E17',
              'bg-secondary': '#111827',
              'bg-tertiary': '#1E293B',
              surface: '#1E293B',
              'surface-elevated': '#334155',
              border: '#334155',
              'border-strong': '#475569',
              text: '#F8FAFC',
              'text-secondary': '#CBD5E1',
              'text-tertiary': '#64748B',
            },
          },
        },
      },
    }
  </script>
  <link rel="stylesheet" href="/globals.css">
</head>
<body class="font-sans antialiased">
  <div id="root"></div>
  <script type="module" src="/client.js"></script>
</body>
</html>`
}

async function startServer(): Promise<void> {
  await mkdir('./dist/dev', { recursive: true })
  await buildFrontend()

  const devHtml = generateDevHtml()

  Bun.serve({
    port: FRONTEND_PORT,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      // Proxy API requests
      if (
        path.startsWith('/api/') ||
        path === '/health' ||
        path.startsWith('/.well-known/')
      ) {
        return fetch(`http://localhost:${API_PORT}${path}${url.search}`, {
          method: req.method,
          headers: req.headers,
          body:
            req.method !== 'GET' && req.method !== 'HEAD'
              ? req.body
              : undefined,
        }).catch(() => new Response('Backend unavailable', { status: 503 }))
      }

      // Serve built JS
      if (path.endsWith('.js') || path.endsWith('.js.map')) {
        const file = Bun.file(`./dist/dev${path}`)
        if (await file.exists()) {
          return new Response(file, {
            headers: {
              'Content-Type': 'application/javascript',
              'Cache-Control': 'no-cache',
            },
          })
        }
      }

      // Serve CSS - strip @import tailwindcss for dev (handled by CDN)
      if (path === '/globals.css') {
        const cssFile = Bun.file('./web/globals.css')
        const css = await cssFile.text()
        const devCss = css.replace(
          '@import "tailwindcss";',
          '/* Tailwind handled by CDN in dev */',
        )
        return new Response(devCss, {
          headers: { 'Content-Type': 'text/css', 'Cache-Control': 'no-cache' },
        })
      }

      // Serve public files
      const publicFile = Bun.file(`./public${path}`)
      if (path !== '/' && (await publicFile.exists())) {
        return new Response(publicFile)
      }

      // Serve index.html for SPA
      return new Response(devHtml, {
        headers: { 'Content-Type': 'text/html' },
      })
    },
  })

  console.log(`[Crucible] Frontend: http://localhost:${FRONTEND_PORT}`)

  // Watch for changes
  for (const dir of ['./web']) {
    if (existsSync(dir)) {
      watch(dir, { recursive: true }, (_, file) => {
        if (file?.endsWith('.ts') || file?.endsWith('.tsx')) {
          console.log(`[Crucible] ${file} changed, rebuilding...`)
          buildFrontend()
        }
      })
    }
  }
}

console.log('[Crucible] Starting dev server...')
startServer()
