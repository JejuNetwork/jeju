/**
 * Ban Check Middleware for Example App
 * Demonstrates how to use @jejunetwork/shared ban checking
 */

import {
  type BanCheckConfig,
  BanChecker,
  type BanCheckResult,
} from '@jejunetwork/shared'
import type { Context } from 'elysia'
import type { Address } from 'viem'

// Get config from environment
const BAN_MANAGER_ADDRESS = process.env.BAN_MANAGER_ADDRESS as
  | Address
  | undefined
const MODERATION_MARKETPLACE_ADDRESS = process.env
  .MODERATION_MARKETPLACE_ADDRESS as Address | undefined
const RPC_URL = process.env.RPC_URL || 'http://localhost:6545'
const NETWORK = (process.env.NETWORK || 'localnet') as
  | 'mainnet'
  | 'testnet'
  | 'localnet'

// Skip paths that don't need ban checking
const SKIP_PATHS = ['/health', '/docs', '/.well-known']

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
 * Elysia onBeforeHandle function for ban checking
 */
export async function banCheckHandler({ request, set, path }: Context): Promise<
  | {
      error: string
      message: string
      banType?: string
      caseId?: string
      canAppeal?: boolean
    }
  | undefined
> {
  // Skip if no ban manager configured (local dev)
  if (!checker) {
    return undefined
  }

  // Skip certain paths
  if (SKIP_PATHS.some((skipPath) => path.startsWith(skipPath))) {
    return undefined
  }

  // Extract address from x-jeju-address header (our auth header)
  const address = request.headers.get('x-jeju-address')

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
      message: result.status?.reason || 'User is banned from this application',
      banType: result.status?.banType,
      caseId: result.status?.caseId,
      canAppeal: result.status?.canAppeal,
    }
  }

  return undefined
}

/**
 * Check ban status directly
 */
export async function checkBan(
  address: Address,
): Promise<BanCheckResult | null> {
  if (!checker) return null
  return checker.checkBan(address)
}

/**
 * Clear ban cache
 */
export function clearBanCache(address?: Address): void {
  checker?.clearCache(address)
}
