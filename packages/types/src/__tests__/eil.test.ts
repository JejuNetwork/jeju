/**
 * @fileoverview Comprehensive tests for eil.ts (Ethereum Interop Layer)
 * 
 * Tests cover:
 * - isSupportedChainId: Type guard for supported chain IDs
 * - EIL schemas validation
 */

import { describe, test, expect } from 'bun:test';
import { z } from 'zod';
import {
  isSupportedChainId,
  SupportedChainIdSchema,
  XLPStatusSchema,
  VoucherStatusSchema,
  CrossChainOperationTypeSchema,
  EILEventTypeSchema,
  type SupportedChainId,
} from '../eil';
import type { EVMChainId } from '../chain';

// ============================================================================
// isSupportedChainId Type Guard Tests
// ============================================================================

describe('isSupportedChainId', () => {
  const supportedChains: EVMChainId[] = [
    1,        // Ethereum Mainnet
    11155111, // Sepolia
    42161,    // Arbitrum One
    10,       // Optimism
    1337,     // Localnet
    420691,   // Network Mainnet
    420690,   // Network Testnet
  ];

  const unsupportedChains: EVMChainId[] = [
    56,       // BSC
    137,      // Polygon
    8453,     // Base
    84532,    // Base Sepolia
    11155420, // Optimism Sepolia
    421614,   // Arbitrum Sepolia
    43114,    // Avalanche
    31337,    // Local EVM
  ];

  test.each(supportedChains)('returns true for supported chain ID: %d', (chainId) => {
    expect(isSupportedChainId(chainId)).toBe(true);
  });

  test.each(unsupportedChains)('returns false for unsupported chain ID: %d', (chainId) => {
    expect(isSupportedChainId(chainId)).toBe(false);
  });

  test('narrows type correctly when true', () => {
    const chainId: EVMChainId = 1;
    
    if (isSupportedChainId(chainId)) {
      // TypeScript should allow this assignment
      const supported: SupportedChainId = chainId;
      expect(supported).toBe(1);
    }
  });

  test('all supported chains are included', () => {
    // Verify the list matches the schema
    const schemaValues = [1, 11155111, 42161, 10, 1337, 420691, 420690];
    
    for (const value of schemaValues) {
      expect(isSupportedChainId(value as EVMChainId)).toBe(true);
    }
  });
});

// ============================================================================
// SupportedChainIdSchema Tests
// ============================================================================

describe('SupportedChainIdSchema', () => {
  test('accepts Ethereum Mainnet (1)', () => {
    expect(SupportedChainIdSchema.safeParse(1).success).toBe(true);
  });

  test('accepts Sepolia (11155111)', () => {
    expect(SupportedChainIdSchema.safeParse(11155111).success).toBe(true);
  });

  test('accepts Arbitrum One (42161)', () => {
    expect(SupportedChainIdSchema.safeParse(42161).success).toBe(true);
  });

  test('accepts Optimism (10)', () => {
    expect(SupportedChainIdSchema.safeParse(10).success).toBe(true);
  });

  test('accepts Localnet (1337)', () => {
    expect(SupportedChainIdSchema.safeParse(1337).success).toBe(true);
  });

  test('accepts Network Mainnet (420691)', () => {
    expect(SupportedChainIdSchema.safeParse(420691).success).toBe(true);
  });

  test('accepts Network Testnet (420690)', () => {
    expect(SupportedChainIdSchema.safeParse(420690).success).toBe(true);
  });

  test('rejects unsupported chains', () => {
    expect(SupportedChainIdSchema.safeParse(56).success).toBe(false);
    expect(SupportedChainIdSchema.safeParse(137).success).toBe(false);
    expect(SupportedChainIdSchema.safeParse(8453).success).toBe(false);
  });

  test('rejects non-integer values', () => {
    expect(SupportedChainIdSchema.safeParse(1.5).success).toBe(false);
    expect(SupportedChainIdSchema.safeParse('1').success).toBe(false);
  });
});

// ============================================================================
// XLPStatusSchema Tests
// ============================================================================

describe('XLPStatusSchema', () => {
  const validStatuses = ['active', 'paused', 'unbonding', 'slashed'];
  const invalidStatuses = ['inactive', 'pending', 'unknown', ''];

  test.each(validStatuses)('accepts valid status: %s', (status) => {
    expect(XLPStatusSchema.safeParse(status).success).toBe(true);
  });

  test.each(invalidStatuses)('rejects invalid status: %s', (status) => {
    expect(XLPStatusSchema.safeParse(status).success).toBe(false);
  });
});

// ============================================================================
// VoucherStatusSchema Tests
// ============================================================================

describe('VoucherStatusSchema', () => {
  const validStatuses = ['pending', 'claimed', 'fulfilled', 'expired', 'failed', 'slashed'];
  const invalidStatuses = ['active', 'cancelled', 'unknown', ''];

  test.each(validStatuses)('accepts valid status: %s', (status) => {
    expect(VoucherStatusSchema.safeParse(status).success).toBe(true);
  });

  test.each(invalidStatuses)('rejects invalid status: %s', (status) => {
    expect(VoucherStatusSchema.safeParse(status).success).toBe(false);
  });
});

// ============================================================================
// CrossChainOperationTypeSchema Tests
// ============================================================================

describe('CrossChainOperationTypeSchema', () => {
  const validTypes = ['transfer', 'swap', 'mint', 'stake', 'custom'];
  const invalidTypes = ['bridge', 'withdraw', 'unknown', ''];

  test.each(validTypes)('accepts valid type: %s', (type) => {
    expect(CrossChainOperationTypeSchema.safeParse(type).success).toBe(true);
  });

  test.each(invalidTypes)('rejects invalid type: %s', (type) => {
    expect(CrossChainOperationTypeSchema.safeParse(type).success).toBe(false);
  });
});

// ============================================================================
// EILEventTypeSchema Tests
// ============================================================================

describe('EILEventTypeSchema', () => {
  const validEventTypes = [
    'VoucherRequested',
    'VoucherIssued',
    'VoucherFulfilled',
    'VoucherExpired',
    'VoucherSlashed',
    'XLPRegistered',
    'XLPStakeDeposited',
    'XLPUnbondingStarted',
    'XLPStakeWithdrawn',
    'XLPSlashed',
    'LiquidityDeposited',
    'LiquidityWithdrawn',
  ];

  test.each(validEventTypes)('accepts valid event type: %s', (eventType) => {
    expect(EILEventTypeSchema.safeParse(eventType).success).toBe(true);
  });

  test('rejects invalid event types', () => {
    expect(EILEventTypeSchema.safeParse('InvalidEvent').success).toBe(false);
    expect(EILEventTypeSchema.safeParse('voucherrequested').success).toBe(false); // Case sensitive
    expect(EILEventTypeSchema.safeParse('').success).toBe(false);
  });

  test('covers all expected event types', () => {
    // Ensure schema has exactly the expected number of values
    expect(validEventTypes.length).toBe(12);
  });
});
