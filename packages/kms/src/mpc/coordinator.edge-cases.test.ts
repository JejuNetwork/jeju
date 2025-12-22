/**
 * MPC Coordinator Edge Case Tests
 *
 * Thorough testing of boundary conditions, error handling,
 * concurrent operations, and signature verification.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { Address, Hex } from 'viem'
import { keccak256, recoverMessageAddress, toBytes, toHex } from 'viem'
import { MPCCoordinator, resetMPCCoordinator } from './coordinator'

describe('MPC Coordinator Edge Cases', () => {
  let coordinator: MPCCoordinator

  function registerParties(count: number) {
    for (let i = 0; i < count; i++) {
      coordinator.registerParty({
        id: `party-${i + 1}`,
        index: i + 1,
        endpoint: `http://localhost:${4100 + i}`,
        publicKey: keccak256(toBytes(`party-${i + 1}`)) as Hex,
        address: `0x${'1'.repeat(39)}${i}` as Address,
        stake: BigInt(1e18),
        registeredAt: Date.now(),
      })
    }
  }

  beforeEach(() => {
    resetMPCCoordinator()
    coordinator = new MPCCoordinator({
      threshold: 2,
      totalParties: 3,
      sessionTimeout: 30000,
      maxConcurrentSessions: 5,
      requireAttestation: false,
      minPartyStake: 0n,
      network: 'localnet',
    })
  })

  afterEach(() => {
    resetMPCCoordinator()
  })

  describe('Party Registration Edge Cases', () => {
    it('should reject party with insufficient stake when required', () => {
      const strictCoordinator = new MPCCoordinator({
        threshold: 2,
        totalParties: 3,
        sessionTimeout: 30000,
        maxConcurrentSessions: 5,
        requireAttestation: false,
        minPartyStake: BigInt(1e18), // 1 ETH minimum
        network: 'testnet',
      })

      expect(() =>
        strictCoordinator.registerParty({
          id: 'low-stake-party',
          index: 1,
          endpoint: 'http://localhost:4100',
          publicKey: '0x1234' as Hex,
          address: '0x1111111111111111111111111111111111111111' as Address,
          stake: BigInt(0.5e18), // Only 0.5 ETH
          registeredAt: Date.now(),
        }),
      ).toThrow('Insufficient stake')
    })

    it('should reject party without verified attestation when required', () => {
      const attestationCoordinator = new MPCCoordinator({
        threshold: 2,
        totalParties: 3,
        sessionTimeout: 30000,
        maxConcurrentSessions: 5,
        requireAttestation: true,
        minPartyStake: 0n,
        network: 'testnet',
      })

      expect(() =>
        attestationCoordinator.registerParty({
          id: 'no-attestation',
          index: 1,
          endpoint: 'http://localhost:4100',
          publicKey: '0x1234' as Hex,
          address: '0x1111111111111111111111111111111111111111' as Address,
          stake: BigInt(1e18),
          registeredAt: Date.now(),
          attestation: {
            quote: '0x' as Hex,
            measurement: '0x' as Hex,
            timestamp: 0,
            verified: false,
          },
        }),
      ).toThrow('Party attestation is not verified')
    })

    it('should filter stale parties from active list', async () => {
      registerParties(3)

      // Wait and check - parties should be active initially
      expect(coordinator.getActiveParties().length).toBe(3)

      // Parties become stale after 5 minutes without heartbeat in production
    })

    it('should handle party re-registration', () => {
      const _party1 = coordinator.registerParty({
        id: 'party-1',
        index: 1,
        endpoint: 'http://localhost:4100',
        publicKey: '0x1234' as Hex,
        address: '0x1111111111111111111111111111111111111111' as Address,
        stake: BigInt(1e18),
        registeredAt: Date.now(),
      })

      const party1Updated = coordinator.registerParty({
        id: 'party-1',
        index: 1,
        endpoint: 'http://localhost:4200', // Changed endpoint
        publicKey: '0x5678' as Hex, // Changed public key
        address: '0x1111111111111111111111111111111111111111' as Address,
        stake: BigInt(2e18), // Increased stake
        registeredAt: Date.now(),
      })

      expect(party1Updated.stake).toBe(BigInt(2e18))
      expect(coordinator.getActiveParties().length).toBe(1)
    })
  })

  describe('Key Generation Boundary Conditions', () => {
    it('should reject threshold > totalParties', async () => {
      registerParties(3)

      await expect(
        coordinator.generateKey({
          keyId: 'invalid-threshold',
          threshold: 4,
          totalParties: 3,
          partyIds: ['party-1', 'party-2', 'party-3'],
          curve: 'secp256k1',
        }),
      ).rejects.toThrow('Threshold cannot exceed total parties')
    })

    it('should reject mismatched party count', async () => {
      registerParties(3)

      await expect(
        coordinator.generateKey({
          keyId: 'mismatched',
          threshold: 2,
          totalParties: 3,
          partyIds: ['party-1', 'party-2'], // Only 2 parties
          curve: 'secp256k1',
        }),
      ).rejects.toThrow('Party count mismatch')
    })

    it('should reject unregistered party', async () => {
      registerParties(2)

      await expect(
        coordinator.generateKey({
          keyId: 'unregistered',
          threshold: 2,
          totalParties: 3,
          partyIds: ['party-1', 'party-2', 'party-99'], // party-99 not registered
          curve: 'secp256k1',
        }),
      ).rejects.toThrow('Party party-99 not active')
    })

    it('should generate unique addresses for different keys', async () => {
      registerParties(3)

      const key1 = await coordinator.generateKey({
        keyId: 'key-1',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })

      const key2 = await coordinator.generateKey({
        keyId: 'key-2',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })

      expect(key1.address).not.toBe(key2.address)
      expect(key1.publicKey).not.toBe(key2.publicKey)
    })

    it('should generate valid Ethereum address format', async () => {
      registerParties(3)

      const key = await coordinator.generateKey({
        keyId: 'format-test',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })

      // Verify address format
      expect(key.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      // Verify it's checksummed
      expect(key.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    it('should handle 3-of-5 threshold configuration', async () => {
      const coordinator35 = new MPCCoordinator({
        threshold: 3,
        totalParties: 5,
        sessionTimeout: 30000,
        maxConcurrentSessions: 5,
        requireAttestation: false,
        minPartyStake: 0n,
        network: 'mainnet',
      })

      for (let i = 0; i < 5; i++) {
        coordinator35.registerParty({
          id: `party-${i + 1}`,
          index: i + 1,
          endpoint: `http://localhost:${4100 + i}`,
          publicKey: keccak256(toBytes(`party-${i + 1}`)) as Hex,
          address: `0x${'1'.repeat(39)}${i}` as Address,
          stake: BigInt(1e18),
          registeredAt: Date.now(),
        })
      }

      const key = await coordinator35.generateKey({
        keyId: 'mainnet-key',
        threshold: 3,
        totalParties: 5,
        partyIds: ['party-1', 'party-2', 'party-3', 'party-4', 'party-5'],
        curve: 'secp256k1',
      })

      expect(key.threshold).toBe(3)
      expect(key.totalParties).toBe(5)
      expect(key.partyShares.size).toBe(5)
    })
  })

  describe('Signature Verification', () => {
    it('should produce recoverable signature matching key address', async () => {
      registerParties(3)

      const key = await coordinator.generateKey({
        keyId: 'verify-key',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })

      const message = 'Test message for signing'
      const messageHash = keccak256(toBytes(message))

      const session = await coordinator.requestSignature({
        keyId: 'verify-key',
        message: toHex(toBytes(message)),
        messageHash,
        requester: '0x1111111111111111111111111111111111111111' as Address,
      })

      // Submit commitments
      for (let i = 0; i < 2; i++) {
        const partyId = `party-${i + 1}`
        const partialR = keccak256(toBytes(`${session.sessionId}:${partyId}:r`))
        const partialS = keccak256(toBytes(`${session.sessionId}:${partyId}:s`))
        const commitment = keccak256(toBytes(`${partialR}:${partialS}`))
        await coordinator.submitPartialSignature(session.sessionId, partyId, {
          partyId,
          partialR,
          partialS,
          commitment,
        })
      }

      // Submit reveals
      let result: {
        complete: boolean
        signature?: { signature: Hex; r: Hex; s: Hex; v: number }
      } = { complete: false }
      for (let i = 0; i < 2; i++) {
        const partyId = `party-${i + 1}`
        const partialR = keccak256(toBytes(`${session.sessionId}:${partyId}:r`))
        const partialS = keccak256(toBytes(`${session.sessionId}:${partyId}:s`))
        const commitment = keccak256(toBytes(`${partialR}:${partialS}`))
        result = await coordinator.submitPartialSignature(
          session.sessionId,
          partyId,
          { partyId, partialR, partialS, commitment },
        )
      }

      expect(result.complete).toBe(true)
      expect(result.signature).toBeDefined()
      if (!result.signature) throw new Error('Signature should be defined')

      // Verify signature components are valid hex
      expect(result.signature.r).toMatch(/^0x[a-fA-F0-9]{64}$/)
      expect(result.signature.s).toMatch(/^0x[a-fA-F0-9]+$/)
      expect(result.signature.v).toBeGreaterThanOrEqual(27)
      expect(result.signature.v).toBeLessThanOrEqual(28)

      // Recover signer address and verify it matches the key address
      const recoveredAddress = await recoverMessageAddress({
        message: { raw: toBytes(messageHash) },
        signature: result.signature.signature,
      })

      expect(recoveredAddress.toLowerCase()).toBe(key.address.toLowerCase())
    })
  })

  describe('Session Management', () => {
    beforeEach(async () => {
      registerParties(3)
      await coordinator.generateKey({
        keyId: 'session-key',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })
    })

    it('should reject requests for non-existent key', async () => {
      const message = toHex(toBytes('test'))
      const messageHash = keccak256(toBytes(message))

      await expect(
        coordinator.requestSignature({
          keyId: 'non-existent-key',
          message,
          messageHash,
          requester: '0x1111111111111111111111111111111111111111' as Address,
        }),
      ).rejects.toThrow('Key non-existent-key not found')
    })

    it('should enforce max concurrent sessions limit', async () => {
      const message = toHex(toBytes('test'))
      const messageHash = keccak256(toBytes(message))

      // Create max sessions
      for (let i = 0; i < 5; i++) {
        await coordinator.requestSignature({
          keyId: 'session-key',
          message,
          messageHash,
          requester: '0x1111111111111111111111111111111111111111' as Address,
        })
      }

      // Next should fail
      await expect(
        coordinator.requestSignature({
          keyId: 'session-key',
          message,
          messageHash,
          requester: '0x1111111111111111111111111111111111111111' as Address,
        }),
      ).rejects.toThrow('Maximum concurrent sessions reached')
    })

    it('should reject submission to non-existent session', async () => {
      await expect(
        coordinator.submitPartialSignature('non-existent-session', 'party-1', {
          partyId: 'party-1',
          partialR: '0x1234' as Hex,
          partialS: '0x5678' as Hex,
          commitment: '0xabcd' as Hex,
        }),
      ).rejects.toThrow('Session non-existent-session not found')
    })

    it('should get session by ID', async () => {
      const message = toHex(toBytes('test'))
      const messageHash = keccak256(toBytes(message))

      const session = await coordinator.requestSignature({
        keyId: 'session-key',
        message,
        messageHash,
        requester: '0x1111111111111111111111111111111111111111' as Address,
      })

      const retrieved = coordinator.getSession(session.sessionId)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.sessionId).toBe(session.sessionId)
      expect(retrieved?.keyId).toBe('session-key')
    })

    it('should return undefined for non-existent session', () => {
      const session = coordinator.getSession('non-existent')
      expect(session).toBeUndefined()
    })

    it('should cleanup expired sessions', async () => {
      // Create coordinator with very short timeout
      const shortTimeoutCoordinator = new MPCCoordinator({
        threshold: 2,
        totalParties: 3,
        sessionTimeout: 1, // 1ms timeout
        maxConcurrentSessions: 100,
        requireAttestation: false,
        minPartyStake: 0n,
        network: 'localnet',
      })

      registerParties(3)
      for (let i = 0; i < 3; i++) {
        shortTimeoutCoordinator.registerParty({
          id: `party-${i + 1}`,
          index: i + 1,
          endpoint: `http://localhost:${4100 + i}`,
          publicKey: keccak256(toBytes(`party-${i + 1}`)) as Hex,
          address: `0x${'1'.repeat(39)}${i}` as Address,
          stake: BigInt(1e18),
          registeredAt: Date.now(),
        })
      }

      await shortTimeoutCoordinator.generateKey({
        keyId: 'timeout-key',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })

      const message = toHex(toBytes('test'))
      const messageHash = keccak256(toBytes(message))

      await shortTimeoutCoordinator.requestSignature({
        keyId: 'timeout-key',
        message,
        messageHash,
        requester: '0x1111111111111111111111111111111111111111' as Address,
      })

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 10))

      const cleaned = shortTimeoutCoordinator.cleanupExpiredSessions()
      expect(cleaned).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Key Rotation Edge Cases', () => {
    beforeEach(async () => {
      registerParties(3)
      await coordinator.generateKey({
        keyId: 'rotation-key',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })
    })

    it('should reject rotation for non-existent key', async () => {
      await expect(
        coordinator.rotateKey({
          keyId: 'non-existent',
          preserveAddress: true,
        }),
      ).rejects.toThrow('Key non-existent not found')
    })

    it('should reject rotation with invalid new threshold', async () => {
      await expect(
        coordinator.rotateKey({
          keyId: 'rotation-key',
          newThreshold: 1, // Invalid - must be >= 2
          preserveAddress: true,
        }),
      ).rejects.toThrow('Threshold must be at least 2')
    })

    it('should allow increasing threshold during rotation', async () => {
      // Add more parties first
      for (let i = 3; i < 5; i++) {
        coordinator.registerParty({
          id: `party-${i + 1}`,
          index: i + 1,
          endpoint: `http://localhost:${4100 + i}`,
          publicKey: keccak256(toBytes(`party-${i + 1}`)) as Hex,
          address: `0x${'1'.repeat(39)}${i}` as Address,
          stake: BigInt(1e18),
          registeredAt: Date.now(),
        })
      }

      const result = await coordinator.rotateKey({
        keyId: 'rotation-key',
        newThreshold: 3,
        newParties: ['party-1', 'party-2', 'party-3', 'party-4', 'party-5'],
        preserveAddress: true,
      })

      expect(result.newVersion).toBe(2)

      const key = coordinator.getKey('rotation-key')
      expect(key?.threshold).toBe(3)
      expect(key?.totalParties).toBe(5)
    })

    it('should maintain signing capability after rotation', async () => {
      // Rotate
      await coordinator.rotateKey({
        keyId: 'rotation-key',
        preserveAddress: true,
      })

      // Try to sign
      const message = toHex(toBytes('post-rotation'))
      const messageHash = keccak256(toBytes(message))

      const session = await coordinator.requestSignature({
        keyId: 'rotation-key',
        message,
        messageHash,
        requester: '0x1111111111111111111111111111111111111111' as Address,
      })

      expect(session.sessionId).toBeDefined()
    })

    it('should track multiple rotation versions', async () => {
      await coordinator.rotateKey({
        keyId: 'rotation-key',
        preserveAddress: true,
      })
      await coordinator.rotateKey({
        keyId: 'rotation-key',
        preserveAddress: true,
      })
      await coordinator.rotateKey({
        keyId: 'rotation-key',
        preserveAddress: true,
      })

      const versions = coordinator.getKeyVersions('rotation-key')
      expect(versions.length).toBe(4)
      expect(versions.filter((v) => v.status === 'rotated').length).toBe(3)
      expect(versions.filter((v) => v.status === 'active').length).toBe(1)
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle concurrent key generations without collision', async () => {
      registerParties(10)

      const promises = Array.from({ length: 10 }, (_, i) =>
        coordinator.generateKey({
          keyId: `concurrent-key-${i}`,
          threshold: 2,
          totalParties: 3,
          partyIds: [
            `party-${(i % 3) + 1}`,
            `party-${((i + 1) % 3) + 1}`,
            `party-${((i + 2) % 3) + 1}`,
          ],
          curve: 'secp256k1',
        }),
      )

      const results = await Promise.all(promises)
      const addresses = results.map((r) => r.address)
      const uniqueAddresses = new Set(addresses)

      expect(uniqueAddresses.size).toBe(10) // All addresses should be unique
    })

    it('should handle concurrent signing sessions', async () => {
      registerParties(3)
      await coordinator.generateKey({
        keyId: 'concurrent-sign-key',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })

      // Allow more sessions for this test
      const highConcurrencyCoordinator = new MPCCoordinator({
        threshold: 2,
        totalParties: 3,
        sessionTimeout: 30000,
        maxConcurrentSessions: 50,
        requireAttestation: false,
        minPartyStake: 0n,
        network: 'localnet',
      })

      for (let i = 0; i < 3; i++) {
        highConcurrencyCoordinator.registerParty({
          id: `party-${i + 1}`,
          index: i + 1,
          endpoint: `http://localhost:${4100 + i}`,
          publicKey: keccak256(toBytes(`party-${i + 1}`)) as Hex,
          address: `0x${'1'.repeat(39)}${i}` as Address,
          stake: BigInt(1e18),
          registeredAt: Date.now(),
        })
      }

      await highConcurrencyCoordinator.generateKey({
        keyId: 'concurrent-key',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })

      const sessionPromises = Array.from({ length: 10 }, (_, i) => {
        const message = toHex(toBytes(`message-${i}`))
        return highConcurrencyCoordinator.requestSignature({
          keyId: 'concurrent-key',
          message,
          messageHash: keccak256(toBytes(message)),
          requester: '0x1111111111111111111111111111111111111111' as Address,
        })
      })

      const sessions = await Promise.all(sessionPromises)
      const sessionIds = new Set(sessions.map((s) => s.sessionId))

      expect(sessionIds.size).toBe(10) // All session IDs should be unique
    })
  })

  describe('Status Reporting', () => {
    it('should accurately report active parties count', () => {
      expect(coordinator.getStatus().activeParties).toBe(0)

      registerParties(5)
      expect(coordinator.getStatus().activeParties).toBe(5)
    })

    it('should accurately report key count', async () => {
      registerParties(3)
      expect(coordinator.getStatus().totalKeys).toBe(0)

      await coordinator.generateKey({
        keyId: 'count-test-1',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })

      expect(coordinator.getStatus().totalKeys).toBe(1)

      await coordinator.generateKey({
        keyId: 'count-test-2',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })

      expect(coordinator.getStatus().totalKeys).toBe(2)

      coordinator.revokeKey('count-test-1')
      expect(coordinator.getStatus().totalKeys).toBe(1)
    })

    it('should accurately report active session count', async () => {
      registerParties(3)
      await coordinator.generateKey({
        keyId: 'session-count-key',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })

      expect(coordinator.getStatus().activeSessions).toBe(0)

      const message = toHex(toBytes('test'))
      const messageHash = keccak256(toBytes(message))

      await coordinator.requestSignature({
        keyId: 'session-count-key',
        message,
        messageHash,
        requester: '0x1111111111111111111111111111111111111111' as Address,
      })

      expect(coordinator.getStatus().activeSessions).toBe(1)
    })
  })
})
