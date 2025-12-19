/**
 * Proof-of-Cloud Tests
 * 
 * Comprehensive test suite covering:
 * - Quote parsing for all platforms (TDX, SGX, SEV-SNP)
 * - Boundary conditions and edge cases
 * - Error handling and invalid inputs
 * - Integration points with registry
 * - Concurrent/async behavior
 * - Actual output verification
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import type { Hex } from 'viem';
import { keccak256, toBytes } from 'viem';
import {
  parseQuote,
  verifyQuote,
  hashHardwareId,
  extractPlatformInfo,
  checkTCBStatus,
} from '../quote-parser';
import {
  MockPoCRegistryClient,
  PoCRegistryClient,
} from '../registry-client';
import {
  type TEEQuote,
  type PoCRegistryEntry,
  type PoCVerificationLevel,
  PoCError,
  PoCErrorCode,
} from '../types';

// ============================================================================
// Test Data - Realistic Quote Structures
// ============================================================================

/**
 * Create a properly structured Intel TDX quote for testing.
 * This creates a minimal but valid DCAP v4 quote structure.
 */
function createMockTDXQuote(): Hex {
  // Total size: header (48) + report body (584) + sig data len (4) + sig (64)
  const totalLen = 48 + 584 + 4 + 64;
  const quote = new Uint8Array(totalLen);
  
  // Header (48 bytes)
  quote[0] = 4; // version = 4 (LE)
  quote[1] = 0;
  quote[2] = 0; // attestation key type = ECDSA-P256
  quote[3] = 0;
  quote[4] = 0x81; // TEE type = TDX (0x81)
  quote[5] = 0;
  quote[6] = 0;
  quote[7] = 0;
  // reserved (4 bytes) at offset 8-11
  
  // Vendor ID (Intel) at offset 12-28: 939a7233f79c4ca9940a0db3957f0607
  const intelVendorId = [0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 
                         0x94, 0x0a, 0x0d, 0xb3, 0x95, 0x7f, 0x06, 0x07];
  for (let i = 0; i < 16; i++) {
    quote[12 + i] = intelVendorId[i];
  }
  // userData (20 bytes) at offset 28-47

  // Report body at offset 48 (584 bytes for TDX)
  // TEE_TCB_SVN at offset 0-15 (16 bytes)
  quote[48] = 0x03; // CPU SVN >= minimum
  quote[49] = 0x04; // TCB SVN >= minimum
  
  // Fill MR_SEAM (offset 16-63, 48 bytes)
  for (let i = 0; i < 48; i++) {
    quote[48 + 16 + i] = (i * 7 + 1) % 256;
  }
  
  // Fill MR_SIGNER_SEAM (offset 64-111, 48 bytes)
  for (let i = 0; i < 48; i++) {
    quote[48 + 64 + i] = (i * 11 + 2) % 256;
  }
  
  // Fill MR_TD (offset 136-183, 48 bytes) - this is the main measurement
  for (let i = 0; i < 48; i++) {
    quote[48 + 136 + i] = (i * 13 + 3) % 256;
  }
  
  // Fill REPORT_DATA (offset 520-583, 64 bytes)
  for (let i = 0; i < 64; i++) {
    quote[48 + 520 + i] = (i * 17 + 5) % 256;
  }
  
  // Signature data length at offset 48 + 584 = 632
  // 64 bytes signature (little-endian uint32)
  quote[632] = 64;
  quote[633] = 0;
  quote[634] = 0;
  quote[635] = 0;
  
  // ECDSA signature (64 bytes: r || s) at offset 636
  // Use valid-looking signature values (non-zero, in curve order range)
  for (let i = 0; i < 32; i++) {
    quote[636 + i] = (i * 11 + 0x10) % 256;     // r component
    quote[636 + 32 + i] = (i * 13 + 0x20) % 256; // s component
  }

  return ('0x' + Array.from(quote).map(b => b.toString(16).padStart(2, '0')).join('')) as Hex;
}

/**
 * Create a properly structured AMD SEV-SNP report for testing.
 */
function createMockSEVQuote(): Hex {
  // Create a minimal SEV-SNP report structure (0x2A0 bytes + 512 byte signature)
  const report = new Uint8Array(0x2A0 + 512);
  
  // Version = 2 (SEV-SNP version 2)
  report[0] = 2;
  report[1] = 0;
  report[2] = 0;
  report[3] = 0;
  
  // Guest SVN at offset 4
  report[4] = 0x0a; // SVN = 10 (>= minimum)
  
  // Current TCB at offset 0x38 (8 bytes)
  report[0x38] = 0x0a; // SNP version >= minimum
  
  // Fill measurement (at 0x90, 48 bytes)
  for (let i = 0; i < 48; i++) {
    report[0x90 + i] = (i * 13 + 1) % 256;
  }
  
  // Fill chip ID (at 0x1A0, 64 bytes) - unique hardware identifier
  for (let i = 0; i < 64; i++) {
    report[0x1A0 + i] = (i * 17 + 2) % 256;
  }
  
  // Fill RSA-4096 signature (at 0x2A0, 512 bytes)
  // Use non-trivial values to pass signature structure check
  for (let i = 0; i < 512; i++) {
    report[0x2A0 + i] = (i * 19 + 3) % 256;
  }

  return ('0x' + Array.from(report).map(b => b.toString(16).padStart(2, '0')).join('')) as Hex;
}

/**
 * Create a TDX quote with outdated TCB
 */
function createOutdatedTCBQuote(): Hex {
  const quote = new Uint8Array(48 + 584 + 4 + 64);
  
  quote[0] = 4; // version
  quote[1] = 0;
  quote[4] = 0x81; // TDX
  
  const intelVendorId = [0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 
                         0x94, 0x0a, 0x0d, 0xb3, 0x95, 0x7f, 0x06, 0x07];
  for (let i = 0; i < 16; i++) quote[12 + i] = intelVendorId[i];
  
  // TCB bytes at 48-49: set to 0x00 0x00 → cpu=0, tcb=0 → below minimum
  quote[48] = 0x00;
  quote[49] = 0x00;
  for (let i = 2; i < 16; i++) quote[48 + i] = i;
  for (let i = 16; i < 584; i++) quote[48 + i] = ((i * 7) % 254) + 1;
  
  quote[632] = 64; // sig length
  for (let i = 0; i < 64; i++) quote[636 + i] = ((i * 11 + 0x10) % 255) + 1;

  return ('0x' + Array.from(quote).map(b => b.toString(16).padStart(2, '0')).join('')) as Hex;
}

/**
 * Create a mock Intel SGX quote for testing
 */
function createMockSGXQuote(): Hex {
  // SGX: header (48) + report body (384) + sig data len (4) + sig
  const totalLen = 48 + 384 + 4 + 64;
  const quote = new Uint8Array(totalLen);
  
  quote[0] = 4; // version = 4
  quote[1] = 0;
  quote[4] = 0x00; // TEE type = SGX (0x00)
  quote[5] = 0;
  quote[6] = 0;
  quote[7] = 0;
  
  const intelVendorId = [0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 
                         0x94, 0x0a, 0x0d, 0xb3, 0x95, 0x7f, 0x06, 0x07];
  for (let i = 0; i < 16; i++) quote[12 + i] = intelVendorId[i];
  
  // SGX report body at offset 48
  quote[48] = 0x03; // cpuSvn
  quote[49] = 0x04;
  
  // MRENCLAVE at offset 48+64, 32 bytes
  for (let i = 0; i < 32; i++) quote[48 + 64 + i] = (i * 13 + 1) % 256;
  
  // MRSIGNER at offset 48+128, 32 bytes
  for (let i = 0; i < 32; i++) quote[48 + 128 + i] = (i * 17 + 2) % 256;
  
  // ISV_PROD_ID at offset 48+256
  quote[48 + 256] = 0x01;
  // ISV_SVN at offset 48+258
  quote[48 + 258] = 0x05;
  
  // REPORT_DATA at offset 48+320, 64 bytes
  for (let i = 0; i < 64; i++) quote[48 + 320 + i] = (i * 19 + 3) % 256;
  
  // Signature data length at offset 48+384
  quote[432] = 64;
  
  // ECDSA signature
  for (let i = 0; i < 64; i++) quote[436 + i] = (i * 11 + 0x10) % 256;

  return ('0x' + Array.from(quote).map(b => b.toString(16).padStart(2, '0')).join('')) as Hex;
}

/**
 * Create a quote with invalid vendor ID
 */
function createInvalidVendorQuote(): Hex {
  const quote = new Uint8Array(700);
  quote[0] = 4; // version
  quote[4] = 0x81; // TDX
  // Leave vendor ID as zeros (invalid)
  return ('0x' + Array.from(quote).map(b => b.toString(16).padStart(2, '0')).join('')) as Hex;
}

/**
 * Create a quote with signature extending beyond bounds
 */
function createOverflowSignatureQuote(): Hex {
  const quote = new Uint8Array(700);
  quote[0] = 4; // version
  quote[4] = 0x81; // TDX
  
  const intelVendorId = [0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 
                         0x94, 0x0a, 0x0d, 0xb3, 0x95, 0x7f, 0x06, 0x07];
  for (let i = 0; i < 16; i++) quote[12 + i] = intelVendorId[i];
  
  // Set signature length to exceed buffer
  quote[632] = 0xFF;
  quote[633] = 0xFF;
  quote[634] = 0x00;
  quote[635] = 0x00; // 0xFFFF = 65535 bytes (way too big)
  
  return ('0x' + Array.from(quote).map(b => b.toString(16).padStart(2, '0')).join('')) as Hex;
}

/**
 * Create quote at exactly minimum size
 */
function createMinSizeQuote(): Hex {
  const quote = new Uint8Array(128); // Minimum size
  quote[0] = 4; // version
  quote[4] = 0x81; // TDX
  const intelVendorId = [0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 
                         0x94, 0x0a, 0x0d, 0xb3, 0x95, 0x7f, 0x06, 0x07];
  for (let i = 0; i < 16; i++) quote[12 + i] = intelVendorId[i];
  return ('0x' + Array.from(quote).map(b => b.toString(16).padStart(2, '0')).join('')) as Hex;
}

/**
 * Create quote with all-zero signature
 */
function createZeroSignatureQuote(): Hex {
  const quote = new Uint8Array(700);
  quote[0] = 4;
  quote[4] = 0x81;
  const intelVendorId = [0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 
                         0x94, 0x0a, 0x0d, 0xb3, 0x95, 0x7f, 0x06, 0x07];
  for (let i = 0; i < 16; i++) quote[12 + i] = intelVendorId[i];
  quote[48] = 0x03; quote[49] = 0x04; // valid TCB
  for (let i = 16; i < 584; i++) quote[48 + i] = (i * 7) % 256;
  quote[632] = 64; // sig length, but signature bytes are all 0
  return ('0x' + Array.from(quote).map(b => b.toString(16).padStart(2, '0')).join('')) as Hex;
}

/**
 * Create SEV quote with TCB exactly at minimum
 */
function createSEVMinTCBQuote(): Hex {
  const report = new Uint8Array(0x2A0 + 512);
  report[0] = 2;
  report[4] = 0x0a; // guestSvn = 10, exactly at minimum
  report[0x38] = 0x0a; // currentTcb = 10
  for (let i = 0; i < 48; i++) report[0x90 + i] = (i * 13 + 1) % 256;
  for (let i = 0; i < 64; i++) report[0x1A0 + i] = (i * 17 + 2) % 256;
  for (let i = 0; i < 512; i++) report[0x2A0 + i] = (i * 19 + 3) % 256;
  return ('0x' + Array.from(report).map(b => b.toString(16).padStart(2, '0')).join('')) as Hex;
}

/** Helper to create a valid registry entry */
function createMockEntry(overrides: Partial<PoCRegistryEntry> = {}): PoCRegistryEntry {
  return {
    hardwareIdHash: ('0x' + 'ab'.repeat(32)) as Hex,
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
  };
}

// ============================================================================
// Quote Parser Tests
// ============================================================================

describe('Quote Parser', () => {
  describe('parseQuote', () => {
    test('parses TDX quote successfully', () => {
      const quoteHex = createMockTDXQuote();
      const result = parseQuote(quoteHex);
      
      expect(result.success).toBe(true);
      expect(result.quote).not.toBeNull();
      expect(result.quote!.platform).toBe('intel_tdx');
      expect(result.quote!.raw).toBe(quoteHex);
    });

    test('parses SEV-SNP quote successfully', () => {
      const quoteHex = createMockSEVQuote();
      const result = parseQuote(quoteHex);
      
      expect(result.success).toBe(true);
      expect(result.quote).not.toBeNull();
      expect(result.quote!.platform).toBe('amd_sev');
    });

    test('parses SGX quote successfully', () => {
      const quoteHex = createMockSGXQuote();
      const result = parseQuote(quoteHex);
      
      expect(result.success).toBe(true);
      expect(result.quote).not.toBeNull();
      expect(result.quote!.platform).toBe('intel_sgx');
    });

    test('rejects quote that is too short', () => {
      const invalidQuote = '0x1234567890' as Hex;
      const result = parseQuote(invalidQuote);
      
      expect(result.success).toBe(false);
      expect(result.quote).toBeNull();
      expect(result.error).toContain('too short');
    });

    test('rejects empty quote', () => {
      const result = parseQuote('0x' as Hex);
      expect(result.success).toBe(false);
      expect(result.error).toContain('too short');
    });

    test('rejects quote with invalid DCAP version', () => {
      const quote = new Uint8Array(700);
      quote[0] = 3;
      const quoteHex = ('0x' + Array.from(quote).map(b => b.toString(16).padStart(2, '0')).join('')) as Hex;
      
      const result = parseQuote(quoteHex);
      expect(result.success).toBe(false);
      expect(result.error).toContain('version');
    });

    test('rejects quote with invalid vendor ID', () => {
      const quoteHex = createInvalidVendorQuote();
      const result = parseQuote(quoteHex);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('vendor');
    });

    test('rejects quote with signature overflow', () => {
      const quoteHex = createOverflowSignatureQuote();
      const result = parseQuote(quoteHex);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Signature extends beyond');
    });

    test('handles quote at exactly minimum size', () => {
      const quoteHex = createMinSizeQuote();
      const result = parseQuote(quoteHex);
      
      // Minimum size quote lacks report body, should fail
      expect(result.success).toBe(false);
    });

    test('rejects unknown TEE type', () => {
      const quote = new Uint8Array(700);
      quote[0] = 4; // version
      quote[4] = 0xFF; // unknown TEE type
      const intelVendorId = [0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 
                             0x94, 0x0a, 0x0d, 0xb3, 0x95, 0x7f, 0x06, 0x07];
      for (let i = 0; i < 16; i++) quote[12 + i] = intelVendorId[i];
      const quoteHex = ('0x' + Array.from(quote).map(b => b.toString(16).padStart(2, '0')).join('')) as Hex;
      
      const result = parseQuote(quoteHex);
      expect(result.success).toBe(false);
      expect(result.error).toContain('TEE type');
    });

    test('extracts hardware ID from TDX quote', () => {
      const quoteHex = createMockTDXQuote();
      const result = parseQuote(quoteHex);
      
      expect(result.success).toBe(true);
      expect(result.quote!.hardwareId).toMatch(/^0x[a-f0-9]{64}$/);
    });

    test('extracts measurement from TDX quote', () => {
      const quoteHex = createMockTDXQuote();
      const result = parseQuote(quoteHex);
      
      expect(result.success).toBe(true);
      expect(result.quote!.measurement).toMatch(/^0x[a-f0-9]+$/);
      expect(result.quote!.measurement).not.toBe('0x' + '00'.repeat(48));
    });

    test('extracts chip ID from SEV quote', () => {
      const quoteHex = createMockSEVQuote();
      const result = parseQuote(quoteHex);
      
      expect(result.success).toBe(true);
      expect(result.quote!.hardwareId.length).toBe(2 + 64 * 2);
    });

    test('verifies parsed bytes match input', () => {
      const quoteHex = createMockTDXQuote();
      const result = parseQuote(quoteHex);
      
      expect(result.success).toBe(true);
      expect(result.quote!.raw).toBe(quoteHex);
      
      // Verify measurement extraction is deterministic
      const result2 = parseQuote(quoteHex);
      expect(result2.quote!.measurement).toBe(result.quote!.measurement);
      expect(result2.quote!.hardwareId).toBe(result.quote!.hardwareId);
    });

    test('different quotes produce different hardware IDs', () => {
      const tdx1 = createMockTDXQuote();
      const tdx2 = createMockSEVQuote();
      
      const r1 = parseQuote(tdx1);
      const r2 = parseQuote(tdx2);
      
      expect(r1.quote!.hardwareId).not.toBe(r2.quote!.hardwareId);
    });
  });

  describe('verifyQuote', () => {
    test('verifies valid quote structure', async () => {
      const quoteHex = createMockTDXQuote();
      const parseResult = parseQuote(quoteHex);
      expect(parseResult.success).toBe(true);
      
      const verifyResult = await verifyQuote(parseResult.quote!);
      
      expect(verifyResult.quote).toBeDefined();
      expect(verifyResult.measurementMatch).toBe(true);
    });

    test('detects measurement mismatch', async () => {
      const quoteHex = createMockTDXQuote();
      const parseResult = parseQuote(quoteHex);
      expect(parseResult.success).toBe(true);
      
      const wrongMeasurement = '0x' + '11'.repeat(48) as Hex;
      const verifyResult = await verifyQuote(parseResult.quote!, wrongMeasurement);
      
      expect(verifyResult.measurementMatch).toBe(false);
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.error).toContain('Measurement mismatch');
    });

    test('validates signature structure for ECDSA', async () => {
      const quoteHex = createMockTDXQuote();
      const parseResult = parseQuote(quoteHex);
      expect(parseResult.success).toBe(true);
      
      const verifyResult = await verifyQuote(parseResult.quote!);
      expect(verifyResult.quote.signature.length).toBeGreaterThan(10);
    });

    test('handles measurement match with correct value', async () => {
      const quoteHex = createMockTDXQuote();
      const parseResult = parseQuote(quoteHex);
      expect(parseResult.success).toBe(true);
      
      // Use actual measurement from quote
      const verifyResult = await verifyQuote(
        parseResult.quote!,
        parseResult.quote!.measurement
      );
      
      expect(verifyResult.measurementMatch).toBe(true);
    });

    test('handles case-insensitive measurement comparison', async () => {
      const quoteHex = createMockTDXQuote();
      const parseResult = parseQuote(quoteHex);
      expect(parseResult.success).toBe(true);
      
      const upperMeasurement = parseResult.quote!.measurement.toUpperCase() as Hex;
      const verifyResult = await verifyQuote(parseResult.quote!, upperMeasurement);
      
      expect(verifyResult.measurementMatch).toBe(true);
    });

    test('detects zero signature as invalid', async () => {
      const quoteHex = createZeroSignatureQuote();
      const parseResult = parseQuote(quoteHex);
      expect(parseResult.success).toBe(true);
      
      const verifyResult = await verifyQuote(parseResult.quote!);
      
      // Zero signature should fail r/s range check
      expect(verifyResult.signatureValid).toBe(false);
    });

    test('verifies SEV-SNP signature structure', async () => {
      const quoteHex = createMockSEVQuote();
      const parseResult = parseQuote(quoteHex);
      expect(parseResult.success).toBe(true);
      
      const verifyResult = await verifyQuote(parseResult.quote!);
      
      // SEV uses RSA-4096 (512 bytes)
      expect(parseResult.quote!.signature.length).toBe(2 + 512 * 2);
    });

    test('concurrent verification calls return consistent results', async () => {
      const quoteHex = createMockTDXQuote();
      const parseResult = parseQuote(quoteHex);
      expect(parseResult.success).toBe(true);
      
      // Run multiple verifications concurrently
      const results = await Promise.all([
        verifyQuote(parseResult.quote!),
        verifyQuote(parseResult.quote!),
        verifyQuote(parseResult.quote!),
      ]);
      
      // All results should be identical
      expect(results[0].measurementMatch).toBe(results[1].measurementMatch);
      expect(results[1].measurementMatch).toBe(results[2].measurementMatch);
      expect(results[0].tcbStatus).toBe(results[1].tcbStatus);
    });
  });

  describe('checkTCBStatus', () => {
    test('returns upToDate for valid TCB', () => {
      const quoteHex = createMockTDXQuote();
      const parseResult = parseQuote(quoteHex);
      expect(parseResult.success).toBe(true);
      
      const status = checkTCBStatus(parseResult.quote!);
      expect(status).toBe('upToDate');
    });

    test('returns outOfDate for low TCB', () => {
      const quoteHex = createOutdatedTCBQuote();
      const parseResult = parseQuote(quoteHex);
      expect(parseResult.success).toBe(true);
      
      const status = checkTCBStatus(parseResult.quote!);
      expect(status).toBe('outOfDate');
    });

    test('returns upToDate for SEV at exact minimum', () => {
      const quoteHex = createSEVMinTCBQuote();
      const parseResult = parseQuote(quoteHex);
      expect(parseResult.success).toBe(true);
      
      const status = checkTCBStatus(parseResult.quote!);
      expect(status).toBe('upToDate');
    });

    test('returns upToDate for SGX with valid TCB', () => {
      const quoteHex = createMockSGXQuote();
      const parseResult = parseQuote(quoteHex);
      expect(parseResult.success).toBe(true);
      
      const status = checkTCBStatus(parseResult.quote!);
      expect(status).toBe('upToDate');
    });

    test('handles different platforms consistently', () => {
      const tdx = parseQuote(createMockTDXQuote()).quote!;
      const sev = parseQuote(createMockSEVQuote()).quote!;
      const sgx = parseQuote(createMockSGXQuote()).quote!;
      
      // All valid quotes should be upToDate
      expect(checkTCBStatus(tdx)).toBe('upToDate');
      expect(checkTCBStatus(sev)).toBe('upToDate');
      expect(checkTCBStatus(sgx)).toBe('upToDate');
    });

    test('boundary: cpu exactly at minimum passes', () => {
      // Create quote with cpu=2 (exactly at minimum)
      const quote = new Uint8Array(700);
      quote[0] = 4;
      quote[4] = 0x81; // TDX
      const intelVendorId = [0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 
                             0x94, 0x0a, 0x0d, 0xb3, 0x95, 0x7f, 0x06, 0x07];
      for (let i = 0; i < 16; i++) quote[12 + i] = intelVendorId[i];
      quote[48] = 0x02; // cpu = 2 (minimum)
      quote[49] = 0x03; // tcb = 3 (minimum)
      for (let i = 16; i < 584; i++) quote[48 + i] = (i * 7) % 256;
      quote[632] = 64;
      for (let i = 0; i < 64; i++) quote[636 + i] = (i + 1) % 256;
      
      const quoteHex = ('0x' + Array.from(quote).map(b => b.toString(16).padStart(2, '0')).join('')) as Hex;
      const parseResult = parseQuote(quoteHex);
      expect(parseResult.success).toBe(true);
      
      const status = checkTCBStatus(parseResult.quote!);
      expect(status).toBe('upToDate');
    });

    test('boundary: cpu one below minimum fails', () => {
      const quote = new Uint8Array(700);
      quote[0] = 4;
      quote[4] = 0x81;
      const intelVendorId = [0x93, 0x9a, 0x72, 0x33, 0xf7, 0x9c, 0x4c, 0xa9, 
                             0x94, 0x0a, 0x0d, 0xb3, 0x95, 0x7f, 0x06, 0x07];
      for (let i = 0; i < 16; i++) quote[12 + i] = intelVendorId[i];
      // cpu is read as uint16 LE from bytes 48-49
      // For cpu=1: set byte[48]=0x01, byte[49]=0x00
      quote[48] = 0x01; // cpu low byte = 1
      quote[49] = 0x00; // cpu high byte = 0 → cpu = 1 (below minimum of 2)
      // tcb comes from teeTcbSvn bytes 0-1 interpreted differently
      // To ensure tcb passes but cpu fails, fill rest with valid values
      for (let i = 2; i < 16; i++) quote[48 + i] = 0x10;
      for (let i = 16; i < 584; i++) quote[48 + i] = (i * 7) % 256;
      quote[632] = 64;
      for (let i = 0; i < 64; i++) quote[636 + i] = (i + 1) % 256;
      
      const quoteHex = ('0x' + Array.from(quote).map(b => b.toString(16).padStart(2, '0')).join('')) as Hex;
      const parseResult = parseQuote(quoteHex);
      expect(parseResult.success).toBe(true);
      
      // With cpu=1 (below minimum of 2), should be outOfDate
      const status = checkTCBStatus(parseResult.quote!);
      expect(status).toBe('outOfDate');
    });
  });

  describe('hashHardwareId', () => {
    test('produces consistent hashes', () => {
      const hardwareId = '0x' + 'ab'.repeat(32) as Hex;
      const salt = '0x' + '12'.repeat(32) as Hex;
      
      const hash1 = hashHardwareId(hardwareId, salt);
      const hash2 = hashHardwareId(hardwareId, salt);
      
      expect(hash1).toBe(hash2);
    });

    test('different salts produce different hashes', () => {
      const hardwareId = '0x' + 'ab'.repeat(32) as Hex;
      const salt1 = '0x' + '12'.repeat(32) as Hex;
      const salt2 = '0x' + 'fe'.repeat(32) as Hex;
      
      const hash1 = hashHardwareId(hardwareId, salt1);
      const hash2 = hashHardwareId(hardwareId, salt2);
      
      expect(hash1).not.toBe(hash2);
    });

    test('different hardware IDs produce different hashes', () => {
      const hardwareId1 = '0x' + 'ab'.repeat(32) as Hex;
      const hardwareId2 = '0x' + 'cd'.repeat(32) as Hex;
      const salt = '0x' + '12'.repeat(32) as Hex;
      
      const hash1 = hashHardwareId(hardwareId1, salt);
      const hash2 = hashHardwareId(hardwareId2, salt);
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('extractPlatformInfo', () => {
    test('returns correct info for TDX', () => {
      const quoteHex = createMockTDXQuote();
      const parseResult = parseQuote(quoteHex);
      expect(parseResult.success).toBe(true);
      
      const info = extractPlatformInfo(parseResult.quote!);
      
      expect(info.platformName).toBe('Intel TDX');
      expect(info.hardwareIdType).toContain('MRTD');
    });

    test('returns correct info for SEV', () => {
      const quoteHex = createMockSEVQuote();
      const parseResult = parseQuote(quoteHex);
      expect(parseResult.success).toBe(true);
      
      const info = extractPlatformInfo(parseResult.quote!);
      
      expect(info.platformName).toBe('AMD SEV-SNP');
      expect(info.hardwareIdType).toBe('Chip ID');
    });
  });
});

// ============================================================================
// Registry Client Tests
// ============================================================================

describe('Registry Client', () => {
  let mockClient: MockPoCRegistryClient;

  beforeEach(() => {
    mockClient = new MockPoCRegistryClient();
  });

  test('verifyQuote returns false for unknown hardware', async () => {
    const quoteHex = createMockTDXQuote();
    const response = await mockClient.verifyQuote(quoteHex);
    
    expect(response.verified).toBe(false);
    expect(response.error).toContain('not found');
  });

  test('verifyQuote returns true for registered hardware', async () => {
    const quoteHex = createMockTDXQuote();
    const hardwareIdHash = ('0x' + quoteHex.slice(2, 66).padEnd(64, '0')) as Hex;
    
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash }));
    
    const response = await mockClient.verifyQuote(quoteHex);
    
    expect(response.verified).toBe(true);
    expect(response.level).toBe(2);
    expect(response.cloudProvider).toBe('aws');
  });

  test('verifyQuote returns false for revoked hardware', async () => {
    const hardwareIdHash = ('0x' + 'ab'.repeat(32)) as Hex;
    
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash }));
    mockClient.addMockRevocation({
      hardwareIdHash,
      reason: 'Compromised in side-channel attack',
      evidenceHash: '0x' as Hex,
      timestamp: Date.now(),
      approvers: ['alliance-member-1'],
    });
    
    const quoteHex = ('0x' + 'ab'.repeat(32) + '00'.repeat(350)) as Hex;
    const response = await mockClient.verifyQuote(quoteHex);
    
    expect(response.verified).toBe(false);
    expect(response.error).toContain('revoked');
  });

  test('checkHardware returns null for unknown hardware', async () => {
    const unknownHash = ('0x' + '99'.repeat(32)) as Hex;
    const entry = await mockClient.checkHardware(unknownHash);
    expect(entry).toBeNull();
  });

  test('checkHardware returns entry for known hardware', async () => {
    const knownHash = ('0x' + 'ab'.repeat(32)) as Hex;
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash: knownHash }));
    
    const entry = await mockClient.checkHardware(knownHash);
    
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe(2);
    expect(entry!.cloudProvider).toBe('aws');
  });

  test('isRevoked returns false for valid hardware', async () => {
    const validHash = ('0x' + '11'.repeat(32)) as Hex;
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash: validHash }));
    
    const isRevoked = await mockClient.isRevoked(validHash);
    expect(isRevoked).toBe(false);
  });

  test('revocation marks hardware as inactive', async () => {
    const revokedHash = ('0x' + '22'.repeat(32)) as Hex;
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash: revokedHash }));
    mockClient.addMockRevocation({
      hardwareIdHash: revokedHash,
      reason: 'Compromised',
      evidenceHash: '0x' as Hex,
      timestamp: Date.now(),
      approvers: ['alliance-member-1'],
    });
    
    const isRevoked = await mockClient.isRevoked(revokedHash);
    expect(isRevoked).toBe(true);
    
    const entry = await mockClient.checkHardware(revokedHash);
    expect(entry?.active).toBe(false);
  });

  test('isHardwareValid returns true for active entry', async () => {
    const hash = ('0x' + '33'.repeat(32)) as Hex;
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash: hash, active: true }));
    
    const valid = await mockClient.isHardwareValid(hash);
    expect(valid).toBe(true);
  });

  test('isHardwareValid returns false for inactive entry', async () => {
    const hash = ('0x' + '44'.repeat(32)) as Hex;
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash: hash }));
    mockClient.addMockRevocation({
      hardwareIdHash: hash,
      reason: 'Test revocation',
      evidenceHash: '0x' as Hex,
      timestamp: Date.now(),
      approvers: ['test'],
    });
    
    const valid = await mockClient.isHardwareValid(hash);
    expect(valid).toBe(false);
  });

  test('getEndorsements returns empty array for new entry', async () => {
    const hash = ('0x' + '55'.repeat(32)) as Hex;
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash: hash, endorsements: [] }));
    
    const endorsements = await mockClient.getEndorsements(hash);
    expect(endorsements).toEqual([]);
  });

  test('getEndorsements returns populated array', async () => {
    const hash = ('0x' + '66'.repeat(32)) as Hex;
    const mockEndorsement = {
      memberId: 'member-1',
      signature: '0x1234' as Hex,
      timestamp: Date.now(),
    };
    mockClient.addMockEntry(createMockEntry({ 
      hardwareIdHash: hash, 
      endorsements: [mockEndorsement] 
    }));
    
    const endorsements = await mockClient.getEndorsements(hash);
    expect(endorsements.length).toBe(1);
    expect(endorsements[0].memberId).toBe('member-1');
  });

  test('handles multiple entries independently', async () => {
    const hash1 = ('0x' + '77'.repeat(32)) as Hex;
    const hash2 = ('0x' + '88'.repeat(32)) as Hex;
    
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash: hash1, level: 1 }));
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash: hash2, level: 3 }));
    
    const entry1 = await mockClient.checkHardware(hash1);
    const entry2 = await mockClient.checkHardware(hash2);
    
    expect(entry1!.level).toBe(1);
    expect(entry2!.level).toBe(3);
  });

  test('getRevocations returns all revocations', async () => {
    const hash1 = ('0x' + 'aa'.repeat(32)) as Hex;
    const hash2 = ('0x' + 'bb'.repeat(32)) as Hex;
    
    mockClient.addMockRevocation({
      hardwareIdHash: hash1,
      reason: 'Reason 1',
      evidenceHash: '0x' as Hex,
      timestamp: Date.now(),
      approvers: ['approver1'],
    });
    mockClient.addMockRevocation({
      hardwareIdHash: hash2,
      reason: 'Reason 2',
      evidenceHash: '0x' as Hex,
      timestamp: Date.now(),
      approvers: ['approver2'],
    });
    
    const revocations = await mockClient.getRevocations();
    expect(revocations.length).toBe(2);
  });

  test('concurrent lookups return consistent results', async () => {
    const hash = ('0x' + 'cc'.repeat(32)) as Hex;
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash: hash, level: 2 }));
    
    const results = await Promise.all([
      mockClient.checkHardware(hash),
      mockClient.checkHardware(hash),
      mockClient.checkHardware(hash),
      mockClient.isHardwareValid(hash),
      mockClient.isRevoked(hash),
    ]);
    
    expect(results[0]!.level).toBe(2);
    expect(results[1]!.level).toBe(2);
    expect(results[2]!.level).toBe(2);
    expect(results[3]).toBe(true);
    expect(results[4]).toBe(false);
  });

  test('all verification levels are valid', async () => {
    const levels: PoCVerificationLevel[] = [1, 2, 3];
    
    for (const level of levels) {
      const hash = (`0x${level}${'0'.repeat(63)}`) as Hex;
      mockClient.addMockEntry(createMockEntry({ hardwareIdHash: hash, level }));
      
      const entry = await mockClient.checkHardware(hash);
      expect(entry!.level).toBe(level);
    }
  });

  test('clearCache does not affect mock data', () => {
    const hash = ('0x' + 'dd'.repeat(32)) as Hex;
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash: hash }));
    
    mockClient.clearCache();
    
    // Mock data should still be accessible
    const entry = mockClient.checkHardware(hash);
    expect(entry).resolves.not.toBeNull();
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  test('PoCError includes error code', () => {
    const error = new PoCError(
      PoCErrorCode.INVALID_QUOTE,
      'Test error message',
      { detail: 'extra info' }
    );
    
    expect(error.code).toBe(PoCErrorCode.INVALID_QUOTE);
    expect(error.message).toContain('INVALID_QUOTE');
    expect(error.message).toContain('Test error message');
    expect(error.context).toEqual({ detail: 'extra info' });
  });

  test('PoCError works with instanceof', () => {
    const error = new PoCError(PoCErrorCode.ORACLE_UNAVAILABLE, 'Oracle down');
    
    expect(error instanceof Error).toBe(true);
    expect(error instanceof PoCError).toBe(true);
    expect(error.name).toBe('PoCError');
  });

  test('PoCError includes all error codes', () => {
    const codes = Object.values(PoCErrorCode);
    expect(codes.length).toBeGreaterThan(5);
    
    for (const code of codes) {
      const error = new PoCError(code, 'test');
      expect(error.code).toBe(code);
    }
  });

  test('PoCError preserves stack trace', () => {
    const error = new PoCError(PoCErrorCode.SIGNATURE_INVALID, 'Bad signature');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('PoCError');
  });

  test('PoCError context is optional', () => {
    const error = new PoCError(PoCErrorCode.AGENT_NOT_FOUND, 'No agent');
    expect(error.context).toBeUndefined();
  });

  test('PoCError context can contain complex objects', () => {
    const error = new PoCError(
      PoCErrorCode.HARDWARE_NOT_REGISTERED,
      'Unknown hardware',
      {
        hardwareId: '0x1234',
        timestamp: Date.now(),
        nested: { value: true },
        array: [1, 2, 3],
      }
    );
    
    expect(error.context?.hardwareId).toBe('0x1234');
    expect(error.context?.nested).toEqual({ value: true });
    expect(error.context?.array).toEqual([1, 2, 3]);
  });

  test('all error codes have unique values', () => {
    const codes = Object.values(PoCErrorCode);
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(codes.length);
  });

  test('error codes match expected categories', () => {
    // Quote-related errors
    expect(PoCErrorCode.INVALID_QUOTE).toBeDefined();
    expect(PoCErrorCode.QUOTE_EXPIRED).toBeDefined();
    expect(PoCErrorCode.UNSUPPORTED_PLATFORM).toBeDefined();
    
    // Crypto errors
    expect(PoCErrorCode.SIGNATURE_INVALID).toBeDefined();
    expect(PoCErrorCode.CERTIFICATE_INVALID).toBeDefined();
    expect(PoCErrorCode.TCB_OUT_OF_DATE).toBeDefined();
    
    // Registry errors
    expect(PoCErrorCode.HARDWARE_NOT_REGISTERED).toBeDefined();
    expect(PoCErrorCode.HARDWARE_REVOKED).toBeDefined();
    
    // Oracle errors
    expect(PoCErrorCode.ORACLE_UNAVAILABLE).toBeDefined();
    expect(PoCErrorCode.INSUFFICIENT_SIGNATURES).toBeDefined();
    expect(PoCErrorCode.VERIFICATION_TIMEOUT).toBeDefined();
    
    // Agent errors
    expect(PoCErrorCode.AGENT_NOT_FOUND).toBeDefined();
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  test('full verification flow with registered hardware', async () => {
    const quoteHex = createMockTDXQuote();
    const parseResult = parseQuote(quoteHex);
    expect(parseResult.success).toBe(true);
    
    const mockClient = new MockPoCRegistryClient();
    const hardwareIdHash = ('0x' + quoteHex.slice(2, 66).padEnd(64, '0')) as Hex;
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash }));
    
    const registryResult = await mockClient.verifyQuote(quoteHex);
    expect(registryResult.verified).toBe(true);
    expect(registryResult.cloudProvider).toBe('aws');
    
    const verifyResult = await verifyQuote(parseResult.quote!);
    expect(verifyResult.quote).toBeDefined();
    
    const salt = keccak256(toBytes('test-salt'));
    const hashedId = hashHardwareId(parseResult.quote!.hardwareId, salt);
    expect(hashedId).toMatch(/^0x[a-f0-9]{64}$/);
  });

  test('verification fails for unregistered hardware', async () => {
    const quoteHex = createMockTDXQuote();
    const parseResult = parseQuote(quoteHex);
    expect(parseResult.success).toBe(true);
    
    const mockClient = new MockPoCRegistryClient();
    const registryResult = await mockClient.verifyQuote(quoteHex);
    expect(registryResult.verified).toBe(false);
  });

  test('quote parsing handles various platforms', async () => {
    const tdxQuote = createMockTDXQuote();
    const sevQuote = createMockSEVQuote();
    const sgxQuote = createMockSGXQuote();
    
    const tdxResult = parseQuote(tdxQuote);
    const sevResult = parseQuote(sevQuote);
    const sgxResult = parseQuote(sgxQuote);
    
    expect(tdxResult.success).toBe(true);
    expect(sevResult.success).toBe(true);
    expect(sgxResult.success).toBe(true);
    
    expect(tdxResult.quote!.platform).toBe('intel_tdx');
    expect(sevResult.quote!.platform).toBe('amd_sev');
    expect(sgxResult.quote!.platform).toBe('intel_sgx');
    
    // All should have unique hardware IDs
    const ids = [
      tdxResult.quote!.hardwareId,
      sevResult.quote!.hardwareId,
      sgxResult.quote!.hardwareId,
    ];
    expect(new Set(ids).size).toBe(3);
  });

  test('TCB check integrates with verification', async () => {
    const validQuote = createMockTDXQuote();
    const outdatedQuote = createOutdatedTCBQuote();
    
    const validResult = parseQuote(validQuote);
    const outdatedResult = parseQuote(outdatedQuote);
    
    expect(validResult.success).toBe(true);
    expect(outdatedResult.success).toBe(true);
    
    const validVerify = await verifyQuote(validResult.quote!);
    const outdatedVerify = await verifyQuote(outdatedResult.quote!);
    
    expect(validVerify.tcbStatus).toBe('upToDate');
    expect(outdatedVerify.tcbStatus).toBe('outOfDate');
  });

  test('end-to-end: parse, verify, hash, check registry', async () => {
    const quoteHex = createMockTDXQuote();
    
    // Step 1: Parse
    const parseResult = parseQuote(quoteHex);
    expect(parseResult.success).toBe(true);
    const quote = parseResult.quote!;
    
    // Step 2: Verify crypto
    const verifyResult = await verifyQuote(quote);
    expect(verifyResult.quote.platform).toBe('intel_tdx');
    expect(verifyResult.tcbStatus).toBe('upToDate');
    
    // Step 3: Extract platform info
    const platformInfo = extractPlatformInfo(quote);
    expect(platformInfo.platformName).toBe('Intel TDX');
    
    // Step 4: Hash with salt
    const salt = keccak256(toBytes('production-salt'));
    const hashedHwId = hashHardwareId(quote.hardwareId, salt);
    
    // Step 5: Register in mock registry
    const mockClient = new MockPoCRegistryClient();
    mockClient.addMockEntry(createMockEntry({ 
      hardwareIdHash: hashedHwId,
      level: 3,
      cloudProvider: 'gcp',
      region: 'us-west1',
    }));
    
    // Step 6: Check registry
    const entry = await mockClient.checkHardware(hashedHwId);
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe(3);
    expect(entry!.cloudProvider).toBe('gcp');
    
    // Step 7: Validate status
    const isValid = await mockClient.isHardwareValid(hashedHwId);
    expect(isValid).toBe(true);
  });

  test('revocation flow: register, verify, revoke, verify again', async () => {
    const quoteHex = createMockTDXQuote();
    const hardwareIdHash = ('0x' + quoteHex.slice(2, 66).padEnd(64, '0')) as Hex;
    
    const mockClient = new MockPoCRegistryClient();
    
    // Register
    mockClient.addMockEntry(createMockEntry({ hardwareIdHash }));
    
    // Verify works
    const beforeRevoke = await mockClient.verifyQuote(quoteHex);
    expect(beforeRevoke.verified).toBe(true);
    
    // Revoke
    mockClient.addMockRevocation({
      hardwareIdHash,
      reason: 'Side-channel vulnerability detected',
      evidenceHash: keccak256(toBytes('evidence')),
      timestamp: Date.now(),
      approvers: ['alliance-member-1', 'alliance-member-2'],
    });
    
    // Verify now fails
    const afterRevoke = await mockClient.verifyQuote(quoteHex);
    expect(afterRevoke.verified).toBe(false);
    expect(afterRevoke.error).toContain('revoked');
    
    // isRevoked returns true
    const revoked = await mockClient.isRevoked(hardwareIdHash);
    expect(revoked).toBe(true);
  });

  test('multiple quotes can be verified concurrently', async () => {
    const quotes = [
      createMockTDXQuote(),
      createMockSEVQuote(),
      createMockSGXQuote(),
    ];
    
    const parseResults = await Promise.all(
      quotes.map(q => parseQuote(q))
    );
    
    expect(parseResults.every(r => r.success)).toBe(true);
    
    const verifyResults = await Promise.all(
      parseResults.map(r => verifyQuote(r.quote!))
    );
    
    // All should have valid structure
    expect(verifyResults[0].quote.platform).toBe('intel_tdx');
    expect(verifyResults[1].quote.platform).toBe('amd_sev');
    expect(verifyResults[2].quote.platform).toBe('intel_sgx');
  });

  test('hardware ID hash is different with different salts', () => {
    const quoteHex = createMockTDXQuote();
    const parseResult = parseQuote(quoteHex);
    expect(parseResult.success).toBe(true);
    
    const salt1 = keccak256(toBytes('salt-1'));
    const salt2 = keccak256(toBytes('salt-2'));
    
    const hash1 = hashHardwareId(parseResult.quote!.hardwareId, salt1);
    const hash2 = hashHardwareId(parseResult.quote!.hardwareId, salt2);
    
    expect(hash1).not.toBe(hash2);
  });

  test('same quote produces same results on repeated parsing', () => {
    const quoteHex = createMockTDXQuote();
    
    const results = Array.from({ length: 5 }, () => parseQuote(quoteHex));
    
    const firstResult = results[0];
    for (const result of results) {
      expect(result.success).toBe(firstResult.success);
      expect(result.quote!.platform).toBe(firstResult.quote!.platform);
      expect(result.quote!.hardwareId).toBe(firstResult.quote!.hardwareId);
      expect(result.quote!.measurement).toBe(firstResult.quote!.measurement);
    }
  });

  test('verification result includes all expected fields', async () => {
    const quoteHex = createMockTDXQuote();
    const parseResult = parseQuote(quoteHex);
    const verifyResult = await verifyQuote(parseResult.quote!);
    
    // Check all fields are present
    expect(verifyResult).toHaveProperty('valid');
    expect(verifyResult).toHaveProperty('quote');
    expect(verifyResult).toHaveProperty('certificateValid');
    expect(verifyResult).toHaveProperty('signatureValid');
    expect(verifyResult).toHaveProperty('measurementMatch');
    expect(verifyResult).toHaveProperty('tcbStatus');
    expect(verifyResult).toHaveProperty('error');
    
    // Check field types
    expect(typeof verifyResult.valid).toBe('boolean');
    expect(typeof verifyResult.certificateValid).toBe('boolean');
    expect(typeof verifyResult.signatureValid).toBe('boolean');
    expect(typeof verifyResult.measurementMatch).toBe('boolean');
    expect(['upToDate', 'outOfDate', 'revoked', 'unknown']).toContain(verifyResult.tcbStatus);
  });

  test('parsed quote contains all expected fields', () => {
    const quoteHex = createMockTDXQuote();
    const result = parseQuote(quoteHex);
    expect(result.success).toBe(true);
    
    const quote = result.quote!;
    
    expect(quote).toHaveProperty('raw');
    expect(quote).toHaveProperty('platform');
    expect(quote).toHaveProperty('hardwareId');
    expect(quote).toHaveProperty('measurement');
    expect(quote).toHaveProperty('reportData');
    expect(quote).toHaveProperty('securityVersion');
    expect(quote).toHaveProperty('signature');
    expect(quote).toHaveProperty('certChain');
    expect(quote).toHaveProperty('timestamp');
    
    expect(quote.securityVersion).toHaveProperty('cpu');
    expect(quote.securityVersion).toHaveProperty('tcb');
    expect(typeof quote.securityVersion.cpu).toBe('number');
    expect(typeof quote.securityVersion.tcb).toBe('number');
  });
});
