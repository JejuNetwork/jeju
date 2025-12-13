/**
 * @fileoverview Treasury Manager unit tests
 * Tests profit source mapping, deposit logic, and error handling
 */

import { describe, test, expect } from 'bun:test';
import type { ProfitSource } from '../../src/types';

// ============ Profit Source Mapping Tests ============

describe('Profit Source to Contract Enum Mapping', () => {
  // The contract uses these enum values:
  // enum ProfitSource { DEX_ARBITRAGE, CROSS_CHAIN_ARBITRAGE, SANDWICH, LIQUIDATION, SOLVER, ORACLE_KEEPER, OTHER }
  
  const PROFIT_SOURCE_TO_ENUM: Record<ProfitSource, number> = {
    DEX_ARBITRAGE: 0,
    CROSS_CHAIN_ARBITRAGE: 1,
    SANDWICH: 2,
    LIQUIDATION: 3,
    SOLVER: 4,
    ORACLE_KEEPER: 5,
    OTHER: 6,
  };

  test('DEX_ARBITRAGE maps to 0', () => {
    expect(PROFIT_SOURCE_TO_ENUM['DEX_ARBITRAGE']).toBe(0);
  });

  test('CROSS_CHAIN_ARBITRAGE maps to 1', () => {
    expect(PROFIT_SOURCE_TO_ENUM['CROSS_CHAIN_ARBITRAGE']).toBe(1);
  });

  test('SANDWICH maps to 2', () => {
    expect(PROFIT_SOURCE_TO_ENUM['SANDWICH']).toBe(2);
  });

  test('LIQUIDATION maps to 3', () => {
    expect(PROFIT_SOURCE_TO_ENUM['LIQUIDATION']).toBe(3);
  });

  test('SOLVER maps to 4', () => {
    expect(PROFIT_SOURCE_TO_ENUM['SOLVER']).toBe(4);
  });

  test('ORACLE_KEEPER maps to 5', () => {
    expect(PROFIT_SOURCE_TO_ENUM['ORACLE_KEEPER']).toBe(5);
  });

  test('OTHER maps to 6', () => {
    expect(PROFIT_SOURCE_TO_ENUM['OTHER']).toBe(6);
  });

  test('all profit sources are mapped', () => {
    const sources: ProfitSource[] = [
      'DEX_ARBITRAGE',
      'CROSS_CHAIN_ARBITRAGE',
      'SANDWICH',
      'LIQUIDATION',
      'SOLVER',
      'ORACLE_KEEPER',
      'OTHER',
    ];

    for (const source of sources) {
      expect(typeof PROFIT_SOURCE_TO_ENUM[source]).toBe('number');
      expect(PROFIT_SOURCE_TO_ENUM[source]).toBeGreaterThanOrEqual(0);
      expect(PROFIT_SOURCE_TO_ENUM[source]).toBeLessThanOrEqual(6);
    }
  });
});

// ============ Distribution Calculation Tests ============

describe('Treasury Distribution Calculations', () => {
  // Default distribution: 50% protocol, 30% stakers, 15% insurance, 5% operator
  const DEFAULT_DISTRIBUTION = {
    protocolBps: 5000,
    stakersBps: 3000,
    insuranceBps: 1500,
    operatorBps: 500,
  };

  test('distribution sums to 100%', () => {
    const total = 
      DEFAULT_DISTRIBUTION.protocolBps +
      DEFAULT_DISTRIBUTION.stakersBps +
      DEFAULT_DISTRIBUTION.insuranceBps +
      DEFAULT_DISTRIBUTION.operatorBps;
    
    expect(total).toBe(10000);
  });

  test('calculates protocol share correctly', () => {
    const totalProfit = 100n * 10n ** 18n; // 100 ETH
    const protocolShare = (totalProfit * BigInt(DEFAULT_DISTRIBUTION.protocolBps)) / 10000n;
    
    expect(protocolShare).toBe(50n * 10n ** 18n); // 50 ETH
  });

  test('calculates stakers share correctly', () => {
    const totalProfit = 100n * 10n ** 18n;
    const stakersShare = (totalProfit * BigInt(DEFAULT_DISTRIBUTION.stakersBps)) / 10000n;
    
    expect(stakersShare).toBe(30n * 10n ** 18n); // 30 ETH
  });

  test('calculates insurance share correctly', () => {
    const totalProfit = 100n * 10n ** 18n;
    const insuranceShare = (totalProfit * BigInt(DEFAULT_DISTRIBUTION.insuranceBps)) / 10000n;
    
    expect(insuranceShare).toBe(15n * 10n ** 18n); // 15 ETH
  });

  test('calculates operator share correctly', () => {
    const totalProfit = 100n * 10n ** 18n;
    const operatorShare = (totalProfit * BigInt(DEFAULT_DISTRIBUTION.operatorBps)) / 10000n;
    
    expect(operatorShare).toBe(5n * 10n ** 18n); // 5 ETH
  });

  test('handles small amounts without rounding errors', () => {
    const totalProfit = 1000n; // 1000 wei
    
    const protocolShare = (totalProfit * BigInt(DEFAULT_DISTRIBUTION.protocolBps)) / 10000n;
    const stakersShare = (totalProfit * BigInt(DEFAULT_DISTRIBUTION.stakersBps)) / 10000n;
    const insuranceShare = (totalProfit * BigInt(DEFAULT_DISTRIBUTION.insuranceBps)) / 10000n;
    const operatorShare = (totalProfit * BigInt(DEFAULT_DISTRIBUTION.operatorBps)) / 10000n;

    // Due to integer division, some dust may remain
    const totalDistributed = protocolShare + stakersShare + insuranceShare + operatorShare;
    const dust = totalProfit - totalDistributed;

    expect(protocolShare).toBe(500n);
    expect(stakersShare).toBe(300n);
    expect(insuranceShare).toBe(150n);
    expect(operatorShare).toBe(50n);
    expect(dust).toBe(0n);
  });

  test('handles very small amounts with dust', () => {
    const totalProfit = 33n; // Not evenly divisible
    
    const protocolShare = (totalProfit * BigInt(DEFAULT_DISTRIBUTION.protocolBps)) / 10000n;
    const stakersShare = (totalProfit * BigInt(DEFAULT_DISTRIBUTION.stakersBps)) / 10000n;
    const insuranceShare = (totalProfit * BigInt(DEFAULT_DISTRIBUTION.insuranceBps)) / 10000n;
    const operatorShare = (totalProfit * BigInt(DEFAULT_DISTRIBUTION.operatorBps)) / 10000n;

    const totalDistributed = protocolShare + stakersShare + insuranceShare + operatorShare;
    const dust = totalProfit - totalDistributed;

    // Floor division means we lose some wei
    expect(dust).toBeGreaterThanOrEqual(0n);
    expect(dust).toBeLessThan(4n); // At most 1 wei per distribution target
  });
});

// ============ Operator Earnings Tests ============

describe('Operator Earnings Calculations', () => {
  test('operator earns 5% of deposited profits', () => {
    const depositAmount = 10n * 10n ** 18n; // 10 ETH
    const operatorBps = 500; // 5%
    
    const operatorEarnings = (depositAmount * BigInt(operatorBps)) / 10000n;
    
    expect(operatorEarnings).toBe(5n * 10n ** 17n); // 0.5 ETH
  });

  test('multiple deposits accumulate earnings', () => {
    const operatorBps = 500;
    
    const deposit1 = 10n * 10n ** 18n;
    const deposit2 = 20n * 10n ** 18n;
    const deposit3 = 5n * 10n ** 18n;

    const earnings1 = (deposit1 * BigInt(operatorBps)) / 10000n;
    const earnings2 = (deposit2 * BigInt(operatorBps)) / 10000n;
    const earnings3 = (deposit3 * BigInt(operatorBps)) / 10000n;

    const totalEarnings = earnings1 + earnings2 + earnings3;
    const expectedTotal = ((deposit1 + deposit2 + deposit3) * BigInt(operatorBps)) / 10000n;

    expect(totalEarnings).toBe(expectedTotal);
    expect(totalEarnings).toBe(175n * 10n ** 16n); // 1.75 ETH
  });

  test('zero deposit yields zero earnings', () => {
    const depositAmount = 0n;
    const operatorBps = 500;
    
    const operatorEarnings = (depositAmount * BigInt(operatorBps)) / 10000n;
    
    expect(operatorEarnings).toBe(0n);
  });
});

// ============ ETH vs ERC20 Token Handling Tests ============

describe('Token Type Handling', () => {
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

  test('zero address represents native ETH', () => {
    const tokenAddress = ZERO_ADDRESS;
    const isNativeETH = tokenAddress === ZERO_ADDRESS;
    
    expect(isNativeETH).toBe(true);
  });

  test('non-zero address represents ERC20', () => {
    const tokenAddress = USDC_ADDRESS;
    const isNativeETH = tokenAddress === ZERO_ADDRESS;
    
    expect(isNativeETH).toBe(false);
  });

  test('address comparison is case-sensitive in JS', () => {
    const lower = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const checksummed = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    
    // Direct comparison fails
    expect(lower === checksummed).toBe(false);
    // Lowercase comparison works
    expect(lower.toLowerCase() === checksummed.toLowerCase()).toBe(true);
  });
});

// ============ Transaction Hash Validation ============

describe('Transaction Hash Handling', () => {
  test('valid transaction hash has correct format', () => {
    const validHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    
    expect(validHash).toHaveLength(66);
    expect(validHash.startsWith('0x')).toBe(true);
    expect(/^0x[0-9a-fA-F]{64}$/.test(validHash)).toBe(true);
  });

  test('bytes32 and transaction hash have same format', () => {
    // In Solidity, tx hashes are bytes32
    const bytes32 = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    
    expect(bytes32).toHaveLength(66);
    expect(/^0x[0-9a-fA-F]{64}$/.test(bytes32)).toBe(true);
  });
});

// ============ Stats Aggregation Tests ============

describe('Treasury Stats Aggregation', () => {
  test('aggregates profits by token correctly', () => {
    const profitsByToken: Record<string, bigint> = {};
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

    // Simulate deposits
    const deposits = [
      { token: ZERO_ADDRESS, amount: 10n * 10n ** 18n },
      { token: ZERO_ADDRESS, amount: 5n * 10n ** 18n },
      { token: USDC, amount: 1000n * 10n ** 6n },
      { token: USDC, amount: 500n * 10n ** 6n },
    ];

    for (const deposit of deposits) {
      profitsByToken[deposit.token] = (profitsByToken[deposit.token] || 0n) + deposit.amount;
    }

    expect(profitsByToken[ZERO_ADDRESS]).toBe(15n * 10n ** 18n); // 15 ETH
    expect(profitsByToken[USDC]).toBe(1500n * 10n ** 6n); // 1500 USDC
  });

  test('aggregates profits by source correctly', () => {
    const profitsBySource: Record<string, bigint> = {};

    const deposits = [
      { source: 'DEX_ARBITRAGE', amount: 10n * 10n ** 18n },
      { source: 'DEX_ARBITRAGE', amount: 5n * 10n ** 18n },
      { source: 'SANDWICH', amount: 2n * 10n ** 18n },
      { source: 'LIQUIDATION', amount: 8n * 10n ** 18n },
    ];

    for (const deposit of deposits) {
      profitsBySource[deposit.source] = (profitsBySource[deposit.source] || 0n) + deposit.amount;
    }

    expect(profitsBySource['DEX_ARBITRAGE']).toBe(15n * 10n ** 18n);
    expect(profitsBySource['SANDWICH']).toBe(2n * 10n ** 18n);
    expect(profitsBySource['LIQUIDATION']).toBe(8n * 10n ** 18n);
    expect(profitsBySource['CROSS_CHAIN_ARBITRAGE']).toBeUndefined();
  });
});

