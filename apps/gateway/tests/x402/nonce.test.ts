/**
 * Nonce Manager Tests
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import type { Address } from 'viem'

import {
  clearNonceCache,
  generateNonce,
  getNonceCacheStats,
  isNonceUsedLocally,
  markNonceFailed,
  markNoncePending,
  markNonceUsed,
} from '../../api/x402/services/nonce-manager'

const TEST_PAYER: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

describe('Nonce Generation', () => {
  test('should generate 32-character hex nonce', () => {
    const nonce = generateNonce()
    expect(nonce).toHaveLength(32)
    expect(/^[0-9a-f]+$/.test(nonce)).toBe(true)
  })

  test('should generate unique nonces', () => {
    const nonces = new Set<string>()
    for (let i = 0; i < 100; i++) {
      nonces.add(generateNonce())
    }
    expect(nonces.size).toBe(100)
  })
})

describe('Local Nonce Tracking', () => {
  beforeEach(() => {
    clearNonceCache()
  })

  test('should mark nonce as pending', async () => {
    const nonce = 'test-nonce-1'

    expect(await isNonceUsedLocally(TEST_PAYER, nonce)).toBe(false)

    await markNoncePending(TEST_PAYER, nonce)

    expect(await isNonceUsedLocally(TEST_PAYER, nonce)).toBe(true)
  })

  test('should mark nonce as used after pending', async () => {
    const nonce = 'test-nonce-2'

    await markNoncePending(TEST_PAYER, nonce)
    expect(await isNonceUsedLocally(TEST_PAYER, nonce)).toBe(true)

    await markNonceUsed(TEST_PAYER, nonce)
    expect(await isNonceUsedLocally(TEST_PAYER, nonce)).toBe(true)
  })

  test('should remove pending status on failure', async () => {
    const nonce = 'test-nonce-3'

    await markNoncePending(TEST_PAYER, nonce)
    expect(await isNonceUsedLocally(TEST_PAYER, nonce)).toBe(true)

    await markNonceFailed(TEST_PAYER, nonce)
    expect(await isNonceUsedLocally(TEST_PAYER, nonce)).toBe(false)
  })

  test('should track different payers separately', async () => {
    const nonce = 'shared-nonce'
    const payer2: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

    await markNonceUsed(TEST_PAYER, nonce)

    expect(await isNonceUsedLocally(TEST_PAYER, nonce)).toBe(true)
    expect(await isNonceUsedLocally(payer2, nonce)).toBe(false)
  })

  test('should be case-insensitive for addresses', async () => {
    const nonce = 'case-test-nonce'
    const upperPayer = TEST_PAYER.toUpperCase() as Address
    const lowerPayer = TEST_PAYER.toLowerCase() as Address

    await markNonceUsed(upperPayer, nonce)

    expect(await isNonceUsedLocally(lowerPayer, nonce)).toBe(true)
    expect(await isNonceUsedLocally(upperPayer, nonce)).toBe(true)
  })
})

describe('Nonce Cache Stats', () => {
  beforeEach(() => {
    clearNonceCache()
  })

  test('should report correct counts', async () => {
    // Add some used nonces
    await markNonceUsed(TEST_PAYER, 'used-1')
    await markNonceUsed(TEST_PAYER, 'used-2')

    // Add a pending nonce
    await markNoncePending(TEST_PAYER, 'pending-1')

    const stats = await getNonceCacheStats()

    expect(stats.used).toBe(2)
    expect(stats.pending).toBe(1)
    expect(stats.total).toBe(3)
  })

  test('should clear all caches', async () => {
    await markNonceUsed(TEST_PAYER, 'nonce-a')
    await markNoncePending(TEST_PAYER, 'nonce-b')

    clearNonceCache()

    const stats = await getNonceCacheStats()
    expect(stats.used).toBe(0)
    expect(stats.pending).toBe(0)
    expect(stats.total).toBe(0)
  })
})
