import { describe, expect, test } from 'bun:test'
import { parseEther } from 'viem'
import {
  calculateCost,
  calculateExpectedShares,
  calculateNoPrice,
  calculateYesPrice,
  formatPrice,
} from '../lmsrPricing'

describe('LMSR Pricing', () => {
  test('should calculate YES price for balanced market', () => {
    const yesShares = parseEther('100')
    const noShares = parseEther('100')
    const liquidityB = parseEther('100')

    const yesPrice = calculateYesPrice(yesShares, noShares, liquidityB)

    expect(Number(yesPrice)).toBeCloseTo(50 * 1e16, -14)
  })

  test('should calculate NO price as complement of YES', () => {
    const yesShares = parseEther('60')
    const noShares = parseEther('40')
    const liquidityB = parseEther('100')

    const yesPrice = calculateYesPrice(yesShares, noShares, liquidityB)
    const noPrice = calculateNoPrice(yesShares, noShares, liquidityB)

    expect(yesPrice + noPrice).toBe(BigInt(100 * 1e16))
  })

  test('should return higher YES price when more YES shares', () => {
    const yesShares1 = parseEther('50')
    const noShares1 = parseEther('50')

    const yesShares2 = parseEther('70')
    const noShares2 = parseEther('50')

    const liquidityB = parseEther('100')

    const price1 = calculateYesPrice(yesShares1, noShares1, liquidityB)
    const price2 = calculateYesPrice(yesShares2, noShares2, liquidityB)

    expect(price2).toBeGreaterThan(price1)
  })

  test('should calculate expected shares', () => {
    const amount = parseEther('1') // 1 ETH
    const currentPrice = BigInt(50 * 1e16) // 50%

    const expectedShares = calculateExpectedShares(amount, currentPrice)

    expect(expectedShares).toBeGreaterThan(0n)
    expect(Number(expectedShares)).toBeCloseTo(Number(parseEther('2')), -16)
  })

  test('should return 0 shares for 0 price', () => {
    const amount = parseEther('1')
    const currentPrice = 0n

    const expectedShares = calculateExpectedShares(amount, currentPrice)

    expect(expectedShares).toBe(0n)
  })

  test('should calculate cost for buying shares', () => {
    const sharesToBuy = parseEther('10')
    const yesShares = parseEther('50')
    const noShares = parseEther('50')
    const liquidityB = parseEther('100')

    const cost = calculateCost(
      sharesToBuy,
      yesShares,
      noShares,
      true,
      liquidityB,
    )

    expect(cost).toBeGreaterThan(0n)
  })

  test('should format price correctly', () => {
    const price = BigInt(65.5 * 1e16) // 65.5%

    const formatted = formatPrice(price, 1)

    expect(formatted).toBe('65.5%')
  })

  test('should format price with different decimals', () => {
    const price = BigInt(50.123 * 1e16)

    const formatted1 = formatPrice(price, 0)
    const formatted2 = formatPrice(price, 2)

    expect(formatted1).toBe('50%')
    expect(formatted2).toBe('50.12%')
  })

  test('should handle edge case: all YES shares', () => {
    const yesShares = parseEther('1000')
    const noShares = parseEther('0')
    const liquidityB = parseEther('100')

    const yesPrice = calculateYesPrice(yesShares, noShares, liquidityB)

    expect(Number(yesPrice)).toBeGreaterThan(99 * 1e16)
  })

  test('should handle edge case: all NO shares', () => {
    const yesShares = parseEther('0')
    const noShares = parseEther('1000')
    const liquidityB = parseEther('100')

    const yesPrice = calculateYesPrice(yesShares, noShares, liquidityB)
    const noPrice = calculateNoPrice(yesShares, noShares, liquidityB)

    expect(Number(yesPrice)).toBeLessThan(1 * 1e16)
    expect(Number(noPrice)).toBeGreaterThan(99 * 1e16)
  })
})
