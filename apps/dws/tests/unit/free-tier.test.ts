/**
 * Tests for Free Tier Management System
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Address } from 'viem'

// Mock SQLit before importing
const mockQuery = mock(() => Promise.resolve({ rows: [] }))
const mockExec = mock(() => Promise.resolve())

mock.module('@jejunetwork/db', () => ({
  getSQLit: () => ({
    query: mockQuery,
    exec: mockExec,
  }),
}))

// Import after mocking
const {
  FreeTierService,
  TIER_LIMITS,
  checkQuotaMiddleware,
  recordUsageMiddleware,
} = await import('../../api/shared/free-tier')

describe('Free Tier Service', () => {
  let service: FreeTierService
  const testAddress = '0x1234567890123456789012345678901234567890' as Address

  beforeEach(() => {
    service = new FreeTierService()
    mockQuery.mockClear()
    mockExec.mockClear()
  })

  describe('TIER_LIMITS', () => {
    test('free tier has correct limits', () => {
      expect(TIER_LIMITS.free.cpuHoursPerMonth).toBe(100)
      expect(TIER_LIMITS.free.memoryMbLimit).toBe(512)
      expect(TIER_LIMITS.free.concurrentDeployments).toBe(3)
      expect(TIER_LIMITS.free.functionInvocationsPerMonth).toBe(100_000)
      expect(TIER_LIMITS.free.storageGbLimit).toBe(1)
      expect(TIER_LIMITS.free.bandwidthGbPerMonth).toBe(10)
      expect(TIER_LIMITS.free.sponsoredGas).toBe(true)
    })

    test('hobby tier has correct limits', () => {
      expect(TIER_LIMITS.hobby.cpuHoursPerMonth).toBe(1000)
      expect(TIER_LIMITS.hobby.memoryMbLimit).toBe(1024)
      expect(TIER_LIMITS.hobby.concurrentDeployments).toBe(10)
      expect(TIER_LIMITS.hobby.storageGbLimit).toBe(10)
      expect(TIER_LIMITS.hobby.customDomains).toBe(5)
      expect(TIER_LIMITS.hobby.sponsoredGas).toBe(false)
    })

    test('pro tier has correct limits', () => {
      expect(TIER_LIMITS.pro.cpuHoursPerMonth).toBe(10_000)
      expect(TIER_LIMITS.pro.memoryMbLimit).toBe(4096)
      expect(TIER_LIMITS.pro.concurrentDeployments).toBe(50)
      expect(TIER_LIMITS.pro.customDomains).toBe(50)
    })

    test('enterprise tier has unlimited features', () => {
      expect(TIER_LIMITS.enterprise.cpuHoursPerMonth).toBe(-1)
      expect(TIER_LIMITS.enterprise.concurrentDeployments).toBe(-1)
      expect(TIER_LIMITS.enterprise.functionInvocationsPerMonth).toBe(-1)
      expect(TIER_LIMITS.enterprise.bandwidthGbPerMonth).toBe(-1)
    })
  })

  describe('getUserStatus', () => {
    test('creates new user with free tier', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const status = await service.getUserStatus(testAddress)

      expect(status.address).toBe(testAddress)
      expect(status.tier).toBe('free')
      expect(status.limits).toEqual(TIER_LIMITS.free)
      expect(status.usage.cpuHoursUsed).toBe(0)
      expect(status.sponsoredGasRemaining).toBe(
        TIER_LIMITS.free.sponsoredGasLimitWei,
      )
    })

    test('returns existing user status', async () => {
      const now = Date.now()
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            tier: 'hobby',
            is_verified: 1,
            linked_identity_type: 'github',
            linked_identity_verified_at: now,
            quota_reset_at: now + 86400000,
            sponsored_gas_used: '0',
            created_at: now - 86400000,
            updated_at: now,
          },
        ],
      })
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            cpu_hours_used: 50,
            function_invocations: 10000,
            storage_gb_used: 2.5,
            bandwidth_gb_used: 25,
            cache_memory_used: 128,
            deployment_count: 5,
            last_updated: now,
          },
        ],
      })

      const status = await service.getUserStatus(testAddress)

      expect(status.tier).toBe('hobby')
      expect(status.isVerified).toBe(true)
      expect(status.linkedIdentity?.type).toBe('github')
      expect(status.usage.cpuHoursUsed).toBe(50)
      expect(status.usage.functionInvocations).toBe(10000)
    })
  })

  describe('checkQuota', () => {
    test('allows usage within limits', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const result = await service.checkQuota(testAddress, 'cpu_hours', 10)

      expect(result.allowed).toBe(true)
      expect(result.upgradeRequired).toBe(false)
    })

    test('denies usage exceeding limits', async () => {
      const now = Date.now()
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            tier: 'free',
            is_verified: 0,
            linked_identity_type: null,
            linked_identity_verified_at: null,
            quota_reset_at: now + 86400000,
            sponsored_gas_used: '0',
            created_at: now - 86400000,
            updated_at: now,
          },
        ],
      })
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            cpu_hours_used: 95,
            function_invocations: 0,
            storage_gb_used: 0,
            bandwidth_gb_used: 0,
            cache_memory_used: 0,
            deployment_count: 0,
            last_updated: now,
          },
        ],
      })

      const result = await service.checkQuota(testAddress, 'cpu_hours', 10)

      expect(result.allowed).toBe(false)
      expect(result.upgradeRequired).toBe(true)
      expect(result.suggestedTier).toBe('hobby')
    })

    test('unlimited tier always allows', async () => {
      const now = Date.now()
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            tier: 'enterprise',
            is_verified: 1,
            linked_identity_type: null,
            linked_identity_verified_at: null,
            quota_reset_at: now + 86400000,
            sponsored_gas_used: '0',
            created_at: now - 86400000,
            updated_at: now,
          },
        ],
      })
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            cpu_hours_used: 100000,
            function_invocations: 0,
            storage_gb_used: 0,
            bandwidth_gb_used: 0,
            cache_memory_used: 0,
            deployment_count: 0,
            last_updated: now,
          },
        ],
      })

      const result = await service.checkQuota(testAddress, 'cpu_hours', 50000)

      expect(result.allowed).toBe(true)
      expect(result.limit).toBe(-1)
    })
  })

  describe('recordUsage', () => {
    test('records CPU usage', async () => {
      await service.recordUsage(testAddress, 'cpu_hours', 5)

      expect(mockExec).toHaveBeenCalled()
    })

    test('records function invocations', async () => {
      await service.recordUsage(testAddress, 'function_invocations', 1000, {
        functionId: 'test-fn',
      })

      expect(mockExec).toHaveBeenCalled()
    })
  })

  describe('recordGasSponsorshipUsage', () => {
    test('allows sponsored gas within limits', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const result = await service.recordGasSponsorshipUsage(
        testAddress,
        '0xabc',
        1000000n,
        1000000n,
      )

      expect(result.allowed).toBe(true)
    })

    test('denies sponsored gas exceeding limits', async () => {
      const now = Date.now()
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            tier: 'free',
            is_verified: 0,
            linked_identity_type: null,
            linked_identity_verified_at: null,
            quota_reset_at: now + 86400000,
            sponsored_gas_used: '9900000000000000', // 0.0099 ETH
            created_at: now - 86400000,
            updated_at: now,
          },
        ],
      })
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const result = await service.recordGasSponsorshipUsage(
        testAddress,
        '0xabc',
        200000000000000n, // 0.0002 ETH
        200000000000000n,
      )

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('exceeded')
    })
  })

  describe('upgradeTier', () => {
    test('upgrades user tier', async () => {
      await service.upgradeTier(testAddress, 'pro', '0x123')

      expect(mockExec).toHaveBeenCalled()
    })
  })

  describe('verifyIdentity', () => {
    test('verifies user identity', async () => {
      await service.verifyIdentity(testAddress, 'github')

      expect(mockExec).toHaveBeenCalled()
    })
  })
})

describe('checkQuotaMiddleware', () => {
  test('returns ok for allowed usage', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await checkQuotaMiddleware(
      '0x1234567890123456789012345678901234567890' as Address,
      'cpu_hours',
      10,
    )

    expect(result.ok).toBe(true)
  })
})

describe('recordUsageMiddleware', () => {
  test('records usage', async () => {
    await recordUsageMiddleware(
      '0x1234567890123456789012345678901234567890' as Address,
      'cpu_hours',
      10,
    )

    expect(mockExec).toHaveBeenCalled()
  })
})
