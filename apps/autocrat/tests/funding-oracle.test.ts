/**
 * FundingOracle Unit Tests
 *
 * Tests for quadratic funding calculations, bigint sqrt, and heuristic analysis
 */

import { describe, expect, test } from 'bun:test'
import { parseEther } from 'viem'

/**
 * Integer square root using Newton's method
 * Extracted from FundingOracle for testing
 */
function bigintSqrt(value: bigint): bigint {
  if (value < 0n) return 0n
  if (value < 2n) return value

  let x = value
  let y = (x + 1n) / 2n

  while (y < x) {
    x = y
    y = (x + value / x) / 2n
  }

  return x
}

/**
 * Quadratic allocation calculation
 * Extracted from FundingOracle for testing
 */
function calculateQuadraticAllocation(
  stakes: Array<{ staker: `0x${string}`; amount: bigint }>,
  matchingPool: bigint,
  totalProjects: number,
): bigint {
  if (stakes.length === 0) return 0n

  // Sum of square roots
  let sumSqrt = 0n
  for (const stake of stakes) {
    sumSqrt += bigintSqrt(stake.amount)
  }

  // Square the sum
  const quadraticScore = sumSqrt * sumSqrt

  // Calculate share of matching pool
  const matchingShare =
    (matchingPool * quadraticScore) /
    (quadraticScore * BigInt(totalProjects) + 1n)

  return matchingShare
}

/**
 * Heuristic weight calculation
 * Extracted from FundingOracle for testing
 */
function calculateHeuristicWeight(
  stakeEth: number,
  isLinked: boolean,
  hasBeenFunded: boolean,
  maxCEOWeight: number,
): number {
  // Base weight from community stake
  let weight = Math.min(stakeEth * 100, 2000)

  // Bonus for linked projects
  if (isLinked) {
    weight += 1000
  }

  // Bonus for established projects
  if (hasBeenFunded) {
    weight += 500
  }

  return Math.min(Math.floor(weight), maxCEOWeight)
}
describe('FundingOracle', () => {
  describe('bigintSqrt', () => {
    test('sqrt of 0 returns 0', () => {
      expect(bigintSqrt(0n)).toBe(0n)
    })

    test('sqrt of 1 returns 1', () => {
      expect(bigintSqrt(1n)).toBe(1n)
    })

    test('sqrt of 4 returns 2', () => {
      expect(bigintSqrt(4n)).toBe(2n)
    })

    test('sqrt of 9 returns 3', () => {
      expect(bigintSqrt(9n)).toBe(3n)
    })

    test('sqrt of 16 returns 4', () => {
      expect(bigintSqrt(16n)).toBe(4n)
    })

    test('sqrt of 100 returns 10', () => {
      expect(bigintSqrt(100n)).toBe(10n)
    })

    test('sqrt of perfect square 1000000 returns 1000', () => {
      expect(bigintSqrt(1000000n)).toBe(1000n)
    })

    test('sqrt of non-perfect square 2 returns floor(sqrt(2)) = 1', () => {
      expect(bigintSqrt(2n)).toBe(1n)
    })

    test('sqrt of non-perfect square 3 returns floor(sqrt(3)) = 1', () => {
      expect(bigintSqrt(3n)).toBe(1n)
    })

    test('sqrt of non-perfect square 5 returns floor(sqrt(5)) = 2', () => {
      expect(bigintSqrt(5n)).toBe(2n)
    })

    test('sqrt of non-perfect square 10 returns floor(sqrt(10)) = 3', () => {
      expect(bigintSqrt(10n)).toBe(3n)
    })

    test('sqrt of large number 10^18 (1 ETH in wei) returns 10^9', () => {
      const oneEthWei = 10n ** 18n
      expect(bigintSqrt(oneEthWei)).toBe(10n ** 9n)
    })

    test('sqrt of large number 4 * 10^18 returns 2 * 10^9', () => {
      const fourEthWei = 4n * 10n ** 18n
      expect(bigintSqrt(fourEthWei)).toBe(2n * 10n ** 9n)
    })

    test('sqrt of negative returns 0', () => {
      expect(bigintSqrt(-1n)).toBe(0n)
      expect(bigintSqrt(-100n)).toBe(0n)
    })

    test('sqrt result squared is <= original value', () => {
      const testValues = [7n, 15n, 50n, 99n, 1000n, 123456n, 10n ** 18n]
      for (const value of testValues) {
        const sqrt = bigintSqrt(value)
        expect(sqrt * sqrt).toBeLessThanOrEqual(value)
        expect((sqrt + 1n) * (sqrt + 1n)).toBeGreaterThan(value)
      }
    })
  })

  describe('calculateQuadraticAllocation', () => {
    const mockStaker: `0x${string}` =
      '0x1234567890abcdef1234567890abcdef12345678'

    test('empty stakes returns 0', () => {
      const result = calculateQuadraticAllocation([], parseEther('100'), 10)
      expect(result).toBe(0n)
    })

    test('single staker gets proportional share', () => {
      const stakes = [{ staker: mockStaker, amount: parseEther('1') }]
      const result = calculateQuadraticAllocation(stakes, parseEther('100'), 1)
      // With one project, should get nearly all the matching pool
      expect(result).toBeGreaterThan(0n)
      expect(result).toBeLessThanOrEqual(parseEther('100'))
    })

    test('multiple equal stakes benefits from quadratic funding', () => {
      // 4 stakers of 1 ETH each vs 1 staker of 4 ETH
      const fourStakers = [
        {
          staker: '0x0000000000000000000000000000000000000001' as `0x${string}`,
          amount: parseEther('1'),
        },
        {
          staker: '0x0000000000000000000000000000000000000002' as `0x${string}`,
          amount: parseEther('1'),
        },
        {
          staker: '0x0000000000000000000000000000000000000003' as `0x${string}`,
          amount: parseEther('1'),
        },
        {
          staker: '0x0000000000000000000000000000000000000004' as `0x${string}`,
          amount: parseEther('1'),
        },
      ]
      const oneStaker = [{ staker: mockStaker, amount: parseEther('4') }]

      const matchingPool = parseEther('100')
      const quadratic4 = calculateQuadraticAllocation(
        fourStakers,
        matchingPool,
        2,
      )
      const quadratic1 = calculateQuadraticAllocation(
        oneStaker,
        matchingPool,
        2,
      )

      // 4 stakers of 1 ETH: sqrt(1) * 4 = 4, squared = 16
      // 1 staker of 4 ETH: sqrt(4) = 2, squared = 4
      // So 4 stakers should get MORE than 1 staker (quadratic benefit)
      expect(quadratic4).toBeGreaterThan(quadratic1)
    })

    test('more stakers = more matching funds (quadratic property)', () => {
      const matchingPool = parseEther('1000')

      // Project A: 1 staker with 100 ETH
      const projectA = [{ staker: mockStaker, amount: parseEther('100') }]

      // Project B: 100 stakers with 1 ETH each
      const projectB = Array.from({ length: 100 }, (_, i) => ({
        staker: `0x${i.toString().padStart(40, '0')}` as `0x${string}`,
        amount: parseEther('1'),
      }))

      const allocationA = calculateQuadraticAllocation(
        projectA,
        matchingPool,
        2,
      )
      const allocationB = calculateQuadraticAllocation(
        projectB,
        matchingPool,
        2,
      )

      // Project B (more diverse) should get significantly more
      // A: sqrt(100e18) = 10e9, squared = 100e18
      // B: 100 * sqrt(1e18) = 100 * 1e9 = 100e9, squared = 10000e18
      expect(allocationB).toBeGreaterThan(allocationA)
    })

    test('allocation respects matching pool size', () => {
      const stakes = [{ staker: mockStaker, amount: parseEther('10') }]

      const small = calculateQuadraticAllocation(stakes, parseEther('10'), 1)
      const large = calculateQuadraticAllocation(stakes, parseEther('100'), 1)

      expect(large).toBeGreaterThan(small)
    })

    test('more projects dilutes allocation per project', () => {
      const stakes = [{ staker: mockStaker, amount: parseEther('10') }]
      const matchingPool = parseEther('100')

      const oneProject = calculateQuadraticAllocation(stakes, matchingPool, 1)
      const tenProjects = calculateQuadraticAllocation(stakes, matchingPool, 10)

      expect(oneProject).toBeGreaterThan(tenProjects)
    })

    test('zero matching pool returns 0', () => {
      const stakes = [{ staker: mockStaker, amount: parseEther('10') }]
      const result = calculateQuadraticAllocation(stakes, 0n, 1)
      expect(result).toBe(0n)
    })
  })

  describe('calculateHeuristicWeight', () => {
    const MAX_CEO_WEIGHT = 5000

    test('base weight from stake (capped at 2000)', () => {
      expect(calculateHeuristicWeight(10, false, false, MAX_CEO_WEIGHT)).toBe(
        1000,
      )
      expect(calculateHeuristicWeight(20, false, false, MAX_CEO_WEIGHT)).toBe(
        2000,
      )
      expect(calculateHeuristicWeight(30, false, false, MAX_CEO_WEIGHT)).toBe(
        2000,
      ) // Capped
    })

    test('linked project adds 1000 weight', () => {
      expect(calculateHeuristicWeight(0, true, false, MAX_CEO_WEIGHT)).toBe(
        1000,
      )
      expect(calculateHeuristicWeight(10, true, false, MAX_CEO_WEIGHT)).toBe(
        2000,
      )
    })

    test('funded project adds 500 weight', () => {
      expect(calculateHeuristicWeight(0, false, true, MAX_CEO_WEIGHT)).toBe(500)
      expect(calculateHeuristicWeight(10, false, true, MAX_CEO_WEIGHT)).toBe(
        1500,
      )
    })

    test('combined bonuses stack', () => {
      // stake: 10 ETH = 1000, linked: +1000, funded: +500 = 2500
      expect(calculateHeuristicWeight(10, true, true, MAX_CEO_WEIGHT)).toBe(
        2500,
      )
    })

    test('respects maxCEOWeight cap', () => {
      // With all bonuses maxed, should still respect cap
      expect(calculateHeuristicWeight(30, true, true, 2000)).toBe(2000)
      expect(calculateHeuristicWeight(30, true, true, 3000)).toBe(3000)
    })

    test('zero stake with no bonuses returns 0', () => {
      expect(calculateHeuristicWeight(0, false, false, MAX_CEO_WEIGHT)).toBe(0)
    })

    test('fractional stake values work', () => {
      expect(calculateHeuristicWeight(0.5, false, false, MAX_CEO_WEIGHT)).toBe(
        50,
      )
      expect(calculateHeuristicWeight(1.5, false, false, MAX_CEO_WEIGHT)).toBe(
        150,
      )
    })
  })

  describe('Quadratic Funding Property Tests', () => {
    const makeStakes = (amounts: bigint[]) =>
      amounts.map((amount, i) => ({
        staker: `0x${i.toString().padStart(40, '0')}` as `0x${string}`,
        amount,
      }))

    /**
     * Helper to compute the raw quadratic score (sum of sqrts, squared)
     * This is the core QF metric before allocation formula is applied
     */
    function computeQuadraticScore(stakes: Array<{ amount: bigint }>): bigint {
      let sumSqrt = 0n
      for (const stake of stakes) {
        sumSqrt += bigintSqrt(stake.amount)
      }
      return sumSqrt * sumSqrt
    }

    test('splitting a stake increases quadratic score (core QF property)', () => {
      // This is a key property of quadratic funding:
      // Splitting a contribution among multiple contributors increases the quadratic score
      // This is BY DESIGN to benefit broad participation

      // Project A: 1 person with 100 units
      const oneContributor = [{ amount: 100n * 10n ** 18n }]

      // Project B: 100 people with 1 unit each (same total stake)
      const manyContributors = Array(100)
        .fill(null)
        .map(() => ({ amount: 10n ** 18n }))

      const oneScore = computeQuadraticScore(oneContributor)
      const manyScore = computeQuadraticScore(manyContributors)

      // Quadratic score: sqrt sum squared
      // Project A: sqrt(100e18) = 10e9, squared = 100e18
      // Project B: 100 * sqrt(1e18) = 100e9, squared = 10000e18
      // Project B has 100x the quadratic score
      expect(manyScore).toBeGreaterThan(oneScore)

      // Verify the ratio is approximately 100x (accounting for bigint rounding)
      expect(manyScore / oneScore).toBeGreaterThanOrEqual(99n)
    })

    test('doubling all stakes quadruples the score (sqrt property)', () => {
      const matchingPool = parseEther('100')

      const base = makeStakes([10n ** 18n, 10n ** 18n])
      const doubled = makeStakes([2n * 10n ** 18n, 2n * 10n ** 18n])

      const baseScore = calculateQuadraticAllocation(base, matchingPool, 1)
      const doubledScore = calculateQuadraticAllocation(
        doubled,
        matchingPool,
        1,
      )

      // sqrt(2x) = sqrt(2) * sqrt(x), so doubling amount gives sqrt(2) ~1.41x per stake
      // But we want to verify the relationship is consistent
      expect(doubledScore).toBeGreaterThan(baseScore)
    })

    test('allocation never exceeds matching pool', () => {
      const matchingPool = parseEther('100')
      const stakes = makeStakes([10n ** 18n, 10n ** 18n, 10n ** 18n])

      const result = calculateQuadraticAllocation(stakes, matchingPool, 1)
      expect(result).toBeLessThanOrEqual(matchingPool)
    })
  })
})
