/**
 * Random Utilities
 *
 * Cryptographically secure random generation utilities
 */

/**
 * Generate random bytes as hex string
 */
export function randomBytesHex(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
