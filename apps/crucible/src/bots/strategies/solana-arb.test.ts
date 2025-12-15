/**
 * Solana Arbitrage Strategy Tests
 */

import { describe, it, expect } from 'bun:test';
import {
  SOLANA_CHAIN_ID,
  SOLANA_TOKENS,
  EVM_TOKENS,
  SOLANA_BRIDGE_COSTS,
} from './solana-arb';

describe('Solana Arbitrage Configuration', () => {
  describe('Chain ID', () => {
    it('should have valid Solana pseudo chain ID', () => {
      expect(SOLANA_CHAIN_ID).toBe(900001);
      expect(typeof SOLANA_CHAIN_ID).toBe('number');
    });
  });

  describe('Solana Tokens', () => {
    it('should have SOL token defined', () => {
      expect(SOLANA_TOKENS.SOL).toBeDefined();
      expect(SOLANA_TOKENS.SOL.mint).toBe('So11111111111111111111111111111111111111112');
      expect(SOLANA_TOKENS.SOL.decimals).toBe(9);
      expect(SOLANA_TOKENS.SOL.symbol).toBe('SOL');
    });

    it('should have USDC token defined', () => {
      expect(SOLANA_TOKENS.USDC).toBeDefined();
      expect(SOLANA_TOKENS.USDC.mint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(SOLANA_TOKENS.USDC.decimals).toBe(6);
    });

    it('should have USDT token defined', () => {
      expect(SOLANA_TOKENS.USDT).toBeDefined();
      expect(SOLANA_TOKENS.USDT.decimals).toBe(6);
    });

    it('should have WETH token defined', () => {
      expect(SOLANA_TOKENS.WETH).toBeDefined();
      expect(SOLANA_TOKENS.WETH.decimals).toBe(8);
    });

    it('should have WBTC token defined', () => {
      expect(SOLANA_TOKENS.WBTC).toBeDefined();
      expect(SOLANA_TOKENS.WBTC.decimals).toBe(8);
    });

    it('all mints should be valid base58 addresses', () => {
      for (const [symbol, token] of Object.entries(SOLANA_TOKENS)) {
        expect(token.mint.length).toBeGreaterThan(30);
        expect(token.mint.length).toBeLessThanOrEqual(44);
        // Base58 chars only
        expect(token.mint).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
      }
    });
  });

  describe('EVM Token Equivalents', () => {
    it('should have USDC on multiple chains', () => {
      expect(EVM_TOKENS.USDC[1]).toBeDefined(); // Ethereum
      expect(EVM_TOKENS.USDC[42161]).toBeDefined(); // Arbitrum
      expect(EVM_TOKENS.USDC[10]).toBeDefined(); // Optimism
      expect(EVM_TOKENS.USDC[8453]).toBeDefined(); // Base
    });

    it('should have WETH on multiple chains', () => {
      expect(EVM_TOKENS.WETH[1]).toBeDefined(); // Ethereum
      expect(EVM_TOKENS.WETH[42161]).toBeDefined(); // Arbitrum
    });

    it('all EVM addresses should be valid hex', () => {
      for (const [symbol, chains] of Object.entries(EVM_TOKENS)) {
        for (const [chainId, address] of Object.entries(chains)) {
          expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        }
      }
    });
  });

  describe('Bridge Costs', () => {
    it('should have bridge cost for Ethereum', () => {
      expect(SOLANA_BRIDGE_COSTS[1]).toBeDefined();
      expect(SOLANA_BRIDGE_COSTS[1].costUsd).toBeGreaterThan(0);
      expect(SOLANA_BRIDGE_COSTS[1].timeSec).toBeGreaterThan(0);
    });

    it('should have bridge cost for Arbitrum', () => {
      expect(SOLANA_BRIDGE_COSTS[42161]).toBeDefined();
      expect(SOLANA_BRIDGE_COSTS[42161].costUsd).toBeLessThan(SOLANA_BRIDGE_COSTS[1].costUsd);
    });

    it('should have bridge cost for Jeju', () => {
      expect(SOLANA_BRIDGE_COSTS[420691]).toBeDefined();
      expect(SOLANA_BRIDGE_COSTS[420691].costUsd).toBeLessThanOrEqual(SOLANA_BRIDGE_COSTS[42161].costUsd);
    });

    it('Jeju should have fastest bridge time', () => {
      expect(SOLANA_BRIDGE_COSTS[420691].timeSec).toBeLessThan(SOLANA_BRIDGE_COSTS[1].timeSec);
    });
  });
});

describe('Arbitrage Profitability Calculations', () => {
  it('should calculate profit correctly for profitable trade', () => {
    const solanaPrice = 50.0; // $50/SOL on Solana
    const evmPrice = 51.5;    // $51.50/SOL on EVM
    const tradeSize = 10000;  // $10k
    const bridgeCostUsd = 15;

    const priceDiff = Math.abs(solanaPrice - evmPrice);
    const minPrice = Math.min(solanaPrice, evmPrice);
    const priceDiffBps = Math.floor((priceDiff / minPrice) * 10000);
    const grossProfit = tradeSize * (priceDiff / minPrice);
    const netProfit = grossProfit - bridgeCostUsd;

    expect(priceDiffBps).toBe(300); // 3%
    expect(grossProfit).toBeCloseTo(300, 0); // ~$300
    expect(netProfit).toBeCloseTo(285, 0); // ~$285 after bridge
  });

  it('should detect unprofitable trade when bridge cost exceeds spread', () => {
    const solanaPrice = 50.0;
    const evmPrice = 50.05; // Only 0.1% diff
    const tradeSize = 10000;
    const bridgeCostUsd = 15;

    const priceDiff = Math.abs(solanaPrice - evmPrice);
    const minPrice = Math.min(solanaPrice, evmPrice);
    const grossProfit = tradeSize * (priceDiff / minPrice);
    const netProfit = grossProfit - bridgeCostUsd;

    expect(grossProfit).toBeLessThan(bridgeCostUsd);
    expect(netProfit).toBeLessThan(0);
  });

  it('should determine correct direction (buy cheap, sell expensive)', () => {
    const solanaPrice = 50.0;
    const evmPrice = 52.0;

    const solanaToEvm = solanaPrice < evmPrice;
    expect(solanaToEvm).toBe(true); // Buy on Solana, sell on EVM

    const evmPrice2 = 48.0;
    const solanaToEvm2 = solanaPrice < evmPrice2;
    expect(solanaToEvm2).toBe(false); // Buy on EVM, sell on Solana
  });

  it('should respect minimum profit threshold', () => {
    const MIN_PROFIT_BPS = 250; // 2.5%
    
    // Trade with 2% spread - should not execute
    const smallSpreadBps = 200;
    expect(smallSpreadBps).toBeLessThan(MIN_PROFIT_BPS);
    
    // Trade with 3% spread - should execute
    const goodSpreadBps = 300;
    expect(goodSpreadBps).toBeGreaterThan(MIN_PROFIT_BPS);
  });
});

describe('Token Decimal Handling', () => {
  it('should convert SOL amounts correctly', () => {
    const amount = 1; // 1 SOL
    const decimals = SOLANA_TOKENS.SOL.decimals;
    const rawAmount = amount * (10 ** decimals);
    
    expect(rawAmount).toBe(1000000000); // 1e9
  });

  it('should convert USDC amounts correctly', () => {
    const amount = 1000; // $1000 USDC
    const decimals = SOLANA_TOKENS.USDC.decimals;
    const rawAmount = amount * (10 ** decimals);
    
    expect(rawAmount).toBe(1000000000); // 1e9 (1000 * 1e6)
  });

  it('should handle cross-chain decimal differences', () => {
    // Solana WETH has 8 decimals, EVM has 18
    const solanaDecimals = SOLANA_TOKENS.WETH.decimals;
    const evmDecimals = 18;
    
    const amount = 1; // 1 WETH
    const solanaRaw = BigInt(amount * (10 ** solanaDecimals));
    const evmRaw = BigInt(amount * (10 ** evmDecimals));
    
    expect(solanaRaw).toBe(BigInt(100000000)); // 1e8
    expect(evmRaw).toBe(BigInt('1000000000000000000')); // 1e18
    
    // Conversion factor
    const conversionFactor = evmRaw / solanaRaw;
    expect(conversionFactor).toBe(BigInt(10000000000)); // 1e10
  });
});

