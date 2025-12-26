/**
 * Ban Check Middleware for Crucible
 * Uses @jejunetwork/shared for ban checking
 */

import { getCurrentNetwork, getRpcUrl } from '@jejunetwork/config'
import { type BanCheckConfig, BanChecker } from '@jejunetwork/shared'
import type { Address } from 'viem'
import { z } from 'zod'

// Schema for address extraction from request body
const AddressBodySchema = z
  .object({
    address: z.string().nullable(),
    from: z.string().nullable(),
    sender: z.string().nullable(),
    agentOwner: z.string().nullable(),
  })
  .passthrough() // Allow other fields but only validate address-related ones

// Get config from centralized config
const NETWORK = getCurrentNetwork()
const RPC_URL = getRpcUrl(NETWORK)

// Try to get contract addresses, but don't fail if not configured
const BAN_MANAGER_ADDRESS = process.env.MODERATION_BAN_MANAGER as
  | Address
  | undefined
const MODERATION_MARKETPLACE_ADDRESS = process.env
  .MODERATION_MODERATION_MARKETPLACE as Address | undefined

// Skip paths that don't need ban checking
const SKIP_PATHS = ['/health', '/info', '/metrics', '/.well-known']

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

interface BanResponse {
  error: string
  message: string
  banType: number | undefined
  caseId: `0x${string}` | null | undefined
  canAppeal: boolean | undefined
}

interface ElysiaContext {
  request: Request
  set: { status?: number | string }
}

/**
 * Elysia middleware that checks ban status
 */
export function banCheckMiddleware() {
  return async (ctx: ElysiaContext): Promise<BanResponse | undefined> => {
    const { request, set } = ctx
    // Skip if no ban manager configured (local dev)
    if (!checker) {
      return undefined
    }

    const url = new URL(request.url)
    const path = url.pathname

    // Skip certain paths
    if (SKIP_PATHS.some((skipPath) => path.startsWith(skipPath))) {
      return undefined
    }

    // Extract address from various sources
    let address: string | null =
      request.headers.get('x-wallet-address') ?? url.searchParams.get('address')

    if (!address) {
      // Try to get from JSON body with schema validation
      const contentType = request.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        const clonedRequest = request.clone()
        const rawBody = await clonedRequest.json()
        if (rawBody !== null) {
          const parsed = AddressBodySchema.safeParse(rawBody)
          if (parsed.success) {
            address =
              parsed.data.address ??
              parsed.data.from ??
              parsed.data.sender ??
              parsed.data.agentOwner ??
              null
          }
        }
      }
    }

    // No address to check - allow through
    if (!address) {
      return undefined
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return undefined
    }

    const result = await checker.checkBan(address as Address)

    if (!result.allowed) {
      set.status = 403
      return {
        error: 'BANNED',
        message:
          result.status?.reason ?? 'User is banned from Crucible services',
        banType: result.status?.banType,
        caseId: result.status?.caseId,
        canAppeal: result.status?.canAppeal,
      }
    }

    return undefined
  }
}
