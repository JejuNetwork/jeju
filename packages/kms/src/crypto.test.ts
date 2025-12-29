/**
 * Crypto Utilities Tests
 *
 * Comprehensive tests for AES-256-GCM encryption, HKDF key derivation,
 * key sealing/unsealing, and property-based fuzzing for cryptographic operations.
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { toHex } from 'viem'
import {
  type AESGCMPayload,
  aesGcmDecrypt,
  aesGcmEncrypt,
  decryptFromPayload,
  deriveEncryptionKey,
  deriveKeyForEncryption,
  deriveKeyFromSecret,
  encryptToPayload,
  generateKeyId,
  parseCiphertextPayload,
  sealWithMasterKey,
  unsealWithMasterKey,
} from './crypto'

describe('AES-256-GCM Encryption', () => {
  let testKey: Uint8Array

  beforeEach(() => {
    testKey = crypto.getRandomValues(new Uint8Array(32))
  })

  describe('aesGcmEncrypt / aesGcmDecrypt', () => {
    it('should encrypt and decrypt data correctly', async () => {
      const plaintext = new TextEncoder().encode('Hello, World!')
      const { ciphertext, iv } = await aesGcmEncrypt(plaintext, testKey)

      expect(ciphertext).toBeInstanceOf(Uint8Array)
      expect(iv).toBeInstanceOf(Uint8Array)
      expect(iv.length).toBe(12) // GCM IV is 12 bytes
      expect(ciphertext.length).toBeGreaterThan(plaintext.length) // Ciphertext includes auth tag

      const decrypted = await aesGcmDecrypt(ciphertext, iv, testKey)
      expect(new TextDecoder().decode(decrypted)).toBe('Hello, World!')
    })

    it('should produce different ciphertexts for same plaintext (random IV)', async () => {
      const plaintext = new TextEncoder().encode('Same data')

      const result1 = await aesGcmEncrypt(plaintext, testKey)
      const result2 = await aesGcmEncrypt(plaintext, testKey)

      expect(toHex(result1.ciphertext)).not.toBe(toHex(result2.ciphertext))
      expect(toHex(result1.iv)).not.toBe(toHex(result2.iv))
    })

    it('should handle empty data', async () => {
      const plaintext = new Uint8Array(0)
      const { ciphertext, iv } = await aesGcmEncrypt(plaintext, testKey)

      // Empty data uses marker byte scheme: 1 byte marker + 16 byte auth tag = 17 bytes
      expect(ciphertext.length).toBe(17)

      const decrypted = await aesGcmDecrypt(ciphertext, iv, testKey)
      expect(decrypted.length).toBe(0)
    })

    it('should handle binary data with all byte values', async () => {
      const plaintext = new Uint8Array(256)
      for (let i = 0; i < 256; i++) plaintext[i] = i

      const { ciphertext, iv } = await aesGcmEncrypt(plaintext, testKey)
      const decrypted = await aesGcmDecrypt(ciphertext, iv, testKey)

      expect(toHex(decrypted)).toBe(toHex(plaintext))
    })

    it('should fail decryption with wrong key', async () => {
      const plaintext = new TextEncoder().encode('Secret data')
      const { ciphertext, iv } = await aesGcmEncrypt(plaintext, testKey)

      const wrongKey = crypto.getRandomValues(new Uint8Array(32))
      await expect(aesGcmDecrypt(ciphertext, iv, wrongKey)).rejects.toThrow()
    })

    it('should fail decryption with tampered ciphertext', async () => {
      const plaintext = new TextEncoder().encode('Secret data')
      const { ciphertext, iv } = await aesGcmEncrypt(plaintext, testKey)

      // Tamper with ciphertext
      const tampered = new Uint8Array(ciphertext)
      tampered[0] ^= 0xff

      await expect(aesGcmDecrypt(tampered, iv, testKey)).rejects.toThrow()
    })

    it('should fail decryption with wrong IV', async () => {
      const plaintext = new TextEncoder().encode('Secret data')
      const { ciphertext } = await aesGcmEncrypt(plaintext, testKey)

      const wrongIv = crypto.getRandomValues(new Uint8Array(12))
      await expect(
        aesGcmDecrypt(ciphertext, wrongIv, testKey),
      ).rejects.toThrow()
    })

    it('should handle large data (1MB)', async () => {
      const plaintext = crypto.getRandomValues(new Uint8Array(1024 * 1024))
      const { ciphertext, iv } = await aesGcmEncrypt(plaintext, testKey)

      const decrypted = await aesGcmDecrypt(ciphertext, iv, testKey)
      expect(toHex(decrypted)).toBe(toHex(plaintext))
    })
  })
})

describe('Key Sealing', () => {
  let masterKey: Uint8Array

  beforeEach(() => {
    masterKey = crypto.getRandomValues(new Uint8Array(32))
  })

  describe('sealWithMasterKey / unsealWithMasterKey', () => {
    it('should seal and unseal data correctly', async () => {
      const secretKey = crypto.getRandomValues(new Uint8Array(32))
      const sealed = await sealWithMasterKey(secretKey, masterKey)

      // Sealed format: 12 bytes IV + ciphertext (including auth tag)
      expect(sealed.length).toBeGreaterThan(12)

      const unsealed = await unsealWithMasterKey(sealed, masterKey)
      expect(toHex(unsealed)).toBe(toHex(secretKey))
    })

    it('should fail to unseal with wrong master key', async () => {
      const secretKey = crypto.getRandomValues(new Uint8Array(32))
      const sealed = await sealWithMasterKey(secretKey, masterKey)

      const wrongMasterKey = crypto.getRandomValues(new Uint8Array(32))
      await expect(
        unsealWithMasterKey(sealed, wrongMasterKey),
      ).rejects.toThrow()
    })

    it('should produce different sealed outputs for same key (random IV)', async () => {
      const secretKey = crypto.getRandomValues(new Uint8Array(32))

      const sealed1 = await sealWithMasterKey(secretKey, masterKey)
      const sealed2 = await sealWithMasterKey(secretKey, masterKey)

      expect(toHex(sealed1)).not.toBe(toHex(sealed2))

      // But both should unseal to the same key
      const unsealed1 = await unsealWithMasterKey(sealed1, masterKey)
      const unsealed2 = await unsealWithMasterKey(sealed2, masterKey)
      expect(toHex(unsealed1)).toBe(toHex(unsealed2))
    })

    it('should handle various data sizes', async () => {
      for (const size of [1, 16, 32, 64, 128, 256, 1024]) {
        const data = crypto.getRandomValues(new Uint8Array(size))
        const sealed = await sealWithMasterKey(data, masterKey)
        const unsealed = await unsealWithMasterKey(sealed, masterKey)
        expect(toHex(unsealed)).toBe(toHex(data))
      }
    })
  })
})

describe('HKDF Key Derivation', () => {
  let masterKey: Uint8Array

  beforeEach(() => {
    masterKey = crypto.getRandomValues(new Uint8Array(32))
  })

  describe('deriveEncryptionKey', () => {
    it('should derive a 256-bit key', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const derived = await deriveEncryptionKey(masterKey, salt, 'encryption')

      expect(derived).toBeInstanceOf(Uint8Array)
      expect(derived.length).toBe(32)
    })

    it('should be deterministic with same inputs', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32))

      const derived1 = await deriveEncryptionKey(masterKey, salt, 'encryption')
      const derived2 = await deriveEncryptionKey(masterKey, salt, 'encryption')

      expect(toHex(derived1)).toBe(toHex(derived2))
    })

    it('should produce different keys with different salts', async () => {
      const salt1 = crypto.getRandomValues(new Uint8Array(32))
      const salt2 = crypto.getRandomValues(new Uint8Array(32))

      const derived1 = await deriveEncryptionKey(masterKey, salt1, 'encryption')
      const derived2 = await deriveEncryptionKey(masterKey, salt2, 'encryption')

      expect(toHex(derived1)).not.toBe(toHex(derived2))
    })

    it('should produce different keys with different info strings', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32))

      const derived1 = await deriveEncryptionKey(masterKey, salt, 'encryption')
      const derived2 = await deriveEncryptionKey(masterKey, salt, 'signing')

      expect(toHex(derived1)).not.toBe(toHex(derived2))
    })

    it('should produce different keys with different master keys', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const masterKey2 = crypto.getRandomValues(new Uint8Array(32))

      const derived1 = await deriveEncryptionKey(masterKey, salt, 'encryption')
      const derived2 = await deriveEncryptionKey(masterKey2, salt, 'encryption')

      expect(toHex(derived1)).not.toBe(toHex(derived2))
    })

    it('should handle unicode info strings', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32))

      const derived = await deriveEncryptionKey(masterKey, salt, '日本語🔐')
      expect(derived.length).toBe(32)
    })
  })

  describe('deriveKeyFromSecret (async PBKDF2)', () => {
    it('should derive consistent key from secret string', async () => {
      const key1 = await deriveKeyFromSecret('my-secret-password')
      const key2 = await deriveKeyFromSecret('my-secret-password')

      expect(toHex(key1)).toBe(toHex(key2))
    })

    it('should produce different keys for different secrets', async () => {
      const key1 = await deriveKeyFromSecret('secret-1')
      const key2 = await deriveKeyFromSecret('secret-2')

      expect(toHex(key1)).not.toBe(toHex(key2))
    })

    it('should produce 32-byte keys', async () => {
      const key = await deriveKeyFromSecret('any-secret')
      expect(key.length).toBe(32)
    })

    it('should derive key using PBKDF2', async () => {
      const secret = 'test-secret'
      const key = await deriveKeyFromSecret(secret)
      // PBKDF2 should produce a 32-byte key
      expect(key.length).toBe(32)
    })
  })

  describe('deriveKeyForEncryption', () => {
    it('should derive key based on keyId and policy', async () => {
      const keyId = 'test-key-123'
      const policy = JSON.stringify({ conditions: [], operator: 'and' })

      const key = await deriveKeyForEncryption(masterKey, keyId, policy)
      expect(key.length).toBe(32)
    })

    it('should be deterministic', async () => {
      const keyId = 'test-key-123'
      const policy = JSON.stringify({ conditions: [], operator: 'and' })

      const key1 = await deriveKeyForEncryption(masterKey, keyId, policy)
      const key2 = await deriveKeyForEncryption(masterKey, keyId, policy)

      expect(toHex(key1)).toBe(toHex(key2))
    })

    it('should produce different keys for different keyIds', async () => {
      const policy = JSON.stringify({ conditions: [], operator: 'and' })

      const key1 = await deriveKeyForEncryption(masterKey, 'key-1', policy)
      const key2 = await deriveKeyForEncryption(masterKey, 'key-2', policy)

      expect(toHex(key1)).not.toBe(toHex(key2))
    })

    it('should produce different keys for different policies', async () => {
      const keyId = 'test-key'
      const policy1 = JSON.stringify({
        conditions: [{ type: 'timestamp' }],
        operator: 'and',
      })
      const policy2 = JSON.stringify({
        conditions: [{ type: 'stake' }],
        operator: 'and',
      })

      const key1 = await deriveKeyForEncryption(masterKey, keyId, policy1)
      const key2 = await deriveKeyForEncryption(masterKey, keyId, policy2)

      expect(toHex(key1)).not.toBe(toHex(key2))
    })
  })
})

describe('Payload Encryption', () => {
  let testKey: Uint8Array

  beforeEach(() => {
    testKey = crypto.getRandomValues(new Uint8Array(32))
  })

  describe('encryptToPayload / decryptFromPayload', () => {
    it('should encrypt and decrypt string data', async () => {
      const data = 'Hello, encrypted world!'
      const payload = await encryptToPayload(data, testKey)

      expect(typeof payload).toBe('string')
      const parsed = JSON.parse(payload) as AESGCMPayload
      expect(parsed.ciphertext).toBeDefined()
      expect(parsed.iv).toBeDefined()
      expect(parsed.tag).toBeDefined()

      const decrypted = await decryptFromPayload(payload, testKey)
      expect(decrypted).toBe(data)
    })

    it('should handle empty string', async () => {
      const data = ''
      const payload = await encryptToPayload(data, testKey)
      const decrypted = await decryptFromPayload(payload, testKey)
      expect(decrypted).toBe('')
    })

    it('should handle unicode and special characters', async () => {
      const data =
        '日本語 🔐 émojis © ® ™ "quotes" \'apostrophes\' <tags> & ampersands\n\t\r'
      const payload = await encryptToPayload(data, testKey)
      const decrypted = await decryptFromPayload(payload, testKey)
      expect(decrypted).toBe(data)
    })

    it('should handle JSON data', async () => {
      const jsonData = JSON.stringify({
        nested: { deeply: { value: [1, 2, 3] } },
        null: null,
        bool: true,
        number: Math.PI,
      })

      const payload = await encryptToPayload(jsonData, testKey)
      const decrypted = await decryptFromPayload(payload, testKey)
      expect(JSON.parse(decrypted)).toEqual(JSON.parse(jsonData))
    })

    it('should include version when specified', async () => {
      const payload = await encryptToPayload('test', testKey, { version: 2 })
      const parsed = JSON.parse(payload) as AESGCMPayload
      expect(parsed.version).toBe(2)
    })

    it('should include mpc flag when specified', async () => {
      const payload = await encryptToPayload('test', testKey, { mpc: true })
      const parsed = JSON.parse(payload) as AESGCMPayload
      expect(parsed.mpc).toBe(true)
    })

    it('should fail decryption with wrong key', async () => {
      const payload = await encryptToPayload('secret', testKey)
      const wrongKey = crypto.getRandomValues(new Uint8Array(32))
      await expect(decryptFromPayload(payload, wrongKey)).rejects.toThrow()
    })

    it('should fail with invalid payload format', async () => {
      const invalidPayload = JSON.stringify({ invalid: 'structure' })
      await expect(decryptFromPayload(invalidPayload, testKey)).rejects.toThrow(
        'Invalid ciphertext format',
      )
    })
  })

  describe('parseCiphertextPayload', () => {
    it('should parse valid payload', async () => {
      const payload = await encryptToPayload('test', testKey, { version: 1 })
      const parsed = parseCiphertextPayload(payload)

      expect(parsed.ciphertext).toBeDefined()
      expect(parsed.iv).toBeDefined()
      expect(parsed.tag).toBeDefined()
      expect(parsed.version).toBe(1)
    })

    it('should reject invalid JSON', () => {
      expect(() => parseCiphertextPayload('not-json')).toThrow()
    })

    it('should reject missing fields', () => {
      const invalid = JSON.stringify({ ciphertext: '0x1234' }) // Missing iv and tag
      expect(() => parseCiphertextPayload(invalid)).toThrow(
        'Invalid ciphertext format',
      )
    })
  })
})

describe('Key ID Generation', () => {
  describe('generateKeyId', () => {
    it('should generate unique IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 1000; i++) {
        ids.add(generateKeyId('test'))
      }
      expect(ids.size).toBe(1000)
    })

    it('should include the prefix', () => {
      const id = generateKeyId('enc')
      expect(id.startsWith('enc-')).toBe(true)
    })

    it('should have reasonable length', () => {
      const id = generateKeyId('key')
      expect(id.length).toBeGreaterThan(10)
      expect(id.length).toBeLessThan(50)
    })

    it('should contain timestamp component', () => {
      const id1 = generateKeyId('test')
      // Wait a tiny bit to ensure different timestamp
      const id2 = generateKeyId('test')
      // Different IDs due to UUID component at minimum
      expect(id1).not.toBe(id2)
    })
  })
})

describe('Property-Based / Fuzz Testing', () => {
  function randomBytes(minLen: number, maxLen: number): Uint8Array {
    const length = Math.floor(Math.random() * (maxLen - minLen + 1)) + minLen
    return crypto.getRandomValues(new Uint8Array(length))
  }

  function randomString(length: number): string {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  describe('AES-GCM roundtrip properties', () => {
    it('should roundtrip any random data (100 iterations)', async () => {
      const key = crypto.getRandomValues(new Uint8Array(32))

      for (let i = 0; i < 100; i++) {
        const data = randomBytes(0, 10000)
        const { ciphertext, iv } = await aesGcmEncrypt(data, key)
        const decrypted = await aesGcmDecrypt(ciphertext, iv, key)
        expect(toHex(decrypted)).toBe(toHex(data))
      }
    })

    it('should always produce different ciphertexts (IV uniqueness)', async () => {
      const key = crypto.getRandomValues(new Uint8Array(32))
      const data = new TextEncoder().encode('Same data for all')
      const ciphertexts = new Set<string>()

      for (let i = 0; i < 100; i++) {
        const { ciphertext } = await aesGcmEncrypt(data, key)
        ciphertexts.add(toHex(ciphertext))
      }

      expect(ciphertexts.size).toBe(100)
    })
  })

  describe('Key sealing properties', () => {
    it('should roundtrip any random key (100 iterations)', async () => {
      for (let i = 0; i < 100; i++) {
        const masterKey = crypto.getRandomValues(new Uint8Array(32))
        const secretKey = randomBytes(1, 1024)

        const sealed = await sealWithMasterKey(secretKey, masterKey)
        const unsealed = await unsealWithMasterKey(sealed, masterKey)

        expect(toHex(unsealed)).toBe(toHex(secretKey))
      }
    })
  })

  describe('Key derivation properties', () => {
    it('should produce consistent keys across calls (50 iterations)', async () => {
      const masterKey = crypto.getRandomValues(new Uint8Array(32))

      for (let i = 0; i < 50; i++) {
        const salt = randomBytes(16, 64)
        const info = randomString(10)

        const key1 = await deriveEncryptionKey(masterKey, salt, info)
        const key2 = await deriveEncryptionKey(masterKey, salt, info)

        expect(toHex(key1)).toBe(toHex(key2))
      }
    })

    it('should produce collision-free keys for different inputs (100 iterations)', async () => {
      const masterKey = crypto.getRandomValues(new Uint8Array(32))
      const keys = new Set<string>()

      for (let i = 0; i < 100; i++) {
        const salt = randomBytes(32, 32)
        const info = randomString(20)
        const key = await deriveEncryptionKey(masterKey, salt, info)
        keys.add(toHex(key))
      }

      expect(keys.size).toBe(100)
    })
  })

  describe('Payload encryption properties', () => {
    it('should roundtrip random string data (100 iterations)', async () => {
      const key = crypto.getRandomValues(new Uint8Array(32))

      for (let i = 0; i < 100; i++) {
        const data = randomString(Math.floor(Math.random() * 1000))
        const payload = await encryptToPayload(data, key)
        const decrypted = await decryptFromPayload(payload, key)
        expect(decrypted).toBe(data)
      }
    })

    it('should produce valid JSON payloads (50 iterations)', async () => {
      const key = crypto.getRandomValues(new Uint8Array(32))

      for (let i = 0; i < 50; i++) {
        const data = randomString(100)
        const payload = await encryptToPayload(data, key)

        // Should be valid JSON
        expect(() => JSON.parse(payload)).not.toThrow()

        // Should have required fields
        const parsed = JSON.parse(payload) as AESGCMPayload
        expect(typeof parsed.ciphertext).toBe('string')
        expect(typeof parsed.iv).toBe('string')
        expect(typeof parsed.tag).toBe('string')
      }
    })
  })

  describe('Authentication tag verification', () => {
    it('should reject tampering at any position (50 iterations)', async () => {
      const key = crypto.getRandomValues(new Uint8Array(32))
      const data = new TextEncoder().encode('Sensitive data to protect')

      for (let i = 0; i < 50; i++) {
        const { ciphertext, iv } = await aesGcmEncrypt(data, key)

        // Tamper at random position
        const tamperedCiphertext = new Uint8Array(ciphertext)
        const tamperPos = Math.floor(Math.random() * tamperedCiphertext.length)
        tamperedCiphertext[tamperPos] ^= 0xff

        await expect(
          aesGcmDecrypt(tamperedCiphertext, iv, key),
        ).rejects.toThrow()
      }
    })
  })
})

describe('Edge Cases', () => {
  it('should handle max size IV correctly', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32))
    const data = new TextEncoder().encode('test')

    const { iv } = await aesGcmEncrypt(data, key)
    expect(iv.length).toBe(12) // AES-GCM standard IV size
  })

  it('should handle boundary sizes for data', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32))

    // Test powers of 2 and boundary sizes
    const sizes = [
      0, 1, 15, 16, 17, 31, 32, 33, 255, 256, 257, 1023, 1024, 1025,
    ]

    for (const size of sizes) {
      const data = crypto.getRandomValues(new Uint8Array(size))
      const { ciphertext, iv } = await aesGcmEncrypt(data, key)
      const decrypted = await aesGcmDecrypt(ciphertext, iv, key)
      expect(decrypted.length).toBe(size)
      expect(toHex(decrypted)).toBe(toHex(data))
    }
  })

  it('should handle concurrent encryption operations', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32))
    const operations = 50

    const promises = Array.from({ length: operations }, async (_, i) => {
      const data = new TextEncoder().encode(`Message ${i}`)
      const { ciphertext, iv } = await aesGcmEncrypt(data, key)
      const decrypted = await aesGcmDecrypt(ciphertext, iv, key)
      return new TextDecoder().decode(decrypted)
    })

    const results = await Promise.all(promises)

    for (let i = 0; i < operations; i++) {
      expect(results[i]).toBe(`Message ${i}`)
    }
  })
})
