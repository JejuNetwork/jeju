/**
 * BigInt Conversion Utilities
 *
 * Safe conversion between BigInt and Number to prevent precision loss.
 * Use these instead of direct Number() conversion on BigInt values.
 */

/**
 * Maximum safe integer for JavaScript Number
 * Values larger than this lose precision when converted to Number
 */
export const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER)
export const MIN_SAFE_INTEGER = BigInt(Number.MIN_SAFE_INTEGER)

/**
 * Safely convert a BigInt to Number
 * Throws if the value would lose precision
 *
 * @param value - BigInt value to convert
 * @param fieldName - Name of the field for error messages
 * @returns The value as a Number
 * @throws Error if value exceeds safe integer range
 */
export function bigIntToNumber(value: bigint, fieldName: string): number {
  if (value > MAX_SAFE_INTEGER || value < MIN_SAFE_INTEGER) {
    throw new Error(
      `${fieldName} exceeds safe integer range: ${value.toString()}`,
    )
  }
  return Number(value)
}

/**
 * Safely convert a BigInt to Number with a fallback
 * Returns fallback if value would lose precision
 *
 * @param value - BigInt value to convert
 * @param fallback - Value to return if conversion would lose precision
 * @returns The value as a Number, or fallback
 */
export function bigIntToNumberSafe(value: bigint, fallback: number): number {
  if (value > MAX_SAFE_INTEGER || value < MIN_SAFE_INTEGER) {
    return fallback
  }
  return Number(value)
}

/**
 * Convert a BigInt timestamp (seconds) to JavaScript timestamp (milliseconds)
 * Validates the result is a reasonable date (between 1970 and 2100)
 *
 * @param value - Timestamp in seconds as BigInt
 * @param fieldName - Name of the field for error messages
 * @returns Timestamp in milliseconds as Number
 */
export function bigIntTimestampToMs(value: bigint, fieldName: string): number {
  // Year 2100 in seconds
  const MAX_TIMESTAMP = 4102444800n

  if (value < 0n || value > MAX_TIMESTAMP) {
    throw new Error(
      `${fieldName} is not a valid timestamp: ${value.toString()}`,
    )
  }

  // Timestamps in seconds are always safe to convert (year 2100 = ~4 billion seconds)
  return Number(value) * 1000
}

/**
 * Convert a BigInt epoch timestamp to Number
 * For contract timestamps that are already in seconds
 *
 * @param value - Timestamp in seconds as BigInt
 * @returns Timestamp in seconds as Number
 */
export function bigIntEpochToNumber(value: bigint): number {
  // Year 2100 in seconds is well under MAX_SAFE_INTEGER
  return Number(value)
}

/**
 * Check if a BigInt can be safely converted to Number
 *
 * @param value - BigInt value to check
 * @returns true if value can be converted without precision loss
 */
export function isSafeInteger(value: bigint): boolean {
  return value <= MAX_SAFE_INTEGER && value >= MIN_SAFE_INTEGER
}

/**
 * Format a BigInt for display, handling large values gracefully
 *
 * @param value - BigInt value to format
 * @param decimals - Number of decimal places (for token amounts)
 * @returns Formatted string representation
 */
export function formatBigInt(value: bigint, decimals = 0): string {
  if (decimals === 0) {
    return value.toLocaleString()
  }

  const divisor = 10n ** BigInt(decimals)
  const integerPart = value / divisor
  const fractionalPart = value % divisor

  const integerStr = integerPart.toLocaleString()
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0')

  // Trim trailing zeros from fractional part
  const trimmedFractional = fractionalStr.replace(/0+$/, '')

  if (trimmedFractional.length === 0) {
    return integerStr
  }

  return `${integerStr}.${trimmedFractional}`
}
