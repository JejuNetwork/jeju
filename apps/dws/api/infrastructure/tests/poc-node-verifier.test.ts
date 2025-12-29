/**
 * PoCNodeVerifier Tests
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { type Hex, keccak256, toBytes } from 'viem'
import * as quoteParser from '../../poc/quote-parser'
import { MockPoCRegistryClient } from '../../poc/registry-client'
import type {
  PoCRegistryEntry,
  PoCVerificationLevel,
  QuoteParseResult,
  QuoteVerificationResult,
  TEEQuote,
} from '../../poc/types'
import {
  getPoCNodeVerifier,
  PoCNodeVerifier,
  shutdownPoCNodeVerifier,
} from '../poc-node-verifier'

const TEST_SALT =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex
const TEST_AGENT_ID = 12345n
const TEST_HARDWARE_ID =
  '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hex

function createTestQuote(seed = 1): Hex {
  const bytes = new Uint8Array(200)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * seed) % 256
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as Hex
}

/**
 * Create a structurally valid TDX quote (DCAP v4 format)
 * This will parse successfully but fail cryptographic verification
 */
function createValidTDXQuote(): Hex {
  // TDX quote structure:
  // - Header: 48 bytes
  // - Report Body: 584 bytes (offset 48 to 632)
  // - Signature Data Length: 4 bytes (offset 632)
  // - Signature Data: variable (offset 636)
  const sigDataLen = 68 // ECDSA signature (64) + cert data type (4)
  const totalLen = 636 + sigDataLen
  const bytes = new Uint8Array(totalLen)

  // DCAP Header (48 bytes)
  bytes[0] = 0x04 // Version 4 (little-endian)
  bytes[1] = 0x00
  bytes[2] = 0x02 // Attestation key type = ECDSA-256-with-P-256 curve
  bytes[3] = 0x00
  bytes[4] = 0x81 // TEE type = TDX (little-endian)
  bytes[5] = 0x00
  bytes[6] = 0x00
  bytes[7] = 0x00
  // Reserved (4 bytes at offset 8)
  // Intel Vendor ID (16 bytes at offset 12)
  const vendorId = '939a7233f79c4ca9940a0db3957f0607'
  for (let i = 0; i < 16; i++) {
    bytes[12 + i] = parseInt(vendorId.slice(i * 2, i * 2 + 2), 16)
  }
  // User Data (20 bytes at offset 28)

  // TDX Report Body (584 bytes starting at offset 48)
  // TEE_TCB_SVN at offset 48 (16 bytes) - set to valid TCB
  bytes[48] = 0x03 // CPU SVN
  bytes[49] = 0x04 // TCB SVN

  // Fill report body with deterministic data (not random, for reproducibility)
  for (let i = 64; i < 632; i++) {
    bytes[i] = (i * 7 + 13) % 256
  }

  // Signature data length at offset 632 (4 bytes, little-endian)
  bytes[632] = sigDataLen & 0xff
  bytes[633] = (sigDataLen >> 8) & 0xff
  bytes[634] = 0
  bytes[635] = 0

  // ECDSA signature (64 bytes: r || s)
  // Set non-zero values with high entropy to pass signature format check
  for (let i = 0; i < 64; i++) {
    bytes[636 + i] = (i * 17 + 31) % 256
  }

  // Cert data type (4 bytes) - type 5 = no certs
  bytes[700] = 5
  bytes[701] = 0
  bytes[702] = 0
  bytes[703] = 0

  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as Hex
}

function createMockParsedQuote(overrides: Partial<TEEQuote> = {}): TEEQuote {
  return {
    raw: createTestQuote(),
    platform: 'intel_tdx',
    hardwareId: TEST_HARDWARE_ID,
    measurement: '0x1234' as Hex,
    reportData: '0x5678' as Hex,
    securityVersion: { cpu: 3, tcb: 4 },
    signature: '0xsig' as Hex,
    certChain: [],
    timestamp: Date.now(),
    ...overrides,
  }
}

function createMockEntry(
  overrides: Partial<PoCRegistryEntry> = {},
): PoCRegistryEntry {
  return {
    hardwareIdHash: `0x${'ab'.repeat(32)}` as Hex,
    level: 2 as PoCVerificationLevel,
    cloudProvider: 'aws',
    region: 'us-east-1',
    evidenceHashes: ['ipfs://Qm123'],
    endorsements: [],
    verifiedAt: Date.now() - 86400000,
    lastVerifiedAt: Date.now(),
    monitoringCadence: 3600,
    active: true,
    ...overrides,
  }
}

interface TestSetup {
  verifier: PoCNodeVerifier
  mockRegistry: MockPoCRegistryClient
  mockParseQuote: ReturnType<typeof spyOn>
  mockVerifyQuote: ReturnType<typeof spyOn>
  mockHashHardwareId: ReturnType<typeof spyOn>
}

function createTestVerifier(cacheTtlMs = 100): TestSetup {
  const mockRegistry = new MockPoCRegistryClient()
  const verifier = new PoCNodeVerifier({
    hardwareIdSalt: TEST_SALT,
    cacheTtlMs,
  })

  // @ts-expect-error - accessing private for testing
  verifier.registryClient = mockRegistry

  return {
    verifier,
    mockRegistry,
    mockParseQuote: spyOn(quoteParser, 'parseQuote'),
    mockVerifyQuote: spyOn(quoteParser, 'verifyQuote'),
    mockHashHardwareId: spyOn(quoteParser, 'hashHardwareId'),
  }
}

function setupSuccessfulQuote(
  setup: TestSetup,
  hardwareId: Hex = TEST_HARDWARE_ID,
): Hex {
  const parsedQuote = createMockParsedQuote({ hardwareId })
  const hash = `0x${keccak256(toBytes(hardwareId + TEST_SALT)).slice(2)}` as Hex

  setup.mockParseQuote.mockReturnValue({
    success: true,
    quote: parsedQuote,
    error: null,
  } as QuoteParseResult)
  setup.mockVerifyQuote.mockResolvedValue({
    valid: true,
    quote: parsedQuote,
    certificateValid: true,
    signatureValid: true,
    measurementMatch: true,
    tcbStatus: 'upToDate',
    error: null,
  } as QuoteVerificationResult)
  setup.mockHashHardwareId.mockReturnValue(hash)

  return hash
}

function setupFailedParsing(setup: TestSetup, error = 'Quote too short'): void {
  setup.mockParseQuote.mockReturnValue({
    success: false,
    quote: null,
    error,
  } as QuoteParseResult)
}

function setupFailedVerification(
  setup: TestSetup,
  error = 'Invalid signature',
): void {
  const parsedQuote = createMockParsedQuote()
  setup.mockParseQuote.mockReturnValue({
    success: true,
    quote: parsedQuote,
    error: null,
  } as QuoteParseResult)
  setup.mockVerifyQuote.mockResolvedValue({
    valid: false,
    quote: parsedQuote,
    certificateValid: false,
    signatureValid: false,
    measurementMatch: true,
    tcbStatus: 'upToDate',
    error,
  } as QuoteVerificationResult)
}

describe('PoCNodeVerifier', () => {
  let setup: TestSetup

  beforeEach(() => {
    setup = createTestVerifier()
  })

  afterEach(() => {
    shutdownPoCNodeVerifier()
    setup.mockParseQuote.mockRestore()
    setup.mockVerifyQuote.mockRestore()
    setup.mockHashHardwareId.mockRestore()
  })

  describe('integration (real quote parsing)', () => {
    // These tests use REAL parseQuote/verifyQuote, not mocks
    // They verify the full flow including cryptographic validation

    test('real TDX quote parsing flows through verifier', async () => {
      // Create a valid-structure TDX quote (DCAP v4)
      const tdxQuote = createValidTDXQuote()

      // Don't mock parseQuote - use real implementation
      setup.mockParseQuote.mockRestore()
      setup.mockVerifyQuote.mockRestore()
      setup.mockHashHardwareId.mockRestore()

      // The verifier should parse the quote and fail on cert chain validation
      // (we don't have a real Intel cert chain)
      const result = await setup.verifier.verifyNode(TEST_AGENT_ID, tdxQuote)

      // Quote should parse successfully but verification should fail
      // (no valid certificate chain)
      expect(result.verified).toBe(false)
      expect(result.error).toContain('verification failed')
      expect(result.reputationDelta).toBe(-10) // Failed verification penalty
    })

    test('malformed quote fails immediately', async () => {
      setup.mockParseQuote.mockRestore()
      setup.mockVerifyQuote.mockRestore()
      setup.mockHashHardwareId.mockRestore()

      const badQuote = '0x1234' as Hex // Too short
      const result = await setup.verifier.verifyNode(TEST_AGENT_ID, badQuote)

      expect(result.verified).toBe(false)
      expect(result.error).toContain('parse')
      expect(result.reputationDelta).toBe(-10)
    })

    test('valid quote structure with wrong measurement fails', async () => {
      const tdxQuote = createValidTDXQuote()
      setup.mockParseQuote.mockRestore()
      setup.mockVerifyQuote.mockRestore()
      setup.mockHashHardwareId.mockRestore()

      // Pass expected measurement that won't match
      const wrongMeasurement = `0x${'ff'.repeat(48)}` as Hex
      const result = await setup.verifier.verifyNode(
        TEST_AGENT_ID,
        tdxQuote,
        wrongMeasurement,
      )

      expect(result.verified).toBe(false)
      // Should fail on measurement or cert chain
      expect(result.error).toBeTruthy()
    })
  })

  describe('verification', () => {
    test('level 1 gives +10 rep', async () => {
      const hash = setupSuccessfulQuote(setup)
      setup.mockRegistry.addMockEntry(
        createMockEntry({ hardwareIdHash: hash, level: 1 }),
      )

      const result = await setup.verifier.verifyNode(
        TEST_AGENT_ID,
        createTestQuote(),
      )

      expect(result.verified).toBe(true)
      expect(result.level).toBe(1)
      expect(result.reputationDelta).toBe(10)
    })

    test('level 2 gives +15 rep', async () => {
      const hash = setupSuccessfulQuote(setup)
      setup.mockRegistry.addMockEntry(
        createMockEntry({ hardwareIdHash: hash, level: 2 }),
      )

      const result = await setup.verifier.verifyNode(
        TEST_AGENT_ID,
        createTestQuote(),
      )

      expect(result.verified).toBe(true)
      expect(result.level).toBe(2)
      expect(result.reputationDelta).toBe(15)
    })

    test('level 3 gives +25 rep', async () => {
      const hash = setupSuccessfulQuote(setup)
      setup.mockRegistry.addMockEntry(
        createMockEntry({ hardwareIdHash: hash, level: 3 }),
      )

      const result = await setup.verifier.verifyNode(
        TEST_AGENT_ID,
        createTestQuote(),
      )

      expect(result.verified).toBe(true)
      expect(result.level).toBe(3)
      expect(result.reputationDelta).toBe(25)
    })

    test('includes provider and region', async () => {
      const hash = setupSuccessfulQuote(setup)
      setup.mockRegistry.addMockEntry(
        createMockEntry({
          hardwareIdHash: hash,
          cloudProvider: 'gcp',
          region: 'us-central1',
        }),
      )

      const result = await setup.verifier.verifyNode(
        TEST_AGENT_ID,
        createTestQuote(),
      )

      expect(result.cloudProvider).toBe('gcp')
      expect(result.region).toBe('us-central1')
    })
  })

  describe('failures', () => {
    test('parse failure gives -10 rep', async () => {
      setupFailedParsing(setup, 'Quote too short: 5 bytes')

      const result = await setup.verifier.verifyNode(
        TEST_AGENT_ID,
        createTestQuote(),
      )

      expect(result.verified).toBe(false)
      expect(result.error).toContain('Failed to parse')
      expect(result.reputationDelta).toBe(-10)
    })

    test('verification failure gives -10 rep', async () => {
      setupFailedVerification(setup, 'Invalid certificate chain')

      const result = await setup.verifier.verifyNode(
        TEST_AGENT_ID,
        createTestQuote(),
      )

      expect(result.verified).toBe(false)
      expect(result.error).toContain('verification failed')
      expect(result.reputationDelta).toBe(-10)
    })

    test('unregistered hardware gives 0 rep delta', async () => {
      const hash = setupSuccessfulQuote(setup)

      const result = await setup.verifier.verifyNode(
        TEST_AGENT_ID,
        createTestQuote(),
      )

      expect(result.verified).toBe(false)
      expect(result.error).toBe('Hardware not registered in cloud alliance')
      expect(result.reputationDelta).toBe(0)
      expect(result.hardwareIdHash).toBe(hash)
    })

    test('revoked hardware gives -50 rep', async () => {
      const hash = setupSuccessfulQuote(setup)
      setup.mockRegistry.addMockEntry(
        createMockEntry({ hardwareIdHash: hash, active: true }),
      )
      setup.mockRegistry.addMockRevocation({
        hardwareIdHash: hash,
        reason: 'Compromised',
        evidenceHash: '0x' as Hex,
        timestamp: Date.now(),
        approvers: ['admin'],
      })

      const result = await setup.verifier.verifyNode(
        TEST_AGENT_ID,
        createTestQuote(),
      )

      expect(result.verified).toBe(false)
      expect(result.error).toContain('revoked')
      expect(result.reputationDelta).toBe(-50)
    })
  })

  describe('caching', () => {
    test('returns cached result', async () => {
      setup = createTestVerifier(60000)
      const hash = setupSuccessfulQuote(setup)
      setup.mockRegistry.addMockEntry(
        createMockEntry({ hardwareIdHash: hash, level: 2 }),
      )

      const quote = createTestQuote()
      const result1 = await setup.verifier.verifyNode(TEST_AGENT_ID, quote)

      setup.mockParseQuote.mockClear()
      // @ts-expect-error - accessing private
      setup.mockRegistry.mockEntries.delete(hash)

      const result2 = await setup.verifier.verifyNode(TEST_AGENT_ID, quote)
      expect(result2).toEqual(result1)
      expect(setup.mockParseQuote).not.toHaveBeenCalled()
    })

    test('cache expires', async () => {
      setup = createTestVerifier(50)
      const hash = setupSuccessfulQuote(setup)
      setup.mockRegistry.addMockEntry(
        createMockEntry({ hardwareIdHash: hash, level: 2 }),
      )

      const quote = createTestQuote()
      await setup.verifier.verifyNode(TEST_AGENT_ID, quote)

      await new Promise((r) => setTimeout(r, 60))
      // @ts-expect-error - accessing private
      setup.mockRegistry.mockEntries.delete(hash)

      const result = await setup.verifier.verifyNode(TEST_AGENT_ID, quote)
      expect(result.verified).toBe(false)
    })

    test('clearCache removes agent entries', async () => {
      setup = createTestVerifier(60000)
      const hash = setupSuccessfulQuote(setup)
      setup.mockRegistry.addMockEntry(createMockEntry({ hardwareIdHash: hash }))

      const quote = createTestQuote()
      await setup.verifier.verifyNode(1n, quote)
      await setup.verifier.verifyNode(2n, quote)

      setup.verifier.clearCache(1n)

      // @ts-expect-error - accessing private
      const keys = Array.from(setup.verifier.cache.keys())
      expect(keys.some((k) => k.startsWith('1:'))).toBe(false)
      expect(keys.some((k) => k.startsWith('2:'))).toBe(true)
    })
  })

  describe('events', () => {
    test('emits poc_verified on success', async () => {
      const hash = setupSuccessfulQuote(setup)
      setup.mockRegistry.addMockEntry(
        createMockEntry({ hardwareIdHash: hash, level: 2 }),
      )

      const events: unknown[] = []
      setup.verifier.onEvent((e) => events.push(e))

      await setup.verifier.verifyNode(TEST_AGENT_ID, createTestQuote())

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'node:poc_verified', level: 2 })
    })

    test('emits poc_failed on failure', async () => {
      setupFailedParsing(setup)

      const events: unknown[] = []
      setup.verifier.onEvent((e) => events.push(e))

      await setup.verifier.verifyNode(TEST_AGENT_ID, createTestQuote())

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'node:poc_failed' })
    })

    test('unsubscribe works', async () => {
      setupFailedParsing(setup)

      const events: unknown[] = []
      const unsub = setup.verifier.onEvent((e) => events.push(e))
      unsub()

      await setup.verifier.verifyNode(TEST_AGENT_ID, createTestQuote())
      expect(events).toHaveLength(0)
    })

    test('handler errors are isolated', async () => {
      const hash = setupSuccessfulQuote(setup)
      setup.mockRegistry.addMockEntry(createMockEntry({ hardwareIdHash: hash }))

      let goodCalled = false
      setup.verifier.onEvent(() => {
        throw new Error('boom')
      })
      setup.verifier.onEvent(() => {
        goodCalled = true
      })

      const result = await setup.verifier.verifyNode(
        TEST_AGENT_ID,
        createTestQuote(),
      )
      await new Promise((r) => setTimeout(r, 10))

      expect(result.verified).toBe(true)
      expect(goodCalled).toBe(true)
    })
  })

  describe('batch', () => {
    test('verifyNodes processes all', async () => {
      const hash = setupSuccessfulQuote(setup)
      setup.mockRegistry.addMockEntry(createMockEntry({ hardwareIdHash: hash }))

      const quote = createTestQuote()
      const results = await setup.verifier.verifyNodes([
        { agentId: 1n, quote },
        { agentId: 2n, quote },
        { agentId: 3n, quote },
      ])

      expect(results.size).toBe(3)
      expect(results.get('1')?.verified).toBe(true)
      expect(results.get('2')?.verified).toBe(true)
      expect(results.get('3')?.verified).toBe(true)
    })

    test('handles empty array', async () => {
      const results = await setup.verifier.verifyNodes([])
      expect(results.size).toBe(0)
    })
  })

  describe('singleton', () => {
    test('getPoCNodeVerifier returns same instance', () => {
      const orig = process.env.JEJU_NETWORK
      process.env.JEJU_NETWORK = 'localnet'

      try {
        shutdownPoCNodeVerifier()
        expect(getPoCNodeVerifier()).toBe(getPoCNodeVerifier())
      } finally {
        process.env.JEJU_NETWORK = orig
      }
    })

    test('shutdown clears instance', () => {
      const orig = process.env.JEJU_NETWORK
      process.env.JEJU_NETWORK = 'localnet'

      try {
        shutdownPoCNodeVerifier()
        const v1 = getPoCNodeVerifier()
        shutdownPoCNodeVerifier()
        const v2 = getPoCNodeVerifier()
        expect(v1).not.toBe(v2)
      } finally {
        process.env.JEJU_NETWORK = orig
      }
    })

    test('mainnet requires HARDWARE_ID_SALT', () => {
      const origNet = process.env.JEJU_NETWORK
      const origSalt = process.env.HARDWARE_ID_SALT

      try {
        process.env.JEJU_NETWORK = 'mainnet'
        delete process.env.HARDWARE_ID_SALT
        expect(() => PoCNodeVerifier.fromEnv()).toThrow('HARDWARE_ID_SALT')
      } finally {
        process.env.JEJU_NETWORK = origNet
        if (origSalt) process.env.HARDWARE_ID_SALT = origSalt
      }
    })
  })

  describe('on-chain methods', () => {
    test('getNodePoCStatus throws when PoC not initialized', async () => {
      // POC_SIGNER_KEY not set means getAgentPoCStatus will throw
      await expect(
        setup.verifier.getNodePoCStatus(TEST_AGENT_ID),
      ).rejects.toThrow('not initialized')
    })

    test('isNodeVerified throws when PoC not initialized', async () => {
      // isAgentPoCVerified now throws when verifier not initialized
      await expect(
        setup.verifier.isNodeVerified(TEST_AGENT_ID),
      ).rejects.toThrow('not initialized')
    })

    test('needsReverification delegates to registry', async () => {
      // MockPoCRegistryClient.needsReverification returns true for unknown agents
      const result = await setup.verifier.needsReverification(TEST_AGENT_ID)
      expect(result).toBe(true)
    })
  })

  describe('deduplication', () => {
    test('concurrent requests share single verification', async () => {
      const hash = setupSuccessfulQuote(setup)
      let checkCalls = 0
      const originalCheckHardware = setup.mockRegistry.checkHardware.bind(
        setup.mockRegistry,
      )
      setup.mockRegistry.checkHardware = async (h: Hex) => {
        checkCalls++
        await new Promise((r) => setTimeout(r, 50)) // Slow response
        return originalCheckHardware(h)
      }
      setup.mockRegistry.addMockEntry(createMockEntry({ hardwareIdHash: hash }))

      const quote = createTestQuote()
      // Start 5 concurrent verifications
      const promises = Array.from({ length: 5 }, () =>
        setup.verifier.verifyNode(TEST_AGENT_ID, quote),
      )
      const results = await Promise.all(promises)

      // Only one actual verification should have happened
      expect(checkCalls).toBe(1)
      // All results should be identical
      expect(results.every((r) => r.verified)).toBe(true)
    })
  })

  describe('retry behavior', () => {
    test('retries on registry failure and succeeds', async () => {
      const hash = setupSuccessfulQuote(setup)
      let calls = 0
      const originalCheckHardware = setup.mockRegistry.checkHardware.bind(
        setup.mockRegistry,
      )
      setup.mockRegistry.checkHardware = async (h: Hex) => {
        calls++
        if (calls < 2) throw new Error('Transient failure')
        return originalCheckHardware(h)
      }
      setup.mockRegistry.addMockEntry(createMockEntry({ hardwareIdHash: hash }))

      const result = await setup.verifier.verifyNode(
        TEST_AGENT_ID,
        createTestQuote(),
      )

      expect(calls).toBe(2) // Failed once, succeeded on retry
      expect(result.verified).toBe(true)
    })

    test('fails after max retries exhausted', async () => {
      const hash = setupSuccessfulQuote(setup)
      setup.mockRegistry.checkHardware = async () => {
        throw new Error('Persistent failure')
      }

      const result = await setup.verifier.verifyNode(
        TEST_AGENT_ID,
        createTestQuote(),
      )

      expect(result.verified).toBe(false)
      expect(result.error).toContain('Registry unavailable')
      expect(result.hardwareIdHash).toBe(hash)
    })
  })

  describe('edge cases', () => {
    test('handles max uint64 agent ID', async () => {
      const hash = setupSuccessfulQuote(setup)
      setup.mockRegistry.addMockEntry(createMockEntry({ hardwareIdHash: hash }))

      const result = await setup.verifier.verifyNode(
        BigInt('18446744073709551615'),
        createTestQuote(),
      )
      expect(result.verified).toBe(true)
    })

    test('unknown level gives 0 rep delta', async () => {
      const hash = setupSuccessfulQuote(setup)
      setup.mockRegistry.addMockEntry(
        createMockEntry({
          hardwareIdHash: hash,
          level: 99 as PoCVerificationLevel,
        }),
      )

      const result = await setup.verifier.verifyNode(
        TEST_AGENT_ID,
        createTestQuote(),
      )

      expect(result.verified).toBe(true)
      expect(result.level).toBe(99)
      expect(result.reputationDelta).toBe(0)
    })
  })
})
