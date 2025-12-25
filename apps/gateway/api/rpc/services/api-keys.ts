import { createHash, randomBytes } from 'node:crypto'
import type { RateTier } from '@jejunetwork/types'
import { LRUCache } from 'lru-cache'
import type { Address } from 'viem'
import { apiKeyState, initializeState } from '../../services/state'
import { registerApiKey, revokeApiKey } from '../middleware/rate-limiter'

/**
 * API key record stored in the database
 */
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

initializeState().catch(console.error)

const localKeyCache = new LRUCache<string, string>({
  max: 10000,
  ttl: 24 * 60 * 60 * 1000,
})

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

  return rowToApiKeyRecord(row)
}

function rowToApiKeyRecord(row: {
  id: string
  key_hash: string
  address: string
  name: string
  tier: string
  created_at: number
  last_used_at: number
  request_count: number
  is_active: number
}): ApiKeyRecord {
  if (!row.address.startsWith('0x') || row.address.length !== 42) {
    throw new Error(`Invalid address in API key record: ${row.id}`)
  }
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
  return rows.map(rowToApiKeyRecord)
}

export async function getApiKeyById(id: string): Promise<ApiKeyRecord | null> {
  const row = await apiKeyState.getById(id)
  if (!row) return null
  return rowToApiKeyRecord(row)
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

export function getApiKeyStats(): {
  total: number
  active: number
  cached: number
} {
  return {
    total: localKeyCache.size,
    active: localKeyCache.size,
    cached: localKeyCache.size,
  }
}
