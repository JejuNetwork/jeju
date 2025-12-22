/**
 * Email Encryption Unit Tests
 *
 * Tests cryptographic operations:
 * - Key generation
 * - ECDH key derivation
 * - AES-256-GCM encryption/decryption
 * - Multi-recipient encryption
 */

import { describe, expect, test } from 'bun:test'
import {
  decryptEmail,
  decryptFromMultipleRecipients,
  deriveSharedSecret,
  type EncryptedEmail,
  encryptEmail,
  encryptForMultipleRecipients,
  generateKeyPair,
} from '../src/email/encryption'

describe('Email Encryption', () => {
  describe('generateKeyPair', () => {
    test('generates proper secp256k1 key pair', () => {
      const keyPair = generateKeyPair()

      expect(keyPair.publicKey).toBeInstanceOf(Uint8Array)
      expect(keyPair.privateKey).toBeInstanceOf(Uint8Array)
      // secp256k1 uncompressed public key: 65 bytes (04 prefix + 32 x + 32 y)
      expect(keyPair.publicKey.length).toBe(65)
      // Private key: 32 bytes
      expect(keyPair.privateKey.length).toBe(32)
    })

    test('generates unique keys each time', () => {
      const keyPair1 = generateKeyPair()
      const keyPair2 = generateKeyPair()

      // Keys should be different
      const key1Hex = Buffer.from(keyPair1.privateKey).toString('hex')
      const key2Hex = Buffer.from(keyPair2.privateKey).toString('hex')
      expect(key1Hex).not.toBe(key2Hex)
    })

    test('generates 1000 unique keys (fuzzing)', () => {
      const keys = new Set<string>()

      for (let i = 0; i < 1000; i++) {
        const keyPair = generateKeyPair()
        const keyHex = Buffer.from(keyPair.privateKey).toString('hex')
        keys.add(keyHex)
      }

      // All 1000 keys should be unique
      expect(keys.size).toBe(1000)
    })
  })

  describe('deriveSharedSecret', () => {
    test('derives 32-byte secret', () => {
      const alice = generateKeyPair()
      const bob = generateKeyPair()

      const secret = deriveSharedSecret(alice.privateKey, bob.publicKey)

      expect(secret).toBeInstanceOf(Uint8Array)
      expect(secret.length).toBe(32)
    })

    test('produces deterministic output for same inputs', () => {
      const alice = generateKeyPair()
      const bob = generateKeyPair()

      const secret1 = deriveSharedSecret(alice.privateKey, bob.publicKey)
      const secret2 = deriveSharedSecret(alice.privateKey, bob.publicKey)

      const hex1 = Buffer.from(secret1).toString('hex')
      const hex2 = Buffer.from(secret2).toString('hex')
      expect(hex1).toBe(hex2)
    })

    test('different key pairs produce different secrets', () => {
      const alice = generateKeyPair()
      const bob = generateKeyPair()
      const charlie = generateKeyPair()

      const aliceBobSecret = deriveSharedSecret(alice.privateKey, bob.publicKey)
      const aliceCharlieSecret = deriveSharedSecret(
        alice.privateKey,
        charlie.publicKey,
      )

      const abHex = Buffer.from(aliceBobSecret).toString('hex')
      const acHex = Buffer.from(aliceCharlieSecret).toString('hex')
      expect(abHex).not.toBe(acHex)
    })

    test('ECDH is commutative (proper Diffie-Hellman)', () => {
      const alice = generateKeyPair()
      const bob = generateKeyPair()

      const secret1 = deriveSharedSecret(alice.privateKey, bob.publicKey)
      const secret2 = deriveSharedSecret(bob.privateKey, alice.publicKey)

      // Proper ECDH: Alice(priv) + Bob(pub) == Bob(priv) + Alice(pub)
      const hex1 = Buffer.from(secret1).toString('hex')
      const hex2 = Buffer.from(secret2).toString('hex')
      expect(hex1).toBe(hex2)
    })
  })

  describe('encryptEmail / decryptEmail', () => {
    test('encrypted output has correct structure', () => {
      const recipient = generateKeyPair()
      const message = 'Test message'

      const encrypted = encryptEmail(message, recipient.publicKey)

      expect(encrypted.ciphertext).toMatch(/^0x[a-f0-9]+$/)
      expect(encrypted.nonce).toMatch(/^0x[a-f0-9]+$/)
      expect(encrypted.ephemeralPublicKey).toMatch(/^0x[a-f0-9]+$/)
      expect(encrypted.tag).toMatch(/^0x[a-f0-9]+$/)
    })

    test('nonce is 12 bytes (24 hex chars)', () => {
      const recipient = generateKeyPair()
      const message = 'Test'

      const encrypted = encryptEmail(message, recipient.publicKey)

      // 0x + 24 hex chars = 26 total
      expect(encrypted.nonce.length).toBe(26)
    })

    test('tag is 16 bytes (32 hex chars)', () => {
      const recipient = generateKeyPair()
      const message = 'Test'

      const encrypted = encryptEmail(message, recipient.publicKey)

      // 0x + 32 hex chars = 34 total
      expect(encrypted.tag.length).toBe(34)
    })

    test('ephemeral public key is 65 bytes (130 hex chars) - uncompressed secp256k1', () => {
      const recipient = generateKeyPair()
      const message = 'Test'

      const encrypted = encryptEmail(message, recipient.publicKey)

      // 0x + 130 hex chars = 132 total (65 bytes uncompressed)
      expect(encrypted.ephemeralPublicKey.length).toBe(132)
    })

    test('decryption fails with wrong key', () => {
      const recipient = generateKeyPair()
      const wrongKey = generateKeyPair()
      const message = 'Secret message'

      const encrypted = encryptEmail(message, recipient.publicKey)

      expect(() => {
        decryptEmail(encrypted, wrongKey.privateKey)
      }).toThrow()
    })

    test('ciphertext differs for same plaintext (due to random nonce)', () => {
      const recipient = generateKeyPair()
      const message = 'Same message'

      const encrypted1 = encryptEmail(message, recipient.publicKey)
      const encrypted2 = encryptEmail(message, recipient.publicKey)

      // Ciphertexts should differ due to random nonce and ephemeral key
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext)
      expect(encrypted1.nonce).not.toBe(encrypted2.nonce)
      expect(encrypted1.ephemeralPublicKey).not.toBe(
        encrypted2.ephemeralPublicKey,
      )
    })

    test('ciphertext length scales with message length', () => {
      const recipient = generateKeyPair()

      const short = encryptEmail('Hi', recipient.publicKey)
      const long = encryptEmail('A'.repeat(1000), recipient.publicKey)

      // Longer message = longer ciphertext
      expect(long.ciphertext.length).toBeGreaterThan(short.ciphertext.length)
    })

    test('detects tampering with ciphertext', () => {
      const recipient = generateKeyPair()
      const message = 'Important message'

      const encrypted = encryptEmail(message, recipient.publicKey)

      // Tamper with ciphertext
      const tamperedCiphertext = (encrypted.ciphertext.slice(0, -2) +
        '00') as `0x${string}`
      const tampered: EncryptedEmail = {
        ...encrypted,
        ciphertext: tamperedCiphertext,
      }

      expect(() => {
        decryptEmail(tampered, recipient.privateKey)
      }).toThrow()
    })

    test('detects tampering with auth tag', () => {
      const recipient = generateKeyPair()
      const message = 'Important message'

      const encrypted = encryptEmail(message, recipient.publicKey)

      // Tamper with tag
      const tamperedTag = `${encrypted.tag.slice(0, -2)}00` as `0x${string}`
      const tampered: EncryptedEmail = {
        ...encrypted,
        tag: tamperedTag,
      }

      expect(() => {
        decryptEmail(tampered, recipient.privateKey)
      }).toThrow()
    })

    test('encryption is deterministic with same ephemeral key (structure)', () => {
      // While ephemeral keys are random, we can verify structure consistency
      const recipient = generateKeyPair()

      for (let i = 0; i < 10; i++) {
        const encrypted = encryptEmail('Test message', recipient.publicKey)

        // All encryptions should have valid structure
        expect(encrypted.ciphertext.startsWith('0x')).toBe(true)
        expect(encrypted.nonce.length).toBe(26)
        expect(encrypted.tag.length).toBe(34)
        // Uncompressed secp256k1 public key: 65 bytes = 130 hex chars + 0x = 132
        expect(encrypted.ephemeralPublicKey.length).toBe(132)
      }
    })

    test('round-trip encryption/decryption works', () => {
      const recipient = generateKeyPair()
      const message = 'Hello, secure world!'

      const encrypted = encryptEmail(message, recipient.publicKey)
      const decrypted = decryptEmail(encrypted, recipient.privateKey)

      expect(decrypted).toBe(message)
    })

    test('round-trip works with various message lengths', () => {
      const recipient = generateKeyPair()
      const testMessages = [
        '',
        'a',
        'Hello',
        'A'.repeat(100),
        'B'.repeat(1000),
        'Unicode: 你好世界 🌍',
      ]

      for (const message of testMessages) {
        const encrypted = encryptEmail(message, recipient.publicKey)
        const decrypted = decryptEmail(encrypted, recipient.privateKey)
        expect(decrypted).toBe(message)
      }
    })
  })

  describe('encryptForMultipleRecipients / decryptFromMultipleRecipients', () => {
    test('encrypts for multiple recipients', () => {
      const alice = generateKeyPair()
      const bob = generateKeyPair()
      const charlie = generateKeyPair()

      const recipients = new Map<string, Uint8Array>([
        ['alice', alice.publicKey],
        ['bob', bob.publicKey],
        ['charlie', charlie.publicKey],
      ])

      const message = 'Group message'

      const result = encryptForMultipleRecipients(message, recipients)

      expect(result.encryptedContent).toBeDefined()
      expect(result.recipientKeys.size).toBe(3)
      expect(result.recipientKeys.has('alice')).toBe(true)
      expect(result.recipientKeys.has('bob')).toBe(true)
      expect(result.recipientKeys.has('charlie')).toBe(true)
    })

    test("wrong recipient cannot decrypt with another's key package", () => {
      const alice = generateKeyPair()
      const bob = generateKeyPair()
      const eve = generateKeyPair() // Attacker

      const recipients = new Map<string, Uint8Array>([
        ['alice', alice.publicKey],
        ['bob', bob.publicKey],
      ])

      const message = 'Secret message'

      const result = encryptForMultipleRecipients(message, recipients)

      // Eve tries to use Alice's key package with her own private key
      const aliceKey = result.recipientKeys.get('alice')
      expect(aliceKey).toBeDefined()

      expect(() => {
        decryptFromMultipleRecipients(
          result.encryptedContent,
          aliceKey!,
          eve.privateKey,
        )
      }).toThrow()
    })

    test('handles single recipient structure', () => {
      const alice = generateKeyPair()

      const recipients = new Map<string, Uint8Array>([
        ['alice', alice.publicKey],
      ])

      const message = 'Just for Alice'

      const result = encryptForMultipleRecipients(message, recipients)

      expect(result.recipientKeys.size).toBe(1)
      expect(result.recipientKeys.has('alice')).toBe(true)
      expect(result.encryptedContent.ciphertext.startsWith('0x')).toBe(true)
    })

    test('handles many recipients (10) structure', () => {
      const recipients = new Map<string, Uint8Array>()

      for (let i = 0; i < 10; i++) {
        const kp = generateKeyPair()
        recipients.set(`recipient${i}`, kp.publicKey)
      }

      const message = 'Message for 10 recipients'

      const result = encryptForMultipleRecipients(message, recipients)

      expect(result.recipientKeys.size).toBe(10)
      for (let i = 0; i < 10; i++) {
        expect(result.recipientKeys.has(`recipient${i}`)).toBe(true)
      }
    })

    test('recipient keys are unique per recipient', () => {
      const alice = generateKeyPair()
      const bob = generateKeyPair()

      const recipients = new Map<string, Uint8Array>([
        ['alice', alice.publicKey],
        ['bob', bob.publicKey],
      ])

      const result = encryptForMultipleRecipients('Message', recipients)

      const aliceKey = result.recipientKeys.get('alice')
      const bobKey = result.recipientKeys.get('bob')

      expect(aliceKey).not.toBe(bobKey)
    })

    test('different encryptions produce different outputs', () => {
      const alice = generateKeyPair()

      const recipients = new Map<string, Uint8Array>([
        ['alice', alice.publicKey],
      ])

      const message = 'Same message'

      const result1 = encryptForMultipleRecipients(message, recipients)
      const result2 = encryptForMultipleRecipients(message, recipients)

      // Ciphertexts should differ due to random keys
      expect(result1.encryptedContent.ciphertext).not.toBe(
        result2.encryptedContent.ciphertext,
      )
    })

    test('recipient key packages have expected length', () => {
      const alice = generateKeyPair()

      const recipients = new Map<string, Uint8Array>([
        ['alice', alice.publicKey],
      ])

      const result = encryptForMultipleRecipients('Test message', recipients)

      const aliceKey = result.recipientKeys.get('alice')
      expect(aliceKey).toBeDefined()
      expect(aliceKey!.startsWith('0x')).toBe(true)
      // Key package = 12 (nonce) + 32 (encrypted key) + 16 (tag) + 65 (uncompressed ephemeral key) = 125 bytes = 250 hex + 2 (0x)
      expect(aliceKey!.length).toBe(252)
    })

    test('multi-recipient round-trip encryption/decryption works', () => {
      const alice = generateKeyPair()
      const bob = generateKeyPair()

      const recipients = new Map<string, Uint8Array>([
        ['alice', alice.publicKey],
        ['bob', bob.publicKey],
      ])

      const message = 'Multi-recipient secret message'

      const result = encryptForMultipleRecipients(message, recipients)

      // Alice can decrypt
      const aliceKey = result.recipientKeys.get('alice')!
      const aliceDecrypted = decryptFromMultipleRecipients(
        result.encryptedContent,
        aliceKey,
        alice.privateKey,
      )
      expect(aliceDecrypted).toBe(message)

      // Bob can also decrypt
      const bobKey = result.recipientKeys.get('bob')!
      const bobDecrypted = decryptFromMultipleRecipients(
        result.encryptedContent,
        bobKey,
        bob.privateKey,
      )
      expect(bobDecrypted).toBe(message)
    })
  })
})
