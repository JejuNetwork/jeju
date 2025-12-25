/**
 * Browser-safe Buffer utilities
 *
 * These functions provide Buffer-like functionality without requiring
 * the Node.js Buffer class, which is not available in browsers.
 */

/**
 * Convert a string to its hexadecimal representation
 */
export function stringToHex(str: string): string {
  return [...str]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Convert a Uint8Array to a hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Convert a hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Convert a string to Uint8Array using UTF-8 encoding
 */
export function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

/**
 * Convert Uint8Array to string using UTF-8 decoding
 */
export function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

/**
 * JSON stringify an object and return as hex string.
 * Handles bigint values by converting them to strings.
 */
export function jsonToHex(obj: Record<string, unknown>): string {
  const str = JSON.stringify(obj, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  )
  const bytes = stringToBytes(str)
  return bytesToHex(bytes)
}
