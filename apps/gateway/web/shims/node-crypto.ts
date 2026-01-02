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

/**
 * Simple hash creator using Web Crypto API
 * Returns a hash object with update/digest methods compatible with Node.js crypto
 */
export function createHash(algorithm: string) {
  const algo = algorithm === 'sha256' ? 'SHA-256' : algorithm.toUpperCase()
  let data = new Uint8Array(0)

  return {
    update(input: string | Uint8Array) {
      const bytes =
        typeof input === 'string' ? new TextEncoder().encode(input) : input
      const newData = new Uint8Array(data.length + bytes.length)
      newData.set(data)
      newData.set(bytes, data.length)
      data = newData
      return this
    },
    async digest(encoding?: 'hex' | 'base64') {
      const hashBuffer = await globalThis.crypto.subtle.digest(algo, data)
      const hashArray = new Uint8Array(hashBuffer)
      if (encoding === 'hex') {
        return Array.from(hashArray)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      }
      if (encoding === 'base64') {
        return btoa(String.fromCharCode(...hashArray))
      }
      return hashArray
    },
  }
}

// Default export compatible with @noble/hashes expectations
export default {
  webcrypto: globalThis.crypto,
  randomBytes,
  createHash,
}
