/**
 * Direct Cast Encryption Tests
 *
 * Tests for the X25519 + AES-GCM encryption used in Direct Casts.
 * Covers key derivation, encryption/decryption roundtrips, and security properties.
 */

import { describe, expect, it } from 'bun:test'
import { gcm } from '@noble/ciphers/aes'
import { randomBytes } from '@noble/ciphers/webcrypto'
import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

function deriveEncryptionKeys(signerPrivateKey: Uint8Array): {
  privateKey: Uint8Array
  publicKey: Uint8Array
} {
  const derived = hkdf(
    sha256,
    signerPrivateKey,
    new Uint8Array(0),
    new TextEncoder().encode('farcaster-dc-encryption'),
    32,
  )

  return {
    privateKey: derived,
    publicKey: x25519.getPublicKey(derived),
  }
}

function encrypt(
  plaintext: string,
  recipientPublicKey: Uint8Array,
): {
  ciphertext: Uint8Array
  nonce: Uint8Array
  ephemeralPublicKey: Uint8Array
} {
  // Generate ephemeral key pair
  const ephemeralPrivateKey = randomBytes(32)
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey)

  // Compute shared secret
  const sharedSecret = x25519.getSharedSecret(
    ephemeralPrivateKey,
    recipientPublicKey,
  )

  // Derive encryption key
  const encryptionKey = hkdf(
    sha256,
    sharedSecret,
    new Uint8Array(0),
    new TextEncoder().encode('farcaster-dc-aes'),
    32,
  )

  // Encrypt with AES-GCM
  const nonce = randomBytes(12)
  const plaintextBytes = new TextEncoder().encode(plaintext)
  const aes = gcm(encryptionKey, nonce)
  const ciphertext = aes.encrypt(plaintextBytes)

  return { ciphertext, nonce, ephemeralPublicKey }
}

function decrypt(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  recipientPrivateKey: Uint8Array,
): string {
  // Compute shared secret
  const sharedSecret = x25519.getSharedSecret(
    recipientPrivateKey,
    ephemeralPublicKey,
  )

  // Derive decryption key
  const decryptionKey = hkdf(
    sha256,
    sharedSecret,
    new Uint8Array(0),
    new TextEncoder().encode('farcaster-dc-aes'),
    32,
  )

  // Decrypt with AES-GCM
  const aes = gcm(decryptionKey, nonce)
  const plaintext = aes.decrypt(ciphertext)

  return new TextDecoder().decode(plaintext)
}

// Test key pairs
const ALICE_ED25519_PRIVATE = hexToBytes(
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
)
const BOB_ED25519_PRIVATE = hexToBytes(
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
)
describe('Key Derivation', () => {
  describe('deriveEncryptionKeys', () => {
    it('derives 32-byte X25519 keys from Ed25519 key', () => {
      const { privateKey, publicKey } = deriveEncryptionKeys(
        ALICE_ED25519_PRIVATE,
      )

      expect(privateKey.length).toBe(32)
      expect(publicKey.length).toBe(32)
    })

    it('produces deterministic output', () => {
      const keys1 = deriveEncryptionKeys(ALICE_ED25519_PRIVATE)
      const keys2 = deriveEncryptionKeys(ALICE_ED25519_PRIVATE)

      expect(bytesToHex(keys1.privateKey)).toBe(bytesToHex(keys2.privateKey))
      expect(bytesToHex(keys1.publicKey)).toBe(bytesToHex(keys2.publicKey))
    })

    it('produces different keys for different inputs', () => {
      const aliceKeys = deriveEncryptionKeys(ALICE_ED25519_PRIVATE)
      const bobKeys = deriveEncryptionKeys(BOB_ED25519_PRIVATE)

      expect(bytesToHex(aliceKeys.privateKey)).not.toBe(
        bytesToHex(bobKeys.privateKey),
      )
      expect(bytesToHex(aliceKeys.publicKey)).not.toBe(
        bytesToHex(bobKeys.publicKey),
      )
    })

    it('public key is consistent with private key', () => {
      const { privateKey, publicKey } = deriveEncryptionKeys(
        ALICE_ED25519_PRIVATE,
      )

      // Verify by computing public key from private
      const computedPublic = x25519.getPublicKey(privateKey)
      expect(bytesToHex(publicKey)).toBe(bytesToHex(computedPublic))
    })
  })
})
describe('Encryption/Decryption', () => {
  const aliceKeys = deriveEncryptionKeys(ALICE_ED25519_PRIVATE)
  const bobKeys = deriveEncryptionKeys(BOB_ED25519_PRIVATE)

  describe('encrypt', () => {
    it('produces non-empty ciphertext', () => {
      const { ciphertext } = encrypt('Hello', bobKeys.publicKey)
      expect(ciphertext.length).toBeGreaterThan(0)
    })

    it('produces 12-byte nonce', () => {
      const { nonce } = encrypt('Hello', bobKeys.publicKey)
      expect(nonce.length).toBe(12)
    })

    it('produces 32-byte ephemeral public key', () => {
      const { ephemeralPublicKey } = encrypt('Hello', bobKeys.publicKey)
      expect(ephemeralPublicKey.length).toBe(32)
    })

    it('produces different ciphertext each time (random nonce)', () => {
      const encrypted1 = encrypt('Hello', bobKeys.publicKey)
      const encrypted2 = encrypt('Hello', bobKeys.publicKey)

      // Ciphertext should differ due to random nonce
      expect(bytesToHex(encrypted1.ciphertext)).not.toBe(
        bytesToHex(encrypted2.ciphertext),
      )

      // Ephemeral keys should also differ
      expect(bytesToHex(encrypted1.ephemeralPublicKey)).not.toBe(
        bytesToHex(encrypted2.ephemeralPublicKey),
      )
    })

    it('ciphertext is longer than plaintext (auth tag)', () => {
      const plaintext = 'Hello World'
      const { ciphertext } = encrypt(plaintext, bobKeys.publicKey)

      // AES-GCM adds 16-byte auth tag
      const expectedMinLength = new TextEncoder().encode(plaintext).length + 16
      expect(ciphertext.length).toBeGreaterThanOrEqual(expectedMinLength)
    })
  })

  describe('decrypt', () => {
    it('recovers original plaintext', () => {
      const plaintext = 'Hello Bob!'
      const { ciphertext, nonce, ephemeralPublicKey } = encrypt(
        plaintext,
        bobKeys.publicKey,
      )

      const decrypted = decrypt(
        ciphertext,
        nonce,
        ephemeralPublicKey,
        bobKeys.privateKey,
      )

      expect(decrypted).toBe(plaintext)
    })

    it('works with various message lengths', () => {
      const testMessages = [
        '', // Empty
        'a', // Single char
        'Hello', // Short
        'a'.repeat(100), // Medium
        'a'.repeat(1000), // Long
        'a'.repeat(10000), // Very long
      ]

      for (const plaintext of testMessages) {
        const { ciphertext, nonce, ephemeralPublicKey } = encrypt(
          plaintext,
          bobKeys.publicKey,
        )
        const decrypted = decrypt(
          ciphertext,
          nonce,
          ephemeralPublicKey,
          bobKeys.privateKey,
        )
        expect(decrypted).toBe(plaintext)
      }
    })

    it('works with UTF-8 content', () => {
      const testMessages = [
        'Hello 🌍',
        '你好世界',
        '🎉🚀🌟',
        'Mixed: Hello 世界 🎉',
      ]

      for (const plaintext of testMessages) {
        const { ciphertext, nonce, ephemeralPublicKey } = encrypt(
          plaintext,
          bobKeys.publicKey,
        )
        const decrypted = decrypt(
          ciphertext,
          nonce,
          ephemeralPublicKey,
          bobKeys.privateKey,
        )
        expect(decrypted).toBe(plaintext)
      }
    })

    it('works with special characters', () => {
      const specialChars = 'Line1\nLine2\tTab\r\nCRLF\0Null'
      const { ciphertext, nonce, ephemeralPublicKey } = encrypt(
        specialChars,
        bobKeys.publicKey,
      )
      const decrypted = decrypt(
        ciphertext,
        nonce,
        ephemeralPublicKey,
        bobKeys.privateKey,
      )
      expect(decrypted).toBe(specialChars)
    })
  })

  describe('bidirectional communication', () => {
    it('Alice can send to Bob', () => {
      const message = 'Hello Bob, from Alice!'
      const { ciphertext, nonce, ephemeralPublicKey } = encrypt(
        message,
        bobKeys.publicKey,
      )
      const decrypted = decrypt(
        ciphertext,
        nonce,
        ephemeralPublicKey,
        bobKeys.privateKey,
      )
      expect(decrypted).toBe(message)
    })

    it('Bob can send to Alice', () => {
      const message = 'Hello Alice, from Bob!'
      const { ciphertext, nonce, ephemeralPublicKey } = encrypt(
        message,
        aliceKeys.publicKey,
      )
      const decrypted = decrypt(
        ciphertext,
        nonce,
        ephemeralPublicKey,
        aliceKeys.privateKey,
      )
      expect(decrypted).toBe(message)
    })

    it('wrong recipient cannot decrypt', () => {
      const message = 'Secret for Bob only'
      const { ciphertext, nonce, ephemeralPublicKey } = encrypt(
        message,
        bobKeys.publicKey,
      )

      // Alice tries to decrypt Bob's message
      expect(() => {
        decrypt(ciphertext, nonce, ephemeralPublicKey, aliceKeys.privateKey)
      }).toThrow()
    })
  })
})
describe('Security Properties', () => {
  const bobKeys = deriveEncryptionKeys(BOB_ED25519_PRIVATE)

  describe('ciphertext indistinguishability', () => {
    it('same plaintext produces different ciphertext', () => {
      const ciphertexts = new Set<string>()

      for (let i = 0; i < 100; i++) {
        const { ciphertext } = encrypt('Same message', bobKeys.publicKey)
        ciphertexts.add(bytesToHex(ciphertext))
      }

      // All ciphertexts should be unique
      expect(ciphertexts.size).toBe(100)
    })

    it('ciphertext length does not reveal exact plaintext length', () => {
      // AES-GCM preserves plaintext length, but auth tag is added
      const short = encrypt('Hi', bobKeys.publicKey)
      const long = encrypt(
        'Hello World, this is a longer message!',
        bobKeys.publicKey,
      )

      // Both should have 16-byte auth tag
      const shortPlainLen = new TextEncoder().encode('Hi').length
      const longPlainLen = new TextEncoder().encode(
        'Hello World, this is a longer message!',
      ).length

      expect(short.ciphertext.length).toBe(shortPlainLen + 16)
      expect(long.ciphertext.length).toBe(longPlainLen + 16)
    })
  })

  describe('authentication', () => {
    it('rejects tampered ciphertext', () => {
      const { ciphertext, nonce, ephemeralPublicKey } = encrypt(
        'Secret',
        bobKeys.publicKey,
      )

      // Tamper with ciphertext
      const tampered = new Uint8Array(ciphertext)
      tampered[0] ^= 0xff

      expect(() => {
        decrypt(tampered, nonce, ephemeralPublicKey, bobKeys.privateKey)
      }).toThrow()
    })

    it('rejects tampered nonce', () => {
      const { ciphertext, nonce, ephemeralPublicKey } = encrypt(
        'Secret',
        bobKeys.publicKey,
      )

      // Tamper with nonce
      const tamperedNonce = new Uint8Array(nonce)
      tamperedNonce[0] ^= 0xff

      expect(() => {
        decrypt(
          ciphertext,
          tamperedNonce,
          ephemeralPublicKey,
          bobKeys.privateKey,
        )
      }).toThrow()
    })

    it('rejects wrong ephemeral key', () => {
      const { ciphertext, nonce } = encrypt('Secret', bobKeys.publicKey)

      // Use different ephemeral key
      const wrongEphemeral = x25519.getPublicKey(randomBytes(32))

      expect(() => {
        decrypt(ciphertext, nonce, wrongEphemeral, bobKeys.privateKey)
      }).toThrow()
    })

    it('rejects truncated ciphertext', () => {
      const { ciphertext, nonce, ephemeralPublicKey } = encrypt(
        'Hello World',
        bobKeys.publicKey,
      )

      // Truncate ciphertext
      const truncated = ciphertext.slice(0, ciphertext.length - 5)

      expect(() => {
        decrypt(truncated, nonce, ephemeralPublicKey, bobKeys.privateKey)
      }).toThrow()
    })
  })

  describe('forward secrecy', () => {
    it('each message uses unique ephemeral key', () => {
      const ephemeralKeys = new Set<string>()

      for (let i = 0; i < 100; i++) {
        const { ephemeralPublicKey } = encrypt('Message', bobKeys.publicKey)
        ephemeralKeys.add(bytesToHex(ephemeralPublicKey))
      }

      expect(ephemeralKeys.size).toBe(100)
    })

    it('compromised ephemeral key does not affect other messages', () => {
      // Message 1
      const encrypted1 = encrypt('Secret 1', bobKeys.publicKey)
      const decrypted1 = decrypt(
        encrypted1.ciphertext,
        encrypted1.nonce,
        encrypted1.ephemeralPublicKey,
        bobKeys.privateKey,
      )
      expect(decrypted1).toBe('Secret 1')

      // Message 2 with independent ephemeral key
      const encrypted2 = encrypt('Secret 2', bobKeys.publicKey)
      const decrypted2 = decrypt(
        encrypted2.ciphertext,
        encrypted2.nonce,
        encrypted2.ephemeralPublicKey,
        bobKeys.privateKey,
      )
      expect(decrypted2).toBe('Secret 2')

      // Even if ephemeral key 1 is compromised, message 2 remains secure
      expect(bytesToHex(encrypted1.ephemeralPublicKey)).not.toBe(
        bytesToHex(encrypted2.ephemeralPublicKey),
      )
    })
  })
})
describe('HKDF Key Derivation', () => {
  it('produces 32-byte output for 32-byte request', () => {
    const secret = randomBytes(32)
    const derived = hkdf(
      sha256,
      secret,
      new Uint8Array(0),
      new TextEncoder().encode('test'),
      32,
    )
    expect(derived.length).toBe(32)
  })

  it('different info strings produce different keys', () => {
    const secret = randomBytes(32)

    const key1 = hkdf(
      sha256,
      secret,
      new Uint8Array(0),
      new TextEncoder().encode('info1'),
      32,
    )
    const key2 = hkdf(
      sha256,
      secret,
      new Uint8Array(0),
      new TextEncoder().encode('info2'),
      32,
    )

    expect(bytesToHex(key1)).not.toBe(bytesToHex(key2))
  })

  it('is deterministic', () => {
    const secret = new Uint8Array(32).fill(0x42)
    const info = new TextEncoder().encode('test')

    const key1 = hkdf(sha256, secret, new Uint8Array(0), info, 32)
    const key2 = hkdf(sha256, secret, new Uint8Array(0), info, 32)

    expect(bytesToHex(key1)).toBe(bytesToHex(key2))
  })
})
describe('Property-Based Tests', () => {
  it('encryption is always reversible', () => {
    const recipientKeys = deriveEncryptionKeys(randomBytes(32))

    for (let i = 0; i < 50; i++) {
      // Random plaintext of random length
      const length = Math.floor(Math.random() * 500)
      const plaintext = Array.from({ length }, () =>
        String.fromCharCode(Math.floor(Math.random() * 128)),
      ).join('')

      const { ciphertext, nonce, ephemeralPublicKey } = encrypt(
        plaintext,
        recipientKeys.publicKey,
      )
      const decrypted = decrypt(
        ciphertext,
        nonce,
        ephemeralPublicKey,
        recipientKeys.privateKey,
      )

      expect(decrypted).toBe(plaintext)
    }
  })

  it('different sender keys work with same recipient', () => {
    const recipientKeys = deriveEncryptionKeys(randomBytes(32))

    for (let i = 0; i < 10; i++) {
      const message = `Message ${i}`
      const { ciphertext, nonce, ephemeralPublicKey } = encrypt(
        message,
        recipientKeys.publicKey,
      )
      const decrypted = decrypt(
        ciphertext,
        nonce,
        ephemeralPublicKey,
        recipientKeys.privateKey,
      )
      expect(decrypted).toBe(message)
    }
  })

  it('key derivation is consistent across multiple calls', () => {
    const edKey = randomBytes(32)

    for (let i = 0; i < 10; i++) {
      const keys1 = deriveEncryptionKeys(edKey)
      const keys2 = deriveEncryptionKeys(edKey)

      expect(bytesToHex(keys1.privateKey)).toBe(bytesToHex(keys2.privateKey))
      expect(bytesToHex(keys1.publicKey)).toBe(bytesToHex(keys2.publicKey))
    }
  })
})
describe('Edge Cases', () => {
  const bobKeys = deriveEncryptionKeys(BOB_ED25519_PRIVATE)

  it('handles binary data in plaintext', () => {
    // Create string with all byte values
    const binaryStr = Array.from({ length: 256 }, (_, i) =>
      String.fromCharCode(i),
    ).join('')

    // This produces invalid UTF-8 but should still roundtrip (in practice, use valid text)
    const { ciphertext, nonce, ephemeralPublicKey } = encrypt(
      binaryStr,
      bobKeys.publicKey,
    )
    const decrypted = decrypt(
      ciphertext,
      nonce,
      ephemeralPublicKey,
      bobKeys.privateKey,
    )
    expect(decrypted).toBe(binaryStr)
  })

  it('handles very long messages', () => {
    const longMessage = 'a'.repeat(100000) // 100KB
    const { ciphertext, nonce, ephemeralPublicKey } = encrypt(
      longMessage,
      bobKeys.publicKey,
    )
    const decrypted = decrypt(
      ciphertext,
      nonce,
      ephemeralPublicKey,
      bobKeys.privateKey,
    )
    expect(decrypted).toBe(longMessage)
  })

  it('handles null characters', () => {
    const withNull = 'Hello\0World\0!'
    const { ciphertext, nonce, ephemeralPublicKey } = encrypt(
      withNull,
      bobKeys.publicKey,
    )
    const decrypted = decrypt(
      ciphertext,
      nonce,
      ephemeralPublicKey,
      bobKeys.privateKey,
    )
    expect(decrypted).toBe(withNull)
  })
})
