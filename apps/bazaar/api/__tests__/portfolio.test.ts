import { describe, expect, test } from 'bun:test'
import { parseEther } from 'viem'
import type { Position } from '../../schemas/markets'
import {
  calculatePortfolioStats,
  calculatePositionCurrentValue,
  calculatePositionPnL,
  calculateTotalPnL,
  calculateTotalValue,
  countActivePositions,
  filterActivePositions,
  filterClaimablePositions,
  filterWinningPositions,
  formatEthValue,
  formatPortfolioPnL,
} from '../portfolio'

function createPosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'test-position',
    market: {
      sessionId: '0x1234',
      question: 'Test market?',
      resolved: false,
      outcome: null,
    },
    yesShares: 0n,
    noShares: 0n,
    totalSpent: 0n,
    totalReceived: 0n,
    hasClaimed: false,
    ...overrides,
  }
}

describe('calculateTotalValue', () => {
  test('should return 0 for empty positions', () => {
    expect(calculateTotalValue([])).toBe(0n)
  })

  test('should sum YES and NO shares for single position', () => {
    const positions = [
      createPosition({
        yesShares: parseEther('100'),
        noShares: parseEther('50'),
      }),
    ]
    expect(calculateTotalValue(positions)).toBe(parseEther('150'))
  })

  test('should sum across multiple positions', () => {
    const positions = [
      createPosition({ yesShares: parseEther('100'), noShares: 0n }),
      createPosition({ yesShares: 0n, noShares: parseEther('50') }),
      createPosition({
        yesShares: parseEther('25'),
        noShares: parseEther('25'),
      }),
    ]
    expect(calculateTotalValue(positions)).toBe(parseEther('200'))
  })

  test('should handle zero shares', () => {
    const positions = [
      createPosition({ yesShares: 0n, noShares: 0n }),
      createPosition({ yesShares: 0n, noShares: 0n }),
    ]
    expect(calculateTotalValue(positions)).toBe(0n)
  })
})

describe('calculateTotalPnL', () => {
  test('should return 0 for empty positions', () => {
    expect(calculateTotalPnL([])).toBe(0n)
  })

  test('should calculate profit for winning positions', () => {
    const positions = [
      createPosition({
        yesShares: parseEther('100'),
        noShares: 0n,
        totalSpent: parseEther('60'),
        totalReceived: 0n,
      }),
    ]
    // PnL = (100 + 0) + 0 - 60 = 40
    expect(calculateTotalPnL(positions)).toBe(parseEther('40'))
  })

  test('should calculate loss for losing positions', () => {
    const positions = [
      createPosition({
        yesShares: 0n,
        noShares: 0n,
        totalSpent: parseEther('100'),
        totalReceived: parseEther('50'),
      }),
    ]
    // PnL = (0 + 0) + 50 - 100 = -50
    expect(calculateTotalPnL(positions)).toBe(-parseEther('50'))
  })

  test('should aggregate P&L across positions', () => {
    const positions = [
      createPosition({
        yesShares: parseEther('100'),
        noShares: 0n,
        totalSpent: parseEther('60'),
        totalReceived: 0n,
      }),
      createPosition({
        yesShares: 0n,
        noShares: parseEther('50'),
        totalSpent: parseEther('30'),
        totalReceived: parseEther('50'),
      }),
    ]
    // Pos 1: 100 + 0 - 60 = 40
    // Pos 2: 50 + 50 - 30 = 70
    // Total: 110
    expect(calculateTotalPnL(positions)).toBe(parseEther('110'))
  })
})

describe('calculatePositionCurrentValue', () => {
  test('should return both shares for active market', () => {
    const position = createPosition({
      yesShares: parseEther('100'),
      noShares: parseEther('50'),
      market: {
        sessionId: '0x1',
        question: 'Test?',
        resolved: false,
        outcome: null,
      },
    })
    expect(calculatePositionCurrentValue(position)).toBe(parseEther('150'))
  })

  test('should return YES shares for resolved YES market', () => {
    const position = createPosition({
      yesShares: parseEther('100'),
      noShares: parseEther('50'),
      market: {
        sessionId: '0x1',
        question: 'Test?',
        resolved: true,
        outcome: true,
      },
    })
    expect(calculatePositionCurrentValue(position)).toBe(parseEther('100'))
  })

  test('should return NO shares for resolved NO market', () => {
    const position = createPosition({
      yesShares: parseEther('100'),
      noShares: parseEther('50'),
      market: {
        sessionId: '0x1',
        question: 'Test?',
        resolved: true,
        outcome: false,
      },
    })
    expect(calculatePositionCurrentValue(position)).toBe(parseEther('50'))
  })
})

describe('calculatePositionPnL', () => {
  test('should calculate profit', () => {
    const position = createPosition({
      totalSpent: parseEther('60'),
      totalReceived: parseEther('100'),
    })
    expect(calculatePositionPnL(position)).toBe(parseEther('40'))
  })

  test('should calculate loss', () => {
    const position = createPosition({
      totalSpent: parseEther('100'),
      totalReceived: parseEther('60'),
    })
    expect(calculatePositionPnL(position)).toBe(-parseEther('40'))
  })

  test('should handle breakeven', () => {
    const position = createPosition({
      totalSpent: parseEther('100'),
      totalReceived: parseEther('100'),
    })
    expect(calculatePositionPnL(position)).toBe(0n)
  })
})

describe('countActivePositions', () => {
  test('should return 0 for empty array', () => {
    expect(countActivePositions([])).toBe(0)
  })

  test('should count only active positions', () => {
    const positions = [
      createPosition({
        market: {
          sessionId: '0x1',
          question: 'A?',
          resolved: false,
          outcome: null,
        },
      }),
      createPosition({
        market: {
          sessionId: '0x2',
          question: 'B?',
          resolved: true,
          outcome: true,
        },
      }),
      createPosition({
        market: {
          sessionId: '0x3',
          question: 'C?',
          resolved: false,
          outcome: null,
        },
      }),
    ]
    expect(countActivePositions(positions)).toBe(2)
  })

  test('should return 0 when all resolved', () => {
    const positions = [
      createPosition({
        market: {
          sessionId: '0x1',
          question: 'A?',
          resolved: true,
          outcome: true,
        },
      }),
      createPosition({
        market: {
          sessionId: '0x2',
          question: 'B?',
          resolved: true,
          outcome: false,
        },
      }),
    ]
    expect(countActivePositions(positions)).toBe(0)
  })
})

describe('filterClaimablePositions', () => {
  test('should return empty for empty array', () => {
    expect(filterClaimablePositions([])).toEqual([])
  })

  test('should filter claimable YES winners', () => {
    const positions = [
      createPosition({
        id: 'claimable',
        yesShares: parseEther('100'),
        market: {
          sessionId: '0x1',
          question: 'A?',
          resolved: true,
          outcome: true,
        },
        hasClaimed: false,
      }),
      createPosition({
        id: 'already-claimed',
        yesShares: parseEther('50'),
        market: {
          sessionId: '0x2',
          question: 'B?',
          resolved: true,
          outcome: true,
        },
        hasClaimed: true,
      }),
    ]
    const result = filterClaimablePositions(positions)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('claimable')
  })

  test('should filter claimable NO winners', () => {
    const positions = [
      createPosition({
        id: 'claimable',
        noShares: parseEther('100'),
        market: {
          sessionId: '0x1',
          question: 'A?',
          resolved: true,
          outcome: false,
        },
        hasClaimed: false,
      }),
    ]
    const result = filterClaimablePositions(positions)
    expect(result.length).toBe(1)
  })

  test('should exclude losing positions', () => {
    const positions = [
      createPosition({
        yesShares: parseEther('100'),
        noShares: 0n,
        market: {
          sessionId: '0x1',
          question: 'A?',
          resolved: true,
          outcome: false,
        },
        hasClaimed: false,
      }),
    ]
    expect(filterClaimablePositions(positions)).toEqual([])
  })

  test('should exclude active positions', () => {
    const positions = [
      createPosition({
        yesShares: parseEther('100'),
        market: {
          sessionId: '0x1',
          question: 'A?',
          resolved: false,
          outcome: null,
        },
        hasClaimed: false,
      }),
    ]
    expect(filterClaimablePositions(positions)).toEqual([])
  })
})

describe('filterActivePositions', () => {
  test('should return only active positions', () => {
    const positions = [
      createPosition({
        id: 'active',
        market: {
          sessionId: '0x1',
          question: 'A?',
          resolved: false,
          outcome: null,
        },
      }),
      createPosition({
        id: 'resolved',
        market: {
          sessionId: '0x2',
          question: 'B?',
          resolved: true,
          outcome: true,
        },
      }),
    ]
    const result = filterActivePositions(positions)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('active')
  })
})

describe('filterWinningPositions', () => {
  test('should return winners with YES shares when YES wins', () => {
    const positions = [
      createPosition({
        id: 'winner',
        yesShares: parseEther('100'),
        noShares: 0n,
        market: {
          sessionId: '0x1',
          question: 'A?',
          resolved: true,
          outcome: true,
        },
      }),
      createPosition({
        id: 'loser',
        yesShares: 0n,
        noShares: parseEther('100'),
        market: {
          sessionId: '0x2',
          question: 'B?',
          resolved: true,
          outcome: true,
        },
      }),
    ]
    const result = filterWinningPositions(positions)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('winner')
  })

  test('should return winners with NO shares when NO wins', () => {
    const positions = [
      createPosition({
        id: 'winner',
        noShares: parseEther('100'),
        market: {
          sessionId: '0x1',
          question: 'A?',
          resolved: true,
          outcome: false,
        },
      }),
    ]
    const result = filterWinningPositions(positions)
    expect(result.length).toBe(1)
  })

  test('should exclude active positions', () => {
    const positions = [
      createPosition({
        yesShares: parseEther('100'),
        market: {
          sessionId: '0x1',
          question: 'A?',
          resolved: false,
          outcome: null,
        },
      }),
    ]
    expect(filterWinningPositions(positions)).toEqual([])
  })
})

describe('calculatePortfolioStats', () => {
  test('should return zeros for empty portfolio', () => {
    const stats = calculatePortfolioStats([])
    expect(stats.totalValue).toBe(0n)
    expect(stats.totalPnL).toBe(0n)
    expect(stats.activePositionCount).toBe(0)
    expect(stats.claimablePositionCount).toBe(0)
    expect(stats.totalYesShares).toBe(0n)
    expect(stats.totalNoShares).toBe(0n)
  })

  test('should calculate complete stats', () => {
    const positions = [
      createPosition({
        yesShares: parseEther('100'),
        noShares: 0n,
        totalSpent: parseEther('60'),
        totalReceived: 0n,
        market: {
          sessionId: '0x1',
          question: 'A?',
          resolved: false,
          outcome: null,
        },
      }),
      createPosition({
        yesShares: parseEther('50'),
        noShares: 0n,
        totalSpent: parseEther('30'),
        totalReceived: 0n,
        market: {
          sessionId: '0x2',
          question: 'B?',
          resolved: true,
          outcome: true,
        },
        hasClaimed: false,
      }),
      createPosition({
        yesShares: 0n,
        noShares: parseEther('25'),
        totalSpent: parseEther('15'),
        totalReceived: parseEther('25'),
        market: {
          sessionId: '0x3',
          question: 'C?',
          resolved: true,
          outcome: false,
        },
        hasClaimed: false,
      }),
    ]

    const stats = calculatePortfolioStats(positions)

    expect(stats.totalValue).toBe(parseEther('175')) // 100 + 50 + 25
    expect(stats.totalYesShares).toBe(parseEther('150')) // 100 + 50
    expect(stats.totalNoShares).toBe(parseEther('25'))
    expect(stats.activePositionCount).toBe(1)
    expect(stats.claimablePositionCount).toBe(2) // Both resolved with winning shares
  })

  test('should handle claimed positions correctly', () => {
    const positions = [
      createPosition({
        yesShares: parseEther('50'),
        market: {
          sessionId: '0x1',
          question: 'A?',
          resolved: true,
          outcome: true,
        },
        hasClaimed: true,
      }),
    ]

    const stats = calculatePortfolioStats(positions)
    expect(stats.claimablePositionCount).toBe(0)
  })
})

describe('formatEthValue', () => {
  test('should format with default decimals', () => {
    const value = parseEther('1234.56')
    const formatted = formatEthValue(value)
    expect(formatted).toContain('1,234.56')
  })

  test('should format with custom decimals', () => {
    const value = parseEther('100.123456')
    expect(formatEthValue(value, 0)).toContain('100')
    expect(formatEthValue(value, 4)).toContain('100.1235')
  })

  test('should handle zero', () => {
    expect(formatEthValue(0n, 2)).toContain('0.00')
  })

  test('should handle large numbers', () => {
    const value = parseEther('1000000')
    expect(formatEthValue(value, 0)).toContain('1,000,000')
  })
})

describe('formatPortfolioPnL', () => {
  test('should add + prefix for positive values', () => {
    const pnl = parseEther('50')
    const formatted = formatPortfolioPnL(pnl)
    expect(formatted.startsWith('+')).toBe(true)
  })

  test('should show negative values with - prefix', () => {
    const pnl = -parseEther('50')
    const formatted = formatPortfolioPnL(pnl)
    expect(formatted.startsWith('-')).toBe(true)
  })

  test('should show + for zero', () => {
    const formatted = formatPortfolioPnL(0n)
    expect(formatted.startsWith('+')).toBe(true)
  })
})
