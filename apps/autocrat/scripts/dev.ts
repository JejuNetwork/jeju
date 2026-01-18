#!/usr/bin/env bun
/**
 * Autocrat Development Server
 *
 * Starts both API and frontend with hot reload:
 * - API: Bun with --watch on port 4040
 * - Frontend: Dev server with HMR on port 4042
 */

import { watch } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getLocalhostHost } from '@jejunetwork/config'
import type { BunPlugin, Subprocess } from 'bun'

const APP_DIR = resolve(import.meta.dir, '..')
const API_PORT = Number(process.env.API_PORT) || 4040
const frontendPortEnv = process.env.FRONTEND_PORT
const FRONTEND_PORT = frontendPortEnv ? Number(frontendPortEnv) : 4042

interface ProcessInfo {
  name: string
  process: Subprocess
}

const processes: ProcessInfo[] = []
let shuttingDown = false

function cleanup() {
  if (shuttingDown) return
  shuttingDown = true

  console.log('\n[Autocrat] Shutting down...')

  for (const { name, process } of processes) {
    console.log(`[Autocrat] Stopping ${name}...`)
    try {
      process.kill()
    } catch {
      // Process may have already exited
    }
  }

  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

async function waitForPort(port: number, timeout = 30000): Promise<boolean> {
  const host = getLocalhostHost()
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://${host}:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      })
      if (response.ok) return true
    } catch {
      // Port not ready yet
    }
    await Bun.sleep(500)
  }
  return false
}

async function startAPIServer(): Promise<boolean> {
  console.log(`[Autocrat] Starting API server on port ${API_PORT}...`)

  const _host = getLocalhostHost()

  // LOCALNET ONLY: Anvil's default development key (account[0])
  // This is the well-known Anvil/Hardhat dev key - NEVER use in production
  // Production uses KMS-based signing via @jejunetwork/kms
  const ANVIL_DEV_KEY =
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

  const proc = Bun.spawn(['bun', '--watch', 'api/worker.ts'], {
    cwd: APP_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      PORT: String(API_PORT),
      NETWORK: 'localnet',
      TEE_MODE: 'simulated',
      TEE_PLATFORM: 'local',
      // Ensure correct RPC for localnet
      RPC_URL: process.env.RPC_URL ?? 'http://127.0.0.1:6546',
      // LOCALNET ONLY: Use Anvil dev key for local development
      // Production: KMS handles all signing via SecretVault
      PRIVATE_KEY: process.env.PRIVATE_KEY ?? ANVIL_DEV_KEY,
      SQLIT_PRIVATE_KEY: process.env.SQLIT_PRIVATE_KEY ?? ANVIL_DEV_KEY,
    },
  })

  processes.push({ name: 'api', process: proc })

  const ready = await waitForPort(API_PORT, 30000)
  if (!ready) {
    console.error('[Autocrat] Failed to start API server')
    return false
  }

  console.log(`[Autocrat] API server started on port ${API_PORT}`)
  return true
}

// Browser build plugin for React deduplication
const browserPlugin: BunPlugin = {
  name: 'browser-plugin',
  setup(build) {
    const reactPath = require.resolve('react')
    const reactDomPath = require.resolve('react-dom')
    build.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }))
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
      path: require.resolve('react/jsx-runtime'),
    }))
    build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
      path: require.resolve('react/jsx-dev-runtime'),
    }))
    build.onResolve({ filter: /^react-dom$/ }, () => ({ path: reactDomPath }))
    build.onResolve({ filter: /^react-dom\/client$/ }, () => ({
      path: require.resolve('react-dom/client'),
    }))
  },
}

const EXTERNALS = [
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
  '@jejunetwork/auth/providers',
  '@jejunetwork/db',
  '@jejunetwork/dws',
  '@jejunetwork/kms',
  '@jejunetwork/deployment',
  '@jejunetwork/training',
  'elysia',
  '@elysiajs/cors',
  '@elysiajs/swagger',
  '@elysiajs/static',
  'ioredis',
  'croner',
  'opossum',
  'ws',
  'generic-pool',
  'c-kzg',
  'kzg-wasm',
  '@aws-sdk/*',
  '@huggingface/*',
  '@solana/*',
  'borsh',
  'tweetnacl',
  'p-retry',
  'yaml',
  'prom-client',
]

let buildInProgress = false

async function buildFrontend(): Promise<boolean> {
  if (buildInProgress) return false
  buildInProgress = true

  const startTime = Date.now()

  const result = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'web/main.tsx')],
    outdir: resolve(APP_DIR, 'dist/dev'),
    target: 'browser',
    minify: false,
    sourcemap: 'inline',
    splitting: false,
    packages: 'bundle',
    plugins: [browserPlugin],
    external: EXTERNALS,
    define: {
      'process.env.NODE_ENV': JSON.stringify('development'),
      'process.browser': 'true',
    },
  })

  buildInProgress = false

  if (!result.success) {
    console.error('[Autocrat] Frontend build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    return false
  }

  const duration = Date.now() - startTime
  console.log(`[Autocrat] Frontend built in ${duration}ms`)
  return true
}

async function startFrontendServer(): Promise<boolean> {
  console.log(
    `[Autocrat] Starting frontend dev server on port ${FRONTEND_PORT}...`,
  )

  await mkdir(resolve(APP_DIR, 'dist/dev'), { recursive: true })

  const buildSuccess = await buildFrontend()
  if (!buildSuccess) {
    console.error('[Autocrat] Initial frontend build failed')
    return false
  }

  const indexHtml = await readFile(resolve(APP_DIR, 'index.html'), 'utf-8')
  const devHtml = indexHtml.replace('./web/main.tsx', '/main.js')

  const host = getLocalhostHost()

  Bun.serve({
    port: FRONTEND_PORT,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url)
      const pathname = url.pathname

      // Proxy API requests
      if (
        pathname.startsWith('/api') ||
        pathname === '/health' ||
        pathname.startsWith('/a2a') ||
        pathname.startsWith('/mcp') ||
        pathname.startsWith('/.well-known')
      ) {
        const targetUrl = `http://${host}:${API_PORT}${pathname}${url.search}`
        try {
          const proxyResponse = await fetch(targetUrl, {
            method: req.method,
            headers: req.headers,
            body:
              req.method !== 'GET' && req.method !== 'HEAD'
                ? req.body
                : undefined,
          })
          return proxyResponse
        } catch (error) {
          console.error('[Autocrat] Proxy error:', (error as Error).message)
          return new Response(
            JSON.stringify({ error: 'Backend unavailable' }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
      }

      // SPA fallback for client-side routes
      if (pathname !== '/' && !pathname.includes('.')) {
        return new Response(devHtml, {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      // Serve index.html
      if (pathname === '/' || pathname === '/index.html') {
        return new Response(devHtml, {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      // Serve from dist/dev
      const devFile = Bun.file(resolve(APP_DIR, `dist/dev${pathname}`))
      if (await devFile.exists()) {
        return new Response(devFile, {
          headers: {
            'Content-Type': getContentType(pathname),
            'Cache-Control': 'no-cache',
          },
        })
      }

      // Serve CSS from web/ (pathname like /web/app/globals.css)
      if (pathname.endsWith('.css')) {
        // Strip leading slash and try as-is first (for /web/app/globals.css)
        const cssPath = pathname.startsWith('/') ? pathname.slice(1) : pathname
        const cssFile = Bun.file(resolve(APP_DIR, cssPath))
        if (await cssFile.exists()) {
          return new Response(cssFile, {
            headers: {
              'Content-Type': 'text/css',
              'Cache-Control': 'no-cache',
            },
          })
        }
      }

      // Serve public files
      const publicFile = Bun.file(resolve(APP_DIR, `public${pathname}`))
      if (await publicFile.exists()) {
        return new Response(publicFile, {
          headers: { 'Content-Type': getContentType(pathname) },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  console.log(`[Autocrat] Frontend dev server started on port ${FRONTEND_PORT}`)

  // Watch for changes
  for (const dir of ['./web', './lib']) {
    const fullDir = resolve(APP_DIR, dir)
    try {
      watch(fullDir, { recursive: true }, (_eventType, filename) => {
        if (
          filename &&
          (filename.endsWith('.ts') ||
            filename.endsWith('.tsx') ||
            filename.endsWith('.css'))
        ) {
          console.log(`[Autocrat] ${filename} changed, rebuilding...`)
          buildFrontend()
        }
      })
    } catch {
      // Directory may not exist
    }
  }

  return true
}

function getContentType(path: string): string {
  if (path.endsWith('.js')) return 'application/javascript'
  if (path.endsWith('.css')) return 'text/css'
  if (path.endsWith('.html')) return 'text/html'
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  return 'application/octet-stream'
}

async function seedJejuDAO(): Promise<void> {
  console.log('[Autocrat] Seeding Jeju DAO...')

  // LOCALNET ONLY: Anvil's default development key (account[0])
  const ANVIL_DEV_KEY =
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

  const proc = Bun.spawn(['bun', 'run', 'scripts/seed.ts', '--skip-wait'], {
    cwd: APP_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      AUTOCRAT_API_URL: `http://${getLocalhostHost()}:${API_PORT}`,
      // Ensure correct RPC for localnet
      RPC_URL: process.env.RPC_URL ?? 'http://127.0.0.1:6546',
      // LOCALNET ONLY: Use Anvil dev key for seeding
      PRIVATE_KEY: process.env.PRIVATE_KEY ?? ANVIL_DEV_KEY,
      SQLIT_PRIVATE_KEY: process.env.SQLIT_PRIVATE_KEY ?? ANVIL_DEV_KEY,
    },
  })

  const exitCode = await proc.exited

  if (exitCode !== 0) {
    console.warn(
      '[Autocrat] Seeding failed but continuing (DAO may already exist)',
    )
  }
}

async function main() {
  const host = getLocalhostHost()
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║              Autocrat Development Server                    ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  // Start API server first
  if (!(await startAPIServer())) {
    cleanup()
    process.exit(1)
  }

  // Seed Jeju DAO automatically
  await seedJejuDAO()

  // Start frontend dev server
  if (!(await startFrontendServer())) {
    cleanup()
    process.exit(1)
  }

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    Autocrat is ready                        ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(
    `║  API:       http://${host}:${API_PORT}                          ║`,
  )
  console.log(
    `║  Frontend:  http://${host}:${FRONTEND_PORT}                          ║`,
  )
  console.log('║                                                            ║')
  console.log('║  Jeju DAO seeded automatically                             ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('Press Ctrl+C to stop all services')

  // Keep running
  await Promise.all(processes.map((p) => p.process.exited))
}

main().catch((err) => {
  console.error('[Autocrat] Error:', err)
  cleanup()
  process.exit(1)
})
