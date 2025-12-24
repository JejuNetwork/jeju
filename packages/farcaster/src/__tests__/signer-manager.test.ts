/**
 * Signer Manager Tests
 *
 * Tests for Farcaster signer key generation, management, and signing operations.
 * Covers Ed25519 key pairs, signature creation/verification, and lifecycle management.
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { ed25519 } from '@noble/curves/ed25519'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import type { Hex } from 'viem'
import { FarcasterSignerManager, type SignerInfo } from '../signer/manager'

const TEST_FID = 12345
const TEST_APP_NAME = 'TestApp'

// Known test private key
const KNOWN_PRIVATE_KEY = hexToBytes(
  'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
)
const KNOWN_PUBLIC_KEY = ed25519.getPublicKey(KNOWN_PRIVATE_KEY)
describe('FarcasterSignerManager', () => {
  let manager: FarcasterSignerManager

  beforeEach(() => {
    manager = new FarcasterSignerManager({ storage: 'memory' })
  })

  describe('createSigner', () => {
    it('creates signer with pending status', async () => {
      const signer = await manager.createSigner({
        fid: TEST_FID,
        appName: TEST_APP_NAME,
      })

      expect(signer.fid).toBe(TEST_FID)
      expect(signer.appName).toBe(TEST_APP_NAME)
      expect(signer.status).toBe('pending')
    })

    it('generates valid Ed25519 public key', async () => {
      const signer = await manager.createSigner({
        fid: TEST_FID,
        appName: TEST_APP_NAME,
      })

      expect(signer.publicKey.startsWith('0x')).toBe(true)

      // Public key should be 32 bytes = 64 hex chars + 0x prefix = 66 chars
      expect(signer.publicKey.length).toBe(66)

      // Verify it's valid hex
      const bytes = hexToBytes(signer.publicKey.slice(2))
      expect(bytes.length).toBe(32)
    })

    it('creates unique key IDs', async () => {
      const signer1 = await manager.createSigner({
        fid: TEST_FID,
        appName: TEST_APP_NAME,
      })

      // Add slight delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 2))

      const signer2 = await manager.createSigner({
        fid: TEST_FID,
        appName: TEST_APP_NAME,
      })

      expect(signer1.keyId).not.toBe(signer2.keyId)
    })

    it('creates unique key pairs', async () => {
      const signers: SignerInfo[] = []

      for (let i = 0; i < 10; i++) {
        const signer = await manager.createSigner({
          fid: TEST_FID,
          appName: TEST_APP_NAME,
        })
        signers.push(signer)
      }

      const publicKeys = signers.map((s) => s.publicKey)
      const uniqueKeys = new Set(publicKeys)

      expect(uniqueKeys.size).toBe(10)
    })

    it('includes appFid when provided', async () => {
      const signer = await manager.createSigner({
        fid: TEST_FID,
        appName: TEST_APP_NAME,
        appFid: 999,
      })

      expect(signer.appFid).toBe(999)
    })

    it('sets createdAt timestamp', async () => {
      const before = Date.now()
      const signer = await manager.createSigner({
        fid: TEST_FID,
        appName: TEST_APP_NAME,
      })
      const after = Date.now()

      expect(signer.createdAt).toBeGreaterThanOrEqual(before)
      expect(signer.createdAt).toBeLessThanOrEqual(after)
    })
  })

  describe('importSigner', () => {
    it('imports signer from Uint8Array private key', async () => {
      const signer = await manager.importSigner({
        fid: TEST_FID,
        privateKey: KNOWN_PRIVATE_KEY,
        appName: TEST_APP_NAME,
      })

      const expectedPublicKey = `0x${bytesToHex(KNOWN_PUBLIC_KEY)}` as Hex
      expect(signer.publicKey).toBe(expectedPublicKey)
    })

    it('imports signer from hex private key', async () => {
      const hexKey = `0x${bytesToHex(KNOWN_PRIVATE_KEY)}` as Hex
      const signer = await manager.importSigner({
        fid: TEST_FID,
        privateKey: hexKey,
        appName: TEST_APP_NAME,
      })

      const expectedPublicKey = `0x${bytesToHex(KNOWN_PUBLIC_KEY)}` as Hex
      expect(signer.publicKey).toBe(expectedPublicKey)
    })

    it('imports with non-prefixed hex', async () => {
      const hexKey = bytesToHex(KNOWN_PRIVATE_KEY) as Hex
      const signer = await manager.importSigner({
        fid: TEST_FID,
        privateKey: hexKey,
        appName: TEST_APP_NAME,
      })

      const expectedPublicKey = `0x${bytesToHex(KNOWN_PUBLIC_KEY)}` as Hex
      expect(signer.publicKey).toBe(expectedPublicKey)
    })

    it('defaults to active status', async () => {
      const signer = await manager.importSigner({
        fid: TEST_FID,
        privateKey: KNOWN_PRIVATE_KEY,
        appName: TEST_APP_NAME,
      })

      expect(signer.status).toBe('active')
    })

    it('respects provided status', async () => {
      const signer = await manager.importSigner({
        fid: TEST_FID,
        privateKey: KNOWN_PRIVATE_KEY,
        appName: TEST_APP_NAME,
        status: 'pending',
      })

      expect(signer.status).toBe('pending')
    })

    it('sets approvedAt for active status', async () => {
      const before = Date.now()
      const signer = await manager.importSigner({
        fid: TEST_FID,
        privateKey: KNOWN_PRIVATE_KEY,
        appName: TEST_APP_NAME,
        status: 'active',
      })
      const after = Date.now()

      expect(signer.approvedAt).toBeDefined()
      expect(signer.approvedAt).toBeGreaterThanOrEqual(before)
      expect(signer.approvedAt).toBeLessThanOrEqual(after)
    })
  })

  describe('getSigner', () => {
    it('returns null for non-existent key', async () => {
      const signer = await manager.getSigner('non-existent-key')
      expect(signer).toBeNull()
    })

    it('returns signer info for existing key', async () => {
      const created = await manager.createSigner({
        fid: TEST_FID,
        appName: TEST_APP_NAME,
      })

      const retrieved = await manager.getSigner(created.keyId)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.keyId).toBe(created.keyId)
      expect(retrieved?.publicKey).toBe(created.publicKey)
    })
  })

  describe('getSignersForFid', () => {
    it('returns empty array when no signers exist', async () => {
      const signers = await manager.getSignersForFid(999)
      expect(signers).toEqual([])
    })

    it('returns all signers for FID', async () => {
      await manager.createSigner({ fid: TEST_FID, appName: 'App1' })
      await new Promise((resolve) => setTimeout(resolve, 2))
      await manager.createSigner({ fid: TEST_FID, appName: 'App2' })
      await new Promise((resolve) => setTimeout(resolve, 2))
      await manager.createSigner({ fid: TEST_FID + 1, appName: 'OtherFid' })

      const signers = await manager.getSignersForFid(TEST_FID)

      expect(signers).toHaveLength(2)
      expect(signers.every((s) => s.fid === TEST_FID)).toBe(true)
    })
  })

  describe('getActiveSignerForFid', () => {
    it('returns null when no active signers exist', async () => {
      await manager.createSigner({ fid: TEST_FID, appName: 'Pending' }) // pending by default

      const active = await manager.getActiveSignerForFid(TEST_FID)
      expect(active).toBeNull()
    })

    it('returns first active signer', async () => {
      await manager.createSigner({ fid: TEST_FID, appName: 'Pending1' })
      await new Promise((resolve) => setTimeout(resolve, 2))

      const activeSigner = await manager.importSigner({
        fid: TEST_FID,
        privateKey: KNOWN_PRIVATE_KEY,
        appName: 'Active',
        status: 'active',
      })
      await new Promise((resolve) => setTimeout(resolve, 2))

      await manager.createSigner({ fid: TEST_FID, appName: 'Pending2' })

      const active = await manager.getActiveSignerForFid(TEST_FID)

      expect(active).not.toBeNull()
      expect(active?.keyId).toBe(activeSigner.keyId)
    })
  })

  describe('sign', () => {
    it('throws for non-existent signer', async () => {
      const message = new Uint8Array([1, 2, 3])

      await expect(manager.sign('non-existent', message)).rejects.toThrow(
        'not found',
      )
    })

    it('throws for non-active signer', async () => {
      const signer = await manager.createSigner({
        fid: TEST_FID,
        appName: TEST_APP_NAME,
      }) // pending by default

      const message = new Uint8Array([1, 2, 3])

      await expect(manager.sign(signer.keyId, message)).rejects.toThrow(
        'not active',
      )
    })

    it('produces valid Ed25519 signature', async () => {
      const signer = await manager.importSigner({
        fid: TEST_FID,
        privateKey: KNOWN_PRIVATE_KEY,
        appName: TEST_APP_NAME,
        status: 'active',
      })

      const message = new Uint8Array([1, 2, 3, 4, 5])
      const signature = await manager.sign(signer.keyId, message)

      expect(signature.length).toBe(64)

      // Verify signature is valid
      const publicKey = hexToBytes(signer.publicKey.slice(2))
      const isValid = ed25519.verify(signature, message, publicKey)
      expect(isValid).toBe(true)
    })

    it('produces deterministic signatures', async () => {
      const signer = await manager.importSigner({
        fid: TEST_FID,
        privateKey: KNOWN_PRIVATE_KEY,
        appName: TEST_APP_NAME,
        status: 'active',
      })

      const message = new Uint8Array([10, 20, 30])

      const sig1 = await manager.sign(signer.keyId, message)
      const sig2 = await manager.sign(signer.keyId, message)

      expect(bytesToHex(sig1)).toBe(bytesToHex(sig2))
    })

    it('produces different signatures for different messages', async () => {
      const signer = await manager.importSigner({
        fid: TEST_FID,
        privateKey: KNOWN_PRIVATE_KEY,
        appName: TEST_APP_NAME,
        status: 'active',
      })

      const msg1 = new Uint8Array([1, 2, 3])
      const msg2 = new Uint8Array([4, 5, 6])

      const sig1 = await manager.sign(signer.keyId, msg1)
      const sig2 = await manager.sign(signer.keyId, msg2)

      expect(bytesToHex(sig1)).not.toBe(bytesToHex(sig2))
    })
  })

  describe('markApproved', () => {
    it('changes status to active', async () => {
      const signer = await manager.createSigner({
        fid: TEST_FID,
        appName: TEST_APP_NAME,
      })

      expect(signer.status).toBe('pending')

      await manager.markApproved(signer.keyId)

      const updated = await manager.getSigner(signer.keyId)
      expect(updated?.status).toBe('active')
    })

    it('sets approvedAt timestamp', async () => {
      const signer = await manager.createSigner({
        fid: TEST_FID,
        appName: TEST_APP_NAME,
      })

      expect(signer.approvedAt).toBeUndefined()

      const before = Date.now()
      await manager.markApproved(signer.keyId)
      const after = Date.now()

      const updated = await manager.getSigner(signer.keyId)
      expect(updated?.approvedAt).toBeGreaterThanOrEqual(before)
      expect(updated?.approvedAt).toBeLessThanOrEqual(after)
    })

    it('throws for non-existent signer', async () => {
      await expect(manager.markApproved('non-existent')).rejects.toThrow(
        'not found',
      )
    })
  })

  describe('revokeSigner', () => {
    it('changes status to revoked', async () => {
      const signer = await manager.importSigner({
        fid: TEST_FID,
        privateKey: KNOWN_PRIVATE_KEY,
        appName: TEST_APP_NAME,
        status: 'active',
      })

      await manager.revokeSigner(signer.keyId)

      const updated = await manager.getSigner(signer.keyId)
      expect(updated?.status).toBe('revoked')
    })

    it('sets revokedAt timestamp', async () => {
      const signer = await manager.importSigner({
        fid: TEST_FID,
        privateKey: KNOWN_PRIVATE_KEY,
        appName: TEST_APP_NAME,
        status: 'active',
      })

      const before = Date.now()
      await manager.revokeSigner(signer.keyId)
      const after = Date.now()

      const updated = await manager.getSigner(signer.keyId)
      expect(updated?.revokedAt).toBeGreaterThanOrEqual(before)
      expect(updated?.revokedAt).toBeLessThanOrEqual(after)
    })

    it('prevents signing with revoked signer', async () => {
      const signer = await manager.importSigner({
        fid: TEST_FID,
        privateKey: KNOWN_PRIVATE_KEY,
        appName: TEST_APP_NAME,
        status: 'active',
      })

      // Verify signing works before revocation
      const message = new Uint8Array([1, 2, 3])
      const sig = await manager.sign(signer.keyId, message)
      expect(sig.length).toBe(64)

      // Revoke
      await manager.revokeSigner(signer.keyId)

      // Signing should now fail
      await expect(manager.sign(signer.keyId, message)).rejects.toThrow(
        'not active',
      )
    })

    it('throws for non-existent signer', async () => {
      await expect(manager.revokeSigner('non-existent')).rejects.toThrow(
        'not found',
      )
    })
  })

  describe('deleteSigner', () => {
    it('removes signer from manager', async () => {
      const signer = await manager.createSigner({
        fid: TEST_FID,
        appName: TEST_APP_NAME,
      })

      await manager.deleteSigner(signer.keyId)

      const retrieved = await manager.getSigner(signer.keyId)
      expect(retrieved).toBeNull()
    })

    it('handles deletion of non-existent signer', async () => {
      // Should not throw
      await manager.deleteSigner('non-existent')
    })
  })

  describe('getSignerPrivateKey', () => {
    it('returns null for non-existent signer', async () => {
      const key = await manager.getSignerPrivateKey('non-existent')
      expect(key).toBeNull()
    })

    it('returns null for non-active signer', async () => {
      const signer = await manager.createSigner({
        fid: TEST_FID,
        appName: TEST_APP_NAME,
      }) // pending

      const key = await manager.getSignerPrivateKey(signer.keyId)
      expect(key).toBeNull()
    })

    it('returns private key for active signer', async () => {
      const signer = await manager.importSigner({
        fid: TEST_FID,
        privateKey: KNOWN_PRIVATE_KEY,
        appName: TEST_APP_NAME,
        status: 'active',
      })

      const key = await manager.getSignerPrivateKey(signer.keyId)

      expect(key).not.toBeNull()
      expect(key).toBeDefined()
      if (key) {
        expect(bytesToHex(key)).toBe(bytesToHex(KNOWN_PRIVATE_KEY))
      }
    })
  })

  describe('getSignerPublicKeyBytes', () => {
    it('throws for non-existent signer', async () => {
      await expect(
        manager.getSignerPublicKeyBytes('non-existent'),
      ).rejects.toThrow('not found')
    })

    it('returns public key as bytes', async () => {
      const signer = await manager.importSigner({
        fid: TEST_FID,
        privateKey: KNOWN_PRIVATE_KEY,
        appName: TEST_APP_NAME,
      })

      const bytes = await manager.getSignerPublicKeyBytes(signer.keyId)

      expect(bytes.length).toBe(32)
      // Verify public key matches what we get from the signer info
      const signerInfo = await manager.getSigner(signer.keyId)
      expect(bytesToHex(bytes)).toBe(signerInfo?.publicKey.slice(2))
    })
  })

  describe('listSigners', () => {
    it('returns empty array initially', async () => {
      const signers = await manager.listSigners()
      expect(signers).toEqual([])
    })

    it('returns all signers', async () => {
      await manager.createSigner({ fid: 1, appName: 'App1' })
      await manager.createSigner({ fid: 2, appName: 'App2' })
      await manager.createSigner({ fid: 3, appName: 'App3' })

      const signers = await manager.listSigners()
      expect(signers).toHaveLength(3)
    })
  })

  describe('exportSigner', () => {
    it('throws for non-existent signer', async () => {
      await expect(manager.exportSigner('non-existent')).rejects.toThrow(
        'not found',
      )
    })

    it('exports signer with all fields', async () => {
      const signer = await manager.importSigner({
        fid: TEST_FID,
        privateKey: KNOWN_PRIVATE_KEY,
        appName: TEST_APP_NAME,
      })

      const exported = await manager.exportSigner(signer.keyId)

      expect(exported.fid).toBe(TEST_FID)
      expect(exported.appName).toBe(TEST_APP_NAME)
      // Verify the exported public key matches what was stored
      expect(exported.publicKey).toBe(signer.publicKey)
      // The private key should be valid hex
      expect(exported.privateKey.startsWith('0x')).toBe(true)
      expect(exported.privateKey.length).toBe(66) // 0x + 64 hex chars = 32 bytes
    })
  })
})
describe('Ed25519 Signature Properties', () => {
  let manager: FarcasterSignerManager
  let activeSigner: SignerInfo

  beforeEach(async () => {
    manager = new FarcasterSignerManager({ storage: 'memory' })
    activeSigner = await manager.importSigner({
      fid: TEST_FID,
      privateKey: KNOWN_PRIVATE_KEY,
      appName: TEST_APP_NAME,
      status: 'active',
    })
  })

  it('signature format is 64 bytes (r || s)', async () => {
    const message = new Uint8Array(32).fill(0x42)
    const sig = await manager.sign(activeSigner.keyId, message)

    expect(sig.length).toBe(64)
  })

  it('signatures are non-malleable', async () => {
    const message = new Uint8Array([1, 2, 3, 4, 5])
    const sig = await manager.sign(activeSigner.keyId, message)

    // Ed25519 signatures are deterministic - same message always produces same signature
    const sig2 = await manager.sign(activeSigner.keyId, message)

    expect(bytesToHex(sig)).toBe(bytesToHex(sig2))
  })

  it('empty message can be signed', async () => {
    const empty = new Uint8Array(0)
    const sig = await manager.sign(activeSigner.keyId, empty)

    expect(sig.length).toBe(64)

    const publicKey = await manager.getSignerPublicKeyBytes(activeSigner.keyId)
    expect(ed25519.verify(sig, empty, publicKey)).toBe(true)
  })

  it('large messages can be signed', async () => {
    const large = new Uint8Array(1000000) // 1MB
    for (let i = 0; i < large.length; i++) {
      large[i] = i % 256
    }

    const sig = await manager.sign(activeSigner.keyId, large)
    expect(sig.length).toBe(64)

    const publicKey = await manager.getSignerPublicKeyBytes(activeSigner.keyId)
    expect(ed25519.verify(sig, large, publicKey)).toBe(true)
  })

  it('single bit change invalidates signature', async () => {
    const message = new Uint8Array([1, 2, 3, 4, 5])
    const sig = await manager.sign(activeSigner.keyId, message)

    // Flip one bit in signature
    const tamperedSig = new Uint8Array(sig)
    tamperedSig[0] ^= 1

    const publicKey = await manager.getSignerPublicKeyBytes(activeSigner.keyId)
    expect(ed25519.verify(tamperedSig, message, publicKey)).toBe(false)
  })

  it('wrong message invalidates signature', async () => {
    const message = new Uint8Array([1, 2, 3, 4, 5])
    const sig = await manager.sign(activeSigner.keyId, message)

    const wrongMessage = new Uint8Array([1, 2, 3, 4, 6]) // Last byte different

    const publicKey = await manager.getSignerPublicKeyBytes(activeSigner.keyId)
    expect(ed25519.verify(sig, wrongMessage, publicKey)).toBe(false)
  })
})
describe('Property-Based Tests', () => {
  it('created signers always have valid key pairs', async () => {
    const manager = new FarcasterSignerManager({ storage: 'memory' })

    for (let i = 0; i < 20; i++) {
      const signer = await manager.createSigner({
        fid: i + 1,
        appName: `App${i}`,
      })

      // Mark as active to test signing
      await manager.markApproved(signer.keyId)

      // Sign a random message
      const message = new Uint8Array(32)
      for (let j = 0; j < 32; j++) {
        message[j] = Math.floor(Math.random() * 256)
      }

      const sig = await manager.sign(signer.keyId, message)
      expect(sig.length).toBe(64)

      // Verify signature
      const publicKey = await manager.getSignerPublicKeyBytes(signer.keyId)
      expect(ed25519.verify(sig, message, publicKey)).toBe(true)
    }
  })

  it('imported signers produce verifiable signatures', async () => {
    const manager = new FarcasterSignerManager({ storage: 'memory' })

    for (let i = 0; i < 10; i++) {
      // Generate random key
      const privateKey = new Uint8Array(32)
      for (let j = 0; j < 32; j++) {
        privateKey[j] = Math.floor(Math.random() * 256)
      }

      const signer = await manager.importSigner({
        fid: i + 1,
        privateKey,
        appName: `Import${i}`,
        status: 'active',
      })

      const message = new Uint8Array([1, 2, 3, i])
      const sig = await manager.sign(signer.keyId, message)

      const publicKey = await manager.getSignerPublicKeyBytes(signer.keyId)
      expect(ed25519.verify(sig, message, publicKey)).toBe(true)
    }
  })
})
