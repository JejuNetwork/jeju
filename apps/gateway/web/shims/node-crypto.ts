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
 * Simple hash implementation for browser environment
 * Creates a Node.js crypto-like hash interface using Web Crypto API
 */
class BrowserHash {
  private data: Uint8Array[] = []

  update(data: string | Uint8Array): this {
    if (typeof data === 'string') {
      this.data.push(new TextEncoder().encode(data))
    } else {
      this.data.push(data)
    }
    return this
  }

  digest(encoding?: 'hex' | 'base64'): string {
    // Synchronous digest is not possible with Web Crypto
    // For browser compatibility, use a simple fallback hash
    // This is fine for cache keys (non-cryptographic use)
    const combined = new Uint8Array(
      this.data.reduce((acc, arr) => acc + arr.length, 0),
    )
    let offset = 0
    for (const arr of this.data) {
      combined.set(arr, offset)
      offset += arr.length
    }

    // FNV-1a hash for fast, non-cryptographic hashing
    let hash = 2166136261
    for (let i = 0; i < combined.length; i++) {
      hash ^= combined[i]
      hash = (hash * 16777619) >>> 0
    }

    // Convert to hex string and pad to simulate SHA-256 output length
    const hashHex = hash.toString(16).padStart(8, '0')
    // Repeat to get sufficient length for cache keys
    const fullHash = hashHex.repeat(8)

    if (encoding === 'base64') {
      return btoa(fullHash)
    }
    return fullHash
  }
}

export function createHash(_algorithm: string): BrowserHash {
  return new BrowserHash()
}

// Default export compatible with @noble/hashes expectations
export default {
  webcrypto: globalThis.crypto,
  randomBytes,
  createHash,
}
