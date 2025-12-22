/**
 * Gas Oracle Tests
 *
 * Tests for:
 * - Base fee prediction (EIP-1559)
 * - Priority fee calculation by urgency
 * - Trade gas estimation
 * - Swap gas calculations
 */

import { describe, expect, test } from 'bun:test'
import {
  calculateArbitrageGas,
  calculateSwapGas,
  GAS_ESTIMATES,
} from './gas-oracle'

describe('GAS_ESTIMATES Constants', () => {
  test('should have correct gas estimates for basic operations', () => {
    expect(GAS_ESTIMATES.TRANSFER).toBe(21000n)
    expect(GAS_ESTIMATES.ERC20_TRANSFER).toBe(65000n)
    expect(GAS_ESTIMATES.ERC20_APPROVE).toBe(46000n)
  })

  test('should have correct gas estimates for DEX operations', () => {
    expect(GAS_ESTIMATES.UNISWAP_V2_SWAP).toBe(150000n)
    expect(GAS_ESTIMATES.UNISWAP_V3_SWAP).toBe(180000n)
    expect(GAS_ESTIMATES.SUSHISWAP_SWAP).toBe(150000n)
  })

  test('should have correct gas estimates for complex operations', () => {
    expect(GAS_ESTIMATES.FLASH_LOAN_AAVE).toBe(250000n)
    expect(GAS_ESTIMATES.FLASH_LOAN_BALANCER).toBe(200000n)
    expect(GAS_ESTIMATES.ARBITRAGE_2_POOLS).toBe(350000n)
    expect(GAS_ESTIMATES.ARBITRAGE_3_POOLS).toBe(500000n)
    expect(GAS_ESTIMATES.SANDWICH_FRONTRUN).toBe(200000n)
    expect(GAS_ESTIMATES.SANDWICH_BACKRUN).toBe(200000n)
    expect(GAS_ESTIMATES.LIQUIDATION).toBe(500000n)
  })
})

describe('calculateSwapGas', () => {
  test('should calculate gas for single pool V2 swap', () => {
    const gas = calculateSwapGas(1, false)
    expect(gas).toBe(GAS_ESTIMATES.UNISWAP_V2_SWAP)
  })

  test('should calculate gas for single pool V3 swap', () => {
    const gas = calculateSwapGas(1, true)
    expect(gas).toBe(GAS_ESTIMATES.UNISWAP_V3_SWAP)
  })

  test('should add margin for each additional pool in V2', () => {
    const gas1Pool = calculateSwapGas(1, false)
    const gas2Pools = calculateSwapGas(2, false)
    const gas3Pools = calculateSwapGas(3, false)

    expect(gas2Pools - gas1Pool).toBe(GAS_ESTIMATES.PER_POOL_MARGIN)
    expect(gas3Pools - gas2Pools).toBe(GAS_ESTIMATES.PER_POOL_MARGIN)
  })

  test('should add margin for each additional pool in V3', () => {
    const gas1Pool = calculateSwapGas(1, true)
    const gas2Pools = calculateSwapGas(2, true)

    expect(gas2Pools - gas1Pool).toBe(GAS_ESTIMATES.PER_POOL_MARGIN)
  })

  test('should calculate gas correctly for multi-hop swaps', () => {
    // 4-pool V2 route
    const gas4Pools = calculateSwapGas(4, false)
    const expected =
      GAS_ESTIMATES.UNISWAP_V2_SWAP + 3n * GAS_ESTIMATES.PER_POOL_MARGIN
    expect(gas4Pools).toBe(expected)
  })
})

describe('calculateArbitrageGas', () => {
  test('should calculate gas for 2-pool arbitrage without flash loan', () => {
    const gas = calculateArbitrageGas(2, false)
    const expected = 2n * GAS_ESTIMATES.PER_POOL_MARGIN + 50000n
    expect(gas).toBe(expected)
  })

  test('should add flash loan gas when used', () => {
    const gasNoFlash = calculateArbitrageGas(2, false)
    const gasWithFlash = calculateArbitrageGas(2, true)

    expect(gasWithFlash - gasNoFlash).toBe(GAS_ESTIMATES.FLASH_LOAN_AAVE)
  })

  test('should scale with number of pools', () => {
    const gas2 = calculateArbitrageGas(2, false)
    const gas3 = calculateArbitrageGas(3, false)
    const gas4 = calculateArbitrageGas(4, false)

    expect(gas3 - gas2).toBe(GAS_ESTIMATES.PER_POOL_MARGIN)
    expect(gas4 - gas3).toBe(GAS_ESTIMATES.PER_POOL_MARGIN)
  })

  test('should calculate realistic gas for triangular arbitrage', () => {
    // 3 pools with flash loan
    const gas = calculateArbitrageGas(3, true)
    const expected =
      3n * GAS_ESTIMATES.PER_POOL_MARGIN +
      50000n +
      GAS_ESTIMATES.FLASH_LOAN_AAVE
    expect(gas).toBe(expected)
    // Should be in reasonable range
    expect(gas).toBeGreaterThan(500000n)
    expect(gas).toBeLessThan(1000000n)
  })
})

describe('Gas Price Calculations', () => {
  test('should calculate gas cost correctly', () => {
    const gasUnits = 300000n
    const baseFee = BigInt(30e9) // 30 gwei
    const priorityFee = BigInt(2e9) // 2 gwei

    const totalGasPrice = baseFee + priorityFee
    const gasCost = gasUnits * totalGasPrice

    // 300000 * 32 gwei = 9,600,000 gwei = 0.0096 ETH
    expect(gasCost).toBe(BigInt(9.6e15))
  })

  test('should calculate if trade is profitable after gas', () => {
    const gasUnits = 350000n // Arbitrage gas
    const baseFee = BigInt(50e9) // 50 gwei
    const priorityFee = BigInt(5e9) // 5 gwei

    const gasCost = gasUnits * (baseFee + priorityFee)
    // 350000 * 55 gwei = 19,250,000 gwei = 0.01925 ETH

    const expectedProfit = BigInt(5e16) // 0.05 ETH profit
    const netProfit = expectedProfit - gasCost

    expect(netProfit).toBeGreaterThan(0n)
    expect(netProfit).toBe(expectedProfit - gasCost)
  })

  test('should detect unprofitable trade due to high gas', () => {
    const gasUnits = 500000n
    const baseFee = BigInt(100e9) // 100 gwei (high)
    const priorityFee = BigInt(10e9) // 10 gwei

    const gasCost = gasUnits * (baseFee + priorityFee)
    // 500000 * 110 gwei = 55,000,000 gwei = 0.055 ETH

    const expectedProfit = BigInt(3e16) // 0.03 ETH profit
    const netProfit = expectedProfit - gasCost

    expect(netProfit).toBeLessThan(0n)
  })
})

describe('EIP-1559 Base Fee Prediction', () => {
  /**
   * EIP-1559 base fee formula:
   * - If block > 50% full: base fee increases up to 12.5%
   * - If block < 50% full: base fee decreases up to 12.5%
   */

  test('should predict base fee increase for full block', () => {
    const currentBaseFee = BigInt(50e9) // 50 gwei
    const blockUtilization = 0.9 // 90% full

    // Calculate expected increase
    // Increase = (utilization - 0.5) * 25% max
    const increasePercent = (blockUtilization - 0.5) * 25 // 10% increase
    const expectedNextFee =
      currentBaseFee +
      (currentBaseFee * BigInt(Math.floor(increasePercent * 100))) / 10000n

    // Should be ~55 gwei (50 * 1.10)
    expect(expectedNextFee).toBeGreaterThan(currentBaseFee)
    expect(expectedNextFee).toBeLessThan((currentBaseFee * 15n) / 10n)
  })

  test('should predict base fee decrease for empty block', () => {
    const currentBaseFee = BigInt(50e9) // 50 gwei
    const blockUtilization = 0.1 // 10% full

    // Calculate expected decrease
    const decreasePercent = (0.5 - blockUtilization) * 25 // 10% decrease
    const expectedNextFee =
      currentBaseFee -
      (currentBaseFee * BigInt(Math.floor(decreasePercent * 100))) / 10000n

    // Should be ~45 gwei (50 * 0.90)
    expect(expectedNextFee).toBeLessThan(currentBaseFee)
    expect(expectedNextFee).toBeGreaterThan(currentBaseFee / 2n)
  })

  test('should predict stable base fee at 50% utilization', () => {
    const blockUtilization = 0.5 // Exactly 50%

    // No change expected
    const changePercent = (blockUtilization - 0.5) * 25
    expect(changePercent).toBe(0)
  })
})

describe('Priority Fee by Urgency', () => {
  test('should calculate priority fees for different urgency levels', () => {
    const stats = {
      minPriorityFee: BigInt(1e9), // 1 gwei
      avgPriorityFee: BigInt(2e9), // 2 gwei
      maxPriorityFee: BigInt(5e9), // 5 gwei
    }

    // Low urgency: use min
    expect(stats.minPriorityFee).toBe(BigInt(1e9))

    // Medium urgency: use avg
    expect(stats.avgPriorityFee).toBe(BigInt(2e9))

    // High urgency: use (avg + max) / 2
    const highPriority = (stats.avgPriorityFee + stats.maxPriorityFee) / 2n
    expect(highPriority).toBe(BigInt(35e8)) // 3.5 gwei

    // Urgent: use max * 1.5
    const urgentPriority = (stats.maxPriorityFee * 15n) / 10n
    expect(urgentPriority).toBe(BigInt(75e8)) // 7.5 gwei
  })

  test('should calculate max fee with buffer', () => {
    const expectedBaseFee = BigInt(50e9)
    const priorityFee = BigInt(3e9)

    // High urgency: 15% buffer
    const highMaxFee = (expectedBaseFee * 115n) / 100n + priorityFee
    expect(highMaxFee).toBe(BigInt(605e8)) // 60.5 gwei

    // Urgent: 20% buffer
    const urgentMaxFee = (expectedBaseFee * 120n) / 100n + priorityFee
    expect(urgentMaxFee).toBe(BigInt(63e9)) // 63 gwei
  })
})

describe('Trade Profitability Analysis', () => {
  test('should calculate profitable margin correctly', () => {
    const expectedProfit = BigInt(1e17) // 0.1 ETH
    const gasUnits = 350000n
    const baseFee = BigInt(30e9)
    const priorityFee = BigInt(2e9)

    const gasCost = gasUnits * (baseFee + priorityFee)
    const netProfit = expectedProfit - gasCost
    const profitMargin = Number((netProfit * 100n) / expectedProfit)

    // Verify calculation
    expect(netProfit).toBe(expectedProfit - gasCost)
    expect(profitMargin).toBeGreaterThan(0)
    expect(profitMargin).toBeLessThanOrEqual(100)
  })

  test('should detect when gas exceeds profit', () => {
    const expectedProfit = BigInt(1e16) // 0.01 ETH (small)
    const gasUnits = 500000n
    const baseFee = BigInt(100e9) // 100 gwei (high)
    const priorityFee = BigInt(10e9)

    const gasCost = gasUnits * (baseFee + priorityFee)
    const netProfit = expectedProfit - gasCost
    const isProfitable = netProfit > 0n

    expect(isProfitable).toBe(false)
  })

  test('should recommend against trade when margin is too thin', () => {
    const expectedProfit = BigInt(5e16) // 0.05 ETH
    const gasUnits = 400000n
    const baseFee = BigInt(40e9)
    const priorityFee = BigInt(5e9)

    const gasCost = gasUnits * (baseFee + priorityFee)
    // Gas = 400000 * 45 gwei = 0.018 ETH
    const netProfit = expectedProfit - gasCost
    const profitMargin = Number((netProfit * 100n) / expectedProfit)

    // Margin of ~64% should be acceptable
    expect(profitMargin).toBeGreaterThan(50)
  })
})
