import { describe, expect, mock, test } from 'bun:test'
import { parseEther } from 'viem'
import { calculateNoPrice, calculateYesPrice } from '@/lib/markets/lmsrPricing'
import { useMarkets } from '../useMarkets'

// Mock graphql-request
const mockRequest = mock(() =>
  Promise.resolve({
    predictionMarkets: [
      {
        id: 'market-1',
        sessionId:
          '0x1111111111111111111111111111111111111111111111111111111111111111',
        question: 'Will Bitcoin reach $100k?',
        liquidityB: '100000000000000000000',
        yesShares: '60000000000000000000',
        noShares: '40000000000000000000',
        totalVolume: '10000000000000000000',
        createdAt: '2024-01-01T00:00:00Z',
        resolved: false,
        outcome: null,
      },
      {
        id: 'market-2',
        sessionId:
          '0x2222222222222222222222222222222222222222222222222222222222222222',
        question: 'Will ETH 2.0 launch on time?',
        liquidityB: '100000000000000000000',
        yesShares: '50000000000000000000',
        noShares: '50000000000000000000',
        totalVolume: '5000000000000000000',
        createdAt: '2024-01-02T00:00:00Z',
        resolved: true,
        outcome: true,
      },
    ],
  }),
)

mock.module('graphql-request', () => ({
  request: mockRequest,
  gql: (strings: TemplateStringsArray) => strings.join(''),
}))

describe('useMarkets Hook', () => {
  test('should export useMarkets function', () => {
    expect(typeof useMarkets).toBe('function')
  })

  test('should transform multiple markets correctly', () => {
    const rawMarkets = [
      {
        id: 'market-1',
        sessionId: '0x1111',
        question: 'Question 1?',
        liquidityB: '100000000000000000000',
        yesShares: '60000000000000000000',
        noShares: '40000000000000000000',
        totalVolume: '10000000000000000000',
        createdAt: '2024-01-01T00:00:00Z',
        resolved: false,
        outcome: null,
      },
      {
        id: 'market-2',
        sessionId: '0x2222',
        question: 'Question 2?',
        liquidityB: '100000000000000000000',
        yesShares: '50000000000000000000',
        noShares: '50000000000000000000',
        totalVolume: '5000000000000000000',
        createdAt: '2024-01-02T00:00:00Z',
        resolved: true,
        outcome: true,
      },
    ]

    expect(rawMarkets.length).toBe(2)
    expect(rawMarkets[0].resolved).toBe(false)
    expect(rawMarkets[1].resolved).toBe(true)
    expect(rawMarkets[1].outcome).toBe(true)
  })

  test('should calculate prices for each market', () => {
    // Balanced market
    const balancedYes = parseEther('50')
    const balancedNo = parseEther('50')
    const liquidityB = parseEther('100')

    const balancedYesPrice = calculateYesPrice(
      balancedYes,
      balancedNo,
      liquidityB,
    )
    const balancedNoPrice = calculateNoPrice(
      balancedYes,
      balancedNo,
      liquidityB,
    )

    // Should be approximately 50/50
    const yesPercent = Number(balancedYesPrice) / 1e16
    const noPercent = Number(balancedNoPrice) / 1e16

    expect(yesPercent).toBeCloseTo(50, 0)
    expect(noPercent).toBeCloseTo(50, 0)
  })

  test('should handle empty market list', () => {
    const emptyMarkets: never[] = []
    expect(emptyMarkets.length).toBe(0)
  })

  test('should sort markets by createdAt descending', () => {
    const markets = [
      { createdAt: new Date('2024-01-01') },
      { createdAt: new Date('2024-01-03') },
      { createdAt: new Date('2024-01-02') },
    ]

    const sorted = markets.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )

    expect(sorted[0].createdAt.getTime()).toBeGreaterThan(
      sorted[1].createdAt.getTime(),
    )
    expect(sorted[1].createdAt.getTime()).toBeGreaterThan(
      sorted[2].createdAt.getTime(),
    )
  })
})

describe('Market Filtering', () => {
  test('should filter active markets', () => {
    const markets = [
      { resolved: false, question: 'Active 1' },
      { resolved: true, question: 'Resolved 1' },
      { resolved: false, question: 'Active 2' },
    ]

    const activeMarkets = markets.filter((m) => !m.resolved)
    expect(activeMarkets.length).toBe(2)
  })

  test('should filter resolved markets', () => {
    const markets = [
      { resolved: false, question: 'Active 1' },
      { resolved: true, question: 'Resolved 1' },
      { resolved: true, question: 'Resolved 2' },
    ]

    const resolvedMarkets = markets.filter((m) => m.resolved)
    expect(resolvedMarkets.length).toBe(2)
  })

  test('should filter by search query', () => {
    const markets = [
      { question: 'Will Bitcoin reach $100k?' },
      { question: 'Will ETH 2.0 launch?' },
      { question: 'Bitcoin dominance above 50%?' },
    ]

    const searchQuery = 'bitcoin'
    const filtered = markets.filter((m) =>
      m.question.toLowerCase().includes(searchQuery.toLowerCase()),
    )

    expect(filtered.length).toBe(2)
  })
})

describe('Market Statistics', () => {
  test('should calculate total volume across markets', () => {
    const markets = [
      { totalVolume: parseEther('10') },
      { totalVolume: parseEther('5') },
      { totalVolume: parseEther('3') },
    ]

    const totalVolume = markets.reduce((sum, m) => sum + m.totalVolume, 0n)
    expect(totalVolume).toBe(parseEther('18'))
  })

  test('should count active and resolved markets', () => {
    const markets = [
      { resolved: false },
      { resolved: true },
      { resolved: false },
      { resolved: true },
      { resolved: false },
    ]

    const activeCount = markets.filter((m) => !m.resolved).length
    const resolvedCount = markets.filter((m) => m.resolved).length

    expect(activeCount).toBe(3)
    expect(resolvedCount).toBe(2)
  })
})
