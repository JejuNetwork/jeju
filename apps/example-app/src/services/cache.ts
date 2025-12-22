/**
 * Cache Service using Compute-based Redis
 *
 * Provides a decentralized caching layer using the compute network.
 * Falls back to in-memory cache in localnet when compute is unavailable.
 */

const COMPUTE_CACHE_ENDPOINT =
  process.env.COMPUTE_CACHE_ENDPOINT || 'http://localhost:4200/cache';
const CACHE_TIMEOUT = 5000;
const NETWORK = process.env.NETWORK || 'localnet';

interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  isHealthy(): Promise<boolean>;
}

// In-memory fallback cache
const memoryCache: Map<string, { value: unknown; expiresAt: number }> = new Map();

function cleanExpired(): void {
  const now = Date.now();
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.expiresAt && entry.expiresAt < now) {
      memoryCache.delete(key);
    }
  }
}

class ComputeCacheService implements CacheService {
  private healthLastChecked = 0;
  private healthy = false;
  private useFallback = false;
  private checkedFallback = false;

  private async checkFallback(): Promise<void> {
    if (this.checkedFallback) return;
    this.checkedFallback = true;

    // Check if compute cache is available
    const isHealthy = await this.isHealthy();
    if (!isHealthy && (NETWORK === 'localnet' || NETWORK === 'Jeju')) {
      console.log('[Cache] Compute cache unavailable, using in-memory fallback');
      this.useFallback = true;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    await this.checkFallback();

    if (this.useFallback) {
      cleanExpired();
      const entry = memoryCache.get(key);
      if (!entry) return null;
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        memoryCache.delete(key);
        return null;
      }
      return entry.value as T;
    }

    try {
      const response = await fetch(`${COMPUTE_CACHE_ENDPOINT}/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
        signal: AbortSignal.timeout(CACHE_TIMEOUT),
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Cache get failed: ${response.status}`);
      }

      const data = (await response.json()) as { value: T | null };
      return data.value;
    } catch (error) {
      // If request fails, use fallback for localnet
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      if (NETWORK === 'localnet' || NETWORK === 'Jeju') {
        console.warn(`[Cache] Get failed, using fallback: ${errorMsg}`);
        this.useFallback = true;
        return this.get(key);
      }
      console.error(`[Cache] Get failed: ${errorMsg}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlMs = 300000): Promise<void> {
    await this.checkFallback();

    if (this.useFallback) {
      memoryCache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
      });
      return;
    }

    try {
      const response = await fetch(`${COMPUTE_CACHE_ENDPOINT}/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, ttlMs }),
        signal: AbortSignal.timeout(CACHE_TIMEOUT),
      });

      if (!response.ok) {
        throw new Error(`Cache set failed: ${response.status}`);
      }
    } catch (error) {
      // If request fails, use fallback for localnet
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      if (NETWORK === 'localnet' || NETWORK === 'Jeju') {
        console.warn(`[Cache] Set failed, using fallback: ${errorMsg}`);
        this.useFallback = true;
        await this.set(key, value, ttlMs);
      } else {
        console.error(`[Cache] Set failed: ${errorMsg}`);
      }
    }
  }

  async delete(key: string): Promise<void> {
    await this.checkFallback();

    if (this.useFallback) {
      memoryCache.delete(key);
      return;
    }

    try {
      const response = await fetch(`${COMPUTE_CACHE_ENDPOINT}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
        signal: AbortSignal.timeout(CACHE_TIMEOUT),
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Cache delete failed: ${response.status}`);
      }
    } catch (error) {
      // If request fails, use fallback for localnet
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      if (NETWORK === 'localnet' || NETWORK === 'Jeju') {
        console.warn(`[Cache] Delete failed, using fallback: ${errorMsg}`);
        this.useFallback = true;
        memoryCache.delete(key);
      } else {
        console.error(`[Cache] Delete failed: ${errorMsg}`);
      }
    }
  }

  async clear(): Promise<void> {
    await this.checkFallback();

    if (this.useFallback) {
      memoryCache.clear();
      return;
    }

    try {
      const response = await fetch(`${COMPUTE_CACHE_ENDPOINT}/clear`, {
        method: 'POST',
        signal: AbortSignal.timeout(CACHE_TIMEOUT),
      });

      if (!response.ok) {
        throw new Error(`Cache clear failed: ${response.status}`);
      }
    } catch (error) {
      // If request fails, use fallback for localnet
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      if (NETWORK === 'localnet' || NETWORK === 'Jeju') {
        console.warn(`[Cache] Clear failed, using fallback: ${errorMsg}`);
        this.useFallback = true;
        memoryCache.clear();
      } else {
        console.error(`[Cache] Clear failed: ${errorMsg}`);
      }
    }
  }

  async isHealthy(): Promise<boolean> {
    if (this.useFallback) return true; // In-memory fallback is always healthy

    // Cache the health check result for 30 seconds
    if (Date.now() - this.healthLastChecked < 30000) {
      return this.healthy;
    }

    try {
      const response = await fetch(`${COMPUTE_CACHE_ENDPOINT}/health`, {
        signal: AbortSignal.timeout(CACHE_TIMEOUT),
      });

      this.healthy = response.ok;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.debug(`[Cache] Health check failed: ${errorMsg}`);
      this.healthy = false;
    }

    this.healthLastChecked = Date.now();
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

// For testing: reset the cache
export function resetCache(): void {
  cacheService = null;
  memoryCache.clear();
}

// Cache key helpers
export const cacheKeys = {
  todoList: (owner: string) => `todos:list:${owner.toLowerCase()}`,
  todoItem: (id: string) => `todos:item:${id}`,
  todoStats: (owner: string) => `todos:stats:${owner.toLowerCase()}`,
  userSession: (address: string) => `session:${address.toLowerCase()}`,
};
