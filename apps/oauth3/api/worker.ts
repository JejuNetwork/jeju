import { cors } from '@elysiajs/cors'
import { getLocalhostHost } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { isAddress } from 'viem'
import type { AuthConfig } from '../lib/types'
import { createAuthInitRouter } from './routes/auth-init'
import { createClientRouter } from './routes/client'
import { createFarcasterRouter } from './routes/farcaster'
import { createOAuthRouter } from './routes/oauth'
import { createSessionRouter } from './routes/session'
import { createWalletRouter } from './routes/wallet'

// Worker environment bindings
interface Env {
  RPC_URL: string
  MPC_REGISTRY_ADDRESS: string
  IDENTITY_REGISTRY_ADDRESS: string
  SERVICE_AGENT_ID: string
  JWT_SECRET: string // Legacy - deprecated in favor of KMS
  JWT_SIGNING_KEY_ID?: string // MPC key ID for JWT signing
  JWT_SIGNER_ADDRESS?: string // MPC signer address
  ALLOWED_ORIGINS: string
  SQLIT_DATABASE_ID: string
  CHAIN_ID?: string // For KMS access policies
  // Social OAuth - sealed secrets preferred
  GITHUB_CLIENT_ID?: string
  GITHUB_SEALED_SECRET?: string // Preferred
  GITHUB_CLIENT_SECRET?: string // Legacy fallback
  GOOGLE_CLIENT_ID?: string
  GOOGLE_SEALED_SECRET?: string
  GOOGLE_CLIENT_SECRET?: string
  TWITTER_CLIENT_ID?: string
  TWITTER_SEALED_SECRET?: string
  TWITTER_CLIENT_SECRET?: string
  DISCORD_CLIENT_ID?: string
  DISCORD_SEALED_SECRET?: string
  DISCORD_CLIENT_SECRET?: string
}

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

function parseAddress(
  value: string | undefined,
  devFallback: Address,
): Address {
  if (!value) return devFallback
  if (!isAddress(value)) {
    throw new Error(`Invalid address: ${value}`)
  }
  return value
}

function createApp(env: Env) {
  // Set environment variables for the app
  process.env.RPC_URL = env.RPC_URL
  process.env.MPC_REGISTRY_ADDRESS = env.MPC_REGISTRY_ADDRESS
  process.env.IDENTITY_REGISTRY_ADDRESS = env.IDENTITY_REGISTRY_ADDRESS
  process.env.SERVICE_AGENT_ID = env.SERVICE_AGENT_ID
  process.env.JWT_SECRET = env.JWT_SECRET
  process.env.ALLOWED_ORIGINS = env.ALLOWED_ORIGINS
  process.env.SQLIT_DATABASE_ID = env.SQLIT_DATABASE_ID
  process.env.BASE_URL = 'https://auth.jejunetwork.org'

  // Social OAuth env vars - prefer sealed secrets
  if (env.GITHUB_CLIENT_ID) process.env.GITHUB_CLIENT_ID = env.GITHUB_CLIENT_ID
  if (env.GITHUB_SEALED_SECRET)
    process.env.GITHUB_SEALED_SECRET = env.GITHUB_SEALED_SECRET
  if (env.GITHUB_CLIENT_SECRET)
    process.env.GITHUB_CLIENT_SECRET = env.GITHUB_CLIENT_SECRET
  if (env.GOOGLE_CLIENT_ID) process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID
  if (env.GOOGLE_SEALED_SECRET)
    process.env.GOOGLE_SEALED_SECRET = env.GOOGLE_SEALED_SECRET
  if (env.GOOGLE_CLIENT_SECRET)
    process.env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET
  if (env.TWITTER_CLIENT_ID)
    process.env.TWITTER_CLIENT_ID = env.TWITTER_CLIENT_ID
  if (env.TWITTER_SEALED_SECRET)
    process.env.TWITTER_SEALED_SECRET = env.TWITTER_SEALED_SECRET
  if (env.TWITTER_CLIENT_SECRET)
    process.env.TWITTER_CLIENT_SECRET = env.TWITTER_CLIENT_SECRET
  if (env.DISCORD_CLIENT_ID)
    process.env.DISCORD_CLIENT_ID = env.DISCORD_CLIENT_ID
  if (env.DISCORD_SEALED_SECRET)
    process.env.DISCORD_SEALED_SECRET = env.DISCORD_SEALED_SECRET
  if (env.DISCORD_CLIENT_SECRET)
    process.env.DISCORD_CLIENT_SECRET = env.DISCORD_CLIENT_SECRET

  const host = getLocalhostHost()
  const config: AuthConfig = {
    rpcUrl: env.RPC_URL ?? `http://${host}:8545`,
    mpcRegistryAddress: parseAddress(env.MPC_REGISTRY_ADDRESS, ZERO_ADDRESS),
    identityRegistryAddress: parseAddress(
      env.IDENTITY_REGISTRY_ADDRESS,
      ZERO_ADDRESS,
    ),
    serviceAgentId: env.SERVICE_AGENT_ID ?? 'auth.jeju',
    jwtSecret: env.JWT_SECRET ?? 'dev-secret-change-in-production', // Legacy
    jwtSigningKeyId: env.JWT_SIGNING_KEY_ID ?? 'oauth3-jwt-signing',
    jwtSignerAddress: parseAddress(env.JWT_SIGNER_ADDRESS, ZERO_ADDRESS),
    chainId: env.CHAIN_ID ?? 'eip155:420691',
    sessionDuration: 24 * 60 * 60 * 1000, // 24 hours
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '*').split(','),
    devMode: false, // DWS is production
  }

  // Build explicit allowed origins for CORS (wildcards don't work with credentials)
  const explicitOrigins = [
    // Jeju testnet apps
    'https://crucible.testnet.jejunetwork.org',
    'https://autocrat.testnet.jejunetwork.org',
    'https://factory.testnet.jejunetwork.org',
    'https://gateway.testnet.jejunetwork.org',
    'https://bazaar.testnet.jejunetwork.org',
    'https://dws.testnet.jejunetwork.org',
    'https://oauth3.testnet.jejunetwork.org',
    // Jeju mainnet apps
    'https://crucible.jejunetwork.org',
    'https://autocrat.jejunetwork.org',
    'https://factory.jejunetwork.org',
    'https://gateway.jejunetwork.org',
    'https://bazaar.jejunetwork.org',
    'https://dws.jejunetwork.org',
    'https://oauth3.jejunetwork.org',
    // Eliza cloud
    'https://cloud.elizaos.com',
    'https://eliza.cloud',
    'https://elizaos.ai',
    // User-provided allowed origins (except wildcards)
    ...config.allowedOrigins.filter((o) => o !== '*'),
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
      deployment: 'dws',
    }))
    .get('/', () => ({
      name: 'Jeju Auth Gateway',
      version: '1.0.0',
      description: 'OAuth3 authentication gateway for Jeju Network',
      deployment: 'dws',
      endpoints: {
        oauth: '/oauth',
        wallet: '/wallet',
        farcaster: '/farcaster',
        session: '/session',
        client: '/client',
      },
      docs: 'https://docs.jejunetwork.org/auth',
    }))
    .use(createAuthInitRouter(config))
    .use(createOAuthRouter(config))
    .use(createWalletRouter(config))
    .use(createFarcasterRouter(config))
    .use(createSessionRouter(config))
    .use(createClientRouter(config))

  return app
}

// Cloudflare Workers / DWS handler
let app: ReturnType<typeof createApp> | null = null

const workerHandler = {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    if (!app) {
      app = createApp(env)
    }
    return app.fetch(request)
  },
}

// Set global handler for DWS runtime compatibility
;(globalThis as Record<string, unknown>).__WORKER_HANDLER__ = workerHandler

export { workerHandler }
export default workerHandler

/**
 * Bun server entry point - only runs when executed directly
 * When imported as a module (by DWS bootstrap or test), this won't run
 */
const isMainModule = typeof Bun !== 'undefined' && Bun.main === import.meta.path

if (isMainModule) {
  const port = Number(process.env.PORT ?? process.env.OAUTH3_PORT ?? 4200)
  const host = getLocalhostHost()

  const devEnv: Env = {
    RPC_URL: process.env.RPC_URL ?? `http://${host}:8545`,
    MPC_REGISTRY_ADDRESS: process.env.MPC_REGISTRY_ADDRESS ?? '',
    IDENTITY_REGISTRY_ADDRESS: process.env.IDENTITY_REGISTRY_ADDRESS ?? '',
    SERVICE_AGENT_ID: process.env.SERVICE_AGENT_ID ?? 'auth.jeju',
    JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? '*',
    SQLIT_DATABASE_ID: process.env.SQLIT_DATABASE_ID ?? '',
  }

  const appInstance = createApp(devEnv)
  console.log(`[OAuth3 Worker] Starting on http://${host}:${port}`)
  Bun.serve({
    port,
    hostname: host,
    fetch: appInstance.fetch,
  })
}
