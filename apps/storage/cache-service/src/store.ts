/**
 * Cache Store - In-memory cache with TTL and namespacing
 */

import type { CacheStats, InstanceStats } from './types.js';

interface CacheValue {
  value: string;
  createdAt: number;
  expiresAt: number | null;
}

export class CacheStore {
  private stores = new Map<string, Map<string, CacheValue>>();
  private stats = new Map<string, { hits: number; misses: number; lastAccess: number }>();
  private maxMemoryMb: number;
  private defaultTtl: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(maxMemoryMb = 256, defaultTtlSeconds = 3600) {
    this.maxMemoryMb = maxMemoryMb;
    this.defaultTtl = defaultTtlSeconds;
    this.startCleanup();
  }

  set(namespace: string, key: string, value: string, ttlSeconds?: number): void {
    const store = this.getOrCreateStore(namespace);
    if (this.isMemoryFull()) this.evictOldest(namespace);

    const ttl = ttlSeconds ?? this.defaultTtl;
    store.set(key, {
      value,
      createdAt: Date.now(),
      expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null,
    });
    this.updateStats(namespace, 'set');
  }

  get(namespace: string, key: string): string | null {
    const entry = this.getEntry(namespace, key);
    if (!entry) { this.updateStats(namespace, 'miss'); return null; }
    this.updateStats(namespace, 'hit');
    return entry.value;
  }

  delete(namespace: string, key: string): boolean {
    return this.stores.get(namespace)?.delete(key) ?? false;
  }

  has(namespace: string, key: string): boolean {
    return this.getEntry(namespace, key) !== null;
  }

  exists(namespace: string, key: string): boolean {
    return this.has(namespace, key);
  }

  mset(namespace: string, entries: Array<{ key: string; value: string; ttl?: number }>): void {
    entries.forEach(e => this.set(namespace, e.key, e.value, e.ttl));
  }

  mget(namespace: string, keys: string[]): Map<string, string | null> {
    return new Map(keys.map(k => [k, this.get(namespace, k)]));
  }

  mdelete(namespace: string, keys: string[]): number {
    return keys.filter(k => this.delete(namespace, k)).length;
  }

  keys(namespace: string, pattern?: string): string[] {
    const store = this.stores.get(namespace);
    if (!store) return [];
    const allKeys = Array.from(store.keys());
    if (!pattern) return allKeys;
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return allKeys.filter(k => regex.test(k));
  }

  clearNamespace(namespace: string): void {
    this.stores.delete(namespace);
    this.stats.delete(namespace);
  }

  clear(): void {
    this.stores.clear();
    this.stats.clear();
  }

  clearAll(): void {
    this.clear();
  }

  ttl(namespace: string, key: string): number | null {
    const entry = this.getEntry(namespace, key);
    if (!entry) return null;
    if (!entry.expiresAt) return -1;
    const remaining = Math.floor((entry.expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : null;
  }

  expire(namespace: string, key: string, ttlSeconds: number): boolean {
    const store = this.stores.get(namespace);
    const entry = store?.get(key);
    if (!entry) return false;
    entry.expiresAt = Date.now() + ttlSeconds * 1000;
    return true;
  }

  persist(namespace: string, key: string): boolean {
    const entry = this.stores.get(namespace)?.get(key);
    if (!entry) return false;
    entry.expiresAt = null;
    return true;
  }

  getStats(): CacheStats & { namespaces: number; totalKeys: number } {
    let totalKeys = 0, totalHits = 0, totalMisses = 0;
    for (const store of this.stores.values()) totalKeys += store.size;
    for (const stat of this.stats.values()) { totalHits += stat.hits; totalMisses += stat.misses; }
    const total = totalHits + totalMisses;

    return {
      totalInstances: this.stores.size,
      activeInstances: this.stores.size,
      totalMemoryMb: this.maxMemoryMb,
      usedMemoryMb: this.estimateMemoryUsage(),
      totalKeys,
      namespaces: this.stores.size,
      hits: totalHits,
      misses: totalMisses,
      hitRate: total > 0 ? totalHits / total : 0,
    };
  }

  getInstanceStats(namespace: string): InstanceStats | null {
    const store = this.stores.get(namespace);
    if (!store) return null;
    const stat = this.stats.get(namespace) ?? { hits: 0, misses: 0, lastAccess: 0 };
    const total = stat.hits + stat.misses;

    return {
      instanceId: namespace,
      keyCount: store.size,
      memoryUsedMb: this.estimateStoreMemory(store),
      hits: stat.hits,
      misses: stat.misses,
      hitRate: total > 0 ? stat.hits / total : 0,
      avgLatencyMs: 0.1,
      lastAccess: stat.lastAccess,
    };
  }

  stop(): void {
    if (this.cleanupInterval) { clearInterval(this.cleanupInterval); this.cleanupInterval = null; }
  }

  private getOrCreateStore(namespace: string): Map<string, CacheValue> {
    let store = this.stores.get(namespace);
    if (!store) { store = new Map(); this.stores.set(namespace, store); }
    return store;
  }

  private getEntry(namespace: string, key: string): CacheValue | null {
    const store = this.stores.get(namespace);
    if (!store) return null;
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) { store.delete(key); return null; }
    return entry;
  }

  private updateStats(namespace: string, type: 'hit' | 'miss' | 'set'): void {
    let stat = this.stats.get(namespace);
    if (!stat) { stat = { hits: 0, misses: 0, lastAccess: Date.now() }; this.stats.set(namespace, stat); }
    stat.lastAccess = Date.now();
    if (type === 'hit') stat.hits++;
    else if (type === 'miss') stat.misses++;
  }

  private isMemoryFull(): boolean {
    return this.estimateMemoryUsage() >= this.maxMemoryMb;
  }

  private estimateMemoryUsage(): number {
    let bytes = 0;
    for (const store of this.stores.values()) bytes += this.estimateStoreMemory(store) * 1024 * 1024;
    return bytes / (1024 * 1024);
  }

  private estimateStoreMemory(store: Map<string, CacheValue>): number {
    let bytes = 0;
    for (const [key, val] of store) bytes += (key.length + val.value.length) * 2 + 48;
    return bytes / (1024 * 1024);
  }

  private evictOldest(namespace: string): void {
    const store = this.stores.get(namespace);
    if (!store?.size) return;
    let oldest: [string, number] | null = null;
    for (const [key, val] of store) {
      if (!oldest || val.createdAt < oldest[1]) oldest = [key, val.createdAt];
    }
    if (oldest) store.delete(oldest[0]);
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const store of this.stores.values()) {
        for (const [key, val] of store) {
          if (val.expiresAt && val.expiresAt < now) store.delete(key);
        }
      }
    }, 60000);
  }
}

let cacheStore: CacheStore | null = null;

export function getCacheStore(maxMemoryMb?: number, defaultTtl?: number): CacheStore {
  if (!cacheStore) cacheStore = new CacheStore(maxMemoryMb, defaultTtl);
  return cacheStore;
}

export function resetCacheStore(): void {
  cacheStore?.stop();
  cacheStore = null;
}
