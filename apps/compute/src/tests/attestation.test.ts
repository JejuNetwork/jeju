/**
 * Attestation Tests
 *
 * Verifies the TEE attestation simulation is internally consistent.
 * NOTE: Real hardware attestation requires a TEE provider - these tests
 * verify the simulation correctly models the expected behavior.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { type Address, type Hex, keccak256, toBytes } from 'viem';
import {
  type AttestationQuote,
  formatQuoteForDisplay,
  generateQuote,
  setExpectedMeasurement,
  verifyQuote,
} from '../tee/attestation.js';

describe('Attestation', () => {
  const codeHash = keccak256(toBytes('test-code-v1')) as Hex;
  const operator = '0x1234567890123456789012345678901234567890' as Address;

  beforeEach(() => {
    setExpectedMeasurement(codeHash);
  });

  describe('quote generation', () => {
    it('generates quotes with correct structure', () => {
      const quote = generateQuote(codeHash, operator);

      expect(quote.mrEnclave).toBe(codeHash);
      expect(quote.operatorAddress).toBe(operator);
      expect(quote.cpuSignature).toMatch(/^0x[a-f0-9]{64}$/);
      expect(quote.gpuSignature).toMatch(/^0x[a-f0-9]{64}$/);
      expect(quote.timestamp).toBeLessThanOrEqual(Date.now());
      expect(quote.isSimulated).toBe(true);
    });

    it('includes custom report data', () => {
      const customData = keccak256(toBytes('custom-report-data')) as Hex;
      const quote = generateQuote(codeHash, operator, customData);

      expect(quote.reportData).toBe(customData);
    });

    it('generates unique quotes per operator', () => {
      const op1 = '0x1111111111111111111111111111111111111111' as Address;
      const op2 = '0x2222222222222222222222222222222222222222' as Address;

      const quote1 = generateQuote(codeHash, op1);
      const quote2 = generateQuote(codeHash, op2);

      expect(quote1.cpuSignature).not.toBe(quote2.cpuSignature);
    });

    it('generates unique quotes per code hash', () => {
      const hash1 = keccak256(toBytes('code-v1')) as Hex;
      const hash2 = keccak256(toBytes('code-v2')) as Hex;

      setExpectedMeasurement(hash1);
      const quote1 = generateQuote(hash1, operator);

      setExpectedMeasurement(hash2);
      const quote2 = generateQuote(hash2, operator);

      expect(quote1.mrEnclave).not.toBe(quote2.mrEnclave);
      expect(quote1.cpuSignature).not.toBe(quote2.cpuSignature);
    });
  });

  describe('quote verification', () => {
    it('validates internally consistent quotes', () => {
      const quote = generateQuote(codeHash, operator);
      const result = verifyQuote(quote);

      expect(result.valid).toBe(true);
      expect(result.codeIntegrity).toBe(true);
      expect(result.hardwareAuthentic).toBe(false); // Simulated = not hardware
      expect(result.operatorAddress).toBe(operator);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes('SIMULATION'))).toBe(true);
    });

    it('rejects tampered CPU signature', () => {
      const quote = generateQuote(codeHash, operator);
      const tampered: AttestationQuote = {
        ...quote,
        cpuSignature: keccak256(toBytes('tampered')) as Hex,
      };

      const result = verifyQuote(tampered);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('CPU/TDX'))).toBe(true);
    });

    it('rejects tampered GPU signature', () => {
      const quote = generateQuote(codeHash, operator);
      const tampered: AttestationQuote = {
        ...quote,
        gpuSignature: keccak256(toBytes('tampered')) as Hex,
      };

      const result = verifyQuote(tampered);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('GPU/CC'))).toBe(true);
    });

    it('rejects wrong code measurement', () => {
      const wrongHash = keccak256(toBytes('malicious-code')) as Hex;
      const quote = generateQuote(wrongHash, operator);

      const result = verifyQuote(quote);

      expect(result.valid).toBe(false);
      expect(result.codeIntegrity).toBe(false);
      expect(result.errors.some((e) => e.includes('mismatch'))).toBe(true);
    });

    it('rejects stale quotes (>1 hour)', () => {
      const quote = generateQuote(codeHash, operator);
      const stale: AttestationQuote = {
        ...quote,
        timestamp: Date.now() - 2 * 60 * 60 * 1000,
      };

      const result = verifyQuote(stale);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('stale'))).toBe(true);
    });
  });

  describe('display formatting', () => {
    it('formats quote with simulation warning', () => {
      const quote = generateQuote(codeHash, operator);
      const display = formatQuoteForDisplay(quote);

      expect(display).toContain('TEE ATTESTATION REPORT');
      expect(display).toContain(quote.mrEnclave);
      expect(display).toContain(quote.operatorAddress);
      expect(display).toContain('SIMULATION');
    });
  });
});
