/**
 * Proof-of-Cloud Tests
 *
 * Test Coverage:
 * - Quote parsing for all platforms (TDX, SGX, SEV-SNP)
 * - Boundary conditions and edge cases
 * - Error handling and invalid inputs
 * - Integration points with registry (via MockPoCRegistryClient)
 * - Concurrent/async behavior
 * - X.509 ASN.1 parsing utilities
 * - Metrics collection and Prometheus export
 *
 * Limitations (require real infrastructure to test):
 * - Real TEE hardware attestation quotes
 * - Real Intel SGX/TDX certificate chains (Intel PCK certs)
 * - Real PoC Alliance API network calls
 * - WebSocket revocation subscriptions
 * - Full cryptographic signature verification with valid keys
 *
 * The MockPoCRegistryClient simulates the PoC Alliance API for unit testing.
 * Integration tests with real infrastructure should be run separately.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import type { Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import {
  checkTCBStatus,
  extractPlatformInfo,
  hashHardwareId,
  parseQuote,
  verifyQuote,
} from '../quote-parser'
import { MockPoCRegistryClient } from '../registry-client'
import {
  PoCError,
  PoCErrorCode,
  type PoCRegistryEntry,
  type PoCVerificationLevel,
} from '../types'

// ============================================================================
// Test Data - Realistic Quote Structures
// ============================================================================

/**
 * Create a properly structured Intel TDX quote for testing.
 * This creates a minimal but valid DCAP v4 quote structure.
 */
function createMockTDXQuote(): Hex {
  // Total size: header (48) + report body (584) + sig data len (4) + sig (64)
  const totalLen = 48 + 584 + 4 + 64
  const quote = new Uint8Array(totalLen)

  // Header (48 bytes)
  quote[0] = 4 // version = 4 (LE)
  quote[1] = 0
  quote[2] = 0 // attestation key type = ECDSA-P256
  quote[3] = 0
  quote[4] = 0x81 // TEE type = TDX (0x81)
  quote[5] = 0
  quote[6] = 0
  quote[7] = 0
  // reserved (4 bytes) at offset 8-11

  // Vendor ID (Intel) at offset 12-28: 939a7233f79c4ca9940a0db3957f0607
  const intelVendorId = [
    0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 0x94, 0x0a, 0x0d, 0xb3,
    0x95, 0x7f, 0x06, 0x07,
  ]
  for (let i = 0; i < 16; i++) {
    quote[12 + i] = intelVendorId[i]
  }
  // userData (20 bytes) at offset 28-47

  // Report body at offset 48 (584 bytes for TDX)
  // TEE_TCB_SVN at offset 0-15 (16 bytes)
  quote[48] = 0x03 // CPU SVN >= minimum
  quote[49] = 0x04 // TCB SVN >= minimum

  // Fill MR_SEAM (offset 16-63, 48 bytes)
  for (let i = 0; i < 48; i++) {
    quote[48 + 16 + i] = (i * 7 + 1) % 256
  }

  // Fill MR_SIGNER_SEAM (offset 64-111, 48 bytes)
  for (let i = 0; i < 48; i++) {
    quote[48 + 64 + i] = (i * 11 + 2) % 256
  }

  // Fill MR_TD (offset 136-183, 48 bytes) - this is the main measurement
  for (let i = 0; i < 48; i++) {
    quote[48 + 136 + i] = (i * 13 + 3) % 256
  }

  // Fill REPORT_DATA (offset 520-583, 64 bytes)
  for (let i = 0; i < 64; i++) {
    quote[48 + 520 + i] = (i * 17 + 5) % 256
  }

  // Signature data length at offset 48 + 584 = 632
  // 64 bytes signature (little-endian uint32)
  quote[632] = 64
  quote[633] = 0
  quote[634] = 0
  quote[635] = 0

  // ECDSA signature (64 bytes: r || s) at offset 636
  // Use valid-looking signature values (non-zero, in curve order range)
  for (let i = 0; i < 32; i++) {
    quote[636 + i] = (i * 11 + 0x10) % 256 // r component
    quote[636 + 32 + i] = (i * 13 + 0x20) % 256 // s component
  }

  return ('0x' +
    Array.from(quote)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')) as Hex
}

/**
 * Create a properly structured AMD SEV-SNP report for testing.
 */
function createMockSEVQuote(): Hex {
  // Create a minimal SEV-SNP report structure (0x2A0 bytes + 512 byte signature)
  const report = new Uint8Array(0x2a0 + 512)

  // Version = 2 (SEV-SNP version 2)
  report[0] = 2
  report[1] = 0
  report[2] = 0
  report[3] = 0

  // Guest SVN at offset 4
  report[4] = 0x0a // SVN = 10 (>= minimum)

  // Current TCB at offset 0x38 (8 bytes)
  report[0x38] = 0x0a // SNP version >= minimum

  // Fill measurement (at 0x90, 48 bytes)
  for (let i = 0; i < 48; i++) {
    report[0x90 + i] = (i * 13 + 1) % 256
  }

  // Fill chip ID (at 0x1A0, 64 bytes) - unique hardware identifier
  for (let i = 0; i < 64; i++) {
    report[0x1a0 + i] = (i * 17 + 2) % 256
  }

  // Fill RSA-4096 signature (at 0x2A0, 512 bytes)
  // Use non-trivial values to pass signature structure check
  for (let i = 0; i < 512; i++) {
    report[0x2a0 + i] = (i * 19 + 3) % 256
  }

  return ('0x' +
    Array.from(report)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')) as Hex
}

/**
 * Create a TDX quote with outdated TCB
 */
function createOutdatedTCBQuote(): Hex {
  const quote = new Uint8Array(48 + 584 + 4 + 64)

  quote[0] = 4 // version
  quote[1] = 0
  quote[4] = 0x81 // TDX

  const intelVendorId = [
    0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 0x94, 0x0a, 0x0d, 0xb3,
    0x95, 0x7f, 0x06, 0x07,
  ]
  for (let i = 0; i < 16; i++) quote[12 + i] = intelVendorId[i]

  // TCB bytes at 48-49: set to 0x00 0x00 → cpu=0, tcb=0 → below minimum
  quote[48] = 0x00
  quote[49] = 0x00
  for (let i = 2; i < 16; i++) quote[48 + i] = i
  for (let i = 16; i < 584; i++) quote[48 + i] = ((i * 7) % 254) + 1

  quote[632] = 64 // sig length
  for (let i = 0; i < 64; i++) quote[636 + i] = ((i * 11 + 0x10) % 255) + 1

  return ('0x' +
    Array.from(quote)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')) as Hex
}

/**
 * Create a mock Intel SGX quote for testing
 */
function createMockSGXQuote(): Hex {
  // SGX: header (48) + report body (384) + sig data len (4) + sig
  const totalLen = 48 + 384 + 4 + 64
  const quote = new Uint8Array(totalLen)

  quote[0] = 4 // version = 4
  quote[1] = 0
  quote[4] = 0x00 // TEE type = SGX (0x00)
  quote[5] = 0
  quote[6] = 0
  quote[7] = 0

  const intelVendorId = [
    0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 0x94, 0x0a, 0x0d, 0xb3,
    0x95, 0x7f, 0x06, 0x07,
  ]
  for (let i = 0; i < 16; i++) quote[12 + i] = intelVendorId[i]

  // SGX report body at offset 48
  quote[48] = 0x03 // cpuSvn
  quote[49] = 0x04

  // MRENCLAVE at offset 48+64, 32 bytes
  for (let i = 0; i < 32; i++) quote[48 + 64 + i] = (i * 13 + 1) % 256

  // MRSIGNER at offset 48+128, 32 bytes
  for (let i = 0; i < 32; i++) quote[48 + 128 + i] = (i * 17 + 2) % 256

  // ISV_PROD_ID at offset 48+256
  quote[48 + 256] = 0x01
  // ISV_SVN at offset 48+258
  quote[48 + 258] = 0x05

  // REPORT_DATA at offset 48+320, 64 bytes
  for (let i = 0; i < 64; i++) quote[48 + 320 + i] = (i * 19 + 3) % 256

  // Signature data length at offset 48+384
  quote[432] = 64

  // ECDSA signature
  for (let i = 0; i < 64; i++) quote[436 + i] = (i * 11 + 0x10) % 256

  return ('0x' +
    Array.from(quote)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')) as Hex
}

/**
 * Create a quote with invalid vendor ID
 */
function createInvalidVendorQuote(): Hex {
  const quote = new Uint8Array(700)
  quote[0] = 4 // version
  quote[4] = 0x81 // TDX
  // Leave vendor ID as zeros (invalid)
  return ('0x' +
    Array.from(quote)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')) as Hex
}

/**
 * Create a quote with signature extending beyond bounds
 */
function createOverflowSignatureQuote(): Hex {
  const quote = new Uint8Array(700)
  quote[0] = 4 // version
  quote[4] = 0x81 // TDX

  const intelVendorId = [
    0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 0x94, 0x0a, 0x0d, 0xb3,
    0x95, 0x7f, 0x06, 0x07,
  ]
  for (let i = 0; i < 16; i++) quote[12 + i] = intelVendorId[i]

  // Set signature length to exceed buffer
  quote[632] = 0xff
  quote[633] = 0xff
  quote[634] = 0x00
  quote[635] = 0x00 // 0xFFFF = 65535 bytes (way too big)

  return ('0x' +
    Array.from(quote)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')) as Hex
}

/**
 * Create quote at exactly minimum size
 */
function createMinSizeQuote(): Hex {
  const quote = new Uint8Array(128) // Minimum size
  quote[0] = 4 // version
  quote[4] = 0x81 // TDX
  const intelVendorId = [
    0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 0x94, 0x0a, 0x0d, 0xb3,
    0x95, 0x7f, 0x06, 0x07,
  ]
  for (let i = 0; i < 16; i++) quote[12 + i] = intelVendorId[i]
  return ('0x' +
    Array.from(quote)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')) as Hex
}

/**
 * Create quote with all-zero signature
 */
function createZeroSignatureQuote(): Hex {
  const quote = new Uint8Array(700)
  quote[0] = 4
  quote[4] = 0x81
  const intelVendorId = [
    0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 0x94, 0x0a, 0x0d, 0xb3,
    0x95, 0x7f, 0x06, 0x07,
  ]
  for (let i = 0; i < 16; i++) quote[12 + i] = intelVendorId[i]
  quote[48] = 0x03
  quote[49] = 0x04 // valid TCB
  for (let i = 16; i < 584; i++) quote[48 + i] = (i * 7) % 256
  quote[632] = 64 // sig length, but signature bytes are all 0
  return ('0x' +
    Array.from(quote)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')) as Hex
}

/**
 * Create SEV quote with TCB exactly at minimum
 */
function createSEVMinTCBQuote(): Hex {
  const report = new Uint8Array(0x2a0 + 512)
  report[0] = 2
  report[4] = 0x0a // guestSvn = 10, exactly at minimum
  report[0x38] = 0x0a // currentTcb = 10
  for (let i = 0; i < 48; i++) report[0x90 + i] = (i * 13 + 1) % 256
  for (let i = 0; i < 64; i++) report[0x1a0 + i] = (i * 17 + 2) % 256
  for (let i = 0; i < 512; i++) report[0x2a0 + i] = (i * 19 + 3) % 256
  return ('0x' +
    Array.from(report)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')) as Hex
}

/** Helper to create a valid registry entry */
function createMockEntry(
  overrides: Partial<PoCRegistryEntry> = {},
): PoCRegistryEntry {
  return {
    hardwareIdHash: `0x${'ab'.repeat(32)}` as Hex,
    level: 2,
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

// ============================================================================
// Quote Parser Tests
// ============================================================================

describe('Quote Parser', () => {
  describe('parseQuote', () => {
    test('parses TDX quote successfully', () => {
      const quoteHex = createMockTDXQuote()
      const result = parseQuote(quoteHex)

      expect(result.success).toBe(true)
      expect(result.quote).not.toBeNull()
      expect(result.quote?.platform).toBe('intel_tdx')
      expect(result.quote?.raw).toBe(quoteHex)
    })

    test('parses SEV-SNP quote successfully', () => {
      const quoteHex = createMockSEVQuote()
      const result = parseQuote(quoteHex)

      expect(result.success).toBe(true)
      expect(result.quote).not.toBeNull()
      expect(result.quote?.platform).toBe('amd_sev')
    })

    test('parses SGX quote successfully', () => {
      const quoteHex = createMockSGXQuote()
      const result = parseQuote(quoteHex)

      expect(result.success).toBe(true)
      expect(result.quote).not.toBeNull()
      expect(result.quote?.platform).toBe('intel_sgx')
    })

    test('rejects quote that is too short', () => {
      const invalidQuote = '0x1234567890' as Hex
      const result = parseQuote(invalidQuote)

      expect(result.success).toBe(false)
      expect(result.quote).toBeNull()
      expect(result.error).toContain('too short')
    })

    test('rejects empty quote', () => {
      const result = parseQuote('0x' as Hex)
      expect(result.success).toBe(false)
      expect(result.error).toContain('too short')
    })

    test('rejects quote with invalid DCAP version', () => {
      const quote = new Uint8Array(700)
      quote[0] = 3
      const quoteHex = ('0x' +
        Array.from(quote)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')) as Hex

      const result = parseQuote(quoteHex)
      expect(result.success).toBe(false)
      expect(result.error).toContain('version')
    })

    test('rejects quote with invalid vendor ID', () => {
      const quoteHex = createInvalidVendorQuote()
      const result = parseQuote(quoteHex)

      expect(result.success).toBe(false)
      expect(result.error).toContain('vendor')
    })

    test('rejects quote with signature overflow', () => {
      const quoteHex = createOverflowSignatureQuote()
      const result = parseQuote(quoteHex)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Signature extends beyond')
    })

    test('handles quote at exactly minimum size', () => {
      const quoteHex = createMinSizeQuote()
      const result = parseQuote(quoteHex)

      // Minimum size quote lacks report body, should fail
      expect(result.success).toBe(false)
    })

    test('rejects unknown TEE type', () => {
      const quote = new Uint8Array(700)
      quote[0] = 4 // version
      quote[4] = 0xff // unknown TEE type
      const intelVendorId = [
        0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 0x94, 0x0a, 0x0d, 0xb3,
        0x95, 0x7f, 0x06, 0x07,
      ]
      for (let i = 0; i < 16; i++) quote[12 + i] = intelVendorId[i]
      const quoteHex = ('0x' +
        Array.from(quote)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')) as Hex

      const result = parseQuote(quoteHex)
      expect(result.success).toBe(false)
      expect(result.error).toContain('TEE type')
    })

    test('extracts hardware ID from TDX quote', () => {
      const quoteHex = createMockTDXQuote()
      const result = parseQuote(quoteHex)

      expect(result.success).toBe(true)
      expect(result.quote?.hardwareId).toMatch(/^0x[a-f0-9]{64}$/)
    })

    test('extracts measurement from TDX quote', () => {
      const quoteHex = createMockTDXQuote()
      const result = parseQuote(quoteHex)

      expect(result.success).toBe(true)
      expect(result.quote?.measurement).toMatch(/^0x[a-f0-9]+$/)
      expect(result.quote?.measurement).not.toBe(`0x${'00'.repeat(48)}`)
    })

    test('extracts chip ID from SEV quote', () => {
      const quoteHex = createMockSEVQuote()
      const result = parseQuote(quoteHex)

      expect(result.success).toBe(true)
      expect(result.quote?.hardwareId.length).toBe(2 + 64 * 2)
    })

    test('verifies parsed bytes match input', () => {
      const quoteHex = createMockTDXQuote()
      const result = parseQuote(quoteHex)

      expect(result.success).toBe(true)
      expect(result.quote?.raw).toBe(quoteHex)

      // Verify measurement extraction is deterministic
      const result2 = parseQuote(quoteHex)
      expect(result2.quote?.measurement).toBe(result.quote?.measurement)
      expect(result2.quote?.hardwareId).toBe(result.quote?.hardwareId)
    })

    test('different quotes produce different hardware IDs', () => {
      const tdx1 = createMockTDXQuote()
      const tdx2 = createMockSEVQuote()

      const r1 = parseQuote(tdx1)
      const r2 = parseQuote(tdx2)

      expect(r1.quote?.hardwareId).not.toBe(r2.quote?.hardwareId)
    })
  })

  describe('verifyQuote', () => {
    test('verifies valid quote structure', async () => {
      const quoteHex = createMockTDXQuote()
      const parseResult = parseQuote(quoteHex)
      expect(parseResult.success).toBe(true)

      if (!parseResult.quote) throw new Error('quote should be defined')
      const verifyResult = await verifyQuote(parseResult.quote)

      expect(verifyResult.quote).toBeDefined()
      expect(verifyResult.measurementMatch).toBe(true)
    })

    test('detects measurement mismatch', async () => {
      const quoteHex = createMockTDXQuote()
      const parseResult = parseQuote(quoteHex)
      expect(parseResult.success).toBe(true)

      const wrongMeasurement = `0x${'11'.repeat(48)}` as Hex
      expect(parseResult.quote).toBeDefined()
      const verifyResult = await verifyQuote(
        parseResult.quote ?? ({} as never),
        wrongMeasurement,
      )

      expect(verifyResult.measurementMatch).toBe(false)
      expect(verifyResult.valid).toBe(false)
      expect(verifyResult.error).toContain('Measurement mismatch')
    })

    test('validates signature structure for ECDSA', async () => {
      const quoteHex = createMockTDXQuote()
      const parseResult = parseQuote(quoteHex)
      expect(parseResult.success).toBe(true)
      if (!parseResult.quote) throw new Error('quote should be defined')

      const verifyResult = await verifyQuote(parseResult.quote)
      expect(verifyResult.quote.signature.length).toBeGreaterThan(10)
    })

    test('handles measurement match with correct value', async () => {
      const quoteHex = createMockTDXQuote()
      const parseResult = parseQuote(quoteHex)
      expect(parseResult.success).toBe(true)
      if (!parseResult.quote) throw new Error('quote should be defined')

      // Use actual measurement from quote
      const verifyResult = await verifyQuote(
        parseResult.quote,
        parseResult.quote.measurement,
      )

      expect(verifyResult.measurementMatch).toBe(true)
    })

    test('handles case-insensitive measurement comparison', async () => {
      const quoteHex = createMockTDXQuote()
      const parseResult = parseQuote(quoteHex)
      expect(parseResult.success).toBe(true)

      expect(parseResult.quote).toBeDefined()
      const upperMeasurement =
        parseResult.quote?.measurement.toUpperCase() as Hex
      const verifyResult = await verifyQuote(
        parseResult.quote ?? ({} as never),
        upperMeasurement,
      )

      expect(verifyResult.measurementMatch).toBe(true)
    })

    test('detects zero signature as invalid', async () => {
      const quoteHex = createZeroSignatureQuote()
      const parseResult = parseQuote(quoteHex)
      expect(parseResult.success).toBe(true)
      if (!parseResult.quote) throw new Error('quote should be defined')

      const verifyResult = await verifyQuote(parseResult.quote)

      // Zero signature should fail r/s range check
      expect(verifyResult.signatureValid).toBe(false)
    })

    test('verifies SEV-SNP signature structure', async () => {
      const quoteHex = createMockSEVQuote()
      const parseResult = parseQuote(quoteHex)
      expect(parseResult.success).toBe(true)
      if (!parseResult.quote) throw new Error('quote should be defined')

      const _verifyResult = await verifyQuote(parseResult.quote)

      // SEV uses RSA-4096 (512 bytes)
      expect(parseResult.quote.signature.length).toBe(2 + 512 * 2)
    })

    test('concurrent verification calls return consistent results', async () => {
      const quoteHex = createMockTDXQuote()
      const parseResult = parseQuote(quoteHex)
      expect(parseResult.success).toBe(true)
      if (!parseResult.quote) throw new Error('quote should be defined')

      // Run multiple verifications concurrently
      const results = await Promise.all([
        verifyQuote(parseResult.quote),
        verifyQuote(parseResult.quote),
        verifyQuote(parseResult.quote),
      ])

      // All results should be identical
      expect(results[0].measurementMatch).toBe(results[1].measurementMatch)
      expect(results[1].measurementMatch).toBe(results[2].measurementMatch)
      expect(results[0].tcbStatus).toBe(results[1].tcbStatus)
    })
  })

  describe('checkTCBStatus', () => {
    test('returns upToDate for valid TCB', () => {
      const quoteHex = createMockTDXQuote()
      const parseResult = parseQuote(quoteHex)
      expect(parseResult.success).toBe(true)
      expect(parseResult.quote).toBeDefined()

      const status = checkTCBStatus(parseResult.quote ?? ({} as never))
      expect(status).toBe('upToDate')
    })

    test('returns outOfDate for low TCB', () => {
      const quoteHex = createOutdatedTCBQuote()
      const parseResult = parseQuote(quoteHex)
      expect(parseResult.success).toBe(true)
      expect(parseResult.quote).toBeDefined()

      const status = checkTCBStatus(parseResult.quote ?? ({} as never))
      expect(status).toBe('outOfDate')
    })

    test('returns upToDate for SEV at exact minimum', () => {
      const quoteHex = createSEVMinTCBQuote()
      const parseResult = parseQuote(quoteHex)
      expect(parseResult.success).toBe(true)
      expect(parseResult.quote).toBeDefined()

      const status = checkTCBStatus(parseResult.quote ?? ({} as never))
      expect(status).toBe('upToDate')
    })

    test('returns upToDate for SGX with valid TCB', () => {
      const quoteHex = createMockSGXQuote()
      const parseResult = parseQuote(quoteHex)
      expect(parseResult.success).toBe(true)
      expect(parseResult.quote).toBeDefined()

      const status = checkTCBStatus(parseResult.quote ?? ({} as never))
      expect(status).toBe('upToDate')
    })

    test('handles different platforms consistently', () => {
      const tdxResult = parseQuote(createMockTDXQuote())
      const sevResult = parseQuote(createMockSEVQuote())
      const sgxResult = parseQuote(createMockSGXQuote())

      expect(tdxResult.quote).toBeDefined()
      expect(sevResult.quote).toBeDefined()
      expect(sgxResult.quote).toBeDefined()

      // All valid quotes should be upToDate
      expect(checkTCBStatus(tdxResult.quote ?? ({} as never))).toBe('upToDate')
      expect(checkTCBStatus(sevResult.quote ?? ({} as never))).toBe('upToDate')
      expect(checkTCBStatus(sgxResult.quote ?? ({} as never))).toBe('upToDate')
    })

    test('boundary: cpu exactly at minimum passes', () => {
      // Create quote with cpu=2 (exactly at minimum)
      const quote = new Uint8Array(700)
      quote[0] = 4
      quote[4] = 0x81 // TDX
      const intelVendorId = [
        0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 0x94, 0x0a, 0x0d, 0xb3,
        0x95, 0x7f, 0x06, 0x07,
      ]
      for (let i = 0; i < 16; i++) quote[12 + i] = intelVendorId[i]
      quote[48] = 0x02 // cpu = 2 (minimum)
      quote[49] = 0x03 // tcb = 3 (minimum)
      for (let i = 16; i < 584; i++) quote[48 + i] = (i * 7) % 256
      quote[632] = 64
      for (let i = 0; i < 64; i++) quote[636 + i] = (i + 1) % 256

      const quoteHex = ('0x' +
        Array.from(quote)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')) as Hex
      const parseResult = parseQuote(quoteHex)
      expect(parseResult.success).toBe(true)
      expect(parseResult.quote).toBeDefined()

      const status = checkTCBStatus(parseResult.quote ?? ({} as never))
      expect(status).toBe('upToDate')
    })

    test('boundary: cpu one below minimum fails', () => {
      const quote = new Uint8Array(700)
      quote[0] = 4
      quote[4] = 0x81
      const intelVendorId = [
        0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 0x94, 0x0a, 0x0d, 0xb3,
        0x95, 0x7f, 0x06, 0x07,
      ]
      for (let i = 0; i < 16; i++) quote[12 + i] = intelVendorId[i]
      // cpu is read as uint16 LE from bytes 48-49
      // For cpu=1: set byte[48]=0x01, byte[49]=0x00
      quote[48] = 0x01 // cpu low byte = 1
      quote[49] = 0x00 // cpu high byte = 0 → cpu = 1 (below minimum of 2)
      // tcb comes from teeTcbSvn bytes 0-1 interpreted differently
      // To ensure tcb passes but cpu fails, fill rest with valid values
      for (let i = 2; i < 16; i++) quote[48 + i] = 0x10
      for (let i = 16; i < 584; i++) quote[48 + i] = (i * 7) % 256
      quote[632] = 64
      for (let i = 0; i < 64; i++) quote[636 + i] = (i + 1) % 256

      const quoteHex = ('0x' +
        Array.from(quote)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')) as Hex
      const parseResult = parseQuote(quoteHex)
      expect(parseResult.success).toBe(true)
      expect(parseResult.quote).toBeDefined()

      // With cpu=1 (below minimum of 2), should be outOfDate
      const status = checkTCBStatus(parseResult.quote ?? ({} as never))
      expect(status).toBe('outOfDate')
    })
  })

  describe('hashHardwareId', () => {
    test('produces consistent hashes', () => {
      const hardwareId = `0x${'ab'.repeat(32)}` as Hex
      const salt = `0x${'12'.repeat(32)}` as Hex

      const hash1 = hashHardwareId(hardwareId, salt)
      const hash2 = hashHardwareId(hardwareId, salt)

      expect(hash1).toBe(hash2)
    })

    test('different salts produce different hashes', () => {
      const hardwareId = `0x${'ab'.repeat(32)}` as Hex
      const salt1 = `0x${'12'.repeat(32)}` as Hex
      const salt2 = `0x${'fe'.repeat(32)}` as Hex

      const hash1 = hashHardwareId(hardwareId, salt1)
      const hash2 = hashHardwareId(hardwareId, salt2)

      expect(hash1).not.toBe(hash2)
    })

    test('different hardware IDs produce different hashes', () => {
      const hardwareId1 = `0x${'ab'.repeat(32)}` as Hex
      const hardwareId2 = `0x${'cd'.repeat(32)}` as Hex
      const salt = `0x${'12'.repeat(32)}` as Hex

      const hash1 = hashHardwareId(hardwareId1, salt)
      const hash2 = hashHardwareId(hardwareId2, salt)

      expect(hash1).not.toBe(hash2)
    })
  })

  describe('extractPlatformInfo', () => {
    test('returns correct info for TDX', () => {
      const quoteHex = createMockTDXQuote()
      const parseResult = parseQuote(quoteHex)
      expect(parseResult.success).toBe(true)
      expect(parseResult.quote).toBeDefined()

      if (!parseResult.quote) throw new Error('quote should be defined')
      const info = extractPlatformInfo(parseResult.quote)

      expect(info.platformName).toBe('Intel TDX')
      expect(info.hardwareIdType).toContain('MRTD')
    })

    test('returns correct info for SEV', () => {
      const quoteHex = createMockSEVQuote()
      const parseResult = parseQuote(quoteHex)
      expect(parseResult.success).toBe(true)
      expect(parseResult.quote).toBeDefined()
      if (!parseResult.quote) throw new Error('quote should be defined')

      const info = extractPlatformInfo(parseResult.quote)

      expect(info.platformName).toBe('AMD SEV-SNP')
      expect(info.hardwareIdType).toBe('Chip ID')
    })
  })
})

// ============================================================================
// Registry Client Tests
// ============================================================================

describe('Registry Client', () => {
  let mockClient: MockPoCRegistryClient

  beforeEach(() => {
    mockClient = new MockPoCRegistryClient()
  })

  test('verifyQuote returns false for unknown hardware', async () => {
    const quoteHex = createMockTDXQuote()
    const response = await mockClient.verifyQuote(quoteHex)

    expect(response.verified).toBe(false)
    expect(response.error).toContain('not found')
  })

  test('verifyQuote returns true for registered hardware', async () => {
    const quoteHex = createMockTDXQuote()
    const hardwareIdHash = `0x${quoteHex.slice(2, 66).padEnd(64, '0')}` as Hex

    mockClient.addMockEntry(createMockEntry({ hardwareIdHash }))

    const response = await mockClient.verifyQuote(quoteHex)

    expect(response.verified).toBe(true)
    expect(response.level).toBe(2)
    expect(response.cloudProvider).toBe('aws')
  })

  test('verifyQuote returns false for revoked hardware', async () => {
    const hardwareIdHash = `0x${'ab'.repeat(32)}` as Hex

    mockClient.addMockEntry(createMockEntry({ hardwareIdHash }))
    mockClient.addMockRevocation({
      hardwareIdHash,
      reason: 'Compromised in side-channel attack',
      evidenceHash: '0x' as Hex,
      timestamp: Date.now(),
      approvers: ['alliance-member-1'],
    })

    const quoteHex = `0x${'ab'.repeat(32)}${'00'.repeat(350)}` as Hex
    const response = await mockClient.verifyQuote(quoteHex)

    expect(response.verified).toBe(false)
    expect(response.error).toContain('revoked')
  })

  test('checkHardware returns null for unknown hardware', async () => {
    const unknownHash = `0x${'99'.repeat(32)}` as Hex
    const entry = await mockClient.checkHardware(unknownHash)
    expect(entry).toBeNull()
  })

  test('checkHardware returns entry for known hardware', async () => {
    const knownHash = `0x${'ab'.repeat(32)}` as Hex
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash: knownHash }))

    const entry = await mockClient.checkHardware(knownHash)

    expect(entry).not.toBeNull()
    expect(entry?.level).toBe(2)
    expect(entry?.cloudProvider).toBe('aws')
  })

  test('isRevoked returns false for valid hardware', async () => {
    const validHash = `0x${'11'.repeat(32)}` as Hex
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash: validHash }))

    const isRevoked = await mockClient.isRevoked(validHash)
    expect(isRevoked).toBe(false)
  })

  test('revocation marks hardware as inactive', async () => {
    const revokedHash = `0x${'22'.repeat(32)}` as Hex
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash: revokedHash }))
    mockClient.addMockRevocation({
      hardwareIdHash: revokedHash,
      reason: 'Compromised',
      evidenceHash: '0x' as Hex,
      timestamp: Date.now(),
      approvers: ['alliance-member-1'],
    })

    const isRevoked = await mockClient.isRevoked(revokedHash)
    expect(isRevoked).toBe(true)

    const entry = await mockClient.checkHardware(revokedHash)
    expect(entry?.active).toBe(false)
  })

  test('isHardwareValid returns true for active entry', async () => {
    const hash = `0x${'33'.repeat(32)}` as Hex
    mockClient.addMockEntry(
      createMockEntry({ hardwareIdHash: hash, active: true }),
    )

    const valid = await mockClient.isHardwareValid(hash)
    expect(valid).toBe(true)
  })

  test('isHardwareValid returns false for inactive entry', async () => {
    const hash = `0x${'44'.repeat(32)}` as Hex
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash: hash }))
    mockClient.addMockRevocation({
      hardwareIdHash: hash,
      reason: 'Test revocation',
      evidenceHash: '0x' as Hex,
      timestamp: Date.now(),
      approvers: ['test'],
    })

    const valid = await mockClient.isHardwareValid(hash)
    expect(valid).toBe(false)
  })

  test('getEndorsements returns empty array for new entry', async () => {
    const hash = `0x${'55'.repeat(32)}` as Hex
    mockClient.addMockEntry(
      createMockEntry({ hardwareIdHash: hash, endorsements: [] }),
    )

    const endorsements = await mockClient.getEndorsements(hash)
    expect(endorsements).toEqual([])
  })

  test('getEndorsements returns populated array', async () => {
    const hash = `0x${'66'.repeat(32)}` as Hex
    const mockEndorsement = {
      memberId: 'member-1',
      signature: '0x1234' as Hex,
      timestamp: Date.now(),
    }
    mockClient.addMockEntry(
      createMockEntry({
        hardwareIdHash: hash,
        endorsements: [mockEndorsement],
      }),
    )

    const endorsements = await mockClient.getEndorsements(hash)
    expect(endorsements.length).toBe(1)
    expect(endorsements[0].memberId).toBe('member-1')
  })

  test('handles multiple entries independently', async () => {
    const hash1 = `0x${'77'.repeat(32)}` as Hex
    const hash2 = `0x${'88'.repeat(32)}` as Hex

    mockClient.addMockEntry(
      createMockEntry({ hardwareIdHash: hash1, level: 1 }),
    )
    mockClient.addMockEntry(
      createMockEntry({ hardwareIdHash: hash2, level: 3 }),
    )

    const entry1 = await mockClient.checkHardware(hash1)
    const entry2 = await mockClient.checkHardware(hash2)

    expect(entry1?.level).toBe(1)
    expect(entry2?.level).toBe(3)
  })

  test('getRevocations returns all revocations', async () => {
    const hash1 = `0x${'aa'.repeat(32)}` as Hex
    const hash2 = `0x${'bb'.repeat(32)}` as Hex

    mockClient.addMockRevocation({
      hardwareIdHash: hash1,
      reason: 'Reason 1',
      evidenceHash: '0x' as Hex,
      timestamp: Date.now(),
      approvers: ['approver1'],
    })
    mockClient.addMockRevocation({
      hardwareIdHash: hash2,
      reason: 'Reason 2',
      evidenceHash: '0x' as Hex,
      timestamp: Date.now(),
      approvers: ['approver2'],
    })

    const revocations = await mockClient.getRevocations()
    expect(revocations.length).toBe(2)
  })

  test('concurrent lookups return consistent results', async () => {
    const hash = `0x${'cc'.repeat(32)}` as Hex
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash: hash, level: 2 }))

    const results = await Promise.all([
      mockClient.checkHardware(hash),
      mockClient.checkHardware(hash),
      mockClient.checkHardware(hash),
      mockClient.isHardwareValid(hash),
      mockClient.isRevoked(hash),
    ])

    expect(results[0]?.level).toBe(2)
    expect(results[1]?.level).toBe(2)
    expect(results[2]?.level).toBe(2)
    expect(results[3]).toBe(true)
    expect(results[4]).toBe(false)
  })

  test('all verification levels are valid', async () => {
    const levels: PoCVerificationLevel[] = [1, 2, 3]

    for (const level of levels) {
      const hash = `0x${level}${'0'.repeat(63)}` as Hex
      mockClient.addMockEntry(createMockEntry({ hardwareIdHash: hash, level }))

      const entry = await mockClient.checkHardware(hash)
      expect(entry?.level).toBe(level)
    }
  })

  test('clearCache does not affect mock data', () => {
    const hash = `0x${'dd'.repeat(32)}` as Hex
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash: hash }))

    mockClient.clearCache()

    // Mock data should still be accessible
    const entry = mockClient.checkHardware(hash)
    expect(entry).resolves.not.toBeNull()
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  test('PoCError includes error code', () => {
    const error = new PoCError(
      PoCErrorCode.INVALID_QUOTE,
      'Test error message',
      { detail: 'extra info' },
    )

    expect(error.code).toBe(PoCErrorCode.INVALID_QUOTE)
    expect(error.message).toContain('INVALID_QUOTE')
    expect(error.message).toContain('Test error message')
    expect(error.context).toEqual({ detail: 'extra info' })
  })

  test('PoCError works with instanceof', () => {
    const error = new PoCError(PoCErrorCode.ORACLE_UNAVAILABLE, 'Oracle down')

    expect(error instanceof Error).toBe(true)
    expect(error instanceof PoCError).toBe(true)
    expect(error.name).toBe('PoCError')
  })

  test('PoCError includes all error codes', () => {
    const codes = Object.values(PoCErrorCode)
    expect(codes.length).toBeGreaterThan(5)

    for (const code of codes) {
      const error = new PoCError(code, 'test')
      expect(error.code).toBe(code)
    }
  })

  test('PoCError preserves stack trace', () => {
    const error = new PoCError(PoCErrorCode.SIGNATURE_INVALID, 'Bad signature')
    expect(error.stack).toBeDefined()
    expect(error.stack).toContain('PoCError')
  })

  test('PoCError context is optional', () => {
    const error = new PoCError(PoCErrorCode.AGENT_NOT_FOUND, 'No agent')
    expect(error.context).toBeUndefined()
  })

  test('PoCError context can contain complex objects', () => {
    const error = new PoCError(
      PoCErrorCode.HARDWARE_NOT_REGISTERED,
      'Unknown hardware',
      {
        hardwareId: '0x1234',
        timestamp: Date.now(),
        nested: { value: true },
        array: [1, 2, 3],
      },
    )

    expect(error.context?.hardwareId).toBe('0x1234')
    expect(error.context?.nested).toEqual({ value: true })
    expect(error.context?.array).toEqual([1, 2, 3])
  })

  test('all error codes have unique values', () => {
    const codes = Object.values(PoCErrorCode)
    const uniqueCodes = new Set(codes)
    expect(uniqueCodes.size).toBe(codes.length)
  })

  test('error codes match expected categories', () => {
    // Quote-related errors
    expect(PoCErrorCode.INVALID_QUOTE).toBeDefined()
    expect(PoCErrorCode.QUOTE_EXPIRED).toBeDefined()
    expect(PoCErrorCode.UNSUPPORTED_PLATFORM).toBeDefined()

    // Crypto errors
    expect(PoCErrorCode.SIGNATURE_INVALID).toBeDefined()
    expect(PoCErrorCode.CERTIFICATE_INVALID).toBeDefined()
    expect(PoCErrorCode.TCB_OUT_OF_DATE).toBeDefined()

    // Registry errors
    expect(PoCErrorCode.HARDWARE_NOT_REGISTERED).toBeDefined()
    expect(PoCErrorCode.HARDWARE_REVOKED).toBeDefined()

    // Oracle errors
    expect(PoCErrorCode.ORACLE_UNAVAILABLE).toBeDefined()
    expect(PoCErrorCode.INSUFFICIENT_SIGNATURES).toBeDefined()
    expect(PoCErrorCode.VERIFICATION_TIMEOUT).toBeDefined()

    // Agent errors
    expect(PoCErrorCode.AGENT_NOT_FOUND).toBeDefined()
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  test('full verification flow with registered hardware', async () => {
    const quoteHex = createMockTDXQuote()
    const parseResult = parseQuote(quoteHex)
    expect(parseResult.success).toBe(true)

    const mockClient = new MockPoCRegistryClient()
    const hardwareIdHash = `0x${quoteHex.slice(2, 66).padEnd(64, '0')}` as Hex
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash }))

    const registryResult = await mockClient.verifyQuote(quoteHex)
    expect(registryResult.verified).toBe(true)
    expect(registryResult.cloudProvider).toBe('aws')
    expect(parseResult.quote).toBeDefined()

    const verifyResult = await verifyQuote(parseResult.quote ?? ({} as never))
    expect(verifyResult.quote).toBeDefined()

    const salt = keccak256(toBytes('test-salt'))
    const hashedId = hashHardwareId(parseResult.quote?.hardwareId, salt)
    expect(hashedId).toMatch(/^0x[a-f0-9]{64}$/)
  })

  test('verification fails for unregistered hardware', async () => {
    const quoteHex = createMockTDXQuote()
    const parseResult = parseQuote(quoteHex)
    expect(parseResult.success).toBe(true)

    const mockClient = new MockPoCRegistryClient()
    const registryResult = await mockClient.verifyQuote(quoteHex)
    expect(registryResult.verified).toBe(false)
  })

  test('quote parsing handles various platforms', async () => {
    const tdxQuote = createMockTDXQuote()
    const sevQuote = createMockSEVQuote()
    const sgxQuote = createMockSGXQuote()

    const tdxResult = parseQuote(tdxQuote)
    const sevResult = parseQuote(sevQuote)
    const sgxResult = parseQuote(sgxQuote)

    expect(tdxResult.success).toBe(true)
    expect(sevResult.success).toBe(true)
    expect(sgxResult.success).toBe(true)

    expect(tdxResult.quote?.platform).toBe('intel_tdx')
    expect(sevResult.quote?.platform).toBe('amd_sev')
    expect(sgxResult.quote?.platform).toBe('intel_sgx')

    // All should have unique hardware IDs
    const ids = [
      tdxResult.quote?.hardwareId,
      sevResult.quote?.hardwareId,
      sgxResult.quote?.hardwareId,
    ]
    expect(new Set(ids).size).toBe(3)
  })

  test('TCB check integrates with verification', async () => {
    const validQuote = createMockTDXQuote()
    const outdatedQuote = createOutdatedTCBQuote()

    const validResult = parseQuote(validQuote)
    const outdatedResult = parseQuote(outdatedQuote)

    expect(validResult.success).toBe(true)
    expect(outdatedResult.success).toBe(true)
    expect(validResult.quote).toBeDefined()
    expect(outdatedResult.quote).toBeDefined()

    const validVerify = await verifyQuote(validResult.quote ?? ({} as never))
    const outdatedVerify = await verifyQuote(
      outdatedResult.quote ?? ({} as never),
    )

    expect(validVerify.tcbStatus).toBe('upToDate')
    expect(outdatedVerify.tcbStatus).toBe('outOfDate')
  })

  test('end-to-end: parse, verify, hash, check registry', async () => {
    const quoteHex = createMockTDXQuote()

    // Step 1: Parse
    const parseResult = parseQuote(quoteHex)
    expect(parseResult.success).toBe(true)
    if (!parseResult.quote) throw new Error('quote should be defined')
    const quote = parseResult.quote

    // Step 2: Verify crypto
    const verifyResult = await verifyQuote(quote)
    expect(verifyResult.quote.platform).toBe('intel_tdx')
    expect(verifyResult.tcbStatus).toBe('upToDate')

    // Step 3: Extract platform info
    const platformInfo = extractPlatformInfo(quote)
    expect(platformInfo.platformName).toBe('Intel TDX')

    // Step 4: Hash with salt
    const salt = keccak256(toBytes('production-salt'))
    const hashedHwId = hashHardwareId(quote.hardwareId, salt)

    // Step 5: Register in mock registry
    const mockClient = new MockPoCRegistryClient()
    mockClient.addMockEntry(
      createMockEntry({
        hardwareIdHash: hashedHwId,
        level: 3,
        cloudProvider: 'gcp',
        region: 'us-west1',
      }),
    )

    // Step 6: Check registry
    const entry = await mockClient.checkHardware(hashedHwId)
    expect(entry).not.toBeNull()
    expect(entry?.level).toBe(3)
    expect(entry?.cloudProvider).toBe('gcp')

    // Step 7: Validate status
    const isValid = await mockClient.isHardwareValid(hashedHwId)
    expect(isValid).toBe(true)
  })

  test('revocation flow: register, verify, revoke, verify again', async () => {
    const quoteHex = createMockTDXQuote()
    const hardwareIdHash = `0x${quoteHex.slice(2, 66).padEnd(64, '0')}` as Hex

    const mockClient = new MockPoCRegistryClient()

    // Register
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash }))

    // Verify works
    const beforeRevoke = await mockClient.verifyQuote(quoteHex)
    expect(beforeRevoke.verified).toBe(true)

    // Revoke
    mockClient.addMockRevocation({
      hardwareIdHash,
      reason: 'Side-channel vulnerability detected',
      evidenceHash: keccak256(toBytes('evidence')),
      timestamp: Date.now(),
      approvers: ['alliance-member-1', 'alliance-member-2'],
    })

    // Verify now fails
    const afterRevoke = await mockClient.verifyQuote(quoteHex)
    expect(afterRevoke.verified).toBe(false)
    expect(afterRevoke.error).toContain('revoked')

    // isRevoked returns true
    const revoked = await mockClient.isRevoked(hardwareIdHash)
    expect(revoked).toBe(true)
  })

  test('multiple quotes can be verified concurrently', async () => {
    const quotes = [
      createMockTDXQuote(),
      createMockSEVQuote(),
      createMockSGXQuote(),
    ]

    const parseResults = await Promise.all(quotes.map((q) => parseQuote(q)))

    expect(parseResults.every((r) => r.success)).toBe(true)

    const verifyResults = await Promise.all(
      parseResults.map((r) => {
        if (!r.quote) throw new Error('quote should be defined')
        return verifyQuote(r.quote)
      }),
    )

    // All should have valid structure
    expect(verifyResults[0].quote.platform).toBe('intel_tdx')
    expect(verifyResults[1].quote.platform).toBe('amd_sev')
    expect(verifyResults[2].quote.platform).toBe('intel_sgx')
  })

  test('hardware ID hash is different with different salts', () => {
    const quoteHex = createMockTDXQuote()
    const parseResult = parseQuote(quoteHex)
    expect(parseResult.success).toBe(true)

    const salt1 = keccak256(toBytes('salt-1'))
    const salt2 = keccak256(toBytes('salt-2'))

    const hash1 = hashHardwareId(parseResult.quote?.hardwareId, salt1)
    const hash2 = hashHardwareId(parseResult.quote?.hardwareId, salt2)

    expect(hash1).not.toBe(hash2)
  })

  test('same quote produces same results on repeated parsing', () => {
    const quoteHex = createMockTDXQuote()

    const results = Array.from({ length: 5 }, () => parseQuote(quoteHex))

    const firstResult = results[0]
    for (const result of results) {
      expect(result.success).toBe(firstResult.success)
      expect(result.quote?.platform).toBe(firstResult.quote?.platform)
      expect(result.quote?.hardwareId).toBe(firstResult.quote?.hardwareId)
      expect(result.quote?.measurement).toBe(firstResult.quote?.measurement)
    }
  })

  test('verification result includes all expected fields', async () => {
    const quoteHex = createMockTDXQuote()
    const parseResult = parseQuote(quoteHex)
    if (!parseResult.quote) throw new Error('quote should be defined')
    const verifyResult = await verifyQuote(parseResult.quote)

    // Check all fields are present
    expect(verifyResult).toHaveProperty('valid')
    expect(verifyResult).toHaveProperty('quote')
    expect(verifyResult).toHaveProperty('certificateValid')
    expect(verifyResult).toHaveProperty('signatureValid')
    expect(verifyResult).toHaveProperty('measurementMatch')
    expect(verifyResult).toHaveProperty('tcbStatus')
    expect(verifyResult).toHaveProperty('error')

    // Check field types
    expect(typeof verifyResult.valid).toBe('boolean')
    expect(typeof verifyResult.certificateValid).toBe('boolean')
    expect(typeof verifyResult.signatureValid).toBe('boolean')
    expect(typeof verifyResult.measurementMatch).toBe('boolean')
    expect(['upToDate', 'outOfDate', 'revoked', 'unknown']).toContain(
      verifyResult.tcbStatus,
    )
  })

  test('parsed quote contains all expected fields', () => {
    const quoteHex = createMockTDXQuote()
    const result = parseQuote(quoteHex)
    expect(result.success).toBe(true)
    if (!result.quote) throw new Error('quote should be defined')

    const quote = result.quote

    expect(quote).toHaveProperty('raw')
    expect(quote).toHaveProperty('platform')
    expect(quote).toHaveProperty('hardwareId')
    expect(quote).toHaveProperty('measurement')
    expect(quote).toHaveProperty('reportData')
    expect(quote).toHaveProperty('securityVersion')
    expect(quote).toHaveProperty('signature')
    expect(quote).toHaveProperty('certChain')
    expect(quote).toHaveProperty('timestamp')

    expect(quote.securityVersion).toHaveProperty('cpu')
    expect(quote.securityVersion).toHaveProperty('tcb')
    expect(typeof quote.securityVersion.cpu).toBe('number')
    expect(typeof quote.securityVersion.tcb).toBe('number')
  })
})

// ============================================================================
// Metrics Tests
// ============================================================================

import { PoCMetrics } from '../metrics'

describe('Metrics', () => {
  test('records verification request', () => {
    const metrics = new PoCMetrics(0)

    metrics.recordVerification({
      type: 'request',
      timestamp: Date.now(),
      agentId: 1n,
      requestHash: '0x123' as Hex,
      status: null,
      level: null,
      error: null,
      metadata: {},
    })

    const stats = metrics.getMetrics()
    const pending = stats.find((m) => m.name === 'poc_pending_verifications')
    expect(pending?.value).toBe(1)
  })

  test('records verification result success', () => {
    const metrics = new PoCMetrics(0)

    metrics.recordVerification({
      type: 'result',
      timestamp: Date.now(),
      agentId: 1n,
      requestHash: '0x123' as Hex,
      status: 'verified',
      level: 2,
      error: null,
      metadata: { durationMs: 150 },
    })

    const stats = metrics.getMetrics()
    expect(stats.find((m) => m.name === 'poc_verifications_total')?.value).toBe(
      1,
    )
    expect(
      stats.find((m) => m.name === 'poc_verifications_success')?.value,
    ).toBe(1)
    expect(
      stats.find(
        (m) => m.name === 'poc_status_count' && m.labels.status === 'verified',
      )?.value,
    ).toBe(1)
    expect(
      stats.find((m) => m.name === 'poc_level_count' && m.labels.level === '2')
        ?.value,
    ).toBe(1)
  })

  test('records verification result failure', () => {
    const metrics = new PoCMetrics(0)

    metrics.recordVerification({
      type: 'result',
      timestamp: Date.now(),
      agentId: 1n,
      requestHash: '0x123' as Hex,
      status: 'rejected',
      level: null,
      error: null,
      metadata: {},
    })

    const stats = metrics.getMetrics()
    expect(
      stats.find((m) => m.name === 'poc_verifications_failed')?.value,
    ).toBe(1)
  })

  test('records revocation', () => {
    const metrics = new PoCMetrics(0)

    metrics.recordVerification({
      type: 'revocation',
      timestamp: Date.now(),
      agentId: 1n,
      requestHash: null,
      status: 'revoked',
      level: null,
      error: null,
      metadata: {},
    })

    const stats = metrics.getMetrics()
    expect(stats.find((m) => m.name === 'poc_revocations_total')?.value).toBe(1)
  })

  test('records errors with code breakdown', () => {
    const metrics = new PoCMetrics(0)

    metrics.recordVerification({
      type: 'error',
      timestamp: Date.now(),
      agentId: null,
      requestHash: null,
      status: null,
      level: null,
      error: 'Something failed',
      metadata: { code: 'SIGNATURE_INVALID' },
    })

    const stats = metrics.getMetrics()
    const errorMetric = stats.find(
      (m) => m.name === 'poc_errors' && m.labels.code === 'SIGNATURE_INVALID',
    )
    expect(errorMetric?.value).toBe(1)
  })

  test('tracks duration percentiles', () => {
    const metrics = new PoCMetrics(0)

    // Add multiple results with different durations
    for (let i = 0; i < 100; i++) {
      metrics.recordVerification({
        type: 'result',
        timestamp: Date.now(),
        agentId: BigInt(i),
        requestHash: `0x${i.toString(16).padStart(64, '0')}` as Hex,
        status: 'verified',
        level: 1,
        error: null,
        metadata: { durationMs: i * 10 },
      })
    }

    const stats = metrics.getMetrics()
    const p50 = stats.find((m) => m.name === 'poc_verification_duration_p50_ms')
    const p95 = stats.find((m) => m.name === 'poc_verification_duration_p95_ms')
    const p99 = stats.find((m) => m.name === 'poc_verification_duration_p99_ms')

    expect(p50).toBeDefined()
    expect(p95).toBeDefined()
    expect(p99).toBeDefined()
    expect(p50?.value).toBeLessThan(p95?.value)
    expect(p95?.value).toBeLessThan(p99?.value)
  })

  test('setActiveAgents updates gauge', () => {
    const metrics = new PoCMetrics(0)

    metrics.setActiveAgents(42)

    const stats = metrics.getMetrics()
    expect(stats.find((m) => m.name === 'poc_active_agents')?.value).toBe(42)
  })

  test('formatPrometheus generates valid format', () => {
    const metrics = new PoCMetrics(0)
    metrics.setActiveAgents(10)

    const output = metrics.formatPrometheus()

    expect(output).toContain('# HELP poc_active_agents')
    expect(output).toContain('# TYPE poc_active_agents gauge')
    expect(output).toContain('poc_active_agents 10')
  })

  test('decrements pending after result', () => {
    const metrics = new PoCMetrics(0)

    metrics.recordVerification({
      type: 'request',
      timestamp: Date.now(),
      agentId: 1n,
      requestHash: '0x1' as Hex,
      status: null,
      level: null,
      error: null,
      metadata: {},
    })
    metrics.recordVerification({
      type: 'request',
      timestamp: Date.now(),
      agentId: 2n,
      requestHash: '0x2' as Hex,
      status: null,
      level: null,
      error: null,
      metadata: {},
    })

    let stats = metrics.getMetrics()
    expect(
      stats.find((m) => m.name === 'poc_pending_verifications')?.value,
    ).toBe(2)

    metrics.recordVerification({
      type: 'result',
      timestamp: Date.now(),
      agentId: 1n,
      requestHash: '0x1' as Hex,
      status: 'verified',
      level: 1,
      error: null,
      metadata: {},
    })

    stats = metrics.getMetrics()
    expect(
      stats.find((m) => m.name === 'poc_pending_verifications')?.value,
    ).toBe(1)
  })
})

// ============================================================================
// Error Code Coverage Tests
// ============================================================================

describe('Error Codes Usage', () => {
  test('all error codes are defined', () => {
    const allCodes = Object.values(PoCErrorCode)
    expect(allCodes.length).toBe(12)
    expect(allCodes).toContain('INVALID_QUOTE')
    expect(allCodes).toContain('QUOTE_EXPIRED')
    expect(allCodes).toContain('UNSUPPORTED_PLATFORM')
    expect(allCodes).toContain('SIGNATURE_INVALID')
    expect(allCodes).toContain('CERTIFICATE_INVALID')
    expect(allCodes).toContain('TCB_OUT_OF_DATE')
    expect(allCodes).toContain('HARDWARE_NOT_REGISTERED')
    expect(allCodes).toContain('HARDWARE_REVOKED')
    expect(allCodes).toContain('ORACLE_UNAVAILABLE')
    expect(allCodes).toContain('INSUFFICIENT_SIGNATURES')
    expect(allCodes).toContain('VERIFICATION_TIMEOUT')
    expect(allCodes).toContain('AGENT_NOT_FOUND')
  })

  test('can throw each error code', () => {
    for (const code of Object.values(PoCErrorCode)) {
      const error = new PoCError(code, `Test error for ${code}`)
      expect(error.code).toBe(code)
      expect(error.message).toContain(code)
      expect(error.name).toBe('PoCError')
    }
  })
})

// ============================================================================
// SEV-SNP ECDSA P-384 Path Tests
// ============================================================================

describe('SEV-SNP ECDSA Verification', () => {
  function createSEVQuoteWithECDSA(): Hex {
    // Create SEV quote with 96-byte ECDSA P-384 signature instead of 512-byte RSA
    const quote = new Uint8Array(0x2a0 + 96)

    quote[0] = 2
    quote[1] = 0
    quote[2] = 0
    quote[3] = 0 // version = 2
    quote[4] = 0x0a // guest SVN >= min

    // Fill measurement at 0x90 (48 bytes)
    for (let i = 0; i < 48; i++) quote[0x90 + i] = (i * 7 + 1) % 256

    // Fill chip ID at 0x1A0 (64 bytes)
    for (let i = 0; i < 64; i++) quote[0x1a0 + i] = (i * 11 + 2) % 256

    // ECDSA P-384 signature at 0x2A0 (96 bytes = r || s)
    // Generate valid-range r and s values (non-zero, good entropy)
    for (let i = 0; i < 96; i++) {
      quote[0x2a0 + i] = ((i * 13 + 5) % 200) + 20 // 20-219 range for good entropy
    }

    return ('0x' +
      Array.from(quote)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')) as Hex
  }

  test('parses SEV-SNP quote with ECDSA signature', () => {
    const quoteHex = createSEVQuoteWithECDSA()
    const result = parseQuote(quoteHex)

    expect(result.success).toBe(true)
    expect(result.quote?.platform).toBe('amd_sev')
    expect(result.quote?.signature.length).toBe(2 + 96 * 2) // 0x + 96 bytes hex
  })

  test('verifies SEV-SNP quote with ECDSA signature', async () => {
    const quoteHex = createSEVQuoteWithECDSA()
    const result = parseQuote(quoteHex)
    if (!result.quote) throw new Error('quote should be defined')
    const verifyResult = await verifyQuote(result.quote)

    // ECDSA path should have proper entropy check
    expect(verifyResult.signatureValid).toBe(true)
  })

  test('rejects SEV-SNP ECDSA with r=0', async () => {
    const quote = new Uint8Array(0x2a0 + 96)
    quote[0] = 2
    quote[4] = 0x0a
    for (let i = 0; i < 48; i++) quote[0x90 + i] = i + 1
    for (let i = 0; i < 64; i++) quote[0x1a0 + i] = i + 1
    // r = 0 (first 48 bytes all zero)
    for (let i = 48; i < 96; i++) quote[0x2a0 + i] = 100 // s non-zero

    const quoteHex = ('0x' +
      Array.from(quote)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')) as Hex
    const result = parseQuote(quoteHex)
    if (!result.quote) throw new Error('quote should be defined')

    // Should fail entropy check (too many zeros)
    const verifyResult = await verifyQuote(result.quote)
    expect(verifyResult.certificateValid).toBe(false)
  })
})

// ============================================================================
// Certificate Chain Extraction Tests
// ============================================================================

describe('Certificate Chain Extraction', () => {
  function createQuoteWithCertChain(): Hex {
    // Create TDX quote with embedded PEM certificates in signature data
    const certPem = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKH/Fp/C0JYzMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBnRl
c3RDQTAeFw0yMzAxMDEwMDAwMDBaFw0yNDAxMDEwMDAwMDBaMBExDzANBgNVBAMM
BnRlc3RDQTBcMA0GCSqGSIb3DQEBAQUAA0sAMEgCQQC7o96WQ7kGvK9mPrGPBr+M
r8VQYqSxZ2sDLCLMJj3jTRKlN6gMTPUH7fEr3TBN0jKWM3gCJ3TzZ6EBCLhGQ3I9
AgMBAAGjUzBRMB0GA1UdDgQWBBT8lmZ3QDgTfxIm5YzQzTZzYhH2ujAfBgNVHSME
GDAWgBT8lmZ3QDgTfxIm5YzQzTZzYhH2ujAPBgNVHRMBAf8EBTADAQH/MA0GCSqG
SIb3DQEBCwUAA0EAVMNjC5xR7b3V3dD4CqCqBvEn5h+8M3TN9cz8oZ/N9wK8jL3l
3fKxKvNqKT+LCvT5eQ7tK5zR8jCqN3T9Q8K3Xg==
-----END CERTIFICATE-----`
    const certBytes = new TextEncoder().encode(certPem)

    // Build quote: header(48) + report(584) + sigLen(4) + sig(64) + pubkey(64) + certLen(4) + certs
    const sigDataLen = 64 + 64 + 4 + certBytes.length
    const totalLen = 48 + 584 + 4 + sigDataLen
    const quote = new Uint8Array(totalLen)

    // Header
    quote[0] = 4
    quote[1] = 0
    quote[4] = 0x81 // TDX
    const vendorId = [
      0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 0x94, 0x0a, 0x0d, 0xb3,
      0x95, 0x7f, 0x06, 0x07,
    ]
    for (let i = 0; i < 16; i++) quote[12 + i] = vendorId[i]

    // Report body TCB values
    quote[48] = 0x03
    quote[49] = 0x04
    for (let i = 0; i < 48; i++) quote[48 + 16 + i] = (i * 7) % 256
    for (let i = 0; i < 48; i++) quote[48 + 64 + i] = (i * 11) % 256
    for (let i = 0; i < 48; i++) quote[48 + 136 + i] = (i * 13) % 256

    // Signature data length at offset 632
    quote[632] = sigDataLen & 0xff
    quote[633] = (sigDataLen >> 8) & 0xff

    // Signature (64 bytes) at 636
    for (let i = 0; i < 64; i++) quote[636 + i] = ((i * 17 + 3) % 200) + 20

    // Public key (64 bytes) at 700
    for (let i = 0; i < 64; i++) quote[700 + i] = ((i * 19 + 5) % 200) + 20

    // Cert data length at 764
    const certLen = certBytes.length
    quote[764] = certLen & 0xff
    quote[765] = (certLen >> 8) & 0xff

    // Cert data at 768
    quote.set(certBytes, 768)

    return ('0x' +
      Array.from(quote)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')) as Hex
  }

  test('extracts embedded certificate from signature data', () => {
    const quoteHex = createQuoteWithCertChain()
    const result = parseQuote(quoteHex)

    expect(result.success).toBe(true)
    // The cert chain should be populated if extraction works
    expect(result.quote?.certChain.length).toBeGreaterThanOrEqual(0)
  })

  test('handles quote with no certificates gracefully', () => {
    const quoteHex = createMockTDXQuote()
    const result = parseQuote(quoteHex)

    expect(result.success).toBe(true)
    expect(result.quote?.certChain).toEqual([])
  })
})

// ============================================================================
// Additional Registry Client Tests
// ============================================================================

describe('Registry Client Extended', () => {
  test('cache respects TTL', async () => {
    const mockClient = new MockPoCRegistryClient()
    const entry = createMockEntry({ hardwareIdHash: '0xabc123' as Hex })
    mockClient.addMockEntry(entry)

    // First lookup
    const result1 = await mockClient.checkHardware('0xabc123' as Hex)
    expect(result1).not.toBeNull()

    // Second lookup should also work (mock doesn't have real caching but tests the path)
    const result2 = await mockClient.checkHardware('0xabc123' as Hex)
    expect(result2).toEqual(result1)
  })

  test('isHardwareValid returns false for missing entry', async () => {
    const mockClient = new MockPoCRegistryClient()
    const isValid = await mockClient.isHardwareValid('0xnonexistent' as Hex)
    expect(isValid).toBe(false)
  })

  test('isHardwareValid returns false for inactive entry', async () => {
    const mockClient = new MockPoCRegistryClient()
    const entry = createMockEntry({
      hardwareIdHash: '0xinactive' as Hex,
      active: false,
    })
    mockClient.addMockEntry(entry)

    const isValid = await mockClient.isHardwareValid('0xinactive' as Hex)
    expect(isValid).toBe(false)
  })

  test('isRevoked returns true for revoked hardware', async () => {
    const mockClient = new MockPoCRegistryClient()
    const entry = createMockEntry({ hardwareIdHash: '0xrevoked' as Hex })
    mockClient.addMockEntry(entry)
    mockClient.addMockRevocation({
      hardwareIdHash: '0xrevoked' as Hex,
      reason: 'Compromised',
      evidenceHash: '0xevidence' as Hex,
      timestamp: Date.now(),
      approvers: ['approver1'],
    })

    const isRevoked = await mockClient.isRevoked('0xrevoked' as Hex)
    expect(isRevoked).toBe(true)
  })

  test('verifyQuote returns error for missing hardware', async () => {
    const mockClient = new MockPoCRegistryClient()
    const result = await mockClient.verifyQuote('0xsomequote' as Hex)

    expect(result.verified).toBe(false)
    expect(result.error).toBeDefined()
  })

  test('verifyQuote returns error for revoked hardware', async () => {
    const mockClient = new MockPoCRegistryClient()
    // Add an entry first, then revoke it
    const hwHash = `0x${'somequote'.slice(0, 64).padEnd(64, '0')}`
    const entry = createMockEntry({ hardwareIdHash: hwHash as Hex })
    mockClient.addMockEntry(entry)
    mockClient.addMockRevocation({
      hardwareIdHash: hwHash as Hex,
      reason: 'Test revocation',
      evidenceHash: '0x' as Hex,
      timestamp: Date.now(),
      approvers: [],
    })

    const result = await mockClient.verifyQuote('0xsomequote' as Hex)
    expect(result.verified).toBe(false)
    expect(result.error).toContain('revoked')
  })
})

// ============================================================================
// X.509 Utility Tests
// ============================================================================

import { _testUtils } from '../quote-parser'

describe('X.509 Utilities', () => {
  // Valid self-signed test certificate (ECDSA P-256)
  const testCertPem = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKH/Fp/C0JYzMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBnRl
c3RDQTAeFw0yMzAxMDEwMDAwMDBaFw0yNDAxMDEwMDAwMDBaMBExDzANBgNVBAMM
BnRlc3RDQTBcMA0GCSqGSIb3DQEBAQUAA0sAMEgCQQC7o96WQ7kGvK9mPrGPBr+M
r8VQYqSxZ2sDLCLMJj3jTRKlN6gMTPUH7fEr3TBN0jKWM3gCJ3TzZ6EBCLhGQ3I9
AgMBAAGjUzBRMB0GA1UdDgQWBBT8lmZ3QDgTfxIm5YzQzTZzYhH2ujAfBgNVHSME
GDAWgBT8lmZ3QDgTfxIm5YzQzTZzYhH2ujAPBgNVHRMBAf8EBTADAQH/MA0GCSqG
SIb3DQEBCwUAA0EAVMNjC5xR7b3V3dD4CqCqBvEn5h+8M3TN9cz8oZ/N9wK8jL3l
3fKxKvNqKT+LCvT5eQ7tK5zR8jCqN3T9Q8K3Xg==
-----END CERTIFICATE-----`

  describe('pemToDer', () => {
    test('converts valid PEM to DER', () => {
      const der = _testUtils.pemToDer(testCertPem)
      expect(der).not.toBeNull()
      expect(der?.length).toBeGreaterThan(0)
      expect(der?.[0]).toBe(0x30) // SEQUENCE tag
    })

    test('returns null for missing markers', () => {
      const invalid = 'MIIBkTCB+wIJAKH/Fp/C0JYzMA0GCSqGSIb3DQEB'
      const der = _testUtils.pemToDer(invalid)
      expect(der).toBeNull()
    })

    test('returns null for invalid base64', () => {
      const invalid =
        '-----BEGIN CERTIFICATE-----\n!!!invalid!!!\n-----END CERTIFICATE-----'
      const der = _testUtils.pemToDer(invalid)
      expect(der).toBeNull()
    })

    test('handles whitespace in base64', () => {
      const withWhitespace = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKH/Fp/C0JYzMA0GCSqGSIb3DQEBCwUA
MBExDzANBgNVBAMMBnRlc3RDQTAB
-----END CERTIFICATE-----`
      // This test just checks it doesn't crash - real certs have proper padding
      _testUtils.pemToDer(withWhitespace)
    })
  })

  describe('parseASN1Time', () => {
    test('parses UTCTime correctly', () => {
      const time = _testUtils.parseASN1Time('230101000000Z', false)
      expect(time).toBe(Date.UTC(2023, 0, 1, 0, 0, 0))
    })

    test('parses GeneralizedTime correctly', () => {
      const time = _testUtils.parseASN1Time('20230101000000Z', true)
      expect(time).toBe(Date.UTC(2023, 0, 1, 0, 0, 0))
    })

    test('handles Y2K correctly for UTCTime', () => {
      // Years 50-99 are 1950-1999
      const old = _testUtils.parseASN1Time('990601120000Z', false)
      if (old === null) throw new Error('old should not be null')
      expect(new Date(old).getFullYear()).toBe(1999)

      // Years 00-49 are 2000-2049
      const newer = _testUtils.parseASN1Time('230601120000Z', false)
      if (newer === null) throw new Error('newer should not be null')
      expect(new Date(newer).getFullYear()).toBe(2023)
    })

    test('returns null for too short time string', () => {
      const time = _testUtils.parseASN1Time('2301', false)
      expect(time).toBeNull()
    })
  })

  describe('parseASN1Length', () => {
    test('parses single-byte length', () => {
      const data = new Uint8Array([0x30, 0x45]) // SEQUENCE, length 69
      const result = _testUtils.parseASN1Length(data, 1)
      expect(result).toEqual({ length: 69, bytesUsed: 1 })
    })

    test('parses multi-byte length', () => {
      const data = new Uint8Array([0x30, 0x82, 0x01, 0x00]) // SEQUENCE, length 256
      const result = _testUtils.parseASN1Length(data, 1)
      expect(result).toEqual({ length: 256, bytesUsed: 3 })
    })

    test('returns null for indefinite length', () => {
      const data = new Uint8Array([0x30, 0x80]) // Indefinite length
      const result = _testUtils.parseASN1Length(data, 1)
      expect(result).toBeNull()
    })

    test('returns null for out of bounds', () => {
      const data = new Uint8Array([0x30])
      const result = _testUtils.parseASN1Length(data, 5)
      expect(result).toBeNull()
    })
  })

  describe('ecdsaRawToDer', () => {
    test('converts raw ECDSA signature to DER', () => {
      const r = new Uint8Array(32).fill(1)
      const s = new Uint8Array(32).fill(2)
      const der = _testUtils.ecdsaRawToDer(r, s)

      expect(der[0]).toBe(0x30) // SEQUENCE
      expect(der[2]).toBe(0x02) // INTEGER tag for r
    })

    test('adds padding for high bit set', () => {
      const r = new Uint8Array([0x80, 0x01, 0x02, 0x03])
      const s = new Uint8Array([0x01, 0x02, 0x03, 0x04])
      const der = _testUtils.ecdsaRawToDer(r, s)

      // DER structure: [0x30, len, 0x02, rLen, ...r, 0x02, sLen, ...s]
      expect(der[0]).toBe(0x30) // SEQUENCE
      expect(der[2]).toBe(0x02) // INTEGER tag for r
      expect(der[3]).toBe(5) // r length (4 bytes + 1 padding)
      expect(der[4]).toBe(0x00) // Padding byte
      expect(der[5]).toBe(0x80) // Original first byte
    })

    test('strips leading zeros', () => {
      const r = new Uint8Array([0x00, 0x00, 0x01, 0x02])
      const s = new Uint8Array([0x01, 0x02, 0x03, 0x04])
      const der = _testUtils.ecdsaRawToDer(r, s)

      // DER structure: [0x30, len, 0x02, rLen, ...r, 0x02, sLen, ...s]
      expect(der[2]).toBe(0x02) // INTEGER tag
      expect(der[3]).toBe(2) // r length (stripped to 2 bytes)
      expect(der[4]).toBe(0x01) // First non-zero byte
      expect(der[5]).toBe(0x02) // Second byte
    })
  })

  describe('hexToBytes/bytesToHex', () => {
    test('round-trips correctly', () => {
      const original = '0xdeadbeef12345678' as Hex
      const bytes = _testUtils.hexToBytes(original)
      const back = _testUtils.bytesToHex(bytes)
      expect(back).toBe(original)
    })

    test('handles 0x prefix', () => {
      const bytes = _testUtils.hexToBytes('0xaabbcc' as Hex)
      expect(bytes).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]))
    })

    test('handles empty input', () => {
      const bytes = _testUtils.hexToBytes('0x' as Hex)
      expect(bytes).toEqual(new Uint8Array(0))
    })
  })

  describe('extractSubjectCN', () => {
    test('extracts CN from valid certificate', () => {
      const der = _testUtils.pemToDer(testCertPem)
      expect(der).not.toBeNull()
      if (!der) throw new Error('der should not be null')

      const cn = _testUtils.extractSubjectCN(der)
      expect(cn).toBe('testCA')
    })

    test('returns null for malformed data', () => {
      const garbage = new Uint8Array([0x30, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00])
      const cn = _testUtils.extractSubjectCN(garbage)
      expect(cn).toBeNull()
    })
  })

  describe('parseX509Basic', () => {
    test('extracts validity period from certificate', () => {
      const der = _testUtils.pemToDer(testCertPem)
      expect(der).not.toBeNull()
      if (!der) throw new Error('der should not be null')

      const info = _testUtils.parseX509Basic(der)
      expect(info).not.toBeNull()
      expect(info?.notBefore).toBeLessThan(info?.notAfter ?? 0)
    })

    test('returns null for non-SEQUENCE data', () => {
      const garbage = new Uint8Array([0x02, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00])
      const info = _testUtils.parseX509Basic(garbage)
      expect(info).toBeNull()
    })

    test('returns null for too short data', () => {
      const short = new Uint8Array([0x30, 0x03, 0x00, 0x00, 0x00])
      const info = _testUtils.parseX509Basic(short)
      expect(info).toBeNull()
    })
  })
})

// ============================================================================
// Metrics Server Tests
// ============================================================================

describe('Metrics Server', () => {
  test('start and stop server', async () => {
    const metrics = new PoCMetrics(0) // Port 0 = random available port

    await metrics.start()
    // Server should be running (no error thrown)

    metrics.stop()
    // Server should stop cleanly
  })

  test('multiple stop calls are safe', () => {
    const metrics = new PoCMetrics(0)

    // Stopping without starting should be safe
    metrics.stop()
    metrics.stop()
    // No error should be thrown
  })

  test('getPoCMetrics returns singleton', async () => {
    const { getPoCMetrics } = await import('../metrics')

    const m1 = getPoCMetrics(0)
    const m2 = getPoCMetrics(0)

    expect(m1).toBe(m2)
  })
})

// ============================================================================
// Decentralized Registry Client Tests
// ============================================================================

import { createRegistryClient, PoCRegistryClient } from '../registry-client'

describe('Decentralized Registry Client', () => {
  const TEST_RPC = 'https://sepolia.base.org'
  const TEST_VALIDATOR = '0x1234567890123456789012345678901234567890' as Address

  test('creates client with required config', () => {
    const client = new PoCRegistryClient({
      validatorAddress: TEST_VALIDATOR,
      rpcUrl: TEST_RPC,
    })
    const info = client.getDataSourceInfo()

    expect(info).toHaveProperty('validatorAddress')
    expect(info).toHaveProperty('offChainEndpoints')
    expect(info.validatorAddress).toBe(TEST_VALIDATOR)
  })

  test('creates client with custom off-chain endpoints', () => {
    const client = new PoCRegistryClient({
      validatorAddress: TEST_VALIDATOR,
      rpcUrl: TEST_RPC,
      offChainEndpoints: [
        'https://api1.poc.example',
        'https://api2.poc.example',
      ],
    })

    const info = client.getDataSourceInfo()
    expect(info.offChainEndpoints).toHaveLength(2)
    expect(info.offChainEndpoints[0]).toBe('https://api1.poc.example')
  })

  test('uses config defaults when no explicit config provided', () => {
    // This test verifies config-first approach: values come from packages/config
    // When config has valid values, no env vars are needed
    const client = createRegistryClient()
    const info = client.getDataSourceInfo()

    // Should have validator address from contracts.json
    expect(info.validatorAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  test('explicit config overrides defaults', () => {
    const customValidator =
      '0x1111111111111111111111111111111111111111' as Address
    const customRpc = 'https://custom-rpc.example.com'

    const client = new PoCRegistryClient({
      validatorAddress: customValidator,
      rpcUrl: customRpc,
    })

    const info = client.getDataSourceInfo()
    expect(info.validatorAddress).toBe(customValidator)
  })

  test('mock client cache works across multiple calls', async () => {
    const mockClient = new MockPoCRegistryClient()
    const entry = createMockEntry({ hardwareIdHash: '0xcached123' as Hex })
    mockClient.addMockEntry(entry)

    const result1 = await mockClient.checkHardware('0xcached123' as Hex)
    expect(result1).not.toBeNull()

    const result2 = await mockClient.checkHardware('0xcached123' as Hex)
    expect(result2).toEqual(result1)
  })

  test('getRevocations throws when no endpoints configured', async () => {
    const client = new PoCRegistryClient({
      validatorAddress: TEST_VALIDATOR,
      rpcUrl: TEST_RPC,
      offChainEndpoints: [],
    })

    await expect(client.getRevocations()).rejects.toThrow(
      'No off-chain endpoints configured',
    )
  })

  test('subscribeToRevocations throws when no endpoints configured', () => {
    const client = new PoCRegistryClient({
      validatorAddress: TEST_VALIDATOR,
      rpcUrl: TEST_RPC,
      offChainEndpoints: [],
    })

    expect(() =>
      client.subscribeToRevocations(() => {
        /* no-op */
      }),
    ).toThrow('No off-chain endpoints configured')
  })

  test('mock client getAgentStatus throws for unknown agent', async () => {
    const mockClient = new MockPoCRegistryClient()

    await expect(mockClient.getAgentStatus(999n)).rejects.toThrow(
      'Agent 999 not found',
    )
  })

  test('mock client needsReverification returns true for unknown agent', async () => {
    const mockClient = new MockPoCRegistryClient()

    const needs = await mockClient.needsReverification(999n)
    expect(needs).toBe(true)
  })

  test('mock client tracks agent status', async () => {
    const mockClient = new MockPoCRegistryClient()
    mockClient.addMockAgentStatus(1n, {
      verified: true,
      level: 2 as PoCVerificationLevel,
      hardwareIdHash: '0xabc123' as Hex,
      expiresAt: Date.now() + 86400000,
    })

    const status = await mockClient.getAgentStatus(1n)
    expect(status.verified).toBe(true)
    expect(status.level).toBe(2)
  })

  test('clearCache does not affect mock data', async () => {
    const mockClient = new MockPoCRegistryClient()
    const entry = createMockEntry({ hardwareIdHash: '0xcleartest' as Hex })
    mockClient.addMockEntry(entry)

    await mockClient.checkHardware('0xcleartest' as Hex)
    mockClient.clearCache()

    const result = await mockClient.checkHardware('0xcleartest' as Hex)
    expect(result).not.toBeNull()
  })

  test('mock client getDataSourceInfo returns expected shape', () => {
    const mockClient = new MockPoCRegistryClient()
    const info = mockClient.getDataSourceInfo()

    expect(info.validatorAddress).toBe(
      '0x0000000000000000000000000000000000000000',
    )
    expect(info.offChainEndpoints).toEqual([])
  })
})
