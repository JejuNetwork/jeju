import { watch } from 'node:fs'
import { join } from 'node:path'
import {
  CORE_PORTS,
  getChainId,
  getIpfsApiUrl,
  getRpcUrl,
  getWsUrl,
  INFRA_PORTS,
} from '@jejunetwork/config'

const PORT = Number(process.env.PORT) || 4014

async function build() {
  const result = await Bun.build({
    entrypoints: ['./web/main.tsx'],
    outdir: './dist/web',
    target: 'browser',
    minify: false,
    sourcemap: 'external',
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
    ],
    define: {
      'process.env.NODE_ENV': JSON.stringify('development'),
      // Use PUBLIC_ prefix for all public env vars
      'import.meta.env.PUBLIC_NETWORK': JSON.stringify('localnet'),
      'import.meta.env.PUBLIC_CHAIN_ID': JSON.stringify(String(getChainId('localnet'))),
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

console.log('Building frontend...')
if (!(await build())) {
  process.exit(1)
}
console.log('Build complete.')

const indexHtml = await Bun.file('./index.html').text()
const transformedHtml = indexHtml.replace('/web/main.tsx', '/dist/web/main.js')

const server = Bun.serve({
  port: PORT,
  async fetch(req: Request) {
    const url = new URL(req.url)
    const path = url.pathname

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

console.log(`Dev server running at http://localhost:${PORT}`)

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
