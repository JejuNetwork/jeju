/**
 * Unit tests for launchpad formatting functions
 * Tests bonding curve and ICO presale formatters
 */

import { describe, test, expect } from 'bun:test';
import { formatBondingCurvePrice, formatProgress } from '../useBondingCurve';
import { formatPresaleProgress, formatTimeRemaining } from '../useICOPresale';

// =============================================================================
// BONDING CURVE PRICE FORMATTING TESTS
// =============================================================================

describe('formatBondingCurvePrice', () => {
  test('should format normal ETH prices', () => {
    // Price in wei (18 decimals)
    const price = 100000000000000n; // 0.0001 ETH
    const result = formatBondingCurvePrice(price);

    expect(result).toBe('0.00010000');
  });

  test('should format very small prices in exponential notation', () => {
    const price = 100000000000n; // 0.0000001 ETH (< 0.000001)
    const result = formatBondingCurvePrice(price);

    // Should be in exponential notation
    expect(result).toMatch(/^[\d.]+e-\d+$/);
  });

  test('should format larger prices', () => {
    const price = 1000000000000000000n; // 1 ETH
    const result = formatBondingCurvePrice(price);

    expect(result).toBe('1.00000000');
  });

  test('should handle boundary case at 0.000001 ETH', () => {
    const justAbove = 1000000000001n; // Just above 0.000001
    const justBelow = 999999999999n; // Just below 0.000001

    const aboveResult = formatBondingCurvePrice(justAbove);
    const belowResult = formatBondingCurvePrice(justBelow);

    // Just above should be fixed notation
    expect(aboveResult).not.toMatch(/e/);
    // Just below should be exponential
    expect(belowResult).toMatch(/e/);
  });

  test('should format zero price', () => {
    const price = 0n;
    const result = formatBondingCurvePrice(price);

    // Zero formats as exponential notation since 0 < 0.000001
    expect(result).toMatch(/0.*e/);
  });

  test('should handle wei precision', () => {
    const price = 123456789012345678n; // ~0.123456... ETH
    const result = formatBondingCurvePrice(price);

    // Should have 8 decimal places
    expect(result).toMatch(/^\d+\.\d{8}$/);
  });
});

// =============================================================================
// BONDING CURVE PROGRESS FORMATTING TESTS
// =============================================================================

describe('formatProgress (bonding curve)', () => {
  test('should format 0% progress', () => {
    expect(formatProgress(0)).toBe('0.00%');
  });

  test('should format 100% progress', () => {
    expect(formatProgress(10000)).toBe('100.00%');
  });

  test('should format 50% progress', () => {
    expect(formatProgress(5000)).toBe('50.00%');
  });

  test('should handle fractional progress', () => {
    // 12.34% = 1234 basis points
    expect(formatProgress(1234)).toBe('12.34%');
  });

  test('should handle minimal progress', () => {
    // 0.01% = 1 basis point
    expect(formatProgress(1)).toBe('0.01%');
  });

  test('should handle over 100% (if applicable)', () => {
    // Some bonding curves might allow > 100%
    expect(formatProgress(15000)).toBe('150.00%');
  });
});

// =============================================================================
// PRESALE PROGRESS FORMATTING TESTS
// =============================================================================

describe('formatPresaleProgress', () => {
  test('should format 0% progress', () => {
    expect(formatPresaleProgress(0)).toBe('0.00%');
  });

  test('should format 100% progress', () => {
    expect(formatPresaleProgress(10000)).toBe('100.00%');
  });

  test('should format 50% progress', () => {
    expect(formatPresaleProgress(5000)).toBe('50.00%');
  });

  test('should handle fractional progress', () => {
    expect(formatPresaleProgress(3333)).toBe('33.33%');
  });

  test('should handle single basis point', () => {
    expect(formatPresaleProgress(1)).toBe('0.01%');
  });
});

// =============================================================================
// TIME REMAINING FORMATTING TESTS
// =============================================================================

describe('formatTimeRemaining', () => {
  test('should return "Ended" for 0 seconds', () => {
    expect(formatTimeRemaining(0n)).toBe('Ended');
  });

  test('should return "Ended" for negative seconds', () => {
    expect(formatTimeRemaining(-100n)).toBe('Ended');
  });

  test('should format minutes only', () => {
    const thirtyMins = 30n * 60n;
    expect(formatTimeRemaining(thirtyMins)).toBe('30m');
  });

  test('should format hours and minutes', () => {
    const twoHoursThirtyMins = 2n * 60n * 60n + 30n * 60n;
    expect(formatTimeRemaining(twoHoursThirtyMins)).toBe('2h 30m');
  });

  test('should format days and hours', () => {
    const threeDaysFiveHours = 3n * 24n * 60n * 60n + 5n * 60n * 60n;
    expect(formatTimeRemaining(threeDaysFiveHours)).toBe('3d 5h');
  });

  test('should format exactly 1 day', () => {
    const oneDay = 24n * 60n * 60n;
    expect(formatTimeRemaining(oneDay)).toBe('1d 0h');
  });

  test('should format exactly 1 hour', () => {
    const oneHour = 60n * 60n;
    expect(formatTimeRemaining(oneHour)).toBe('1h 0m');
  });

  test('should format 59 minutes', () => {
    const fiftyNineMins = 59n * 60n;
    expect(formatTimeRemaining(fiftyNineMins)).toBe('59m');
  });

  test('should format 1 minute', () => {
    const oneMin = 60n;
    expect(formatTimeRemaining(oneMin)).toBe('1m');
  });

  test('should handle large durations (30 days)', () => {
    const thirtyDays = 30n * 24n * 60n * 60n;
    expect(formatTimeRemaining(thirtyDays)).toBe('30d 0h');
  });

  test('should round down seconds to minutes', () => {
    const oneMinThirtySec = 90n;
    expect(formatTimeRemaining(oneMinThirtySec)).toBe('1m');
  });

  test('should handle seconds less than a minute', () => {
    const fiftySec = 50n;
    expect(formatTimeRemaining(fiftySec)).toBe('0m');
  });
});

// =============================================================================
// PROPERTY-BASED TESTS
// =============================================================================

describe('Property-based tests for formatters', () => {
  test('formatProgress should always return a string ending with %', () => {
    const testValues = [0, 1, 100, 500, 1000, 5000, 10000, 15000];

    for (const val of testValues) {
      const result = formatProgress(val);
      expect(result.endsWith('%')).toBe(true);
    }
  });

  test('formatPresaleProgress should always return a string ending with %', () => {
    const testValues = [0, 1, 100, 500, 1000, 5000, 10000];

    for (const val of testValues) {
      const result = formatPresaleProgress(val);
      expect(result.endsWith('%')).toBe(true);
    }
  });

  test('formatTimeRemaining should never return empty string', () => {
    const testDurations = [0n, 1n, 60n, 3600n, 86400n, 604800n];

    for (const duration of testDurations) {
      const result = formatTimeRemaining(duration);
      expect(result.length).toBeGreaterThan(0);
    }
  });

  test('formatBondingCurvePrice should always return a numeric string', () => {
    const testPrices = [
      0n,
      1n,
      1000000000000n,
      1000000000000000n,
      1000000000000000000n,
    ];

    for (const price of testPrices) {
      const result = formatBondingCurvePrice(price);
      // Should be parseable as a number
      expect(Number.isNaN(parseFloat(result))).toBe(false);
    }
  });
});

// =============================================================================
// CONSISTENCY TESTS
// =============================================================================

describe('Consistency tests', () => {
  test('formatProgress and formatPresaleProgress should give same results', () => {
    // Both functions do the same conversion
    const testValues = [0, 100, 1000, 5000, 10000];

    for (const val of testValues) {
      expect(formatProgress(val)).toBe(formatPresaleProgress(val));
    }
  });

  test('formatBondingCurvePrice should be idempotent', () => {
    const prices = [
      100000000000000n,
      1000000000000000000n,
      100000000000n,
    ];

    for (const price of prices) {
      const result1 = formatBondingCurvePrice(price);
      const result2 = formatBondingCurvePrice(price);
      expect(result1).toBe(result2);
    }
  });

  test('formatTimeRemaining should be monotonic in display format', () => {
    // Longer durations should result in larger units
    const short = 59n; // < 1 min
    const medium = 3500n; // ~58 min
    const long = 7200n; // 2 hours
    const veryLong = 172800n; // 2 days

    const shortResult = formatTimeRemaining(short);
    const mediumResult = formatTimeRemaining(medium);
    const longResult = formatTimeRemaining(long);
    const veryLongResult = formatTimeRemaining(veryLong);

    // Short durations use 'm', longer use 'h', longest use 'd'
    expect(shortResult.includes('m')).toBe(true);
    expect(mediumResult.includes('m')).toBe(true);
    expect(longResult.includes('h')).toBe(true);
    expect(veryLongResult.includes('d')).toBe(true);
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Edge cases', () => {
  test('formatBondingCurvePrice handles maximum BigInt', () => {
    const maxPrice = 10n ** 36n; // 10^18 ETH
    const result = formatBondingCurvePrice(maxPrice);

    // Should not throw
    expect(typeof result).toBe('string');
  });

  test('formatTimeRemaining handles very large durations', () => {
    const yearInSeconds = 365n * 24n * 60n * 60n;
    const result = formatTimeRemaining(yearInSeconds);

    expect(result.includes('d')).toBe(true);
    expect(result).toBe('365d 0h');
  });

  test('formatProgress handles maximum basis points', () => {
    const result = formatProgress(10000);
    expect(result).toBe('100.00%');
  });
});
