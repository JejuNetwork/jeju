/**
 * API Key Management Service - Decentralized via CovenantSQL
 *
 * Uses cryptographic hashing for key validation.
 * Keys are hashed with SHA-256 before storage - plaintext keys are NEVER stored.
 */

import { isProductionEnv, isTestMode } from '@jejunetwork/config'
import {
  bytesToHex,
  decryptAesGcm,
  encryptAesGcm,
  hash256,
  randomBytes,
} from '@jejunetwork/shared'
import type { ApiKeyRecord, RateTier } from '@jejunetwork/types'
import type { Address } from 'viem'
import { apiKeyState } from '../../state.js'
import { registerApiKey, revokeApiKey } from '../middleware/rate-limiter.js'

export type { ApiKeyRecord }

// Local cache for key -> id mapping (for fast validation without async)
const localKeyCache = new Map<string, string>()

/**
 * Generate a cryptographically secure API key
 */
function generateKey(): string {
  const bytes = randomBytes(24)
  // Convert to base64url
  const base64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `jrpc_${base64}`
}

/**
 * Hash an API key for storage using SHA-256
 * The plaintext key is NEVER stored - only the hash
 */
function hashKey(key: string): string {
  return bytesToHex(hash256(key))
}

/**
 * Derive encryption key for metadata encryption
 * SECURITY: API_KEY_ENCRYPTION_SECRET MUST be set in production
 */
function deriveEncryptionKey(): Uint8Array {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET
  const isProduction = isProductionEnv()
  const isTest = isTestMode() || process.env.BUN_TEST === 'true'

  if (!secret) {
    if (isProduction) {
      throw new Error(
        'CRITICAL: API_KEY_ENCRYPTION_SECRET must be set in production.',
      )
    }
    if (!isTest) {
      // Development mode - generate ephemeral key with warning
      console.warn(
        '[API Keys] WARNING: API_KEY_ENCRYPTION_SECRET not set - using ephemeral key.',
      )
    }
    // Use a deterministic dev-only key derived from a constant - NEVER use in production
    return hash256('DEV_ONLY_EPHEMERAL_KEY_DO_NOT_USE_IN_PRODUCTION')
  }
  return hash256(secret)
}

/**
 * Encrypt sensitive metadata (address binding) with AES-256-GCM
 * Exported for use by other services that need metadata encryption
 */
export async function encryptMetadata(data: string): Promise<string> {
  const key = deriveEncryptionKey()
  const dataBytes = new TextEncoder().encode(data)
  const { ciphertext, iv, tag } = await encryptAesGcm(dataBytes, key)
  // Format: iv (12) + tag (16) + ciphertext, base64 encoded
  const combined = new Uint8Array(iv.length + tag.length + ciphertext.length)
  combined.set(iv, 0)
  combined.set(tag, 12)
  combined.set(ciphertext, 28)
  return btoa(String.fromCharCode(...combined))
}

/**
 * Decrypt sensitive metadata with AES-256-GCM
 * Exported for use by other services that need metadata decryption
 */
export async function decryptMetadata(encryptedData: string): Promise<string> {
  const key = deriveEncryptionKey()
  const binaryStr = atob(encryptedData)
  const data = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    data[i] = binaryStr.charCodeAt(i)
  }
  const iv = data.subarray(0, 12)
  const tag = data.subarray(12, 28)
  const ciphertext = data.subarray(28)
  const decrypted = await decryptAesGcm(ciphertext, key, iv, tag)
  return new TextDecoder().decode(decrypted)
}

export async function createApiKey(
  address: Address,
  name: string,
  tier: RateTier = 'FREE',
): Promise<{ key: string; record: ApiKeyRecord }> {
  const id = bytesToHex(randomBytes(16))
  const key = generateKey()
  const keyHash = hashKey(key)

  const record: ApiKeyRecord = {
    id,
    keyHash,
    address,
    name,
    tier,
    createdAt: Date.now(),
    lastUsedAt: 0,
    requestCount: 0,
    isActive: true,
  }

  await apiKeyState.save({
    id,
    keyHash,
    address: address.toLowerCase(),
    name,
    tier,
    createdAt: record.createdAt,
  })

  // Cache for fast lookup
  localKeyCache.set(key, id)
  registerApiKey(key, address, tier)

  return { key, record }
}

export async function validateApiKey(
  key: string,
): Promise<ApiKeyRecord | null> {
  const keyHash = hashKey(key)
  const row = await apiKeyState.getByHash(keyHash)
  if (!row || !row.is_active) return null

  // Record usage asynchronously
  apiKeyState.recordUsage(keyHash).catch(console.error)

  return {
    id: row.id,
    keyHash: row.key_hash,
    address: row.address as Address,
    name: row.name,
    tier: row.tier as RateTier,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    requestCount: row.request_count,
    isActive: row.is_active === 1,
  }
}

export async function getApiKeysForAddress(
  address: Address,
): Promise<ApiKeyRecord[]> {
  const rows = await apiKeyState.listByAddress(address)
  return rows.map((row) => ({
    id: row.id,
    keyHash: row.key_hash,
    address: row.address as Address,
    name: row.name,
    tier: row.tier as RateTier,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    requestCount: row.request_count,
    isActive: row.is_active === 1,
  }))
}

export async function getApiKeyById(id: string): Promise<ApiKeyRecord | null> {
  const row = await apiKeyState.getById(id)
  if (!row) return null
  return {
    id: row.id,
    keyHash: row.key_hash,
    address: row.address as Address,
    name: row.name,
    tier: row.tier as RateTier,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    requestCount: row.request_count,
    isActive: row.is_active === 1,
  }
}

export async function revokeApiKeyById(
  id: string,
  address: Address,
): Promise<boolean> {
  const record = await getApiKeyById(id)
  if (
    !record ||
    !record.address ||
    record.address.toLowerCase() !== address.toLowerCase()
  )
    return false

  const success = await apiKeyState.revoke(id)
  if (success) {
    // Find and revoke from rate limiter cache
    for (const [key, cachedId] of localKeyCache) {
      if (cachedId === id) {
        revokeApiKey(key)
        localKeyCache.delete(key)
        break
      }
    }
  }
  return success
}

// Note: updateApiKeyTier would require adding an update method to apiKeyState
// For now, users should revoke and create new keys with different tiers

export function getApiKeyStats(): {
  total: number
  active: number
  cached: number
} {
  return {
    total: localKeyCache.size, // Approximate - actual count requires DB query
    active: localKeyCache.size, // Keys in cache are active
    cached: localKeyCache.size,
  }
}
