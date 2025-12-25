import { getCurrentNetwork } from '@jejunetwork/config'
import {
  type BanCheckConfig,
  BanChecker,
  type BanCheckResult,
} from '@jejunetwork/shared'
import { isValidAddress } from '@jejunetwork/types'
import type { Context } from 'elysia'
import type { Address } from 'viem'

// Get optional address from environment with type guard
function getOptionalAddress(envVar: string | undefined): Address | undefined {
  if (!envVar || !isValidAddress(envVar)) return undefined
  return envVar
}

const BAN_MANAGER_ADDRESS = getOptionalAddress(process.env.BAN_MANAGER_ADDRESS)
const MODERATION_MARKETPLACE_ADDRESS = getOptionalAddress(
  process.env.MODERATION_MARKETPLACE_ADDRESS,
)
const RPC_URL = process.env.RPC_URL || 'http://localhost:6545'
const NETWORK = getCurrentNetwork()

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

  // No address or invalid address - allow through
  if (!address || !isValidAddress(address)) {
    return undefined
  }

  const result = await checker.checkBan(address)

  if (!result.allowed) {
    set.status = 403
    return {
      error: 'BANNED',
      message: result.status?.reason ?? 'User is banned from this application',
      banType:
        result.status?.banType !== undefined
          ? String(result.status.banType)
          : undefined,
      caseId: result.status?.caseId ?? undefined,
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
