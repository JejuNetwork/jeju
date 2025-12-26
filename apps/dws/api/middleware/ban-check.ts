/**
 * Ban Check Middleware for DWS
 * Uses @jejunetwork/shared for ban checking
 */

import { getCurrentNetwork } from '@jejunetwork/config'
import { type BanCheckConfig, BanChecker } from '@jejunetwork/shared'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { z } from 'zod'

// Schema for extracting address from request body
const AddressFieldsSchema = z.object({
  address: z.string().optional(),
  from: z.string().optional(),
  sender: z.string().optional(),
  owner: z.string().optional(),
})

// Get config from environment
const BAN_MANAGER_ADDRESS = process.env.BAN_MANAGER_ADDRESS as
  | Address
  | undefined
const MODERATION_MARKETPLACE_ADDRESS = process.env
  .MODERATION_MARKETPLACE_ADDRESS as Address | undefined
const RPC_URL = process.env.RPC_URL || 'http://localhost:6545'
const NETWORK = getCurrentNetwork()

// Skip paths that don't need ban checking (public endpoints)
const SKIP_PATHS = [
  '/health',
  '/info',
  '/metrics',
  '/.well-known',
  '/storage/ipfs', // Public IPFS gateway reads
  '/cdn', // Public CDN reads
]

// Create checker only if ban manager is configured
let checker: BanChecker | null = null

if (BAN_MANAGER_ADDRESS) {
  const config: BanCheckConfig = {
    banManagerAddress: BAN_MANAGER_ADDRESS,
    moderationMarketplaceAddress: MODERATION_MARKETPLACE_ADDRESS,
    rpcUrl: RPC_URL,
    network: NETWORK,
    cacheTtlMs: 30000,
    failClosed: true,
  }
  checker = new BanChecker(config)
}

/**
 * Elysia plugin that checks ban status
 */
export function banCheckMiddleware() {
  return new Elysia({ name: 'ban-check' }).onBeforeHandle(
    async ({ request, set }) => {
      // Skip if no ban manager configured (local dev)
      if (!checker) {
        return
      }

      const url = new URL(request.url)
      const path = url.pathname

      // Skip certain paths
      if (SKIP_PATHS.some((skipPath) => path.startsWith(skipPath))) {
        return
      }

      // Skip GET requests on public read paths
      if (request.method === 'GET' && path.startsWith('/storage/')) {
        return
      }

      // Extract address from various sources
      let address =
        request.headers.get('x-wallet-address') ??
        url.searchParams.get('address')

      if (!address) {
        // Try to get from JSON body for POST/PUT/DELETE
        if (['POST', 'PUT', 'DELETE'].includes(request.method)) {
          const contentType = request.headers.get('content-type') ?? ''
          if (contentType.includes('application/json')) {
            const clonedRequest = request.clone()
            const rawBody = await clonedRequest.json()
            const parsed = AddressFieldsSchema.safeParse(rawBody)
            if (parsed.success) {
              const body = parsed.data
              address =
                body.address ?? body.from ?? body.sender ?? body.owner ?? null
            }
          }
        }
      }

      // No address to check - allow through
      if (!address) {
        return
      }

      // Validate address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return
      }

      const result = await checker.checkBan(address as Address)

      if (!result.allowed) {
        set.status = 403
        return {
          error: 'BANNED',
          message: result.status?.reason || 'User is banned from DWS services',
          banType: result.status?.banType,
          caseId: result.status?.caseId,
          canAppeal: result.status?.canAppeal,
        }
      }

      return undefined
    },
  )
}
