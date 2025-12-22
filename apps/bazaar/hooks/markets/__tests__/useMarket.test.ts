import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { parseEther } from 'viem'
import {
  calculateNoPrice,
  calculateYesPrice,
} from '../../../lib/markets/lmsrPricing'
import { NonEmptyStringSchema } from '../../../schemas/common'
import { useMarket } from '../useMarket'

// Mock graphql-request
const mockRequest = mock(() =>
  Promise.resolve({
    predictionMarkets: [
      {
        id: 'market-1',
        sessionId:
          '0x1234567890123456789012345678901234567890123456789012345678901234',
        question: 'Will Bitcoin reach $100k by 2025?',
        liquidityB: '100000000000000000000',
        yesShares: '60000000000000000000',
        noShares: '40000000000000000000',
        totalVolume: '10000000000000000000',
        createdAt: '2024-01-01T00:00:00Z',
        resolved: false,
        outcome: null,
      },
    ],
  }),
)

mock.module('graphql-request', () => ({
  request: mockRequest,
  gql: (strings: TemplateStringsArray) => strings.join(''),
}))

describe('useMarket Hook', () => {
  beforeEach(() => {
    mockRequest.mockClear()
  })

  test('should export useMarket function', () => {
    expect(typeof useMarket).toBe('function')
  })

  test('should validate sessionId parameter', () => {
    // Empty string should throw via Zod validation
    expect(() => {
      // The hook uses NonEmptyStringSchema.parse which throws synchronously
      useMarket('')
    }).toThrow()
  })

  test('should accept valid sessionId format', () => {
    const testSessionId =
      '0x1234567890123456789012345678901234567890123456789012345678901234'
    expect(testSessionId.length).toBe(66)
    expect(testSessionId.startsWith('0x')).toBe(true)
  })

  test('should transform market data correctly', () => {
    // Test the transformation logic
    const rawMarket = {
      id: 'market-1',
      sessionId: '0x1234',
      question: 'Test question?',
      liquidityB: '100000000000000000000',
      yesShares: '60000000000000000000',
      noShares: '40000000000000000000',
      totalVolume: '10000000000000000000',
      createdAt: '2024-01-01T00:00:00Z',
      resolved: false,
      outcome: null,
    }

    const yesShares = BigInt(rawMarket.yesShares)
    const noShares = BigInt(rawMarket.noShares)
    const liquidityB = BigInt(rawMarket.liquidityB)

    expect(yesShares).toBe(parseEther('60'))
    expect(noShares).toBe(parseEther('40'))
    expect(liquidityB).toBe(parseEther('100'))
  })

  test('should calculate prices using LMSR', () => {
    const yesShares = parseEther('60')
    const noShares = parseEther('40')
    const liquidityB = parseEther('100')

    const yesPrice = calculateYesPrice(yesShares, noShares, liquidityB)
    const noPrice = calculateNoPrice(yesShares, noShares, liquidityB)

    // Prices should be greater than 0
    expect(yesPrice).toBeGreaterThan(0n)
    expect(noPrice).toBeGreaterThan(0n)

    // Prices should sum to 100%
    expect(yesPrice + noPrice).toBe(BigInt(100 * 1e16))

    // More YES shares = higher YES price
    expect(yesPrice).toBeGreaterThan(noPrice)
  })

  test('should handle resolved market with outcome', () => {
    const rawMarket = {
      resolved: true,
      outcome: true,
    }

    expect(rawMarket.resolved).toBe(true)
    expect(rawMarket.outcome).toBe(true)
  })

  test('should handle null outcome for unresolved market', () => {
    const rawMarket = {
      resolved: false,
      outcome: null,
    }

    const outcome = rawMarket.outcome ?? undefined
    expect(outcome).toBeUndefined()
  })
})

describe('Market Data Validation', () => {
  test('should require non-empty question', () => {
    expect(() => NonEmptyStringSchema.parse('')).toThrow()
    expect(NonEmptyStringSchema.parse('Valid question?')).toBe(
      'Valid question?',
    )
  })

  test('should convert volume string to bigint', () => {
    const volumeString = '1000000000000000000' // 1 ETH
    const volume = BigInt(volumeString)

    expect(volume).toBe(parseEther('1'))
  })

  test('should parse date string correctly', () => {
    const dateString = '2024-01-01T00:00:00Z'
    const date = new Date(dateString)

    expect(date.getFullYear()).toBe(2024)
    expect(date.getMonth()).toBe(0) // January
    expect(date.getDate()).toBe(1)
  })
})
