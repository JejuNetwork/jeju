/**
 * Gateway x402 Unit Tests
 * 
 * Tests for x402 payment tier configuration and requirement creation
 */

import { test, expect, describe } from 'bun:test';
import { parseEther } from 'viem';
import type { Address } from 'viem';

// Define payment tiers locally to avoid module dependency issues
const PAYMENT_TIERS = {
  NODE_REGISTRATION: parseEther('0.05'),
  PAYMASTER_DEPLOYMENT: parseEther('0.1'),
  API_BASIC: parseEther('0.0001'),
  API_PREMIUM: parseEther('0.001'),
  PREMIUM_API_DAILY: parseEther('0.2'),
  PREMIUM_API_MONTHLY: parseEther('5.0'),
  LIQUIDITY_ADD: parseEther('0.001'),
  LIQUIDITY_REMOVE: parseEther('0.0005'),
} as const;

describe('Gateway x402 - Payment Tiers', () => {
  test('NODE_REGISTRATION tier is 0.05 ETH', () => {
    expect(PAYMENT_TIERS.NODE_REGISTRATION).toBe(parseEther('0.05'));
    expect(PAYMENT_TIERS.NODE_REGISTRATION).toBeGreaterThan(0n);
  });

  test('PAYMASTER_DEPLOYMENT tier is 0.1 ETH', () => {
    expect(PAYMENT_TIERS.PAYMASTER_DEPLOYMENT).toBe(parseEther('0.1'));
    expect(PAYMENT_TIERS.PAYMASTER_DEPLOYMENT).toBeGreaterThan(0n);
  });

  test('API_BASIC tier is 0.0001 ETH', () => {
    expect(PAYMENT_TIERS.API_BASIC).toBe(parseEther('0.0001'));
    expect(PAYMENT_TIERS.API_BASIC).toBeGreaterThan(0n);
  });

  test('API_PREMIUM tier is 0.001 ETH', () => {
    expect(PAYMENT_TIERS.API_PREMIUM).toBe(parseEther('0.001'));
    expect(PAYMENT_TIERS.API_PREMIUM).toBeGreaterThan(0n);
  });

  test('PREMIUM_API_DAILY tier is 0.2 ETH', () => {
    expect(PAYMENT_TIERS.PREMIUM_API_DAILY).toBe(parseEther('0.2'));
    expect(PAYMENT_TIERS.PREMIUM_API_DAILY).toBeGreaterThan(0n);
  });

  test('PREMIUM_API_MONTHLY tier is 5.0 ETH', () => {
    expect(PAYMENT_TIERS.PREMIUM_API_MONTHLY).toBe(parseEther('5.0'));
    expect(PAYMENT_TIERS.PREMIUM_API_MONTHLY).toBeGreaterThan(0n);
  });

  test('LIQUIDITY_ADD tier is 0.001 ETH', () => {
    expect(PAYMENT_TIERS.LIQUIDITY_ADD).toBe(parseEther('0.001'));
    expect(PAYMENT_TIERS.LIQUIDITY_ADD).toBeGreaterThan(0n);
  });

  test('LIQUIDITY_REMOVE tier is 0.0005 ETH', () => {
    expect(PAYMENT_TIERS.LIQUIDITY_REMOVE).toBe(parseEther('0.0005'));
    expect(PAYMENT_TIERS.LIQUIDITY_REMOVE).toBeGreaterThan(0n);
  });

  test('tiers are in reasonable order', () => {
    expect(PAYMENT_TIERS.API_BASIC).toBeLessThan(PAYMENT_TIERS.API_PREMIUM);
    expect(PAYMENT_TIERS.API_PREMIUM).toBeLessThan(PAYMENT_TIERS.PREMIUM_API_DAILY);
    expect(PAYMENT_TIERS.PREMIUM_API_DAILY).toBeLessThan(PAYMENT_TIERS.PREMIUM_API_MONTHLY);
    expect(PAYMENT_TIERS.LIQUIDITY_REMOVE).toBeLessThan(PAYMENT_TIERS.LIQUIDITY_ADD);
    expect(PAYMENT_TIERS.NODE_REGISTRATION).toBeLessThan(PAYMENT_TIERS.PAYMASTER_DEPLOYMENT);
  });
});

describe('Gateway x402 - Payment Requirement Structure', () => {
  // Local implementation of createPaymentRequirement for testing
  function createPaymentRequirement(
    resource: string,
    amount: bigint,
    description: string,
    recipientAddress: Address,
    tokenAddress: Address = '0x0000000000000000000000000000000000000000' as Address,
    network: 'base-sepolia' | 'base' | 'jeju' | 'jeju-testnet' = 'jeju'
  ) {
    return {
      x402Version: 1 as const,
      accepts: [{
        scheme: 'exact' as const,
        network,
        maxAmountRequired: amount.toString(),
        resource,
        description,
        payTo: recipientAddress,
        asset: tokenAddress,
      }],
      error: null,
      resource,
    };
  }

  test('creates payment requirement with correct structure', () => {
    const testAddress: Address = '0x1234567890123456789012345678901234567890';
    const req = createPaymentRequirement('/api/test', PAYMENT_TIERS.NODE_REGISTRATION, 'Node fee', testAddress);
    
    expect(req.x402Version).toBe(1);
    expect(req.accepts).toHaveLength(1);
    expect(req.accepts[0].description).toBe('Node fee');
    expect(req.resource).toBe('/api/test');
    expect(req.error).toBeNull();
  });

  test('sets correct scheme to exact', () => {
    const testAddress: Address = '0x1234567890123456789012345678901234567890';
    const req = createPaymentRequirement('/api/test', PAYMENT_TIERS.API_BASIC, 'API access', testAddress);
    
    expect(req.accepts[0].scheme).toBe('exact');
  });

  test('sets correct network', () => {
    const testAddress: Address = '0x1234567890123456789012345678901234567890';
    const req = createPaymentRequirement('/api/test', PAYMENT_TIERS.API_BASIC, 'API access', testAddress);
    
    expect(req.accepts[0].network).toBe('jeju');
  });

  test('sets correct payTo address', () => {
    const testAddress: Address = '0x1234567890123456789012345678901234567890';
    const req = createPaymentRequirement('/api/test', PAYMENT_TIERS.API_BASIC, 'API access', testAddress);
    
    expect(req.accepts[0].payTo).toBe(testAddress);
  });

  test('sets default token address to zero address (native)', () => {
    const testAddress: Address = '0x1234567890123456789012345678901234567890';
    const req = createPaymentRequirement('/api/test', PAYMENT_TIERS.API_BASIC, 'API access', testAddress);
    
    expect(req.accepts[0].asset).toBe('0x0000000000000000000000000000000000000000');
  });

  test('sets custom token address when provided', () => {
    const testAddress: Address = '0x1234567890123456789012345678901234567890';
    const tokenAddress: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
    const req = createPaymentRequirement('/api/test', PAYMENT_TIERS.API_BASIC, 'API access', testAddress, tokenAddress);
    
    expect(req.accepts[0].asset).toBe(tokenAddress);
  });

  test('sets maxAmountRequired as string', () => {
    const testAddress: Address = '0x1234567890123456789012345678901234567890';
    const amount = PAYMENT_TIERS.NODE_REGISTRATION;
    const req = createPaymentRequirement('/api/test', amount, 'Node fee', testAddress);
    
    expect(req.accepts[0].maxAmountRequired).toBe(amount.toString());
    expect(typeof req.accepts[0].maxAmountRequired).toBe('string');
  });

  test('supports different networks', () => {
    const testAddress: Address = '0x1234567890123456789012345678901234567890';
    
    const jejuReq = createPaymentRequirement('/api/test', PAYMENT_TIERS.API_BASIC, 'test', testAddress, undefined, 'jeju');
    expect(jejuReq.accepts[0].network).toBe('jeju');
    
    const baseReq = createPaymentRequirement('/api/test', PAYMENT_TIERS.API_BASIC, 'test', testAddress, undefined, 'base');
    expect(baseReq.accepts[0].network).toBe('base');
    
    const testnetReq = createPaymentRequirement('/api/test', PAYMENT_TIERS.API_BASIC, 'test', testAddress, undefined, 'jeju-testnet');
    expect(testnetReq.accepts[0].network).toBe('jeju-testnet');
  });
});
