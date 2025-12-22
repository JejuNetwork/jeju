/**
 * Pure utility functions for liquidity vault calculations
 * Extracted for testability
 */

import { formatEther } from 'viem';

/**
 * Represents a parsed liquidity provider position
 */
export interface LPPosition {
  ethShares: bigint;
  ethValue: bigint;
  tokenShares: bigint;
  tokenValue: bigint;
  pendingFees: bigint;
  lpTokenBalance: string;
  sharePercent: number;
}

/**
 * Raw position data returned from the getLPPosition contract call (tuple format)
 */
export type RawPositionTuple = readonly [bigint, bigint, bigint, bigint, bigint];

/**
 * Calculate share percentage from shares and total supply.
 * Uses fixed-point arithmetic with 2 decimal places of precision.
 * 
 * @param shares - The user's LP shares
 * @param totalSupply - The total LP token supply
 * @returns The percentage of the pool the user owns (0-100 scale with 2 decimals)
 */
export function calculateSharePercent(shares: bigint, totalSupply: bigint): number {
  if (totalSupply <= 0n) {
    return 0;
  }
  // Multiply by 10000 for 2 decimal places, then divide by 100
  // This gives us a percentage with 2 decimal precision
  return Number((shares * 10000n) / totalSupply) / 100;
}

/**
 * Parse a position from the tuple format returned by getLPPosition
 * 
 * @param position - The raw position tuple [ethShares, ethValue, tokenShares, tokenValue, pendingFees]
 * @param totalSupply - The total LP token supply for share percentage calculation
 * @returns Parsed LP position
 */
export function parsePositionFromTuple(
  position: RawPositionTuple,
  totalSupply: bigint
): LPPosition {
  const [ethShares, ethValue, tokenShares, tokenValue, pendingFees] = position;
  
  return {
    ethShares,
    ethValue,
    tokenShares,
    tokenValue,
    pendingFees,
    lpTokenBalance: formatEther(ethShares),
    sharePercent: calculateSharePercent(ethShares, totalSupply),
  };
}

/**
 * Parse a position from ERC20 balance format (when getLPPosition is not available)
 * Assumes a simpler vault that only tracks ETH balance
 * 
 * @param balance - The user's LP token balance
 * @param totalSupply - The total LP token supply
 * @returns Parsed LP position with token-related fields zeroed
 */
export function parsePositionFromBalance(
  balance: bigint,
  totalSupply: bigint
): LPPosition {
  return {
    ethShares: balance,
    ethValue: balance,
    tokenShares: 0n,
    tokenValue: 0n,
    pendingFees: 0n,
    lpTokenBalance: formatEther(balance),
    sharePercent: calculateSharePercent(balance, totalSupply),
  };
}

/**
 * Parse LP position from either tuple or balance format
 * 
 * @param position - Optional tuple position from getLPPosition
 * @param balance - Optional ERC20 balance
 * @param totalSupply - Optional total supply
 * @returns Parsed LP position or null if no data available
 */
export function parseLPPosition(
  position: RawPositionTuple | undefined,
  balance: bigint | undefined,
  totalSupply: bigint | undefined
): LPPosition | null {
  // Prefer tuple format if available
  if (position && totalSupply !== undefined) {
    return parsePositionFromTuple(position, totalSupply);
  }
  
  // Fall back to balance format
  if (balance !== undefined && totalSupply !== undefined && totalSupply > 0n) {
    return parsePositionFromBalance(balance, totalSupply);
  }
  
  return null;
}
