/**
 * Gateway Backend Server
 *
 * Provides API routes for:
 * - Faucet (status, claim, info)
 * - Health checks
 * - Protocol stats
 */

import { cors } from '@elysiajs/cors'
import { getLocalhostHost } from '@jejunetwork/config'
import Elysia from 'elysia'
import { z } from 'zod'
import { config } from './config'
import {
  claimFromFaucet,
  getFaucetInfo,
  getFaucetStatus,
} from './services/faucet-service'

const PORT = config.gatewayApiPort

const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/)

// SECURITY: Restrict CORS origins in production
const CORS_ORIGINS = config.corsOrigins
const isProduction = config.isProduction

const app = new Elysia()
  .use(
    cors({
      origin: isProduction && CORS_ORIGINS.length > 0 ? CORS_ORIGINS : true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
      maxAge: 86400,
    }),
  )
  .get('/health', () => ({ status: 'ok', service: 'gateway' }))

  // Faucet routes
  .get('/api/faucet/info', () => {
    return getFaucetInfo()
  })

  .get('/api/faucet/status/:address', async ({ params }) => {
    const parsed = AddressSchema.safeParse(params.address)
    if (!parsed.success) {
      return { error: 'Invalid address format' }
    }
    const status = await getFaucetStatus(parsed.data as `0x${string}`)
    return status
  })

  .post('/api/faucet/claim', async ({ body }) => {
    const bodyParsed = z.object({ address: AddressSchema }).safeParse(body)
    if (!bodyParsed.success) {
      return { success: false, error: 'Invalid address format' }
    }
    const result = await claimFromFaucet(
      bodyParsed.data.address as `0x${string}`,
    )
    return result
  })

  .post('/api/faucet/gas-grant', async ({ body }) => {
    const bodyParsed = z.object({ address: AddressSchema }).safeParse(body)
    if (!bodyParsed.success) {
      return { success: false, error: 'Invalid address format' }
    }
    const { claimGasGrant } = await import('./services/faucet-service')
    const result = await claimGasGrant(bodyParsed.data.address as `0x${string}`)
    return result
  })

  .listen(PORT)

const host = getLocalhostHost()
console.log(`Gateway API server running at http://${host}:${PORT}`)

export type App = typeof app
