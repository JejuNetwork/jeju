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

/**
 * Check if an origin matches allowed patterns
 * Supports exact matches and wildcard patterns like "*.jejunetwork.org"
 * When returning true with credentials:true, Elysia reflects the requesting origin
 */
function isOriginAllowed(
  origin: string,
  allowedOrigins: string[],
  devMode: boolean,
): boolean {
  // In dev mode, allow localhost origins
  if (devMode) {
    const localhostPatterns = [
      /^http:\/\/localhost(:\d+)?$/,
      /^http:\/\/127\.0\.0\.1(:\d+)?$/,
      /^http:\/\/\[::1\](:\d+)?$/,
    ]
    if (localhostPatterns.some((pattern) => pattern.test(origin))) {
      return true
    }
  }

  for (const allowed of allowedOrigins) {
    // Wildcard allows all
    if (allowed === '*') {
      return true
    }

    // Exact match
    if (allowed === origin) {
      return true
    }

    // Wildcard subdomain pattern (e.g., "*.jejunetwork.org")
    if (allowed.startsWith('*.')) {
      const domain = allowed.slice(2) // Remove "*."
      const originUrl = new URL(origin)
      const originHost = originUrl.hostname
      // Match the domain or any subdomain
      if (originHost === domain || originHost.endsWith(`.${domain}`)) {
        return true
      }
    }
  }

  return false
}

async function createApp() {
  const allowedOrigins = oauth3Config.allowedOrigins
  const devMode = oauth3Config.devMode

  const app = new Elysia()
    .use(
      cors({
        origin: (request) => {
          const originHeader = request.headers.get('origin')
          if (!originHeader) {
            // No origin header (same-origin request or non-browser client)
            return true
          }
          return isOriginAllowed(originHeader, allowedOrigins, devMode)
        },
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
