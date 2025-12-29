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
import type { BunPlugin } from 'bun'

const PORT = Number(process.env.PORT) || 4014

// Plugin to shim server-only modules for browser builds
const browserPlugin: BunPlugin = {
  name: 'browser-plugin',
  setup(build) {
    // Shim node:crypto for browser compatibility (used by @noble/hashes)
    build.onResolve({ filter: /^node:crypto$/ }, () => ({
      path: resolve('./web/shims/node-crypto.ts'),
    }))
    // Shim @jejunetwork/sdk for browser (UI package imports types from it)
    build.onResolve({ filter: /^@jejunetwork\/sdk$/ }, () => ({
      path: resolve('./web/shims/sdk.ts'),
    }))
  },
}

async function build() {
  const result = await Bun.build({
    entrypoints: ['./web/main.tsx'],
    outdir: './dist/web',
    target: 'browser',
    minify: false,
    sourcemap: 'external',
    plugins: [browserPlugin],
    external: [
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
    ],
    define: {
      // Shim process.env for browser - @jejunetwork/config accesses process.env directly
      'process.env': JSON.stringify({
        NODE_ENV: 'development',
        JEJU_NETWORK: 'localnet',
      }),
      // VITE_NETWORK is what @jejunetwork/config looks for in browser
      'import.meta.env.VITE_NETWORK': JSON.stringify('localnet'),
      // Also define PUBLIC_ prefix for other env vars
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
      'import.meta.env.PUBLIC_WALLETCONNECT_PROJECT_ID':
        JSON.stringify('YOUR_PROJECT_ID'),
      'import.meta.env.MODE': JSON.stringify('development'),
      'import.meta.env.DEV': JSON.stringify(true),
      'import.meta.env.PROD': JSON.stringify(false),
      'import.meta.env.SSR': JSON.stringify(false),
    },
  })

  if (!result.success) {
    console.error('Build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    return false
  }
  return true
}

console.log('Building frontend...')
if (!(await build())) {
  process.exit(1)
}
console.log('Build complete.')

const indexHtml = await Bun.file('./index.html').text()
const transformedHtml = indexHtml.replace('/web/main.tsx', '/dist/web/main.js')

const API_PORT = Number(process.env.GATEWAY_API_PORT) || 4013

const server = Bun.serve({
  port: PORT,
  async fetch(req: Request) {
    const url = new URL(req.url)
    const path = url.pathname

    // Proxy API requests to the backend server
    if (path.startsWith('/api/')) {
      const host = getLocalhostHost()
      const apiUrl = `http://${host}:${API_PORT}${path}${url.search}`
      const response = await fetch(apiUrl, {
        method: req.method,
        headers: req.headers,
        body:
          req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      }).catch(() => null)

      if (!response) {
        return new Response(
          JSON.stringify({ error: 'API server unavailable' }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      return response
    }

    if (path === '/' || (!path.includes('.') && !path.startsWith('/api'))) {
      return new Response(transformedHtml, {
        headers: { 'Content-Type': 'text/html' },
      })
    }

    const filePath = join(process.cwd(), path)
    const file = Bun.file(filePath)
    if (await file.exists()) {
      return new Response(file)
    }

    const distPath = join(
      process.cwd(),
      'dist/web',
      path.replace('/dist/web/', ''),
    )
    const distFile = Bun.file(distPath)
    if (await distFile.exists()) {
      return new Response(distFile)
    }

    return new Response('Not Found', { status: 404 })
  },
})

const host = getLocalhostHost()
console.log(`Dev server running at http://${host}:${PORT}`)

const watcher = watch(
  './web',
  { recursive: true },
  async (_event, filename) => {
    console.log(`File changed: ${filename}, rebuilding...`)
    await build()
  },
)

process.on('SIGINT', () => {
  watcher.close()
  server.stop()
  process.exit(0)
})
