#!/usr/bin/env bun
/**
 * Standalone Faucet API Server
 *
 * Minimal server that only runs the faucet endpoints.
 * Run with: DEPLOYER_PRIVATE_KEY=0x... USE_MEMORY_STATE=true bun run api/faucet-server.ts
 */
import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { z } from 'zod'
import {
  claimFromFaucet,
  claimGasGrant,
  getFaucetInfo,
  getFaucetStatus,
} from './services/faucet-service'

const PORT = Number(process.env.FAUCET_PORT) || 4014
const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/)

const app = new Elysia()
  .use(cors({ origin: true }))
  .get('/health', () => ({ status: 'ok', service: 'faucet' }))
  .get('/api/faucet/info', () => getFaucetInfo())
  .get('/api/faucet/status/:address', async ({ params }) => {
    const parsed = AddressSchema.safeParse(params.address)
    if (!parsed.success) return { error: 'Invalid address format' }
    return getFaucetStatus(parsed.data as `0x${string}`)
  })
  .post('/api/faucet/claim', async ({ body }) => {
    const bodyParsed = z.object({ address: AddressSchema }).safeParse(body)
    if (!bodyParsed.success) return { success: false, error: 'Invalid address format' }
    try {
      return await claimFromFaucet(bodyParsed.data.address as `0x${string}`)
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
  .post('/api/faucet/gas-grant', async ({ body }) => {
    const bodyParsed = z.object({ address: AddressSchema }).safeParse(body)
    if (!bodyParsed.success) return { success: false, error: 'Invalid address format' }
    try {
      return await claimGasGrant(bodyParsed.data.address as `0x${string}`)
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
  .listen(PORT)

console.log(`[Faucet] API server running on port ${PORT}`)
