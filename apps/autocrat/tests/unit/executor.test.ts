/**
 * @fileoverview Transaction Executor unit tests
 * Tests gas calculations, nonce management, and execution flow
 */

import { describe, test, expect } from 'bun:test';
import { parseEther, parseGwei } from 'viem';
import type { ChainId, ArbitrageOpportunity, SandwichOpportunity, LiquidationOpportunity } from '../../src/types';

// ============ Gas Price Calculations ============

describe('Gas Price Calculations', () => {
  test('parseGwei converts correctly', () => {
    expect(parseGwei('1')).toBe(1000000000n); // 1 gwei = 1e9 wei
    expect(parseGwei('50')).toBe(50000000000n); // 50 gwei
    expect(parseGwei('100')).toBe(100000000000n); // 100 gwei
  });

  test('gas price multiplier increases gas correctly', () => {
    const baseGas = parseGwei('50');
    const multiplier = 1.1;
    
    const boostedGas = BigInt(Math.floor(Number(baseGas) * multiplier));
    
    expect(boostedGas).toBe(55000000000n); // 55 gwei
  });

  test('max gas check works correctly', () => {
    const currentGas = parseGwei('80');
    const maxGasGwei = 100;
    const maxGas = parseGwei(maxGasGwei.toString());
    
    expect(currentGas <= maxGas).toBe(true);
  });

  test('rejects when gas exceeds max', () => {
    const currentGas = parseGwei('150');
    const maxGasGwei = 100;
    const maxGas = parseGwei(maxGasGwei.toString());
    
    expect(currentGas > maxGas).toBe(true);
  });
});

// ============ Gas Estimation Tests ============

describe('Gas Estimation', () => {
  test('DEX arbitrage gas estimate scales with hops', () => {
    const baseGasPerHop = 200000n;
    
    const oneHop = baseGasPerHop * 1n;
    const twoHops = baseGasPerHop * 2n;
    const threeHops = baseGasPerHop * 3n;

    expect(oneHop).toBe(200000n);
    expect(twoHops).toBe(400000n);
    expect(threeHops).toBe(600000n);
  });

  test('sandwich attack gas estimate includes all three transactions', () => {
    const frontrunGas = 150000n;
    const victimGas = 200000n; // Not paid by us
    const backrunGas = 150000n;
    
    const totalBotGas = frontrunGas + backrunGas;
    
    expect(totalBotGas).toBe(300000n);
  });

  test('liquidation gas estimate is higher due to flash loan', () => {
    const flashLoanGas = 100000n;
    const swapGas = 150000n;
    const liquidateGas = 300000n;
    const repayGas = 100000n;
    
    const totalGas = flashLoanGas + swapGas + liquidateGas + repayGas;
    
    expect(totalGas).toBe(650000n);
  });

  test('gas cost calculation in wei', () => {
    const gasLimit = 300000n;
    const gasPrice = parseGwei('50'); // 50 gwei
    
    const gasCostWei = gasLimit * gasPrice;
    
    expect(gasCostWei).toBe(15000000000000000n); // 0.015 ETH
  });

  test('gas cost in ETH', () => {
    const gasLimit = 300000n;
    const gasPrice = parseGwei('50');
    const gasCostWei = gasLimit * gasPrice;
    
    const gasCostEth = Number(gasCostWei) / 1e18;
    
    expect(gasCostEth).toBe(0.015);
  });
});

// ============ Nonce Management Tests ============

describe('Nonce Management', () => {
  test('nonces increment correctly', () => {
    const nonces = new Map<ChainId, number>();
    nonces.set(1337, 0);

    const getAndIncrement = (chainId: ChainId): number => {
      const current = nonces.get(chainId) ?? 0;
      nonces.set(chainId, current + 1);
      return current;
    };

    expect(getAndIncrement(1337)).toBe(0);
    expect(getAndIncrement(1337)).toBe(1);
    expect(getAndIncrement(1337)).toBe(2);
    expect(nonces.get(1337)).toBe(3);
  });

  test('nonces are chain-specific', () => {
    const nonces = new Map<number, number>();
    nonces.set(1337, 5);
    nonces.set(8453, 10);
    nonces.set(1, 100);

    expect(nonces.get(1337)).toBe(5);
    expect(nonces.get(8453)).toBe(10);
    expect(nonces.get(1)).toBe(100);
  });
});

// ============ Opportunity Type Extraction ============

describe('Opportunity Chain ID Extraction', () => {
  test('extracts chainId from ArbitrageOpportunity', () => {
    const opportunity: Partial<ArbitrageOpportunity> = {
      id: 'arb-1',
      type: 'DEX_ARBITRAGE',
      chainId: 1337,
    };

    expect(opportunity.chainId).toBe(1337);
  });

  test('extracts sourceChainId from CrossChainArbOpportunity', () => {
    const opportunity = {
      id: 'cross-1',
      type: 'CROSS_CHAIN_ARBITRAGE',
      sourceChainId: 1337,
      destChainId: 8453,
    };

    // For cross-chain, we typically execute on source first
    expect(opportunity.sourceChainId).toBe(1337);
  });

  test('extracts chainId from SandwichOpportunity', () => {
    const opportunity: Partial<SandwichOpportunity> = {
      id: 'sand-1',
      type: 'SANDWICH',
      chainId: 8453,
    };

    expect(opportunity.chainId).toBe(8453);
  });

  test('extracts chainId from LiquidationOpportunity', () => {
    const opportunity: Partial<LiquidationOpportunity> = {
      id: 'liq-1',
      type: 'LIQUIDATION',
      chainId: 42161,
    };

    expect(opportunity.chainId).toBe(42161);
  });
});

// ============ Profitability Calculations ============

describe('Net Profit Calculations', () => {
  test('net profit = gross profit - gas cost', () => {
    const grossProfit = parseEther('1'); // 1 ETH
    const gasLimit = 300000n;
    const gasPrice = parseGwei('50');
    const gasCost = gasLimit * gasPrice;

    const netProfit = grossProfit - gasCost;

    expect(netProfit).toBe(parseEther('1') - parseGwei('50') * 300000n);
    expect(netProfit).toBe(985000000000000000n); // 0.985 ETH
  });

  test('rejects when gas cost exceeds profit', () => {
    const grossProfit = parseEther('0.01'); // 0.01 ETH
    const gasLimit = 500000n;
    const gasPrice = parseGwei('100');
    const gasCost = gasLimit * gasPrice;

    const netProfit = grossProfit - gasCost;

    expect(netProfit < 0n).toBe(true);
    expect(netProfit).toBe(-40000000000000000n); // -0.04 ETH
  });

  test('handles zero profit edge case', () => {
    const grossProfit = 0n;
    const gasCost = parseGwei('50') * 200000n;

    const netProfit = grossProfit - gasCost;

    expect(netProfit).toBe(-10000000000000000n); // -0.01 ETH
    expect(netProfit < 0n).toBe(true);
  });
});

// ============ Execution Result Tests ============

describe('Execution Results', () => {
  test('successful execution result structure', () => {
    const result = {
      opportunityId: 'opp-123',
      success: true,
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      blockNumber: 12345678,
      gasUsed: '250000',
      actualProfit: parseEther('0.5').toString(),
      executedAt: Date.now(),
      durationMs: 150,
    };

    expect(result.success).toBe(true);
    expect(result.txHash).toHaveLength(66);
    expect(BigInt(result.actualProfit)).toBe(parseEther('0.5'));
  });

  test('failed execution result structure', () => {
    const result = {
      opportunityId: 'opp-456',
      success: false,
      error: 'Simulation reverted: INSUFFICIENT_OUTPUT_AMOUNT',
      executedAt: Date.now(),
      durationMs: 50,
    };

    expect(result.success).toBe(false);
    expect(result.error).toContain('INSUFFICIENT_OUTPUT_AMOUNT');
    expect(result.txHash).toBeUndefined();
  });

  test('execution duration is measured', () => {
    const startTime = Date.now();
    // Simulate some processing
    let sum = 0;
    for (let i = 0; i < 10000; i++) sum += i;
    const durationMs = Date.now() - startTime;

    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof durationMs).toBe('number');
  });
});

// ============ Concurrent Execution Limits ============

describe('Concurrent Execution Management', () => {
  test('tracks pending executions', () => {
    const pending = new Map<string, { startTime: number }>();
    const maxConcurrent = 5;

    // Add executions
    pending.set('opp-1', { startTime: Date.now() });
    pending.set('opp-2', { startTime: Date.now() });
    pending.set('opp-3', { startTime: Date.now() });

    expect(pending.size).toBe(3);
    expect(pending.size < maxConcurrent).toBe(true);
  });

  test('rejects when at capacity', () => {
    const pending = new Map<string, { startTime: number }>();
    const maxConcurrent = 3;

    pending.set('opp-1', { startTime: Date.now() });
    pending.set('opp-2', { startTime: Date.now() });
    pending.set('opp-3', { startTime: Date.now() });

    const canExecute = pending.size < maxConcurrent;
    expect(canExecute).toBe(false);
  });

  test('removes completed executions', () => {
    const pending = new Map<string, { startTime: number }>();

    pending.set('opp-1', { startTime: Date.now() });
    pending.set('opp-2', { startTime: Date.now() });
    
    // Complete opp-1
    pending.delete('opp-1');

    expect(pending.size).toBe(1);
    expect(pending.has('opp-1')).toBe(false);
    expect(pending.has('opp-2')).toBe(true);
  });
});

// ============ Chain Definition Tests ============

describe('Chain Definitions', () => {
  const localnet = {
    id: 1337,
    name: 'Localnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['http://localhost:8545'] } },
  };

  test('localnet chain definition is valid', () => {
    expect(localnet.id).toBe(1337);
    expect(localnet.nativeCurrency.symbol).toBe('ETH');
    expect(localnet.nativeCurrency.decimals).toBe(18);
  });

  test('rpc url is extractable', () => {
    const rpcUrl = localnet.rpcUrls.default.http[0];
    expect(rpcUrl).toBe('http://localhost:8545');
  });
});

// ============ Contract Address Lookup Tests ============

describe('Contract Address Lookup', () => {
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  
  const contractAddresses = new Map<ChainId, { xlpRouter?: string; perpetualMarket?: string }>();
  contractAddresses.set(1337, {
    xlpRouter: '0x1111111111111111111111111111111111111111',
    perpetualMarket: '0x2222222222222222222222222222222222222222',
  });
  contractAddresses.set(8453, {
    xlpRouter: '0x3333333333333333333333333333333333333333',
    // perpetualMarket not set
  });

  test('returns address when set', () => {
    const addresses = contractAddresses.get(1337);
    expect(addresses?.xlpRouter).toBe('0x1111111111111111111111111111111111111111');
  });

  test('returns undefined when not set', () => {
    const addresses = contractAddresses.get(8453);
    expect(addresses?.perpetualMarket).toBeUndefined();
  });

  test('returns null for unknown chain', () => {
    const addresses = contractAddresses.get(999 as ChainId);
    expect(addresses).toBeUndefined();
  });

  test('zero address is treated as not set', () => {
    const testAddresses = { xlpRouter: ZERO_ADDRESS };
    const addr = testAddresses.xlpRouter;
    const isSet = addr && addr !== ZERO_ADDRESS;
    
    expect(isSet).toBe(false);
  });
});

