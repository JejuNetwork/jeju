/**
 * Distributed Cache Layer for Developer Infrastructure
 * 
 * Provides fast caching for:
 * - Git objects and pack files
 * - NPM package manifests and tarballs
 * - Container image layers
 * 
 * Features:
 * - Multi-tier caching (memory -> disk -> IPFS)
 * - LRU eviction policy
 * - TTL-based expiration
 * - Cache warming from peers
 * - Metrics and monitoring
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export interface CacheConfig {
  maxMemoryMB: number;
  maxDiskMB: number;
  defaultTTL: number;
  cleanupInterval: number;
  diskPath: string;
  enableMetrics: boolean;
  peers?: string[];
}

export interface CacheEntry {
  key: string;
  data: Buffer;
  size: number;
  createdAt: number;
  accessedAt: number;
  ttl: number;
  hits: number;
  tier: 'memory' | 'disk' | 'ipfs';
  contentType?: string;
  etag?: string;
}

export interface CacheStats {
  memoryUsed: number;
  memoryMax: number;
  diskUsed: number;
  diskMax: number;
  totalEntries: number;
  memoryEntries: number;
  diskEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
  promotions: number;
  demotions: number;
}

class LRUMap<K, V> extends Map<K, V> {
  private maxSize: number;
  private accessOrder: K[] = [];

  constructor(maxSize: number) {
    super();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = super.get(key);
    if (value !== undefined) {
      this.touch(key);
    }
    return value;
  }

  set(key: K, value: V): this {
    if (this.has(key)) {
      this.touch(key);
    } else {
      this.accessOrder.push(key);
    }
    super.set(key, value);
    
    while (this.size > this.maxSize) {
      const oldest = this.accessOrder.shift();
      if (oldest !== undefined) {
        super.delete(oldest);
      }
    }
    
    return this;
  }

  private touch(key: K): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx >= 0) {
      this.accessOrder.splice(idx, 1);
      this.accessOrder.push(key);
    }
  }

  getLRU(): K | undefined {
    return this.accessOrder[0];
  }
}

export class DistributedCache {
  private config: CacheConfig;
  private memoryCache: LRUMap<string, CacheEntry>;
  private diskIndex: Map<string, { path: string; size: number; createdAt: number }> = new Map();
  private stats: {
    hits: number;
    misses: number;
    evictions: number;
    promotions: number;
    demotions: number;
  };
  private cleanupTimer: Timer | null = null;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxMemoryMB: config.maxMemoryMB ?? 256,
      maxDiskMB: config.maxDiskMB ?? 1024,
      defaultTTL: config.defaultTTL ?? 3600000, // 1 hour
      cleanupInterval: config.cleanupInterval ?? 60000, // 1 minute
      diskPath: config.diskPath ?? join(process.cwd(), '.cache'),
      enableMetrics: config.enableMetrics ?? true,
      peers: config.peers ?? [],
    };

    const maxMemoryEntries = Math.floor((this.config.maxMemoryMB * 1024 * 1024) / 10000); // Assume ~10KB avg
    this.memoryCache = new LRUMap(maxMemoryEntries);
    
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      promotions: 0,
      demotions: 0,
    };

    // Ensure disk cache directory exists
    if (!existsSync(this.config.diskPath)) {
      mkdirSync(this.config.diskPath, { recursive: true });
    }

    // Load disk index
    this.loadDiskIndex();

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupInterval);
  }

  async get(key: string): Promise<Buffer | null> {
    const cacheKey = this.hashKey(key);
    
    // Check memory cache
    const memEntry = this.memoryCache.get(cacheKey);
    if (memEntry && !this.isExpired(memEntry)) {
      memEntry.accessedAt = Date.now();
      memEntry.hits++;
      this.stats.hits++;
      return memEntry.data;
    }

    // Check disk cache
    const diskEntry = this.diskIndex.get(cacheKey);
    if (diskEntry) {
      const data = this.readFromDisk(diskEntry.path);
      if (data) {
        this.stats.hits++;
        // Promote to memory if frequently accessed
        const entry: CacheEntry = {
          key: cacheKey,
          data,
          size: data.length,
          createdAt: diskEntry.createdAt,
          accessedAt: Date.now(),
          ttl: this.config.defaultTTL,
          hits: 1,
          tier: 'disk',
        };
        this.promoteToMemory(entry);
        return data;
      }
    }

    // Try to fetch from peers
    if (this.config.peers && this.config.peers.length > 0) {
      const peerData = await this.fetchFromPeers(key);
      if (peerData) {
        this.set(key, peerData);
        return peerData;
      }
    }

    this.stats.misses++;
    return null;
  }

  set(key: string, data: Buffer, options?: { ttl?: number; contentType?: string }): void {
    const cacheKey = this.hashKey(key);
    const size = data.length;
    const now = Date.now();

    const entry: CacheEntry = {
      key: cacheKey,
      data,
      size,
      createdAt: now,
      accessedAt: now,
      ttl: options?.ttl ?? this.config.defaultTTL,
      hits: 0,
      tier: 'memory',
      contentType: options?.contentType,
      etag: this.computeEtag(data),
    };

    // Always try to store in memory first
    const memoryUsed = this.getMemoryUsage();
    const maxMemory = this.config.maxMemoryMB * 1024 * 1024;

    if (size < maxMemory * 0.1 && memoryUsed + size < maxMemory) {
      this.memoryCache.set(cacheKey, entry);
    } else {
      // Store on disk
      entry.tier = 'disk';
      this.writeToDisk(cacheKey, data);
    }
  }

  delete(key: string): boolean {
    const cacheKey = this.hashKey(key);
    
    const hadMemory = this.memoryCache.delete(cacheKey);
    
    const diskEntry = this.diskIndex.get(cacheKey);
    if (diskEntry) {
      this.deleteFromDisk(diskEntry.path);
      this.diskIndex.delete(cacheKey);
      return true;
    }

    return hadMemory;
  }

  has(key: string): boolean {
    const cacheKey = this.hashKey(key);
    
    const memEntry = this.memoryCache.get(cacheKey);
    if (memEntry && !this.isExpired(memEntry)) {
      return true;
    }

    return this.diskIndex.has(cacheKey);
  }

  getStats(): CacheStats {
    const memoryUsed = this.getMemoryUsage();
    const diskUsed = this.getDiskUsage();

    return {
      memoryUsed,
      memoryMax: this.config.maxMemoryMB * 1024 * 1024,
      diskUsed,
      diskMax: this.config.maxDiskMB * 1024 * 1024,
      totalEntries: this.memoryCache.size + this.diskIndex.size,
      memoryEntries: this.memoryCache.size,
      diskEntries: this.diskIndex.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: this.stats.hits / Math.max(1, this.stats.hits + this.stats.misses),
      evictions: this.stats.evictions,
      promotions: this.stats.promotions,
      demotions: this.stats.demotions,
    };
  }

  async warmup(keys: string[]): Promise<number> {
    let warmed = 0;
    
    for (const key of keys) {
      if (!this.has(key)) {
        const data = await this.fetchFromPeers(key);
        if (data) {
          this.set(key, data);
          warmed++;
        }
      }
    }

    return warmed;
  }

  clear(): void {
    this.memoryCache.clear();
    
    // Clear disk cache
    for (const [, entry] of this.diskIndex) {
      this.deleteFromDisk(entry.path);
    }
    this.diskIndex.clear();
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 32);
  }

  private computeEtag(data: Buffer): string {
    return createHash('md5').update(data).digest('hex');
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.createdAt > entry.ttl;
  }

  private getMemoryUsage(): number {
    let total = 0;
    for (const [, entry] of this.memoryCache) {
      total += entry.size;
    }
    return total;
  }

  private getDiskUsage(): number {
    let total = 0;
    for (const [, entry] of this.diskIndex) {
      total += entry.size;
    }
    return total;
  }

  private promoteToMemory(entry: CacheEntry): void {
    const memoryUsed = this.getMemoryUsage();
    const maxMemory = this.config.maxMemoryMB * 1024 * 1024;

    if (entry.size < maxMemory * 0.1 && memoryUsed + entry.size < maxMemory) {
      entry.tier = 'memory';
      this.memoryCache.set(entry.key, entry);
      this.stats.promotions++;
    }
  }

  private demoteToDisk(key: string): void {
    const entry = this.memoryCache.get(key);
    if (entry) {
      this.writeToDisk(key, entry.data);
      this.memoryCache.delete(key);
      this.stats.demotions++;
    }
  }

  private writeToDisk(key: string, data: Buffer): void {
    const path = join(this.config.diskPath, key);
    writeFileSync(path, data);
    this.diskIndex.set(key, {
      path,
      size: data.length,
      createdAt: Date.now(),
    });
  }

  private readFromDisk(path: string): Buffer | null {
    try {
      return readFileSync(path);
    } catch {
      return null;
    }
  }

  private deleteFromDisk(path: string): void {
    try {
      unlinkSync(path);
    } catch {
      // File may already be deleted
    }
  }

  private loadDiskIndex(): void {
    const files = readdirSync(this.config.diskPath).filter(f => !f.startsWith('.'));
    
    for (const file of files) {
      const path = join(this.config.diskPath, file);
      const stats = statSync(path);
      this.diskIndex.set(file, {
        path,
        size: stats.size,
        createdAt: stats.mtimeMs,
      });
    }
  }

  private cleanup(): void {
    const now = Date.now();

    // Cleanup expired memory entries
    for (const [key, entry] of this.memoryCache) {
      if (this.isExpired(entry)) {
        this.memoryCache.delete(key);
        this.stats.evictions++;
      }
    }

    // Evict LRU entries if over memory limit
    while (this.getMemoryUsage() > this.config.maxMemoryMB * 1024 * 1024 * 0.9) {
      const lruKey = this.memoryCache.getLRU();
      if (lruKey) {
        this.demoteToDisk(lruKey);
        this.stats.evictions++;
      } else {
        break;
      }
    }

    // Cleanup disk entries if over limit
    const diskEntries = Array.from(this.diskIndex.entries())
      .sort(([, a], [, b]) => a.createdAt - b.createdAt);

    while (this.getDiskUsage() > this.config.maxDiskMB * 1024 * 1024 * 0.9 && diskEntries.length > 0) {
      const [key, entry] = diskEntries.shift()!;
      this.deleteFromDisk(entry.path);
      this.diskIndex.delete(key);
      this.stats.evictions++;
    }
  }

  private async fetchFromPeers(key: string): Promise<Buffer | null> {
    for (const peer of this.config.peers ?? []) {
      try {
        const response = await fetch(`${peer}/cache/${encodeURIComponent(key)}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          const data = await response.arrayBuffer();
          return Buffer.from(data);
        }
      } catch {
        // Peer unavailable, try next
      }
    }
    return null;
  }
}

// Singleton instance
let cacheInstance: DistributedCache | null = null;

export function getCache(config?: Partial<CacheConfig>): DistributedCache {
  if (!cacheInstance) {
    cacheInstance = new DistributedCache(config);
  }
  return cacheInstance;
}

export function resetCache(): void {
  if (cacheInstance) {
    cacheInstance.stop();
    cacheInstance = null;
  }
}
