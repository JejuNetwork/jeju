/**
 * Comprehensive Crypto Unit Tests
 *
 * Tests for X25519 key exchange, AES-256-GCM encryption, key derivation,
 * and message serialization.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha256'
import {
  bytes32ToPublicKey,
  createMessageEnvelope,
  decryptMessage,
  decryptMessageToString,
  deriveKeyPairFromWallet,
  derivePublicKey,
  deserializeEncryptedMessage,
  type EncryptedMessage,
  encryptMessage,
  generateKeyPair,
  generateKeyPairFromSeed,
  generateMessageId,
  hashContent,
  hexToPublicKey,
  type KeyPair,
  publicKeysEqual,
  publicKeyToBytes32,
  publicKeyToHex,
  serializeEncryptedMessage,
} from '../sdk/crypto'

describe('Key Generation', () => {
  test('generates valid X25519 key pair', () => {
    const keyPair = generateKeyPair()

    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array)
    expect(keyPair.privateKey).toBeInstanceOf(Uint8Array)
    expect(keyPair.publicKey.length).toBe(32)
    expect(keyPair.privateKey.length).toBe(32)
  })

  test('generates unique key pairs each time', () => {
    const keyPair1 = generateKeyPair()
    const keyPair2 = generateKeyPair()

    // Public keys should be different
    expect(publicKeysEqual(keyPair1.publicKey, keyPair2.publicKey)).toBe(false)
    // Private keys should also be different
    expect(publicKeysEqual(keyPair1.privateKey, keyPair2.privateKey)).toBe(
      false,
    )
  })

  test('derives correct public key from private key', () => {
    const keyPair = generateKeyPair()
    const derivedPublic = derivePublicKey(keyPair.privateKey)

    expect(publicKeysEqual(derivedPublic, keyPair.publicKey)).toBe(true)
  })

  test('generates deterministic key pair from seed', () => {
    const seed = new Uint8Array(32).fill(42)

    const keyPair1 = generateKeyPairFromSeed(seed)
    const keyPair2 = generateKeyPairFromSeed(seed)

    expect(publicKeysEqual(keyPair1.publicKey, keyPair2.publicKey)).toBe(true)
    expect(publicKeysEqual(keyPair1.privateKey, keyPair2.privateKey)).toBe(true)
  })

  test('different seeds produce different key pairs', () => {
    const seed1 = new Uint8Array(32).fill(1)
    const seed2 = new Uint8Array(32).fill(2)

    const keyPair1 = generateKeyPairFromSeed(seed1)
    const keyPair2 = generateKeyPairFromSeed(seed2)

    expect(publicKeysEqual(keyPair1.publicKey, keyPair2.publicKey)).toBe(false)
  })
})
describe('Wallet Key Derivation', () => {
  test('derives deterministic keys from wallet address and signature', () => {
    const walletAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const signature =
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12'

    const keyPair1 = deriveKeyPairFromWallet(walletAddress, signature)
    const keyPair2 = deriveKeyPairFromWallet(walletAddress, signature)

    expect(publicKeysEqual(keyPair1.publicKey, keyPair2.publicKey)).toBe(true)
    expect(publicKeysEqual(keyPair1.privateKey, keyPair2.privateKey)).toBe(true)
  })

  test('address case is normalized (lowercase)', () => {
    const signature = '0xabcdef'

    const keyPair1 = deriveKeyPairFromWallet(
      '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
      signature,
    )
    const keyPair2 = deriveKeyPairFromWallet(
      '0xabcdef1234567890abcdef1234567890abcdef12',
      signature,
    )

    expect(publicKeysEqual(keyPair1.publicKey, keyPair2.publicKey)).toBe(true)
  })

  test('different addresses produce different keys', () => {
    const signature = '0x1234'

    const keyPair1 = deriveKeyPairFromWallet(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      signature,
    )
    const keyPair2 = deriveKeyPairFromWallet(
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      signature,
    )

    expect(publicKeysEqual(keyPair1.publicKey, keyPair2.publicKey)).toBe(false)
  })

  test('different signatures produce different keys', () => {
    const address = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

    const keyPair1 = deriveKeyPairFromWallet(address, '0xsig1')
    const keyPair2 = deriveKeyPairFromWallet(address, '0xsig2')

    expect(publicKeysEqual(keyPair1.publicKey, keyPair2.publicKey)).toBe(false)
  })
})
describe('Encryption and Decryption', () => {
  let sender: KeyPair
  let recipient: KeyPair

  beforeEach(() => {
    sender = generateKeyPair()
    recipient = generateKeyPair()
  })

  test('encrypts and decrypts string message correctly', () => {
    const originalMessage = 'Hello, World!'

    const encrypted = encryptMessage(
      originalMessage,
      recipient.publicKey,
      sender.privateKey,
    )
    const decrypted = decryptMessageToString(encrypted, recipient.privateKey)

    expect(decrypted).toBe(originalMessage)
  })

  test('encrypts and decrypts binary message correctly', () => {
    const originalMessage = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128])

    const encrypted = encryptMessage(
      originalMessage,
      recipient.publicKey,
      sender.privateKey,
    )
    const decrypted = decryptMessage(encrypted, recipient.privateKey)

    expect(new Uint8Array(decrypted)).toEqual(originalMessage)
  })

  test('encrypts empty string', () => {
    const originalMessage = ''

    const encrypted = encryptMessage(originalMessage, recipient.publicKey)
    const decrypted = decryptMessageToString(encrypted, recipient.privateKey)

    expect(decrypted).toBe(originalMessage)
  })

  test('encrypts large message (1MB)', () => {
    const largeMessage = new Uint8Array(1024 * 1024)
    for (let i = 0; i < largeMessage.length; i++) {
      largeMessage[i] = i % 256
    }

    const encrypted = encryptMessage(largeMessage, recipient.publicKey)
    const decrypted = decryptMessage(encrypted, recipient.privateKey)

    expect(new Uint8Array(decrypted)).toEqual(largeMessage)
  })

  test('encrypts message with unicode characters', () => {
    const unicodeMessage = '你好世界 🎉 مرحبا العالم'

    const encrypted = encryptMessage(unicodeMessage, recipient.publicKey)
    const decrypted = decryptMessageToString(encrypted, recipient.privateKey)

    expect(decrypted).toBe(unicodeMessage)
  })

  test('encrypts message with newlines and special characters', () => {
    const specialMessage = 'Line1\nLine2\r\nLine3\t\x00\x01'

    const encrypted = encryptMessage(specialMessage, recipient.publicKey)
    const decrypted = decryptMessageToString(encrypted, recipient.privateKey)

    expect(decrypted).toBe(specialMessage)
  })

  test('produces different ciphertext for same message (random nonce)', () => {
    const message = 'Same message'

    const encrypted1 = encryptMessage(message, recipient.publicKey)
    const encrypted2 = encryptMessage(message, recipient.publicKey)

    // Ciphertexts should be different due to random nonce
    expect(encrypted1.ciphertext).not.toEqual(encrypted2.ciphertext)
    expect(encrypted1.nonce).not.toEqual(encrypted2.nonce)

    // But both should decrypt to same message
    expect(decryptMessageToString(encrypted1, recipient.privateKey)).toBe(
      message,
    )
    expect(decryptMessageToString(encrypted2, recipient.privateKey)).toBe(
      message,
    )
  })

  test('uses ephemeral key pair when sender key not provided', () => {
    const message = 'Test message'

    const encrypted1 = encryptMessage(message, recipient.publicKey)
    const encrypted2 = encryptMessage(message, recipient.publicKey)

    // Ephemeral public keys should be different
    expect(encrypted1.ephemeralPublicKey).not.toEqual(
      encrypted2.ephemeralPublicKey,
    )
  })

  test('decryption fails with wrong private key', () => {
    const message = 'Secret message'
    const wrongRecipient = generateKeyPair()

    const encrypted = encryptMessage(message, recipient.publicKey)

    expect(() => {
      decryptMessage(encrypted, wrongRecipient.privateKey)
    }).toThrow()
  })

  test('decryption fails with tampered ciphertext', () => {
    const message = 'Do not tamper'

    const encrypted = encryptMessage(message, recipient.publicKey)

    // Tamper with ciphertext
    const tampered: EncryptedMessage = {
      ...encrypted,
      ciphertext: new Uint8Array(
        encrypted.ciphertext.map((b, i) => (i === 0 ? b ^ 1 : b)),
      ),
    }

    expect(() => {
      decryptMessage(tampered, recipient.privateKey)
    }).toThrow()
  })

  test('decryption fails with tampered nonce', () => {
    const message = 'Do not tamper'

    const encrypted = encryptMessage(message, recipient.publicKey)

    // Tamper with nonce
    const tampered: EncryptedMessage = {
      ...encrypted,
      nonce: new Uint8Array(
        encrypted.nonce.map((b, i) => (i === 0 ? b ^ 1 : b)),
      ),
    }

    expect(() => {
      decryptMessage(tampered, recipient.privateKey)
    }).toThrow()
  })
})
describe('Property-Based Encryption Tests', () => {
  test('encrypt/decrypt roundtrip for random strings', () => {
    const recipient = generateKeyPair()

    // Test 100 random strings
    for (let i = 0; i < 100; i++) {
      const length = Math.floor(Math.random() * 1000) + 1
      const randomBytes = new Uint8Array(length)
      crypto.getRandomValues(randomBytes)

      const encrypted = encryptMessage(randomBytes, recipient.publicKey)
      const decrypted = decryptMessage(encrypted, recipient.privateKey)

      expect(new Uint8Array(decrypted)).toEqual(randomBytes)
    }
  })

  test('encrypt/decrypt with random key pairs', () => {
    const message = 'Fixed test message'

    // Test 50 random key pairs
    for (let i = 0; i < 50; i++) {
      const recipient = generateKeyPair()
      const sender = generateKeyPair()

      const encrypted = encryptMessage(
        message,
        recipient.publicKey,
        sender.privateKey,
      )
      const decrypted = decryptMessageToString(encrypted, recipient.privateKey)

      expect(decrypted).toBe(message)
    }
  })

  test('encryption preserves message length patterns', () => {
    const recipient = generateKeyPair()

    const lengths = [
      0, 1, 15, 16, 17, 31, 32, 33, 127, 128, 129, 1023, 1024, 1025,
    ]

    for (const len of lengths) {
      const message = 'x'.repeat(len)
      const encrypted = encryptMessage(message, recipient.publicKey)
      const decrypted = decryptMessageToString(encrypted, recipient.privateKey)

      expect(decrypted.length).toBe(len)
    }
  })
})
describe('Message Serialization', () => {
  test('serializes and deserializes encrypted message', () => {
    const recipient = generateKeyPair()
    const message = 'Serialization test'

    const encrypted = encryptMessage(message, recipient.publicKey)
    const serialized = serializeEncryptedMessage(encrypted)
    const deserialized = deserializeEncryptedMessage(serialized)

    expect(deserialized.ciphertext).toEqual(encrypted.ciphertext)
    expect(deserialized.nonce).toEqual(encrypted.nonce)
    expect(deserialized.ephemeralPublicKey).toEqual(
      encrypted.ephemeralPublicKey,
    )

    // Verify can still decrypt
    const decrypted = decryptMessageToString(deserialized, recipient.privateKey)
    expect(decrypted).toBe(message)
  })

  test('serialized format is valid hex strings', () => {
    const recipient = generateKeyPair()
    const encrypted = encryptMessage('test', recipient.publicKey)
    const serialized = serializeEncryptedMessage(encrypted)

    expect(typeof serialized.ciphertext).toBe('string')
    expect(typeof serialized.nonce).toBe('string')
    expect(typeof serialized.ephemeralPublicKey).toBe('string')

    // All should be valid hex
    expect(serialized.ciphertext).toMatch(/^[a-f0-9]+$/i)
    expect(serialized.nonce).toMatch(/^[a-f0-9]+$/i)
    expect(serialized.ephemeralPublicKey).toMatch(/^[a-f0-9]+$/i)

    // Nonce should be 24 hex chars (12 bytes)
    expect(serialized.nonce.length).toBe(24)

    // Public key should be 64 hex chars (32 bytes)
    expect(serialized.ephemeralPublicKey.length).toBe(64)
  })

  test('serialized message is JSON-safe', () => {
    const recipient = generateKeyPair()
    const encrypted = encryptMessage('JSON safe test', recipient.publicKey)
    const serialized = serializeEncryptedMessage(encrypted)

    // Should survive JSON round-trip
    const jsonString = JSON.stringify(serialized)
    const parsed = JSON.parse(jsonString)
    const deserialized = deserializeEncryptedMessage(parsed)

    const decrypted = decryptMessageToString(deserialized, recipient.privateKey)
    expect(decrypted).toBe('JSON safe test')
  })
})
describe('Public Key Conversions', () => {
  test('publicKeyToHex and hexToPublicKey roundtrip', () => {
    const keyPair = generateKeyPair()

    const hex = publicKeyToHex(keyPair.publicKey)
    const recovered = hexToPublicKey(hex)

    expect(recovered).toEqual(keyPair.publicKey)
  })

  test('publicKeyToHex produces 64-char hex string', () => {
    const keyPair = generateKeyPair()
    const hex = publicKeyToHex(keyPair.publicKey)

    expect(hex.length).toBe(64)
    expect(hex).toMatch(/^[a-f0-9]+$/)
  })

  test('publicKeyToBytes32 and bytes32ToPublicKey roundtrip', () => {
    const keyPair = generateKeyPair()

    const bytes32 = publicKeyToBytes32(keyPair.publicKey)
    const recovered = bytes32ToPublicKey(bytes32)

    expect(recovered).toEqual(keyPair.publicKey)
  })

  test('bytes32 format is 0x-prefixed 64-char hex', () => {
    const keyPair = generateKeyPair()
    const bytes32 = publicKeyToBytes32(keyPair.publicKey)

    expect(bytes32.startsWith('0x')).toBe(true)
    expect(bytes32.length).toBe(66) // 0x + 64 chars
    expect(bytes32.slice(2)).toMatch(/^[a-f0-9]+$/)
  })
})
describe('Message ID Generation', () => {
  test('generates 32-char hex message ID', () => {
    const id = generateMessageId()

    expect(id.length).toBe(32)
    expect(id).toMatch(/^[a-f0-9]+$/)
  })

  test('generates unique IDs', () => {
    const ids = new Set<string>()

    for (let i = 0; i < 1000; i++) {
      ids.add(generateMessageId())
    }

    expect(ids.size).toBe(1000)
  })
})
describe('Public Key Comparison', () => {
  test('equal keys return true', () => {
    const keyPair = generateKeyPair()

    expect(publicKeysEqual(keyPair.publicKey, keyPair.publicKey)).toBe(true)
  })

  test('different keys return false', () => {
    const keyPair1 = generateKeyPair()
    const keyPair2 = generateKeyPair()

    expect(publicKeysEqual(keyPair1.publicKey, keyPair2.publicKey)).toBe(false)
  })

  test('different length arrays return false', () => {
    const key1 = new Uint8Array(32).fill(1)
    const key2 = new Uint8Array(31).fill(1)

    expect(publicKeysEqual(key1, key2)).toBe(false)
  })

  test('single byte difference is detected', () => {
    const key1 = new Uint8Array(32).fill(0)
    const key2 = new Uint8Array(32).fill(0)
    key2[31] = 1

    expect(publicKeysEqual(key1, key2)).toBe(false)
  })
})
describe('Content Hashing', () => {
  test('produces 64-char hex hash', () => {
    const content = new TextEncoder().encode('Hash me!')
    const hash = hashContent(content)

    expect(hash.length).toBe(64)
    expect(hash).toMatch(/^[a-f0-9]+$/)
  })

  test('produces deterministic hash', () => {
    const content = new TextEncoder().encode('Deterministic')

    const hash1 = hashContent(content)
    const hash2 = hashContent(content)

    expect(hash1).toBe(hash2)
  })

  test('different content produces different hash', () => {
    const content1 = new TextEncoder().encode('Content 1')
    const content2 = new TextEncoder().encode('Content 2')

    expect(hashContent(content1)).not.toBe(hashContent(content2))
  })

  test('hash matches SHA-256', () => {
    const content = new TextEncoder().encode('SHA-256 test')
    const hash = hashContent(content)

    // Manually compute SHA-256 and compare
    const expected = Buffer.from(sha256(content)).toString('hex')
    expect(hash).toBe(expected)
  })
})
describe('Message Envelope', () => {
  test('creates envelope with encrypted content', () => {
    const recipient = generateKeyPair()
    const from = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const to = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const content = 'Envelope content'

    const envelope = createMessageEnvelope(
      from,
      to,
      content,
      recipient.publicKey,
    )

    expect(envelope.from).toBe(from)
    expect(envelope.to).toBe(to)
    expect(typeof envelope.id).toBe('string')
    expect(envelope.timestamp).toBeGreaterThan(0)
    expect(envelope.encryptedContent).toBeDefined()
    expect(envelope.encryptedContent.ciphertext).toBeDefined()
  })

  test('envelope content can be decrypted', () => {
    const recipient = generateKeyPair()
    const content = 'Secret envelope message'

    const envelope = createMessageEnvelope(
      '0xfrom',
      '0xto',
      content,
      recipient.publicKey,
    )

    const deserialized = deserializeEncryptedMessage(envelope.encryptedContent)
    const decrypted = decryptMessageToString(deserialized, recipient.privateKey)

    expect(decrypted).toBe(content)
  })

  test('envelope ID is unique', () => {
    const recipient = generateKeyPair()
    const ids = new Set<string>()

    for (let i = 0; i < 100; i++) {
      const envelope = createMessageEnvelope(
        'from',
        'to',
        'msg',
        recipient.publicKey,
      )
      ids.add(envelope.id)
    }

    expect(ids.size).toBe(100)
  })
})
describe('Edge Cases', () => {
  test('handles max-length hex string conversion', () => {
    // 32-byte key is the standard
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)

    const hex = publicKeyToHex(key)
    const bytes32 = publicKeyToBytes32(key)

    expect(hexToPublicKey(hex)).toEqual(key)
    expect(bytes32ToPublicKey(bytes32)).toEqual(key)
  })

  test('encryption with sender key uses consistent ephemeral key', () => {
    const sender = generateKeyPair()
    const recipient = generateKeyPair()
    const message = 'With sender key'

    const encrypted = encryptMessage(
      message,
      recipient.publicKey,
      sender.privateKey,
    )

    // Ephemeral public key should be sender's public key
    expect(encrypted.ephemeralPublicKey).toEqual(sender.publicKey)
  })

  test('seed-derived keys work with encryption', () => {
    const seed = new Uint8Array(32)
    crypto.getRandomValues(seed)

    const sender = generateKeyPairFromSeed(seed)
    const recipient = generateKeyPair()

    const message = 'Seed-derived sender'
    const encrypted = encryptMessage(
      message,
      recipient.publicKey,
      sender.privateKey,
    )
    const decrypted = decryptMessageToString(encrypted, recipient.privateKey)

    expect(decrypted).toBe(message)
  })

  test('handles binary data with null bytes', () => {
    const recipient = generateKeyPair()
    const binaryWithNulls = new Uint8Array([0, 1, 0, 2, 0, 3, 0, 0, 0])

    const encrypted = encryptMessage(binaryWithNulls, recipient.publicKey)
    const decrypted = decryptMessage(encrypted, recipient.privateKey)

    expect(new Uint8Array(decrypted)).toEqual(binaryWithNulls)
  })
})
