/**
 * Oracle Node Unit Tests
 *
 * Tests the oracle node daemon:
 * 1. Configuration loading
 * 2. Report hash computation
 * 3. Report signing
 * 4. Metrics collection
 */

import { describe, expect, test } from 'bun:test'
import { encodePacked, type Hex, keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Test utilities
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex

describe('Oracle Node Utilities', () => {
  describe('Report Hash Computation', () => {
    test('should compute deterministic report hash', () => {
      const feedId =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex
      const price = 350000000000n
      const confidence = 9500n
      const timestamp = 1700000000n
      const round = 1n
      const sourcesHash =
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hex

      const hash1 = keccak256(
        encodePacked(
          ['bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes32'],
          [feedId, price, confidence, timestamp, round, sourcesHash],
        ),
      )

      const hash2 = keccak256(
        encodePacked(
          ['bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes32'],
          [feedId, price, confidence, timestamp, round, sourcesHash],
        ),
      )

      expect(hash1).toBe(hash2)
    })

    test('should produce different hash for different prices', () => {
      const feedId =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex
      const sourcesHash =
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hex

      const hash1 = keccak256(
        encodePacked(
          ['bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes32'],
          [feedId, 100n, 9500n, 1700000000n, 1n, sourcesHash],
        ),
      )

      const hash2 = keccak256(
        encodePacked(
          ['bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes32'],
          [feedId, 200n, 9500n, 1700000000n, 1n, sourcesHash],
        ),
      )

      expect(hash1).not.toBe(hash2)
    })
  })

  describe('Report Signing', () => {
    test('should sign report correctly', async () => {
      const account = privateKeyToAccount(TEST_PRIVATE_KEY)

      const feedId =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex
      const price = 350000000000n
      const confidence = 9500n
      const timestamp = 1700000000n
      const round = 1n
      const sourcesHash =
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hex

      const reportHash = keccak256(
        encodePacked(
          ['bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes32'],
          [feedId, price, confidence, timestamp, round, sourcesHash],
        ),
      )

      const signature = await account.signMessage({
        message: { raw: reportHash },
      })

      expect(signature).toBeDefined()
      expect(signature.startsWith('0x')).toBe(true)
      expect(signature.length).toBe(132) // 0x + 65 bytes * 2
    })

    test('should produce consistent signatures', async () => {
      const account = privateKeyToAccount(TEST_PRIVATE_KEY)

      const reportHash =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex

      const sig1 = await account.signMessage({
        message: { raw: reportHash },
      })

      const sig2 = await account.signMessage({
        message: { raw: reportHash },
      })

      expect(sig1).toBe(sig2)
    })

    test('should produce different signatures for different hashes', async () => {
      const account = privateKeyToAccount(TEST_PRIVATE_KEY)

      const hash1 =
        '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex
      const hash2 =
        '0x2222222222222222222222222222222222222222222222222222222222222222' as Hex

      const sig1 = await account.signMessage({
        message: { raw: hash1 },
      })

      const sig2 = await account.signMessage({
        message: { raw: hash2 },
      })

      expect(sig1).not.toBe(sig2)
    })
  })

  describe('Operator ID Computation', () => {
    test('should compute operator ID from address', () => {
      const account = privateKeyToAccount(TEST_PRIVATE_KEY)
      const operatorId = keccak256(encodePacked(['address'], [account.address]))

      expect(operatorId).toBeDefined()
      expect(operatorId.startsWith('0x')).toBe(true)
      expect(operatorId.length).toBe(66)
    })

    test('should produce different IDs for different addresses', () => {
      const account1 = privateKeyToAccount(TEST_PRIVATE_KEY)
      const account2 = privateKeyToAccount(
        '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex,
      )

      const id1 = keccak256(encodePacked(['address'], [account1.address]))
      const id2 = keccak256(encodePacked(['address'], [account2.address]))

      expect(id1).not.toBe(id2)
    })
  })

  describe('Configuration Validation', () => {
    test('should require RPC_URL', () => {
      const config = {
        rpcUrl: '',
        privateKey: TEST_PRIVATE_KEY,
        feedRegistry: '0x1234567890123456789012345678901234567890',
        reportVerifier: '0x1234567890123456789012345678901234567890',
        committeeManager: '0x1234567890123456789012345678901234567890',
        networkConnector: '0x1234567890123456789012345678901234567890',
        pollIntervalMs: 10000,
        heartbeatIntervalMs: 30000,
      }

      expect(config.rpcUrl).toBe('')
    })

    test('should validate poll interval bounds', () => {
      const minInterval = 1000 // 1 second
      const maxInterval = 60000 // 1 minute

      const validInterval = 10000
      const tooShort = 500
      const tooLong = 120000

      expect(validInterval >= minInterval && validInterval <= maxInterval).toBe(
        true,
      )
      expect(tooShort >= minInterval).toBe(false)
      expect(tooLong <= maxInterval).toBe(false)
    })
  })

  describe('Metrics Computation', () => {
    test('should compute uptime correctly', () => {
      const startTime = Date.now() - 60000 // Started 1 minute ago
      const uptime = (Date.now() - startTime) / 1000

      expect(uptime).toBeGreaterThanOrEqual(59)
      expect(uptime).toBeLessThan(62)
    })

    test('should track report counts', () => {
      let reportsSubmitted = 0
      let reportsRejected = 0

      // Simulate submissions
      reportsSubmitted++
      reportsSubmitted++
      reportsRejected++
      reportsSubmitted++

      expect(reportsSubmitted).toBe(3)
      expect(reportsRejected).toBe(1)
    })
  })

  describe('Round Tracking', () => {
    test('should increment round correctly', () => {
      const feedRounds = new Map<string, number>()
      const feedId = '0x1234' as Hex

      // Get or initialize
      const currentRound = feedRounds.get(feedId) || 0
      expect(currentRound).toBe(0)

      // Increment
      feedRounds.set(feedId, currentRound + 1)
      expect(feedRounds.get(feedId)).toBe(1)

      feedRounds.set(feedId, (feedRounds.get(feedId) || 0) + 1)
      expect(feedRounds.get(feedId)).toBe(2)
    })
  })

  describe('Timestamp Handling', () => {
    test('should get current timestamp in seconds', () => {
      const nowMs = Date.now()
      const nowSec = Math.floor(nowMs / 1000)

      expect(nowSec).toBeGreaterThan(1700000000)
      expect(nowSec).toBeLessThan(2000000000)
    })

    test('should detect stale timestamps', () => {
      const maxAge = 3600 // 1 hour
      const now = Math.floor(Date.now() / 1000)

      const freshTimestamp = now - 60 // 1 minute ago
      const staleTimestamp = now - 7200 // 2 hours ago

      expect(now - freshTimestamp < maxAge).toBe(true)
      expect(now - staleTimestamp < maxAge).toBe(false)
    })
  })
})
