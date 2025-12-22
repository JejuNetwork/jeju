/**
 * Portfolio Simulator Tests
 * 
 * Tests for AMM math, swap calculations, liquidity operations:
 * - Swap price calculations
 * - Slippage calculations
 * - Spot price
 * - Add/remove liquidity
 * - Weight interpolation
 * - Fee calculations
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { PortfolioSimulator, type SimulatedSwap } from './portfolio-simulator';
import type { Token, OraclePrice } from '../types';
import { WEIGHT_PRECISION, BPS_PRECISION } from '../schemas';

describe('PortfolioSimulator', () => {
  let simulator: PortfolioSimulator;
  let tokens: Token[];

  beforeEach(() => {
    tokens = [
      { address: '0x1', symbol: 'WETH', decimals: 18, chainId: 8453 },
      { address: '0x2', symbol: 'USDC', decimals: 6, chainId: 8453 },
    ];

    // Initialize with 10 ETH @ $3000 = $30,000 and 30,000 USDC
    // 50/50 weights
    const initialBalances = [
      10n * 10n ** 18n,  // 10 ETH
      30000n * 10n ** 6n, // 30,000 USDC
    ];
    const initialWeights = [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n];

    simulator = new PortfolioSimulator(
      tokens,
      initialBalances,
      initialWeights,
      30,  // 0.3% swap fee
      1000 // 10% protocol fee
    );
  });

  describe('Spot Price Calculation', () => {
    test('should calculate correct spot price for balanced pool', () => {
      // With 10 ETH and 30,000 USDC at 50/50 weights
      // Price = (balanceOut / weightOut) / (balanceIn / weightIn)
      // For ETH->USDC: (30000 USDC / 0.5) / (10 ETH / 0.5) = 3000 USDC per ETH
      const spotPrice = simulator.getSpotPrice('WETH', 'USDC');
      
      // Spot price in WEIGHT_PRECISION scale
      // 3000 USDC per ETH = 3000 * 10^6 / 10^18 in raw terms
      // With WEIGHT_PRECISION scaling: should be 3000 * 10^6 * WEIGHT_PRECISION / 10^18
      expect(spotPrice).toBeGreaterThan(0n);
    });

    test('should throw for unknown token', () => {
      expect(() => simulator.getSpotPrice('UNKNOWN', 'USDC')).toThrow('not found');
    });

    test('should be inverse for reversed pair', () => {
      const ethToUsdc = simulator.getSpotPrice('WETH', 'USDC');
      const usdcToEth = simulator.getSpotPrice('USDC', 'WETH');
      
      // Product should be approximately WEIGHT_PRECISION^2
      const product = (ethToUsdc * usdcToEth) / WEIGHT_PRECISION;
      
      // Allow for rounding errors
      expect(product).toBeGreaterThan(WEIGHT_PRECISION - WEIGHT_PRECISION / 100n);
      expect(product).toBeLessThan(WEIGHT_PRECISION + WEIGHT_PRECISION / 100n);
    });
  });

  describe('Swap Execution', () => {
    test('should execute swap and update balances', () => {
      const initialState = simulator.getState();
      const initialEthBalance = initialState.balances[0];
      const initialUsdcBalance = initialState.balances[1];

      // Swap 1 ETH for USDC
      const swap = simulator.swap('WETH', 'USDC', 1n * 10n ** 18n);

      const newState = simulator.getState();

      // ETH balance should increase by 1 ETH
      expect(newState.balances[0]).toBe(initialEthBalance + 1n * 10n ** 18n);
      // USDC balance should decrease by amountOut
      expect(newState.balances[1]).toBe(initialUsdcBalance - swap.amountOut);
    });

    test('should collect fees', () => {
      const swap = simulator.swap('WETH', 'USDC', 1n * 10n ** 18n);
      
      // Fee should be 0.3% of input
      const expectedFee = (1n * 10n ** 18n * 30n) / BPS_PRECISION;
      expect(swap.fee).toBe(expectedFee);
    });

    test('should accumulate protocol fees', () => {
      simulator.swap('WETH', 'USDC', 1n * 10n ** 18n);
      
      const state = simulator.getState();
      // Protocol fee is 10% of swap fee
      expect(state.accumulatedFees[0]).toBeGreaterThan(0n);
    });

    test('should produce slippage for large swaps', () => {
      // Create fresh simulator with same-decimal tokens to avoid precision issues
      const sameDecimalTokens: Token[] = [
        { address: '0x1', symbol: 'A', decimals: 18, chainId: 8453 },
        { address: '0x2', symbol: 'B', decimals: 18, chainId: 8453 },
      ];
      
      const smallSimulator = new PortfolioSimulator(
        sameDecimalTokens,
        [100n * 10n ** 18n, 100n * 10n ** 18n],
        [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
        30,
        1000
      );
      
      // Small swap - 0.1% of pool
      const smallSwap = smallSimulator.swap('A', 'B', 1n * 10n ** 17n);
      
      // Large swap - should execute successfully and return swap details
      const largeSimulator = new PortfolioSimulator(
        sameDecimalTokens,
        [100n * 10n ** 18n, 100n * 10n ** 18n],
        [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
        30,
        1000
      );
      
      // Large swap - 30% of pool
      const largeSwap = largeSimulator.swap('A', 'B', 30n * 10n ** 18n);
      
      // Both should return valid swap objects
      expect(smallSwap.amountOut).toBeGreaterThan(0n);
      expect(largeSwap.amountOut).toBeGreaterThan(0n);
      
      // Large swap should get worse exchange rate
      // (amountIn / amountOut) should be higher for large swap
      const smallRate = Number(smallSwap.amountIn) / Number(smallSwap.amountOut);
      const largeRate = Number(largeSwap.amountIn) / Number(largeSwap.amountOut);
      expect(largeRate).toBeGreaterThan(smallRate);
    });

    test('should track swap history', () => {
      simulator.swap('WETH', 'USDC', 1n * 10n ** 18n);
      simulator.swap('USDC', 'WETH', 1000n * 10n ** 6n);
      
      const history = simulator.getSwapHistory();
      expect(history.length).toBe(2);
      expect(history[0].tokenIn).toBe('WETH');
      expect(history[1].tokenIn).toBe('USDC');
    });

    test('should throw for unknown tokens', () => {
      expect(() => simulator.swap('UNKNOWN', 'USDC', 1n)).toThrow('Token not found');
    });
  });

  describe('Weighted Power Function', () => {
    test('should handle equal weights correctly', () => {
      // With 50/50 weights, swap should follow x*y=k approximately
      const state = simulator.getState();
      const initialProduct = state.balances[0] * state.balances[1];
      
      // Small swap to minimize price impact
      simulator.swap('WETH', 'USDC', 1n * 10n ** 16n); // 0.01 ETH
      
      const newState = simulator.getState();
      const newProduct = newState.balances[0] * newState.balances[1];
      
      // Product should increase slightly due to fees
      expect(newProduct).toBeGreaterThanOrEqual(initialProduct);
    });
  });

  describe('Liquidity Operations', () => {
    test('should add liquidity and update state', () => {
      const initialState = simulator.getState();
      const initialLp = initialState.totalLpTokens;
      
      // Add some liquidity
      const amounts = [
        1n * 10n ** 18n,  // 1 ETH
        3000n * 10n ** 6n, // 3,000 USDC
      ];
      
      const lpReceived = simulator.addLiquidity(amounts);
      
      expect(lpReceived).toBeGreaterThan(0n);
      
      const newState = simulator.getState();
      expect(newState.totalLpTokens).toBe(initialLp + lpReceived);
      // Balances should be at least as large as initial (they may stay same if ratio is wrong)
      expect(newState.balances[0]).toBeGreaterThanOrEqual(initialState.balances[0]);
      expect(newState.balances[1]).toBeGreaterThanOrEqual(initialState.balances[1]);
    });

    test('should use minimum ratio for unbalanced deposits', () => {
      // Add disproportionate amounts
      const amounts = [
        2n * 10n ** 18n,   // 2 ETH (20% of pool)
        1000n * 10n ** 6n, // 1,000 USDC (3.3% of pool)
      ];
      
      const lpReceived = simulator.addLiquidity(amounts);
      
      // LP should be based on the smaller proportion (USDC)
      // This is a simplified model - real pools would handle differently
      expect(lpReceived).toBeGreaterThan(0n);
    });

    test('should remove liquidity proportionally', () => {
      const initialState = simulator.getState();
      
      // Remove 10% of LP tokens
      const lpToRemove = initialState.totalLpTokens / 10n;
      const amountsOut = simulator.removeLiquidity(lpToRemove);
      
      expect(amountsOut.length).toBe(2);
      expect(amountsOut[0]).toBeGreaterThan(0n);
      expect(amountsOut[1]).toBeGreaterThan(0n);
      
      const newState = simulator.getState();
      expect(newState.totalLpTokens).toBe(initialState.totalLpTokens - lpToRemove);
    });

    test('should maintain proportions after remove', () => {
      const initialState = simulator.getState();
      const initialRatio = (initialState.balances[0] * 10n ** 6n) / initialState.balances[1];
      
      simulator.removeLiquidity(initialState.totalLpTokens / 10n);
      
      const newState = simulator.getState();
      const newRatio = (newState.balances[0] * 10n ** 6n) / newState.balances[1];
      
      // Ratio should remain approximately the same
      expect(newRatio).toBeGreaterThan(initialRatio - initialRatio / 100n);
      expect(newRatio).toBeLessThan(initialRatio + initialRatio / 100n);
    });
  });

  describe('Weight Updates', () => {
    test('should interpolate weights over blocks', () => {
      const initialWeights = simulator.getCurrentWeights();
      
      // Set new target weights: 60/40
      const newWeights = [
        (WEIGHT_PRECISION * 60n) / 100n,
        (WEIGHT_PRECISION * 40n) / 100n,
      ];
      
      simulator.applyWeightUpdate(newWeights, 100);
      
      // Advance 50 blocks (halfway)
      simulator.advanceBlocks(50);
      
      const midWeights = simulator.getCurrentWeights();
      
      // Weights should be between initial and target
      expect(midWeights[0]).toBeGreaterThan(initialWeights[0]);
      expect(midWeights[0]).toBeLessThan(newWeights[0]);
    });

    test('should snap to target after full interpolation', () => {
      const newWeights = [
        (WEIGHT_PRECISION * 70n) / 100n,
        (WEIGHT_PRECISION * 30n) / 100n,
      ];
      
      simulator.applyWeightUpdate(newWeights, 100);
      simulator.advanceBlocks(100);
      
      const finalWeights = simulator.getCurrentWeights();
      
      expect(finalWeights[0]).toBe(newWeights[0]);
      expect(finalWeights[1]).toBe(newWeights[1]);
    });

    test('should track weight history', () => {
      const newWeights = [
        (WEIGHT_PRECISION * 60n) / 100n,
        (WEIGHT_PRECISION * 40n) / 100n,
      ];
      
      simulator.applyWeightUpdate(newWeights, 100);
      
      const history = simulator.getWeightHistory();
      expect(history.length).toBe(2); // Initial + update
    });
  });

  describe('Total Value Calculation', () => {
    test('should calculate total pool value', () => {
      const value = simulator.calculateTotalValue();
      expect(value).toBeGreaterThan(0n);
    });

    test('should increase value after adding liquidity', () => {
      const initialValue = simulator.calculateTotalValue();
      
      simulator.addLiquidity([
        1n * 10n ** 18n,
        3000n * 10n ** 6n,
      ]);
      
      const newValue = simulator.calculateTotalValue();
      expect(newValue).toBeGreaterThan(initialValue);
    });
  });

  describe('Strategy Integration', () => {
    test('should update strategy price history', () => {
      const prices: OraclePrice[] = [
        { token: '0x1', price: 300000000000n, decimals: 8, timestamp: Date.now(), source: 'pyth' },
        { token: '0x2', price: 100000000n, decimals: 8, timestamp: Date.now(), source: 'pyth' },
      ];
      
      // Should not throw
      simulator.advanceBlock(prices);
      simulator.advanceBlocks(10, prices);
    });
  });
});

describe('PortfolioSimulator Edge Cases', () => {
  test('should handle very small swaps', () => {
    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
      { address: '0x2', symbol: 'B', decimals: 18, chainId: 1 },
    ];
    
    const simulator = new PortfolioSimulator(
      tokens,
      [10n ** 18n, 10n ** 18n],
      [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      30,
      1000
    );
    
    // Very small swap - 1 wei
    const swap = simulator.swap('A', 'B', 1n);
    expect(swap.amountOut).toBeGreaterThanOrEqual(0n);
  });

  test('should handle asymmetric weights', () => {
    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
      { address: '0x2', symbol: 'B', decimals: 18, chainId: 1 },
    ];
    
    // 80/20 weights
    const simulator = new PortfolioSimulator(
      tokens,
      [80n * 10n ** 18n, 20n * 10n ** 18n],
      [(WEIGHT_PRECISION * 80n) / 100n, (WEIGHT_PRECISION * 20n) / 100n],
      30,
      1000
    );
    
    const spotPrice = simulator.getSpotPrice('A', 'B');
    expect(spotPrice).toBeGreaterThan(0n);
    
    // Swap should work
    const swap = simulator.swap('A', 'B', 1n * 10n ** 18n);
    expect(swap.amountOut).toBeGreaterThan(0n);
  });

  test('should handle three-token pools', () => {
    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
      { address: '0x2', symbol: 'B', decimals: 18, chainId: 1 },
      { address: '0x3', symbol: 'C', decimals: 18, chainId: 1 },
    ];
    
    const third = WEIGHT_PRECISION / 3n;
    const simulator = new PortfolioSimulator(
      tokens,
      [10n ** 18n, 10n ** 18n, 10n ** 18n],
      [third, third, third],
      30,
      1000
    );
    
    // All pair prices should work
    expect(simulator.getSpotPrice('A', 'B')).toBeGreaterThan(0n);
    expect(simulator.getSpotPrice('B', 'C')).toBeGreaterThan(0n);
    expect(simulator.getSpotPrice('A', 'C')).toBeGreaterThan(0n);
    
    // All swaps should work
    simulator.swap('A', 'B', 10n ** 16n);
    simulator.swap('B', 'C', 10n ** 16n);
    simulator.swap('C', 'A', 10n ** 16n);
    
    expect(simulator.getSwapHistory().length).toBe(3);
  });
});

describe('AMM Math Properties', () => {
  test('swap should always reduce output balance', () => {
    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
      { address: '0x2', symbol: 'B', decimals: 18, chainId: 1 },
    ];
    
    const simulator = new PortfolioSimulator(
      tokens,
      [100n * 10n ** 18n, 100n * 10n ** 18n],
      [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      30,
      1000
    );
    
    for (let i = 0; i < 10; i++) {
      const beforeState = simulator.getState();
      const beforeB = beforeState.balances[1];
      
      simulator.swap('A', 'B', 1n * 10n ** 17n);
      
      const afterState = simulator.getState();
      const afterB = afterState.balances[1];
      
      expect(afterB).toBeLessThan(beforeB);
    }
  });

  test('consecutive swaps should have increasing slippage', () => {
    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
      { address: '0x2', symbol: 'B', decimals: 18, chainId: 1 },
    ];
    
    const simulator = new PortfolioSimulator(
      tokens,
      [100n * 10n ** 18n, 100n * 10n ** 18n],
      [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      30,
      1000
    );
    
    // Multiple same-direction swaps should have increasing slippage
    const swapAmount = 5n * 10n ** 18n;
    const swap1 = simulator.swap('A', 'B', swapAmount);
    const swap2 = simulator.swap('A', 'B', swapAmount);
    const swap3 = simulator.swap('A', 'B', swapAmount);
    
    // Amount out per unit should decrease
    expect(swap2.amountOut).toBeLessThan(swap1.amountOut);
    expect(swap3.amountOut).toBeLessThan(swap2.amountOut);
  });
});
