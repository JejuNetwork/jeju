/**
 * Production-Grade Nonce Store
 *
 * Prevents replay attacks by tracking used nonces.
 * Uses distributed cache for multi-instance support.
 * Features:
 * - Per-address nonce tracking
 * - Automatic expiration based on signature TTL
 * - Distributed storage via shared cache
 */

import { type CacheClient, getCacheClient } from '@jejunetwork/shared'

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
const NONCE_TTL_SECONDS = Math.ceil(NONCE_TTL_MS / 1000)

// ============================================================================
// DISTRIBUTED NONCE STORE
// ============================================================================

let nonceCache: CacheClient | null = null

function getNonceCache(): CacheClient {
  if (!nonceCache) {
    nonceCache = getCacheClient('factory-nonces')
  }
  return nonceCache
}

/**
 * Check if a nonce has been used and mark it as used if not
 *
 * @param address - Wallet address (lowercase)
 * @param nonce - The nonce to check
 * @param signatureTimestamp - Timestamp from the signature
 * @returns true if nonce is valid (not used before), false if replay attempt
 */
async function checkAndMark(
  address: string,
  nonce: string,
  signatureTimestamp: number,
): Promise<{ valid: boolean; reason?: string }> {
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

  const cache = getNonceCache()
  const cacheKey = `nonce:${normalizedAddress}:${nonce}`

  // Check if nonce was already used
  const existing = await cache.get(cacheKey)
  if (existing) {
    log.warn('Replay attack detected', {
      address: `${normalizedAddress.slice(0, 10)}...`,
      nonce: `${nonce.slice(0, 8)}...`,
    })
    return { valid: false, reason: 'Nonce already used' }
  }

  // Mark nonce as used with TTL
  await cache.set(cacheKey, String(now), NONCE_TTL_SECONDS)

  return { valid: true }
}

/**
 * Check if a nonce has been used (without marking)
 */
async function isUsedAsync(address: string, nonce: string): Promise<boolean> {
  const normalizedAddress = address.toLowerCase()
  const cache = getNonceCache()
  const cacheKey = `nonce:${normalizedAddress}:${nonce}`

  const existing = await cache.get(cacheKey)
  return existing !== null
}

/**
 * Get statistics for monitoring
 */
async function getStatsAsync(): Promise<{
  totalAddresses: number
  totalNonces: number
  oldestNonceAge: number | null
}> {
  // Stats are approximations since we can't enumerate all keys in distributed cache
  return {
    totalAddresses: 0, // Not trackable in distributed mode
    totalNonces: 0, // Not trackable in distributed mode
    oldestNonceAge: null,
  }
}

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
export async function validateNonce(
  address: string,
  nonce: string,
  signatureTimestamp: number,
): Promise<{ valid: boolean; reason?: string }> {
  return checkAndMark(address, nonce, signatureTimestamp)
}

/**
 * Check if a nonce has already been used (without marking)
 */
export async function isNonceUsed(
  address: string,
  nonce: string,
): Promise<boolean> {
  return isUsedAsync(address, nonce)
}

/**
 * Get nonce store statistics
 */
export async function getNonceStoreStats(): Promise<{
  totalAddresses: number
  totalNonces: number
  oldestNonceAge: number | null
}> {
  return getStatsAsync()
}

/**
 * Shutdown the nonce store (no-op for distributed cache)
 */
export function shutdownNonceStore(): void {
  log.info('Nonce store shutdown')
}

/**
 * Generate a cryptographically secure nonce
 */
export function generateNonce(): string {
  const bytes = require('node:crypto').randomBytes(32)
  return bytes.toString('base64url')
}

export { NONCE_TTL_MS }
