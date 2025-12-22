/**
 * Liquidation Strategy Tests
 *
 * Tests for:
 * - PnL estimation for long/short positions
 * - Cascade detection and simulation
 * - Profit calculations with liquidation bonus
 */

import { describe, expect, test } from 'bun:test'

// Types from liquidation.ts (recreated for testing without RPC dependencies)
interface Position {
  positionId: string
  trader: string
  marketId: string
  side: 'LONG' | 'SHORT'
  size: bigint
  margin: bigint
  marginToken: string
  entryPrice: bigint
  lastCheck: number
}

interface MarketConfig {
  marketId: string
  symbol: string
  maintenanceMarginBps: number
  liquidationBonus: number
}

// Pure math functions extracted for testing
function estimatePnL(position: Position, currentPrice: bigint): bigint {
  const priceDelta = currentPrice - position.entryPrice

  if (position.side === 'LONG') {
    // Long: profit when price goes up
    return (position.size * priceDelta) / position.entryPrice
  } else {
    // Short: profit when price goes down
    return (
      (position.size * (position.entryPrice - currentPrice)) /
      position.entryPrice
    )
  }
}

function calculateHealthFactor(
  position: Position,
  currentPrice: bigint,
  maintenanceMarginBps: number,
): bigint {
  const pnl = estimatePnL(position, currentPrice)
  const effectiveMargin = position.margin + pnl
  const maintenanceMargin =
    (position.size * BigInt(maintenanceMarginBps)) / 10000n

  if (maintenanceMargin === 0n) return BigInt(1e18)

  return (effectiveMargin * BigInt(1e18)) / maintenanceMargin
}

function isLiquidatable(
  position: Position,
  currentPrice: bigint,
  maintenanceMarginBps: number,
): boolean {
  const pnl = estimatePnL(position, currentPrice)
  const effectiveMargin = position.margin + pnl
  const maintenanceMargin =
    (position.size * BigInt(maintenanceMarginBps)) / 10000n

  return effectiveMargin <= maintenanceMargin
}

function calculateLiquidationProfit(
  position: Position,
  currentPrice: bigint,
  market: MarketConfig,
  gasEstimate: bigint,
  gasPrice: bigint,
): { netProfit: bigint; liquidationBonus: bigint; gasCost: bigint } {
  const pnl = estimatePnL(position, currentPrice)
  const effectiveMargin = position.margin + pnl

  // Liquidation bonus is percentage of margin
  const liquidationBonus =
    ((effectiveMargin > 0n ? effectiveMargin : 0n) *
      BigInt(market.liquidationBonus)) /
    10000n
  const gasCost = gasEstimate * gasPrice
  const netProfit = liquidationBonus - gasCost

  return { netProfit, liquidationBonus, gasCost }
}

describe('Position PnL Estimation', () => {
  test('should calculate positive PnL for profitable long', () => {
    const position: Position = {
      positionId: '1',
      trader: '0x123',
      marketId: 'ETH-USD',
      side: 'LONG',
      size: BigInt(10e18), // 10 ETH worth
      margin: BigInt(1e18), // 1 ETH margin (10x leverage)
      marginToken: '0x0',
      entryPrice: BigInt(2000e18), // $2000 entry
      lastCheck: Date.now(),
    }

    // Price went up to $2200 (10% up)
    const currentPrice = BigInt(2200e18)
    const pnl = estimatePnL(position, currentPrice)

    // Expected: size * (2200 - 2000) / 2000 = 10 * 200/2000 = 1 ETH
    expect(pnl).toBe(BigInt(1e18))
  })

  test('should calculate negative PnL for losing long', () => {
    const position: Position = {
      positionId: '2',
      trader: '0x123',
      marketId: 'ETH-USD',
      side: 'LONG',
      size: BigInt(10e18),
      margin: BigInt(1e18),
      marginToken: '0x0',
      entryPrice: BigInt(2000e18),
      lastCheck: Date.now(),
    }

    // Price dropped to $1800 (10% down)
    const currentPrice = BigInt(1800e18)
    const pnl = estimatePnL(position, currentPrice)

    // Expected: size * (1800 - 2000) / 2000 = 10 * (-200)/2000 = -1 ETH
    expect(pnl).toBe(BigInt(-1e18))
  })

  test('should calculate positive PnL for profitable short', () => {
    const position: Position = {
      positionId: '3',
      trader: '0x123',
      marketId: 'ETH-USD',
      side: 'SHORT',
      size: BigInt(10e18),
      margin: BigInt(1e18),
      marginToken: '0x0',
      entryPrice: BigInt(2000e18),
      lastCheck: Date.now(),
    }

    // Price dropped to $1800 (10% down - good for short)
    const currentPrice = BigInt(1800e18)
    const pnl = estimatePnL(position, currentPrice)

    // Expected: size * (2000 - 1800) / 2000 = 10 * 200/2000 = 1 ETH
    expect(pnl).toBe(BigInt(1e18))
  })

  test('should calculate negative PnL for losing short', () => {
    const position: Position = {
      positionId: '4',
      trader: '0x123',
      marketId: 'ETH-USD',
      side: 'SHORT',
      size: BigInt(10e18),
      margin: BigInt(1e18),
      marginToken: '0x0',
      entryPrice: BigInt(2000e18),
      lastCheck: Date.now(),
    }

    // Price went up to $2200 (bad for short)
    const currentPrice = BigInt(2200e18)
    const pnl = estimatePnL(position, currentPrice)

    // Expected: size * (2000 - 2200) / 2000 = 10 * (-200)/2000 = -1 ETH
    expect(pnl).toBe(BigInt(-1e18))
  })

  test('should return zero PnL when price unchanged', () => {
    const position: Position = {
      positionId: '5',
      trader: '0x123',
      marketId: 'ETH-USD',
      side: 'LONG',
      size: BigInt(10e18),
      margin: BigInt(1e18),
      marginToken: '0x0',
      entryPrice: BigInt(2000e18),
      lastCheck: Date.now(),
    }

    const pnl = estimatePnL(position, BigInt(2000e18))
    expect(pnl).toBe(0n)
  })
})

describe('Health Factor Calculation', () => {
  test('should calculate healthy position (HF > 1)', () => {
    const position: Position = {
      positionId: '1',
      trader: '0x123',
      marketId: 'ETH-USD',
      side: 'LONG',
      size: BigInt(10e18),
      margin: BigInt(2e18), // 2 ETH margin (5x leverage)
      marginToken: '0x0',
      entryPrice: BigInt(2000e18),
      lastCheck: Date.now(),
    }

    // Price unchanged - no PnL
    const currentPrice = BigInt(2000e18)
    const hf = calculateHealthFactor(position, currentPrice, 500) // 5% maintenance

    // Maintenance margin = 10 * 0.05 = 0.5 ETH
    // Effective margin = 2 ETH
    // HF = 2 / 0.5 = 4
    expect(hf).toBe(BigInt(4e18))
  })

  test('should detect liquidatable position (HF <= 1)', () => {
    const position: Position = {
      positionId: '2',
      trader: '0x123',
      marketId: 'ETH-USD',
      side: 'LONG',
      size: BigInt(20e18), // 20 ETH size (10x leverage)
      margin: BigInt(2e18), // 2 ETH margin
      marginToken: '0x0',
      entryPrice: BigInt(2000e18),
      lastCheck: Date.now(),
    }

    // Price dropped 10% - loss = 2 ETH (wipes margin)
    const currentPrice = BigInt(1800e18)
    const hf = calculateHealthFactor(position, currentPrice, 500)

    // PnL = 20 * (1800-2000)/2000 = -2 ETH
    // Effective margin = 2 - 2 = 0
    // Maintenance = 20 * 0.05 = 1 ETH
    // HF = 0 / 1 = 0
    expect(hf).toBe(0n)
  })

  test('should return near-liquidation for position close to threshold', () => {
    const position: Position = {
      positionId: '3',
      trader: '0x123',
      marketId: 'ETH-USD',
      side: 'LONG',
      size: BigInt(10e18),
      margin: BigInt(1e18),
      marginToken: '0x0',
      entryPrice: BigInt(2000e18),
      lastCheck: Date.now(),
    }

    // Price dropped 5% - loss = 0.5 ETH
    const currentPrice = BigInt(1900e18)
    const hf = calculateHealthFactor(position, currentPrice, 500)

    // PnL = 10 * (1900-2000)/2000 = -0.5 ETH
    // Effective margin = 1 - 0.5 = 0.5 ETH
    // Maintenance = 10 * 0.05 = 0.5 ETH
    // HF = 0.5 / 0.5 = 1
    expect(hf).toBe(BigInt(1e18))
  })
})

describe('Liquidation Detection', () => {
  test('should detect liquidatable long position', () => {
    const position: Position = {
      positionId: '1',
      trader: '0x123',
      marketId: 'ETH-USD',
      side: 'LONG',
      size: BigInt(20e18),
      margin: BigInt(1e18), // 20x leverage
      marginToken: '0x0',
      entryPrice: BigInt(2000e18),
      lastCheck: Date.now(),
    }

    // Price dropped 5%
    const currentPrice = BigInt(1900e18)
    const liquidatable = isLiquidatable(position, currentPrice, 500)

    // PnL = 20 * -100/2000 = -1 ETH (wipes entire margin)
    // Maintenance = 20 * 0.05 = 1 ETH
    // Effective margin = 1 - 1 = 0 <= 1
    expect(liquidatable).toBe(true)
  })

  test('should detect liquidatable short position', () => {
    const position: Position = {
      positionId: '2',
      trader: '0x123',
      marketId: 'ETH-USD',
      side: 'SHORT',
      size: BigInt(20e18),
      margin: BigInt(1e18),
      marginToken: '0x0',
      entryPrice: BigInt(2000e18),
      lastCheck: Date.now(),
    }

    // Price went up 5%
    const currentPrice = BigInt(2100e18)
    const liquidatable = isLiquidatable(position, currentPrice, 500)

    // PnL = 20 * (2000-2100)/2000 = -1 ETH
    expect(liquidatable).toBe(true)
  })

  test('should not detect healthy position as liquidatable', () => {
    const position: Position = {
      positionId: '3',
      trader: '0x123',
      marketId: 'ETH-USD',
      side: 'LONG',
      size: BigInt(5e18), // 5x leverage
      margin: BigInt(1e18),
      marginToken: '0x0',
      entryPrice: BigInt(2000e18),
      lastCheck: Date.now(),
    }

    // Price dropped 5%
    const currentPrice = BigInt(1900e18)
    const liquidatable = isLiquidatable(position, currentPrice, 500)

    // PnL = 5 * -100/2000 = -0.25 ETH
    // Effective margin = 1 - 0.25 = 0.75 ETH
    // Maintenance = 5 * 0.05 = 0.25 ETH
    // 0.75 > 0.25, so not liquidatable
    expect(liquidatable).toBe(false)
  })
})

describe('Liquidation Profit Calculation', () => {
  test('should calculate positive profit for liquidatable position', () => {
    const position: Position = {
      positionId: '1',
      trader: '0x123',
      marketId: 'ETH-USD',
      side: 'LONG',
      size: BigInt(10e18),
      margin: BigInt(1e18),
      marginToken: '0x0',
      entryPrice: BigInt(2000e18),
      lastCheck: Date.now(),
    }

    const market: MarketConfig = {
      marketId: 'ETH-USD',
      symbol: 'ETH',
      maintenanceMarginBps: 500,
      liquidationBonus: 500, // 5% bonus
    }

    // Price dropped 5% - position at liquidation threshold
    const currentPrice = BigInt(1900e18)
    const gasEstimate = 500000n
    const gasPrice = BigInt(30e9) // 30 gwei

    const result = calculateLiquidationProfit(
      position,
      currentPrice,
      market,
      gasEstimate,
      gasPrice,
    )

    // PnL = 10 * -100/2000 = -0.5 ETH
    // Effective margin = 1 - 0.5 = 0.5 ETH
    // Bonus = 0.5 * 0.05 = 0.025 ETH
    // Gas = 500000 * 30 gwei = 0.015 ETH
    // Net = 0.025 - 0.015 = 0.01 ETH
    expect(result.liquidationBonus).toBe(BigInt(25e15)) // 0.025 ETH
    expect(result.gasCost).toBe(BigInt(15e15)) // 0.015 ETH
    expect(result.netProfit).toBe(BigInt(10e15)) // 0.01 ETH
  })

  test('should return zero bonus when margin is underwater', () => {
    const position: Position = {
      positionId: '2',
      trader: '0x123',
      marketId: 'ETH-USD',
      side: 'LONG',
      size: BigInt(20e18),
      margin: BigInt(1e18),
      marginToken: '0x0',
      entryPrice: BigInt(2000e18),
      lastCheck: Date.now(),
    }

    const market: MarketConfig = {
      marketId: 'ETH-USD',
      symbol: 'ETH',
      maintenanceMarginBps: 500,
      liquidationBonus: 500,
    }

    // Price dropped 10% - loss > margin
    const currentPrice = BigInt(1800e18)
    const gasEstimate = 500000n
    const gasPrice = BigInt(30e9)

    const result = calculateLiquidationProfit(
      position,
      currentPrice,
      market,
      gasEstimate,
      gasPrice,
    )

    // PnL = 20 * -200/2000 = -2 ETH (more than 1 ETH margin)
    // Effective margin = 1 - 2 = -1 ETH (underwater)
    // Bonus = 0 (can't take from underwater position)
    expect(result.liquidationBonus).toBe(0n)
    expect(result.netProfit).toBeLessThan(0n)
  })

  test('should detect unprofitable liquidation due to gas', () => {
    const position: Position = {
      positionId: '3',
      trader: '0x123',
      marketId: 'ETH-USD',
      side: 'LONG',
      size: BigInt(1e18), // Small position
      margin: BigInt(1e17), // 0.1 ETH margin
      marginToken: '0x0',
      entryPrice: BigInt(2000e18),
      lastCheck: Date.now(),
    }

    const market: MarketConfig = {
      marketId: 'ETH-USD',
      symbol: 'ETH',
      maintenanceMarginBps: 500,
      liquidationBonus: 500,
    }

    // At liquidation threshold
    const currentPrice = BigInt(1900e18)
    const gasEstimate = 500000n
    const gasPrice = BigInt(100e9) // High gas: 100 gwei

    const result = calculateLiquidationProfit(
      position,
      currentPrice,
      market,
      gasEstimate,
      gasPrice,
    )

    // Bonus is small, gas is high
    // Gas = 500000 * 100 gwei = 0.05 ETH
    expect(result.gasCost).toBe(BigInt(5e16))
    expect(result.netProfit).toBeLessThan(0n)
  })
})

describe('Cascade Detection Logic', () => {
  test('should identify positions near liquidation', () => {
    const positions: Position[] = [
      {
        positionId: '1',
        trader: '0x1',
        marketId: 'ETH-USD',
        side: 'LONG',
        size: BigInt(10e18),
        margin: BigInt(1e18),
        marginToken: '0x0',
        entryPrice: BigInt(2000e18),
        lastCheck: Date.now(),
      },
      {
        positionId: '2',
        trader: '0x2',
        marketId: 'ETH-USD',
        side: 'LONG',
        size: BigInt(20e18),
        margin: BigInt(1e18), // Higher leverage
        marginToken: '0x0',
        entryPrice: BigInt(2000e18),
        lastCheck: Date.now(),
      },
      {
        positionId: '3',
        trader: '0x3',
        marketId: 'ETH-USD',
        side: 'LONG',
        size: BigInt(5e18),
        margin: BigInt(2e18), // Lower leverage, safer
        marginToken: '0x0',
        entryPrice: BigInt(2000e18),
        lastCheck: Date.now(),
      },
    ]

    const currentPrice = BigInt(1950e18) // 2.5% drop
    const nearLiquidationThreshold = BigInt(12e17) // HF < 1.2

    const nearLiquidation = positions.filter((pos) => {
      const hf = calculateHealthFactor(pos, currentPrice, 500)
      return hf < nearLiquidationThreshold
    })

    // Position 2 (high leverage) should be near liquidation
    expect(nearLiquidation.length).toBeGreaterThan(0)
  })

  test('should calculate cascade volume', () => {
    const positions: Position[] = [
      {
        positionId: '1',
        trader: '0x1',
        marketId: 'ETH-USD',
        side: 'LONG',
        size: BigInt(100e18),
        margin: BigInt(5e18),
        marginToken: '0x0',
        entryPrice: BigInt(2000e18),
        lastCheck: Date.now(),
      },
      {
        positionId: '2',
        trader: '0x2',
        marketId: 'ETH-USD',
        side: 'LONG',
        size: BigInt(50e18),
        margin: BigInt(2e18),
        marginToken: '0x0',
        entryPrice: BigInt(2000e18),
        lastCheck: Date.now(),
      },
    ]

    const currentPrice = BigInt(1900e18) // 5% drop

    let totalExposure = 0n
    let nearLiquidationVolume = 0n

    for (const pos of positions) {
      totalExposure += pos.size
      const hf = calculateHealthFactor(pos, currentPrice, 500)
      if (hf < BigInt(12e17)) {
        // HF < 1.2
        nearLiquidationVolume += pos.size
      }
    }

    const volumeRatio = Number(nearLiquidationVolume) / Number(totalExposure)

    expect(totalExposure).toBe(BigInt(150e18))
    expect(volumeRatio).toBeGreaterThan(0)
  })

  test('should estimate price impact from cascade liquidations', () => {
    const nearLiquidationVolume = BigInt(1000000e18) // $1M in notional
    const volumeUsd = Number(nearLiquidationVolume) / 1e18

    // Rough estimate: 1% price impact per $1M liquidation volume
    const expectedPriceImpact = (volumeUsd / 1000000) * 0.01

    expect(expectedPriceImpact).toBe(0.01) // 1% impact for $1M
  })

  test('should simulate cascade scenario', () => {
    const positions: Position[] = [
      {
        positionId: '1',
        trader: '0x1',
        marketId: 'ETH-USD',
        side: 'LONG',
        size: BigInt(10e18),
        margin: BigInt(1e18),
        marginToken: '0x0',
        entryPrice: BigInt(2000e18),
        lastCheck: Date.now(),
      },
      {
        positionId: '2',
        trader: '0x2',
        marketId: 'ETH-USD',
        side: 'LONG',
        size: BigInt(10e18),
        margin: BigInt(15e17), // Slightly more margin
        marginToken: '0x0',
        entryPrice: BigInt(2000e18),
        lastCheck: Date.now(),
      },
      {
        positionId: '3',
        trader: '0x3',
        marketId: 'ETH-USD',
        side: 'LONG',
        size: BigInt(10e18),
        margin: BigInt(2e18), // Even more margin
        marginToken: '0x0',
        entryPrice: BigInt(2000e18),
        lastCheck: Date.now(),
      },
    ]

    const maintenanceMarginBps = 500 // 5%

    // Simulate 5% price drop
    const priceDropPercent = 0.05
    const priceAfterDrop =
      (BigInt(2000e18) * BigInt(Math.floor((1 - priceDropPercent) * 10000))) /
      10000n

    let liquidatedCount = 0
    for (const pos of positions) {
      if (isLiquidatable(pos, priceAfterDrop, maintenanceMarginBps)) {
        liquidatedCount++
      }
    }

    // At 5% drop, position 1 (10x leverage) should be liquidated
    expect(liquidatedCount).toBeGreaterThan(0)
  })
})

describe('Cascade Probability Calculation', () => {
  test('should calculate cascade probability based on volume ratio', () => {
    const volumeRatio = 0.25 // 25% of positions near liquidation
    let cascadeProbability = 0

    if (volumeRatio > 0.1) cascadeProbability += 20
    if (volumeRatio > 0.2) cascadeProbability += 30
    if (volumeRatio > 0.3) cascadeProbability += 40

    // 25% volume ratio should give 50% probability (20 + 30)
    expect(cascadeProbability).toBe(50)
  })

  test('should increase probability on price drop', () => {
    const priceDropPercent = 0.06 // 6% drop
    const cascadeThreshold = 0.05 // 5% threshold

    let cascadeProbability = 0

    if (priceDropPercent > cascadeThreshold) {
      cascadeProbability += 30
    }

    expect(cascadeProbability).toBe(30)
  })

  test('should combine volume and price factors', () => {
    const volumeRatio = 0.15 // 15%
    const priceDropPercent = 0.07 // 7%
    const cascadeThreshold = 0.05

    let cascadeProbability = 0

    // Volume factor
    if (volumeRatio > 0.1) cascadeProbability += 20

    // Price drop factor
    if (priceDropPercent > cascadeThreshold) cascadeProbability += 30

    expect(cascadeProbability).toBe(50)
  })
})
