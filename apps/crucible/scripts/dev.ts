/**
 * Crucible Development Server
 *
 * Builds frontend with HMR, serves static files, proxies API requests.
 * Has custom plugins for pino and React that require custom script.
 *
 * Usage:
 *   bun run dev                    # Frontend + API
 *   bun run scripts/dev.ts         # Frontend only
 */

import { existsSync, watch } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  DEFAULT_BROWSER_EXTERNALS,
  CRUCIBLE_THEME,
} from '@jejunetwork/shared/dev-server'

const FRONTEND_PORT = Number(process.env.PORT) || 4020
const API_PORT = Number(process.env.API_PORT) || 4021

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
    external: DEFAULT_BROWSER_EXTERNALS,
    define: {
      'process.env.NODE_ENV': JSON.stringify('development'),
      'process.env.PUBLIC_API_URL': JSON.stringify(`http://localhost:${API_PORT}`),
      'process.env': JSON.stringify({ NODE_ENV: 'development', PUBLIC_API_URL: `http://localhost:${API_PORT}` }),
      'globalThis.process': JSON.stringify({ env: { NODE_ENV: 'development' } }),
    },
    plugins: [
      {
        name: 'browser-shims',
        setup(build) {
          // Pino stub
          build.onResolve({ filter: /^pino$/ }, () => ({ path: 'pino', namespace: 'pino-stub' }))
          build.onLoad({ filter: /.*/, namespace: 'pino-stub' }, () => ({
            contents: `
              const logger = {
                debug: console.debug.bind(console),
                info: console.info.bind(console),
                warn: console.warn.bind(console),
                error: console.error.bind(console),
                fatal: console.error.bind(console),
                trace: console.trace.bind(console),
                child: () => logger,
                level: 'info',
                levels: { values: { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } },
              };
              export default function pino() { return logger; }
              export const levels = logger.levels;
            `,
            loader: 'js',
          }))

          // Dedupe React
          const reactPath = require.resolve('react')
          const reactDomPath = require.resolve('react-dom')
          build.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }))
          build.onResolve({ filter: /^react-dom$/ }, () => ({ path: reactDomPath }))
          build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: require.resolve('react/jsx-runtime') }))
          build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({ path: require.resolve('react/jsx-dev-runtime') }))

          // Workspace packages
          build.onResolve({ filter: /^@jejunetwork\/shared$/ }, () => ({ path: resolve(process.cwd(), '../../packages/shared/src/index.ts') }))
          build.onResolve({ filter: /^@jejunetwork\/types$/ }, () => ({ path: resolve(process.cwd(), '../../packages/types/src/index.ts') }))
        },
      },
    ],
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
  const theme = CRUCIBLE_THEME
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="theme-color" content="${theme.dark.bg}" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="${theme.light.bg}" media="(prefers-color-scheme: light)">
  <title>Crucible - Dev</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${theme.fonts.google}" rel="stylesheet">
  <script>window.process = window.process || { env: { NODE_ENV: 'development' } };</script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: { sans: ['${theme.fonts.sans}', 'system-ui', 'sans-serif'], display: ['${theme.fonts.display}', 'system-ui', 'sans-serif'], mono: ['${theme.fonts.mono}', 'monospace'] },
          colors: {
            crucible: { primary: '${theme.colors.primary}', accent: '${theme.colors.accent}', purple: '${theme.colors.purple}', ember: '#F97316', success: '#10B981', error: '#EF4444' },
          },
        },
      },
    }
    const saved = localStorage.getItem('${theme.storageKey}');
    if (saved === 'dark' || (!saved && matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
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

  Bun.serve({
    port: FRONTEND_PORT,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      // Proxy API requests
      if (path.startsWith('/api/') || path === '/health' || path.startsWith('/.well-known/')) {
        return fetch(`http://localhost:${API_PORT}${path}${url.search}`, {
          method: req.method,
          headers: req.headers,
          body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
        }).catch(() => new Response('Backend unavailable', { status: 503 }))
      }

      // Serve built JS
      if (path.endsWith('.js') || path.endsWith('.js.map')) {
        const file = Bun.file(`./dist/dev${path}`)
        if (await file.exists()) {
          return new Response(file, { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' } })
        }
      }

      // Serve CSS - strip @import tailwindcss for dev (handled by CDN)
      if (path === '/globals.css') {
        const cssFile = Bun.file('./web/globals.css')
        const css = await cssFile.text()
        const devCss = css.replace('@import "tailwindcss";', '/* Tailwind handled by CDN in dev */')
        return new Response(devCss, { headers: { 'Content-Type': 'text/css', 'Cache-Control': 'no-cache' } })
      }

      // Serve public files
      const publicFile = Bun.file(`./public${path}`)
      if (path !== '/' && (await publicFile.exists())) {
        return new Response(publicFile)
      }

      // Serve index.html (SPA fallback)
      return new Response(generateDevHtml(), { headers: { 'Content-Type': 'text/html' } })
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

console.log('[Crucible] Starting dev server...\n')
startServer()
