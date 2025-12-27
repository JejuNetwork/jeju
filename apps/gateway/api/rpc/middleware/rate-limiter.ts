import { getChainId, getRpcUrl } from '@jejunetwork/config'
import { readContract } from '@jejunetwork/shared'
import { RATE_LIMITS, type RateTier } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { LRUCache } from 'lru-cache'
import { RateLimiterMemory, type RateLimiterRes } from 'rate-limiter-flexible'
import { type Address, type Chain, createPublicClient, http } from 'viem'

export { RATE_LIMITS, type RateTier }

/**
 * SECURITY: Validate IP address format to prevent header injection
 */
function isValidIpAddress(ip: string): boolean {
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$/
  return ipv4Regex.test(ip) || ipv6Regex.test(ip)
}

export function isPrivateIp(ip: string): boolean {
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
 * SECURITY: Only trust proxy headers in development or when explicitly configured
 * In production, set TRUST_PROXY_HEADERS=true if behind a trusted reverse proxy
 */
const TRUST_PROXY_HEADERS =
  process.env.NODE_ENV !== 'production' ||
  process.env.TRUST_PROXY_HEADERS === 'true'

function getClientIp(request: Request): string {
  // SECURITY: Only trust proxy headers if explicitly configured
  if (TRUST_PROXY_HEADERS) {
    const realIp = request.headers.get('X-Real-IP')
    if (realIp) {
      const trimmedIp = realIp.trim()
      // SECURITY: Validate IP format to prevent header injection
      if (isValidIpAddress(trimmedIp)) {
        return trimmedIp
      }
    }

    const forwardedFor = request.headers.get('X-Forwarded-For')
    if (forwardedFor) {
      const ips = forwardedFor
        .split(',')
        .map((ip) => ip.trim())
        .filter(isValidIpAddress)
        .reverse()
      for (const ip of ips) {
        if (ip && !isPrivateIp(ip)) {
          return ip
        }
      }
      if (ips[0]) return ips[0]
    }
  }

  return 'unknown'
}

const apiKeyCache = new LRUCache<string, { address: Address; tier: RateTier }>({
  max: 10000,
  ttl: 1000 * 60 * 60,
})

const rateLimiters = {
  FREE: new RateLimiterMemory({
    points: RATE_LIMITS.FREE,
    duration: 60,
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

const stakingAddrEnv = process.env.RPC_STAKING_ADDRESS
const STAKING_ADDR: Address | undefined =
  stakingAddrEnv?.startsWith('0x') && stakingAddrEnv.length === 42
    ? (stakingAddrEnv as Address)
    : undefined
const RPC_URL = getRpcUrl()
const CHAIN_ID = getChainId()

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
  const result = await readContract(client, {
    address: STAKING_ADDR,
    abi: RPC_STAKING_ABI,
    functionName: 'getRateLimit',
    args: [addr],
  })
  return Number(result)
}

/**
 * SECURITY: Check if address has access via staking contract
 * If staking contract is not configured, allow access but log warning in production
 */
let stakingWarningLogged = false
const checkAccess = async (addr: Address): Promise<boolean> => {
  if (!STAKING_ADDR) {
    // SECURITY: Log warning in production if staking is expected but not configured
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.REQUIRE_STAKING === 'true'
    ) {
      if (!stakingWarningLogged) {
        console.warn(
          '[RPC Gateway] SECURITY WARNING: REQUIRE_STAKING=true but RPC_STAKING_ADDRESS not configured',
        )
        stakingWarningLogged = true
      }
      return false // Deny access if staking is required but not configured
    }
    return true // Allow access in development or when staking not required
  }
  return readContract(client, {
    address: STAKING_ADDR,
    abi: RPC_STAKING_ABI,
    functionName: 'canAccess',
    args: [addr],
  })
}

const getUserKey = (
  request: Request,
): { key: string; address: Address | null } => {
  const apiKey = request.headers.get('X-Api-Key')
  if (apiKey && apiKeyCache.has(apiKey))
    return {
      key: `key:${apiKey}`,
      address: apiKeyCache.get(apiKey)?.address ?? null,
    }
  const walletHeader = request.headers.get('X-Wallet-Address')
  const wallet: Address | undefined =
    walletHeader?.startsWith('0x') && walletHeader.length === 42
      ? (walletHeader as Address)
      : undefined
  if (wallet) return { key: `addr:${wallet.toLowerCase()}`, address: wallet }
  const ip = getClientIp(request)
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

export interface RateLimitInfo {
  tier: RateTier
  remaining: number
  resetAt: number
}

export const rateLimiterPlugin = new Elysia({ name: 'rate-limiter' })
  .derive({ as: 'scoped' }, () => ({
    rateLimit: undefined as RateLimitInfo | undefined,
  }))
  .onBeforeHandle(async ({ request, set, path }) => {
    if (path === '/health' || path === '/') return

    const { key, address } = getUserKey(request)

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
    const limiter = rateLimiters[tier]
    const limit = RATE_LIMITS[tier]

    try {
      const res: RateLimiterRes = await limiter.consume(key)
      const remaining = limit === 0 ? -1 : res.remainingPoints
      const resetAt = Date.now() + res.msBeforeNext

      set.headers['X-RateLimit-Limit'] =
        limit === 0 ? 'unlimited' : String(limit)
      set.headers['X-RateLimit-Remaining'] =
        remaining === -1 ? 'unlimited' : String(remaining)
      set.headers['X-RateLimit-Reset'] = String(Math.ceil(resetAt / 1000))
      set.headers['X-RateLimit-Tier'] = tier
      return
    } catch (rejRes) {
      const res = rejRes as RateLimiterRes
      const resetAt = Date.now() + res.msBeforeNext

      set.headers['X-RateLimit-Limit'] = String(limit)
      set.headers['X-RateLimit-Remaining'] = '0'
      set.headers['X-RateLimit-Reset'] = String(Math.ceil(resetAt / 1000))
      set.headers['X-RateLimit-Tier'] = tier
      set.headers['Retry-After'] = String(Math.ceil(res.msBeforeNext / 1000))

      set.status = 429
      return {
        error: 'Rate limit exceeded',
        tier,
        limit,
        resetAt,
        retryAfter: Math.ceil(res.msBeforeNext / 1000),
        upgrade: 'Stake JEJU to increase limit',
      }
    }
  })
  .resolve(async ({ request, path }) => {
    if (path === '/health' || path === '/') {
      return { rateLimit: undefined }
    }

    const { address } = getUserKey(request)

    if (address && WHITELIST.has(address.toLowerCase())) {
      return {
        rateLimit: {
          tier: 'UNLIMITED' as RateTier,
          remaining: -1,
          resetAt: 0,
        },
      }
    }

    let rateLimit: number = RATE_LIMITS.FREE
    if (address) {
      rateLimit = await getContractRateLimit(address)
    }

    const tier = rateLimitToTier(rateLimit)
    const limit = RATE_LIMITS[tier]
    const remaining = limit === 0 ? -1 : limit

    return {
      rateLimit: {
        tier,
        remaining,
        resetAt: Date.now() + 60000,
      },
    }
  })

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
