import { existsSync, watch } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  CRUCIBLE_THEME,
  DEFAULT_BROWSER_EXTERNALS,
} from '@jejunetwork/shared/dev-server'

const FRONTEND_PORT = Number(process.env.PORT) || 4020
const API_PORT = Number(process.env.API_PORT) || 4021

let buildInProgress = false
let cssCompileInProgress = false
let prodBuildInProgress = false

async function compileTailwindCSS(): Promise<void> {
  if (cssCompileInProgress) return
  cssCompileInProgress = true
  const start = Date.now()

  const proc = Bun.spawn(
    ['bunx', 'tailwindcss', '-i', './web/globals.css', '-o', './dist/dev/globals.css'],
    { stdout: 'pipe', stderr: 'pipe', cwd: process.cwd() },
  )

  const exitCode = await proc.exited
  cssCompileInProgress = false

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    console.error('[Crucible] Tailwind compilation failed:', stderr)
    return
  }

  console.log(`[Crucible] Tailwind compiled in ${Date.now() - start}ms`)
}

async function buildFrontend(): Promise<void> {
  if (buildInProgress) return
  buildInProgress = true
  const start = Date.now()

  const result = await Bun.build({
    entrypoints: ['./web/client.tsx'],
    outdir: './dist/dev',
    target: 'browser',
    // Disabled splitting due to Bun bundler bug with @noble/curves creating duplicate exports
    splitting: false,
    minify: false,
    sourcemap: 'inline',
    external: [
      ...DEFAULT_BROWSER_EXTERNALS,
      '@jejunetwork/contracts',
      '@jejunetwork/deployment',
      '@jejunetwork/db',
      '@jejunetwork/sqlit',
      'elysia',
      '@elysiajs/cors',
      '@elysiajs/eden',
    ],
    define: {
      'process.env.NODE_ENV': JSON.stringify('development'),
      'process.env.PUBLIC_API_URL': JSON.stringify(
        `http://localhost:${API_PORT}`,
      ),
      'process.env': JSON.stringify({
        NODE_ENV: 'development',
        PUBLIC_API_URL: `http://localhost:${API_PORT}`,
      }),
      'globalThis.process': JSON.stringify({
        env: { NODE_ENV: 'development' },
      }),
    },
    plugins: [
      {
        name: 'browser-shims',
        setup(build) {
          // Pino stub
          build.onResolve({ filter: /^pino$/ }, () => ({
            path: 'pino',
            namespace: 'pino-stub',
          }))
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

          // Elysia stub (server-only)
          build.onResolve({ filter: /^elysia$/ }, () => ({
            path: 'elysia',
            namespace: 'elysia-stub',
          }))
          build.onLoad({ filter: /.*/, namespace: 'elysia-stub' }, () => ({
            contents: `
              export class Elysia {
                use() { return this; }
                get() { return this; }
                post() { return this; }
                listen() { return this; }
              }
              export default Elysia;
            `,
            loader: 'js',
          }))

          // Dedupe React
          const reactPath = require.resolve('react')
          const reactDomPath = require.resolve('react-dom')
          build.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }))
          build.onResolve({ filter: /^react-dom$/ }, () => ({
            path: reactDomPath,
          }))
          build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
            path: require.resolve('react/jsx-runtime'),
          }))
          build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
            path: require.resolve('react/jsx-dev-runtime'),
          }))

          // Workspace packages
          build.onResolve({ filter: /^@jejunetwork\/shared$/ }, () => ({
            path: resolve(process.cwd(), '../../packages/shared/src/index.ts'),
          }))
          build.onResolve({ filter: /^@jejunetwork\/types$/ }, () => ({
            path: resolve(process.cwd(), '../../packages/types/src/index.ts'),
          }))
          build.onResolve({ filter: /^@jejunetwork\/config$/ }, () => ({
            path: resolve(process.cwd(), '../../packages/config/index.ts'),
          }))
          build.onResolve({ filter: /^@jejunetwork\/auth\/react$/ }, () => ({
            path: resolve(
              process.cwd(),
              '../../packages/auth/src/react/index.ts',
            ),
          }))
          build.onResolve({ filter: /^@jejunetwork\/auth$/ }, () => ({
            path: resolve(process.cwd(), '../../packages/auth/src/index.ts'),
          }))

          // Server-only stubs
          const serverOnlyStub = resolve(process.cwd(), './web/stubs/empty.ts')
          const authProvidersStub = resolve(
            process.cwd(),
            './web/stubs/auth-providers.ts',
          )

          build.onResolve({ filter: /^@jejunetwork\/kms/ }, () => ({
            path: serverOnlyStub,
          }))
          build.onResolve({ filter: /^@jejunetwork\/db/ }, () => ({
            path: serverOnlyStub,
          }))
          build.onResolve({ filter: /^@jejunetwork\/messaging/ }, () => ({
            path: serverOnlyStub,
          }))
          build.onResolve({ filter: /^elysia/ }, () => ({
            path: serverOnlyStub,
          }))
          build.onResolve({ filter: /^@elysiajs\// }, () => ({
            path: serverOnlyStub,
          }))
          build.onResolve({ filter: /providers\/farcaster/ }, () => ({
            path: authProvidersStub,
          }))
          build.onResolve({ filter: /providers\/email/ }, () => ({
            path: authProvidersStub,
          }))
          build.onResolve({ filter: /providers\/phone/ }, () => ({
            path: authProvidersStub,
          }))
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

async function buildProduction(): Promise<void> {
  if (prodBuildInProgress) return
  prodBuildInProgress = true
  const start = Date.now()

  const proc = Bun.spawn(['bun', 'run', 'build'], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: process.cwd(),
  })

  const exitCode = await proc.exited
  prodBuildInProgress = false

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    console.error('[Crucible] Production build failed:', stderr)
    return
  }

  console.log(`[Crucible] Production build completed in ${Date.now() - start}ms`)
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
  <script>
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
  await compileTailwindCSS()
  await buildFrontend()

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

      // Serve compiled Tailwind CSS
      if (path === '/globals.css') {
        const cssFile = Bun.file('./dist/dev/globals.css')
        if (await cssFile.exists()) {
          return new Response(cssFile, {
            headers: { 'Content-Type': 'text/css', 'Cache-Control': 'no-cache' },
          })
        }
      }

      // Serve public files
      const publicFile = Bun.file(`./public${path}`)
      if (path !== '/' && (await publicFile.exists())) {
        return new Response(publicFile)
      }

      // Serve index.html (SPA fallback)
      return new Response(generateDevHtml(), {
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
          compileTailwindCSS() // Recompile CSS in case new Tailwind classes were added
          buildProduction() // Rebuild production bundle for DWS
        }
        if (file?.endsWith('.css')) {
          console.log(`[Crucible] ${file} changed, recompiling CSS...`)
          compileTailwindCSS()
          buildProduction() // Rebuild production bundle for DWS
        }
      })
    }
  }
}

console.log('[Crucible] Starting dev server...\n')
startServer()
