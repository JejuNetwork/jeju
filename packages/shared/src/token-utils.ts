/**
 * Token Utility Functions
 * Consolidated from gateway and bazaar
 */

import { formatUnits, parseUnits } from 'viem'

/**
 * Format a token amount with the given decimals for display
 * Uses viem's formatUnits for precision
 */
export function formatTokenAmount(
  amount: bigint | string | number,
  decimals: number,
  displayDecimals = 4,
): string {
  const amountBigInt = typeof amount === 'bigint' ? amount : BigInt(amount)
  const formatted = formatUnits(amountBigInt, decimals)
  const num = parseFloat(formatted)

  if (num === 0) return '0'
  if (num < 10 ** -displayDecimals) {
    return `<${(10 ** -displayDecimals).toFixed(displayDecimals)}`
  }

  // Remove trailing zeros
  const fixed = num.toFixed(displayDecimals)
  return fixed.replace(/\.?0+$/, '')
}

/**
 * Parse a token amount string to bigint
 * Uses viem's parseUnits for precision
 */
export function parseTokenAmount(amount: string, decimals: number): bigint {
  return parseUnits(amount, decimals)
}

/**
 * Format a USD amount with $ symbol and proper formatting
 */
export function formatTokenUsd(amount: number, decimals = 2): string {
  if (amount === 0) return '$0.00'
  if (amount < 0.01) return '<$0.01'

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount)
}

/**
 * Calculate USD value from token amount and price
 */
export function calculateUsdValue(
  amount: bigint,
  decimals: number,
  priceUsd: number,
): number {
  const formatted = formatUnits(amount, decimals)
  return parseFloat(formatted) * priceUsd
}

/**
 * Format a token amount with symbol
 */
export function formatTokenWithSymbol(
  amount: bigint,
  decimals: number,
  symbol: string,
  displayDecimals = 4,
): string {
  return `${formatTokenAmount(amount, decimals, displayDecimals)} ${symbol}`
}

/**
 * Check if amount exceeds a threshold (for dust filtering)
 */
export function isSignificantAmount(
  amount: bigint,
  decimals: number,
  minUsdValue: number,
  priceUsd: number,
): boolean {
  const usdValue = calculateUsdValue(amount, decimals, priceUsd)
  return usdValue >= minUsdValue
}
