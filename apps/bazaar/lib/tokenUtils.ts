/**
 * Token Utility Functions
 */

import { formatUnits, parseUnits } from 'viem'

/**
 * Format a token amount with the given decimals
 */
export function formatTokenAmount(
  amount: bigint,
  decimals: number,
  displayDecimals = 4
): string {
  const formatted = formatUnits(amount, decimals)
  const num = parseFloat(formatted)
  
  if (num === 0) return '0'
  if (num < 0.0001) return '<0.0001'
  
  return num.toFixed(displayDecimals)
}

/**
 * Parse a token amount string to bigint
 */
export function parseTokenAmount(amount: string, decimals: number): bigint {
  return parseUnits(amount, decimals)
}

/**
 * Format a USD amount
 */
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00'
  if (amount < 0.01) return '<$0.01'
  
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Calculate USD value from token amount
 */
export function calculateUSDValue(
  amount: bigint,
  decimals: number,
  priceUSD: number = 0
): number {
  const formatted = formatUnits(amount, decimals)
  return parseFloat(formatted) * priceUSD
}
