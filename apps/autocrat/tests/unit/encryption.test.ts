/**
 * Encryption Module Unit Tests
 *
 * Tests for AES-256-GCM encryption, key derivation, and access control logic
 */

import { describe, expect, test } from 'bun:test'
import { keccak256, stringToHex } from 'viem'

interface AccessControlCondition {
  contractAddress: string
  standardContractType: string
  chain: string
  method: string
  parameters: string[]
  returnValueTest: {
    comparator: string
    value: string
  }
}

interface _EncryptedData {
  ciphertext: string
  dataToEncryptHash: string
  accessControlConditions: AccessControlCondition[]
  chain: string
  encryptedAt: number
}

interface DecisionData {
  proposalId: string
  approved: boolean
  reasoning: string
  confidenceScore: number
  alignmentScore: number
  autocratVotes: Array<{ role: string; vote: string; reasoning: string }>
  researchSummary?: string
  model: string
  timestamp: number
}
const COUNCIL_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678'
const CHAIN_ID = 'base-sepolia'
const TEST_ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests'
function createAccessConditions(
  proposalId: string,
  encryptedAt: number,
  councilAddress: string,
  chainId: string,
): AccessControlCondition[] {
  const thirtyDaysLater = encryptedAt + 30 * 24 * 60 * 60

  return [
    // Condition 1: Proposal is completed
    {
      contractAddress: councilAddress,
      standardContractType: 'Custom',
      chain: chainId,
      method: 'proposals',
      parameters: [proposalId],
      returnValueTest: {
        comparator: '=',
        value: '7', // ProposalStatus.COMPLETED
      },
    },
    // OR
    // Condition 2: 30 days have passed
    {
      contractAddress: '',
      standardContractType: 'timestamp',
      chain: chainId,
      method: 'eth_getBlockByNumber',
      parameters: ['latest'],
      returnValueTest: {
        comparator: '>=',
        value: thirtyDaysLater.toString(),
      },
    },
  ]
}

async function deriveKey(
  encryptionKey: string,
  policyHash: string,
  extractable = false,
): Promise<CryptoKey> {
  const keyMaterial = new TextEncoder().encode(`${encryptionKey}:${policyHash}`)
  const hashBuffer = await crypto.subtle.digest('SHA-256', keyMaterial)

  return crypto.subtle.importKey(
    'raw',
    hashBuffer,
    { name: 'AES-GCM' },
    extractable,
    ['encrypt', 'decrypt'],
  )
}

async function deriveKeyExtractable(
  encryptionKey: string,
  policyHash: string,
): Promise<CryptoKey> {
  return deriveKey(encryptionKey, policyHash, true)
}

async function encrypt(
  data: string,
  policyHash: string,
  encryptionKey: string,
): Promise<{ ciphertext: string; iv: string; tag: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(encryptionKey, policyHash)

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(data),
  )

  const encryptedArray = new Uint8Array(encrypted)
  const ciphertext = encryptedArray.slice(0, -16)
  const tag = encryptedArray.slice(-16)

  return {
    ciphertext: Buffer.from(ciphertext).toString('hex'),
    iv: Buffer.from(iv).toString('hex'),
    tag: Buffer.from(tag).toString('hex'),
  }
}

async function decrypt(
  ciphertext: string,
  iv: string,
  tag: string,
  policyHash: string,
  encryptionKey: string,
): Promise<string> {
  const key = await deriveKey(encryptionKey, policyHash)

  const ciphertextBytes = Buffer.from(ciphertext, 'hex')
  const ivBytes = Buffer.from(iv, 'hex')
  const tagBytes = Buffer.from(tag, 'hex')

  const combined = new Uint8Array([...ciphertextBytes, ...tagBytes])

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    combined,
  )

  return new TextDecoder().decode(decrypted)
}

function canDecryptByTime(encryptedAt: number, nowSeconds: number): boolean {
  const thirtyDaysAfter = encryptedAt + 30 * 24 * 60 * 60
  return nowSeconds >= thirtyDaysAfter
}

function computeDataHash(data: string): string {
  return keccak256(stringToHex(data))
}

function computePolicyHash(accessConditions: AccessControlCondition[]): string {
  return keccak256(stringToHex(JSON.stringify(accessConditions)))
}
describe('Encryption Module', () => {
  describe('Access Control Conditions', () => {
    test('creates two conditions (proposal complete OR 30 days)', () => {
      const encryptedAt = Math.floor(Date.now() / 1000)
      const conditions = createAccessConditions(
        '0x1234',
        encryptedAt,
        COUNCIL_ADDRESS,
        CHAIN_ID,
      )

      expect(conditions).toHaveLength(2)
    })

    test('first condition checks proposal status = 7 (COMPLETED)', () => {
      const encryptedAt = Math.floor(Date.now() / 1000)
      const conditions = createAccessConditions(
        '0x1234',
        encryptedAt,
        COUNCIL_ADDRESS,
        CHAIN_ID,
      )

      const proposalCondition = conditions[0]
      expect(proposalCondition.contractAddress).toBe(COUNCIL_ADDRESS)
      expect(proposalCondition.method).toBe('proposals')
      expect(proposalCondition.returnValueTest.comparator).toBe('=')
      expect(proposalCondition.returnValueTest.value).toBe('7')
    })

    test('second condition is timestamp check for 30 days', () => {
      const encryptedAt = Math.floor(Date.now() / 1000)
      const conditions = createAccessConditions(
        '0x1234',
        encryptedAt,
        COUNCIL_ADDRESS,
        CHAIN_ID,
      )

      const timestampCondition = conditions[1]
      expect(timestampCondition.standardContractType).toBe('timestamp')
      expect(timestampCondition.returnValueTest.comparator).toBe('>=')

      const thirtyDaysLater = encryptedAt + 30 * 24 * 60 * 60
      expect(timestampCondition.returnValueTest.value).toBe(
        thirtyDaysLater.toString(),
      )
    })

    test('proposal ID is included in condition parameters', () => {
      const proposalId = '0xabcd1234'
      const conditions = createAccessConditions(
        proposalId,
        Math.floor(Date.now() / 1000),
        COUNCIL_ADDRESS,
        CHAIN_ID,
      )

      expect(conditions[0].parameters).toContain(proposalId)
    })
  })

  describe('Key Derivation', () => {
    test('same inputs produce same key', async () => {
      const policyHash = '0xabc123'

      const key1 = await deriveKeyExtractable(TEST_ENCRYPTION_KEY, policyHash)
      const key2 = await deriveKeyExtractable(TEST_ENCRYPTION_KEY, policyHash)

      // Export keys to compare
      const exported1 = await crypto.subtle.exportKey('raw', key1)
      const exported2 = await crypto.subtle.exportKey('raw', key2)

      expect(Buffer.from(exported1).toString('hex')).toBe(
        Buffer.from(exported2).toString('hex'),
      )
    })

    test('different policy hashes produce different keys', async () => {
      const key1 = await deriveKeyExtractable(TEST_ENCRYPTION_KEY, '0xabc123')
      const key2 = await deriveKeyExtractable(TEST_ENCRYPTION_KEY, '0xdef456')

      const exported1 = await crypto.subtle.exportKey('raw', key1)
      const exported2 = await crypto.subtle.exportKey('raw', key2)

      expect(Buffer.from(exported1).toString('hex')).not.toBe(
        Buffer.from(exported2).toString('hex'),
      )
    })

    test('different encryption keys produce different derived keys', async () => {
      const policyHash = '0xabc123'

      const key1 = await deriveKeyExtractable('key-1', policyHash)
      const key2 = await deriveKeyExtractable('key-2', policyHash)

      const exported1 = await crypto.subtle.exportKey('raw', key1)
      const exported2 = await crypto.subtle.exportKey('raw', key2)

      expect(Buffer.from(exported1).toString('hex')).not.toBe(
        Buffer.from(exported2).toString('hex'),
      )
    })

    test('derived key is 256 bits (32 bytes)', async () => {
      const key = await deriveKeyExtractable(TEST_ENCRYPTION_KEY, '0xabc123')
      const exported = await crypto.subtle.exportKey('raw', key)

      expect(new Uint8Array(exported).length).toBe(32)
    })
  })

  describe('Encrypt/Decrypt Round Trip', () => {
    test('can encrypt and decrypt simple string', async () => {
      const plaintext = 'Hello, World!'
      const policyHash = '0xtest123'

      const { ciphertext, iv, tag } = await encrypt(
        plaintext,
        policyHash,
        TEST_ENCRYPTION_KEY,
      )
      const decrypted = await decrypt(
        ciphertext,
        iv,
        tag,
        policyHash,
        TEST_ENCRYPTION_KEY,
      )

      expect(decrypted).toBe(plaintext)
    })

    test('can encrypt and decrypt JSON object', async () => {
      const data: DecisionData = {
        proposalId: '0x1234567890abcdef',
        approved: true,
        reasoning: 'The proposal aligns with DAO values',
        confidenceScore: 85,
        alignmentScore: 90,
        autocratVotes: [
          { role: 'TREASURY', vote: 'APPROVE', reasoning: 'Financially sound' },
          { role: 'CODE', vote: 'APPROVE', reasoning: 'Code looks good' },
        ],
        model: 'gpt-4',
        timestamp: Date.now(),
      }

      const plaintext = JSON.stringify(data)
      const policyHash = computePolicyHash([])

      const { ciphertext, iv, tag } = await encrypt(
        plaintext,
        policyHash,
        TEST_ENCRYPTION_KEY,
      )
      const decrypted = await decrypt(
        ciphertext,
        iv,
        tag,
        policyHash,
        TEST_ENCRYPTION_KEY,
      )

      expect(JSON.parse(decrypted)).toEqual(data)
    })

    test('wrong policy hash fails to decrypt', async () => {
      const plaintext = 'Secret data'
      const correctHash = '0xcorrect'
      const wrongHash = '0xwrong'

      const { ciphertext, iv, tag } = await encrypt(
        plaintext,
        correctHash,
        TEST_ENCRYPTION_KEY,
      )

      await expect(
        decrypt(ciphertext, iv, tag, wrongHash, TEST_ENCRYPTION_KEY),
      ).rejects.toThrow()
    })

    test('wrong encryption key fails to decrypt', async () => {
      const plaintext = 'Secret data'
      const policyHash = '0xtest'

      const { ciphertext, iv, tag } = await encrypt(
        plaintext,
        policyHash,
        'key-1',
      )

      await expect(
        decrypt(ciphertext, iv, tag, policyHash, 'key-2'),
      ).rejects.toThrow()
    })

    test('tampered ciphertext fails to decrypt', async () => {
      const plaintext = 'Secret data'
      const policyHash = '0xtest'

      const { ciphertext, iv, tag } = await encrypt(
        plaintext,
        policyHash,
        TEST_ENCRYPTION_KEY,
      )

      // Tamper with ciphertext
      const tamperedCiphertext = `ff${ciphertext.slice(2)}`

      await expect(
        decrypt(tamperedCiphertext, iv, tag, policyHash, TEST_ENCRYPTION_KEY),
      ).rejects.toThrow()
    })

    test('tampered tag fails to decrypt', async () => {
      const plaintext = 'Secret data'
      const policyHash = '0xtest'

      const { ciphertext, iv, tag } = await encrypt(
        plaintext,
        policyHash,
        TEST_ENCRYPTION_KEY,
      )

      // Tamper with tag
      const tamperedTag = `ff${tag.slice(2)}`

      await expect(
        decrypt(ciphertext, iv, tamperedTag, policyHash, TEST_ENCRYPTION_KEY),
      ).rejects.toThrow()
    })

    test('each encryption produces different ciphertext (random IV)', async () => {
      const plaintext = 'Same message'
      const policyHash = '0xtest'

      const result1 = await encrypt(plaintext, policyHash, TEST_ENCRYPTION_KEY)
      const result2 = await encrypt(plaintext, policyHash, TEST_ENCRYPTION_KEY)

      expect(result1.ciphertext).not.toBe(result2.ciphertext)
      expect(result1.iv).not.toBe(result2.iv)
    })

    test('can decrypt data encrypted with different IVs', async () => {
      const plaintext = 'Same message'
      const policyHash = '0xtest'

      const result1 = await encrypt(plaintext, policyHash, TEST_ENCRYPTION_KEY)
      const result2 = await encrypt(plaintext, policyHash, TEST_ENCRYPTION_KEY)

      const decrypted1 = await decrypt(
        result1.ciphertext,
        result1.iv,
        result1.tag,
        policyHash,
        TEST_ENCRYPTION_KEY,
      )
      const decrypted2 = await decrypt(
        result2.ciphertext,
        result2.iv,
        result2.tag,
        policyHash,
        TEST_ENCRYPTION_KEY,
      )

      expect(decrypted1).toBe(plaintext)
      expect(decrypted2).toBe(plaintext)
    })
  })

  describe('Time-Based Access Control', () => {
    test('cannot decrypt before 30 days', () => {
      const encryptedAt = Math.floor(Date.now() / 1000)
      const now = encryptedAt + 29 * 24 * 60 * 60 // 29 days later

      expect(canDecryptByTime(encryptedAt, now)).toBe(false)
    })

    test('can decrypt at exactly 30 days', () => {
      const encryptedAt = Math.floor(Date.now() / 1000)
      const now = encryptedAt + 30 * 24 * 60 * 60 // Exactly 30 days

      expect(canDecryptByTime(encryptedAt, now)).toBe(true)
    })

    test('can decrypt after 30 days', () => {
      const encryptedAt = Math.floor(Date.now() / 1000)
      const now = encryptedAt + 31 * 24 * 60 * 60 // 31 days later

      expect(canDecryptByTime(encryptedAt, now)).toBe(true)
    })

    test('cannot decrypt immediately', () => {
      const encryptedAt = Math.floor(Date.now() / 1000)
      const now = encryptedAt

      expect(canDecryptByTime(encryptedAt, now)).toBe(false)
    })
  })

  describe('Data Hashing', () => {
    test('same data produces same hash', () => {
      const data = 'test data'
      expect(computeDataHash(data)).toBe(computeDataHash(data))
    })

    test('different data produces different hash', () => {
      expect(computeDataHash('data1')).not.toBe(computeDataHash('data2'))
    })

    test('hash is keccak256 format (0x + 64 hex chars)', () => {
      const hash = computeDataHash('test')
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
    })
  })

  describe('Policy Hash', () => {
    test('same conditions produce same policy hash', () => {
      const conditions = createAccessConditions(
        '0x1234',
        1000000,
        COUNCIL_ADDRESS,
        CHAIN_ID,
      )

      expect(computePolicyHash(conditions)).toBe(computePolicyHash(conditions))
    })

    test('different proposal IDs produce different policy hashes', () => {
      const conditions1 = createAccessConditions(
        '0x1111',
        1000000,
        COUNCIL_ADDRESS,
        CHAIN_ID,
      )
      const conditions2 = createAccessConditions(
        '0x2222',
        1000000,
        COUNCIL_ADDRESS,
        CHAIN_ID,
      )

      expect(computePolicyHash(conditions1)).not.toBe(
        computePolicyHash(conditions2),
      )
    })

    test('different encrypt times produce different policy hashes', () => {
      const conditions1 = createAccessConditions(
        '0x1234',
        1000000,
        COUNCIL_ADDRESS,
        CHAIN_ID,
      )
      const conditions2 = createAccessConditions(
        '0x1234',
        2000000,
        COUNCIL_ADDRESS,
        CHAIN_ID,
      )

      expect(computePolicyHash(conditions1)).not.toBe(
        computePolicyHash(conditions2),
      )
    })
  })

  describe('Large Data Handling', () => {
    test('can encrypt and decrypt large JSON payload', async () => {
      const largeData: DecisionData = {
        proposalId: `0x${'a'.repeat(64)}`,
        approved: true,
        reasoning: 'A'.repeat(10000), // 10KB of reasoning
        confidenceScore: 85,
        alignmentScore: 90,
        autocratVotes: Array.from({ length: 50 }, (_, i) => ({
          role: `ROLE_${i}`,
          vote: 'APPROVE',
          reasoning: `Reasoning for role ${i}: ${'X'.repeat(200)}`,
        })),
        researchSummary: 'B'.repeat(5000),
        model: 'gpt-4-turbo',
        timestamp: Date.now(),
      }

      const plaintext = JSON.stringify(largeData)
      const policyHash = '0xlarge'

      const { ciphertext, iv, tag } = await encrypt(
        plaintext,
        policyHash,
        TEST_ENCRYPTION_KEY,
      )
      const decrypted = await decrypt(
        ciphertext,
        iv,
        tag,
        policyHash,
        TEST_ENCRYPTION_KEY,
      )

      expect(JSON.parse(decrypted)).toEqual(largeData)
    })

    test('can handle unicode characters', async () => {
      const unicodeData = {
        text: '日本語テスト 🎉 émoji ñ',
        reasoning: 'Contains unicode: αβγδ €£¥',
      }

      const plaintext = JSON.stringify(unicodeData)
      const policyHash = '0xunicode'

      const { ciphertext, iv, tag } = await encrypt(
        plaintext,
        policyHash,
        TEST_ENCRYPTION_KEY,
      )
      const decrypted = await decrypt(
        ciphertext,
        iv,
        tag,
        policyHash,
        TEST_ENCRYPTION_KEY,
      )

      expect(JSON.parse(decrypted)).toEqual(unicodeData)
    })
  })

  describe('IV and Tag Format', () => {
    test('IV is 12 bytes (24 hex chars)', async () => {
      const { iv } = await encrypt('test', '0xpolicy', TEST_ENCRYPTION_KEY)
      expect(iv.length).toBe(24)
      expect(iv).toMatch(/^[0-9a-f]{24}$/)
    })

    test('tag is 16 bytes (32 hex chars)', async () => {
      const { tag } = await encrypt('test', '0xpolicy', TEST_ENCRYPTION_KEY)
      expect(tag.length).toBe(32)
      expect(tag).toMatch(/^[0-9a-f]{32}$/)
    })

    test('ciphertext is hex encoded', async () => {
      const { ciphertext } = await encrypt(
        'test',
        '0xpolicy',
        TEST_ENCRYPTION_KEY,
      )
      expect(ciphertext).toMatch(/^[0-9a-f]+$/)
    })
  })
})
