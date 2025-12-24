import {
  type BanCheckConfig,
  BanChecker,
  type BanCheckResult,
} from '@jejunetwork/shared'
import { parseOptionalAddress } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import {
  BAN_MANAGER_ADDRESS,
  MODERATION_MARKETPLACE_ADDRESS,
} from '../../lib/config/contracts'
import { getRpcUrl } from '../../lib/config/networks'

const gatewayBanConfig: BanCheckConfig = {
  banManagerAddress: BAN_MANAGER_ADDRESS,
  moderationMarketplaceAddress: MODERATION_MARKETPLACE_ADDRESS,
  rpcUrl: getRpcUrl(84532),
  network: 'testnet',
  cacheTtlMs: 30000,
  failClosed: true,
}

const checker = new BanChecker(gatewayBanConfig)

interface RequestBody {
  address?: string
  from?: string
}

export const banCheckPlugin = (options: { skipPaths?: string[] } = {}) => {
  const { skipPaths = ['/health', '/.well-known', '/public'] } = options

  return new Elysia({ name: 'ban-check' })
    .derive(({ request, headers, body }) => {
      const url = new URL(request.url)
      const requestBody = body as RequestBody | null
      const rawAddress =
        headers['x-wallet-address'] || requestBody?.address || requestBody?.from
      const address = parseOptionalAddress(rawAddress)

      return { path: url.pathname, walletAddress: address }
    })
    .onBeforeHandle(async ({ path, walletAddress, set }) => {
      if (skipPaths.some((p) => path.startsWith(p))) {
        return
      }

      if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        return
      }

      const result = await checker.checkBan(walletAddress)

      if (!result.allowed) {
        set.status = 403
        return {
          error: 'BANNED',
          message: result.status?.reason || 'User is banned',
          caseId: result.status?.caseId,
        }
      }

      if (result.status?.isOnNotice) {
        set.headers['X-Moderation-Status'] = 'ON_NOTICE'
        set.headers['X-Moderation-Case'] = result.status.caseId || 'unknown'
      }
    })
}

export const strictBanCheckPlugin = () => banCheckPlugin({})

export const lenientBanCheckPlugin = () => {
  return new Elysia({ name: 'lenient-ban-check' })
    .derive(({ headers, body }) => {
      const requestBody = body as RequestBody | null
      const rawAddress =
        headers['x-wallet-address'] || requestBody?.address || requestBody?.from
      return { walletAddress: parseOptionalAddress(rawAddress) }
    })
    .onBeforeHandle(async ({ walletAddress, set }) => {
      if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        return
      }

      const result = await checker.checkBan(walletAddress)

      if (!result.allowed && result.status && !result.status.isOnNotice) {
        set.status = 403
        return {
          error: 'BANNED',
          message: result.status.reason || 'User is banned',
          caseId: result.status.caseId,
        }
      }

      if (result.status?.isOnNotice) {
        set.headers['X-Moderation-Status'] = 'ON_NOTICE'
        set.headers['X-Moderation-Case'] = result.status.caseId || 'unknown'
      }
    })
}

export async function checkBan(address: Address): Promise<BanCheckResult> {
  return checker.checkBan(address)
}

export function clearBanCache(address?: Address): void {
  checker.clearCache(address)
}
