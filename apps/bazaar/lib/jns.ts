/**
 * JNS (Jeju Name Service) Business Logic
 *
 * Provides:
 * - Name validation and normalization
 * - Price calculations for registration
 * - Expiry date calculations
 * - Labelhash computation
 * - Formatting utilities
 */

import { formatEther, keccak256, toBytes } from 'viem'
import { z } from 'zod'

// =============================================================================
// CONSTANTS
// =============================================================================

/** Minimum name length (in characters) */
export const MIN_NAME_LENGTH = 3

/** Maximum name length (in characters) */
export const MAX_NAME_LENGTH = 63

/** Allowed characters regex (alphanumeric and hyphens, no leading/trailing hyphens) */
const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

/** Base registration price in ETH per year */
export const BASE_REGISTRATION_PRICE_ETH = 0.01

/** Premium multiplier for short names (3 chars = 100x, 4 chars = 10x) */
export const SHORT_NAME_MULTIPLIERS: Record<number, number> = {
  3: 100,
  4: 10,
  5: 2,
}

/** Standard registration duration options in days */
export const REGISTRATION_DURATIONS = [365, 730, 1095] as const

/** JNS domain suffix */
export const JNS_SUFFIX = '.jeju'

/** Seconds per day for calculations */
export const SECONDS_PER_DAY = 86400

/** Seconds per year for calculations */
export const SECONDS_PER_YEAR = 365 * SECONDS_PER_DAY

// =============================================================================
// SCHEMAS
// =============================================================================

/**
 * Schema for validating JNS name format (without .jeju suffix)
 * - 3-63 characters
 * - Lowercase alphanumeric and hyphens only
 * - Cannot start or end with hyphen
 */
export const JNSNameSchema = z
  .string()
  .min(MIN_NAME_LENGTH, `Name must be at least ${MIN_NAME_LENGTH} characters`)
  .max(MAX_NAME_LENGTH, `Name must be at most ${MAX_NAME_LENGTH} characters`)
  .refine(
    (name) => NAME_PATTERN.test(name),
    'Name must contain only lowercase letters, numbers, and hyphens (cannot start or end with hyphen)',
  )

/**
 * Schema for registration duration in days
 */
export const RegistrationDurationSchema = z
  .number()
  .int('Duration must be a whole number')
  .min(1, 'Duration must be at least 1 day')
  .max(3650, 'Duration cannot exceed 10 years')

/**
 * Schema for listing price in ETH (as string for precision)
 */
export const ListingPriceSchema = z.string().refine((val) => {
  const num = parseFloat(val)
  return !Number.isNaN(num) && num > 0
}, 'Price must be a positive number')

/**
 * Schema for listing duration in days
 */
export const ListingDurationSchema = z
  .number()
  .int('Duration must be a whole number')
  .min(1, 'Duration must be at least 1 day')
  .max(365, 'Listing duration cannot exceed 1 year')

/**
 * Schema for JNS name listing status
 */
export const ListingStatusSchema = z.enum(['active', 'sold', 'cancelled'])
export type ListingStatus = z.infer<typeof ListingStatusSchema>

/**
 * Schema for currency types
 */
export const CurrencyTypeSchema = z.enum(['ETH', 'HG', 'USDC'])
export type CurrencyType = z.infer<typeof CurrencyTypeSchema>

/**
 * Schema for name registration input
 */
export const NameRegistrationInputSchema = z.object({
  name: JNSNameSchema,
  durationDays: RegistrationDurationSchema,
})
export type NameRegistrationInput = z.infer<typeof NameRegistrationInputSchema>

/**
 * Schema for name listing input
 */
export const NameListingInputSchema = z.object({
  name: JNSNameSchema,
  priceEth: ListingPriceSchema,
  durationDays: ListingDurationSchema,
})
export type NameListingInput = z.infer<typeof NameListingInputSchema>

// =============================================================================
// NAME VALIDATION
// =============================================================================

/**
 * Validates a JNS name format
 * @param name - Name to validate (without .jeju suffix)
 * @returns Validation result with success/error
 */
export function validateName(
  name: string,
): { valid: true; normalizedName: string } | { valid: false; error: string } {
  const normalized = normalizeName(name)
  const result = JNSNameSchema.safeParse(normalized)

  if (result.success) {
    return { valid: true, normalizedName: normalized }
  }

  return { valid: false, error: result.error.issues[0].message }
}

/**
 * Checks if a name has valid format
 * @param name - Name to check
 * @returns True if name format is valid
 */
export function isValidNameFormat(name: string): boolean {
  const normalized = normalizeName(name)
  return JNSNameSchema.safeParse(normalized).success
}

/**
 * Gets the length category for pricing (3=premium, 4=semi-premium, 5+=standard)
 * @param name - Normalized name
 * @returns Length category
 */
export function getNameLengthCategory(
  name: string,
): 'premium' | 'semi-premium' | 'standard' {
  const length = name.length
  if (length === 3) return 'premium'
  if (length === 4) return 'semi-premium'
  return 'standard'
}

// =============================================================================
// NAME NORMALIZATION
// =============================================================================

/**
 * Normalizes a JNS name by:
 * - Converting to lowercase
 * - Trimming whitespace
 * - Removing .jeju suffix if present
 *
 * @param name - Raw name input
 * @returns Normalized name
 */
export function normalizeName(name: string): string {
  let normalized = name.toLowerCase().trim()

  // Remove .jeju suffix if present
  if (normalized.endsWith(JNS_SUFFIX)) {
    normalized = normalized.slice(0, -JNS_SUFFIX.length)
  }

  return normalized
}

/**
 * Formats a name with .jeju suffix for display
 * @param name - Normalized name
 * @returns Full domain name
 */
export function formatFullName(name: string): string {
  const normalized = normalizeName(name)
  return `${normalized}${JNS_SUFFIX}`
}

// =============================================================================
// LABELHASH COMPUTATION
// =============================================================================

/**
 * Computes the labelhash (keccak256) of a name
 * This is used as the tokenId in the JNS Registrar ERC-721
 *
 * @param name - Normalized name (without .jeju)
 * @returns Labelhash as hex string
 */
export function computeLabelhash(name: string): `0x${string}` {
  const normalized = normalizeName(name)
  return keccak256(toBytes(normalized))
}

/**
 * Converts labelhash to tokenId (BigInt)
 * @param labelhash - Labelhash hex string
 * @returns Token ID as BigInt
 */
export function labelhashToTokenId(labelhash: `0x${string}`): bigint {
  return BigInt(labelhash)
}

/**
 * Computes both labelhash and tokenId for a name
 * @param name - Name to process
 * @returns Object with labelhash and tokenId
 */
export function computeNameIdentifiers(name: string): {
  labelhash: `0x${string}`
  tokenId: bigint
} {
  const labelhash = computeLabelhash(name)
  return {
    labelhash,
    tokenId: labelhashToTokenId(labelhash),
  }
}

// =============================================================================
// PRICE CALCULATIONS
// =============================================================================

/**
 * Calculates the registration price for a name
 * - Base price: 0.01 ETH/year
 * - 3-char names: 100x multiplier (1 ETH/year)
 * - 4-char names: 10x multiplier (0.1 ETH/year)
 * - 5-char names: 2x multiplier (0.02 ETH/year)
 * - 6+ char names: base price (0.01 ETH/year)
 *
 * @param name - Normalized name
 * @param durationDays - Registration duration in days
 * @returns Price in ETH (as number for calculations)
 */
export function calculateRegistrationPrice(
  name: string,
  durationDays: number,
): number {
  const normalized = normalizeName(name)
  const length = normalized.length

  const multiplier = SHORT_NAME_MULTIPLIERS[length] ?? 1
  const years = durationDays / 365

  return BASE_REGISTRATION_PRICE_ETH * multiplier * years
}

/**
 * Calculates the registration price in wei
 * @param name - Normalized name
 * @param durationDays - Registration duration in days
 * @returns Price in wei as BigInt
 */
export function calculateRegistrationPriceWei(
  name: string,
  durationDays: number,
): bigint {
  const priceEth = calculateRegistrationPrice(name, durationDays)
  // Convert to wei with proper precision
  return BigInt(Math.floor(priceEth * 1e18))
}

/**
 * Gets the annual price for a name based on length
 * @param name - Normalized name
 * @returns Annual price in ETH
 */
export function getAnnualPrice(name: string): number {
  const normalized = normalizeName(name)
  const length = normalized.length
  const multiplier = SHORT_NAME_MULTIPLIERS[length] ?? 1
  return BASE_REGISTRATION_PRICE_ETH * multiplier
}

/**
 * Formats a registration price for display
 * @param priceWei - Price in wei
 * @returns Formatted price string (e.g., "0.01 ETH")
 */
export function formatRegistrationPrice(priceWei: bigint): string {
  return `${formatEther(priceWei)} ETH`
}

// =============================================================================
// EXPIRY CALCULATIONS
// =============================================================================

/**
 * Calculates expiry timestamp from duration
 * @param durationDays - Duration in days
 * @param fromTimestamp - Start timestamp (defaults to now)
 * @returns Expiry timestamp in seconds
 */
export function calculateExpiryTimestamp(
  durationDays: number,
  fromTimestamp?: number,
): number {
  const start = fromTimestamp ?? Math.floor(Date.now() / 1000)
  return start + durationDays * SECONDS_PER_DAY
}

/**
 * Calculates the expiry date from duration
 * @param durationDays - Duration in days
 * @param fromDate - Start date (defaults to now)
 * @returns Expiry date
 */
export function calculateExpiryDate(
  durationDays: number,
  fromDate?: Date,
): Date {
  const start = fromDate ?? new Date()
  const expiryMs = start.getTime() + durationDays * SECONDS_PER_DAY * 1000
  return new Date(expiryMs)
}

/**
 * Checks if a name has expired
 * @param expiresAt - Expiry timestamp in seconds
 * @returns True if expired
 */
export function isExpired(expiresAt: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  return expiresAt <= now
}

/**
 * Gets remaining time until expiry in seconds
 * @param expiresAt - Expiry timestamp in seconds
 * @returns Remaining seconds (0 if expired)
 */
export function getRemainingSeconds(expiresAt: number): number {
  const now = Math.floor(Date.now() / 1000)
  const diff = expiresAt - now
  return diff > 0 ? diff : 0
}

/**
 * Formats time remaining until expiry for display
 * @param expiresAt - Expiry timestamp in seconds
 * @returns Human-readable time remaining (e.g., "30 days", "2 hours")
 */
export function formatTimeRemaining(expiresAt: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = expiresAt - now

  if (diff <= 0) return 'Expired'

  const days = Math.floor(diff / SECONDS_PER_DAY)
  if (days > 30) {
    const months = Math.floor(days / 30)
    return `${months} month${months !== 1 ? 's' : ''}`
  }
  if (days > 0) return `${days} day${days !== 1 ? 's' : ''}`

  const hours = Math.floor(diff / 3600)
  if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''}`

  const minutes = Math.floor(diff / 60)
  return `${minutes} minute${minutes !== 1 ? 's' : ''}`
}

/**
 * Formats expiry date for display
 * @param expiresAt - Expiry timestamp in seconds
 * @returns Formatted date string
 */
export function formatExpiryDate(expiresAt: number): string {
  const date = new Date(expiresAt * 1000)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// =============================================================================
// LISTING PRICE FORMATTING
// =============================================================================

/**
 * Formats a listing price in wei for display
 * @param priceWei - Price in wei
 * @returns Formatted price string (e.g., "0.1 ETH")
 */
export function formatListingPrice(priceWei: bigint): string {
  return `${formatEther(priceWei)} ETH`
}

/**
 * Parses an ETH amount string to wei
 * @param ethAmount - Amount in ETH as string
 * @returns Amount in wei as BigInt
 */
export function parseEthToWei(ethAmount: string): bigint {
  const parsed = parseFloat(ethAmount)
  return BigInt(Math.floor(parsed * 1e18))
}

// =============================================================================
// LISTING DURATION
// =============================================================================

/**
 * Converts listing duration in days to seconds
 * @param durationDays - Duration in days
 * @returns Duration in seconds as BigInt
 */
export function listingDurationToSeconds(durationDays: number): bigint {
  return BigInt(durationDays * SECONDS_PER_DAY)
}

/**
 * Validates listing duration is within allowed range
 * @param durationDays - Duration to validate
 * @returns Validation result
 */
export function validateListingDuration(
  durationDays: number,
): { valid: true } | { valid: false; error: string } {
  const result = ListingDurationSchema.safeParse(durationDays)
  if (result.success) {
    return { valid: true }
  }
  return { valid: false, error: result.error.issues[0].message }
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validates a complete name registration input
 * @param input - Registration input to validate
 * @returns Validation result
 */
export function validateRegistrationInput(input: {
  name: string
  durationDays: number
}):
  | { valid: true; data: NameRegistrationInput }
  | { valid: false; error: string } {
  const normalized = {
    name: normalizeName(input.name),
    durationDays: input.durationDays,
  }
  const result = NameRegistrationInputSchema.safeParse(normalized)

  if (result.success) {
    return { valid: true, data: result.data }
  }

  return { valid: false, error: result.error.issues[0].message }
}

/**
 * Validates a complete name listing input
 * @param input - Listing input to validate
 * @returns Validation result
 */
export function validateListingInput(input: {
  name: string
  priceEth: string
  durationDays: number
}): { valid: true; data: NameListingInput } | { valid: false; error: string } {
  const normalized = {
    name: normalizeName(input.name),
    priceEth: input.priceEth,
    durationDays: input.durationDays,
  }
  const result = NameListingInputSchema.safeParse(normalized)

  if (result.success) {
    return { valid: true, data: result.data }
  }

  return { valid: false, error: result.error.issues[0].message }
}
