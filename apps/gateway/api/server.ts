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

const app = new Elysia()
  .use(cors())
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
    const result = await claimFromFaucet(bodyParsed.data.address as `0x${string}`)
    return result
  })

  .listen(PORT)

console.log(`Gateway API server running at http://localhost:${PORT}`)

export type App = typeof app
