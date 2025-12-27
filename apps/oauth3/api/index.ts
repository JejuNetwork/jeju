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
          'X-Jeju-Timestamp',
          'X-Jeju-Nonce',
        ],
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
