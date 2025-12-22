import { describe, it, expect } from 'bun:test';
import { PublicKey } from '@solana/web3.js';
import {
  calculateAMMSwap,
  buildSwapQuote,
  poolMatchesFilter,
  getSwapReserves,
  priceToTick,
  tickToPrice,
  sqrtPriceX64ToPrice,
  priceToBinId,
  binIdToPrice,
  inferDecimals,
  hexToBytes,
  bytesToHex,
  evmAddressToBytes,
  bytesToEvmAddress,
  calculateBondingCurveBuy,
  calculateBondingCurveSell,
  getBondingCurvePrice,
  type AMMSwapParams,
  type BondingCurveReserves,
} from '../dex/utils';
import type { PoolInfo } from '../dex/types';

// ============================================================================
// AMM Swap Calculation Tests
// ============================================================================

describe('calculateAMMSwap', () => {
  describe('constant product formula correctness', () => {
    it('calculates output for a standard swap', () => {
      const params: AMMSwapParams = {
        inputAmount: 1_000_000_000n, // 1 SOL worth
        inputReserve: 100_000_000_000n, // 100 SOL
        outputReserve: 1_000_000_000_000n, // 1000 tokens
        feeBps: 30, // 0.3% fee
        slippageBps: 50, // 0.5% slippage
      };

      const result = calculateAMMSwap(params);

      // Output should be less than proportional due to constant product
      expect(result.outputAmount).toBeGreaterThan(0n);
      expect(result.outputAmount).toBeLessThan(10_000_000_000n); // Less than 10 tokens (1% of reserve)
      
      // Min output should be less than output due to slippage
      expect(result.minOutputAmount).toBeLessThan(result.outputAmount);
      
      // Fee should be approximately 0.3% of input
      const expectedFee = params.inputAmount * 30n / 10000n;
      expect(result.fee).toBe(expectedFee);
    });

    it('handles zero fee swaps', () => {
      const params: AMMSwapParams = {
        inputAmount: 1_000_000_000n,
        inputReserve: 100_000_000_000n,
        outputReserve: 1_000_000_000_000n,
        feeBps: 0,
        slippageBps: 0,
      };

      const result = calculateAMMSwap(params);

      // With no fees, x * y = k should hold approximately
      const k = params.inputReserve * params.outputReserve;
      const newInputReserve = params.inputReserve + params.inputAmount;
      const newOutputReserve = params.outputReserve - result.outputAmount;
      
      // k should be preserved (allow for rounding)
      const newK = newInputReserve * newOutputReserve;
      const kDifference = k > newK ? k - newK : newK - k;
      expect(kDifference).toBeLessThan(params.outputReserve); // Within rounding tolerance

      expect(result.fee).toBe(0n);
      expect(result.minOutputAmount).toBe(result.outputAmount);
    });

    it('calculates price impact correctly for small swaps', () => {
      const params: AMMSwapParams = {
        inputAmount: 1_000_000n, // Tiny swap (0.001 of reserve)
        inputReserve: 1_000_000_000n,
        outputReserve: 1_000_000_000n,
        feeBps: 0,
        slippageBps: 0,
      };

      const result = calculateAMMSwap(params);

      // Small swap should have minimal price impact
      expect(result.priceImpactPct).toBeLessThan(1);
    });

    it('calculates price impact correctly for large swaps', () => {
      const params: AMMSwapParams = {
        inputAmount: 500_000_000n, // 50% of input reserve
        inputReserve: 1_000_000_000n,
        outputReserve: 1_000_000_000n,
        feeBps: 0,
        slippageBps: 0,
      };

      const result = calculateAMMSwap(params);

      // Large swap should have significant price impact
      expect(result.priceImpactPct).toBeGreaterThan(10);
    });

    it('handles imbalanced pools', () => {
      // Input reserve is 100x smaller than output reserve
      // This simulates a pool where token A is much more valuable than token B
      const params: AMMSwapParams = {
        inputAmount: 1_000_000n,
        inputReserve: 10_000_000n, // Small input reserve
        outputReserve: 1_000_000_000n, // 100x larger output reserve
        feeBps: 30,
        slippageBps: 50,
      };

      const result = calculateAMMSwap(params);
      
      // Should still produce valid output
      expect(result.outputAmount).toBeGreaterThan(0n);
      expect(result.outputAmount).toBeLessThan(params.outputReserve);
      
      // Due to the imbalanced reserves, we should get more output per input
      expect(result.outputAmount).toBeGreaterThan(params.inputAmount);
    });

    it('applies slippage tolerance correctly', () => {
      const params: AMMSwapParams = {
        inputAmount: 1_000_000_000n,
        inputReserve: 100_000_000_000n,
        outputReserve: 100_000_000_000n,
        feeBps: 30,
        slippageBps: 100, // 1% slippage
      };

      const result = calculateAMMSwap(params);

      // minOutputAmount should be exactly 99% of outputAmount
      const expectedMin = result.outputAmount * 9900n / 10000n;
      expect(result.minOutputAmount).toBe(expectedMin);
    });
  });

  describe('edge cases', () => {
    it('handles very small input amounts', () => {
      const params: AMMSwapParams = {
        inputAmount: 1n, // Minimum possible
        inputReserve: 1_000_000_000_000n,
        outputReserve: 1_000_000_000_000n,
        feeBps: 30,
        slippageBps: 50,
      };

      const result = calculateAMMSwap(params);
      
      // May produce 0 output due to fee, but should not throw
      expect(result.outputAmount).toBeGreaterThanOrEqual(0n);
    });

    it('handles large input amounts (near reserve)', () => {
      const params: AMMSwapParams = {
        inputAmount: 500_000_000_000n, // Half of reserve
        inputReserve: 1_000_000_000_000n,
        outputReserve: 1_000_000_000_000n,
        feeBps: 30,
        slippageBps: 50,
      };

      const result = calculateAMMSwap(params);

      // With constant product, adding 50% to input should get ~33% of output
      // (due to x*y=k, not linear)
      expect(result.outputAmount).toBeLessThan(params.outputReserve);
      expect(result.outputAmount).toBeGreaterThan(params.outputReserve / 4n);
    });
  });

  describe('property-based testing', () => {
    // Generate random test cases
    const randomBigInt = (max: bigint): bigint => {
      const random = BigInt(Math.floor(Math.random() * Number(max)));
      return random > 0n ? random : 1n;
    };

    it('output never exceeds output reserve', () => {
      for (let i = 0; i < 100; i++) {
        const outputReserve = randomBigInt(1_000_000_000_000_000n) + 1000n;
        const inputReserve = randomBigInt(1_000_000_000_000_000n) + 1000n;
        const inputAmount = randomBigInt(inputReserve);

        const result = calculateAMMSwap({
          inputAmount,
          inputReserve,
          outputReserve,
          feeBps: Math.floor(Math.random() * 1000),
          slippageBps: Math.floor(Math.random() * 1000),
        });

        expect(result.outputAmount).toBeLessThan(outputReserve);
      }
    });

    it('higher fee always results in lower output', () => {
      for (let i = 0; i < 50; i++) {
        const baseParams: AMMSwapParams = {
          inputAmount: randomBigInt(1_000_000_000n),
          inputReserve: randomBigInt(100_000_000_000n) + 1_000_000_000n,
          outputReserve: randomBigInt(100_000_000_000n) + 1_000_000_000n,
          feeBps: 10,
          slippageBps: 0,
        };

        const lowFeeResult = calculateAMMSwap(baseParams);
        const highFeeResult = calculateAMMSwap({ ...baseParams, feeBps: 100 });

        expect(highFeeResult.outputAmount).toBeLessThanOrEqual(lowFeeResult.outputAmount);
      }
    });

    it('minOutputAmount is always <= outputAmount', () => {
      for (let i = 0; i < 50; i++) {
        const result = calculateAMMSwap({
          inputAmount: randomBigInt(1_000_000_000n) + 1n,
          inputReserve: randomBigInt(100_000_000_000n) + 1_000_000_000n,
          outputReserve: randomBigInt(100_000_000_000n) + 1_000_000_000n,
          feeBps: Math.floor(Math.random() * 100),
          slippageBps: Math.floor(Math.random() * 1000),
        });

        expect(result.minOutputAmount).toBeLessThanOrEqual(result.outputAmount);
      }
    });

    it('price impact is always non-negative', () => {
      for (let i = 0; i < 50; i++) {
        const result = calculateAMMSwap({
          inputAmount: randomBigInt(1_000_000_000n) + 1n,
          inputReserve: randomBigInt(100_000_000_000n) + 1_000_000_000n,
          outputReserve: randomBigInt(100_000_000_000n) + 1_000_000_000n,
          feeBps: Math.floor(Math.random() * 100),
          slippageBps: 0,
        });

        expect(result.priceImpactPct).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

// ============================================================================
// Tick/Price Conversion Tests (CLMM)
// ============================================================================

describe('priceToTick and tickToPrice', () => {
  it('converts price to tick and back correctly', () => {
    const testCases = [
      { price: 1.0, decimalsA: 9, decimalsB: 6 },
      { price: 100.0, decimalsA: 9, decimalsB: 6 },
      { price: 0.001, decimalsA: 6, decimalsB: 9 },
      { price: 50000.0, decimalsA: 8, decimalsB: 6 }, // BTC/USDC style
    ];

    for (const { price, decimalsA, decimalsB } of testCases) {
      const tick = priceToTick(price, decimalsA, decimalsB);
      const recoveredPrice = tickToPrice(tick, decimalsA, decimalsB);

      // Allow 1% tolerance due to tick rounding
      const tolerance = price * 0.01;
      expect(Math.abs(recoveredPrice - price)).toBeLessThan(tolerance);
    }
  });

  it('respects tick spacing', () => {
    const tickSpacing = 64;
    // Use a price that produces a tick well above zero
    const price = 10.0;
    const tick = priceToTick(price, 9, 9, tickSpacing); // Same decimals for simplicity

    // Tick should be divisible by tick spacing
    expect(tick % tickSpacing).toBe(0);
    
    // Without tick spacing, tick would be different
    const tickWithoutSpacing = priceToTick(price, 9, 9);
    expect(tickWithoutSpacing).toBeGreaterThanOrEqual(tick);
  });

  it('tick increases with price', () => {
    const decimalsA = 9;
    const decimalsB = 6;

    const prices = [0.1, 1.0, 10.0, 100.0, 1000.0];
    let prevTick = -Infinity;

    for (const price of prices) {
      const tick = priceToTick(price, decimalsA, decimalsB);
      expect(tick).toBeGreaterThan(prevTick);
      prevTick = tick;
    }
  });
});

describe('sqrtPriceX64ToPrice', () => {
  it('converts sqrt price X64 to regular price', () => {
    // sqrtPrice = 2^64 means price = 1 (for equal decimals)
    const sqrtPriceOne = 2n ** 64n;
    const priceOne = sqrtPriceX64ToPrice(sqrtPriceOne, 9, 9);
    expect(Math.abs(priceOne - 1)).toBeLessThan(0.001);
  });

  it('adjusts for decimal differences', () => {
    const sqrtPriceX64 = 2n ** 64n;
    
    // With decimalsA > decimalsB, price should be higher
    const priceA = sqrtPriceX64ToPrice(sqrtPriceX64, 9, 6);
    const priceB = sqrtPriceX64ToPrice(sqrtPriceX64, 6, 9);
    
    expect(priceA).toBeGreaterThan(priceB);
  });

  it('handles large sqrt prices', () => {
    // Very large sqrt price (price ~ 4)
    const sqrtPriceLarge = 2n ** 65n;
    const price = sqrtPriceX64ToPrice(sqrtPriceLarge, 9, 9);
    
    // (2^65 / 2^64)^2 = 2^2 = 4
    expect(Math.abs(price - 4)).toBeLessThan(0.01);
  });
});

// ============================================================================
// Meteora DLMM Bin Tests
// ============================================================================

describe('priceToBinId and binIdToPrice', () => {
  it('converts price to bin and back correctly', () => {
    const binStep = 100; // 1% bin step
    const testPrices = [1.0, 1.5, 2.0, 10.0, 100.0];

    for (const price of testPrices) {
      const binId = priceToBinId(price, binStep);
      const recoveredPrice = binIdToPrice(binId, binStep);

      // Allow tolerance for bin discretization
      const tolerance = price * (binStep / 10000 + 0.01);
      expect(Math.abs(recoveredPrice - price)).toBeLessThan(tolerance);
    }
  });

  it('bin ID increases with price', () => {
    const binStep = 50;
    const prices = [0.5, 1.0, 2.0, 5.0, 10.0];
    let prevBin = -Infinity;

    for (const price of prices) {
      const binId = priceToBinId(price, binStep);
      expect(binId).toBeGreaterThan(prevBin);
      prevBin = binId;
    }
  });

  it('handles different bin steps', () => {
    const price = 2.0;
    const bin10 = priceToBinId(price, 10);
    const bin100 = priceToBinId(price, 100);

    // Larger bin step = coarser granularity = smaller bin number
    expect(bin10).toBeGreaterThan(bin100);
  });
});

// ============================================================================
// Bonding Curve Calculations
// ============================================================================

describe('calculateBondingCurveBuy', () => {
  it('calculates tokens out for SOL in', () => {
    const reserves: BondingCurveReserves = {
      virtualSolReserves: 30_000_000_000n, // 30 SOL virtual
      virtualTokenReserves: 1_000_000_000_000_000n, // 1B tokens
    };

    const solAmount = 1_000_000_000n; // 1 SOL
    const tokensOut = calculateBondingCurveBuy(reserves, solAmount);

    // Should get tokens based on constant product
    expect(tokensOut).toBeGreaterThan(0n);
    
    // k = 30 * 1B = 30B
    // New SOL = 31
    // New tokens = 30B / 31 = ~967M
    // Tokens out = 1B - 967M = ~32M
    expect(tokensOut).toBeGreaterThan(30_000_000_000_000n);
    expect(tokensOut).toBeLessThan(35_000_000_000_000n);
  });

  it('larger purchases get worse rates (slippage)', () => {
    const reserves: BondingCurveReserves = {
      virtualSolReserves: 30_000_000_000n,
      virtualTokenReserves: 1_000_000_000_000_000n,
    };

    const smallBuy = calculateBondingCurveBuy(reserves, 100_000_000n); // 0.1 SOL
    const largeBuy = calculateBondingCurveBuy(reserves, 10_000_000_000n); // 10 SOL

    // Rate (tokens per SOL) should be worse for larger purchases
    const smallRate = Number(smallBuy) / 0.1;
    const largeRate = Number(largeBuy) / 10;
    
    expect(smallRate).toBeGreaterThan(largeRate);
  });
});

describe('calculateBondingCurveSell', () => {
  it('calculates SOL out for tokens in', () => {
    const reserves: BondingCurveReserves = {
      virtualSolReserves: 30_000_000_000n,
      virtualTokenReserves: 1_000_000_000_000_000n,
    };

    const tokenAmount = 32_000_000_000_000n; // ~32M tokens
    const solOut = calculateBondingCurveSell(reserves, tokenAmount);

    // Should get approximately 1 SOL back (inverse of buy)
    expect(solOut).toBeGreaterThan(0n);
    expect(solOut).toBeLessThan(2_000_000_000n); // Less than 2 SOL
  });

  it('buy and sell are approximately inverse', () => {
    const reserves: BondingCurveReserves = {
      virtualSolReserves: 30_000_000_000n,
      virtualTokenReserves: 1_000_000_000_000_000n,
    };

    const solIn = 1_000_000_000n;
    const tokensOut = calculateBondingCurveBuy(reserves, solIn);

    // After buying, simulate updated reserves
    const newReserves: BondingCurveReserves = {
      virtualSolReserves: reserves.virtualSolReserves + solIn,
      virtualTokenReserves: reserves.virtualTokenReserves - tokensOut,
    };

    const solBack = calculateBondingCurveSell(newReserves, tokensOut);

    // Should get approximately same SOL back (no fees in these functions)
    const difference = solIn > solBack ? solIn - solBack : solBack - solIn;
    expect(difference).toBeLessThan(solIn / 100n); // Within 1%
  });
});

describe('getBondingCurvePrice', () => {
  it('returns SOL per token price', () => {
    const reserves: BondingCurveReserves = {
      virtualSolReserves: 30_000_000_000n, // 30 SOL (lamports)
      virtualTokenReserves: 1_000_000_000_000_000n, // 1 quadrillion tokens
    };

    const price = getBondingCurvePrice(reserves);

    // Price = 30e9 / 1e15 = 3e-5 = 0.00003
    expect(price).toBeCloseTo(0.00003, 8);
  });

  it('price increases as tokens are bought', () => {
    const initial: BondingCurveReserves = {
      virtualSolReserves: 30_000_000_000n,
      virtualTokenReserves: 1_000_000_000_000_000n,
    };

    const afterBuy: BondingCurveReserves = {
      virtualSolReserves: 50_000_000_000n, // More SOL in pool
      virtualTokenReserves: 600_000_000_000_000n, // Fewer tokens
    };

    const initialPrice = getBondingCurvePrice(initial);
    const afterPrice = getBondingCurvePrice(afterBuy);

    expect(afterPrice).toBeGreaterThan(initialPrice);
  });
});

// ============================================================================
// Hex/Bytes Conversion Tests
// ============================================================================

describe('hexToBytes', () => {
  it('converts hex string to bytes', () => {
    const bytes = hexToBytes('deadbeef');
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('handles 0x prefix', () => {
    const bytes = hexToBytes('0xdeadbeef');
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('handles uppercase hex', () => {
    const bytes = hexToBytes('DEADBEEF');
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('handles mixed case hex', () => {
    const bytes = hexToBytes('DeAdBeEf');
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('throws on invalid hex characters', () => {
    expect(() => hexToBytes('0xZZZZ')).toThrow('Invalid hex string');
    expect(() => hexToBytes('ghij')).toThrow('Invalid hex string');
  });

  it('handles empty after prefix', () => {
    const bytes = hexToBytes('');
    expect(bytes).toEqual(new Uint8Array([]));
  });
});

describe('bytesToHex', () => {
  it('converts bytes to hex string', () => {
    const hex = bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(hex).toBe('0xdeadbeef');
  });

  it('pads single digit bytes', () => {
    const hex = bytesToHex(new Uint8Array([0x01, 0x02, 0x0a, 0x0f]));
    expect(hex).toBe('0x01020a0f');
  });

  it('handles empty array', () => {
    const hex = bytesToHex(new Uint8Array([]));
    expect(hex).toBe('0x');
  });

  it('roundtrips with hexToBytes', () => {
    const original = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);
    const hex = bytesToHex(original);
    const recovered = hexToBytes(hex);
    expect(recovered).toEqual(original);
  });
});

describe('evmAddressToBytes', () => {
  it('converts EVM address to 20 bytes', () => {
    // Valid 40-char hex = 20 bytes
    const address = '0xdead00000000000000000000000000000000beef';
    const bytes = evmAddressToBytes(address);
    
    expect(bytes.length).toBe(20);
    expect(bytes[0]).toBe(0xde);
    expect(bytes[1]).toBe(0xad);
    expect(bytes[18]).toBe(0xbe);
    expect(bytes[19]).toBe(0xef);
  });

  it('handles address without 0x prefix', () => {
    const address = 'dead00000000000000000000000000000000beef';
    const bytes = evmAddressToBytes(address);
    expect(bytes.length).toBe(20);
  });

  it('throws on wrong length', () => {
    expect(() => evmAddressToBytes('0xdead')).toThrow('Invalid EVM address length');
    expect(() => evmAddressToBytes('0x' + 'aa'.repeat(21))).toThrow('Invalid EVM address length');
  });
});

describe('bytesToEvmAddress', () => {
  it('converts 20 bytes to EVM address', () => {
    const bytes = new Uint8Array(20);
    bytes[0] = 0xde;
    bytes[1] = 0xad;
    bytes[18] = 0xbe;
    bytes[19] = 0xef;

    const address = bytesToEvmAddress(bytes);
    expect(address).toBe('0xdead00000000000000000000000000000000beef');
  });

  it('roundtrips with evmAddressToBytes', () => {
    // Valid 40-char hex = 20 bytes
    const original = '0xdead00000000000000000000000000000000beef';
    const bytes = evmAddressToBytes(original);
    const recovered = bytesToEvmAddress(bytes);
    expect(recovered).toBe(original);
  });
});

// ============================================================================
// Pool Filtering Tests
// ============================================================================

describe('poolMatchesFilter', () => {
  const mintA = new PublicKey('So11111111111111111111111111111111111111112'); // WSOL
  const mintB = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
  const mintC = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'); // USDT

  it('matches when both tokens present', () => {
    expect(poolMatchesFilter(mintA, mintB, { tokenA: mintA, tokenB: mintB })).toBe(true);
    expect(poolMatchesFilter(mintB, mintA, { tokenA: mintA, tokenB: mintB })).toBe(true); // Order doesn't matter
  });

  it('does not match when one token missing', () => {
    expect(poolMatchesFilter(mintA, mintB, { tokenA: mintA, tokenB: mintC })).toBe(false);
    expect(poolMatchesFilter(mintA, mintB, { tokenA: mintC, tokenB: mintB })).toBe(false);
  });

  it('matches when only tokenA specified', () => {
    expect(poolMatchesFilter(mintA, mintB, { tokenA: mintA })).toBe(true);
    expect(poolMatchesFilter(mintB, mintA, { tokenA: mintA })).toBe(true);
    expect(poolMatchesFilter(mintB, mintC, { tokenA: mintA })).toBe(false);
  });

  it('matches everything when no filter', () => {
    expect(poolMatchesFilter(mintA, mintB, {})).toBe(true);
    expect(poolMatchesFilter(mintC, mintB, {})).toBe(true);
  });
});

describe('getSwapReserves', () => {
  const mockPool: PoolInfo = {
    address: new PublicKey('11111111111111111111111111111111'),
    dex: 'raydium',
    poolType: 'cpmm',
    tokenA: {
      mint: new PublicKey('So11111111111111111111111111111111111111112'),
      decimals: 9,
      symbol: 'SOL',
    },
    tokenB: {
      mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      decimals: 6,
      symbol: 'USDC',
    },
    reserveA: 100_000_000_000n, // 100 SOL
    reserveB: 10_000_000_000n, // 10,000 USDC
    fee: 0.003,
    tvl: 20000n,
  };

  it('returns correct reserves when input is token A', () => {
    const { inputReserve, outputReserve, isInputA } = getSwapReserves(
      mockPool,
      mockPool.tokenA.mint
    );

    expect(isInputA).toBe(true);
    expect(inputReserve).toBe(100_000_000_000n);
    expect(outputReserve).toBe(10_000_000_000n);
  });

  it('returns correct reserves when input is token B', () => {
    const { inputReserve, outputReserve, isInputA } = getSwapReserves(
      mockPool,
      mockPool.tokenB.mint
    );

    expect(isInputA).toBe(false);
    expect(inputReserve).toBe(10_000_000_000n);
    expect(outputReserve).toBe(100_000_000_000n);
  });
});

// ============================================================================
// Decimal Inference Tests
// ============================================================================

describe('inferDecimals', () => {
  it('infers 9 decimals for SOL-like amounts', () => {
    const decimals = inferDecimals(1.5, '1500000000');
    expect(decimals).toBe(9);
  });

  it('infers 6 decimals for USDC-like amounts', () => {
    const decimals = inferDecimals(100, '100000000');
    expect(decimals).toBe(6);
  });

  it('infers 8 decimals for BTC-like amounts', () => {
    const decimals = inferDecimals(0.5, '50000000');
    expect(decimals).toBe(8);
  });

  it('returns 9 for zero human amount', () => {
    const decimals = inferDecimals(0, '0');
    expect(decimals).toBe(9);
  });
});

// ============================================================================
// buildSwapQuote Tests
// ============================================================================

describe('buildSwapQuote', () => {
  it('builds a complete swap quote', () => {
    const inputMint = new PublicKey('So11111111111111111111111111111111111111112');
    const outputMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    const pool: PoolInfo = {
      address: new PublicKey('11111111111111111111111111111111'),
      dex: 'raydium',
      poolType: 'cpmm',
      tokenA: { mint: inputMint, decimals: 9, symbol: 'SOL' },
      tokenB: { mint: outputMint, decimals: 6, symbol: 'USDC' },
      reserveA: 100_000_000_000n,
      reserveB: 10_000_000_000n,
      fee: 0.003,
      tvl: 20000n,
    };

    const ammResult = {
      outputAmount: 9_900_000n,
      minOutputAmount: 9_850_000n,
      fee: 3_000_000n,
      priceImpactPct: 0.1,
    };

    const quote = buildSwapQuote({
      inputMint,
      outputMint,
      inputAmount: 1_000_000_000n,
      pool,
      ammResult,
      dex: 'raydium',
    });

    expect(quote.inputMint).toEqual(inputMint);
    expect(quote.outputMint).toEqual(outputMint);
    expect(quote.inputAmount).toBe(1_000_000_000n);
    expect(quote.outputAmount).toBe(9_900_000n);
    expect(quote.minOutputAmount).toBe(9_850_000n);
    expect(quote.priceImpactPct).toBe(0.1);
    expect(quote.fee).toBe(3_000_000n);
    expect(quote.route.length).toBe(1);
    expect(quote.route[0].dex).toBe('raydium');
    expect(quote.route[0].poolAddress).toEqual(pool.address);
  });
});
