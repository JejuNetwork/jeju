/**
 * Unit tests for contribution calculation utilities
 */

import { describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import type { ContributionState, VPNServiceContext } from '../types'
import {
  addContribution,
  addUsage,
  calculateContributionCap,
  calculateContributionRatio,
  getOrCreateContribution,
  getQuotaRemaining,
  isContributionPeriodExpired,
  resetContributionPeriod,
  updateContributionCap,
} from './contributions'

// Helper to create test context
function createTestContext(): VPNServiceContext {
  return {
    config: {
      publicUrl: 'https://vpn.jeju.network',
      port: 3000,
      chainId: 84532,
      rpcUrl: 'https://sepolia.base.org',
      coordinatorUrl: 'https://coordinator.jeju.network',
      contracts: {
        vpnRegistry: '0x1234567890123456789012345678901234567890' as Address,
        vpnBilling: '0x2234567890123456789012345678901234567890' as Address,
        x402Facilitator:
          '0x3234567890123456789012345678901234567890' as Address,
      },
      paymentRecipient: '0x4234567890123456789012345678901234567890' as Address,
      pricing: {
        pricePerGB: '1000000000000000',
        pricePerHour: '100000000000000',
        pricePerRequest: '10000000000000',
        supportedTokens: [
          '0x5234567890123456789012345678901234567890' as Address,
        ],
      },
    },
    nodes: new Map(),
    sessions: new Map(),
    contributions: new Map(),
  }
}

// Helper to create test contribution
function createTestContribution(
  overrides: Partial<ContributionState> = {},
): ContributionState {
  const now = Date.now()
  return {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
    bytesUsed: BigInt(0),
    bytesContributed: BigInt(0),
    cap: BigInt(0),
    periodStart: now,
    periodEnd: now + 30 * 24 * 60 * 60 * 1000,
    ...overrides,
  }
}

describe('calculateContributionCap', () => {
  test('returns 3x the bytes used', () => {
    const result = calculateContributionCap(BigInt(1000))
    expect(result).toBe(BigInt(3000))
  })

  test('handles zero bytes', () => {
    const result = calculateContributionCap(BigInt(0))
    expect(result).toBe(BigInt(0))
  })

  test('handles large values correctly', () => {
    // 1 TB = 1099511627776 bytes
    const oneTerabyte = BigInt('1099511627776')
    const result = calculateContributionCap(oneTerabyte)
    expect(result).toBe(BigInt('3298534883328'))
  })
})

describe('getQuotaRemaining', () => {
  test('returns cap minus contributed when under cap', () => {
    const contribution = createTestContribution({
      cap: BigInt(3000),
      bytesContributed: BigInt(1000),
    })
    const result = getQuotaRemaining(contribution)
    expect(result).toBe(BigInt(2000))
  })

  test('returns zero when at cap', () => {
    const contribution = createTestContribution({
      cap: BigInt(3000),
      bytesContributed: BigInt(3000),
    })
    const result = getQuotaRemaining(contribution)
    expect(result).toBe(BigInt(0))
  })

  test('throws when contribution exceeds cap', () => {
    const contribution = createTestContribution({
      cap: BigInt(1000),
      bytesContributed: BigInt(2000),
    })
    expect(() => getQuotaRemaining(contribution)).toThrow(
      'Quota remaining cannot be negative',
    )
  })
})

describe('calculateContributionRatio', () => {
  test('returns 0 when no usage', () => {
    const contribution = createTestContribution({
      bytesUsed: BigInt(0),
      bytesContributed: BigInt(0),
    })
    const result = calculateContributionRatio(contribution)
    expect(result).toBe(0)
  })

  test('returns 1 when contributed equals used', () => {
    const contribution = createTestContribution({
      bytesUsed: BigInt(1000),
      bytesContributed: BigInt(1000),
    })
    const result = calculateContributionRatio(contribution)
    expect(result).toBe(1)
  })

  test('returns 0.5 when contributed is half of used', () => {
    const contribution = createTestContribution({
      bytesUsed: BigInt(2000),
      bytesContributed: BigInt(1000),
    })
    const result = calculateContributionRatio(contribution)
    expect(result).toBe(0.5)
  })

  test('returns 2 when contributed is double used', () => {
    const contribution = createTestContribution({
      bytesUsed: BigInt(1000),
      bytesContributed: BigInt(2000),
    })
    const result = calculateContributionRatio(contribution)
    expect(result).toBe(2)
  })
})

describe('updateContributionCap', () => {
  test('updates cap when new cap is higher', () => {
    const contribution = createTestContribution({
      bytesUsed: BigInt(2000),
      cap: BigInt(3000), // Old cap from 1000 bytes used
    })
    updateContributionCap(contribution)
    expect(contribution.cap).toBe(BigInt(6000)) // 2000 * 3
  })

  test('does not decrease cap', () => {
    const contribution = createTestContribution({
      bytesUsed: BigInt(1000),
      cap: BigInt(9000), // Higher than 1000 * 3
    })
    updateContributionCap(contribution)
    expect(contribution.cap).toBe(BigInt(9000))
  })
})

describe('isContributionPeriodExpired', () => {
  test('returns false when period not expired', () => {
    const contribution = createTestContribution({
      periodEnd: Date.now() + 1000 * 60 * 60, // 1 hour from now
    })
    const result = isContributionPeriodExpired(contribution)
    expect(result).toBe(false)
  })

  test('returns true when period expired', () => {
    const contribution = createTestContribution({
      periodEnd: Date.now() - 1000, // 1 second ago
    })
    const result = isContributionPeriodExpired(contribution)
    expect(result).toBe(true)
  })
})

describe('resetContributionPeriod', () => {
  test('resets all counters and sets new period', () => {
    const contribution = createTestContribution({
      bytesUsed: BigInt(5000),
      bytesContributed: BigInt(2000),
      cap: BigInt(15000),
    })
    const beforeReset = Date.now()
    resetContributionPeriod(contribution)
    const afterReset = Date.now()

    expect(contribution.bytesUsed).toBe(BigInt(0))
    expect(contribution.bytesContributed).toBe(BigInt(0))
    expect(contribution.cap).toBe(BigInt(0))
    expect(contribution.periodStart).toBeGreaterThanOrEqual(beforeReset)
    expect(contribution.periodStart).toBeLessThanOrEqual(afterReset)
    expect(contribution.periodEnd).toBe(
      contribution.periodStart + 30 * 24 * 60 * 60 * 1000,
    )
  })
})

describe('addUsage', () => {
  test('adds usage and updates cap', () => {
    const contribution = createTestContribution()
    addUsage(contribution, BigInt(1000))
    expect(contribution.bytesUsed).toBe(BigInt(1000))
    expect(contribution.cap).toBe(BigInt(3000))
  })

  test('accumulates usage over multiple calls', () => {
    const contribution = createTestContribution()
    addUsage(contribution, BigInt(1000))
    addUsage(contribution, BigInt(500))
    expect(contribution.bytesUsed).toBe(BigInt(1500))
    expect(contribution.cap).toBe(BigInt(4500))
  })

  test('throws on negative usage', () => {
    const contribution = createTestContribution()
    expect(() => addUsage(contribution, BigInt(-100))).toThrow(
      'Usage cannot be negative',
    )
  })
})

describe('addContribution', () => {
  test('adds contribution when under cap', () => {
    const contribution = createTestContribution({
      cap: BigInt(3000),
    })
    addContribution(contribution, BigInt(1000))
    expect(contribution.bytesContributed).toBe(BigInt(1000))
  })

  test('accumulates contributions', () => {
    const contribution = createTestContribution({
      cap: BigInt(3000),
    })
    addContribution(contribution, BigInt(1000))
    addContribution(contribution, BigInt(500))
    expect(contribution.bytesContributed).toBe(BigInt(1500))
  })

  test('throws on negative contribution', () => {
    const contribution = createTestContribution({
      cap: BigInt(3000),
    })
    expect(() => addContribution(contribution, BigInt(-100))).toThrow(
      'Contribution cannot be negative',
    )
  })

  test('throws when contribution exceeds cap', () => {
    const contribution = createTestContribution({
      cap: BigInt(1000),
      bytesContributed: BigInt(500),
    })
    // The getQuotaRemaining check fires first with this message
    expect(() => addContribution(contribution, BigInt(600))).toThrow(
      'Quota remaining cannot be negative',
    )
  })
})

describe('getOrCreateContribution', () => {
  test('creates new contribution for new address', () => {
    const ctx = createTestContext()
    const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address
    const result = getOrCreateContribution(ctx, address)

    expect(result.address).toBe(address)
    expect(result.bytesUsed).toBe(BigInt(0))
    expect(result.bytesContributed).toBe(BigInt(0))
    expect(result.cap).toBe(BigInt(0))
    expect(ctx.contributions.has(address)).toBe(true)
  })

  test('returns existing contribution', () => {
    const ctx = createTestContext()
    const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address
    const existing = createTestContribution({
      address,
      bytesUsed: BigInt(1000),
    })
    ctx.contributions.set(address, existing)

    const result = getOrCreateContribution(ctx, address)
    expect(result).toBe(existing)
    expect(result.bytesUsed).toBe(BigInt(1000))
  })
})
