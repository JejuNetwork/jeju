/** Factory Dev Server - serves frontend with hot reload */

import { existsSync, mkdirSync, watch } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  CORE_PORTS,
  getChainId,
  getIpfsApiUrl,
  getRpcUrl,
  getWsUrl,
} from '@jejunetwork/config'
import type { BunPlugin } from 'bun'

const PORT = Number(process.env.PORT) || CORE_PORTS.FACTORY.get()

// Plugin to shim server-only modules for browser builds
const browserPlugin: BunPlugin = {
  name: 'browser-plugin',
  setup(build) {
    // Shim node:crypto for browser compatibility (used by @noble/hashes)
    build.onResolve({ filter: /^node:crypto$/ }, () => ({
      path: resolve('./web/shims/node-crypto.ts'),
    }))
  },
}

async function build() {
  const result = await Bun.build({
    entrypoints: ['./web/main.tsx'],
    outdir: './dist/client',
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
      '@jejunetwork/sdk',
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
        'http://127.0.0.1:4180',
      ),
      'import.meta.env.PUBLIC_INDEXER_URL': JSON.stringify(
        `http://127.0.0.1:${CORE_PORTS.INDEXER_GRAPHQL.get()}/graphql`,
      ),
      'import.meta.env.PUBLIC_RPC_GATEWAY_URL': JSON.stringify(
        `http://127.0.0.1:${CORE_PORTS.RPC_GATEWAY.get()}`,
      ),
      'import.meta.env.PUBLIC_OAUTH3_AGENT_URL': JSON.stringify(
        `http://127.0.0.1:${CORE_PORTS.OAUTH3_API.get()}`,
      ),
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

console.log('[Factory] Building frontend...')
if (!(await build())) {
  process.exit(1)
}
console.log('[Factory] Build complete.')

const indexHtml = await Bun.file('./web/index.html').text()
// Transform paths for dev server: use /main.js for direct dev access
const transformedHtml = indexHtml.replace('./main.tsx', '/main.js')

// Also write an index.html to dist/client for JNS gateway to serve
// Uses root-relative paths that work with JNS gateway
const jnsHtml = indexHtml
  .replace('./main.tsx', '/main.js')
  .replace('./styles/globals.css', '/styles/globals.css')
await Bun.write('./dist/client/index.html', jnsHtml)

// Copy CSS to dist/client/styles for JNS gateway
const cssContent = await Bun.file('./web/styles/globals.css').text()
if (!existsSync('./dist/client/styles')) {
  mkdirSync('./dist/client/styles', { recursive: true })
}
await Bun.write('./dist/client/styles/globals.css', cssContent)

console.log('[Factory] Generated dist/client/index.html for JNS gateway')

const server = Bun.serve({
  port: PORT,
  async fetch(req: Request) {
    const url = new URL(req.url)
    const path = url.pathname

    // API routes - proxy to API server or return 404 if not found
    if (
      path.startsWith('/api/') ||
      path.startsWith('/swagger') ||
      path.startsWith('/a2a') ||
      path.startsWith('/mcp')
    ) {
      // In dev mode, API runs separately, so return 404 for now
      // The CLI proxy handles routing these to the API server
      return new Response('Not Found - API routes served separately', {
        status: 404,
      })
    }

    // Serve transformed index.html for SPA routes
    if (path === '/' || (!path.includes('.') && !path.startsWith('/dist'))) {
      return new Response(transformedHtml, {
        headers: { 'Content-Type': 'text/html' },
      })
    }

    // Serve main.js from dist/client (for both dev server and JNS gateway)
    if (path === '/main.js' || path === '/main.js.map') {
      const distPath = join(process.cwd(), 'dist/client', path)
      const distFile = Bun.file(distPath)
      if (await distFile.exists()) {
        return new Response(distFile, {
          headers: {
            'Content-Type': path.endsWith('.map')
              ? 'application/json'
              : 'application/javascript',
          },
        })
      }
    }

    // Serve files from web directory (CSS, images, etc.)
    const webPath = join(process.cwd(), 'web', path)
    const webFile = Bun.file(webPath)
    if (await webFile.exists()) {
      return new Response(webFile)
    }

    // Serve built JS/sourcemaps from dist/client
    if (path.startsWith('/dist/client/')) {
      const distPath = join(process.cwd(), path)
      const distFile = Bun.file(distPath)
      if (await distFile.exists()) {
        return new Response(distFile)
      }
    }

    // Try direct path
    const filePath = join(process.cwd(), path)
    const file = Bun.file(filePath)
    if (await file.exists()) {
      return new Response(file)
    }

    return new Response('Not Found', { status: 404 })
  },
})

console.log(`[Factory] Dev server running at http://localhost:${PORT}`)

const watcher = watch('./web', { recursive: true }, async (_event, filename) => {
  console.log(`[Factory] File changed: ${filename}, rebuilding...`)
  if (await build()) {
    // Regenerate index.html after successful rebuild
    const newIndexHtml = await Bun.file('./web/index.html').text()
    const newJnsHtml = newIndexHtml
      .replace('./main.tsx', '/main.js')
      .replace('./styles/globals.css', '/styles/globals.css')
    await Bun.write('./dist/client/index.html', newJnsHtml)
    // Copy updated CSS
    const newCss = await Bun.file('./web/styles/globals.css').text()
    await Bun.write('./dist/client/styles/globals.css', newCss)
  }
})

process.on('SIGINT', () => {
  watcher.close()
  server.stop()
  process.exit(0)
})
