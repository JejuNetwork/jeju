/**
 * API Key Management Service - Decentralized via CovenantSQL
 *
 * Uses cryptographic hashing for key validation.
 * Keys are hashed with SHA-256 before storage - plaintext keys are NEVER stored.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import { isProductionEnv, isTestMode } from '@jejunetwork/config'
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
  return `jrpc_${randomBytes(24).toString('base64url')}`
}

/**
 * Hash an API key for storage using SHA-256
 * The plaintext key is NEVER stored - only the hash
 */
function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * Derive encryption key for metadata encryption
 * SECURITY: API_KEY_ENCRYPTION_SECRET MUST be set in production
 */
function deriveEncryptionKey(): Buffer {
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
    return createHash('sha256')
      .update('DEV_ONLY_EPHEMERAL_KEY_DO_NOT_USE_IN_PRODUCTION')
      .digest()
  }
  return createHash('sha256').update(secret).digest()
}

/**
 * Encrypt sensitive metadata (address binding) with AES-256-GCM
 * Exported for use by other services that need metadata encryption
 */
export function encryptMetadata(data: string): string {
  const key = deriveEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

/**
 * Decrypt sensitive metadata with AES-256-GCM
 * Exported for use by other services that need metadata decryption
 */
export function decryptMetadata(encryptedData: string): string {
  const key = deriveEncryptionKey()
  const data = Buffer.from(encryptedData, 'base64')
  const iv = data.subarray(0, 12)
  const authTag = data.subarray(12, 28)
  const ciphertext = data.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8')
}

export async function createApiKey(
  address: Address,
  name: string,
  tier: RateTier = 'FREE',
): Promise<{ key: string; record: ApiKeyRecord }> {
  const id = randomBytes(16).toString('hex')
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
