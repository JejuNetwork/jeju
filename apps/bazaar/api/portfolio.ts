import { z } from 'zod'
import type { Position } from '../schemas/markets'
import { PositionSchema } from '../schemas/markets'

export const PositionsArraySchema = z.array(PositionSchema)

export interface PortfolioStats {
  totalValue: bigint
  totalPnL: bigint
  activePositionCount: number
  claimablePositionCount: number
  totalYesShares: bigint
  totalNoShares: bigint
}

export function calculateTotalValue(positions: Position[]): bigint {
  let total = 0n
  for (const pos of positions) {
    total += pos.yesShares + pos.noShares
  }
  return total
}

export function calculateTotalPnL(positions: Position[]): bigint {
  let total = 0n
  for (const pos of positions) {
    const currentValue = pos.yesShares + pos.noShares
    total += currentValue + pos.totalReceived - pos.totalSpent
  }
  return total
}

export function calculatePositionCurrentValue(position: Position): bigint {
  if (position.market.resolved) {
    return position.market.outcome ? position.yesShares : position.noShares
  }
  return position.yesShares + position.noShares
}

export function calculatePositionPnL(position: Position): bigint {
  return position.totalReceived - position.totalSpent
}

export function countActivePositions(positions: Position[]): number {
  let count = 0
  for (const pos of positions) {
    if (!pos.market.resolved) count++
  }
  return count
}

export function filterClaimablePositions(positions: Position[]): Position[] {
  return positions.filter((pos) => {
    if (pos.hasClaimed || !pos.market.resolved) return false
    if (pos.market.outcome === undefined) return false

    return pos.market.outcome ? pos.yesShares > 0n : pos.noShares > 0n
  })
}

export function filterActivePositions(positions: Position[]): Position[] {
  return positions.filter((pos) => !pos.market.resolved)
}

export function filterWinningPositions(positions: Position[]): Position[] {
  return positions.filter((pos) => {
    if (!pos.market.resolved) return false
    if (pos.market.outcome === undefined) return false

    return pos.market.outcome ? pos.yesShares > 0n : pos.noShares > 0n
  })
}

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

export function formatEthValue(value: bigint, decimals: number = 2): string {
  const ethValue = Number(value) / 1e18
  return ethValue.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function formatPortfolioPnL(pnl: bigint, decimals: number = 2): string {
  const prefix = pnl >= 0n ? '+' : ''
  return `${prefix}${formatEthValue(pnl, decimals)}`
}
