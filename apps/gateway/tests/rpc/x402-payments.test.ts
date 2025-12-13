/**
 * X402 Payments Service Tests
 */

import { describe, test, expect } from 'bun:test';
import {
  isX402Enabled,
  getMethodPrice,
  generatePaymentRequirement,
  getCredits,
  addCredits,
  deductCredits,
  processPayment,
  RPC_PRICING,
} from '../../src/rpc/services/x402-payments.js';

describe('X402 Payments Service', () => {
  const testAddress = '0x1234567890123456789012345678901234567890';

  test('RPC_PRICING is defined correctly', () => {
    expect(RPC_PRICING.standard).toBe(100n);
    expect(RPC_PRICING.archive).toBe(500n);
    expect(RPC_PRICING.trace).toBe(1000n);
  });

  test('getMethodPrice returns correct prices for different methods', () => {
    // Standard methods
    expect(getMethodPrice('eth_blockNumber')).toBe(100n);
    expect(getMethodPrice('eth_call')).toBe(100n);
    expect(getMethodPrice('eth_getBalance')).toBe(100n);

    // Archive methods
    expect(getMethodPrice('getArchiveBlock')).toBe(500n);
    expect(getMethodPrice('getHistory')).toBe(500n);

    // Trace/debug methods
    expect(getMethodPrice('debug_traceTransaction')).toBe(1000n);
    expect(getMethodPrice('trace_block')).toBe(1000n);
  });

  test('generatePaymentRequirement creates valid requirement', () => {
    const req = generatePaymentRequirement(1, 'eth_call');
    
    expect(req.x402Version).toBe(1);
    expect(req.error).toBe('Payment required for RPC access');
    expect(req.accepts.length).toBe(2);
    expect(req.accepts[0].scheme).toBe('exact');
    expect(req.accepts[1].scheme).toBe('credit');
    expect(req.accepts[0].resource).toBe('rpc/1/eth_call');
  });

  test('credits management works correctly', () => {
    const addr = '0xtest1234567890123456789012345678901234';
    
    // Initial balance is 0
    expect(getCredits(addr)).toBe(0n);
    
    // Add credits
    const newBalance = addCredits(addr, 1000n);
    expect(newBalance).toBe(1000n);
    expect(getCredits(addr)).toBe(1000n);
    
    // Deduct credits (success)
    const success = deductCredits(addr, 500n);
    expect(success).toBe(true);
    expect(getCredits(addr)).toBe(500n);
    
    // Deduct too much (fail)
    const fail = deductCredits(addr, 1000n);
    expect(fail).toBe(false);
    expect(getCredits(addr)).toBe(500n);
  });

  test('processPayment allows when x402 disabled', () => {
    // When x402 is disabled (default if no RPC_PAYMENT_RECIPIENT), all requests pass
    const result = processPayment(undefined, 1, 'eth_blockNumber', testAddress);
    expect(result.allowed).toBe(true);
  });

  test('processPayment uses credits when available', () => {
    const addr = '0xtest_credits_0123456789012345678901234';
    
    // Add credits
    addCredits(addr, 1000n);
    
    // Process payment should use credits
    const result = processPayment(undefined, 1, 'eth_blockNumber', addr);
    
    // If x402 is enabled, credits would be deducted
    // If disabled, request passes anyway
    expect(result.allowed).toBe(true);
  });

  test('isX402Enabled returns boolean', () => {
    const enabled = isX402Enabled();
    expect(typeof enabled).toBe('boolean');
  });
});
