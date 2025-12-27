/**
 * Production-Grade Nonce Store
 *
 * Prevents replay attacks by tracking used nonces.
 * Features:
 * - Per-address nonce tracking
 * - Automatic expiration based on signature TTL
 * - Memory-efficient cleanup
 * - Thread-safe operations
 */

// Simple logger
const log = {
  info: (msg: string, data?: Record<string, unknown>) =>
    console.log(`[nonce-store] ${msg}`, data ?? ''),
  warn: (msg: string, data?: Record<string, unknown>) =>
    console.warn(`[nonce-store] ${msg}`, data ?? ''),
  debug: (msg: string, data?: Record<string, unknown>) =>
    console.debug(`[nonce-store] ${msg}`, data ?? ''),
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/** How long to keep nonces (should match MAX_SIGNATURE_AGE_MS + buffer) */
const NONCE_TTL_MS = 6 * 60 * 1000 // 6 minutes (5 min signature TTL + 1 min buffer)

/** Maximum nonces to track per address (prevents memory exhaustion attacks) */
const MAX_NONCES_PER_ADDRESS = 100

/** Cleanup interval */
const CLEANUP_INTERVAL_MS = 60_000 // 1 minute

// ============================================================================
// TYPES
// ============================================================================

interface NonceEntry {
  /** The nonce value */
  nonce: string
  /** Timestamp when the nonce was used */
  usedAt: number
  /** Timestamp from the signature (for additional validation) */
  signatureTimestamp: number
}

interface AddressNonces {
  /** List of used nonces */
  nonces: NonceEntry[]
  /** Last access time for this address */
  lastAccess: number
}

// ============================================================================
// NONCE STORE IMPLEMENTATION
// ============================================================================

class NonceStore {
  private store = new Map<string, AddressNonces>()
  private cleanupInterval: ReturnType<typeof setInterval>

  constructor() {
    this.cleanupInterval = setInterval(
      () => this.cleanup(),
      CLEANUP_INTERVAL_MS,
    )
    log.info('Nonce store initialized', { ttlMs: NONCE_TTL_MS })
  }

  /**
   * Check if a nonce has been used and mark it as used if not
   *
   * @param address - Wallet address (lowercase)
   * @param nonce - The nonce to check
   * @param signatureTimestamp - Timestamp from the signature
   * @returns true if nonce is valid (not used before), false if replay attempt
   */
  checkAndMark(
    address: string,
    nonce: string,
    signatureTimestamp: number,
  ): { valid: boolean; reason?: string } {
    const normalizedAddress = address.toLowerCase()
    const now = Date.now()

    // Validate nonce format
    if (!nonce || nonce.length < 8) {
      return { valid: false, reason: 'Invalid nonce format' }
    }

    // Validate signature timestamp is recent
    if (signatureTimestamp > now + 60_000) {
      // Allow 1 minute clock skew
      return { valid: false, reason: 'Signature timestamp in future' }
    }

    // Get or create address entry
    let addressEntry = this.store.get(normalizedAddress)
    if (!addressEntry) {
      addressEntry = {
        nonces: [],
        lastAccess: now,
      }
      this.store.set(normalizedAddress, addressEntry)
    }

    addressEntry.lastAccess = now

    // Clean expired nonces for this address
    const expirationThreshold = now - NONCE_TTL_MS
    addressEntry.nonces = addressEntry.nonces.filter(
      (entry) => entry.usedAt > expirationThreshold,
    )

    // Check if nonce was already used
    const existingNonce = addressEntry.nonces.find(
      (entry) => entry.nonce === nonce,
    )
    if (existingNonce) {
      log.warn('Replay attack detected', {
        address: `${normalizedAddress.slice(0, 10)}...`,
        nonce: `${nonce.slice(0, 8)}...`,
        originalUse: new Date(existingNonce.usedAt).toISOString(),
      })
      return { valid: false, reason: 'Nonce already used' }
    }

    // Check for too many nonces (potential abuse)
    if (addressEntry.nonces.length >= MAX_NONCES_PER_ADDRESS) {
      log.warn('Too many nonces for address', {
        address: `${normalizedAddress.slice(0, 10)}...`,
        count: addressEntry.nonces.length,
      })
      // Remove oldest nonce to make room
      addressEntry.nonces.shift()
    }

    // Mark nonce as used
    addressEntry.nonces.push({
      nonce,
      usedAt: now,
      signatureTimestamp,
    })

    return { valid: true }
  }

  /**
   * Check if a nonce has been used (without marking)
   */
  isUsed(address: string, nonce: string): boolean {
    const normalizedAddress = address.toLowerCase()
    const addressEntry = this.store.get(normalizedAddress)

    if (!addressEntry) {
      return false
    }

    const now = Date.now()
    const expirationThreshold = now - NONCE_TTL_MS

    return addressEntry.nonces.some(
      (entry) => entry.nonce === nonce && entry.usedAt > expirationThreshold,
    )
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now()
    const expirationThreshold = now - NONCE_TTL_MS
    const addressExpirationThreshold = now - NONCE_TTL_MS * 2 // 12 minutes
    let addressesRemoved = 0
    let noncesRemoved = 0

    for (const [address, entry] of this.store.entries()) {
      // Remove addresses that haven't been accessed recently
      if (entry.lastAccess < addressExpirationThreshold) {
        noncesRemoved += entry.nonces.length
        this.store.delete(address)
        addressesRemoved++
        continue
      }

      // Clean expired nonces
      const originalCount = entry.nonces.length
      entry.nonces = entry.nonces.filter(
        (nonceEntry) => nonceEntry.usedAt > expirationThreshold,
      )
      noncesRemoved += originalCount - entry.nonces.length

      // Remove empty entries
      if (entry.nonces.length === 0) {
        this.store.delete(address)
        addressesRemoved++
      }
    }

    if (addressesRemoved > 0 || noncesRemoved > 0) {
      log.debug('Nonce store cleanup', {
        addressesRemoved,
        noncesRemoved,
        remainingAddresses: this.store.size,
      })
    }
  }

  /**
   * Get statistics for monitoring
   */
  getStats(): {
    totalAddresses: number
    totalNonces: number
    oldestNonceAge: number | null
  } {
    let totalNonces = 0
    let oldestUsedAt = Infinity

    for (const entry of this.store.values()) {
      totalNonces += entry.nonces.length
      for (const nonce of entry.nonces) {
        if (nonce.usedAt < oldestUsedAt) {
          oldestUsedAt = nonce.usedAt
        }
      }
    }

    return {
      totalAddresses: this.store.size,
      totalNonces,
      oldestNonceAge:
        oldestUsedAt === Infinity ? null : Date.now() - oldestUsedAt,
    }
  }

  /**
   * Shutdown the nonce store
   */
  shutdown(): void {
    clearInterval(this.cleanupInterval)
    this.store.clear()
    log.info('Nonce store shutdown')
  }

  /**
   * Force clear all nonces (for testing)
   */
  clear(): void {
    this.store.clear()
  }
}

// Singleton instance
const nonceStore = new NonceStore()

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Validate a nonce for an address and mark it as used
 *
 * @param address - Wallet address
 * @param nonce - The nonce from the request
 * @param signatureTimestamp - Timestamp from the signature
 * @returns Validation result
 */
export function validateNonce(
  address: string,
  nonce: string,
  signatureTimestamp: number,
): { valid: boolean; reason?: string } {
  return nonceStore.checkAndMark(address, nonce, signatureTimestamp)
}

/**
 * Check if a nonce has already been used (without marking)
 */
export function isNonceUsed(address: string, nonce: string): boolean {
  return nonceStore.isUsed(address, nonce)
}

/**
 * Get nonce store statistics
 */
export function getNonceStoreStats(): {
  totalAddresses: number
  totalNonces: number
  oldestNonceAge: number | null
} {
  return nonceStore.getStats()
}

/**
 * Shutdown the nonce store
 */
export function shutdownNonceStore(): void {
  nonceStore.shutdown()
}

/**
 * Generate a cryptographically secure nonce
 */
export function generateNonce(): string {
  const bytes = require('node:crypto').randomBytes(32)
  return bytes.toString('base64url')
}

// Re-export NONCE_TTL_MS for client-side guidance
export { NONCE_TTL_MS }
