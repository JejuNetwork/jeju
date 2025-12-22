/**
 * Ban Check Middleware
 *
 * Universal middleware for checking ban status before processing requests.
 * Provides Elysia plugins and generic functions.
 */

import { Elysia } from 'elysia'
import {
  type Address,
  type Chain,
  createPublicClient,
  type Hex,
  http,
  type PublicClient,
  type Transport,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { BAN_MANAGER_ABI } from '../api/abis'

// ============ Types ============

export interface BanCheckConfig {
  banManagerAddress: Address
  moderationMarketplaceAddress?: Address
  rpcUrl?: string
  network?: 'mainnet' | 'testnet' | 'localnet'
  cacheTtlMs?: number
  failClosed?: boolean // If true, block on errors (security-first)
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

// ============ Cache ============

interface CacheEntry {
  result: BanCheckResult
  timestamp: number
}

// Bounded cache to prevent memory exhaustion
const MAX_CACHE_SIZE = 10000
const cache = new Map<string, CacheEntry>()

/**
 * Add entry to cache with LRU-style eviction when full
 */
function setCacheEntry(key: string, entry: CacheEntry): void {
  // If cache is full, evict oldest entries
  if (cache.size >= MAX_CACHE_SIZE) {
    const entries = Array.from(cache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp,
    )

    // Remove oldest 10% of entries
    const toRemove = Math.ceil(entries.length * 0.1)
    for (let i = 0; i < toRemove; i++) {
      cache.delete(entries[i][0])
    }
  }

  cache.set(key, entry)
}

// ============ BanChecker Class ============

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
      cacheTtlMs: config.cacheTtlMs || 10000, // 10 seconds default
      failClosed: config.failClosed ?? true, // Security-first by default
    }

    const chain = network === 'mainnet' ? base : baseSepolia
    this.publicClient = createPublicClient({
      chain,
      transport: http(this.config.rpcUrl),
    }) as PublicClient<Transport, Chain>
  }

  /**
   * Check if an address is banned
   */
  async checkBan(address: Address): Promise<BanCheckResult> {
    const cacheKey = address.toLowerCase()

    // Check cache
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.config.cacheTtlMs) {
      return cached.result
    }

    try {
      // Check all ban statuses in parallel
      const [isBanned, isOnNotice, banRecord] = await Promise.all([
        this.publicClient.readContract({
          address: this.config.banManagerAddress,
          abi: BAN_MANAGER_ABI,
          functionName: 'isAddressBanned',
          args: [address],
        }),
        this.publicClient.readContract({
          address: this.config.banManagerAddress,
          abi: BAN_MANAGER_ABI,
          functionName: 'isOnNotice',
          args: [address],
        }),
        this.publicClient.readContract({
          address: this.config.banManagerAddress,
          abi: BAN_MANAGER_ABI,
          functionName: 'getAddressBan',
          args: [address],
        }),
      ])

      const status: BanStatus = {
        isBanned: isBanned as boolean,
        isOnNotice: isOnNotice as boolean,
        banType: (banRecord as { banType: number }).banType,
        reason: (banRecord as { reason: string }).reason || '',
        caseId: (banRecord as { caseId: Hex }).caseId || null,
        canAppeal: (banRecord as { banType: number }).banType === 3, // PERMANENT
      }

      const result: BanCheckResult = {
        allowed: !status.isBanned && !status.isOnNotice,
        status,
      }

      // Update cache (bounded with LRU eviction)
      setCacheEntry(cacheKey, { result, timestamp: Date.now() })

      return result
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'

      // Fail-closed: if we can't verify, block the request
      if (this.config.failClosed) {
        return {
          allowed: false,
          error: `Ban check failed (fail-closed): ${errorMessage}`,
        }
      }

      // Fail-open: allow if we can't verify (less secure)
      return {
        allowed: true,
        error: `Ban check failed (fail-open): ${errorMessage}`,
      }
    }
  }

  /**
   * Clear cache for an address (call after ban/unban events)
   */
  clearCache(address?: Address): void {
    if (address) {
      cache.delete(address.toLowerCase())
    } else {
      cache.clear()
    }
  }
}

// ============ Elysia Middleware ============

interface RequestBody {
  address?: string
  from?: string
  sender?: string
}

/**
 * Create Elysia plugin for ban checking
 */
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

// ============ Generic Functions ============

/**
 * Simple function to check ban status (for custom integrations)
 */
export async function isBanned(
  address: Address,
  config: BanCheckConfig,
): Promise<boolean> {
  const checker = new BanChecker(config)
  const result = await checker.checkBan(address)
  return !result.allowed
}

/**
 * Get full ban status
 */
export async function getBanStatus(
  address: Address,
  config: BanCheckConfig,
): Promise<BanCheckResult> {
  const checker = new BanChecker(config)
  return checker.checkBan(address)
}

// ============ Singleton Instance ============

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
