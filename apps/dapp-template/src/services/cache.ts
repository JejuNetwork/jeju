/**
 * Cache Service using Compute-based Redis
 * 
 * Provides a decentralized caching layer using the compute network.
 * No fallbacks - requires compute cache to be available.
 */

import type { CacheEntry } from '../types';

const COMPUTE_CACHE_ENDPOINT = process.env.COMPUTE_CACHE_ENDPOINT || 'http://localhost:4200/cache';
const CACHE_TIMEOUT = 5000;

interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  isHealthy(): Promise<boolean>;
}

class ComputeCacheService implements CacheService {
  private healthChecked = false;
  private healthy = false;

  async get<T>(key: string): Promise<T | null> {
    const response = await fetch(`${COMPUTE_CACHE_ENDPOINT}/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(CACHE_TIMEOUT),
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Cache get failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { value: T | null };
    return data.value;
  }

  async set<T>(key: string, value: T, ttlMs = 300000): Promise<void> {
    const response = await fetch(`${COMPUTE_CACHE_ENDPOINT}/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, ttlMs }),
      signal: AbortSignal.timeout(CACHE_TIMEOUT),
    });

    if (!response.ok) {
      throw new Error(`Cache set failed: ${response.status} ${response.statusText}`);
    }
  }

  async delete(key: string): Promise<void> {
    const response = await fetch(`${COMPUTE_CACHE_ENDPOINT}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(CACHE_TIMEOUT),
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Cache delete failed: ${response.status} ${response.statusText}`);
    }
  }

  async clear(): Promise<void> {
    const response = await fetch(`${COMPUTE_CACHE_ENDPOINT}/clear`, {
      method: 'POST',
      signal: AbortSignal.timeout(CACHE_TIMEOUT),
    });

    if (!response.ok) {
      throw new Error(`Cache clear failed: ${response.status} ${response.statusText}`);
    }
  }

  async isHealthy(): Promise<boolean> {
    // Cache the health check result for 30 seconds
    if (this.healthChecked && Date.now() - (this.healthChecked as unknown as number) < 30000) {
      return this.healthy;
    }

    const response = await fetch(`${COMPUTE_CACHE_ENDPOINT}/health`, {
      signal: AbortSignal.timeout(CACHE_TIMEOUT),
    }).catch(() => null);
    
    this.healthy = response?.ok ?? false;
    this.healthChecked = true;
    
    return this.healthy;
  }
}

let cacheService: CacheService | null = null;

export function getCache(): CacheService {
  if (!cacheService) {
    cacheService = new ComputeCacheService();
  }
  return cacheService;
}

// Cache key helpers
export const cacheKeys = {
  todoList: (owner: string) => `todos:list:${owner.toLowerCase()}`,
  todoItem: (id: string) => `todos:item:${id}`,
  todoStats: (owner: string) => `todos:stats:${owner.toLowerCase()}`,
  userSession: (address: string) => `session:${address.toLowerCase()}`,
};
