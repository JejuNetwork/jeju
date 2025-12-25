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
const CACHE_TTL = 60_000
const WINDOW_MS = 60_000
const ETH_USD_PRICE = Number(process.env.ETH_USD_PRICE) || 2000

const rateLimitStore = new Map<
  string,
  { count: number; resetAt: number; tier: RateTier }
>()
const stakeCache = new Map<string, { tier: RateTier; expiresAt: number }>()

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
  identityAddress: Address | null
  banAddress: Address | null
  stakingAddress: Address | null
} | null = null

function getContracts() {
  if (contracts) return contracts

  const config = loadNetworkConfig()
  const chain = inferChainFromRpcUrl(config.rpcUrl)
  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  })
  const { identityRegistry, banManager, nodeStakingManager } = config.contracts
  const stakingAddr = process.env.INDEXER_STAKING_ADDRESS || nodeStakingManager

  contracts = {
    publicClient,
    identityAddress:
      identityRegistry && isAddress(identityRegistry) ? identityRegistry : null,
    banAddress: banManager && isAddress(banManager) ? banManager : null,
    stakingAddress: stakingAddr && isAddress(stakingAddr) ? stakingAddr : null,
  }
  return contracts
}

async function getStakeTier(address: string): Promise<RateTier> {
  validateOrThrow(AddressSchema, address, 'getStakeTier address')
  if (!isAddress(address)) throw new Error(`Invalid address: ${address}`)

  const key = address.toLowerCase()
  const cached = stakeCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.tier

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
        stakeCache.set(key, { tier, expiresAt: Date.now() + CACHE_TTL })
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
    const stakeUsd = (Number(stakeWei) / 1e18) * ETH_USD_PRICE
    tier =
      stakeUsd >= TIER_THRESHOLDS.UNLIMITED
        ? 'UNLIMITED'
        : stakeUsd >= TIER_THRESHOLDS.PRO
          ? 'PRO'
          : stakeUsd >= TIER_THRESHOLDS.BASIC
            ? 'BASIC'
            : 'FREE'
  }

  stakeCache.set(key, { tier, expiresAt: Date.now() + CACHE_TTL })
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

// Cleanup expired entries (runs once per minute)
setInterval(() => {
  const now = Date.now()
  for (const [key, { resetAt }] of rateLimitStore) {
    if (now > resetAt) rateLimitStore.delete(key)
  }
}, 60_000).unref()

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

        let record = rateLimitStore.get(rateLimitClientKey)
        if (!record || now > record.resetAt) {
          record = { count: 0, resetAt: now + WINDOW_MS, tier }
          rateLimitStore.set(rateLimitClientKey, record)
        }
        record.count++

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

export function getRateLimitStats() {
  const byTier: Record<RateTier, number> = {
    BANNED: 0,
    FREE: 0,
    BASIC: 0,
    PRO: 0,
    UNLIMITED: 0,
  }
  for (const { tier } of rateLimitStore.values()) byTier[tier]++
  return { totalTracked: rateLimitStore.size, byTier }
}

export { getStakeTier, stakeCache, rateLimitStore, getClientKeyFromHeaders }
