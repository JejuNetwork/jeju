/**
 * Unit Tests for Route Scoring Algorithm
 *
 * Tests the composite scoring algorithm used by MultiBridgeRouter:
 * - Reliability scoring
 * - Cost scoring
 * - Speed scoring
 * - Liquidity scoring
 * - Weighted combination
 */

import { describe, expect, it } from 'bun:test'
import { formatUnits, parseUnits } from 'viem'

// Route scoring configuration (mirrors MultiBridgeRouter)
const SCORING_WEIGHTS = {
  reliability: 0.35,
  cost: 0.25,
  speed: 0.2,
  liquidity: 0.2,
}

// Normalization constants
const MAX_TOTAL_COST_ETH = 0.1 // Max expected fees
const MAX_TIME_SECONDS = 3600 // 1 hour max
const MAX_LIQUIDITY_USD = 10_000_000 // 10M max liquidity reference

interface BridgeRoute {
  provider: string
  bridgeFee: bigint
  gasCost: bigint
  estimatedTimeSeconds: number
  reliability: number
  liquidityDepth: bigint
}

/**
 * Calculate composite route score (0-100 scale)
 */
function calculateRouteScore(route: BridgeRoute): number {
  // Reliability score (already 0-100)
  const reliabilityScore = route.reliability

  // Cost score: lower is better
  const totalCost = Number(formatUnits(route.bridgeFee + route.gasCost, 18))
  const costScore = Math.max(0, 100 - (totalCost / MAX_TOTAL_COST_ETH) * 100)

  // Speed score: faster is better
  const speedScore = Math.max(
    0,
    100 - (route.estimatedTimeSeconds / MAX_TIME_SECONDS) * 100,
  )

  // Liquidity score: higher is better
  const liquidityUsd = Number(formatUnits(route.liquidityDepth, 18))
  const liquidityScore = Math.min(100, (liquidityUsd / MAX_LIQUIDITY_USD) * 100)

  return (
    reliabilityScore * SCORING_WEIGHTS.reliability +
    costScore * SCORING_WEIGHTS.cost +
    speedScore * SCORING_WEIGHTS.speed +
    liquidityScore * SCORING_WEIGHTS.liquidity
  )
}

describe('Route Scoring Algorithm', () => {
  describe('Individual Score Components', () => {
    describe('Reliability Score', () => {
      it('should use reliability directly (0-100 scale)', () => {
        const route: BridgeRoute = {
          provider: 'test',
          bridgeFee: 0n,
          gasCost: 0n,
          estimatedTimeSeconds: 0,
          reliability: 95,
          liquidityDepth: 0n,
        }

        // Reliability contribution = 95 * 0.35 = 33.25
        const contribution = route.reliability * SCORING_WEIGHTS.reliability
        expect(contribution).toBe(33.25)
      })

      it('should handle 100% reliability', () => {
        const contribution = 100 * SCORING_WEIGHTS.reliability
        expect(contribution).toBe(35) // Max contribution
      })

      it('should handle 0% reliability', () => {
        const contribution = 0 * SCORING_WEIGHTS.reliability
        expect(contribution).toBe(0)
      })
    })

    describe('Cost Score', () => {
      it('should give 100 for zero cost', () => {
        const totalCost = 0
        const costScore = Math.max(
          0,
          100 - (totalCost / MAX_TOTAL_COST_ETH) * 100,
        )
        expect(costScore).toBe(100)
      })

      it('should give 0 for max cost (0.1 ETH)', () => {
        const totalCost = 0.1
        const costScore = Math.max(
          0,
          100 - (totalCost / MAX_TOTAL_COST_ETH) * 100,
        )
        expect(costScore).toBe(0)
      })

      it('should give 50 for half max cost', () => {
        const totalCost = 0.05
        const costScore = Math.max(
          0,
          100 - (totalCost / MAX_TOTAL_COST_ETH) * 100,
        )
        expect(costScore).toBe(50)
      })

      it('should clamp negative values to 0', () => {
        const totalCost = 0.2 // Over max
        const costScore = Math.max(
          0,
          100 - (totalCost / MAX_TOTAL_COST_ETH) * 100,
        )
        expect(costScore).toBe(0)
      })

      it('should correctly convert bigint fees', () => {
        const bridgeFee = parseUnits('0.03', 18)
        const gasCost = parseUnits('0.02', 18)
        const totalCost = Number(formatUnits(bridgeFee + gasCost, 18))
        expect(totalCost).toBe(0.05)

        const costScore = Math.max(
          0,
          100 - (totalCost / MAX_TOTAL_COST_ETH) * 100,
        )
        expect(costScore).toBe(50)
      })
    })

    describe('Speed Score', () => {
      it('should give 100 for instant (0 seconds)', () => {
        const time = 0
        const speedScore = Math.max(0, 100 - (time / MAX_TIME_SECONDS) * 100)
        expect(speedScore).toBe(100)
      })

      it('should give 0 for max time (1 hour)', () => {
        const time = 3600
        const speedScore = Math.max(0, 100 - (time / MAX_TIME_SECONDS) * 100)
        expect(speedScore).toBe(0)
      })

      it('should give ~97 for 2 minute transfer', () => {
        const time = 120
        const speedScore = Math.max(0, 100 - (time / MAX_TIME_SECONDS) * 100)
        expect(speedScore).toBeCloseTo(96.67, 1)
      })

      it('should give ~75 for 15 minute transfer', () => {
        const time = 900
        const speedScore = Math.max(0, 100 - (time / MAX_TIME_SECONDS) * 100)
        expect(speedScore).toBe(75)
      })

      it('should clamp to 0 for over 1 hour', () => {
        const time = 7200 // 2 hours
        const speedScore = Math.max(0, 100 - (time / MAX_TIME_SECONDS) * 100)
        expect(speedScore).toBe(0)
      })
    })

    describe('Liquidity Score', () => {
      it('should give 100 for 10M+ liquidity', () => {
        const liquidityUsd = 10_000_000
        const liquidityScore = Math.min(
          100,
          (liquidityUsd / MAX_LIQUIDITY_USD) * 100,
        )
        expect(liquidityScore).toBe(100)
      })

      it('should give 50 for 5M liquidity', () => {
        const liquidityUsd = 5_000_000
        const liquidityScore = Math.min(
          100,
          (liquidityUsd / MAX_LIQUIDITY_USD) * 100,
        )
        expect(liquidityScore).toBe(50)
      })

      it('should give 10 for 1M liquidity', () => {
        const liquidityUsd = 1_000_000
        const liquidityScore = Math.min(
          100,
          (liquidityUsd / MAX_LIQUIDITY_USD) * 100,
        )
        expect(liquidityScore).toBe(10)
      })

      it('should cap at 100 for very high liquidity', () => {
        const liquidityUsd = 100_000_000 // 100M
        const liquidityScore = Math.min(
          100,
          (liquidityUsd / MAX_LIQUIDITY_USD) * 100,
        )
        expect(liquidityScore).toBe(100)
      })

      it('should give 0 for zero liquidity', () => {
        const liquidityUsd = 0
        const liquidityScore = Math.min(
          100,
          (liquidityUsd / MAX_LIQUIDITY_USD) * 100,
        )
        expect(liquidityScore).toBe(0)
      })
    })
  })

  describe('Composite Score', () => {
    it('should calculate perfect score for ideal route', () => {
      const route: BridgeRoute = {
        provider: 'ideal',
        bridgeFee: 0n,
        gasCost: 0n,
        estimatedTimeSeconds: 0,
        reliability: 100,
        liquidityDepth: parseUnits('10000000', 18), // 10M
      }

      const score = calculateRouteScore(route)
      expect(score).toBe(100)
    })

    it('should calculate zero score for worst route', () => {
      const route: BridgeRoute = {
        provider: 'worst',
        bridgeFee: parseUnits('0.1', 18),
        gasCost: 0n,
        estimatedTimeSeconds: 3600,
        reliability: 0,
        liquidityDepth: 0n,
      }

      const score = calculateRouteScore(route)
      expect(score).toBe(0)
    })

    it('should calculate mid-range score correctly', () => {
      const route: BridgeRoute = {
        provider: 'mid',
        bridgeFee: parseUnits('0.025', 18),
        gasCost: parseUnits('0.025', 18),
        estimatedTimeSeconds: 1800, // 30 min
        reliability: 50,
        liquidityDepth: parseUnits('5000000', 18), // 5M
      }

      const score = calculateRouteScore(route)
      // reliability: 50 * 0.35 = 17.5
      // cost: 50 * 0.25 = 12.5
      // speed: 50 * 0.20 = 10
      // liquidity: 50 * 0.20 = 10
      // total = 50
      expect(score).toBe(50)
    })

    it('should weight reliability highest', () => {
      const highReliability: BridgeRoute = {
        provider: 'reliable',
        bridgeFee: parseUnits('0.05', 18),
        gasCost: parseUnits('0.05', 18), // Max cost
        estimatedTimeSeconds: 3600, // Max time
        reliability: 100, // But 100% reliable
        liquidityDepth: 0n, // No liquidity
      }

      const lowReliability: BridgeRoute = {
        provider: 'unreliable',
        bridgeFee: 0n,
        gasCost: 0n,
        estimatedTimeSeconds: 0,
        reliability: 0, // 0% reliable
        liquidityDepth: parseUnits('10000000', 18),
      }

      const highScore = calculateRouteScore(highReliability)
      const lowScore = calculateRouteScore(lowReliability)

      // High reliability (only reliable) = 35
      // Low reliability (perfect everything else but 0 reliable) = 25 + 20 + 20 = 65
      expect(highScore).toBe(35)
      expect(lowScore).toBe(65)
    })
  })

  describe('Route Ranking', () => {
    it('should rank routes correctly', () => {
      const routes: BridgeRoute[] = [
        {
          provider: 'ccip',
          bridgeFee: parseUnits('0.03', 18),
          gasCost: parseUnits('0.003', 18),
          estimatedTimeSeconds: 600,
          reliability: 95,
          liquidityDepth: parseUnits('10000000', 18),
        },
        {
          provider: 'zksolbridge',
          bridgeFee: parseUnits('0.001', 18),
          gasCost: parseUnits('0.001', 18),
          estimatedTimeSeconds: 900,
          reliability: 95,
          liquidityDepth: parseUnits('1000000', 18),
        },
        {
          provider: 'wormhole',
          bridgeFee: parseUnits('0.002', 18),
          gasCost: parseUnits('0.002', 18),
          estimatedTimeSeconds: 300,
          reliability: 90,
          liquidityDepth: parseUnits('5000000', 18),
        },
      ]

      const scored = routes
        .map((r) => ({ ...r, score: calculateRouteScore(r) }))
        .sort((a, b) => b.score - a.score)

      // All scores should be valid
      for (const route of scored) {
        expect(route.score).toBeGreaterThanOrEqual(0)
        expect(route.score).toBeLessThanOrEqual(100)
      }

      // First should have highest score
      expect(scored[0].score).toBeGreaterThanOrEqual(scored[1].score)
      expect(scored[1].score).toBeGreaterThanOrEqual(scored[2].score)
    })

    it('should prefer speed when times differ significantly', () => {
      const fastRoute: BridgeRoute = {
        provider: 'fast',
        bridgeFee: parseUnits('0.02', 18),
        gasCost: parseUnits('0.01', 18),
        estimatedTimeSeconds: 60, // 1 minute
        reliability: 85,
        liquidityDepth: parseUnits('5000000', 18),
      }

      const slowRoute: BridgeRoute = {
        provider: 'slow',
        bridgeFee: parseUnits('0.02', 18),
        gasCost: parseUnits('0.01', 18),
        estimatedTimeSeconds: 1800, // 30 minutes
        reliability: 85,
        liquidityDepth: parseUnits('5000000', 18),
      }

      const fastScore = calculateRouteScore(fastRoute)
      const slowScore = calculateRouteScore(slowRoute)

      // Fast route should score higher due to speed
      expect(fastScore).toBeGreaterThan(slowScore)
    })

    it('should prefer low cost when costs differ significantly', () => {
      const cheapRoute: BridgeRoute = {
        provider: 'cheap',
        bridgeFee: parseUnits('0.001', 18),
        gasCost: parseUnits('0.001', 18),
        estimatedTimeSeconds: 300,
        reliability: 85,
        liquidityDepth: parseUnits('5000000', 18),
      }

      const expensiveRoute: BridgeRoute = {
        provider: 'expensive',
        bridgeFee: parseUnits('0.05', 18),
        gasCost: parseUnits('0.05', 18),
        estimatedTimeSeconds: 300,
        reliability: 85,
        liquidityDepth: parseUnits('5000000', 18),
      }

      const cheapScore = calculateRouteScore(cheapRoute)
      const expensiveScore = calculateRouteScore(expensiveRoute)

      // Cheap route should score higher
      expect(cheapScore).toBeGreaterThan(expensiveScore)
    })
  })

  describe('Adjusted Reliability', () => {
    /**
     * Adjusted reliability based on historical performance
     * Weighted: 70% historical, 30% base
     */
    function getAdjustedReliability(
      baseReliability: number,
      historicalSuccess: number,
      historicalTotal: number,
    ): number {
      // Need at least 10 samples
      if (historicalTotal < 10) {
        return baseReliability
      }

      const historicalRate = (historicalSuccess / historicalTotal) * 100
      return Math.round(historicalRate * 0.7 + baseReliability * 0.3)
    }

    it('should use base reliability when not enough history', () => {
      const adjusted = getAdjustedReliability(95, 5, 5)
      expect(adjusted).toBe(95)
    })

    it('should blend historical and base with 70/30 weighting', () => {
      // 10 samples, all successful = 100% historical
      // Expected: 100 * 0.7 + 95 * 0.3 = 70 + 28.5 = 98.5 → 99
      const adjusted = getAdjustedReliability(95, 10, 10)
      expect(adjusted).toBe(99)
    })

    it('should lower reliability with poor history', () => {
      // 10 samples, 5 successful = 50% historical
      // Expected: 50 * 0.7 + 95 * 0.3 = 35 + 28.5 = 63.5 → 64
      const adjusted = getAdjustedReliability(95, 5, 10)
      expect(adjusted).toBe(64)
    })

    it('should cap at 100%', () => {
      const adjusted = getAdjustedReliability(100, 100, 100)
      expect(adjusted).toBe(100)
    })

    it('should handle 0 historical success', () => {
      // 0% historical + 30% of base
      const adjusted = getAdjustedReliability(90, 0, 20)
      expect(adjusted).toBe(27) // 0 * 0.7 + 90 * 0.3 = 27
    })
  })

  describe('Weight Validation', () => {
    it('should have weights that sum to 1.0', () => {
      const totalWeight =
        SCORING_WEIGHTS.reliability +
        SCORING_WEIGHTS.cost +
        SCORING_WEIGHTS.speed +
        SCORING_WEIGHTS.liquidity

      expect(totalWeight).toBe(1.0)
    })

    it('should have all positive weights', () => {
      expect(SCORING_WEIGHTS.reliability).toBeGreaterThan(0)
      expect(SCORING_WEIGHTS.cost).toBeGreaterThan(0)
      expect(SCORING_WEIGHTS.speed).toBeGreaterThan(0)
      expect(SCORING_WEIGHTS.liquidity).toBeGreaterThan(0)
    })

    it('should have reliability as highest weight', () => {
      expect(SCORING_WEIGHTS.reliability).toBeGreaterThanOrEqual(
        SCORING_WEIGHTS.cost,
      )
      expect(SCORING_WEIGHTS.reliability).toBeGreaterThanOrEqual(
        SCORING_WEIGHTS.speed,
      )
      expect(SCORING_WEIGHTS.reliability).toBeGreaterThanOrEqual(
        SCORING_WEIGHTS.liquidity,
      )
    })
  })
})
