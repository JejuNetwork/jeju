/**
 * API Key Management Service - Decentralized via CovenantSQL
 */

import { createHash, randomBytes } from 'node:crypto'
import type { Address } from 'viem'
import { apiKeyState } from '../../state.js'
import {
  type RateTier,
  registerApiKey,
  revokeApiKey,
} from '../middleware/rate-limiter.js'

export interface ApiKeyRecord {
  id: string
  keyHash: string
  address: Address
  name: string
  tier: RateTier
  createdAt: number
  lastUsedAt: number
  requestCount: number
  isActive: boolean
}

// State initialization is handled by main server startup

// Local cache for key -> id mapping (for fast validation without async)
const localKeyCache = new Map<string, string>()

function generateKey(): string {
  return `jrpc_${randomBytes(24).toString('base64url')}`
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
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
  if (!record || record.address.toLowerCase() !== address.toLowerCase())
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
