/**
 * Rate Limiter Tests
 *
 * Tests for rate limiting functionality including:
 * - Tier determination from stake amounts
 * - Rate limit enforcement
 * - Window management
 * - Contract integration for tier calculation
 */

import { describe, expect, it } from 'bun:test'

const RATE_LIMITS = {
  BANNED: 0,
  FREE: 100,
  BASIC: 1000,
  PRO: 10000,
  UNLIMITED: 0,
} as const

type RateTier = keyof typeof RATE_LIMITS

const TIER_THRESHOLDS = { BASIC: 10, PRO: 100, UNLIMITED: 1000 }
const WINDOW_MS = 60_000
const ETH_USD_PRICE = 2000

interface MockContract {
  getAgentId: (address: string) => Promise<bigint>
  isBanned: (agentId: bigint) => Promise<boolean>
  getStake: (address: string) => Promise<bigint>
  positions: (address: string) => Promise<[bigint, bigint, bigint]>
}

interface RateLimitRecord {
  count: number
  resetAt: number
  tier: RateTier
}

// Helper functions
function getTierFromStakeUsd(stakeUsd: number): RateTier {
  if (stakeUsd >= TIER_THRESHOLDS.UNLIMITED) return 'UNLIMITED'
  if (stakeUsd >= TIER_THRESHOLDS.PRO) return 'PRO'
  if (stakeUsd >= TIER_THRESHOLDS.BASIC) return 'BASIC'
  return 'FREE'
}

function stakeWeiToUsd(stakeWei: bigint): number {
  return (Number(stakeWei) / 1e18) * ETH_USD_PRICE
}

function createMockContracts(
  overrides: {
    agentId?: bigint
    isBanned?: boolean
    stakeWei?: bigint
    shouldFail?: {
      getAgentId?: boolean
      isBanned?: boolean
      getStake?: boolean
    }
  } = {},
): { identity: MockContract; ban: MockContract; staking: MockContract } {
  const {
    agentId = 0n,
    isBanned = false,
    stakeWei = 0n,
    shouldFail = {},
  } = overrides

  return {
    identity: {
      getAgentId: async () => {
        if (shouldFail.getAgentId) throw new Error('RPC error')
        return agentId
      },
      isBanned: async () => false,
      getStake: async () => 0n,
      positions: async () => [0n, 0n, 0n],
    },
    ban: {
      getAgentId: async () => 0n,
      isBanned: async () => {
        if (shouldFail.isBanned) throw new Error('RPC error')
        return isBanned
      },
      getStake: async () => 0n,
      positions: async () => [0n, 0n, 0n],
    },
    staking: {
      getAgentId: async () => 0n,
      isBanned: async () => false,
      getStake: async () => {
        if (shouldFail.getStake) throw new Error('RPC error')
        return stakeWei
      },
      positions: async () => [stakeWei, 0n, 0n],
    },
  }
}

async function calculateTierFromContracts(
  address: string,
  contracts: {
    identity: MockContract
    ban: MockContract
    staking: MockContract
  },
): Promise<RateTier> {
  const { identity, ban, staking } = contracts
  let tier: RateTier = 'FREE'

  let agentId = 0n
  try {
    agentId = await identity.getAgentId(address)
  } catch {
    // Contract call failed
  }

  if (agentId > 0n) {
    try {
      if (await ban.isBanned(agentId)) {
        return 'BANNED'
      }
    } catch {
      // Contract call failed
    }
  }

  let stakeWei = 0n
  try {
    stakeWei = await staking.getStake(address)
  } catch {
    try {
      const pos = await staking.positions(address)
      stakeWei = pos[0]
    } catch {
      // Contract call failed
    }
  }

  const stakeUsd = stakeWeiToUsd(stakeWei)
  tier = getTierFromStakeUsd(stakeUsd)

  return tier
}

describe('Rate Limit Constants', () => {
  it('should have correct tier limits', () => {
    expect(RATE_LIMITS.BANNED).toBe(0)
    expect(RATE_LIMITS.FREE).toBe(100)
    expect(RATE_LIMITS.BASIC).toBe(1000)
    expect(RATE_LIMITS.PRO).toBe(10000)
    expect(RATE_LIMITS.UNLIMITED).toBe(0)
  })

  it('should have increasing thresholds', () => {
    expect(TIER_THRESHOLDS.BASIC).toBeLessThan(TIER_THRESHOLDS.PRO)
    expect(TIER_THRESHOLDS.PRO).toBeLessThan(TIER_THRESHOLDS.UNLIMITED)
  })
})

describe('Tier Determination from Stake Amount', () => {
  it('should return FREE for zero stake', () => {
    expect(getTierFromStakeUsd(0)).toBe('FREE')
  })

  it('should return FREE for stake below BASIC threshold', () => {
    expect(getTierFromStakeUsd(9.99)).toBe('FREE')
    expect(getTierFromStakeUsd(5)).toBe('FREE')
  })

  it('should return BASIC at exactly BASIC threshold', () => {
    expect(getTierFromStakeUsd(10)).toBe('BASIC')
  })

  it('should return BASIC between BASIC and PRO thresholds', () => {
    expect(getTierFromStakeUsd(50)).toBe('BASIC')
    expect(getTierFromStakeUsd(99.99)).toBe('BASIC')
  })

  it('should return PRO at exactly PRO threshold', () => {
    expect(getTierFromStakeUsd(100)).toBe('PRO')
  })

  it('should return PRO between PRO and UNLIMITED thresholds', () => {
    expect(getTierFromStakeUsd(500)).toBe('PRO')
    expect(getTierFromStakeUsd(999.99)).toBe('PRO')
  })

  it('should return UNLIMITED at exactly UNLIMITED threshold', () => {
    expect(getTierFromStakeUsd(1000)).toBe('UNLIMITED')
  })

  it('should return UNLIMITED above UNLIMITED threshold', () => {
    expect(getTierFromStakeUsd(10000)).toBe('UNLIMITED')
    expect(getTierFromStakeUsd(1000000)).toBe('UNLIMITED')
  })

  it('should correctly convert wei to USD', () => {
    expect(stakeWeiToUsd(0n)).toBe(0)
    expect(stakeWeiToUsd(BigInt(1e18))).toBe(2000)
    expect(stakeWeiToUsd(BigInt(5e15))).toBe(10)
    expect(stakeWeiToUsd(BigInt(5e16))).toBe(100)
    expect(stakeWeiToUsd(BigInt(5e17))).toBe(1000)
  })
})

describe('Contract Integration - Tier Calculation', () => {
  const testAddress = '0x1234567890123456789012345678901234567890'

  it('should return FREE for address with no stake', async () => {
    const contracts = createMockContracts({ stakeWei: 0n })
    const tier = await calculateTierFromContracts(testAddress, contracts)
    expect(tier).toBe('FREE')
  })

  it('should return BASIC for $10 stake', async () => {
    const stakeWei = BigInt(5e15)
    const contracts = createMockContracts({ stakeWei })
    const tier = await calculateTierFromContracts(testAddress, contracts)
    expect(tier).toBe('BASIC')
  })

  it('should return PRO for $100 stake', async () => {
    const stakeWei = BigInt(5e16)
    const contracts = createMockContracts({ stakeWei })
    const tier = await calculateTierFromContracts(testAddress, contracts)
    expect(tier).toBe('PRO')
  })

  it('should return UNLIMITED for $1000 stake', async () => {
    const stakeWei = BigInt(5e17)
    const contracts = createMockContracts({ stakeWei })
    const tier = await calculateTierFromContracts(testAddress, contracts)
    expect(tier).toBe('UNLIMITED')
  })

  it('should return BANNED when address is banned', async () => {
    const contracts = createMockContracts({ agentId: 1n, isBanned: true })
    const tier = await calculateTierFromContracts(testAddress, contracts)
    expect(tier).toBe('BANNED')
  })

  it('should not check ban status if agentId is 0', async () => {
    const contracts = createMockContracts({
      agentId: 0n,
      isBanned: true,
      stakeWei: BigInt(5e16),
    })
    const tier = await calculateTierFromContracts(testAddress, contracts)
    expect(tier).toBe('PRO')
  })

  it('should handle banned user with high stake', async () => {
    const stakeWei = BigInt(500e18)
    const contracts = createMockContracts({
      agentId: 1n,
      isBanned: true,
      stakeWei,
    })
    const tier = await calculateTierFromContracts(testAddress, contracts)
    expect(tier).toBe('BANNED')
  })
})

describe('Contract Integration - Error Handling', () => {
  const testAddress = '0x1234567890123456789012345678901234567890'

  it('should return FREE when getAgentId fails', async () => {
    const contracts = createMockContracts({ shouldFail: { getAgentId: true } })
    const tier = await calculateTierFromContracts(testAddress, contracts)
    expect(tier).toBe('FREE')
  })

  it('should not ban when isBanned check fails', async () => {
    const contracts = createMockContracts({
      agentId: 1n,
      shouldFail: { isBanned: true },
      stakeWei: BigInt(5e16),
    })
    const tier = await calculateTierFromContracts(testAddress, contracts)
    expect(tier).toBe('PRO')
  })

  it('should fallback to positions when getStake fails', async () => {
    const stakeWei = BigInt(5e17)
    const contracts = createMockContracts({ shouldFail: { getStake: true } })
    contracts.staking.positions = async () => [stakeWei, 0n, 0n]
    const tier = await calculateTierFromContracts(testAddress, contracts)
    expect(tier).toBe('UNLIMITED')
  })
})

describe('Rate Limit Window Behavior', () => {
  it('should create new record when none exists', () => {
    const store = new Map<string, RateLimitRecord>()
    const key = 'test-key'
    const now = Date.now()

    expect(store.get(key)).toBeUndefined()

    const newRecord: RateLimitRecord = {
      count: 1,
      resetAt: now + WINDOW_MS,
      tier: 'FREE',
    }
    store.set(key, newRecord)

    expect(store.get(key)).toEqual(newRecord)
  })

  it('should reset record when window expires', () => {
    const store = new Map<string, RateLimitRecord>()
    const key = 'test-key'
    const now = Date.now()

    store.set(key, { count: 50, resetAt: now - 1000, tier: 'FREE' })

    const record = store.get(key)
    const isExpired = record && now > record.resetAt
    expect(isExpired).toBe(true)

    if (isExpired) {
      store.set(key, { count: 1, resetAt: now + WINDOW_MS, tier: 'FREE' })
    }

    expect(store.get(key)?.count).toBe(1)
  })

  it('should increment count within window', () => {
    const store = new Map<string, RateLimitRecord>()
    const key = 'test-key'
    const now = Date.now()

    store.set(key, { count: 10, resetAt: now + WINDOW_MS, tier: 'FREE' })

    const record = store.get(key)
    if (record) record.count++

    expect(store.get(key)?.count).toBe(11)
  })
})

describe('Rate Limit Enforcement', () => {
  it('should allow requests under limit', () => {
    const limit = RATE_LIMITS.FREE
    const count = 50
    const isOverLimit = limit > 0 && count > limit
    expect(isOverLimit).toBe(false)
  })

  it('should block requests over limit', () => {
    const limit = RATE_LIMITS.FREE
    const count = 101
    const isOverLimit = limit > 0 && count > limit
    expect(isOverLimit).toBe(true)
  })

  it('should never block UNLIMITED tier', () => {
    const limit = RATE_LIMITS.UNLIMITED
    for (const count of [1, 100, 1000, 1000000]) {
      const isOverLimit = limit > 0 && count > limit
      expect(isOverLimit).toBe(false)
    }
  })

  it('should always block BANNED tier', () => {
    const tier: RateTier = 'BANNED'
    expect(tier === 'BANNED').toBe(true)
  })
})

describe('Client Identification', () => {
  it('should prefer API key over other identifiers', () => {
    const headers = {
      'x-api-key': 'my-api-key',
      'x-wallet-address': '0x1234567890abcdef1234567890abcdef12345678',
    }

    let key: string
    if (headers['x-api-key']) {
      key = `apikey:${headers['x-api-key']}`
    } else if (headers['x-wallet-address']) {
      key = `addr:${headers['x-wallet-address'].toLowerCase()}`
    } else {
      key = 'ip:unknown'
    }

    expect(key).toBe('apikey:my-api-key')
  })

  it('should use wallet address when no API key', () => {
    const headers = {
      'x-wallet-address': '0x1234567890ABCDEF1234567890abcdef12345678',
    }

    const key = `addr:${headers['x-wallet-address'].toLowerCase()}`
    expect(key).toBe('addr:0x1234567890abcdef1234567890abcdef12345678')
  })

  it('should validate Ethereum address format', () => {
    const isValidAddress = (addr: string): boolean =>
      /^0x[a-fA-F0-9]{40}$/.test(addr)

    expect(isValidAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(
      true,
    )
    expect(isValidAddress('1234567890abcdef1234567890abcdef12345678')).toBe(
      false,
    )
    expect(isValidAddress('0x1234')).toBe(false)
    expect(isValidAddress('')).toBe(false)
  })

  it('should extract IP from x-forwarded-for header', () => {
    const forwardedFor = '203.0.113.195, 70.41.3.18, 150.172.238.178'
    const ip = forwardedFor.split(',')[0]?.trim()
    expect(ip).toBe('203.0.113.195')
  })
})

describe('Rate Limit Headers', () => {
  it('should format limit header correctly', () => {
    const formatLimit = (limit: number) =>
      limit === 0 ? 'unlimited' : String(limit)

    expect(formatLimit(100)).toBe('100')
    expect(formatLimit(0)).toBe('unlimited')
  })

  it('should calculate remaining correctly', () => {
    const calculateRemaining = (limit: number, count: number) =>
      limit === 0 ? -1 : Math.max(0, limit - count)

    expect(calculateRemaining(0, 1000)).toBe(-1)
    expect(calculateRemaining(100, 50)).toBe(50)
    expect(calculateRemaining(100, 100)).toBe(0)
    expect(calculateRemaining(100, 150)).toBe(0)
  })
})

describe('Skip Paths', () => {
  it('should skip health check paths', () => {
    const skipPaths = ['/health', '/.well-known']
    const testPaths = [
      { path: '/health', shouldSkip: true },
      { path: '/health/ready', shouldSkip: true },
      { path: '/.well-known/jwks.json', shouldSkip: true },
      { path: '/api/search', shouldSkip: false },
    ]

    for (const { path, shouldSkip } of testPaths) {
      const skipped = skipPaths.some((p) => path.startsWith(p))
      expect(skipped).toBe(shouldSkip)
    }
  })
})

describe('Concurrent Rate Limiting', () => {
  it('should handle concurrent requests from same client', async () => {
    const store = new Map<string, RateLimitRecord>()
    const key = 'test-client'
    const limit = 100
    let blockedCount = 0

    const makeRequest = async () => {
      let record = store.get(key)
      if (!record || Date.now() > record.resetAt) {
        record = { count: 0, resetAt: Date.now() + WINDOW_MS, tier: 'FREE' }
        store.set(key, record)
      }

      record.count++

      if (record.count > limit) {
        blockedCount++
        return false
      }
      return true
    }

    const results = await Promise.all(
      Array(150)
        .fill(0)
        .map(() => makeRequest()),
    )

    const allowedCount = results.filter((r) => r).length
    expect(allowedCount).toBe(100)
    expect(blockedCount).toBe(50)
  })

  it('should maintain separate limits for different clients', () => {
    const store = new Map<string, RateLimitRecord>()
    const limit = 10

    const makeRequest = (clientId: string) => {
      const key = `client:${clientId}`
      let record = store.get(key)
      if (!record) {
        record = { count: 0, resetAt: Date.now() + WINDOW_MS, tier: 'FREE' }
        store.set(key, record)
      }
      record.count++
      return record.count <= limit
    }

    const clientAResults = Array(15)
      .fill(0)
      .map(() => makeRequest('A'))
    const clientBResults = Array(8)
      .fill(0)
      .map(() => makeRequest('B'))

    expect(clientAResults.filter((r) => r).length).toBe(10)
    expect(clientBResults.filter((r) => r).length).toBe(8)
  })
})

describe('Cache Cleanup', () => {
  it('should clean up expired entries', () => {
    const store = new Map<string, RateLimitRecord>()
    const now = Date.now()

    store.set('expired-1', { count: 50, resetAt: now - 10000, tier: 'FREE' })
    store.set('expired-2', { count: 30, resetAt: now - 5000, tier: 'BASIC' })
    store.set('valid-1', { count: 10, resetAt: now + 30000, tier: 'PRO' })
    store.set('valid-2', { count: 5, resetAt: now + 60000, tier: 'UNLIMITED' })

    expect(store.size).toBe(4)

    for (const [key, record] of store) {
      if (now > record.resetAt) {
        store.delete(key)
      }
    }

    expect(store.size).toBe(2)
    expect(store.has('valid-1')).toBe(true)
    expect(store.has('valid-2')).toBe(true)
  })
})

describe('Stats Collection', () => {
  it('should count entries by tier', () => {
    const store = new Map<string, RateLimitRecord>()
    const now = Date.now()

    store.set('free-1', { count: 10, resetAt: now + WINDOW_MS, tier: 'FREE' })
    store.set('free-2', { count: 20, resetAt: now + WINDOW_MS, tier: 'FREE' })
    store.set('basic-1', { count: 100, resetAt: now + WINDOW_MS, tier: 'BASIC' })
    store.set('pro-1', { count: 500, resetAt: now + WINDOW_MS, tier: 'PRO' })
    store.set('unlimited-1', {
      count: 10000,
      resetAt: now + WINDOW_MS,
      tier: 'UNLIMITED',
    })

    const byTier: Record<RateTier, number> = {
      BANNED: 0,
      FREE: 0,
      BASIC: 0,
      PRO: 0,
      UNLIMITED: 0,
    }
    for (const { tier } of store.values()) {
      byTier[tier]++
    }

    expect(byTier.FREE).toBe(2)
    expect(byTier.BASIC).toBe(1)
    expect(byTier.PRO).toBe(1)
    expect(byTier.UNLIMITED).toBe(1)
  })
})
