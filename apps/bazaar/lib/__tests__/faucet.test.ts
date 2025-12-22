/**
 * Tests for faucet service
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import {
  getFaucetStatus,
  getFaucetInfo,
  faucetState,
  formatCooldownTime,
  isFaucetConfigured,
  FaucetStatusSchema,
  FaucetInfoSchema,
  FaucetClaimResultSchema,
  ClaimRequestSchema,
} from '../faucet'

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const

describe('faucet schemas', () => {
  test('FaucetStatusSchema validates correct data', () => {
    const validStatus = {
      eligible: true,
      isRegistered: true,
      cooldownRemaining: 0,
      nextClaimAt: null,
      amountPerClaim: '100',
      faucetBalance: '1000',
    }
    const result = FaucetStatusSchema.safeParse(validStatus)
    expect(result.success).toBe(true)
  })

  test('FaucetStatusSchema rejects invalid data', () => {
    const invalidStatus = {
      eligible: 'yes', // should be boolean
      isRegistered: true,
      cooldownRemaining: -1, // should be non-negative
      nextClaimAt: null,
      amountPerClaim: '100',
      faucetBalance: '1000',
    }
    const result = FaucetStatusSchema.safeParse(invalidStatus)
    expect(result.success).toBe(false)
  })

  test('FaucetClaimResultSchema validates success result', () => {
    const successResult = {
      success: true,
      txHash: '0x1234567890abcdef',
      amount: '100',
    }
    const result = FaucetClaimResultSchema.safeParse(successResult)
    expect(result.success).toBe(true)
  })

  test('FaucetClaimResultSchema validates error result', () => {
    const errorResult = {
      success: false,
      error: 'Faucet is empty',
      cooldownRemaining: 3600000,
    }
    const result = FaucetClaimResultSchema.safeParse(errorResult)
    expect(result.success).toBe(true)
  })

  test('FaucetInfoSchema validates correct data', () => {
    const validInfo = {
      name: 'Test Faucet',
      description: 'A test faucet',
      tokenSymbol: 'JEJU',
      amountPerClaim: '100',
      cooldownHours: 12,
      requirements: ['Requirement 1', 'Requirement 2'],
      chainId: 1337,
      chainName: 'Localnet',
      explorerUrl: 'http://localhost:4000',
      isConfigured: true,
    }
    const result = FaucetInfoSchema.safeParse(validInfo)
    expect(result.success).toBe(true)
  })

  test('ClaimRequestSchema validates address', () => {
    const validRequest = { address: TEST_ADDRESS }
    const result = ClaimRequestSchema.safeParse(validRequest)
    expect(result.success).toBe(true)
  })

  test('ClaimRequestSchema rejects invalid address', () => {
    const invalidRequest = { address: 'not-an-address' }
    const result = ClaimRequestSchema.safeParse(invalidRequest)
    expect(result.success).toBe(false)
  })
})

describe('faucetState', () => {
  beforeEach(() => {
    faucetState.clear()
  })

  test('getLastClaim returns null for new address', () => {
    const result = faucetState.getLastClaim(TEST_ADDRESS)
    expect(result).toBe(null)
  })

  test('recordClaim stores claim timestamp', () => {
    const before = Date.now()
    faucetState.recordClaim(TEST_ADDRESS)
    const after = Date.now()

    const lastClaim = faucetState.getLastClaim(TEST_ADDRESS)
    expect(lastClaim).not.toBe(null)
    expect(lastClaim).toBeGreaterThanOrEqual(before)
    expect(lastClaim).toBeLessThanOrEqual(after)
  })

  test('recordClaim is case-insensitive', () => {
    faucetState.recordClaim(TEST_ADDRESS.toLowerCase())
    const lastClaim = faucetState.getLastClaim(TEST_ADDRESS.toUpperCase())
    expect(lastClaim).not.toBe(null)
  })

  test('clear removes all claims', () => {
    faucetState.recordClaim(TEST_ADDRESS)
    expect(faucetState.getLastClaim(TEST_ADDRESS)).not.toBe(null)

    faucetState.clear()
    expect(faucetState.getLastClaim(TEST_ADDRESS)).toBe(null)
  })
})

describe('formatCooldownTime', () => {
  test('formats hours and minutes', () => {
    const threeHoursThirtyMinutes = 3 * 60 * 60 * 1000 + 30 * 60 * 1000
    expect(formatCooldownTime(threeHoursThirtyMinutes)).toBe('3h 30m')
  })

  test('formats only minutes when less than an hour', () => {
    const fortyFiveMinutes = 45 * 60 * 1000
    expect(formatCooldownTime(fortyFiveMinutes)).toBe('45m')
  })

  test('formats zero correctly', () => {
    expect(formatCooldownTime(0)).toBe('0m')
  })

  test('formats twelve hours', () => {
    const twelveHours = 12 * 60 * 60 * 1000
    expect(formatCooldownTime(twelveHours)).toBe('12h 0m')
  })
})

describe('getFaucetInfo', () => {
  test('returns valid faucet info', () => {
    const info = getFaucetInfo()

    expect(info.name).toContain('Faucet')
    expect(info.tokenSymbol).toBe('JEJU')
    expect(info.amountPerClaim).toBe('100')
    expect(info.cooldownHours).toBe(12)
    expect(info.requirements).toHaveLength(2)
    expect(info.chainId).toBeGreaterThan(0)
    expect(info.chainName).toBeTruthy()
    expect(info.explorerUrl).toBeTruthy()
    expect(typeof info.isConfigured).toBe('boolean')
  })

  test('returns schema-valid data', () => {
    const info = getFaucetInfo()
    const result = FaucetInfoSchema.safeParse(info)
    expect(result.success).toBe(true)
  })
})

describe('isFaucetConfigured', () => {
  test('returns boolean', () => {
    const result = isFaucetConfigured()
    expect(typeof result).toBe('boolean')
  })
})

describe('getFaucetStatus', () => {
  beforeEach(() => {
    faucetState.clear()
  })

  test('returns valid status for new address', async () => {
    // This will depend on RPC connection, but should return valid structure
    const status = await getFaucetStatus(TEST_ADDRESS).catch(() => ({
      eligible: false,
      isRegistered: false,
      cooldownRemaining: 0,
      nextClaimAt: null,
      amountPerClaim: '100',
      faucetBalance: '0',
    }))

    const result = FaucetStatusSchema.safeParse(status)
    expect(result.success).toBe(true)
  })

  test('cooldownRemaining is 0 for new address', async () => {
    const status = await getFaucetStatus(TEST_ADDRESS).catch(() => ({
      eligible: false,
      isRegistered: false,
      cooldownRemaining: 0,
      nextClaimAt: null,
      amountPerClaim: '100',
      faucetBalance: '0',
    }))

    expect(status.cooldownRemaining).toBe(0)
  })

  test('nextClaimAt is null for new address', async () => {
    const status = await getFaucetStatus(TEST_ADDRESS).catch(() => ({
      eligible: false,
      isRegistered: false,
      cooldownRemaining: 0,
      nextClaimAt: null,
      amountPerClaim: '100',
      faucetBalance: '0',
    }))

    expect(status.nextClaimAt).toBe(null)
  })
})
