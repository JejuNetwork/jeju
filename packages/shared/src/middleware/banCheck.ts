/**
 * Ban Check Middleware
 *
 * Universal middleware for checking ban status before processing requests.
 * Provides Elysia plugins and generic functions.
 */

import { banManagerAbi } from '@jejunetwork/contracts'
import { Elysia } from 'elysia'
import type { Address, Chain, Hex, PublicClient, Transport } from 'viem'
import { createPublicClient, http } from 'viem'
import { base, baseSepolia } from 'viem/chains'

export interface BanCheckConfig {
  banManagerAddress: Address
  moderationMarketplaceAddress?: Address
  rpcUrl?: string
  network?: 'mainnet' | 'testnet' | 'localnet'
  cacheTtlMs?: number
  failClosed?: boolean
}

export interface BanStatus {
  isBanned: boolean
  isOnNotice: boolean
  banType: number
  reason: string
  caseId: Hex | null
  canAppeal: boolean
}

export interface BanCheckResult {
  allowed: boolean
  status?: BanStatus
  error?: string
}

interface CacheEntry {
  result: BanCheckResult
  timestamp: number
}

const MAX_CACHE_SIZE = 10000
const cache = new Map<string, CacheEntry>()

function setCacheEntry(key: string, entry: CacheEntry): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const entries = Array.from(cache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp,
    )
    const toRemove = Math.ceil(entries.length * 0.1)
    for (let i = 0; i < toRemove; i++) {
      cache.delete(entries[i][0])
    }
  }
  cache.set(key, entry)
}

export class BanChecker {
  private config: Required<BanCheckConfig>
  private publicClient: PublicClient<Transport, Chain>

  constructor(config: BanCheckConfig) {
    const network = config.network || 'testnet'
    const defaultRpc =
      network === 'mainnet'
        ? 'https://mainnet.base.org'
        : network === 'testnet'
          ? 'https://sepolia.base.org'
          : 'http://localhost:6545'

    this.config = {
      banManagerAddress: config.banManagerAddress,
      moderationMarketplaceAddress:
        config.moderationMarketplaceAddress || ('0x0' as Address),
      rpcUrl: config.rpcUrl || defaultRpc,
      network,
      cacheTtlMs: config.cacheTtlMs || 10000,
      failClosed: config.failClosed ?? true,
    }

    const chain = network === 'mainnet' ? base : baseSepolia
    this.publicClient = createPublicClient({
      chain,
      transport: http(this.config.rpcUrl),
    }) as PublicClient<Transport, Chain>
  }

  async checkBan(address: Address): Promise<BanCheckResult> {
    const cacheKey = address.toLowerCase()

    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.config.cacheTtlMs) {
      return cached.result
    }

    try {
      // Use typed ABI - viem infers return types automatically
      const [isBanned, isOnNotice, banRecord] = await Promise.all([
        this.publicClient.readContract({
          address: this.config.banManagerAddress,
          abi: banManagerAbi,
          functionName: 'isAddressBanned',
          args: [address],
        }),
        this.publicClient.readContract({
          address: this.config.banManagerAddress,
          abi: banManagerAbi,
          functionName: 'isOnNotice',
          args: [address],
        }),
        this.publicClient.readContract({
          address: this.config.banManagerAddress,
          abi: banManagerAbi,
          functionName: 'getAddressBan',
          args: [address],
        }),
      ])

      const status: BanStatus = {
        isBanned,
        isOnNotice,
        banType: banRecord.banType,
        reason: banRecord.reason || '',
        caseId: banRecord.caseId || null,
        canAppeal: banRecord.banType === 3,
      }

      const result: BanCheckResult = {
        allowed: !status.isBanned && !status.isOnNotice,
        status,
      }

      setCacheEntry(cacheKey, { result, timestamp: Date.now() })
      return result
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'

      if (this.config.failClosed) {
        return {
          allowed: false,
          error: `Ban check failed (fail-closed): ${errorMessage}`,
        }
      }

      return {
        allowed: true,
        error: `Ban check failed (fail-open): ${errorMessage}`,
      }
    }
  }

  clearCache(address?: Address): void {
    if (address) {
      cache.delete(address.toLowerCase())
    } else {
      cache.clear()
    }
  }
}

interface RequestBody {
  address?: string
  from?: string
  sender?: string
}

export function createElysiaBanPlugin(config: BanCheckConfig) {
  const checker = new BanChecker(config)

  return new Elysia({ name: 'ban-check' })
    .derive(({ request: _request, headers, body }) => {
      const requestBody = body as RequestBody | null
      const address = (headers['x-wallet-address'] ||
        requestBody?.address ||
        requestBody?.from ||
        requestBody?.sender) as Address | undefined

      return { walletAddress: address }
    })
    .onBeforeHandle(async ({ walletAddress, set }) => {
      if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        return undefined
      }

      const result = await checker.checkBan(walletAddress)

      if (!result.allowed) {
        set.status = 403
        return {
          error: 'BANNED',
          message: result.status?.reason || 'User is banned from this service',
          banType: result.status?.banType,
          caseId: result.status?.caseId,
          canAppeal: result.status?.canAppeal,
        }
      }

      return undefined
    })
}

export async function isBanned(
  address: Address,
  config: BanCheckConfig,
): Promise<boolean> {
  const checker = new BanChecker(config)
  const result = await checker.checkBan(address)
  return !result.allowed
}

export async function getBanStatus(
  address: Address,
  config: BanCheckConfig,
): Promise<BanCheckResult> {
  const checker = new BanChecker(config)
  return checker.checkBan(address)
}

let defaultChecker: BanChecker | null = null

export function initBanChecker(config: BanCheckConfig): BanChecker {
  defaultChecker = new BanChecker(config)
  return defaultChecker
}

export function getDefaultChecker(): BanChecker {
  if (!defaultChecker) {
    throw new Error('BanChecker not initialized. Call initBanChecker first.')
  }
  return defaultChecker
}
