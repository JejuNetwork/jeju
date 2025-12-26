/**
 * Faucet Routes for DWS
 * Provides testnet-only JEJU token faucet for development and testing.
 *
 * IMPORTANT: Faucet is disabled on mainnet.
 */

import { AddressSchema } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import {
  ClaimRequestSchema,
  claimFromFaucet,
  FaucetClaimResultSchema,
  FaucetInfoSchema,
  FaucetStatusSchema,
  getFaucetInfo,
  getFaucetStatus,
} from '../../faucet'

export function createFaucetRouter() {
  return new Elysia({ name: 'faucet', prefix: '/faucet' })
    .get('/info', () => {
      const info = getFaucetInfo()
      return FaucetInfoSchema.parse(info)
    })
    .get('/status/:address', async ({ params, set }) => {
      const parseResult = AddressSchema.safeParse(params.address)
      if (!parseResult.success) {
        set.status = 400
        return { error: 'Invalid address format' }
      }
      const status = await getFaucetStatus(parseResult.data)
      return FaucetStatusSchema.parse(status)
    })
    .post('/claim', async ({ body, set }) => {
      const parseResult = ClaimRequestSchema.safeParse(body)
      if (!parseResult.success) {
        set.status = 400
        return {
          success: false,
          error: `Invalid request: ${parseResult.error.issues[0].message}`,
        }
      }

      const result = await claimFromFaucet(parseResult.data.address).catch(
        (error: Error) => ({
          success: false as const,
          error: error.message,
        }),
      )

      const validated = FaucetClaimResultSchema.parse(result)

      if (!validated.success) {
        set.status = 400
        return validated
      }

      return validated
    })
}
