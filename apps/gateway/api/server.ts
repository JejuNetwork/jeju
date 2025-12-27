/**
 * Gateway Backend Server
 *
 * Provides API routes for:
 * - Faucet (status, claim, info)
 * - Health checks
 * - Protocol stats
 */

import { cors } from '@elysiajs/cors'
import Elysia from 'elysia'
import { z } from 'zod'
import {
  claimFromFaucet,
  getFaucetInfo,
  getFaucetStatus,
} from './services/faucet-service'

const PORT = Number(process.env.GATEWAY_API_PORT) || 4013

const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/)

// SECURITY: Restrict CORS origins in production
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
const isProduction = process.env.NODE_ENV === 'production'

const app = new Elysia()
  .use(
    cors({
      origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : true,
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

  .listen(PORT)

console.log(`Gateway API server running at http://localhost:${PORT}`)

export type App = typeof app
