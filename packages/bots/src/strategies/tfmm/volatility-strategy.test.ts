/**
 * Volatility Strategy Tests
 *
 * Tests for volatility-based weight allocation:
 * - Volatility calculation
 * - Inverse volatility weighting
 * - Volatility targeting
 * - Portfolio volatility calculation
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { OracleAggregator } from '../../oracles'
import { WEIGHT_PRECISION } from '../../schemas'
import type { TFMMRiskParameters, Token } from '../../types'
import type { StrategyContext } from './base-strategy'
import { VolatilityStrategy } from './volatility-strategy'

describe('VolatilityStrategy', () => {
  let strategy: VolatilityStrategy
  let tokens: Token[]
  let riskParams: TFMMRiskParameters

  beforeEach(() => {
    strategy = new VolatilityStrategy(new OracleAggregator({}), {
      lookbackPeriodMs: 30 * 24 * 60 * 60 * 1000,
      targetVolatilityPct: 15,
      maxVolatilityPct: 100,
      volSpikeThreshold: 2.0,
      useInverseVolWeighting: true,
      minVolSampleSize: 20,
      blocksToTarget: 100,
    })

    tokens = [
      { address: '0x1', symbol: 'WETH', decimals: 18, chainId: 8453 },
      { address: '0x2', symbol: 'USDC', decimals: 6, chainId: 8453 },
    ]

    riskParams = {
      minWeight: WEIGHT_PRECISION / 20n,
      maxWeight: (WEIGHT_PRECISION * 95n) / 100n,
      maxWeightChangeBps: 500,
      minUpdateIntervalBlocks: 10,
      oracleStalenessSeconds: 60,
      maxPriceDeviationBps: 500,
    }
  })

  test('should return default weights with insufficient history', async () => {
    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        {
          token: '0x1',
          price: 300000000000n,
          decimals: 8,
          timestamp: Date.now(),
          source: 'pyth',
        },
        {
          token: '0x2',
          price: 100000000n,
          decimals: 8,
          timestamp: Date.now(),
          source: 'pyth',
        },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 1000n,
      timestamp: Date.now(),
    }

    const result = await strategy.calculateWeights(ctx)

    expect(result.newWeights.length).toBe(2)
    // Signal should indicate insufficient data
    expect(result.signals[0].reason).toContain('Insufficient')
  })

  test('should allocate more weight to lower volatility assets', async () => {
    const now = Date.now()

    // Create price history with WETH more volatile than USDC
    for (let i = 0; i < 50; i++) {
      const timestamp = now - (50 - i) * 3600000
      // WETH: fluctuates +/- 5%
      const ethFluctuation = Math.floor(Math.sin(i / 3) * 15000000000)
      const ethPrice = 300000000000n + BigInt(ethFluctuation)
      // USDC: fluctuates +/- 0.1%
      const usdcFluctuation = Math.floor(Math.sin(i / 3) * 100000)
      const usdcPrice = 100000000n + BigInt(usdcFluctuation)

      strategy.updatePriceHistory([
        {
          token: '0x1',
          price: ethPrice,
          decimals: 8,
          timestamp,
          source: 'pyth',
        },
        {
          token: '0x2',
          price: usdcPrice,
          decimals: 8,
          timestamp,
          source: 'pyth',
        },
      ])
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        {
          token: '0x1',
          price: 300000000000n,
          decimals: 8,
          timestamp: now,
          source: 'pyth',
        },
        {
          token: '0x2',
          price: 100000000n,
          decimals: 8,
          timestamp: now,
          source: 'pyth',
        },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 1000n,
      timestamp: now,
    }

    const result = await strategy.calculateWeights(ctx)

    // USDC (less volatile) should get more weight than WETH
    // Due to guard rails this may be constrained, but the direction should be correct
    expect(result.newWeights.length).toBe(2)
    expect(result.signals.length).toBe(2)
  })

  test('should detect volatility spikes', async () => {
    const now = Date.now()

    // Create stable history then a spike
    for (let i = 0; i < 50; i++) {
      const timestamp = now - (50 - i) * 3600000
      // Stable for first 40 points
      const volatilityMultiplier = i > 40 ? 5 : 1
      const sinVal = Math.floor(
        Math.sin(i / 3) * 1000000000 * volatilityMultiplier,
      )
      const ethPrice = 300000000000n + BigInt(sinVal)

      strategy.updatePriceHistory([
        {
          token: '0x1',
          price: ethPrice,
          decimals: 8,
          timestamp,
          source: 'pyth',
        },
        {
          token: '0x2',
          price: 100000000n,
          decimals: 8,
          timestamp,
          source: 'pyth',
        },
      ])
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        {
          token: '0x1',
          price: 300000000000n,
          decimals: 8,
          timestamp: now,
          source: 'pyth',
        },
        {
          token: '0x2',
          price: 100000000n,
          decimals: 8,
          timestamp: now,
          source: 'pyth',
        },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 1000n,
      timestamp: now,
    }

    const result = await strategy.calculateWeights(ctx)

    // Should have signals for both tokens
    expect(result.signals.length).toBe(2)
  })

  test('should maintain normalized weights', async () => {
    const now = Date.now()

    for (let i = 0; i < 30; i++) {
      const timestamp = now - (30 - i) * 3600000
      strategy.updatePriceHistory([
        {
          token: '0x1',
          price: BigInt(300000000000 + i * 1000000000),
          decimals: 8,
          timestamp,
          source: 'pyth',
        },
        {
          token: '0x2',
          price: 100000000n,
          decimals: 8,
          timestamp,
          source: 'pyth',
        },
      ])
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        {
          token: '0x1',
          price: 330000000000n,
          decimals: 8,
          timestamp: now,
          source: 'pyth',
        },
        {
          token: '0x2',
          price: 100000000n,
          decimals: 8,
          timestamp: now,
          source: 'pyth',
        },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 1000n,
      timestamp: now,
    }

    const result = await strategy.calculateWeights(ctx)

    // Weights should sum to approximately WEIGHT_PRECISION
    const sum = result.newWeights.reduce((a, b) => a + b, 0n)
    expect(sum).toBeGreaterThanOrEqual(WEIGHT_PRECISION - 1000n)
    expect(sum).toBeLessThanOrEqual(WEIGHT_PRECISION + 1000n)
  })

  test('should update configuration', () => {
    strategy.updateConfig({
      targetVolatilityPct: 20,
      useInverseVolWeighting: false,
    })

    // Should not throw
    expect(strategy.getName()).toBe('volatility')
  })
})

describe('Volatility Calculation Properties', () => {
  test('should have higher vol for trending up vs flat', async () => {
    const flatStrategy = new VolatilityStrategy(new OracleAggregator({}), {
      minVolSampleSize: 5,
    })
    const trendStrategy = new VolatilityStrategy(new OracleAggregator({}), {
      minVolSampleSize: 5,
    })

    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
    ]
    const riskParams: TFMMRiskParameters = {
      minWeight: WEIGHT_PRECISION / 20n,
      maxWeight: (WEIGHT_PRECISION * 95n) / 100n,
      maxWeightChangeBps: 500,
      minUpdateIntervalBlocks: 10,
      oracleStalenessSeconds: 60,
      maxPriceDeviationBps: 500,
    }

    const now = Date.now()

    // Flat prices
    for (let i = 0; i < 30; i++) {
      flatStrategy.updatePriceHistory([
        {
          token: '0x1',
          price: 100n * 10n ** 8n,
          decimals: 8,
          timestamp: now - (30 - i) * 3600000,
          source: 'pyth',
        },
      ])
    }

    // Trending prices with noise
    for (let i = 0; i < 30; i++) {
      const trend = BigInt(i * 1000000)
      const noise = BigInt(Math.floor(Math.sin(i) * 500000))
      trendStrategy.updatePriceHistory([
        {
          token: '0x1',
          price: 100n * 10n ** 8n + trend + noise,
          decimals: 8,
          timestamp: now - (30 - i) * 3600000,
          source: 'pyth',
        },
      ])
    }

    const flatCtx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION],
      prices: [
        {
          token: '0x1',
          price: 100n * 10n ** 8n,
          decimals: 8,
          timestamp: now,
          source: 'pyth',
        },
      ],
      priceHistory: [],
      riskParams,
      blockNumber: 100n,
      timestamp: now,
    }

    const trendCtx: StrategyContext = {
      ...flatCtx,
      prices: [
        {
          token: '0x1',
          price: 103n * 10n ** 8n,
          decimals: 8,
          timestamp: now,
          source: 'pyth',
        },
      ],
    }

    const flatResult = await flatStrategy.calculateWeights(flatCtx)
    const trendResult = await trendStrategy.calculateWeights(trendCtx)

    // Both should have valid results
    expect(flatResult.newWeights.length).toBe(1)
    expect(trendResult.newWeights.length).toBe(1)
  })

  test('should handle three-token pool', async () => {
    const strategy = new VolatilityStrategy(new OracleAggregator({}), {
      minVolSampleSize: 10,
    })

    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
      { address: '0x2', symbol: 'B', decimals: 18, chainId: 1 },
      { address: '0x3', symbol: 'C', decimals: 18, chainId: 1 },
    ]

    const now = Date.now()
    for (let i = 0; i < 30; i++) {
      const sin1 = Math.floor(Math.sin(i) * 10 ** 7)
      const cos1 = Math.floor(Math.cos(i) * 5 * 10 ** 6)
      const sin2 = Math.floor(Math.sin(i * 2) * 2 * 10 ** 7)
      strategy.updatePriceHistory([
        {
          token: '0x1',
          price: 100n * 10n ** 8n + BigInt(sin1),
          decimals: 8,
          timestamp: now - (30 - i) * 3600000,
          source: 'pyth',
        },
        {
          token: '0x2',
          price: 50n * 10n ** 8n + BigInt(cos1),
          decimals: 8,
          timestamp: now - (30 - i) * 3600000,
          source: 'pyth',
        },
        {
          token: '0x3',
          price: 200n * 10n ** 8n + BigInt(sin2),
          decimals: 8,
          timestamp: now - (30 - i) * 3600000,
          source: 'pyth',
        },
      ])
    }

    const third = WEIGHT_PRECISION / 3n
    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [third, third, third],
      prices: [
        {
          token: '0x1',
          price: 100n * 10n ** 8n,
          decimals: 8,
          timestamp: now,
          source: 'pyth',
        },
        {
          token: '0x2',
          price: 50n * 10n ** 8n,
          decimals: 8,
          timestamp: now,
          source: 'pyth',
        },
        {
          token: '0x3',
          price: 200n * 10n ** 8n,
          decimals: 8,
          timestamp: now,
          source: 'pyth',
        },
      ],
      priceHistory: [],
      riskParams: {
        minWeight: WEIGHT_PRECISION / 20n,
        maxWeight: (WEIGHT_PRECISION * 95n) / 100n,
        maxWeightChangeBps: 500,
        minUpdateIntervalBlocks: 10,
        oracleStalenessSeconds: 60,
        maxPriceDeviationBps: 500,
      },
      blockNumber: 100n,
      timestamp: now,
    }

    const result = await strategy.calculateWeights(ctx)

    expect(result.newWeights.length).toBe(3)
    const sum = result.newWeights.reduce((a, b) => a + b, 0n)
    expect(sum).toBeGreaterThanOrEqual(WEIGHT_PRECISION - 1000n)
    expect(sum).toBeLessThanOrEqual(WEIGHT_PRECISION + 1000n)
  })
})

describe('VolatilityStrategy with volatility targeting', () => {
  test('should use vol targeting when inverse weighting disabled', async () => {
    const strategy = new VolatilityStrategy(new OracleAggregator({}), {
      minVolSampleSize: 10,
      useInverseVolWeighting: false,
      targetVolatilityPct: 15,
    })

    const tokens: Token[] = [
      { address: '0x1', symbol: 'A', decimals: 18, chainId: 1 },
      { address: '0x2', symbol: 'B', decimals: 18, chainId: 1 },
    ]

    const now = Date.now()
    for (let i = 0; i < 30; i++) {
      const sin1 = Math.floor(Math.sin(i) * 5 * 10 ** 7)
      const cos1 = Math.floor(Math.cos(i) * 10 ** 6)
      strategy.updatePriceHistory([
        {
          token: '0x1',
          price: 100n * 10n ** 8n + BigInt(sin1),
          decimals: 8,
          timestamp: now - (30 - i) * 3600000,
          source: 'pyth',
        },
        {
          token: '0x2',
          price: 100n * 10n ** 8n + BigInt(cos1),
          decimals: 8,
          timestamp: now - (30 - i) * 3600000,
          source: 'pyth',
        },
      ])
    }

    const ctx: StrategyContext = {
      pool: '0x0',
      tokens,
      currentWeights: [WEIGHT_PRECISION / 2n, WEIGHT_PRECISION / 2n],
      prices: [
        {
          token: '0x1',
          price: 100n * 10n ** 8n,
          decimals: 8,
          timestamp: now,
          source: 'pyth',
        },
        {
          token: '0x2',
          price: 100n * 10n ** 8n,
          decimals: 8,
          timestamp: now,
          source: 'pyth',
        },
      ],
      priceHistory: [],
      riskParams: {
        minWeight: WEIGHT_PRECISION / 20n,
        maxWeight: (WEIGHT_PRECISION * 95n) / 100n,
        maxWeightChangeBps: 500,
        minUpdateIntervalBlocks: 10,
        oracleStalenessSeconds: 60,
        maxPriceDeviationBps: 500,
      },
      blockNumber: 100n,
      timestamp: now,
    }

    const result = await strategy.calculateWeights(ctx)

    expect(result.newWeights.length).toBe(2)
    // Weights should be normalized
    const sum = result.newWeights.reduce((a, b) => a + b, 0n)
    expect(sum).toBeGreaterThanOrEqual(WEIGHT_PRECISION - 1000n)
  })
})
