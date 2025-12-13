/**
 * Nonce Manager Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import type { Address } from 'viem';

import {
  isNonceUsedLocally,
  markNoncePending,
  markNonceUsed,
  markNonceFailed,
  generateNonce,
  getNonceCacheStats,
  clearNonceCache,
} from '../src/services/nonce-manager';

const TEST_PAYER: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

describe('Nonce Generation', () => {
  test('should generate 32-character hex nonce', () => {
    const nonce = generateNonce();
    expect(nonce).toHaveLength(32);
    expect(/^[0-9a-f]+$/.test(nonce)).toBe(true);
  });

  test('should generate unique nonces', () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      nonces.add(generateNonce());
    }
    expect(nonces.size).toBe(100);
  });
});

describe('Local Nonce Tracking', () => {
  beforeEach(() => {
    clearNonceCache();
  });

  test('should mark nonce as pending', () => {
    const nonce = 'test-nonce-1';

    expect(isNonceUsedLocally(TEST_PAYER, nonce)).toBe(false);

    markNoncePending(TEST_PAYER, nonce);

    expect(isNonceUsedLocally(TEST_PAYER, nonce)).toBe(true);
  });

  test('should mark nonce as used after pending', () => {
    const nonce = 'test-nonce-2';

    markNoncePending(TEST_PAYER, nonce);
    expect(isNonceUsedLocally(TEST_PAYER, nonce)).toBe(true);

    markNonceUsed(TEST_PAYER, nonce);
    expect(isNonceUsedLocally(TEST_PAYER, nonce)).toBe(true);
  });

  test('should remove pending status on failure', () => {
    const nonce = 'test-nonce-3';

    markNoncePending(TEST_PAYER, nonce);
    expect(isNonceUsedLocally(TEST_PAYER, nonce)).toBe(true);

    markNonceFailed(TEST_PAYER, nonce);
    expect(isNonceUsedLocally(TEST_PAYER, nonce)).toBe(false);
  });

  test('should track different payers separately', () => {
    const nonce = 'shared-nonce';
    const payer2: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

    markNonceUsed(TEST_PAYER, nonce);

    expect(isNonceUsedLocally(TEST_PAYER, nonce)).toBe(true);
    expect(isNonceUsedLocally(payer2, nonce)).toBe(false);
  });

  test('should be case-insensitive for addresses', () => {
    const nonce = 'case-test-nonce';
    const upperPayer = TEST_PAYER.toUpperCase() as Address;
    const lowerPayer = TEST_PAYER.toLowerCase() as Address;

    markNonceUsed(upperPayer, nonce);

    expect(isNonceUsedLocally(lowerPayer, nonce)).toBe(true);
    expect(isNonceUsedLocally(upperPayer, nonce)).toBe(true);
  });
});

describe('Nonce Cache Stats', () => {
  beforeEach(() => {
    clearNonceCache();
  });

  test('should report correct counts', () => {
    // Add some used nonces
    markNonceUsed(TEST_PAYER, 'used-1');
    markNonceUsed(TEST_PAYER, 'used-2');

    // Add a pending nonce
    markNoncePending(TEST_PAYER, 'pending-1');

    const stats = getNonceCacheStats();

    expect(stats.used).toBe(2);
    expect(stats.pending).toBe(1);
    expect(stats.total).toBe(3);
  });

  test('should clear all caches', () => {
    markNonceUsed(TEST_PAYER, 'nonce-a');
    markNoncePending(TEST_PAYER, 'nonce-b');

    clearNonceCache();

    const stats = getNonceCacheStats();
    expect(stats.used).toBe(0);
    expect(stats.pending).toBe(0);
    expect(stats.total).toBe(0);
  });
});
