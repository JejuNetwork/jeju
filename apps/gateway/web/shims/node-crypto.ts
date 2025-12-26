/**
 * Browser shim for node:crypto
 * Uses Web Crypto API as a fallback
 */

// Export webcrypto as the default crypto
export const webcrypto = globalThis.crypto
export const randomBytes = (size: number): Uint8Array => {
  const bytes = new Uint8Array(size)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

// Default export compatible with @noble/hashes expectations
export default {
  webcrypto: globalThis.crypto,
  randomBytes,
}
