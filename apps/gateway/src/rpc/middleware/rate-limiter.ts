import type { Context, Next } from 'hono'
import { LRUCache } from 'lru-cache'
import { RateLimiterMemory, type RateLimiterRes } from 'rate-limiter-flexible'
import { type Address, type Chain, createPublicClient, http } from 'viem'

export const RATE_LIMITS = {
  FREE: 10,
  BASIC: 100,
  PRO: 1000,
  UNLIMITED: 0,
} as const
export type RateTier = keyof typeof RATE_LIMITS

/**
 * Check if an IP is a private/local address that could be spoofed
 */
function isPrivateIp(ip: string): boolean {
  // IPv4 private ranges and localhost
  if (
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('127.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('172.19.') ||
    ip.startsWith('172.20.') ||
    ip.startsWith('172.21.') ||
    ip.startsWith('172.22.') ||
    ip.startsWith('172.23.') ||
    ip.startsWith('172.24.') ||
    ip.startsWith('172.25.') ||
    ip.startsWith('172.26.') ||
    ip.startsWith('172.27.') ||
    ip.startsWith('172.28.') ||
    ip.startsWith('172.29.') ||
    ip.startsWith('172.30.') ||
    ip.startsWith('172.31.') ||
    ip === 'localhost' ||
    ip === '::1'
  ) {
    return true
  }
  return false
}

/**
 * Extracts client IP address safely from Hono context.
 *
 * SECURITY: X-Forwarded-For can be spoofed by clients.
 * This function prefers X-Real-IP (set by trusted proxies like nginx)
 * and validates X-Forwarded-For by taking the rightmost non-private IP.
 */
function getClientIp(c: Context): string {
  // X-Real-IP is typically set by nginx and is more trustworthy
  const realIp = c.req.header('X-Real-IP')
  if (realIp) {
    return realIp.trim()
  }

  // For X-Forwarded-For, we take the rightmost non-private IP
  // The rightmost IP is the one added by our most trusted proxy
  const forwardedFor = c.req.header('X-Forwarded-For')
  if (forwardedFor) {
    // Split and reverse to get rightmost first
    const ips = forwardedFor
      .split(',')
      .map((ip) => ip.trim())
      .reverse()
    for (const ip of ips) {
      // Skip private/local IPs that could be spoofed
      if (ip && !isPrivateIp(ip)) {
        return ip
      }
    }
    // If all IPs are private, use the last one (closest to us)
    if (ips[0]) return ips[0]
  }

  return 'unknown'
}

// LRU cache for API key lookups (auto-evicts old entries)
const apiKeyCache = new LRUCache<string, { address: Address; tier: RateTier }>({
  max: 10000,
  ttl: 1000 * 60 * 60, // 1 hour TTL
})

// Rate limiters per tier using rate-limiter-flexible
const rateLimiters = {
  FREE: new RateLimiterMemory({
    points: RATE_LIMITS.FREE,
    duration: 60, // Per minute
    blockDuration: 0,
  }),
  BASIC: new RateLimiterMemory({
    points: RATE_LIMITS.BASIC,
    duration: 60,
    blockDuration: 0,
  }),
  PRO: new RateLimiterMemory({
    points: RATE_LIMITS.PRO,
    duration: 60,
    blockDuration: 0,
  }),
  UNLIMITED: new RateLimiterMemory({
    points: Number.MAX_SAFE_INTEGER,
    duration: 60,
    blockDuration: 0,
  }),
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

const STAKING_ADDR = process.env.RPC_STAKING_ADDRESS as Address | undefined
const RPC_URL = process.env.JEJU_RPC_URL || 'http://localhost:9545'
const CHAIN_ID = Number(process.env.JEJU_CHAIN_ID || 420690)

const chain: Chain = {
  id: CHAIN_ID,
  name: CHAIN_ID === 420691 ? 'Network' : 'Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
}

const WHITELIST = new Set(
  (process.env.INTERNAL_WHITELIST || '')
    .split(',')
    .filter(Boolean)
    .map((a) => a.toLowerCase()),
)
const client = createPublicClient({ chain, transport: http(RPC_URL) })

const getContractRateLimit = async (addr: Address): Promise<number> => {
  if (!STAKING_ADDR) return RATE_LIMITS.FREE
  return client
    .readContract({
      address: STAKING_ADDR,
      abi: RPC_STAKING_ABI,
      functionName: 'getRateLimit',
      args: [addr],
    })
    .then((r) => Number(r))
    .catch(() => RATE_LIMITS.FREE)
}

const checkAccess = async (addr: Address): Promise<boolean> => {
  if (!STAKING_ADDR) return true
  return client
    .readContract({
      address: STAKING_ADDR,
      abi: RPC_STAKING_ABI,
      functionName: 'canAccess',
      args: [addr],
    })
    .catch(() => true)
}

const getUserKey = (c: Context): { key: string; address: Address | null } => {
  const apiKey = c.req.header('X-Api-Key')
  if (apiKey && apiKeyCache.has(apiKey))
    return {
      key: `key:${apiKey}`,
      address: apiKeyCache.get(apiKey)?.address || null,
    }
  const wallet = c.req.header('X-Wallet-Address') as Address | undefined
  if (wallet) return { key: `addr:${wallet.toLowerCase()}`, address: wallet }
  // Use secure IP extraction that handles proxy header spoofing
  const ip = getClientIp(c)
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

export function rateLimiter() {
  return async (c: Context, next: Next) => {
    if (c.req.path === '/health' || c.req.path === '/') return next()

    const { key, address } = getUserKey(c)

    if (address && WHITELIST.has(address.toLowerCase())) {
      c.set('rateLimit', { tier: 'UNLIMITED', remaining: -1, resetAt: 0 })
      return next()
    }

    let rateLimit: number = RATE_LIMITS.FREE
    if (address) {
      if (!(await checkAccess(address)))
        return c.json({ error: 'Access denied' }, 403)
      rateLimit = await getContractRateLimit(address)
    }

    const tier = rateLimitToTier(rateLimit)
    const limiter = rateLimiters[tier]
    const limit = RATE_LIMITS[tier]

    try {
      const res: RateLimiterRes = await limiter.consume(key)
      const remaining = limit === 0 ? -1 : res.remainingPoints
      const resetAt = Date.now() + res.msBeforeNext

      c.header('X-RateLimit-Limit', limit === 0 ? 'unlimited' : String(limit))
      c.header(
        'X-RateLimit-Remaining',
        remaining === -1 ? 'unlimited' : String(remaining),
      )
      c.header('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)))
      c.header('X-RateLimit-Tier', tier)
      c.set('rateLimit', { tier, remaining, resetAt })

      return next()
    } catch (rejRes) {
      const res = rejRes as RateLimiterRes
      const resetAt = Date.now() + res.msBeforeNext

      c.header('X-RateLimit-Limit', String(limit))
      c.header('X-RateLimit-Remaining', '0')
      c.header('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)))
      c.header('X-RateLimit-Tier', tier)
      c.header('Retry-After', String(Math.ceil(res.msBeforeNext / 1000)))

      return c.json(
        {
          error: 'Rate limit exceeded',
          tier,
          limit,
          resetAt,
          retryAfter: Math.ceil(res.msBeforeNext / 1000),
          upgrade: 'Stake JEJU to increase limit',
        },
        429,
      )
    }
  }
}

export const registerApiKey = (key: string, addr: Address, tier: RateTier) =>
  apiKeyCache.set(key, { address: addr, tier })
export const revokeApiKey = (key: string) => apiKeyCache.delete(key)

export const getRateLimitStats = () => {
  return {
    totalTracked: apiKeyCache.size,
    cacheStats: {
      size: apiKeyCache.size,
      calculatedSize: apiKeyCache.calculatedSize,
    },
  }
}
