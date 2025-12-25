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

function parseAddress(value: string | undefined, fallback: Address): Address {
  if (!value) return fallback
  if (!isAddress(value)) {
    throw new Error(`Invalid address: ${value}`)
  }
  return value
}

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

const config: AuthConfig = {
  rpcUrl: process.env.RPC_URL ?? 'http://localhost:8545',
  mpcRegistryAddress: parseAddress(
    process.env.MPC_REGISTRY_ADDRESS,
    ZERO_ADDRESS,
  ),
  identityRegistryAddress: parseAddress(
    process.env.IDENTITY_REGISTRY_ADDRESS,
    ZERO_ADDRESS,
  ),
  serviceAgentId: process.env.SERVICE_AGENT_ID ?? 'auth.jeju',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
  sessionDuration: 24 * 60 * 60 * 1000, // 24 hours
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '*').split(','),
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
  .use(createOAuthRouter(config))
  .use(createWalletRouter(config))
  .use(createFarcasterRouter(config))
  .use(createSessionRouter(config))
  .use(createClientRouter(config))

const port = Number(process.env.PORT ?? 4200)

app.listen(port, () => {
  console.log(`Auth gateway running on http://localhost:${port}`)
})

export type App = typeof app
