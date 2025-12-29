import { getChainlinkFeed, hasChainlinkSupport } from '@jejunetwork/config'
import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import { AddressSchema, validateOrThrow } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import {
  type Address,
  type Chain,
  createPublicClient,
  http,
  isAddress,
  type PublicClient,
  type Transport,
} from 'viem'
import { config as indexerConfig } from '../config'
import { loadNetworkConfig } from '../network-config'
import { inferChainFromRpcUrl } from './chain-utils'

type ViemPublicClient = PublicClient<Transport, Chain>

export const RATE_LIMITS = {
  BANNED: 0,
  FREE: 100,
  BASIC: 1000,
  PRO: 10000,
  UNLIMITED: 0,
} as const
export type RateTier = keyof typeof RATE_LIMITS

const TIER_THRESHOLDS = { BASIC: 10, PRO: 100, UNLIMITED: 1000 } // USD thresholds
const CACHE_TTL_SECONDS = 60
const WINDOW_MS = 60_000
const PRICE_CACHE_TTL = 5 * 60_000 // 5 minutes for price cache

// Distributed cache for rate limiting
let rateCache: CacheClient | null = null

function getRateCache(): CacheClient {
  if (!rateCache) {
    rateCache = getCacheClient('indexer-stake-ratelimit')
  }
  return rateCache
}

// Chainlink AggregatorV3 ABI for price fetching
const CHAINLINK_AGGREGATOR_ABI = [
  {
    type: 'function',
    name: 'latestRoundData',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  },
] as const

// Price cache (local - changes infrequently)
let priceCache: { price: number; expiresAt: number } | null = null

// Rate limit record type
interface RateLimitRecord {
  count: number
  resetAt: number
  tier: RateTier
}

// Stake tier cache type
interface StakeTierCache {
  tier: RateTier
  expiresAt: number
}

/** Minimal ABIs for rate limiting - subset of contract functions */
const IDENTITY_ABI = [
  {
    type: 'function',
    name: 'agentOf',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

const BAN_ABI = [
  {
    type: 'function',
    name: 'isNetworkBanned',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
] as const

const STAKING_ABI = [
  {
    type: 'function',
    name: 'getStake',
    inputs: [{ name: 'staker', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

let contracts: {
  publicClient: ViemPublicClient
  chainId: number
  identityAddress: Address | null
  banAddress: Address | null
  stakingAddress: Address | null
} | null = null

function getContracts() {
  if (contracts) return contracts

  const netConfig = loadNetworkConfig()
  const chain = inferChainFromRpcUrl(netConfig.rpcUrl)
  const publicClient = createPublicClient({
    chain,
    transport: http(netConfig.rpcUrl),
  })
  const { identityRegistry, banManager, nodeStakingManager } =
    netConfig.contracts
  const stakingAddr = indexerConfig.stakingAddress ?? nodeStakingManager

  contracts = {
    publicClient,
    chainId: netConfig.chainId,
    identityAddress:
      identityRegistry && isAddress(identityRegistry) ? identityRegistry : null,
    banAddress: banManager && isAddress(banManager) ? banManager : null,
    stakingAddress: stakingAddr && isAddress(stakingAddr) ? stakingAddr : null,
  }
  return contracts
}

/**
 * Fetch ETH/USD price from on-chain Chainlink oracle
 * Caches price for 5 minutes to avoid excessive RPC calls
 * Falls back to cached/env price if oracle is unavailable
 */
async function getEthUsdPrice(): Promise<number> {
  // Return cached price if valid
  if (priceCache && priceCache.expiresAt > Date.now()) {
    return priceCache.price
  }

  const { publicClient, chainId } = getContracts()
  const fallbackPrice = indexerConfig.ethUsdPrice

  // Check if Chainlink is supported on this chain
  if (!hasChainlinkSupport(chainId)) {
    console.warn(
      `[RateLimiter] Chain ${chainId} has no Chainlink support, using fallback price: $${fallbackPrice}`,
    )
    priceCache = {
      price: fallbackPrice,
      expiresAt: Date.now() + PRICE_CACHE_TTL,
    }
    return fallbackPrice
  }

  // Get feed address from config
  const feed = getChainlinkFeed(chainId, 'ETH/USD')

  // Fetch from Chainlink with error handling
  let answer: bigint
  let updatedAt: bigint
  try {
    const result = await publicClient.readContract({
      address: feed.address as Address,
      abi: CHAINLINK_AGGREGATOR_ABI,
      functionName: 'latestRoundData',
    })
    answer = result[1]
    updatedAt = result[3]
  } catch (err) {
    // If oracle call fails, use cached price or fallback
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`[RateLimiter] Chainlink oracle call failed: ${errorMsg}`)

    // Use stale cache if available (better than nothing)
    if (priceCache) {
      console.warn(
        `[RateLimiter] Using stale cached price: $${priceCache.price.toFixed(2)}`,
      )
      return priceCache.price
    }

    console.warn(`[RateLimiter] Using fallback price: $${fallbackPrice}`)
    priceCache = { price: fallbackPrice, expiresAt: Date.now() + 60_000 } // Short TTL for fallback
    return fallbackPrice
  }

  // Check staleness (heartbeat + 10% buffer)
  const maxStaleness = feed.heartbeatSeconds * 1.1
  const staleness = Date.now() / 1000 - Number(updatedAt)
  if (staleness > maxStaleness) {
    console.warn(
      `[RateLimiter] Chainlink price stale (${Math.round(staleness)}s old), using fallback`,
    )
    // Use stale cache or fallback instead of throwing
    if (priceCache) return priceCache.price
    priceCache = { price: fallbackPrice, expiresAt: Date.now() + 60_000 }
    return fallbackPrice
  }

  if (answer <= 0n) {
    console.error(
      '[RateLimiter] Chainlink returned invalid price, using fallback',
    )
    if (priceCache) return priceCache.price
    priceCache = { price: fallbackPrice, expiresAt: Date.now() + 60_000 }
    return fallbackPrice
  }

  // Convert from Chainlink decimals (typically 8) to USD
  const price = Number(answer) / 10 ** feed.decimals

  console.log(
    `[RateLimiter] ETH/USD from Chainlink: $${price.toFixed(2)} (chain ${chainId})`,
  )

  priceCache = { price, expiresAt: Date.now() + PRICE_CACHE_TTL }
  return price
}

async function getStakeTier(address: string): Promise<RateTier> {
  validateOrThrow(AddressSchema, address, 'getStakeTier address')
  if (!isAddress(address)) throw new Error(`Invalid address: ${address}`)

  const key = address.toLowerCase()
  const cache = getRateCache()
  const cacheKey = `stake:${key}`

  // Check distributed cache
  const cached = await cache.get(cacheKey)
  if (cached) {
    const parsed = JSON.parse(cached) as StakeTierCache
    if (parsed.expiresAt > Date.now()) return parsed.tier
  }

  const { publicClient, identityAddress, banAddress, stakingAddress } =
    getContracts()
  let tier: RateTier = 'FREE'

  if (identityAddress && banAddress) {
    const agentId = await publicClient.readContract({
      address: identityAddress,
      abi: IDENTITY_ABI,
      functionName: 'agentOf',
      args: [address as Address],
    })
    if (agentId > 0n) {
      const isBanned = await publicClient.readContract({
        address: banAddress,
        abi: BAN_ABI,
        functionName: 'isNetworkBanned',
        args: [agentId],
      })
      if (isBanned) {
        tier = 'BANNED'
        await cache.set(
          cacheKey,
          JSON.stringify({
            tier,
            expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000,
          }),
          CACHE_TTL_SECONDS,
        )
        return tier
      }
    }
  }

  if (stakingAddress) {
    const stakeWei = await publicClient.readContract({
      address: stakingAddress,
      abi: STAKING_ABI,
      functionName: 'getStake',
      args: [address as Address],
    })
    const ethUsdPrice = await getEthUsdPrice()
    const stakeUsd = (Number(stakeWei) / 1e18) * ethUsdPrice
    tier =
      stakeUsd >= TIER_THRESHOLDS.UNLIMITED
        ? 'UNLIMITED'
        : stakeUsd >= TIER_THRESHOLDS.PRO
          ? 'PRO'
          : stakeUsd >= TIER_THRESHOLDS.BASIC
            ? 'BASIC'
            : 'FREE'
  }

  await cache.set(
    cacheKey,
    JSON.stringify({ tier, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 }),
    CACHE_TTL_SECONDS,
  )
  return tier
}

interface HeadersMap {
  'x-api-key'?: string
  'x-wallet-address'?: string
  'x-agent-id'?: string
  'x-forwarded-for'?: string
  'x-real-ip'?: string
}

function getClientKeyFromHeaders(headers: HeadersMap): {
  key: string
  address: string | null
} {
  const apiKey = headers['x-api-key']
  if (apiKey) return { key: `apikey:${apiKey}`, address: null }

  const walletAddr = headers['x-wallet-address']
  if (walletAddr && isAddress(walletAddr)) {
    return { key: `addr:${walletAddr.toLowerCase()}`, address: walletAddr }
  }

  const agentId = headers['x-agent-id']
  if (agentId) return { key: `agent:${agentId}`, address: null }

  const forwarded = headers['x-forwarded-for']?.split(',')[0]?.trim()
  const ip = forwarded ?? headers['x-real-ip'] ?? 'unknown'
  return { key: `ip:${ip}`, address: null }
}

export interface RateLimitOptions {
  skipPaths?: string[]
  tierOverride?: RateTier
}

/**
 * Elysia plugin for stake-based rate limiting
 */
export function stakeRateLimiter(options: RateLimitOptions = {}) {
  const skipPaths = options.skipPaths ?? ['/health', '/.well-known']

  return new Elysia({ name: 'stake-rate-limiter' })
    .derive({ as: 'global' }, ({ request, headers }) => {
      const url = new URL(request.url)
      const { key, address } = getClientKeyFromHeaders({
        'x-api-key': headers['x-api-key'],
        'x-wallet-address': headers['x-wallet-address'],
        'x-agent-id': headers['x-agent-id'],
        'x-forwarded-for': headers['x-forwarded-for'],
        'x-real-ip': headers['x-real-ip'],
      })
      return {
        rateLimitPath: url.pathname,
        rateLimitClientKey: key,
        rateLimitWalletAddress: address,
      }
    })
    .onBeforeHandle(
      { as: 'global' },
      async ({
        rateLimitPath,
        rateLimitClientKey,
        rateLimitWalletAddress,
        set,
      }): Promise<
        | { error: string; message: string }
        | {
            error: string
            tier: RateTier
            limit: number
            resetAt: number
            upgrade: string
          }
        | undefined
      > => {
        if (skipPaths.some((p) => rateLimitPath.startsWith(p))) {
          return undefined
        }

        const now = Date.now()
        const cache = getRateCache()
        const cacheKey = `rl:${rateLimitClientKey}`

        const tier =
          options.tierOverride ||
          (rateLimitWalletAddress
            ? await getStakeTier(rateLimitWalletAddress)
            : 'FREE')

        if (tier === 'BANNED') {
          set.status = 403
          return {
            error: 'Access denied',
            message: 'Address banned from network',
          }
        }

        // Get rate limit record from cache
        const cached = await cache.get(cacheKey)
        let record: RateLimitRecord | null = cached ? JSON.parse(cached) : null

        if (!record || now > record.resetAt) {
          record = { count: 0, resetAt: now + WINDOW_MS, tier }
        }
        record.count++

        // Store updated record with TTL
        const ttl = Math.max(1, Math.ceil((record.resetAt - now) / 1000))
        await cache.set(cacheKey, JSON.stringify(record), ttl)

        const limit = RATE_LIMITS[tier]
        const remaining = limit === 0 ? -1 : Math.max(0, limit - record.count)

        set.headers['X-RateLimit-Limit'] =
          limit === 0 ? 'unlimited' : String(limit)
        set.headers['X-RateLimit-Remaining'] =
          remaining === -1 ? 'unlimited' : String(remaining)
        set.headers['X-RateLimit-Reset'] = String(
          Math.ceil(record.resetAt / 1000),
        )
        set.headers['X-RateLimit-Tier'] = tier

        if (limit > 0 && record.count > limit) {
          set.status = 429
          return {
            error: 'Rate limit exceeded',
            tier,
            limit,
            resetAt: record.resetAt,
            upgrade: 'Stake tokens to increase your rate limit',
          }
        }

        // Continue to handler
        return undefined
      },
    )
}

export async function getRateLimitStats(): Promise<{
  totalTracked: number
  byTier: Record<RateTier, number>
}> {
  // With distributed cache, per-tier stats would need separate tracking
  return {
    totalTracked: 0,
    byTier: { BANNED: 0, FREE: 0, BASIC: 0, PRO: 0, UNLIMITED: 0 },
  }
}

export { getStakeTier, getEthUsdPrice, getClientKeyFromHeaders }
