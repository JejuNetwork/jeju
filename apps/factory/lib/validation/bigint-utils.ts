/**
 * BigInt conversion utilities for contract data parsing
 */

/**
 * Safely convert a bigint to a number with validation
 * Throws if the value exceeds safe integer range
 */
export function bigIntToNumber(value: bigint, fieldName?: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      `Value for ${fieldName || 'field'} exceeds safe integer range: ${value}`,
    )
  }
  if (value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(
      `Value for ${fieldName || 'field'} is below safe integer range: ${value}`,
    )
  }
  return Number(value)
}

/**
 * Convert a bigint epoch timestamp to a number
 * Validates that it's a reasonable timestamp (1970-2100)
 */
export function bigIntEpochToNumber(value: bigint): number {
  const num = Number(value)
  // Validate reasonable timestamp range (1970-01-01 to 2100-01-01)
  const MIN_EPOCH = 0
  const MAX_EPOCH = 4102444800 // 2100-01-01
  if (num < MIN_EPOCH || num > MAX_EPOCH) {
    // Return 0 for invalid timestamps instead of throwing
    return 0
  }
  return num
}

/**
 * Convert a bigint to a formatted string with proper decimal places
 */
export function bigIntToFormattedString(
  value: bigint,
  decimals: number = 18,
): string {
  const str = value.toString().padStart(decimals + 1, '0')
  const intPart = str.slice(0, -decimals) || '0'
  const decPart = str.slice(-decimals)
  // Trim trailing zeros from decimal part
  const trimmedDec = decPart.replace(/0+$/, '')
  return trimmedDec ? `${intPart}.${trimmedDec}` : intPart
}

/**
 * Parse a string with decimals to a bigint
 */
export function parseStringToBigInt(
  value: string,
  decimals: number = 18,
): bigint {
  const [intPart, decPart = ''] = value.split('.')
  const paddedDec = decPart.padEnd(decimals, '0').slice(0, decimals)
  return BigInt(intPart + paddedDec)
}
