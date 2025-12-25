/**
 * Auth App - OAuth3 Authentication Gateway
 *
 * Provides decentralized authentication for Jeju Network.
 * Acts as a passthrough for other apps to use OAuth3.
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

const isDev = process.env.NODE_ENV !== 'production'

function requireEnv(name: string, devDefault?: string): string {
  const value = process.env[name]
  if (value) return value
  if (isDev && devDefault !== undefined) return devDefault
  throw new Error(`Required environment variable ${name} is not set`)
}

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

const config: AuthConfig = {
  rpcUrl: requireEnv('RPC_URL', 'http://localhost:8545'),
  mpcRegistryAddress: parseAddress(
    process.env.MPC_REGISTRY_ADDRESS,
    ZERO_ADDRESS,
  ),
  identityRegistryAddress: parseAddress(
    process.env.IDENTITY_REGISTRY_ADDRESS,
    ZERO_ADDRESS,
  ),
  serviceAgentId: requireEnv('SERVICE_AGENT_ID', 'auth.jeju'),
  jwtSecret: requireEnv('JWT_SECRET', 'dev-secret-change-in-production'),
  sessionDuration: 24 * 60 * 60 * 1000, // 24 hours
  allowedOrigins: requireEnv('ALLOWED_ORIGINS', '*').split(','),
}

async function createApp() {
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
    }))
    .get('/', () => ({
      name: 'Jeju Auth Gateway',
      version: '1.0.0',
      description: 'OAuth3 authentication gateway for Jeju Network',
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

const port = Number(process.env.PORT ?? 4200)

createApp().then((app) => {
  app.listen(port, () => {
    console.log(`Auth gateway running on http://localhost:${port}`)
  })
})

export type { AuthConfig }
