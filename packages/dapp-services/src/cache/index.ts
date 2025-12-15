/**
 * Cache Service - Compute Redis Integration
 * 
 * Provides decentralized caching via compute network.
 * Falls back to in-memory when compute unavailable.
 */

export interface CacheConfig {
  endpoint?: string;
  defaultTTL?: number;
  fallbackEnabled?: boolean;
}

export interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  clear(pattern?: string): Promise<void>;
  isHealthy(): Promise<boolean>;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class CacheServiceImpl implements CacheService {
  private endpoint: string;
  private defaultTTL: number;
  private fallback = new Map<string, CacheEntry<unknown>>();
  private computeAvailable = true;

  constructor(config: CacheConfig) {
    this.endpoint = config.endpoint || process.env.COMPUTE_CACHE_ENDPOINT || 'http://localhost:4200/cache';
    this.defaultTTL = config.defaultTTL || 300000; // 5 minutes
  }

  async get<T>(key: string): Promise<T | null> {
    // Try compute cache
    if (this.computeAvailable) {
      const result = await this.remoteGet<T>(key);
      if (result !== null) return result;
    }

    // Fallback to in-memory
    const entry = this.fallback.get(key);
    if (!entry) return null;

    if (entry.expiresAt < Date.now()) {
      this.fallback.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.defaultTTL;
    const expiresAt = Date.now() + ttl;

    // Try compute cache
    if (this.computeAvailable) {
      await this.remoteSet(key, value, ttl).catch(() => {
        this.computeAvailable = false;
      });
    }

    // Always set in fallback
    this.fallback.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    if (this.computeAvailable) {
      await this.remoteDelete(key).catch(() => {});
    }
    this.fallback.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  async clear(pattern?: string): Promise<void> {
    if (this.computeAvailable) {
      await this.remoteClear(pattern).catch(() => {});
    }

    if (pattern) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      for (const key of this.fallback.keys()) {
        if (regex.test(key)) {
          this.fallback.delete(key);
        }
      }
    } else {
      this.fallback.clear();
    }
  }

  async isHealthy(): Promise<boolean> {
    if (!this.computeAvailable) {
      this.computeAvailable = await this.checkHealth();
    }
    return this.computeAvailable;
  }

  private async remoteGet<T>(key: string): Promise<T | null> {
    const response = await fetch(`${this.endpoint}/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);

    if (!response || !response.ok) return null;
    const data = await response.json() as { value: T | null };
    return data.value;
  }

  private async remoteSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await fetch(`${this.endpoint}/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, ttlMs }),
      signal: AbortSignal.timeout(2000),
    });
  }

  private async remoteDelete(key: string): Promise<void> {
    await fetch(`${this.endpoint}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(2000),
    });
  }

  private async remoteClear(pattern?: string): Promise<void> {
    await fetch(`${this.endpoint}/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern }),
      signal: AbortSignal.timeout(2000),
    });
  }

  private async checkHealth(): Promise<boolean> {
    const response = await fetch(`${this.endpoint}/health`, {
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);
    return response?.ok ?? false;
  }
}

let instance: CacheService | null = null;

export function createCacheService(config: CacheConfig = {}): CacheService {
  if (!instance) {
    instance = new CacheServiceImpl(config);
  }
  return instance;
}

export function resetCacheService(): void {
  instance = null;
}

// Cache key helpers
export const cacheKeys = {
  // Generic patterns
  list: (entity: string, owner: string) => `${entity}:list:${owner.toLowerCase()}`,
  item: (entity: string, id: string) => `${entity}:item:${id}`,
  stats: (entity: string, owner: string) => `${entity}:stats:${owner.toLowerCase()}`,
  session: (address: string) => `session:${address.toLowerCase()}`,
  
  // App-specific factories
  forApp: (appName: string) => ({
    list: (entity: string, owner: string) => `${appName}:${entity}:list:${owner.toLowerCase()}`,
    item: (entity: string, id: string) => `${appName}:${entity}:item:${id}`,
    stats: (entity: string, owner: string) => `${appName}:${entity}:stats:${owner.toLowerCase()}`,
    custom: (key: string) => `${appName}:${key}`,
  }),
};
