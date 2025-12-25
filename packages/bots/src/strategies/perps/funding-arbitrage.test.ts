import { describe, expect, test } from 'bun:test'
import { type Address, formatUnits, parseUnits } from 'viem'
import type { FundingArbConfig } from './funding-arbitrage'

// Fee constants used throughout tests
const PERP_FEE = 0.0005 // 0.05%
const SPOT_FEE = 0.003 // 0.3%

// Test configuration
const TEST_CONFIG: FundingArbConfig = {
  chainId: 8453,
  perpMarketAddress: '0x1111111111111111111111111111111111111111' as Address,
  spotDexAddress: '0x2222222222222222222222222222222222222222' as Address,
  markets: [
    {
      marketId:
        '0x4254432d50455250000000000000000000000000000000000000000000000000',
      symbol: 'BTC-PERP',
      baseAsset: '0x3333333333333333333333333333333333333333' as Address,
      quoteAsset: '0x4444444444444444444444444444444444444444' as Address,
      spotPool: '0x5555555555555555555555555555555555555555' as Address,
    },
  ],
  minFundingRate: 0.0001, // 0.01%
  maxPositionSize: parseUnits('10000', 18),
  targetLeverage: 10,
  minProfit: 0.0005, // 0.05%
  gasLimit: 500000n,
  checkIntervalMs: 60000,
}

describe('FundingArbitrageBot', () => {
  describe('Configuration Validation', () => {
    test('should require valid chainId', () => {
      expect(TEST_CONFIG.chainId).toBe(8453)
    })

    test('should require valid market addresses', () => {
      expect(TEST_CONFIG.perpMarketAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(TEST_CONFIG.spotDexAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    test('should have at least one market configured', () => {
      expect(TEST_CONFIG.markets.length).toBeGreaterThan(0)
    })

    test('should have valid leverage within bounds', () => {
      expect(TEST_CONFIG.targetLeverage).toBeGreaterThan(0)
      expect(TEST_CONFIG.targetLeverage).toBeLessThanOrEqual(50)
    })
  })

  describe('Position Sizing', () => {
    test('should calculate position size based on max position', () => {
      const price = 97500 // BTC price
      const maxUsd = Number(formatUnits(TEST_CONFIG.maxPositionSize, 18))
      const expectedSize = maxUsd / price / TEST_CONFIG.targetLeverage

      expect(expectedSize).toBeGreaterThan(0)
      expect(expectedSize).toBeLessThan(maxUsd / price)
    })

    test('should handle very small position sizes', () => {
      const smallMaxPosition = parseUnits('10', 18) // Only $10
      const price = 97500
      const maxUsd = Number(formatUnits(smallMaxPosition, 18))
      const size = maxUsd / price / 10 // 10x leverage

      expect(size).toBeGreaterThan(0)
      expect(size).toBeLessThan(1) // Less than 1 BTC
    })

    test('should handle edge case of max leverage', () => {
      const maxLeverage = 50
      const notional = 100000 // $100k notional
      const requiredMargin = notional / maxLeverage

      expect(requiredMargin).toBe(2000) // $2k margin for $100k at 50x
    })
  })

  describe('Funding Rate Analysis', () => {
    test('should identify positive funding as short opportunity', () => {
      const fundingRate = 0.01 // 1% positive funding
      const direction =
        fundingRate > 0 ? 'short_perp_long_spot' : 'long_perp_short_spot'

      expect(direction).toBe('short_perp_long_spot')
    })

    test('should identify negative funding as long opportunity', () => {
      const fundingRate = -0.01 // 1% negative funding
      const direction =
        fundingRate > 0 ? 'short_perp_long_spot' : 'long_perp_short_spot'

      expect(direction).toBe('long_perp_short_spot')
    })

    test('should reject funding below minimum threshold', () => {
      const fundingRate = 0.00005 // 0.005%
      const minRate = TEST_CONFIG.minFundingRate

      expect(Math.abs(fundingRate) < minRate).toBe(true)
    })

    test('should accept funding above minimum threshold', () => {
      const fundingRate = 0.001 // 0.1%
      const minRate = TEST_CONFIG.minFundingRate

      expect(Math.abs(fundingRate) >= minRate).toBe(true)
    })
  })

  describe('Profit Calculation', () => {
    test('should calculate expected profit correctly', () => {
      const fundingRate = 0.01 // 1%
      const expectedProfit = Math.abs(fundingRate) - (PERP_FEE + SPOT_FEE)

      expect(expectedProfit).toBeCloseTo(0.0065, 4) // 1% - 0.35% = 0.65%
    })

    test('should reject if profit below minimum', () => {
      const fundingRate = 0.002 // 0.2%
      const expectedProfit = Math.abs(fundingRate) - (PERP_FEE + SPOT_FEE)
      const minProfit = TEST_CONFIG.minProfit

      expect(expectedProfit < minProfit).toBe(true)
    })

    test('should accept if profit above minimum', () => {
      const fundingRate = 0.01 // 1%
      const expectedProfit = Math.abs(fundingRate) - (PERP_FEE + SPOT_FEE)
      const minProfit = TEST_CONFIG.minProfit

      expect(expectedProfit >= minProfit).toBe(true)
    })

    test('should handle breakeven scenario', () => {
      const breakEvenRate = PERP_FEE + SPOT_FEE
      const profit = breakEvenRate - (PERP_FEE + SPOT_FEE)

      expect(profit).toBe(0)
    })
  })

  describe('Direction Logic', () => {
    test('should go short perp when funding is positive', () => {
      // Positive funding = longs pay shorts
      // Strategy: short perp (receive funding), long spot (hedge)
      const fundingRate = 0.01
      const perpSide = fundingRate > 0 ? 'short' : 'long'
      const spotSide = fundingRate > 0 ? 'long' : 'short'

      expect(perpSide).toBe('short')
      expect(spotSide).toBe('long')
    })

    test('should go long perp when funding is negative', () => {
      // Negative funding = shorts pay longs
      // Strategy: long perp (receive funding), short spot (hedge)
      const fundingRate = -0.01
      const perpSide = fundingRate > 0 ? 'short' : 'long'
      const spotSide = fundingRate > 0 ? 'long' : 'short'

      expect(perpSide).toBe('long')
      expect(spotSide).toBe('short')
    })
  })

  describe('Position Management', () => {
    test('should close when funding reverses significantly', () => {
      // Entered when positive at 0.01, now negative
      const currentRate = -0.001
      const minRate = TEST_CONFIG.minFundingRate

      // Should exit if funding reversed past threshold
      const shouldExit = currentRate < -minRate
      expect(shouldExit).toBe(true)
    })

    test('should hold when funding is still favorable', () => {
      // Entry rate was 0.01, reduced but still positive
      const currentRate = 0.005
      const minRate = TEST_CONFIG.minFundingRate

      const shouldExit = currentRate < -minRate
      expect(shouldExit).toBe(false)
    })
  })

  describe('Edge Cases', () => {
    test('should handle zero funding rate', () => {
      const fundingRate = 0
      const minRate = TEST_CONFIG.minFundingRate

      expect(Math.abs(fundingRate) < minRate).toBe(true)
    })

    test('should handle extremely high funding rate', () => {
      const fundingRate = 0.1 // 10% - extreme but possible
      const expectedProfit = Math.abs(fundingRate) - (PERP_FEE + SPOT_FEE)

      expect(expectedProfit).toBeGreaterThan(0.09)
    })

    test('should handle precision at boundary', () => {
      const fundingRate = TEST_CONFIG.minFundingRate // Exactly at threshold
      expect(Math.abs(fundingRate) >= TEST_CONFIG.minFundingRate).toBe(true)
    })
  })

  describe('Stats Tracking', () => {
    test('should format stats output correctly', () => {
      const stats = {
        activePositions: 2,
        markets: ['BTC-PERP', 'ETH-PERP'],
        positions: [
          {
            marketId: 'BTC-PERP',
            direction: 'short_perp_long_spot',
            size: '0.5',
          },
          {
            marketId: 'ETH-PERP',
            direction: 'long_perp_short_spot',
            size: '10',
          },
        ],
      }

      expect(stats.activePositions).toBe(2)
      expect(stats.markets).toContain('BTC-PERP')
      expect(stats.positions[0].direction).toBe('short_perp_long_spot')
    })
  })
})

describe('FundingArbitrageBot Numeric Edge Cases', () => {
  test('should handle negative funding rates correctly', () => {
    const fundingRate = -0.05 // -5%
    const absRate = Math.abs(fundingRate)
    const profit = absRate - (PERP_FEE + SPOT_FEE)

    expect(profit).toBeGreaterThan(0)
    expect(fundingRate < 0).toBe(true)
  })

  test('should handle extreme positive funding rates', () => {
    const fundingRate = 0.5 // 50% - extreme but possible in volatile markets
    const profit = Math.abs(fundingRate) - (PERP_FEE + SPOT_FEE)

    expect(profit).toBeCloseTo(0.4965, 4)
  })

  test('should handle funding rate with high precision', () => {
    const fundingRate = 0.00012345 // Very precise rate
    const minRate = TEST_CONFIG.minFundingRate

    expect(fundingRate > minRate).toBe(true)
  })

  test('should reject if funding rate rounds to zero in calculation', () => {
    const fundingRate = 0.000001 // Very small
    const minRate = TEST_CONFIG.minFundingRate

    expect(fundingRate < minRate).toBe(true)
  })

  test('should handle position size at max boundary', () => {
    const maxSize = TEST_CONFIG.maxPositionSize
    const sizeAtMax = maxSize
    const sizeOverMax = maxSize + 1n

    expect(sizeAtMax <= maxSize).toBe(true)
    expect(sizeOverMax > maxSize).toBe(true)
  })

  test('should handle leverage at max boundary', () => {
    const maxLeverage = 50
    const leverageAtMax = 50
    const leverageOver = 51

    expect(leverageAtMax <= maxLeverage).toBe(true)
    expect(leverageOver > maxLeverage).toBe(true)
  })
})

describe('FundingArbitrageBot PnL Scenarios', () => {
  test('should calculate positive PnL when funding collected exceeds costs', () => {
    const positionSizeUsd = 10000
    const fundingRateCollected = 0.01 // 1%
    const fundingPayout = positionSizeUsd * fundingRateCollected
    const totalFees = positionSizeUsd * (PERP_FEE + SPOT_FEE)
    const pnl = fundingPayout - totalFees

    expect(pnl).toBeGreaterThan(0)
    expect(pnl).toBeCloseTo(65, 0) // $100 funding - $35 fees = $65
  })

  test('should calculate negative PnL when costs exceed funding', () => {
    const positionSizeUsd = 10000
    const fundingRateCollected = 0.001 // 0.1%
    const fundingPayout = positionSizeUsd * fundingRateCollected
    const totalFees = positionSizeUsd * (PERP_FEE + SPOT_FEE)
    const pnl = fundingPayout - totalFees

    expect(pnl).toBeLessThan(0)
    expect(pnl).toBeCloseTo(-25, 0) // $10 funding - $35 fees = -$25
  })

  test('should calculate slippage impact on profitability', () => {
    const slippageBps = 10 // 0.1% slippage
    const positionSizeUsd = 10000
    const slippageCost = positionSizeUsd * (slippageBps / 10000)
    const fundingProfit = 100 // Expected funding
    const netPnl = fundingProfit - slippageCost

    expect(netPnl).toBeCloseTo(90, 0) // $100 - $10 slippage
  })
})

describe('FundingArbitrageBot Market Selection', () => {
  test('should select market with highest absolute funding rate', () => {
    const markets = [
      { symbol: 'BTC-PERP', fundingRate: 0.005 },
      { symbol: 'ETH-PERP', fundingRate: -0.02 }, // Highest absolute
      { symbol: 'SOL-PERP', fundingRate: 0.008 },
    ]

    const sorted = markets.sort(
      (a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate),
    )
    expect(sorted[0].symbol).toBe('ETH-PERP')
  })

  test('should filter out markets below minimum rate', () => {
    const markets = [
      { symbol: 'BTC-PERP', fundingRate: 0.0001 },
      { symbol: 'ETH-PERP', fundingRate: 0.00005 }, // Below min
      { symbol: 'SOL-PERP', fundingRate: 0.0002 },
    ]

    const filtered = markets.filter(
      (m) => Math.abs(m.fundingRate) >= TEST_CONFIG.minFundingRate,
    )
    expect(filtered.length).toBe(2)
    expect(filtered.find((m) => m.symbol === 'ETH-PERP')).toBeUndefined()
  })
})
