#!/usr/bin/env bun
/**
 * Gateway Development Server
 *
 * Starts all Gateway services with hot reload:
 * - Frontend: Dev server with HMR on port 4014
 * - API: Elysia API on port 4013
 * - RPC Server: on port 4012
 * - x402 Server: on port 4015
 */

import { watch } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  getChainId,
  getIndexerGraphqlUrl,
  getIpfsApiUrl,
  getIpfsGatewayUrl,
  getLocalhostHost,
  getOAuth3Url,
  getRpcGatewayUrl,
  getRpcUrl,
  getWsUrl,
} from '@jejunetwork/config'
import type { BunPlugin, Subprocess } from 'bun'

const APP_DIR = resolve(import.meta.dir, '..')
const FRONTEND_PORT = Number(process.env.PORT) || 4014
const API_PORT = Number(process.env.GATEWAY_API_PORT) || 4013
const RPC_PORT = Number(process.env.GATEWAY_RPC_PORT) || 4012
const X402_PORT = Number(process.env.GATEWAY_X402_PORT) || 4015

interface ProcessInfo {
  name: string
  process: Subprocess
}

const processes: ProcessInfo[] = []
let shuttingDown = false

function cleanup() {
  if (shuttingDown) return
  shuttingDown = true

  console.log('\n[Gateway] Shutting down...')

  for (const { name, process } of processes) {
    console.log(`[Gateway] Stopping ${name}...`)
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

async function _waitForPort(port: number, timeout = 30000): Promise<boolean> {
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
  console.log(`[Gateway] Starting API server on port ${API_PORT}...`)

  const proc = Bun.spawn(['bun', '--watch', 'api/server.ts'], {
    cwd: APP_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      PORT: String(API_PORT),
    },
  })

  processes.push({ name: 'api', process: proc })
  return true
}

async function startRPCServer(): Promise<boolean> {
  console.log(`[Gateway] Starting RPC server on port ${RPC_PORT}...`)

  const proc = Bun.spawn(['bun', '--watch', 'api/rpc-server.ts'], {
    cwd: APP_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      PORT: String(RPC_PORT),
    },
  })

  processes.push({ name: 'rpc', process: proc })
  return true
}

async function startX402Server(): Promise<boolean> {
  console.log(`[Gateway] Starting x402 server on port ${X402_PORT}...`)

  const proc = Bun.spawn(['bun', '--watch', 'api/x402-server.ts'], {
    cwd: APP_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      PORT: String(X402_PORT),
    },
  })

  processes.push({ name: 'x402', process: proc })
  return true
}

// Browser plugin for shimming
const browserPlugin: BunPlugin = {
  name: 'browser-plugin',
  setup(build) {
    build.onResolve({ filter: /^node:crypto$/ }, () => ({
      path: resolve(APP_DIR, 'web/shims/node-crypto.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/sdk$/ }, () => ({
      path: resolve(APP_DIR, 'web/shims/sdk.ts'),
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
  '@jejunetwork/db',
  '@jejunetwork/dws',
  '@jejunetwork/kms',
  '@jejunetwork/deployment',
  '@jejunetwork/training',
  '@jejunetwork/messaging',
  'elysia',
  '@elysiajs/*',
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
    outdir: resolve(APP_DIR, 'dist/web'),
    target: 'browser',
    minify: false,
    sourcemap: 'external',
    plugins: [browserPlugin],
    external: EXTERNALS,
    define: {
      'process.env': JSON.stringify({
        NODE_ENV: 'development',
        JEJU_NETWORK: 'localnet',
      }),
      'import.meta.env.VITE_NETWORK': JSON.stringify('localnet'),
      'import.meta.env.PUBLIC_NETWORK': JSON.stringify('localnet'),
      'import.meta.env.PUBLIC_CHAIN_ID': JSON.stringify(
        String(getChainId('localnet')),
      ),
      'import.meta.env.PUBLIC_RPC_URL': JSON.stringify(getRpcUrl('localnet')),
      'import.meta.env.PUBLIC_WS_URL': JSON.stringify(getWsUrl('localnet')),
      'import.meta.env.PUBLIC_IPFS_API': JSON.stringify(getIpfsApiUrl()),
      'import.meta.env.PUBLIC_IPFS_GATEWAY': JSON.stringify(
        getIpfsGatewayUrl(),
      ),
      'import.meta.env.PUBLIC_INDEXER_URL': JSON.stringify(
        getIndexerGraphqlUrl(),
      ),
      'import.meta.env.PUBLIC_RPC_GATEWAY_URL': JSON.stringify(
        getRpcGatewayUrl(),
      ),
      'import.meta.env.PUBLIC_OAUTH3_AGENT_URL': JSON.stringify(getOAuth3Url()),
      'import.meta.env.MODE': JSON.stringify('development'),
      'import.meta.env.DEV': JSON.stringify(true),
      'import.meta.env.PROD': JSON.stringify(false),
      'import.meta.env.SSR': JSON.stringify(false),
    },
  })

  buildInProgress = false

  if (!result.success) {
    console.error('[Gateway] Frontend build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    return false
  }

  const duration = Date.now() - startTime
  console.log(`[Gateway] Frontend built in ${duration}ms`)
  return true
}

async function startFrontendServer(): Promise<boolean> {
  console.log(
    `[Gateway] Starting frontend dev server on port ${FRONTEND_PORT}...`,
  )

  const buildSuccess = await buildFrontend()
  if (!buildSuccess) {
    console.error('[Gateway] Initial frontend build failed')
    return false
  }

  const indexHtml = await Bun.file(resolve(APP_DIR, 'index.html')).text()
  const transformedHtml = indexHtml.replace(
    '/web/main.tsx',
    '/dist/web/main.js',
  )

  const host = getLocalhostHost()

  Bun.serve({
    port: FRONTEND_PORT,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      // Proxy API requests
      if (path.startsWith('/api/')) {
        const apiUrl = `http://${host}:${API_PORT}${path}${url.search}`
        try {
          const response = await fetch(apiUrl, {
            method: req.method,
            headers: req.headers,
            body:
              req.method !== 'GET' && req.method !== 'HEAD'
                ? req.body
                : undefined,
          })
          return response
        } catch {
          return new Response(
            JSON.stringify({ error: 'API server unavailable' }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
      }

      // SPA fallback
      if (path === '/' || (!path.includes('.') && !path.startsWith('/api'))) {
        return new Response(transformedHtml, {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      // Serve built files
      const filePath = join(APP_DIR, path)
      const file = Bun.file(filePath)
      if (await file.exists()) {
        return new Response(file, {
          headers: { 'Cache-Control': 'no-cache' },
        })
      }

      const distPath = join(APP_DIR, 'dist/web', path.replace('/dist/web/', ''))
      const distFile = Bun.file(distPath)
      if (await distFile.exists()) {
        return new Response(distFile, {
          headers: { 'Cache-Control': 'no-cache' },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  console.log(`[Gateway] Frontend dev server started on port ${FRONTEND_PORT}`)

  // Watch for changes
  watch(resolve(APP_DIR, 'web'), { recursive: true }, (_event, filename) => {
    if (filename && (filename.endsWith('.ts') || filename.endsWith('.tsx'))) {
      console.log(`[Gateway] ${filename} changed, rebuilding...`)
      buildFrontend()
    }
  })

  return true
}

async function checkContracts(): Promise<boolean> {
  const { getContractsConfig } = await import('@jejunetwork/config')
  const { createPublicClient, http } = await import('viem')

  try {
    const config = getContractsConfig('localnet')
    const rpcUrl = getRpcUrl('localnet')
    const client = createPublicClient({
      transport: http(rpcUrl, { timeout: 3000 }),
    })

    // Check if chain is available
    await client.getChainId()

    // Check if key contracts are deployed
    const identityRegistry = config.registry?.IdentityRegistry as
      | `0x${string}`
      | undefined
    if (!identityRegistry || identityRegistry === '0x') {
      return false
    }

    const code = await client.getCode({ address: identityRegistry })
    return code !== undefined && code !== '0x' && code.length > 2
  } catch {
    return false
  }
}

async function main() {
  const host = getLocalhostHost()
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║              Gateway Development Server                     ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  // Check if contracts are deployed
  console.log('[Gateway] Checking contract deployment...')
  const hasContracts = await checkContracts()
  if (!hasContracts) {
    console.log(
      '[Gateway] Contracts not found. Running with limited functionality.',
    )
    console.log(
      '[Gateway] For full functionality, run: jeju dev (deploys all contracts)',
    )
  } else {
    console.log('[Gateway] Contracts verified.')
  }
  console.log('')

  // Start API services
  await startAPIServer()
  await startRPCServer()
  await startX402Server()

  // Start frontend dev server
  if (!(await startFrontendServer())) {
    cleanup()
    process.exit(1)
  }

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    Gateway is ready                         ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(
    `║  Frontend:  http://${host}:${FRONTEND_PORT}                         ║`,
  )
  console.log(
    `║  API:       http://${host}:${API_PORT}                          ║`,
  )
  console.log(
    `║  RPC:       http://${host}:${RPC_PORT}                          ║`,
  )
  console.log(
    `║  x402:      http://${host}:${X402_PORT}                          ║`,
  )
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('Press Ctrl+C to stop all services')

  // Keep running
  await Promise.all(processes.map((p) => p.process.exited))
}

main().catch((err) => {
  console.error('[Gateway] Error:', err)
  cleanup()
  process.exit(1)
})
