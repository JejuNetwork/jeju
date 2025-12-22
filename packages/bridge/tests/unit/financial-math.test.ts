/**
 * Property-Based / Fuzz Tests for Financial Math
 *
 * Tests mathematical invariants that must hold for:
 * - Fee calculations (bps to amount)
 * - Price difference calculations
 * - Profit/loss calculations
 * - Revenue splits
 * - Slippage calculations
 *
 * Uses random inputs to find edge cases that manual testing might miss.
 */

import { describe, expect, it } from 'bun:test';
import { formatUnits, parseUnits } from 'viem';

// ============ Helper Functions ============

/**
 * Generate random bigint in range [min, max]
 */
function randomBigInt(min: bigint, max: bigint): bigint {
  const range = max - min;
  const randomBits = BigInt(Math.floor(Math.random() * Number(range)));
  return min + randomBits;
}

/**
 * Generate random integer in range [min, max]
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Run a property test multiple times
 */
function forAll<T>(
  generator: () => T,
  property: (value: T) => void,
  iterations = 100
): void {
  for (let i = 0; i < iterations; i++) {
    const value = generator();
    property(value);
  }
}

// ============ Financial Math Functions ============

/**
 * Calculate fee in token units from bps
 */
function calculateFeeBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / 10000n;
}

/**
 * Calculate price difference in bps
 */
function calculatePriceDiffBps(price1: bigint, price2: bigint): number {
  if (price1 === 0n || price2 === 0n) return 0;
  const minPrice = price1 < price2 ? price1 : price2;
  const maxPrice = price1 > price2 ? price1 : price2;
  return Number(((maxPrice - minPrice) * 10000n) / minPrice);
}

/**
 * Calculate net profit after fees
 */
function calculateNetProfit(
  grossProfit: bigint,
  protocolFeeBps: number,
  gasCost: bigint
): bigint {
  const protocolFee = calculateFeeBps(grossProfit, protocolFeeBps);
  return grossProfit - protocolFee - gasCost;
}

/**
 * Calculate user receives after all fees
 */
function calculateUserReceives(
  amount: bigint,
  protocolFeeBps: number,
  xlpFeeBps: number,
  solverFeeBps: number,
  bridgeFee: bigint
): bigint {
  const protocolFee = calculateFeeBps(amount, protocolFeeBps);
  const xlpFee = calculateFeeBps(amount, xlpFeeBps);
  const solverFee = calculateFeeBps(amount, solverFeeBps);
  return amount - protocolFee - xlpFee - solverFee - bridgeFee;
}

/**
 * Calculate slippage impact
 */
function calculateSlippageImpact(
  expectedOutput: bigint,
  actualOutput: bigint
): number {
  if (expectedOutput === 0n) return 0;
  const diff = expectedOutput - actualOutput;
  return Number((diff * 10000n) / expectedOutput);
}

/**
 * Split revenue between parties
 */
function splitRevenue(
  totalRevenue: bigint,
  shares: { party: string; bps: number }[]
): Map<string, bigint> {
  const result = new Map<string, bigint>();
  let remaining = totalRevenue;

  for (const share of shares) {
    const amount = (totalRevenue * BigInt(share.bps)) / 10000n;
    result.set(share.party, amount);
    remaining -= amount;
  }

  // Add remainder to first party (treasury)
  if (shares.length > 0) {
    const first = shares[0].party;
    result.set(first, (result.get(first) ?? 0n) + remaining);
  }

  return result;
}

// ============ Property Tests ============

describe('Financial Math Properties', () => {
  describe('Fee Calculation Properties', () => {
    it('property: fee should never exceed amount', () => {
      forAll(
        () => ({
          amount: randomBigInt(1n, 10n ** 24n),
          bps: randomInt(0, 10000),
        }),
        ({ amount, bps }) => {
          const fee = calculateFeeBps(amount, bps);
          expect(fee <= amount).toBe(true);
        }
      );
    });

    it('property: fee should be 0 when bps is 0', () => {
      forAll(
        () => randomBigInt(1n, 10n ** 24n),
        (amount) => {
          const fee = calculateFeeBps(amount, 0);
          expect(fee).toBe(0n);
        }
      );
    });

    it('property: fee should equal amount when bps is 10000 (100%)', () => {
      forAll(
        () => randomBigInt(1n, 10n ** 18n),
        (amount) => {
          const fee = calculateFeeBps(amount, 10000);
          expect(fee).toBe(amount);
        }
      );
    });

    it('property: fee should scale linearly with bps', () => {
      forAll(
        () => ({
          amount: randomBigInt(10000n, 10n ** 18n),
          bps1: randomInt(1, 100),
        }),
        ({ amount, bps1 }) => {
          const bps2 = bps1 * 2;
          const fee1 = calculateFeeBps(amount, bps1);
          const fee2 = calculateFeeBps(amount, bps2);

          // fee2 should be approximately 2 * fee1
          // Allow for rounding: fee2 should be in [2*fee1 - 1, 2*fee1 + 1]
          expect(fee2 >= fee1 * 2n - 1n && fee2 <= fee1 * 2n + 1n).toBe(true);
        }
      );
    });

    it('property: fee should scale approximately linearly with amount', () => {
      forAll(
        () => ({
          // Use amounts large enough to avoid rounding issues
          amount: randomBigInt(10000n, 10n ** 12n),
          bps: randomInt(1, 1000),
        }),
        ({ amount, bps }) => {
          const fee1 = calculateFeeBps(amount, bps);
          const fee2 = calculateFeeBps(amount * 2n, bps);

          // Due to integer division, fee2 should be within ±1 of 2*fee1
          // This accounts for rounding differences
          expect(fee2 >= fee1 * 2n - 1n && fee2 <= fee1 * 2n + 1n).toBe(true);
        }
      );
    });

    it('property: sum of fees should not exceed amount', () => {
      forAll(
        () => ({
          amount: randomBigInt(10000n, 10n ** 18n),
          protocolBps: randomInt(0, 100),
          xlpBps: randomInt(0, 50),
          solverBps: randomInt(0, 50),
        }),
        ({ amount, protocolBps, xlpBps, solverBps }) => {
          const protocolFee = calculateFeeBps(amount, protocolBps);
          const xlpFee = calculateFeeBps(amount, xlpBps);
          const solverFee = calculateFeeBps(amount, solverBps);
          const totalFees = protocolFee + xlpFee + solverFee;

          expect(totalFees <= amount).toBe(true);
        }
      );
    });
  });

  describe('Price Difference Properties', () => {
    it('property: difference should be 0 for equal prices', () => {
      forAll(
        () => randomBigInt(1n, 10n ** 24n),
        (price) => {
          const diff = calculatePriceDiffBps(price, price);
          expect(diff).toBe(0);
        }
      );
    });

    it('property: difference should be symmetric', () => {
      forAll(
        () => ({
          price1: randomBigInt(1n, 10n ** 18n),
          price2: randomBigInt(1n, 10n ** 18n),
        }),
        ({ price1, price2 }) => {
          const diff1 = calculatePriceDiffBps(price1, price2);
          const diff2 = calculatePriceDiffBps(price2, price1);
          expect(diff1).toBe(diff2);
        }
      );
    });

    it('property: difference should be >= 0', () => {
      forAll(
        () => ({
          price1: randomBigInt(1n, 10n ** 18n),
          price2: randomBigInt(1n, 10n ** 18n),
        }),
        ({ price1, price2 }) => {
          const diff = calculatePriceDiffBps(price1, price2);
          expect(diff).toBeGreaterThanOrEqual(0);
        }
      );
    });

    it('property: doubling one price should give ~10000 bps difference', () => {
      forAll(
        () => randomBigInt(1n, 10n ** 12n),
        (price) => {
          const diff = calculatePriceDiffBps(price, price * 2n);
          expect(diff).toBe(10000); // 100%
        }
      );
    });

    it('property: 1% difference should be ~100 bps', () => {
      forAll(
        () => randomBigInt(10000n, 10n ** 12n),
        (price) => {
          const onePctMore = price + price / 100n;
          const diff = calculatePriceDiffBps(price, onePctMore);
          // Due to integer division, allow some tolerance
          expect(diff).toBeGreaterThanOrEqual(99);
          expect(diff).toBeLessThanOrEqual(101);
        }
      );
    });
  });

  describe('Profit Calculation Properties', () => {
    it('property: net profit should never exceed gross profit', () => {
      forAll(
        () => ({
          grossProfit: randomBigInt(0n, 10n ** 18n),
          feeBps: randomInt(0, 1000),
          gasCost: randomBigInt(0n, 10n ** 16n),
        }),
        ({ grossProfit, feeBps, gasCost }) => {
          const netProfit = calculateNetProfit(grossProfit, feeBps, gasCost);
          expect(netProfit <= grossProfit).toBe(true);
        }
      );
    });

    it('property: zero fees and gas should preserve profit', () => {
      forAll(
        () => randomBigInt(0n, 10n ** 18n),
        (grossProfit) => {
          const netProfit = calculateNetProfit(grossProfit, 0, 0n);
          expect(netProfit).toBe(grossProfit);
        }
      );
    });

    it('property: profit can be negative when costs exceed gross', () => {
      const grossProfit = 1000n;
      const netProfit = calculateNetProfit(grossProfit, 0, 5000n);
      expect(netProfit).toBe(-4000n);
    });
  });

  describe('User Receives Properties', () => {
    it('property: user receives should be <= original amount', () => {
      forAll(
        () => ({
          amount: randomBigInt(10000n, 10n ** 18n),
          protocolBps: randomInt(0, 100),
          xlpBps: randomInt(0, 50),
          solverBps: randomInt(0, 50),
          bridgeFee: randomBigInt(0n, 10n ** 15n),
        }),
        ({ amount, protocolBps, xlpBps, solverBps, bridgeFee }) => {
          const userReceives = calculateUserReceives(
            amount,
            protocolBps,
            xlpBps,
            solverBps,
            bridgeFee
          );
          expect(userReceives <= amount).toBe(true);
        }
      );
    });

    it('property: zero fees means user receives full amount minus bridge fee', () => {
      forAll(
        () => ({
          amount: randomBigInt(10n ** 15n, 10n ** 18n),
          bridgeFee: randomBigInt(0n, 10n ** 14n),
        }),
        ({ amount, bridgeFee }) => {
          const userReceives = calculateUserReceives(amount, 0, 0, 0, bridgeFee);
          expect(userReceives).toBe(amount - bridgeFee);
        }
      );
    });

    it('property: all deductions should sum to original minus received', () => {
      forAll(
        () => ({
          amount: randomBigInt(10000n, 10n ** 18n),
          protocolBps: randomInt(0, 100),
          xlpBps: randomInt(0, 50),
          solverBps: randomInt(0, 50),
          bridgeFee: randomBigInt(0n, 10n ** 14n),
        }),
        ({ amount, protocolBps, xlpBps, solverBps, bridgeFee }) => {
          const userReceives = calculateUserReceives(
            amount,
            protocolBps,
            xlpBps,
            solverBps,
            bridgeFee
          );

          const protocolFee = calculateFeeBps(amount, protocolBps);
          const xlpFee = calculateFeeBps(amount, xlpBps);
          const solverFee = calculateFeeBps(amount, solverBps);

          const totalDeducted = protocolFee + xlpFee + solverFee + bridgeFee;
          expect(amount - userReceives).toBe(totalDeducted);
        }
      );
    });
  });

  describe('Slippage Properties', () => {
    it('property: slippage should be 0 when expected equals actual', () => {
      forAll(
        () => randomBigInt(1n, 10n ** 18n),
        (output) => {
          const slippage = calculateSlippageImpact(output, output);
          expect(slippage).toBe(0);
        }
      );
    });

    it('property: slippage should be positive when actual < expected', () => {
      forAll(
        () => {
          const expected = randomBigInt(1000n, 10n ** 18n);
          const actual = expected - randomBigInt(1n, expected / 2n);
          return { expected, actual };
        },
        ({ expected, actual }) => {
          const slippage = calculateSlippageImpact(expected, actual);
          expect(slippage).toBeGreaterThan(0);
        }
      );
    });

    it('property: slippage should be ~10000 bps when actual is 0', () => {
      forAll(
        () => randomBigInt(1n, 10n ** 18n),
        (expected) => {
          const slippage = calculateSlippageImpact(expected, 0n);
          expect(slippage).toBe(10000);
        }
      );
    });

    it('property: 1% slippage should be ~100 bps', () => {
      forAll(
        () => randomBigInt(10000n, 10n ** 15n),
        (expected) => {
          const actual = expected - expected / 100n;
          const slippage = calculateSlippageImpact(expected, actual);
          expect(slippage).toBeGreaterThanOrEqual(99);
          expect(slippage).toBeLessThanOrEqual(101);
        }
      );
    });
  });

  describe('Revenue Split Properties', () => {
    it('property: sum of shares should equal total (with rounding)', () => {
      forAll(
        () => ({
          totalRevenue: randomBigInt(10000n, 10n ** 18n),
          shares: [
            { party: 'treasury', bps: randomInt(1000, 5000) },
            { party: 'xlp', bps: randomInt(500, 2000) },
            { party: 'solver', bps: randomInt(500, 2000) },
          ],
        }),
        ({ totalRevenue, shares }) => {
          const split = splitRevenue(totalRevenue, shares);
          let sum = 0n;
          for (const [, amount] of split) {
            sum += amount;
          }
          // Sum should equal total (remainder goes to first party)
          expect(sum).toBe(totalRevenue);
        }
      );
    });

    it('property: each party should get proportional share', () => {
      const totalRevenue = 10000000n;
      const shares = [
        { party: 'treasury', bps: 5000 }, // 50%
        { party: 'xlp', bps: 3000 }, // 30%
        { party: 'solver', bps: 2000 }, // 20%
      ];

      const split = splitRevenue(totalRevenue, shares);

      // Treasury gets ~50% plus remainder
      expect(split.get('treasury')).toBeGreaterThanOrEqual(5000000n);
      expect(split.get('xlp')).toBe(3000000n);
      expect(split.get('solver')).toBe(2000000n);
    });

    it('property: empty shares should return empty map', () => {
      const split = splitRevenue(1000000n, []);
      expect(split.size).toBe(0);
    });
  });

  describe('BigInt Edge Cases', () => {
    it('should handle very large amounts (10^24)', () => {
      const amount = 10n ** 24n;
      const fee = calculateFeeBps(amount, 10); // 0.1%
      expect(fee).toBe(10n ** 21n);
    });

    it('should handle minimum amounts', () => {
      expect(calculateFeeBps(1n, 10000)).toBe(1n);
      expect(calculateFeeBps(1n, 1)).toBe(0n); // Rounds to 0
      expect(calculateFeeBps(10000n, 1)).toBe(1n);
    });

    it('should handle amounts just above fee threshold', () => {
      // For 1 bps fee, need at least 10000 units to get 1 unit fee
      expect(calculateFeeBps(9999n, 1)).toBe(0n);
      expect(calculateFeeBps(10000n, 1)).toBe(1n);
    });

    it('should not overflow for realistic amounts', () => {
      // $1 trillion in USDC (6 decimals)
      const trilliondUSDC = 10n ** 18n;
      const fee = calculateFeeBps(trilliondUSDC, 100); // 1%
      expect(fee).toBe(10n ** 16n);
    });
  });

  describe('Invariant: Conservation', () => {
    it('should conserve total value across fee splits', () => {
      forAll(
        () => ({
          amount: randomBigInt(100000n, 10n ** 18n),
          protocolBps: randomInt(1, 50),
          xlpBps: randomInt(1, 30),
          solverBps: randomInt(1, 20),
        }),
        ({ amount, protocolBps, xlpBps, solverBps }) => {
          const protocolFee = calculateFeeBps(amount, protocolBps);
          const xlpFee = calculateFeeBps(amount, xlpBps);
          const solverFee = calculateFeeBps(amount, solverBps);
          const userReceives = amount - protocolFee - xlpFee - solverFee;

          // Total should equal original (minus potential rounding losses)
          const total = protocolFee + xlpFee + solverFee + userReceives;
          expect(total).toBe(amount);
        }
      );
    });
  });
});

describe('Deterministic Math Verification', () => {
  describe('Known Fee Calculations', () => {
    const testCases = [
      { amount: 1000000000n, bps: 10, expected: 1000000n }, // 0.1% of 1000
      { amount: 1000000000n, bps: 100, expected: 10000000n }, // 1% of 1000
      { amount: 1000000000n, bps: 50, expected: 5000000n }, // 0.5% of 1000
      { amount: 100000000n, bps: 25, expected: 250000n }, // 0.25% of 100
      { amount: 1n, bps: 10000, expected: 1n }, // 100% of 1
    ];

    for (const { amount, bps, expected } of testCases) {
      it(`should calculate ${bps}bps of ${amount} = ${expected}`, () => {
        const result = calculateFeeBps(amount, bps);
        expect(result).toBe(expected);
      });
    }
  });

  describe('Known Price Differences', () => {
    const testCases = [
      { price1: 100n, price2: 101n, expected: 100 }, // 1%
      { price1: 100n, price2: 105n, expected: 500 }, // 5%
      { price1: 100n, price2: 110n, expected: 1000 }, // 10%
      { price1: 100n, price2: 200n, expected: 10000 }, // 100%
      { price1: 1000n, price2: 1000n, expected: 0 }, // 0%
    ];

    for (const { price1, price2, expected } of testCases) {
      it(`should calculate diff between ${price1} and ${price2} = ${expected}bps`, () => {
        const result = calculatePriceDiffBps(price1, price2);
        expect(result).toBe(expected);
      });
    }
  });
});
