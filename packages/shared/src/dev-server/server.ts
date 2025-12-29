/**
 * Development Server
 *
 * Shared development server for Jeju apps with hot reload.
 */

import { existsSync, watch } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { getLocalhostHost } from '@jejunetwork/config'
import { generateDevHtml } from './html'
import type { DevServerConfig } from './types'
import {
  DEFAULT_BROWSER_EXTERNALS,
  DEFAULT_PROXY_PATHS,
  DEFAULT_WATCH_DIRS,
} from './types'

export interface CreateDevServerOptions extends DevServerConfig {
  onBuildStart?: () => void
  onBuildComplete?: (durationMs: number) => void
  onBuildError?: (logs: Array<{ message: string }>) => void
}

export async function createDevServer(
  config: CreateDevServerOptions,
): Promise<void> {
  const {
    name,
    frontendPort,
    apiPort,
    theme,
    entrypoint = './web/client.tsx',
    watchDirs = DEFAULT_WATCH_DIRS,
    externals = DEFAULT_BROWSER_EXTERNALS,
    proxyPaths = DEFAULT_PROXY_PATHS,
    apiUrl,
    useProxy = true,
    onBuildStart,
    onBuildComplete,
    onBuildError,
  } = config

  let buildInProgress = false

  async function buildFrontend(): Promise<void> {
    if (buildInProgress) return
    buildInProgress = true
    onBuildStart?.()

    const startTime = Date.now()

    const result = await Bun.build({
      entrypoints: [entrypoint],
      outdir: './dist/dev',
      target: 'browser',
      splitting: true,
      minify: false,
      sourcemap: 'inline',
      external: externals,
      define: {
        'process.env.NODE_ENV': JSON.stringify('development'),
        'process.env.PUBLIC_API_URL': JSON.stringify(
          apiUrl ?? `http://${getLocalhostHost()}:${apiPort}`,
        ),
      },
    })

    buildInProgress = false

    if (!result.success) {
      onBuildError?.(result.logs.map((log) => ({ message: String(log) })))
      console.error(`[${name}] Build failed:`)
      for (const log of result.logs) {
        console.error(log)
      }
      return
    }

    const duration = Date.now() - startTime
    onBuildComplete?.(duration)
    console.log(`[${name}] Frontend rebuilt in ${duration}ms`)
  }

  async function startFrontendServer(): Promise<void> {
    await mkdir('./dist/dev', { recursive: true })
    await buildFrontend()

    const host = getLocalhostHost()
    const targetApiUrl = apiUrl ?? `http://${host}:${apiPort}`

    Bun.serve({
      port: frontendPort,
      async fetch(req) {
        const url = new URL(req.url)
        const pathname = url.pathname

        // Proxy API requests to backend
        if (useProxy && proxyPaths.some((p) => pathname.startsWith(p))) {
          const targetUrl = `${targetApiUrl}${pathname}${url.search}`

          const proxyResponse = await fetch(targetUrl, {
            method: req.method,
            headers: req.headers,
            body:
              req.method !== 'GET' && req.method !== 'HEAD'
                ? req.body
                : undefined,
          }).catch((error) => {
            console.error(`[${name}] Proxy error:`, error.message)
            return new Response(
              JSON.stringify({ error: 'Backend unavailable' }),
              {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              },
            )
          })

          return proxyResponse
        }

        // SPA fallback for client-side routes
        if (pathname !== '/' && !pathname.includes('.')) {
          return new Response(generateDevHtml(theme), {
            headers: { 'Content-Type': 'text/html' },
          })
        }

        // Serve built files
        const filePath = pathname === '/' ? '/index.html' : pathname

        if (filePath === '/index.html') {
          return new Response(generateDevHtml(theme), {
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

        // Serve CSS from web
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

    console.log(`[${name}] Frontend: http://${host}:${frontendPort}`)

    // Watch for changes and rebuild
    for (const dir of watchDirs) {
      if (existsSync(dir)) {
        watch(dir, { recursive: true }, (_eventType, filename) => {
          if (
            filename &&
            (filename.endsWith('.ts') || filename.endsWith('.tsx'))
          ) {
            console.log(`[${name}] ${filename} changed, rebuilding...`)
            buildFrontend()
          }
        })
      }
    }
  }

  console.log(`Starting ${name} frontend server...\n`)
  await startFrontendServer()
  console.log(`\n${name} frontend server ready.`)
  const host = getLocalhostHost()
  console.log(`   Frontend: http://${host}:${frontendPort}`)
  console.log(`   API (proxied to): ${apiUrl ?? `http://${host}:${apiPort}`}`)
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
