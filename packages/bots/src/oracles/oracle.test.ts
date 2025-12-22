/**
 * Oracle Tests
 */

import { describe, expect, test } from 'bun:test'
import { getTokenSymbol, OracleAggregator, TOKEN_SYMBOLS } from './index'

describe('OracleAggregator', () => {
  test('should initialize without errors', () => {
    const oracle = new OracleAggregator({})
    expect(oracle).toBeDefined()
  })

  test('should check price staleness', () => {
    const oracle = new OracleAggregator({})

    const freshPrice = {
      token: 'ETH',
      price: 300000000000n,
      decimals: 8,
      timestamp: Date.now(),
      source: 'pyth' as const,
    }

    const stalePrice = {
      token: 'ETH',
      price: 300000000000n,
      decimals: 8,
      timestamp: Date.now() - 120000, // 2 minutes ago
      source: 'pyth' as const,
    }

    expect(oracle.isStale(freshPrice, 60000)).toBe(false)
    expect(oracle.isStale(stalePrice, 60000)).toBe(true)
  })

  test('should calculate price deviation', () => {
    const oracle = new OracleAggregator({})

    const price1 = 100000000n // $1.00
    const price2 = 101000000n // $1.01

    const deviation = oracle.calculateDeviation(price1, price2)

    // ~1% deviation = ~99-100 bps (uses midpoint average)
    expect(deviation).toBeGreaterThanOrEqual(98)
    expect(deviation).toBeLessThanOrEqual(101)
  })

  test('should calculate deviation for larger differences', () => {
    const oracle = new OracleAggregator({})

    const price1 = 100000000n // $1.00
    const price2 = 110000000n // $1.10

    const deviation = oracle.calculateDeviation(price1, price2)

    // 10% deviation = ~952 bps (using midpoint)
    expect(deviation).toBeGreaterThan(900)
    expect(deviation).toBeLessThan(1100)
  })
})

describe('Token Symbols', () => {
  test('should have token symbols for major chains', () => {
    expect(TOKEN_SYMBOLS[1]).toBeDefined() // Ethereum
    expect(TOKEN_SYMBOLS[8453]).toBeDefined() // Base
    expect(TOKEN_SYMBOLS[42161]).toBeDefined() // Arbitrum
    expect(TOKEN_SYMBOLS[10]).toBeDefined() // Optimism
    expect(TOKEN_SYMBOLS[56]).toBeDefined() // BSC
  })

  test('should get token symbol by address', () => {
    const weth = getTokenSymbol('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 1)
    expect(weth).toBe('WETH')

    const usdc = getTokenSymbol('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 1)
    expect(usdc).toBe('USDC')
  })

  test('should return UNKNOWN for non-existent token', () => {
    const unknown = getTokenSymbol(
      '0x0000000000000000000000000000000000000000',
      1,
    )
    expect(unknown).toBe('UNKNOWN')
  })

  test('should handle case-insensitive addresses', () => {
    const lower = getTokenSymbol(
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      1,
    )
    expect(lower).toBe('WETH')
  })
})
