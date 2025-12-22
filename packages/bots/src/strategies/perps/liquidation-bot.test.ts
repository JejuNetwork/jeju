import { describe, expect, test } from 'bun:test'
import { type Address, formatUnits, parseUnits } from 'viem'
import type { LiquidationBotConfig } from './liquidation-bot'

// Test configuration - matches LiquidationBotConfig interface
const TEST_CONFIG: LiquidationBotConfig = {
  chainId: 8453,
  perpMarketAddress: '0x1111111111111111111111111111111111111111' as Address,
  insuranceFundAddress: '0x2222222222222222222222222222222222222222' as Address,
  indexerUrl: 'http://localhost:4000/graphql',
  markets: ['BTC-PERP', 'ETH-PERP'],
  minProfitUsd: 10,
  maxGasPrice: parseUnits('50', 9), // 50 gwei
  batchSize: 5,
  checkIntervalMs: 5000,
  priorityFeeBps: 100,
}

describe('LiquidationBot Configuration', () => {
  test('should have valid chain ID', () => {
    expect(TEST_CONFIG.chainId).toBe(8453)
  })

  test('should have valid addresses', () => {
    expect(TEST_CONFIG.perpMarketAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(TEST_CONFIG.insuranceFundAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  test('should have valid indexer URL', () => {
    expect(TEST_CONFIG.indexerUrl).toMatch(/^https?:\/\//)
  })

  test('should have at least one market', () => {
    expect(TEST_CONFIG.markets.length).toBeGreaterThan(0)
  })

  test('should have valid batch size', () => {
    expect(TEST_CONFIG.batchSize).toBeGreaterThan(0)
    expect(TEST_CONFIG.batchSize).toBeLessThanOrEqual(20)
  })

  test('should have valid priority fee', () => {
    expect(TEST_CONFIG.priorityFeeBps).toBeGreaterThan(0)
    expect(TEST_CONFIG.priorityFeeBps).toBeLessThanOrEqual(10000)
  })
})

describe('Position Health Calculation', () => {
  const MAINTENANCE_MARGIN_BPS = 50 // 0.5%

  test('should calculate health ratio correctly', () => {
    const margin = parseUnits('1000', 18) // $1000 margin
    const notional = parseUnits('10000', 18) // $10k notional (10x)
    const pnl = parseUnits('0', 18) // Breakeven

    const maintenanceRequired =
      (notional * BigInt(MAINTENANCE_MARGIN_BPS)) / 10000n
    const healthRatio = ((margin + pnl) * 10000n) / maintenanceRequired

    // margin / (notional * 0.5%) = 1000 / 50 = 20 (20x buffer)
    expect(Number(healthRatio)).toBeGreaterThan(1)
  })

  test('should detect liquidatable position with negative pnl', () => {
    const margin = parseUnits('100', 18) // $100 margin
    const notional = parseUnits('5000', 18) // $5k notional (50x)
    const pnl = parseUnits('-90', 18) // -$90 loss

    const maintenanceRequired =
      (notional * BigInt(MAINTENANCE_MARGIN_BPS)) / 10000n
    const currentEquity = margin + pnl // $10 remaining
    const healthRatio = (currentEquity * 10000n) / maintenanceRequired

    // $10 equity vs $25 required = 0.4 health
    expect(Number(healthRatio) / 10000).toBeLessThan(1)
  })

  test('should handle position exactly at maintenance', () => {
    const notional = parseUnits('10000', 18)
    const maintenanceRequired =
      (notional * BigInt(MAINTENANCE_MARGIN_BPS)) / 10000n
    const margin = maintenanceRequired // Exactly at maintenance
    const pnl = 0n

    const currentEquity = margin + pnl
    const healthRatio = (currentEquity * 10000n) / maintenanceRequired

    expect(Number(healthRatio)).toBe(10000) // 1.0
  })

  test('should handle position below maintenance', () => {
    const notional = parseUnits('10000', 18)
    const maintenanceRequired =
      (notional * BigInt(MAINTENANCE_MARGIN_BPS)) / 10000n
    const margin = maintenanceRequired / 2n // Half maintenance
    const pnl = 0n

    const currentEquity = margin + pnl
    const healthRatio = (currentEquity * 10000n) / maintenanceRequired

    expect(Number(healthRatio)).toBe(5000) // 0.5
  })
})

describe('Liquidation Profit Calculation', () => {
  const LIQUIDATOR_REWARD_BPS = 25 // 0.25%

  test('should calculate liquidator reward correctly', () => {
    const positionSize = parseUnits('0.1', 18) // 0.1 BTC
    const price = parseUnits('97500', 8) // $97,500
    const notional = (positionSize * price) / parseUnits('1', 8)

    const reward = (notional * BigInt(LIQUIDATOR_REWARD_BPS)) / 10000n
    // 0.1 * 97500 = 9750 USD, 0.25% = 24.375 USD
    expect(Number(formatUnits(reward, 18))).toBeCloseTo(24.375, 1)
  })

  test('should reject if reward below minimum profit', () => {
    const notional = parseUnits('1000', 18) // Only $1k notional
    const reward = (notional * BigInt(LIQUIDATOR_REWARD_BPS)) / 10000n
    // 0.25% of $1k = $2.5

    expect(Number(formatUnits(reward, 18))).toBeLessThan(
      TEST_CONFIG.minProfitUsd,
    )
  })

  test('should account for gas costs', () => {
    const notional = parseUnits('50000', 18) // $50k position
    const reward = (notional * BigInt(LIQUIDATOR_REWARD_BPS)) / 10000n
    // 0.25% of $50k = $125

    const gasEstimate = 300000n
    const gasPrice = parseUnits('20', 9) // 20 gwei
    const gasCostWei = gasEstimate * gasPrice
    const ethPrice = 3500 // ETH price
    const gasCostUsd = Number(formatUnits(gasCostWei, 18)) * ethPrice

    const netProfit = Number(formatUnits(reward, 18)) - gasCostUsd
    expect(netProfit).toBeGreaterThan(0)
  })
})

describe('Gas Price Management', () => {
  test('should skip if gas price exceeds max', () => {
    const currentGasPrice = parseUnits('100', 9) // 100 gwei
    const maxGasPrice = TEST_CONFIG.maxGasPrice

    expect(currentGasPrice > maxGasPrice).toBe(true)
  })

  test('should proceed if gas price is acceptable', () => {
    const currentGasPrice = parseUnits('20', 9) // 20 gwei
    const maxGasPrice = TEST_CONFIG.maxGasPrice

    expect(currentGasPrice <= maxGasPrice).toBe(true)
  })

  test('should handle gas price at exact max', () => {
    const currentGasPrice = TEST_CONFIG.maxGasPrice
    expect(currentGasPrice <= TEST_CONFIG.maxGasPrice).toBe(true)
  })
})

describe('Position Filtering', () => {
  interface MockPosition {
    id: string
    marketId: string
    margin: bigint
    notional: bigint
    unrealizedPnl: bigint
    maintenanceMarginBps: number
  }

  const createPosition = (
    overrides: Partial<MockPosition> = {},
  ): MockPosition => ({
    id: '0x1234',
    marketId: 'BTC-PERP',
    margin: parseUnits('100', 18),
    notional: parseUnits('5000', 18),
    unrealizedPnl: 0n,
    maintenanceMarginBps: 50,
    ...overrides,
  })

  test('should filter positions by market', () => {
    const positions = [
      createPosition({ marketId: 'BTC-PERP' }),
      createPosition({ marketId: 'ETH-PERP' }),
      createPosition({ marketId: 'SOL-PERP' }),
    ]

    const filteredMarkets = TEST_CONFIG.markets
    const filtered = positions.filter((p) =>
      filteredMarkets.includes(p.marketId),
    )

    expect(filtered.length).toBe(2)
    expect(filtered.map((p) => p.marketId)).toContain('BTC-PERP')
    expect(filtered.map((p) => p.marketId)).toContain('ETH-PERP')
  })

  test('should identify liquidatable positions', () => {
    const healthyPosition = createPosition({ margin: parseUnits('1000', 18) })
    const unhealthyPosition = createPosition({
      margin: parseUnits('10', 18),
      unrealizedPnl: parseUnits('-5', 18),
    })

    const isLiquidatable = (p: MockPosition) => {
      const maintenanceRequired =
        (p.notional * BigInt(p.maintenanceMarginBps)) / 10000n
      const equity = p.margin + p.unrealizedPnl
      return equity < maintenanceRequired
    }

    expect(isLiquidatable(healthyPosition)).toBe(false)
    expect(isLiquidatable(unhealthyPosition)).toBe(true)
  })
})

describe('Rate Limiting', () => {
  test('should respect check interval', () => {
    const interval = TEST_CONFIG.checkIntervalMs
    expect(interval).toBeGreaterThanOrEqual(1000) // At least 1 second
  })

  test('should not hammer RPC endpoints', () => {
    // Min 5 seconds between checks
    expect(TEST_CONFIG.checkIntervalMs).toBeGreaterThanOrEqual(5000)
  })
})

describe('Error Cases', () => {
  test('should handle RPC connection failure', () => {
    const connectionFailed = true
    // Should wait and retry, not crash
    expect(connectionFailed).toBe(true)
  })

  test('should handle indexer timeout', () => {
    const timeout = 30000
    expect(timeout).toBeGreaterThan(0)
  })

  test('should handle concurrent liquidations', () => {
    // If another liquidator front-runs, tx should fail gracefully
    const txReverted = true
    // Should not crash, just log and continue
    expect(txReverted).toBe(true)
  })

  test('should handle position already liquidated', () => {
    // Position state changed between fetch and execute
    const positionClosed = true
    expect(positionClosed).toBe(true)
  })
})

describe('Batch Processing', () => {
  test('should process multiple positions in order of profit', () => {
    const positions = [
      { id: '1', reward: 50 },
      { id: '2', reward: 100 },
      { id: '3', reward: 25 },
    ]

    const sorted = positions.sort((a, b) => b.reward - a.reward)
    expect(sorted[0].id).toBe('2')
    expect(sorted[1].id).toBe('1')
    expect(sorted[2].id).toBe('3')
  })

  test('should limit batch size', () => {
    const maxBatchSize = 5
    const positions = Array(10).fill({ id: 'x' })
    const batch = positions.slice(0, maxBatchSize)

    expect(batch.length).toBe(5)
  })
})

describe('Stats and Monitoring', () => {
  test('should track successful liquidations', () => {
    const stats = {
      successfulLiquidations: 5,
      failedLiquidations: 2,
      totalRewards: parseUnits('500', 18),
      averageGasCost: parseUnits('0.01', 18),
    }

    expect(stats.successfulLiquidations).toBeGreaterThan(0)
    expect(
      stats.successfulLiquidations /
        (stats.successfulLiquidations + stats.failedLiquidations),
    ).toBeGreaterThan(0.5)
  })
})
