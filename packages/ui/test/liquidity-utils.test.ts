/**
 * Comprehensive tests for liquidity vault utility functions
 * Includes property-based testing / fuzzing for mathematical calculations
 */

import { describe, expect, test } from "bun:test";
import { formatEther, parseEther } from "viem";
import {
  calculateSharePercent,
  parsePositionFromTuple,
  parsePositionFromBalance,
  parseLPPosition,
  type RawPositionTuple,
  type LPPosition,
} from "../src/hooks/liquidity-utils";

describe("calculateSharePercent", () => {
  describe("basic calculations", () => {
    test("returns 0 when totalSupply is 0", () => {
      expect(calculateSharePercent(1000n, 0n)).toBe(0);
    });

    test("returns 0 when totalSupply is negative (edge case)", () => {
      expect(calculateSharePercent(1000n, -1n)).toBe(0);
    });

    test("returns 0 when shares is 0", () => {
      expect(calculateSharePercent(0n, 1000n)).toBe(0);
    });

    test("returns 100 when shares equals totalSupply (100% ownership)", () => {
      const supply = parseEther("1000");
      expect(calculateSharePercent(supply, supply)).toBe(100);
    });

    test("returns 50 when shares is half of totalSupply", () => {
      const supply = parseEther("1000");
      const shares = parseEther("500");
      expect(calculateSharePercent(shares, supply)).toBe(50);
    });

    test("returns 25 when shares is quarter of totalSupply", () => {
      const supply = parseEther("1000");
      const shares = parseEther("250");
      expect(calculateSharePercent(shares, supply)).toBe(25);
    });

    test("returns correct value for 1% ownership", () => {
      const supply = parseEther("10000");
      const shares = parseEther("100");
      expect(calculateSharePercent(shares, supply)).toBe(1);
    });

    test("returns correct value for 0.01% ownership (minimum precision)", () => {
      const supply = parseEther("10000");
      const shares = parseEther("1");
      expect(calculateSharePercent(shares, supply)).toBe(0.01);
    });
  });

  describe("precision edge cases", () => {
    test("handles very small percentages (less than 0.01%)", () => {
      // 1 share out of 1,000,000 = 0.0001% - should round down to 0
      const result = calculateSharePercent(1n, 1000000n);
      expect(result).toBe(0);
    });

    test("handles 0.01% exactly", () => {
      // 1 share out of 10,000 = 0.01%
      const result = calculateSharePercent(1n, 10000n);
      expect(result).toBe(0.01);
    });

    test("handles fractional percentages correctly", () => {
      // 333 shares out of 1000 = 33.3% but due to integer division becomes 33.33
      const result = calculateSharePercent(3333n, 10000n);
      expect(result).toBe(33.33);
    });

    test("handles 99.99% correctly", () => {
      const result = calculateSharePercent(9999n, 10000n);
      expect(result).toBe(99.99);
    });
  });

  describe("large number handling", () => {
    test("handles whale positions (billions of tokens)", () => {
      const whaleShares = parseEther("1000000000"); // 1 billion tokens
      const totalSupply = parseEther("10000000000"); // 10 billion tokens
      expect(calculateSharePercent(whaleShares, totalSupply)).toBe(10);
    });

    test("handles max safe integer territory without overflow", () => {
      // Simulate very large supplies (DeFi protocols can have huge token supplies)
      const largeSupply = BigInt(10) ** BigInt(25); // 10^25 wei
      const shares = largeSupply / 2n;
      expect(calculateSharePercent(shares, largeSupply)).toBe(50);
    });

    test("handles 18-decimal precision typical of ERC20", () => {
      const oneToken = parseEther("1");
      const millionTokens = parseEther("1000000");
      const result = calculateSharePercent(oneToken, millionTokens);
      expect(result).toBe(0);
    });
  });

  describe("property-based testing / fuzzing", () => {
    /**
     * Generate random bigint within a range
     */
    function randomBigInt(max: bigint): bigint {
      const randomValue = Math.floor(Math.random() * Number(max > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : max));
      return BigInt(randomValue);
    }

    test("result is always between 0 and 100 for valid inputs", () => {
      const iterations = 100;
      for (let i = 0; i < iterations; i++) {
        const totalSupply = randomBigInt(parseEther("1000000000")) + 1n; // +1 to avoid 0
        const shares = randomBigInt(totalSupply);
        
        const result = calculateSharePercent(shares, totalSupply);
        
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(100);
      }
    });

    test("shares > totalSupply results in > 100% (edge case for overcollateralization)", () => {
      const totalSupply = parseEther("1000");
      const shares = parseEther("2000"); // 200% of supply
      const result = calculateSharePercent(shares, totalSupply);
      expect(result).toBe(200);
    });

    test("monotonicity: more shares means higher percentage", () => {
      const iterations = 50;
      const totalSupply = parseEther("1000000");
      
      for (let i = 0; i < iterations; i++) {
        const shares1 = randomBigInt(totalSupply);
        const shares2 = shares1 + randomBigInt(parseEther("1000")) + 1n;
        
        const result1 = calculateSharePercent(shares1, totalSupply);
        const result2 = calculateSharePercent(shares2, totalSupply);
        
        expect(result2).toBeGreaterThanOrEqual(result1);
      }
    });

    test("same ratio produces same percentage", () => {
      // 50% should be 50% regardless of scale
      expect(calculateSharePercent(1n, 2n)).toBe(50);
      expect(calculateSharePercent(1000n, 2000n)).toBe(50);
      expect(calculateSharePercent(parseEther("1"), parseEther("2"))).toBe(50);
      expect(calculateSharePercent(parseEther("1000000"), parseEther("2000000"))).toBe(50);
    });

    test("linearity: doubling shares doubles percentage (within precision)", () => {
      const totalSupply = parseEther("10000");
      const shares = parseEther("100"); // 1%
      const doubleShares = shares * 2n; // 2%
      
      const result1 = calculateSharePercent(shares, totalSupply);
      const result2 = calculateSharePercent(doubleShares, totalSupply);
      
      expect(result2).toBe(result1 * 2);
    });
  });
});

describe("parsePositionFromTuple", () => {
  test("correctly parses all tuple fields", () => {
    const position: RawPositionTuple = [
      parseEther("100"),  // ethShares
      parseEther("110"),  // ethValue
      parseEther("50"),   // tokenShares
      parseEther("55"),   // tokenValue
      parseEther("5"),    // pendingFees
    ];
    const totalSupply = parseEther("1000");
    
    const result = parsePositionFromTuple(position, totalSupply);
    
    expect(result.ethShares).toBe(parseEther("100"));
    expect(result.ethValue).toBe(parseEther("110"));
    expect(result.tokenShares).toBe(parseEther("50"));
    expect(result.tokenValue).toBe(parseEther("55"));
    expect(result.pendingFees).toBe(parseEther("5"));
    expect(result.lpTokenBalance).toBe("100");
    expect(result.sharePercent).toBe(10); // 100/1000 = 10%
  });

  test("handles zero values", () => {
    const position: RawPositionTuple = [0n, 0n, 0n, 0n, 0n];
    const totalSupply = parseEther("1000");
    
    const result = parsePositionFromTuple(position, totalSupply);
    
    expect(result.ethShares).toBe(0n);
    expect(result.sharePercent).toBe(0);
    expect(result.lpTokenBalance).toBe("0");
  });

  test("handles position with zero total supply", () => {
    const position: RawPositionTuple = [
      parseEther("100"),
      parseEther("100"),
      0n,
      0n,
      0n,
    ];
    
    const result = parsePositionFromTuple(position, 0n);
    
    expect(result.sharePercent).toBe(0); // Can't calculate percentage with 0 supply
  });

  test("formats lpTokenBalance correctly for various amounts", () => {
    const testCases: Array<{ shares: bigint; expected: string }> = [
      { shares: parseEther("0.5"), expected: "0.5" },
      { shares: parseEther("1.23456789"), expected: "1.23456789" },
      { shares: parseEther("1000000"), expected: "1000000" },
      { shares: 1n, expected: "0.000000000000000001" }, // 1 wei
    ];
    
    for (const { shares, expected } of testCases) {
      const position: RawPositionTuple = [shares, shares, 0n, 0n, 0n];
      const result = parsePositionFromTuple(position, parseEther("10000000"));
      expect(result.lpTokenBalance).toBe(expected);
    }
  });
});

describe("parsePositionFromBalance", () => {
  test("creates position from simple balance", () => {
    const balance = parseEther("500");
    const totalSupply = parseEther("2000");
    
    const result = parsePositionFromBalance(balance, totalSupply);
    
    expect(result.ethShares).toBe(balance);
    expect(result.ethValue).toBe(balance);
    expect(result.tokenShares).toBe(0n);
    expect(result.tokenValue).toBe(0n);
    expect(result.pendingFees).toBe(0n);
    expect(result.lpTokenBalance).toBe("500");
    expect(result.sharePercent).toBe(25); // 500/2000 = 25%
  });

  test("handles zero balance", () => {
    const result = parsePositionFromBalance(0n, parseEther("1000"));
    
    expect(result.ethShares).toBe(0n);
    expect(result.sharePercent).toBe(0);
  });

  test("handles full ownership", () => {
    const supply = parseEther("1000");
    const result = parsePositionFromBalance(supply, supply);
    
    expect(result.sharePercent).toBe(100);
  });
});

describe("parseLPPosition", () => {
  describe("priority handling", () => {
    test("prefers tuple format when both are available", () => {
      const position: RawPositionTuple = [
        parseEther("100"),
        parseEther("100"),
        parseEther("50"),
        parseEther("50"),
        parseEther("10"),
      ];
      const balance = parseEther("200"); // Different value
      const totalSupply = parseEther("1000");
      
      const result = parseLPPosition(position, balance, totalSupply);
      
      expect(result).not.toBeNull();
      // Should use tuple format, which includes token shares
      expect(result!.tokenShares).toBe(parseEther("50"));
      expect(result!.pendingFees).toBe(parseEther("10"));
    });

    test("falls back to balance when tuple is undefined", () => {
      const balance = parseEther("200");
      const totalSupply = parseEther("1000");
      
      const result = parseLPPosition(undefined, balance, totalSupply);
      
      expect(result).not.toBeNull();
      expect(result!.ethShares).toBe(balance);
      expect(result!.tokenShares).toBe(0n); // Balance format has no token shares
    });
  });

  describe("null returns", () => {
    test("returns null when all inputs are undefined", () => {
      const result = parseLPPosition(undefined, undefined, undefined);
      expect(result).toBeNull();
    });

    test("returns null when only balance is provided without supply", () => {
      const result = parseLPPosition(undefined, parseEther("100"), undefined);
      expect(result).toBeNull();
    });

    test("returns null when balance exists but supply is 0", () => {
      const result = parseLPPosition(undefined, parseEther("100"), 0n);
      expect(result).toBeNull();
    });

    test("returns position from tuple even with 0 supply", () => {
      // Tuple format should still work - it returns 0% share
      const position: RawPositionTuple = [
        parseEther("100"),
        parseEther("100"),
        0n,
        0n,
        0n,
      ];
      const result = parseLPPosition(position, undefined, 0n);
      expect(result).not.toBeNull();
      expect(result!.sharePercent).toBe(0);
    });
  });

  describe("real-world scenarios", () => {
    test("small LP in large pool", () => {
      const position: RawPositionTuple = [
        parseEther("10"),     // 10 ETH shares
        parseEther("10.5"),   // Worth 10.5 ETH (some fees accrued)
        parseEther("5000"),   // 5000 token shares
        parseEther("5200"),   // Worth 5200 tokens
        parseEther("0.1"),    // 0.1 ETH pending fees
      ];
      const totalSupply = parseEther("100000");
      
      const result = parseLPPosition(position, undefined, totalSupply);
      
      expect(result).not.toBeNull();
      expect(result!.sharePercent).toBe(0.01); // 10/100000 = 0.01%
    });

    test("whale position", () => {
      const position: RawPositionTuple = [
        parseEther("50000"),  // 50000 ETH shares
        parseEther("52000"),  // With profit
        parseEther("1000000"),// 1M tokens
        parseEther("1050000"),// With profit
        parseEther("500"),    // 500 ETH pending
      ];
      const totalSupply = parseEther("100000");
      
      const result = parseLPPosition(position, undefined, totalSupply);
      
      expect(result).not.toBeNull();
      expect(result!.sharePercent).toBe(50); // 50% of pool
    });

    test("initial LP (first depositor)", () => {
      const initialDeposit = parseEther("1000");
      const position: RawPositionTuple = [
        initialDeposit,
        initialDeposit,
        0n,
        0n,
        0n,
      ];
      // First depositor gets all the initial supply
      const result = parseLPPosition(position, undefined, initialDeposit);
      
      expect(result).not.toBeNull();
      expect(result!.sharePercent).toBe(100); // 100% owner
    });

    test("dust position", () => {
      // Very small position that might round to 0%
      const position: RawPositionTuple = [
        1n,  // 1 wei
        1n,
        0n,
        0n,
        0n,
      ];
      const totalSupply = parseEther("1000000"); // 1M ETH supply
      
      const result = parseLPPosition(position, undefined, totalSupply);
      
      expect(result).not.toBeNull();
      expect(result!.sharePercent).toBe(0); // Too small to register
    });
  });
});

describe("type safety", () => {
  test("LPPosition has all required fields", () => {
    const position: LPPosition = {
      ethShares: 1n,
      ethValue: 1n,
      tokenShares: 1n,
      tokenValue: 1n,
      pendingFees: 1n,
      lpTokenBalance: "0.000000000000000001",
      sharePercent: 0.01,
    };
    
    // Type check - all fields should be accessible
    expect(typeof position.ethShares).toBe("bigint");
    expect(typeof position.ethValue).toBe("bigint");
    expect(typeof position.tokenShares).toBe("bigint");
    expect(typeof position.tokenValue).toBe("bigint");
    expect(typeof position.pendingFees).toBe("bigint");
    expect(typeof position.lpTokenBalance).toBe("string");
    expect(typeof position.sharePercent).toBe("number");
  });

  test("RawPositionTuple has correct structure", () => {
    const tuple: RawPositionTuple = [1n, 2n, 3n, 4n, 5n];
    expect(tuple.length).toBe(5);
    expect(tuple[0]).toBe(1n);
    expect(tuple[4]).toBe(5n);
  });
});
