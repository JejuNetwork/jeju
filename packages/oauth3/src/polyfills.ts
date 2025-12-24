/**
 * Browser-safe polyfills for isomorphic OAuth3 package
 *
 * This file MUST be imported at the very start of the package
 * to ensure process.env is defined before any modules try to access it.
 */

// Provide a minimal process.env for browser environments
// Only polyfill in browsers where process doesn't exist
if (typeof process === 'undefined') {
  // Create minimal process shim for browser environments
  // Using Object.defineProperty to avoid type conflicts with Node's Process interface
  Object.defineProperty(globalThis, 'process', {
    value: { env: {} },
    writable: true,
    configurable: true,
  })
}

/**
 * Browser-native base64url encoding (no Buffer dependency)
 */
export function toBase64Url(input: string): string {
  // Use TextEncoder to convert string to bytes, then btoa for base64
  const bytes = new TextEncoder().encode(input)
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Browser-native base64url decoding (no Buffer dependency)
 */
export function fromBase64Url(input: string): string {
  // Restore standard base64 padding and characters
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}
