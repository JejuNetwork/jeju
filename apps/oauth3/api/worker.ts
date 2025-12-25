/**
 * OAuth3 Worker - DWS/Cloudflare Workers deployment
 *
 * This is the entry point for decentralized deployment via DWS.
 * Uses workerd runtime with nodejs_compat for maximum compatibility.
 */

import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { isAddress } from 'viem'
import type { AuthConfig } from '../lib/types'
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
  JWT_SECRET: string
  ALLOWED_ORIGINS: string
  CQL_DATABASE_ID: string
  // Social OAuth
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  TWITTER_CLIENT_ID?: string
  TWITTER_CLIENT_SECRET?: string
  DISCORD_CLIENT_ID?: string
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

async function createApp(env: Env) {
  // Set environment variables for the app
  process.env.RPC_URL = env.RPC_URL
  process.env.MPC_REGISTRY_ADDRESS = env.MPC_REGISTRY_ADDRESS
  process.env.IDENTITY_REGISTRY_ADDRESS = env.IDENTITY_REGISTRY_ADDRESS
  process.env.SERVICE_AGENT_ID = env.SERVICE_AGENT_ID
  process.env.JWT_SECRET = env.JWT_SECRET
  process.env.ALLOWED_ORIGINS = env.ALLOWED_ORIGINS
  process.env.CQL_DATABASE_ID = env.CQL_DATABASE_ID
  process.env.BASE_URL = 'https://auth.jejunetwork.org'

  // Social OAuth env vars
  if (env.GITHUB_CLIENT_ID) process.env.GITHUB_CLIENT_ID = env.GITHUB_CLIENT_ID
  if (env.GITHUB_CLIENT_SECRET)
    process.env.GITHUB_CLIENT_SECRET = env.GITHUB_CLIENT_SECRET
  if (env.GOOGLE_CLIENT_ID) process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID
  if (env.GOOGLE_CLIENT_SECRET)
    process.env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET
  if (env.TWITTER_CLIENT_ID)
    process.env.TWITTER_CLIENT_ID = env.TWITTER_CLIENT_ID
  if (env.TWITTER_CLIENT_SECRET)
    process.env.TWITTER_CLIENT_SECRET = env.TWITTER_CLIENT_SECRET
  if (env.DISCORD_CLIENT_ID)
    process.env.DISCORD_CLIENT_ID = env.DISCORD_CLIENT_ID
  if (env.DISCORD_CLIENT_SECRET)
    process.env.DISCORD_CLIENT_SECRET = env.DISCORD_CLIENT_SECRET

  const config: AuthConfig = {
    rpcUrl: env.RPC_URL ?? 'http://localhost:8545',
    mpcRegistryAddress: parseAddress(env.MPC_REGISTRY_ADDRESS, ZERO_ADDRESS),
    identityRegistryAddress: parseAddress(
      env.IDENTITY_REGISTRY_ADDRESS,
      ZERO_ADDRESS,
    ),
    serviceAgentId: env.SERVICE_AGENT_ID ?? 'auth.jeju',
    jwtSecret: env.JWT_SECRET ?? 'dev-secret-change-in-production',
    sessionDuration: 24 * 60 * 60 * 1000, // 24 hours
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '*').split(','),
  }

  const app = new Elysia()
    .use(
      cors({
        origin: config.allowedOrigins,
        credentials: true,
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-Jeju-Address',
          'X-Jeju-Signature',
          'X-Jeju-Nonce',
        ],
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
    .use(await createOAuthRouter(config))
    .use(createWalletRouter(config))
    .use(createFarcasterRouter(config))
    .use(createSessionRouter(config))
    .use(createClientRouter(config))

  return app
}

// Cloudflare Workers / DWS handler
let app: Awaited<ReturnType<typeof createApp>> | null = null

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!app) {
      app = await createApp(env)
    }
    return app.fetch(request)
  },
}
