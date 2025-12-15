/**
 * Cache Service using Compute-based Redis
 * 
 * Provides a decentralized caching layer using the compute network.
 * Falls back to in-memory cache when compute is unavailable.
 */

import type { CacheEntry } from '../types';

const COMPUTE_CACHE_ENDPOINT = process.env.COMPUTE_CACHE_ENDPOINT || 'http://localhost:4200/cache';

interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  isHealthy(): Promise<boolean>;
}

class ComputeCacheService implements CacheService {
  private fallbackCache = new Map<string, CacheEntry<unknown>>();
  private computeAvailable = true;

  async get<T>(key: string): Promise<T | null> {
    // Try compute cache first
    if (this.computeAvailable) {
      const result = await this.computeGet<T>(key);
      if (result !== null) return result;
    }

    // Fallback to in-memory
    const entry = this.fallbackCache.get(key);
    if (!entry) return null;

    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.fallbackCache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs = 300000): Promise<void> {
    const expiresAt = Date.now() + ttlMs;

    // Try compute cache
    if (this.computeAvailable) {
      await this.computeSet(key, value, ttlMs).catch(() => {
        this.computeAvailable = false;
      });
    }

    // Always set in fallback for reliability
    this.fallbackCache.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    if (this.computeAvailable) {
      await this.computeDelete(key).catch(() => {});
    }
    this.fallbackCache.delete(key);
  }

  async clear(): Promise<void> {
    if (this.computeAvailable) {
      await this.computeClear().catch(() => {});
    }
    this.fallbackCache.clear();
  }

  async isHealthy(): Promise<boolean> {
    if (!this.computeAvailable) {
      // Retry connection periodically
      this.computeAvailable = await this.checkComputeHealth();
    }
    return this.computeAvailable;
  }

  private async computeGet<T>(key: string): Promise<T | null> {
    const response = await fetch(`${COMPUTE_CACHE_ENDPOINT}/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);

    if (!response || !response.ok) return null;

    const data = await response.json() as { value: T | null };
    return data.value;
  }

  private async computeSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await fetch(`${COMPUTE_CACHE_ENDPOINT}/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, ttlMs }),
      signal: AbortSignal.timeout(2000),
    });
  }

  private async computeDelete(key: string): Promise<void> {
    await fetch(`${COMPUTE_CACHE_ENDPOINT}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(2000),
    });
  }

  private async computeClear(): Promise<void> {
    await fetch(`${COMPUTE_CACHE_ENDPOINT}/clear`, {
      method: 'POST',
      signal: AbortSignal.timeout(2000),
    });
  }

  private async checkComputeHealth(): Promise<boolean> {
    const response = await fetch(`${COMPUTE_CACHE_ENDPOINT}/health`, {
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);
    
    return response?.ok ?? false;
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
