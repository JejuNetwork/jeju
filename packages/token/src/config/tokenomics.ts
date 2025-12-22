/**
 * Tokenomics Utilities
 *
 * Generic utilities for token economics calculations.
 * Token-specific configurations should be in their own deployment files
 * (e.g., jeju-deployment.ts, or in vendor packages).
 */

import type { Address } from 'viem'
import type {
  FeeDistribution,
  TokenAllocation,
  TokenEconomics,
  VestingConfig,
  VestingSchedule,
} from '../types'
import {
  feeDistributionSchema,
  tokenAllocationSchema,
  tokenEconomicsSchema,
  ValidationError,
} from '../validation'

// =============================================================================
// COMMON CONSTANTS
// =============================================================================

/** One year in seconds */
export const ONE_YEAR = 365 * 24 * 60 * 60

/** One month in seconds (30 days) */
export const ONE_MONTH = 30 * 24 * 60 * 60

/** One day in seconds */
export const ONE_DAY = 24 * 60 * 60

/** One hour in seconds */
export const ONE_HOUR = 60 * 60

// =============================================================================
// DEFAULT FEE DISTRIBUTION
// =============================================================================

/**
 * Standard fee distribution for cross-chain tokens
 */
export const DEFAULT_FEE_DISTRIBUTION: FeeDistribution = {
  holders: 40, // To stakers
  creators: 20, // To protocol
  treasury: 20, // To DAO
  liquidityProviders: 10, // To LPs
  burn: 10, // Deflationary
}

/**
 * Validate fee distribution sums to 100%
 */
export function validateFeeDistribution(
  distribution: FeeDistribution,
): FeeDistribution {
  const result = feeDistributionSchema.safeParse(distribution)
  if (!result.success) {
    const errorMessages = result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ')
    throw new ValidationError(
      `Invalid fee distribution: ${errorMessages}`,
      result.error.issues,
    )
  }
  return result.data
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate token amount from percentage of total supply
 */
export function percentToTokens(totalSupply: bigint, percent: number): bigint {
  return (totalSupply * BigInt(Math.floor(percent * 100))) / 10000n
}

/**
 * Calculate token amount in wei from human-readable amount
 */
export function tokensToWei(tokens: bigint, decimals: number = 18): bigint {
  return tokens * 10n ** BigInt(decimals)
}

/**
 * Convert wei amount to human-readable tokens
 */
export function weiToTokens(wei: bigint, decimals: number = 18): bigint {
  return wei / 10n ** BigInt(decimals)
}

/**
 * Format token amount for display using bigint-safe arithmetic.
 * Uses millions (M) for values >= 1M, thousands (K) for values >= 1K.
 * Avoids Number() conversion to prevent precision loss for large values.
 */
export function formatTokens(tokens: bigint): string {
  // For very large values (> 1 trillion), use T suffix
  const trillions = tokens / 1_000_000_000_000n
  if (trillions > 0n) {
    const remainder = (tokens % 1_000_000_000_000n) / 100_000_000_000n
    return `${trillions.toString()}.${remainder.toString()}T`
  }

  // Use millions for all values >= 1 million (including billions)
  // This matches expected behavior where 1B displays as 1000.0M
  const millions = tokens / 1_000_000n
  if (millions > 0n) {
    const remainder = (tokens % 1_000_000n) / 100_000n
    return `${millions.toString()}.${remainder.toString()}M`
  }

  // Use thousands for values >= 1000
  const thousands = tokens / 1_000n
  if (thousands > 0n) {
    const remainder = (tokens % 1_000n) / 100n
    return `${thousands.toString()}.${remainder.toString()}K`
  }

  return tokens.toString()
}

/**
 * Format wei amount for display with decimals.
 * Uses bigint arithmetic to preserve precision for all values.
 */
export function formatWei(
  wei: bigint,
  decimals: number = 18,
  displayDecimals: number = 4,
): string {
  const divisor = 10n ** BigInt(decimals)
  const wholePart = wei / divisor

  // Handle case where no decimal places requested
  if (displayDecimals === 0) {
    return wholePart.toString()
  }

  const fractionalWei = wei % divisor

  // For the fractional part, scale to get displayDecimals precision
  const fractionalScale = 10n ** BigInt(displayDecimals)
  const fractionalPart = (fractionalWei * fractionalScale) / divisor

  // Always use bigint-safe string formatting to avoid precision loss
  const fractionalStr = fractionalPart.toString().padStart(displayDecimals, '0')
  return `${wholePart.toString()}.${fractionalStr}`
}

/**
 * Calculate vesting unlock schedule
 */
export function calculateVestingSchedule(
  vestingConfig: VestingSchedule,
  totalAmount: bigint,
): { month: number; unlocked: bigint; cumulative: bigint }[] {
  const schedule: { month: number; unlocked: bigint; cumulative: bigint }[] = []

  const cliffMonths = Math.floor(vestingConfig.cliffDuration / ONE_MONTH)
  const vestingMonths = Math.floor(vestingConfig.vestingDuration / ONE_MONTH)
  const tgeAmount =
    (totalAmount * BigInt(vestingConfig.tgeUnlockPercent)) / 100n
  const vestingAmount = totalAmount - tgeAmount

  let cumulative = tgeAmount

  // TGE unlock
  if (tgeAmount > 0n) {
    schedule.push({ month: 0, unlocked: tgeAmount, cumulative })
  }

  // Cliff period (no unlocks)
  for (let month = 1; month <= cliffMonths; month++) {
    schedule.push({ month, unlocked: 0n, cumulative })
  }

  // Vesting period
  const monthlyUnlock =
    vestingMonths > 0 ? vestingAmount / BigInt(vestingMonths) : 0n
  for (
    let month = cliffMonths + 1;
    month <= cliffMonths + vestingMonths;
    month++
  ) {
    cumulative += monthlyUnlock
    schedule.push({ month, unlocked: monthlyUnlock, cumulative })
  }

  return schedule
}

/**
 * Validate allocation percentages sum to 100%
 */
export function validateAllocation(
  allocation: TokenAllocation,
): TokenAllocation {
  const result = tokenAllocationSchema.safeParse(allocation)
  if (!result.success) {
    const errorMessages = result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ')
    throw new ValidationError(
      `Invalid token allocation: ${errorMessages}`,
      result.error.issues,
    )
  }
  return result.data
}

/**
 * Validate a complete token economics configuration
 */
export function validateTokenEconomicsConfig(
  config: TokenEconomics,
): TokenEconomics {
  const result = tokenEconomicsSchema.safeParse(config)
  if (!result.success) {
    const errorMessages = result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ')
    throw new ValidationError(
      `Invalid token economics: ${errorMessages}`,
      result.error.issues,
    )
  }
  // Safe to cast: we validated the input config which already has the correct TokenEconomics type
  return result.data as TokenEconomics
}

/**
 * Create a token economics configuration
 */
export function createTokenEconomics(
  name: string,
  symbol: string,
  totalSupply: bigint,
  allocation: TokenAllocation,
  vesting: VestingConfig,
  feeDistribution: FeeDistribution = DEFAULT_FEE_DISTRIBUTION,
  options: {
    decimals?: number
    transferFeeBps?: number
    bridgeFeeBps?: number
    swapFeeBps?: number
    maxWalletPercent?: number
    maxTxPercent?: number
    feeExemptAddresses?: Address[]
  } = {},
): TokenEconomics {
  return {
    name,
    symbol,
    decimals: options.decimals ?? 18,
    totalSupply,
    allocation,
    vesting,
    fees: {
      transferFeeBps: options.transferFeeBps ?? 0,
      bridgeFeeBps: options.bridgeFeeBps ?? 0,
      swapFeeBps: options.swapFeeBps ?? 30, // 0.3% standard
      distribution: feeDistribution,
      feeExemptAddresses: options.feeExemptAddresses ?? [],
    },
    maxWalletPercent: options.maxWalletPercent ?? 0,
    maxTxPercent: options.maxTxPercent ?? 0,
  }
}
