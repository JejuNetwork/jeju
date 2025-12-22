import { describe, expect, test } from 'bun:test'
import type { KeySet, NetworkType } from '../types'
import {
  decryptKeySet,
  encryptKeySet,
  generateEntropyString,
  generateKey,
  generateOperatorKeys,
  getDevKeys,
  validatePassword,
} from './keys'

describe('Key Management', () => {
  test('getDevKeys returns 5 development accounts', () => {
    const keys = getDevKeys()
    expect(keys.length).toBe(5)
    expect(keys[0].address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
  })

  test('getDevKeys returns immutable copies', () => {
    const keys1 = getDevKeys()
    const keys2 = getDevKeys()

    // Should be different array instances
    expect(keys1).not.toBe(keys2)

    // But same content
    expect(keys1[0].address).toBe(keys2[0].address)
  })

  test('generateKey creates valid key', () => {
    const key = generateKey('Test Key', 'tester')
    expect(key.name).toBe('Test Key')
    expect(key.role).toBe('tester')
    expect(key.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(key.privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/)
  })

  test('generateKey produces unique keys each call', () => {
    const keys = Array.from({ length: 10 }, () => generateKey('Test', 'role'))

    const addresses = new Set(keys.map((k) => k.address))
    const privateKeys = new Set(keys.map((k) => k.privateKey))

    expect(addresses.size).toBe(10)
    expect(privateKeys.size).toBe(10)
  })

  test('generateKey address derived from private key is valid', async () => {
    const { privateKeyToAccount } = await import('viem/accounts')

    const key = generateKey('Test', 'role')
    const account = privateKeyToAccount(key.privateKey as `0x${string}`)

    expect(account.address.toLowerCase()).toBe(key.address.toLowerCase())
  })

  test('generateOperatorKeys creates all required operators', () => {
    const operators = generateOperatorKeys()
    expect(operators.sequencer).toBeDefined()
    expect(operators.batcher).toBeDefined()
    expect(operators.proposer).toBeDefined()
    expect(operators.challenger).toBeDefined()
    expect(operators.admin).toBeDefined()
    expect(operators.feeRecipient).toBeDefined()
    expect(operators.guardian).toBeDefined()
  })

  test('generateOperatorKeys creates unique keys for each role', () => {
    const operators = generateOperatorKeys()

    const addresses = [
      operators.sequencer.address,
      operators.batcher.address,
      operators.proposer.address,
      operators.challenger.address,
      operators.admin.address,
      operators.feeRecipient.address,
      operators.guardian.address,
    ]

    expect(new Set(addresses).size).toBe(7)
  })

  test('generateOperatorKeys assigns correct roles', () => {
    const operators = generateOperatorKeys()

    expect(operators.sequencer.role).toContain('block')
    expect(operators.batcher.role).toContain('batch')
    expect(operators.proposer.role).toContain('output')
    expect(operators.challenger.role).toContain('invalid')
    expect(operators.admin.role).toContain('admin')
    expect(operators.feeRecipient.role).toContain('fee')
    expect(operators.guardian.role).toContain('guardian')
  })
})

describe('Password Validation', () => {
  test('rejects password too short', () => {
    const result = validatePassword('Short1!')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Minimum 16 characters')
  })

  test('rejects password without uppercase', () => {
    const result = validatePassword('verylongpassword1!')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('uppercase'))).toBe(true)
  })

  test('rejects password without lowercase', () => {
    const result = validatePassword('VERYLONGPASSWORD1!')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('lowercase'))).toBe(true)
  })

  test('rejects password without numbers', () => {
    const result = validatePassword('VeryLongPassword!!')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('numbers'))).toBe(true)
  })

  test('rejects password without special characters', () => {
    const result = validatePassword('VeryLongPassword1')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('special'))).toBe(true)
  })

  test('accepts valid password with all requirements', () => {
    const result = validatePassword('VeryLongPassword1!')
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test('accepts password with various special characters', () => {
    const specialChars = [
      '!',
      '@',
      '#',
      '$',
      '%',
      '^',
      '&',
      '*',
      '-',
      '_',
      '+',
      '=',
    ]

    for (const char of specialChars) {
      const password = `VeryLongPassword1${char}`
      const result = validatePassword(password)
      expect(result.valid).toBe(true)
    }
  })

  test('accumulates multiple errors', () => {
    const result = validatePassword('abc') // Too short, no uppercase, no numbers, no special
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(1)
  })

  test('exactly 16 characters is valid length', () => {
    const result = validatePassword('AbcdefghijklMn1!') // Exactly 16 chars
    expect(result.valid).toBe(true)
  })

  test('15 characters is too short', () => {
    const result = validatePassword('AbcdefghijkMn1!') // 15 chars
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Minimum 16 characters')
  })

  test('unicode special characters are accepted', () => {
    const result = validatePassword('VeryLongPassword1©') // Copyright symbol
    expect(result.valid).toBe(true)
  })
})

describe('Entropy Generation', () => {
  test('generates 64-character hex string', () => {
    const entropy = generateEntropyString()
    expect(entropy.length).toBe(64)
    expect(entropy).toMatch(/^[a-f0-9]+$/)
  })

  test('generates unique values each call', () => {
    const values = Array.from({ length: 100 }, () => generateEntropyString())
    const unique = new Set(values)
    expect(unique.size).toBe(100)
  })

  test('entropy is cryptographically random', () => {
    // Statistical test: each hex digit should appear roughly equally
    const entropy = generateEntropyString()
    const counts = new Map<string, number>()

    for (const char of entropy) {
      counts.set(char, (counts.get(char) || 0) + 1)
    }

    // With 64 chars and 16 possible values, expected count is 4
    // Allow reasonable variance (1-8 per digit)
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(0)
      expect(count).toBeLessThan(15) // Extremely unlikely to have 15+ of same digit
    }
  })
})

describe('KeySet Encryption/Decryption', () => {
  const testKeySet: KeySet = {
    network: 'testnet' as NetworkType,
    created: new Date().toISOString(),
    keys: [
      {
        name: 'Test Key 1',
        address: '0x1234567890123456789012345678901234567890',
        privateKey:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        role: 'admin',
      },
      {
        name: 'Test Key 2',
        address: '0xabcdef0123456789abcdef0123456789abcdef01',
        privateKey:
          '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
        role: 'operator',
      },
    ],
    encrypted: false,
  }

  test('encrypts and decrypts KeySet correctly', async () => {
    const password = 'SecurePassword123!'

    const encrypted = await encryptKeySet(testKeySet, password)
    expect(encrypted).toBeInstanceOf(Buffer)
    expect(encrypted.length).toBeGreaterThan(64) // At least header size

    const decrypted = await decryptKeySet(encrypted, password)

    expect(decrypted.network).toBe(testKeySet.network)
    expect(decrypted.keys.length).toBe(testKeySet.keys.length)
    expect(decrypted.keys[0].privateKey).toBe(testKeySet.keys[0].privateKey)
    expect(decrypted.keys[1].address).toBe(testKeySet.keys[1].address)
  })

  test('decryption fails with wrong password', async () => {
    const password = 'SecurePassword123!'
    const encrypted = await encryptKeySet(testKeySet, password)

    await expect(
      decryptKeySet(encrypted, 'WrongPassword123!'),
    ).rejects.toThrow()
  })

  test('encrypted data has correct structure', async () => {
    const password = 'SecurePassword123!'
    const encrypted = await encryptKeySet(testKeySet, password)

    // Format: salt (32) + iv (16) + authTag (16) + encrypted
    expect(encrypted.length).toBeGreaterThan(64)

    const salt = encrypted.subarray(0, 32)
    const iv = encrypted.subarray(32, 48)
    const authTag = encrypted.subarray(48, 64)

    expect(salt.length).toBe(32)
    expect(iv.length).toBe(16)
    expect(authTag.length).toBe(16)
  })

  test('each encryption produces unique salt and IV', async () => {
    const password = 'SecurePassword123!'

    const encrypted1 = await encryptKeySet(testKeySet, password)
    const encrypted2 = await encryptKeySet(testKeySet, password)
    const encrypted3 = await encryptKeySet(testKeySet, password)

    const salts = [
      encrypted1.subarray(0, 32).toString('hex'),
      encrypted2.subarray(0, 32).toString('hex'),
      encrypted3.subarray(0, 32).toString('hex'),
    ]

    const ivs = [
      encrypted1.subarray(32, 48).toString('hex'),
      encrypted2.subarray(32, 48).toString('hex'),
      encrypted3.subarray(32, 48).toString('hex'),
    ]

    expect(new Set(salts).size).toBe(3)
    expect(new Set(ivs).size).toBe(3)
  })

  test('handles empty keys array', async () => {
    const emptyKeySet: KeySet = {
      network: 'localnet' as NetworkType,
      created: new Date().toISOString(),
      keys: [],
      encrypted: false,
    }

    const password = 'SecurePassword123!'
    const encrypted = await encryptKeySet(emptyKeySet, password)
    const decrypted = await decryptKeySet(encrypted, password)

    expect(decrypted.keys).toHaveLength(0)
  })

  test('handles special characters in key metadata', async () => {
    const specialKeySet: KeySet = {
      network: 'testnet' as NetworkType,
      created: new Date().toISOString(),
      keys: [
        {
          name: 'Key with "quotes" and émojis 🔐',
          address: '0x1234567890123456789012345678901234567890',
          privateKey:
            '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          role: 'Test & Role <special>',
        },
      ],
      encrypted: false,
    }

    const password = 'SecurePassword123!'
    const encrypted = await encryptKeySet(specialKeySet, password)
    const decrypted = await decryptKeySet(encrypted, password)

    expect(decrypted.keys[0].name).toBe('Key with "quotes" and émojis 🔐')
    expect(decrypted.keys[0].role).toBe('Test & Role <special>')
  })

  test('decryption fails with tampered auth tag', async () => {
    const password = 'SecurePassword123!'
    const encrypted = await encryptKeySet(testKeySet, password)

    // Tamper with auth tag (bytes 48-64)
    const tampered = Buffer.from(encrypted)
    tampered[50] = tampered[50] ^ 0xff

    await expect(decryptKeySet(tampered, password)).rejects.toThrow()
  })

  test('decryption fails with tampered encrypted data', async () => {
    const password = 'SecurePassword123!'
    const encrypted = await encryptKeySet(testKeySet, password)

    // Tamper with encrypted data (after byte 64)
    const tampered = Buffer.from(encrypted)
    tampered[70] = tampered[70] ^ 0xff

    await expect(decryptKeySet(tampered, password)).rejects.toThrow()
  })
})
