/**
 * Launchpad business logic and utilities
 * Handles bonding curve calculations, ICO logic, and related pure functions
 */

import { AddressSchema } from '@jejunetwork/types'
import { formatEther } from 'viem'
import { z } from 'zod'

// SCHEMAS

export const BondingCurveConfigSchema = z.object({
  virtualEthReserves: z
    .string()
    .refine((val) => parseFloat(val) > 0, 'Must be positive'),
  graduationTarget: z
    .string()
    .refine((val) => parseFloat(val) > 0, 'Must be positive'),
  tokenSupply: z
    .string()
    .refine((val) => parseFloat(val) > 0, 'Must be positive'),
})

export type BondingCurveConfig = z.infer<typeof BondingCurveConfigSchema>

export const ICOConfigSchema = z
  .object({
    presaleAllocationBps: z.number().int().min(0).max(10000),
    presalePrice: z
      .string()
      .refine((val) => parseFloat(val) > 0, 'Must be positive'),
    lpFundingBps: z.number().int().min(0).max(10000),
    lpLockDuration: z.number().int().min(0),
    buyerLockDuration: z.number().int().min(0),
    softCap: z
      .string()
      .refine((val) => parseFloat(val) > 0, 'Must be positive'),
    hardCap: z
      .string()
      .refine((val) => parseFloat(val) > 0, 'Must be positive'),
    presaleDuration: z.number().int().min(0),
  })
  .refine((data) => parseFloat(data.hardCap) >= parseFloat(data.softCap), {
    message: 'Hard cap must be >= soft cap',
    path: ['hardCap'],
  })

export type ICOConfig = z.infer<typeof ICOConfigSchema>

export const BondingCurveStatsSchema = z.object({
  price: z.bigint(),
  progress: z.number().int().min(0).max(10000),
  ethCollected: z.bigint(),
  tokensRemaining: z.bigint(),
  graduated: z.boolean(),
  marketCap: z.bigint(),
})

export type BondingCurveStats = z.infer<typeof BondingCurveStatsSchema>

export const PresaleStatusSchema = z.object({
  raised: z.bigint(),
  participants: z.bigint(),
  progress: z.number().int().min(0).max(10000),
  timeRemaining: z.bigint(),
  isActive: z.boolean(),
  isFinalized: z.boolean(),
  isFailed: z.boolean(),
})

export type PresaleStatus = z.infer<typeof PresaleStatusSchema>

export const UserContributionSchema = z.object({
  ethAmount: z.bigint(),
  tokenAllocation: z.bigint(),
  claimedTokens: z.bigint(),
  claimable: z.bigint(),
  isRefunded: z.boolean(),
})

export type UserContribution = z.infer<typeof UserContributionSchema>

export const LaunchTypeSchema = z.enum(['bonding', 'ico'])
export type LaunchType = z.infer<typeof LaunchTypeSchema>

export const LaunchInfoSchema = z.object({
  id: z.bigint(),
  creator: AddressSchema,
  token: AddressSchema,
  launchType: LaunchTypeSchema,
  creatorFeeBps: z.number().int().min(0).max(10000),
  communityFeeBps: z.number().int().min(0).max(10000),
  bondingCurve: AddressSchema.nullable(),
  presale: AddressSchema.nullable(),
  lpLocker: AddressSchema.nullable(),
  createdAt: z.bigint(),
  graduated: z.boolean(),
})

export type LaunchInfo = z.infer<typeof LaunchInfoSchema>

// BONDING CURVE CALCULATIONS

/**
 * Calculate the initial price for a bonding curve
 * Price = virtualEthReserves / tokenSupply
 */
export function calculateInitialPrice(config: BondingCurveConfig): number {
  const validated = BondingCurveConfigSchema.parse(config)
  const eth = parseFloat(validated.virtualEthReserves)
  const supply = parseFloat(validated.tokenSupply)
  return eth / supply
}

/**
 * Calculate initial market cap for a bonding curve
 * Market cap at launch ≈ virtualEthReserves
 */
export function calculateInitialMarketCap(config: BondingCurveConfig): number {
  const validated = BondingCurveConfigSchema.parse(config)
  return parseFloat(validated.virtualEthReserves)
}

/**
 * Calculate graduation market cap
 * Market cap at graduation = virtualEthReserves + graduationTarget
 */
export function calculateGraduationMarketCap(
  config: BondingCurveConfig,
): number {
  const validated = BondingCurveConfigSchema.parse(config)
  const virtualEth = parseFloat(validated.virtualEthReserves)
  const target = parseFloat(validated.graduationTarget)
  return virtualEth + target
}

/**
 * Calculate price impact for a buy order
 * Uses constant product formula: x * y = k
 * Returns percentage (e.g., 5 = 5% price impact)
 */
export function calculateBuyPriceImpact(
  ethAmount: number,
  virtualEthReserves: number,
  tokenSupply: number,
): number {
  if (ethAmount <= 0 || virtualEthReserves <= 0 || tokenSupply <= 0) return 0

  // Current price
  const currentPrice = virtualEthReserves / tokenSupply

  // Tokens received (constant product)
  const newEthReserves = virtualEthReserves + ethAmount
  const k = virtualEthReserves * tokenSupply
  const newTokenSupply = k / newEthReserves
  const tokensOut = tokenSupply - newTokenSupply

  // Effective price
  const effectivePrice = ethAmount / tokensOut

  // Price impact
  return ((effectivePrice - currentPrice) / currentPrice) * 100
}

/**
 * Calculate tokens out for a given ETH input (constant product AMM)
 */
export function calculateTokensOut(
  ethAmount: number,
  virtualEthReserves: number,
  tokenSupply: number,
): number {
  if (ethAmount <= 0 || virtualEthReserves <= 0 || tokenSupply <= 0) return 0

  const k = virtualEthReserves * tokenSupply
  const newEthReserves = virtualEthReserves + ethAmount
  const newTokenSupply = k / newEthReserves
  return tokenSupply - newTokenSupply
}

/**
 * Calculate ETH out for selling tokens (constant product AMM)
 */
export function calculateEthOut(
  tokenAmount: number,
  virtualEthReserves: number,
  tokenSupply: number,
): number {
  if (tokenAmount <= 0 || virtualEthReserves <= 0 || tokenSupply <= 0) return 0

  const k = virtualEthReserves * tokenSupply
  const newTokenSupply = tokenSupply + tokenAmount
  const newEthReserves = k / newTokenSupply
  return virtualEthReserves - newEthReserves
}

/**
 * Calculate graduation progress percentage
 * Returns 0-100 (not basis points)
 */
export function calculateGraduationProgress(
  ethCollected: number,
  graduationTarget: number,
): number {
  if (graduationTarget <= 0) return 0
  const progress = (ethCollected / graduationTarget) * 100
  return Math.min(100, progress)
}

/**
 * Parse bonding curve stats from contract response
 */
export function parseBondingCurveStats(
  data: readonly [bigint, bigint, bigint, bigint, boolean],
): BondingCurveStats {
  return {
    price: data[0],
    progress: Number(data[1]),
    ethCollected: data[2],
    tokensRemaining: data[3],
    graduated: data[4],
    marketCap: BigInt(0),
  }
}

// ICO/PRESALE CALCULATIONS

/**
 * Calculate tokens received for a contribution at a given price
 */
export function calculateTokenAllocation(
  ethContribution: number,
  presalePrice: number,
): number {
  if (ethContribution <= 0 || presalePrice <= 0) return 0
  return ethContribution / presalePrice
}

/**
 * Calculate presale hard cap in tokens
 */
export function calculatePresaleTokens(
  totalSupply: number,
  presaleAllocationBps: number,
): number {
  return (totalSupply * presaleAllocationBps) / 10000
}

/**
 * Calculate LP allocation from raised funds
 */
export function calculateLPAllocation(
  raisedEth: number,
  lpFundingBps: number,
): number {
  return (raisedEth * lpFundingBps) / 10000
}

/**
 * Check if a user can claim tokens from presale
 */
export function canClaimTokens(
  status: PresaleStatus,
  contribution: UserContribution,
  buyerClaimStart: bigint,
  currentTimestamp: bigint,
): boolean {
  return (
    status.isFinalized &&
    !status.isFailed &&
    contribution.claimable > BigInt(0) &&
    currentTimestamp >= buyerClaimStart
  )
}

/**
 * Check if a user can claim a refund from failed presale
 */
export function canClaimRefund(
  status: PresaleStatus,
  contribution: UserContribution,
): boolean {
  return (
    status.isFinalized &&
    status.isFailed &&
    contribution.ethAmount > BigInt(0) &&
    !contribution.isRefunded
  )
}

/**
 * Parse presale status from contract response
 */
export function parsePresaleStatus(
  data: readonly [bigint, bigint, bigint, bigint, boolean, boolean, boolean],
): PresaleStatus {
  return {
    raised: data[0],
    participants: data[1],
    progress: Number(data[2]),
    timeRemaining: data[3],
    isActive: data[4],
    isFinalized: data[5],
    isFailed: data[6],
  }
}

/**
 * Parse user contribution from contract response
 */
export function parseUserContribution(
  data: readonly [bigint, bigint, bigint, bigint, boolean],
): UserContribution {
  return {
    ethAmount: data[0],
    tokenAllocation: data[1],
    claimedTokens: data[2],
    claimable: data[3],
    isRefunded: data[4],
  }
}

// FORMATTING UTILITIES

/**
 * Format price for display (ETH)
 */
export function formatPrice(priceWei: bigint): string {
  const ethPrice = Number(formatEther(priceWei))
  if (ethPrice < 0.000001) {
    return ethPrice.toExponential(4)
  }
  return ethPrice.toFixed(8)
}

/**
 * Format basis points as percentage
 */
export function formatBasisPoints(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

/**
 * Format time remaining in human readable form
 */
export function formatDuration(seconds: bigint): string {
  const secs = Number(seconds)
  if (secs <= 0) return 'Ended'

  const days = Math.floor(secs / 86400)
  const hours = Math.floor((secs % 86400) / 3600)
  const mins = Math.floor((secs % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

/**
 * Format ETH amount for display
 */
export function formatEthAmount(
  weiAmount: bigint,
  decimals: number = 4,
): string {
  const eth = Number(formatEther(weiAmount))
  if (eth >= 1000) {
    return `${(eth / 1000).toFixed(1)}K`
  }
  return eth.toFixed(decimals)
}

// VALIDATION UTILITIES

/**
 * Validate bonding curve launch parameters
 */
export function validateBondingCurveLaunch(
  name: string,
  symbol: string,
  creatorFeeBps: number,
  config: BondingCurveConfig,
): { valid: true } | { valid: false; error: string } {
  if (!name.trim()) {
    return { valid: false, error: 'Token name is required' }
  }
  if (!symbol.trim()) {
    return { valid: false, error: 'Token symbol is required' }
  }
  if (symbol.length > 10) {
    return { valid: false, error: 'Symbol must be 10 characters or less' }
  }
  if (creatorFeeBps < 0 || creatorFeeBps > 10000) {
    return { valid: false, error: 'Creator fee must be between 0% and 100%' }
  }

  const result = BondingCurveConfigSchema.safeParse(config)
  if (!result.success) {
    return { valid: false, error: result.error.issues[0].message }
  }

  return { valid: true }
}

/**
 * Validate ICO launch parameters
 */
export function validateICOLaunch(
  name: string,
  symbol: string,
  totalSupply: string,
  creatorFeeBps: number,
  config: ICOConfig,
): { valid: true } | { valid: false; error: string } {
  if (!name.trim()) {
    return { valid: false, error: 'Token name is required' }
  }
  if (!symbol.trim()) {
    return { valid: false, error: 'Token symbol is required' }
  }
  if (symbol.length > 10) {
    return { valid: false, error: 'Symbol must be 10 characters or less' }
  }
  if (parseFloat(totalSupply) <= 0) {
    return { valid: false, error: 'Total supply must be positive' }
  }
  if (creatorFeeBps < 0 || creatorFeeBps > 10000) {
    return { valid: false, error: 'Creator fee must be between 0% and 100%' }
  }

  const result = ICOConfigSchema.safeParse(config)
  if (!result.success) {
    return { valid: false, error: result.error.issues[0].message }
  }

  return { valid: true }
}

// PRESET CONFIGURATIONS

export const DEFAULT_BONDING_CONFIG: BondingCurveConfig = {
  virtualEthReserves: '30',
  graduationTarget: '10',
  tokenSupply: '1000000000',
}

export const DEFAULT_ICO_CONFIG: ICOConfig = {
  presaleAllocationBps: 3000,
  presalePrice: '0.0001',
  lpFundingBps: 8000,
  lpLockDuration: 30 * 24 * 60 * 60,
  buyerLockDuration: 7 * 24 * 60 * 60,
  softCap: '5',
  hardCap: '50',
  presaleDuration: 7 * 24 * 60 * 60,
}

export const DEGEN_ICO_CONFIG: ICOConfig = {
  presaleAllocationBps: 1500,
  presalePrice: '0.00005',
  lpFundingBps: 9000,
  lpLockDuration: 90 * 24 * 60 * 60,
  buyerLockDuration: 0,
  softCap: '2',
  hardCap: '20',
  presaleDuration: 2 * 24 * 60 * 60,
}
