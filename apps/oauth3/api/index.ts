import { cors } from '@elysiajs/cors'
import { getLocalhostHost } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { isAddress } from 'viem'
import type { AuthConfig } from '../lib/types'
import { config as oauth3Config } from './config'
import { createAuthInitRouter } from './routes/auth-init'
import { createClientRouter } from './routes/client'
import { createFarcasterRouter } from './routes/farcaster'
import { createOAuthRouter } from './routes/oauth'
import { createSessionRouter } from './routes/session'
import { createWalletRouter } from './routes/wallet'

const isDev = !oauth3Config.isProduction

function parseAddress(
  value: string | undefined,
  devFallback: Address,
): Address {
  if (!value) {
    if (isDev) return devFallback
    throw new Error('Address environment variable is required in production')
  }
  if (!isAddress(value)) {
    throw new Error(`Invalid address: ${value}`)
  }
  return value
}

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

const authConfig: AuthConfig = {
  rpcUrl: oauth3Config.rpcUrl,
  mpcRegistryAddress: parseAddress(
    oauth3Config.mpcRegistryAddress,
    ZERO_ADDRESS,
  ),
  identityRegistryAddress: parseAddress(
    oauth3Config.identityRegistryAddress,
    ZERO_ADDRESS,
  ),
  serviceAgentId: oauth3Config.serviceAgentId,
  jwtSecret: oauth3Config.jwtSecret,
  jwtSigningKeyId: oauth3Config.jwtSigningKeyId,
  jwtSignerAddress: parseAddress(oauth3Config.jwtSignerAddress, ZERO_ADDRESS),
  sessionDuration: oauth3Config.sessionDuration,
  allowedOrigins: oauth3Config.allowedOrigins,
  devMode: oauth3Config.devMode,
}

async function createApp() {
  // Build explicit allowed origins for CORS (wildcards don't work with credentials)
  const host = getLocalhostHost()
  const explicitOrigins = [
    // Localhost development
    `http://${host}:3000`,
    `http://${host}:3001`,
    `http://${host}:4200`,
    `http://${host}:4020`, // Crucible frontend
    `http://${host}:4040`, // Autocrat frontend
    // Local development proxy (Caddy on port 8080 or 80)
    'http://crucible.local.jejunetwork.org:8080',
    'http://crucible.local.jejunetwork.org',
    'http://autocrat.local.jejunetwork.org:8080',
    'http://autocrat.local.jejunetwork.org',
    'http://bazaar.local.jejunetwork.org:8080',
    'http://bazaar.local.jejunetwork.org',
    'http://wallet.local.jejunetwork.org:8080',
    'http://wallet.local.jejunetwork.org',
    'http://factory.local.jejunetwork.org:8080',
    'http://factory.local.jejunetwork.org',
    'http://gateway.local.jejunetwork.org:8080',
    'http://gateway.local.jejunetwork.org',
    'http://dws.local.jejunetwork.org:8080',
    'http://dws.local.jejunetwork.org',
    'http://otto.local.jejunetwork.org:8080',
    'http://otto.local.jejunetwork.org',
    // Eliza cloud
    'https://cloud.elizaos.com',
    'https://eliza.cloud',
    'https://elizaos.ai',
    // Jeju testnet apps
    'https://crucible.testnet.jejunetwork.org',
    'https://autocrat.testnet.jejunetwork.org',
    'https://factory.testnet.jejunetwork.org',
    'https://gateway.testnet.jejunetwork.org',
    'https://bazaar.testnet.jejunetwork.org',
    'https://dws.testnet.jejunetwork.org',
    // Jeju mainnet apps
    'https://crucible.jejunetwork.org',
    'https://autocrat.jejunetwork.org',
    'https://factory.jejunetwork.org',
    'https://gateway.jejunetwork.org',
    'https://bazaar.jejunetwork.org',
    'https://dws.jejunetwork.org',
    // User-provided allowed origins
    ...authConfig.allowedOrigins.filter((o) => o !== '*'),
  ]

  const app = new Elysia()
    .use(
      cors({
        origin: explicitOrigins,
        credentials: true,
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-Jeju-Address',
          'X-Jeju-Signature',
          'X-Jeju-Timestamp',
          'X-Jeju-Nonce',
        ],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      }),
    )
    .get('/health', () => ({
      status: 'healthy',
      service: 'auth',
      timestamp: Date.now(),
    }))
    .get('/api', () => ({
      name: 'Jeju Auth Gateway',
      version: '1.0.0',
      description: 'OAuth3 authentication gateway for Jeju Network',
      endpoints: {
        auth: '/auth',
        oauth: '/oauth',
        wallet: '/wallet',
        farcaster: '/farcaster',
        session: '/session',
        client: '/client',
      },
      docs: 'https://docs.jejunetwork.org/auth',
    }))
    // Serve static frontend files
    .get('/', async () => {
      const file = Bun.file('./web/index.html')
      if (await file.exists()) {
        return new Response(file, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      // Fallback: try dist/web
      const distFile = Bun.file('./dist/web/index.html')
      if (await distFile.exists()) {
        return new Response(distFile, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      return new Response('OAuth3 Authentication Gateway', {
        headers: { 'Content-Type': 'text/plain' },
      })
    })
    .get('/app.js', async () => {
      // Try source first for dev
      const srcFile = Bun.file('./web/app.ts')
      if (await srcFile.exists()) {
        // Build on the fly for dev
        const result = await Bun.build({
          entrypoints: ['./web/app.ts'],
          target: 'browser',
          minify: false,
        })
        if (result.outputs[0]) {
          const text = await result.outputs[0].text()
          return new Response(text, {
            headers: {
              'Content-Type': 'application/javascript; charset=utf-8',
            },
          })
        }
      }
      // Try built file
      const distFile = Bun.file('./dist/web/app.js')
      if (await distFile.exists()) {
        return new Response(distFile, {
          headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
        })
      }
      return new Response('// app not found', { status: 404 })
    })
    // Callback route for OAuth flows
    .get('/callback', async () => {
      const file = Bun.file('./web/index.html')
      if (await file.exists()) {
        return new Response(file, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      const distFile = Bun.file('./dist/web/index.html')
      return new Response(distFile, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    })
    .use(createAuthInitRouter(authConfig))
    .use(await createOAuthRouter(authConfig))
    .use(createWalletRouter(authConfig))
    .use(createFarcasterRouter(authConfig))
    .use(createSessionRouter(authConfig))
    .use(createClientRouter(authConfig))

  return app
}

const port = oauth3Config.port

createApp().then((app) => {
  app.listen(port, () => {
    const host = getLocalhostHost()
    console.log(`Auth gateway running on http://${host}:${port}`)
  })
})

export type { AuthConfig }
