/**
 * API Key Management Service
 * Handles creation, validation, and revocation of API keys
 */

import { randomBytes, createHash } from 'crypto';
import type { Address } from 'viem';
import { registerApiKey, revokeApiKey, type RateTier } from '../middleware/rate-limiter';

export interface ApiKey {
  id: string;
  key: string; // Only returned on creation
  keyHash: string;
  address: Address;
  name: string;
  tier: RateTier;
  createdAt: number;
  lastUsedAt: number;
  requestCount: number;
  isActive: boolean;
}

export interface ApiKeyRecord {
  id: string;
  keyHash: string;
  address: Address;
  name: string;
  tier: RateTier;
  createdAt: number;
  lastUsedAt: number;
  requestCount: number;
  isActive: boolean;
}

// In-memory store (use database in production)
const apiKeys = new Map<string, ApiKeyRecord>();
const keyHashToId = new Map<string, string>();
const idToKey = new Map<string, string>(); // Track raw keys for revocation

/**
 * Generate a new API key
 */
function generateKey(): string {
  const prefix = 'jrpc_';
  const random = randomBytes(24).toString('base64url');
  return `${prefix}${random}`;
}

/**
 * Hash an API key for storage
 */
function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Create a new API key for an address
 */
export function createApiKey(
  address: Address,
  name: string,
  tier: RateTier = 'FREE'
): { key: string; record: ApiKeyRecord } {
  const id = randomBytes(16).toString('hex');
  const key = generateKey();
  const keyHash = hashKey(key);

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
  };

  apiKeys.set(id, record);
  keyHashToId.set(keyHash, id);
  idToKey.set(id, key); // Store for revocation

  // Register with rate limiter
  registerApiKey(key, address, tier);

  return { key, record };
}

/**
 * Validate an API key and return its record
 */
export function validateApiKey(key: string): ApiKeyRecord | null {
  const keyHash = hashKey(key);
  const id = keyHashToId.get(keyHash);
  
  if (!id) return null;
  
  const record = apiKeys.get(id);
  if (!record || !record.isActive) return null;

  // Update usage stats
  record.lastUsedAt = Date.now();
  record.requestCount++;

  return record;
}

/**
 * Get all API keys for an address
 */
export function getApiKeysForAddress(address: Address): ApiKeyRecord[] {
  const results: ApiKeyRecord[] = [];
  for (const record of apiKeys.values()) {
    if (record.address.toLowerCase() === address.toLowerCase()) {
      results.push(record);
    }
  }
  return results;
}

/**
 * Get API key by ID
 */
export function getApiKeyById(id: string): ApiKeyRecord | null {
  return apiKeys.get(id) || null;
}

/**
 * Revoke an API key
 */
export function revokeApiKeyById(id: string, address: Address): boolean {
  const record = apiKeys.get(id);
  if (!record) return false;
  
  // Verify ownership
  if (record.address.toLowerCase() !== address.toLowerCase()) {
    return false;
  }

  record.isActive = false;
  
  // Remove from rate limiter
  const key = idToKey.get(id);
  if (key) {
    revokeApiKey(key);
    idToKey.delete(id);
  }
  
  return true;
}

/**
 * Update API key tier (called when stake changes)
 */
export function updateApiKeyTier(address: Address, newTier: RateTier): number {
  let updated = 0;
  for (const record of apiKeys.values()) {
    if (record.address.toLowerCase() === address.toLowerCase() && record.isActive) {
      record.tier = newTier;
      updated++;
    }
  }
  return updated;
}

/**
 * Get API key statistics
 */
export function getApiKeyStats(): {
  total: number;
  active: number;
  byTier: Record<RateTier, number>;
  totalRequests: number;
} {
  const byTier: Record<RateTier, number> = { FREE: 0, BASIC: 0, PRO: 0, UNLIMITED: 0 };
  let active = 0;
  let totalRequests = 0;

  for (const record of apiKeys.values()) {
    if (record.isActive) {
      active++;
      byTier[record.tier]++;
    }
    totalRequests += record.requestCount;
  }

  return {
    total: apiKeys.size,
    active,
    byTier,
    totalRequests,
  };
}

/**
 * Clean up old inactive keys (call periodically)
 */
export function cleanupInactiveKeys(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;

  for (const [id, record] of apiKeys) {
    if (!record.isActive && record.lastUsedAt < cutoff) {
      apiKeys.delete(id);
      keyHashToId.delete(record.keyHash);
      idToKey.delete(id);
      removed++;
    }
  }

  return removed;
}
