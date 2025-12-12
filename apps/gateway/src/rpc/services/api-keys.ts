/**
 * API Key Management Service
 */

import { randomBytes, createHash } from 'crypto';
import type { Address } from 'viem';
import { registerApiKey, revokeApiKey, type RateTier } from '../middleware/rate-limiter.js';

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

const apiKeys = new Map<string, ApiKeyRecord>();
const keyHashToId = new Map<string, string>();
const idToKey = new Map<string, string>();

function generateKey(): string {
  return `jrpc_${randomBytes(24).toString('base64url')}`;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function createApiKey(address: Address, name: string, tier: RateTier = 'FREE'): { key: string; record: ApiKeyRecord } {
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
  idToKey.set(id, key);
  registerApiKey(key, address, tier);

  return { key, record };
}

export function validateApiKey(key: string): ApiKeyRecord | null {
  const keyHash = hashKey(key);
  const id = keyHashToId.get(keyHash);
  if (!id) return null;
  const record = apiKeys.get(id);
  if (!record || !record.isActive) return null;
  record.lastUsedAt = Date.now();
  record.requestCount++;
  return record;
}

export function getApiKeysForAddress(address: Address): ApiKeyRecord[] {
  const results: ApiKeyRecord[] = [];
  for (const record of apiKeys.values()) {
    if (record.address.toLowerCase() === address.toLowerCase()) results.push(record);
  }
  return results;
}

export function getApiKeyById(id: string): ApiKeyRecord | null {
  return apiKeys.get(id) || null;
}

export function revokeApiKeyById(id: string, address: Address): boolean {
  const record = apiKeys.get(id);
  if (!record || record.address.toLowerCase() !== address.toLowerCase()) return false;
  record.isActive = false;
  const key = idToKey.get(id);
  if (key) {
    revokeApiKey(key);
    idToKey.delete(id);
  }
  return true;
}

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

export function getApiKeyStats(): { total: number; active: number; byTier: Record<RateTier, number>; totalRequests: number } {
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

  return { total: apiKeys.size, active, byTier, totalRequests };
}

export function cleanupInactiveKeys(maxAgeMs = 30 * 24 * 60 * 60 * 1000): number {
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
