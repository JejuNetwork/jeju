/**
 * Portfolio business logic
 * Handles aggregate portfolio calculations, position analysis, and P&L tracking
 */

import { z } from 'zod'
import { PositionSchema } from '../schemas/markets'
import type { Position } from '../types/markets'

// Input schema for position array
export const PositionsArraySchema = z.array(PositionSchema)

/**
 * Portfolio statistics result
 */
export interface PortfolioStats {
  totalValue: bigint
  totalPnL: bigint
  activePositionCount: number
  claimablePositionCount: number
  totalYesShares: bigint
  totalNoShares: bigint
}

/**
 * Calculate total portfolio value across all positions
 * Value = sum of all shares (YES + NO) for each position
 */
export function calculateTotalValue(positions: Position[]): bigint {
  let total = 0n
  for (const pos of positions) {
    total += pos.yesShares + pos.noShares
  }
  return total
}

/**
 * Calculate total unrealized P&L across all positions
 * P&L = current value + received - spent
 */
export function calculateTotalPnL(positions: Position[]): bigint {
  let total = 0n
  for (const pos of positions) {
    const currentValue = pos.yesShares + pos.noShares
    total += currentValue + pos.totalReceived - pos.totalSpent
  }
  return total
}

/**
 * Calculate the current value of a single position
 * For resolved markets: only winning side counts
 * For active markets: both sides count
 */
export function calculatePositionCurrentValue(position: Position): bigint {
  if (position.market.resolved) {
    return position.market.outcome ? position.yesShares : position.noShares
  }
  return position.yesShares + position.noShares
}

/**
 * Calculate P&L for a single position
 */
export function calculatePositionPnL(position: Position): bigint {
  return position.totalReceived - position.totalSpent
}

/**
 * Count active (unresolved) positions
 */
export function countActivePositions(positions: Position[]): number {
  let count = 0
  for (const pos of positions) {
    if (!pos.market.resolved) count++
  }
  return count
}

/**
 * Filter positions that are claimable (resolved, not claimed, has winning shares)
 */
export function filterClaimablePositions(positions: Position[]): Position[] {
  return positions.filter((pos) => {
    if (pos.hasClaimed || !pos.market.resolved) return false
    if (pos.market.outcome === undefined) return false

    return pos.market.outcome ? pos.yesShares > 0n : pos.noShares > 0n
  })
}

/**
 * Filter active (unresolved) positions
 */
export function filterActivePositions(positions: Position[]): Position[] {
  return positions.filter((pos) => !pos.market.resolved)
}

/**
 * Filter winning positions in resolved markets
 */
export function filterWinningPositions(positions: Position[]): Position[] {
  return positions.filter((pos) => {
    if (!pos.market.resolved) return false
    if (pos.market.outcome === undefined) return false

    return pos.market.outcome ? pos.yesShares > 0n : pos.noShares > 0n
  })
}

/**
 * Calculate aggregate portfolio statistics
 */
export function calculatePortfolioStats(positions: Position[]): PortfolioStats {
  let totalValue = 0n
  let totalPnL = 0n
  let activeCount = 0
  let claimableCount = 0
  let totalYesShares = 0n
  let totalNoShares = 0n

  for (const pos of positions) {
    const currentValue = pos.yesShares + pos.noShares
    totalValue += currentValue
    totalPnL += currentValue + pos.totalReceived - pos.totalSpent
    totalYesShares += pos.yesShares
    totalNoShares += pos.noShares

    if (!pos.market.resolved) {
      activeCount++
    } else if (!pos.hasClaimed && pos.market.outcome !== undefined) {
      const hasWinningShares = pos.market.outcome
        ? pos.yesShares > 0n
        : pos.noShares > 0n
      if (hasWinningShares) claimableCount++
    }
  }

  return {
    totalValue,
    totalPnL,
    activePositionCount: activeCount,
    claimablePositionCount: claimableCount,
    totalYesShares,
    totalNoShares,
  }
}

/**
 * Format value in wei to ETH string
 */
export function formatEthValue(value: bigint, decimals: number = 2): string {
  const ethValue = Number(value) / 1e18
  return ethValue.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Format P&L with sign prefix for portfolio display
 */
export function formatPortfolioPnL(pnl: bigint, decimals: number = 2): string {
  const prefix = pnl >= 0n ? '+' : ''
  return `${prefix}${formatEthValue(pnl, decimals)}`
}
