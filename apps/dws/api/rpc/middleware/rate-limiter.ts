import {
  getChainId,
  getCurrentNetwork,
  getRpcUrl,
  tryGetContract,
} from '@jejunetwork/config'
import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import { RATE_LIMITS, type RateTier } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { type Address, type Chain, createPublicClient, http } from 'viem'

export { RATE_LIMITS, type RateTier }

interface RateLimitRecord {
  count: number
  resetAt: number
  tier: RateTier
}

// Distributed cache for rate limiting
let rateCache: CacheClient | null = null

function getRateCache(): CacheClient {
  if (!rateCache) {
    rateCache = getCacheClient('dws-rpc-ratelimit')
  }
  return rateCache
}

// Helper functions for distributed rate limiting
async function getRateLimitRecord(
  key: string,
): Promise<RateLimitRecord | null> {
  const cache = getRateCache()
  const cached = await cache.get(`rpc-rl:${key}`)
  if (cached) {
    return JSON.parse(cached) as RateLimitRecord
  }
  return null
}

async function setRateLimitRecord(
  key: string,
  record: RateLimitRecord,
): Promise<void> {
  const cache = getRateCache()
  const ttl = Math.max(1, Math.ceil((record.resetAt - Date.now()) / 1000))
  await cache.set(`rpc-rl:${key}`, JSON.stringify(record), ttl)
}

// API key cache functions
async function getApiKeyData(
  apiKey: string,
): Promise<{ address: Address; tier: RateTier } | null> {
  const cache = getRateCache()
  const cached = await cache.get(`rpc-apikey:${apiKey}`)
  if (cached) {
    return JSON.parse(cached) as { address: Address; tier: RateTier }
  }
  return null
}

async function setApiKeyData(
  apiKey: string,
  data: { address: Address; tier: RateTier },
): Promise<void> {
  const cache = getRateCache()
  // API keys cached for 1 hour
  await cache.set(`rpc-apikey:${apiKey}`, JSON.stringify(data), 3600)
}

const RPC_STAKING_ABI = [
  {
    name: 'getRateLimit',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'canAccess',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const network = getCurrentNetwork()
const STAKING_ADDR = ((typeof process !== 'undefined'
  ? (process.env.RPC_STAKING_ADDRESS as Address | undefined)
  : undefined) ?? tryGetContract('rpc', 'staking', network)) as
  | Address
  | undefined
const RPC_URL = getRpcUrl(network)
const CHAIN_ID = getChainId(network)

const chain: Chain = {
  id: CHAIN_ID,
  name: CHAIN_ID === 420691 ? 'Network' : 'Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
}

const WHITELIST = new Set(
  (process.env.INTERNAL_WHITELIST ?? '')
    .split(',')
    .filter(Boolean)
    .map((a) => a.toLowerCase()),
)
const client = createPublicClient({ chain, transport: http(RPC_URL) })

const getContractRateLimit = async (addr: Address): Promise<number> => {
  if (!STAKING_ADDR) return RATE_LIMITS.FREE
  const result = await client.readContract({
    address: STAKING_ADDR,
    abi: RPC_STAKING_ABI,
    functionName: 'getRateLimit',
    args: [addr],
  })
  return Number(result)
}

const checkAccess = async (addr: Address): Promise<boolean> => {
  if (!STAKING_ADDR) return true
  return client.readContract({
    address: STAKING_ADDR,
    abi: RPC_STAKING_ABI,
    functionName: 'canAccess',
    args: [addr],
  })
}

const getUserKey = async (
  request: Request,
): Promise<{ key: string; address: Address | null }> => {
  const apiKey = request.headers.get('X-Api-Key')
  if (apiKey) {
    const apiKeyData = await getApiKeyData(apiKey)
    if (apiKeyData) {
      return {
        key: `key:${apiKey}`,
        address: apiKeyData.address,
      }
    }
  }
  const walletHeader = request.headers.get('X-Wallet-Address')
  if (walletHeader) {
    const wallet = walletHeader as Address
    return { key: `addr:${wallet.toLowerCase()}`, address: wallet }
  }
  const ip =
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    request.headers.get('X-Real-IP') ||
    'unknown'
  return { key: `ip:${ip}`, address: null }
}

const rateLimitToTier = (limit: number): RateTier =>
  limit === 0
    ? 'UNLIMITED'
    : limit >= 1000
      ? 'PRO'
      : limit >= 100
        ? 'BASIC'
        : 'FREE'

export interface RateLimitContext {
  rateLimit: {
    tier: RateTier
    remaining: number
    resetAt: number
  }
}

export function rateLimiter() {
  return new Elysia({ name: 'rate-limiter' })
    .derive(() => ({
      rateLimit: { tier: 'FREE' as RateTier, remaining: -1, resetAt: 0 },
    }))
    .onBeforeHandle(
      async ({
        request,
        set,
      }): Promise<
        | undefined
        | {
            error: string
            tier?: RateTier
            limit?: number
            resetAt?: number
            upgrade?: string
          }
      > => {
        const url = new URL(request.url)
        if (url.pathname === '/health' || url.pathname === '/') return

        const { key, address } = await getUserKey(request)
        const now = Date.now()

        if (address && WHITELIST.has(address.toLowerCase())) {
          return
        }

        let rateLimit: number = RATE_LIMITS.FREE
        if (address) {
          if (!(await checkAccess(address))) {
            set.status = 403
            return { error: 'Access denied' }
          }
          rateLimit = await getContractRateLimit(address)
        }

        const tier = rateLimitToTier(rateLimit)
        let record = await getRateLimitRecord(key)
        if (!record || now > record.resetAt) {
          record = { count: 0, resetAt: now + 60_000, tier }
        }
        record.count++
        await setRateLimitRecord(key, record)

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
            upgrade: 'Stake JEJU to increase limit',
          }
        }

        return
      },
    )
}

export const registerApiKey = async (
  key: string,
  addr: Address,
  tier: RateTier,
): Promise<void> => {
  await setApiKeyData(key, { address: addr, tier })
}

export const revokeApiKey = async (key: string): Promise<void> => {
  const cache = getRateCache()
  await cache.delete(`rpc-apikey:${key}`)
}

export const getRateLimitStats = async (): Promise<{
  totalTracked: number
  byTier: Record<RateTier, number>
}> => {
  // Rate limit stats are tracked in distributed cache
  // Note: Accurate per-tier stats require iterating cache keys or using atomic counters
  // This is a limitation of the current distributed cache implementation
  const cache = getRateCache()

  // Try to get stats counters if they exist
  const statsKey = 'rpc-rl:__stats__'
  const cached = await cache.get(statsKey)
  if (cached) {
    const stats = JSON.parse(cached) as {
      totalTracked: number
      byTier: Record<RateTier, number>
    }
    return stats
  }

  // Stats not tracked - return zeros with a warning
  console.warn(
    '[RateLimiter] getRateLimitStats called but stats tracking is not enabled. Stats are only accurate when rate-limit-stats tracking is configured.',
  )
  return {
    totalTracked: 0,
    byTier: { FREE: 0, BASIC: 0, PRO: 0, UNLIMITED: 0 },
  }
}
