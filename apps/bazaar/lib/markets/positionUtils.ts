/**
 * Position utility functions for prediction markets
 * Handles value calculations, P&L, and validation
 */

import { parseEther } from 'viem'

const _ONE_SHARE = parseEther('1')
const MIN_TRADE_AMOUNT = parseEther('0.001')
const MAX_SLIPPAGE_BPS = 5000n // 50%

/**
 * Calculate the current value of a position based on shares and current price
 * @param shares - Number of shares held (in wei)
 * @param currentPrice - Current price as percentage with 16 decimals (50% = 50 * 1e16)
 * @returns Position value in wei
 */
export function calculatePositionValue(
  shares: bigint,
  currentPrice: bigint,
): bigint {
  if (shares === 0n || currentPrice === 0n) return 0n
  // Value = shares * (price / 100), where price is in percentage with 16 decimals
  return (shares * currentPrice) / (100n * BigInt(1e16))
}

/**
 * Calculate the potential payout if the position wins
 * Winning shares pay 1:1 (1 share = 1 token)
 * @param shares - Number of shares held (in wei)
 * @returns Potential payout in wei
 */
export function calculatePotentialPayout(shares: bigint): bigint {
  return shares
}

/**
 * Calculate realized P&L for a closed/claimed position
 * @param totalReceived - Total amount received from claims/sales
 * @param totalSpent - Total amount spent on purchases
 * @returns Realized P&L (positive = profit, negative = loss)
 */
export function calculateRealizedPnL(
  totalReceived: bigint,
  totalSpent: bigint,
): bigint {
  return totalReceived - totalSpent
}

/**
 * Calculate unrealized P&L for an open position
 * @param currentValue - Current market value of the position
 * @param totalSpent - Total amount spent on purchases
 * @returns Unrealized P&L (positive = profit, negative = loss)
 */
export function calculateUnrealizedPnL(
  currentValue: bigint,
  totalSpent: bigint,
): bigint {
  return currentValue - totalSpent
}

/**
 * Check if a position is a winning position in a resolved market
 * @param hasYesShares - Whether the position has YES shares
 * @param hasNoShares - Whether the position has NO shares
 * @param marketOutcome - The market outcome (true = YES won, false = NO won)
 * @returns True if the position is a winner
 */
export function isWinningPosition(
  hasYesShares: boolean,
  hasNoShares: boolean,
  marketOutcome: boolean,
): boolean {
  if (marketOutcome) {
    return hasYesShares
  }
  return hasNoShares
}

/**
 * Format share amount for display
 * @param shares - Share amount in wei
 * @param decimals - Number of decimal places to show
 * @returns Formatted string
 */
export function formatShareAmount(
  shares: bigint,
  decimals: number = 2,
): string {
  const shareNumber = Number(shares) / 1e18
  return shareNumber.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Validate trade amount
 * @param amount - Trade amount in wei
 * @returns True if amount is valid for trading
 * @throws Error if amount is invalid
 */
export function validateTradeAmount(amount: bigint): boolean {
  if (amount <= 0n) {
    throw new Error('Trade amount must be positive')
  }
  if (amount < MIN_TRADE_AMOUNT) {
    throw new Error(
      `Minimum trade amount is ${Number(MIN_TRADE_AMOUNT) / 1e18}`,
    )
  }
  return true
}

/**
 * Validate slippage tolerance
 * @param slippageBps - Slippage in basis points (100 = 1%)
 * @returns True if slippage is valid
 * @throws Error if slippage is invalid
 */
export function validateSlippage(slippageBps: bigint): boolean {
  if (slippageBps < 0n) {
    throw new Error('Slippage cannot be negative')
  }
  if (slippageBps > MAX_SLIPPAGE_BPS) {
    throw new Error('Slippage cannot exceed 50%')
  }
  return true
}

/**
 * Calculate minimum shares to receive with slippage
 * @param expectedShares - Expected shares from calculation
 * @param slippageBps - Slippage tolerance in basis points
 * @returns Minimum acceptable shares
 */
export function calculateMinShares(
  expectedShares: bigint,
  slippageBps: bigint,
): bigint {
  validateSlippage(slippageBps)
  return (expectedShares * (10000n - slippageBps)) / 10000n
}
