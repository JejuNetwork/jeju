/**
 * Tests for FROST Coordinator (DWS Worker variant)
 *
 * Tests distributed key generation and threshold signing
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { keccak256, toBytes } from 'viem'
import { FROSTCoordinator } from './frost-coordinator'

describe('FROSTCoordinator', () => {
  describe('initialization', () => {
    test('creates coordinator with correct parameters', () => {
      const coordinator = new FROSTCoordinator('test-key-1', 2, 3)

      expect(coordinator.keyId).toBe('test-key-1')
      expect(coordinator.threshold).toBe(2)
      expect(coordinator.totalParties).toBe(3)
    })

    test('accepts various threshold configurations', () => {
      // 2-of-3
      const coord1 = new FROSTCoordinator('key-1', 2, 3)
      expect(coord1.threshold).toBe(2)
      expect(coord1.totalParties).toBe(3)

      // 3-of-5
      const coord2 = new FROSTCoordinator('key-2', 3, 5)
      expect(coord2.threshold).toBe(3)
      expect(coord2.totalParties).toBe(5)

      // 5-of-10
      const coord3 = new FROSTCoordinator('key-3', 5, 10)
      expect(coord3.threshold).toBe(5)
      expect(coord3.totalParties).toBe(10)
    })
  })

  describe('key generation', () => {
    let coordinator: FROSTCoordinator

    beforeEach(() => {
      coordinator = new FROSTCoordinator('keygen-test', 2, 3)
    })

    test('generates key contribution with public share and commitment', async () => {
      const contribution = await coordinator.generateKeyGenContribution(1)

      expect(contribution).toBeDefined()
      expect(contribution.publicShare).toBeDefined()
      expect(contribution.commitment).toBeDefined()

      // Public share should be a hex string (compressed or uncompressed pubkey)
      expect(contribution.publicShare.startsWith('0x')).toBe(true)

      // Commitment should be a keccak256 hash (32 bytes)
      expect(contribution.commitment.startsWith('0x')).toBe(true)
      expect(contribution.commitment.length).toBe(66) // 0x + 64 hex chars
    })

    test('generates different contributions for different party indices', async () => {
      const coord1 = new FROSTCoordinator('key-diff-1', 2, 3)
      const coord2 = new FROSTCoordinator('key-diff-2', 2, 3)

      const contrib1 = await coord1.generateKeyGenContribution(1)
      const contrib2 = await coord2.generateKeyGenContribution(2)

      // Different random polynomials should give different results
      expect(contrib1.publicShare).not.toBe(contrib2.publicShare)
      expect(contrib1.commitment).not.toBe(contrib2.commitment)
    })

    test('finalizes key generation with all shares', async () => {
      // Simulate multiple parties generating contributions
      const parties = [
        new FROSTCoordinator('final-test', 2, 3),
        new FROSTCoordinator('final-test', 2, 3),
        new FROSTCoordinator('final-test', 2, 3),
      ]

      const contributions = await Promise.all(
        parties.map((p, i) => p.generateKeyGenContribution(i + 1)),
      )

      const allPublicShares = contributions.map((c) => c.publicShare)
      const allCommitments = contributions.map((c) => c.commitment)

      // Finalize with first party
      const result = await parties[0].finalizeKeyGen(
        allPublicShares,
        allCommitments,
      )

      expect(result).toBeDefined()
      expect(result.privateShare).toBeInstanceOf(Uint8Array)
      expect(result.privateShare.length).toBe(32)
      expect(result.publicShare).toBeDefined()
      expect(result.groupPublicKey).toBeDefined()
      expect(result.groupAddress).toBeDefined()

      // Address should be valid ethereum address
      expect(result.groupAddress.startsWith('0x')).toBe(true)
      expect(result.groupAddress.length).toBe(42)
    })

    test('throws if finalizing without contribution', async () => {
      const freshCoordinator = new FROSTCoordinator('no-contrib', 2, 3)

      await expect(freshCoordinator.finalizeKeyGen([], [])).rejects.toThrow(
        'Must call generateKeyGenContribution first',
      )
    })
  })

  describe('signing', () => {
    let coordinator: FROSTCoordinator
    const testMessage = keccak256(toBytes('test message'))

    beforeEach(async () => {
      coordinator = new FROSTCoordinator('sign-test', 2, 3)

      // Setup key first
      const contribution = await coordinator.generateKeyGenContribution(1)
      await coordinator.finalizeKeyGen(
        [contribution.publicShare],
        [contribution.commitment],
      )
    })

    test('generates signing commitment', async () => {
      const result = await coordinator.generateSigningCommitment(1, testMessage)

      expect(result).toBeDefined()
      expect(result.nonce).toBeInstanceOf(Uint8Array)
      expect(result.nonce.length).toBe(64) // Two 32-byte nonces (d, e)
      expect(result.commitment.startsWith('0x')).toBe(true)
    })

    test('generates different commitments for different messages', async () => {
      const msg1 = keccak256(toBytes('message 1'))
      const msg2 = keccak256(toBytes('message 2'))

      const commit1 = await coordinator.generateSigningCommitment(1, msg1)
      const commit2 = await coordinator.generateSigningCommitment(1, msg2)

      expect(commit1.commitment).not.toBe(commit2.commitment)
    })

    test('generates signature share', async () => {
      const commitment = await coordinator.generateSigningCommitment(
        1,
        testMessage,
      )

      const allCommitments = [
        { partyIndex: 1, commitment: commitment.commitment },
        { partyIndex: 2, commitment: commitment.commitment }, // Simulated
      ]

      const share = await coordinator.generateSignatureShare(
        1,
        testMessage,
        commitment.nonce,
        allCommitments,
      )

      expect(share).toBeDefined()
      expect(share.startsWith('0x')).toBe(true)
      expect(share.length).toBe(66) // 32 bytes + 0x
    })

    test('throws if generating share without key', async () => {
      const freshCoordinator = new FROSTCoordinator('no-key', 2, 3)
      const msg = keccak256(toBytes('test'))

      await expect(
        freshCoordinator.generateSignatureShare(1, msg, new Uint8Array(64), []),
      ).rejects.toThrow('Key generation not complete')
    })

    test('throws if generating share without commitment', async () => {
      // Different message from what was committed
      const differentMessage = keccak256(toBytes('different message'))

      await expect(
        coordinator.generateSignatureShare(
          1,
          differentMessage,
          new Uint8Array(64),
          [],
        ),
      ).rejects.toThrow('No nonce found for this signing session')
    })
  })

  describe('signature aggregation', () => {
    test('aggregates signature shares', () => {
      const messageHash = keccak256(toBytes('aggregate test'))
      const groupPublicKey = `0x${'01'.repeat(33)}` as `0x${string}`

      const commitments = [
        {
          partyIndex: 1,
          D: `0x${'02'.repeat(33)}` as `0x${string}`,
          E: `0x${'03'.repeat(33)}` as `0x${string}`,
        },
        {
          partyIndex: 2,
          D: `0x${'04'.repeat(33)}` as `0x${string}`,
          E: `0x${'05'.repeat(33)}` as `0x${string}`,
        },
      ]

      const shares = [
        { partyIndex: 1, share: `0x${'11'.repeat(32)}` as `0x${string}` },
        { partyIndex: 2, share: `0x${'22'.repeat(32)}` as `0x${string}` },
      ]

      const result = FROSTCoordinator.aggregateSignatures(
        messageHash,
        groupPublicKey,
        commitments,
        shares,
      )

      expect(result).toBeDefined()
      expect(result.r.startsWith('0x')).toBe(true)
      expect(result.s.startsWith('0x')).toBe(true)
      expect(result.v).toBe(27) // Default v value
    })

    test('handles single share (degenerate case)', () => {
      const messageHash = keccak256(toBytes('single'))
      const groupPublicKey = `0x${'01'.repeat(33)}` as `0x${string}`

      const result = FROSTCoordinator.aggregateSignatures(
        messageHash,
        groupPublicKey,
        [
          {
            partyIndex: 1,
            D: `0x${'02'.repeat(33)}` as `0x${string}`,
            E: `0x${'03'.repeat(33)}` as `0x${string}`,
          },
        ],
        [{ partyIndex: 1, share: `0x${'11'.repeat(32)}` as `0x${string}` }],
      )

      expect(result.r).toBeDefined()
      expect(result.s).toBeDefined()
    })
  })

  describe('concurrent operations', () => {
    test('handles multiple concurrent signing sessions', async () => {
      const coordinator = new FROSTCoordinator('concurrent-test', 2, 3)

      // Setup key
      const contribution = await coordinator.generateKeyGenContribution(1)
      await coordinator.finalizeKeyGen(
        [contribution.publicShare],
        [contribution.commitment],
      )

      // Create multiple signing sessions concurrently
      const messages = [
        keccak256(toBytes('msg1')),
        keccak256(toBytes('msg2')),
        keccak256(toBytes('msg3')),
      ]

      const commitments = await Promise.all(
        messages.map((msg, i) =>
          coordinator.generateSigningCommitment(i + 1, msg),
        ),
      )

      // All commitments should be different
      const uniqueCommitments = new Set(commitments.map((c) => c.commitment))
      expect(uniqueCommitments.size).toBe(3)
    })

    test('handles concurrent key generation attempts', async () => {
      const coordinators = [
        new FROSTCoordinator('concurrent-keygen', 2, 3),
        new FROSTCoordinator('concurrent-keygen', 2, 3),
        new FROSTCoordinator('concurrent-keygen', 2, 3),
      ]

      // All generate contributions concurrently
      const contributions = await Promise.all(
        coordinators.map((c, i) => c.generateKeyGenContribution(i + 1)),
      )

      // All should succeed with unique values
      const uniqueShares = new Set(contributions.map((c) => c.publicShare))
      expect(uniqueShares.size).toBe(3)
    })
  })

  describe('edge cases', () => {
    test('handles minimum threshold (2-of-2)', async () => {
      const coordinator = new FROSTCoordinator('min-threshold', 2, 2)

      const contribution = await coordinator.generateKeyGenContribution(1)
      const result = await coordinator.finalizeKeyGen(
        [contribution.publicShare],
        [contribution.commitment],
      )

      expect(result.groupAddress).toBeDefined()
    })

    test('handles large threshold (10-of-15)', async () => {
      const coordinator = new FROSTCoordinator('large-threshold', 10, 15)

      const contribution = await coordinator.generateKeyGenContribution(1)
      const result = await coordinator.finalizeKeyGen(
        [contribution.publicShare],
        [contribution.commitment],
      )

      expect(result.groupAddress).toBeDefined()
    })

    test('commitment nonces are 64 bytes (two 32-byte scalars)', async () => {
      const coordinator = new FROSTCoordinator('nonce-test', 2, 3)

      const contribution = await coordinator.generateKeyGenContribution(1)
      await coordinator.finalizeKeyGen(
        [contribution.publicShare],
        [contribution.commitment],
      )

      const message = keccak256(toBytes('nonce size test'))
      const commitment = await coordinator.generateSigningCommitment(1, message)

      expect(commitment.nonce.length).toBe(64)

      // First 32 bytes (d nonce)
      const dNonce = commitment.nonce.slice(0, 32)
      expect(dNonce.length).toBe(32)

      // Second 32 bytes (e nonce)
      const eNonce = commitment.nonce.slice(32, 64)
      expect(eNonce.length).toBe(32)
    })
  })
})
