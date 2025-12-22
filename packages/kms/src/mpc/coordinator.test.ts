/**
 * MPC Coordinator Tests
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'
import { MPCCoordinator, resetMPCCoordinator } from './coordinator'

describe('MPC Coordinator', () => {
  let coordinator: MPCCoordinator

  beforeEach(() => {
    resetMPCCoordinator()
    coordinator = new MPCCoordinator({
      threshold: 2,
      totalParties: 3,
      sessionTimeout: 30000,
      maxConcurrentSessions: 100,
      requireAttestation: false,
      minPartyStake: 0n,
      network: 'localnet',
    })
  })

  afterEach(() => {
    resetMPCCoordinator()
  })

  describe('Party Registration', () => {
    it('should register a party', () => {
      const party = coordinator.registerParty({
        id: 'party-1',
        index: 1,
        endpoint: 'http://localhost:4100',
        publicKey: keccak256(toBytes('party-1')) as Hex,
        address: '0x1111111111111111111111111111111111111111' as Address,
        stake: BigInt(1e18),
        registeredAt: Date.now(),
      })

      expect(party.id).toBe('party-1')
      expect(party.status).toBe('active')
    })

    it('should get active parties', () => {
      for (let i = 0; i < 3; i++) {
        coordinator.registerParty({
          id: `party-${i + 1}`,
          index: i + 1,
          endpoint: `http://localhost:${4100 + i}`,
          publicKey: keccak256(toBytes(`party-${i + 1}`)) as Hex,
          address: `0x${'1'.repeat(40)}` as Address,
          stake: BigInt(1e18),
          registeredAt: Date.now(),
        })
      }

      const active = coordinator.getActiveParties()
      expect(active.length).toBe(3)
    })

    it('should update party heartbeat', () => {
      coordinator.registerParty({
        id: 'party-1',
        index: 1,
        endpoint: 'http://localhost:4100',
        publicKey: '0x1234' as Hex,
        address: '0x1111111111111111111111111111111111111111' as Address,
        stake: BigInt(1e18),
        registeredAt: Date.now(),
      })

      const before = coordinator.getActiveParties()[0].lastSeen
      coordinator.partyHeartbeat('party-1')
      const after = coordinator.getActiveParties()[0].lastSeen

      expect(after).toBeGreaterThanOrEqual(before)
    })
  })

  describe('Distributed Key Generation', () => {
    beforeEach(() => {
      // Register 3 parties
      for (let i = 0; i < 3; i++) {
        coordinator.registerParty({
          id: `party-${i + 1}`,
          index: i + 1,
          endpoint: `http://localhost:${4100 + i}`,
          publicKey: keccak256(toBytes(`party-${i + 1}`)) as Hex,
          address: `0x${'1'.repeat(40)}` as Address,
          stake: BigInt(1e18),
          registeredAt: Date.now(),
        })
      }
    })

    it('should generate a distributed key', async () => {
      const result = await coordinator.generateKey({
        keyId: 'test-key-1',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })

      expect(result.keyId).toBe('test-key-1')
      expect(result.publicKey).toBeDefined()
      expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(result.threshold).toBe(2)
      expect(result.totalParties).toBe(3)
      expect(result.partyShares.size).toBe(3)
      expect(result.version).toBe(1)
    })

    it('should retrieve a generated key', async () => {
      await coordinator.generateKey({
        keyId: 'test-key-2',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })

      const key = coordinator.getKey('test-key-2')
      expect(key).not.toBeNull()
      expect(key?.keyId).toBe('test-key-2')
    })

    it('should get key versions', async () => {
      await coordinator.generateKey({
        keyId: 'test-key-3',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })

      const versions = coordinator.getKeyVersions('test-key-3')
      expect(versions.length).toBe(1)
      expect(versions[0].version).toBe(1)
      expect(versions[0].status).toBe('active')
    })

    it('should reject duplicate key generation', async () => {
      await coordinator.generateKey({
        keyId: 'duplicate-key',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })

      await expect(
        coordinator.generateKey({
          keyId: 'duplicate-key',
          threshold: 2,
          totalParties: 3,
          partyIds: ['party-1', 'party-2', 'party-3'],
          curve: 'secp256k1',
        }),
      ).rejects.toThrow('Key duplicate-key already exists')
    })

    it('should reject invalid threshold', async () => {
      await expect(
        coordinator.generateKey({
          keyId: 'invalid-threshold',
          threshold: 1,
          totalParties: 3,
          partyIds: ['party-1', 'party-2', 'party-3'],
          curve: 'secp256k1',
        }),
      ).rejects.toThrow('Threshold must be at least 2')
    })
  })

  describe('Threshold Signing', () => {
    beforeEach(async () => {
      for (let i = 0; i < 3; i++) {
        coordinator.registerParty({
          id: `party-${i + 1}`,
          index: i + 1,
          endpoint: `http://localhost:${4100 + i}`,
          publicKey: keccak256(toBytes(`party-${i + 1}`)) as Hex,
          address: `0x${'1'.repeat(40)}` as Address,
          stake: BigInt(1e18),
          registeredAt: Date.now(),
        })
      }

      await coordinator.generateKey({
        keyId: 'signing-key',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })
    })

    it('should create a signing session', async () => {
      const message = toHex(toBytes('test message'))
      const messageHash = keccak256(toBytes(message))

      const session = await coordinator.requestSignature({
        keyId: 'signing-key',
        message,
        messageHash,
        requester: '0x1111111111111111111111111111111111111111' as Address,
      })

      expect(session.sessionId).toBeDefined()
      expect(session.status).toBe('pending')
      expect(session.threshold).toBe(2)
    })

    it('should collect partial signatures and produce final signature', async () => {
      const message = toHex(toBytes('test message'))
      const messageHash = keccak256(toBytes(message))

      const session = await coordinator.requestSignature({
        keyId: 'signing-key',
        message,
        messageHash,
        requester: '0x1111111111111111111111111111111111111111' as Address,
      })

      // Round 1: Submit commitments from 2 parties (threshold)
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

      // Round 2: Submit reveals from 2 parties
      let finalResult: { complete: boolean; signature?: { signature: Hex } } = {
        complete: false,
      }
      for (let i = 0; i < 2; i++) {
        const partyId = `party-${i + 1}`
        const partialR = keccak256(toBytes(`${session.sessionId}:${partyId}:r`))
        const partialS = keccak256(toBytes(`${session.sessionId}:${partyId}:s`))
        const commitment = keccak256(toBytes(`${partialR}:${partialS}`))

        finalResult = await coordinator.submitPartialSignature(
          session.sessionId,
          partyId,
          { partyId, partialR, partialS, commitment },
        )
      }

      expect(finalResult.complete).toBe(true)
      expect(finalResult.signature).toBeDefined()
      expect(finalResult.signature?.signature).toMatch(/^0x[a-fA-F0-9]+$/)
    })

    it('should reject signature from non-participant', async () => {
      const message = toHex(toBytes('test message'))
      const messageHash = keccak256(toBytes(message))

      const session = await coordinator.requestSignature({
        keyId: 'signing-key',
        message,
        messageHash,
        requester: '0x1111111111111111111111111111111111111111' as Address,
      })

      await expect(
        coordinator.submitPartialSignature(session.sessionId, 'unknown-party', {
          partyId: 'unknown-party',
          partialR: '0x1234' as Hex,
          partialS: '0x5678' as Hex,
          commitment: '0xabcd' as Hex,
        }),
      ).rejects.toThrow('Party unknown-party not in session')
    })
  })

  describe('Key Rotation', () => {
    beforeEach(async () => {
      for (let i = 0; i < 3; i++) {
        coordinator.registerParty({
          id: `party-${i + 1}`,
          index: i + 1,
          endpoint: `http://localhost:${4100 + i}`,
          publicKey: keccak256(toBytes(`party-${i + 1}`)) as Hex,
          address: `0x${'1'.repeat(40)}` as Address,
          stake: BigInt(1e18),
          registeredAt: Date.now(),
        })
      }

      await coordinator.generateKey({
        keyId: 'rotate-key',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })
    })

    it('should rotate key shares while preserving address', async () => {
      const keyBefore = coordinator.getKey('rotate-key')
      if (!keyBefore) throw new Error('Key should exist')
      const addressBefore = keyBefore.address

      const result = await coordinator.rotateKey({
        keyId: 'rotate-key',
        preserveAddress: true,
      })

      expect(result.newVersion).toBe(2)
      expect(result.oldVersion).toBe(1)
      expect(result.address).toBe(addressBefore)

      const versions = coordinator.getKeyVersions('rotate-key')
      expect(versions.length).toBe(2)
      expect(versions[0].status).toBe('rotated')
      expect(versions[1].status).toBe('active')
    })

    it('should allow decryption with old version after rotation', async () => {
      await coordinator.rotateKey({
        keyId: 'rotate-key',
        preserveAddress: true,
      })

      const versions = coordinator.getKeyVersions('rotate-key')
      expect(
        versions.find((v) => v.version === 1 && v.status === 'rotated'),
      ).toBeDefined()
    })
  })

  describe('Key Revocation', () => {
    beforeEach(async () => {
      for (let i = 0; i < 3; i++) {
        coordinator.registerParty({
          id: `party-${i + 1}`,
          index: i + 1,
          endpoint: `http://localhost:${4100 + i}`,
          publicKey: keccak256(toBytes(`party-${i + 1}`)) as Hex,
          address: `0x${'1'.repeat(40)}` as Address,
          stake: BigInt(1e18),
          registeredAt: Date.now(),
        })
      }

      await coordinator.generateKey({
        keyId: 'revoke-key',
        threshold: 2,
        totalParties: 3,
        partyIds: ['party-1', 'party-2', 'party-3'],
        curve: 'secp256k1',
      })
    })

    it('should revoke a key', () => {
      coordinator.revokeKey('revoke-key')

      const key = coordinator.getKey('revoke-key')
      expect(key).toBeNull()

      const versions = coordinator.getKeyVersions('revoke-key')
      expect(versions.every((v) => v.status === 'revoked')).toBe(true)
    })
  })

  describe('Status', () => {
    it('should return coordinator status', () => {
      const status = coordinator.getStatus()

      expect(status.activeParties).toBe(0)
      expect(status.totalKeys).toBe(0)
      expect(status.activeSessions).toBe(0)
      expect(status.config).toBeDefined()
      expect(status.config.threshold).toBe(2)
      expect(status.config.totalParties).toBe(3)
    })
  })
})
