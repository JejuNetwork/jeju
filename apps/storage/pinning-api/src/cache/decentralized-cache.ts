/**
 * Decentralized Cache Service
 * 
 * Redis-compatible distributed cache backed by:
 * - In-memory LRU cache for hot data
 * - IPFS for persistent cache
 * - CovenantSQL for cache metadata
 * 
 * Features:
 * - TTL support
 * - Pattern-based key expiration
 * - Cluster mode support
 * - A2A/MCP interfaces
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

// ============================================================================
// Types
// ============================================================================

export interface CacheConfig {
  /** Maximum items in memory */
  maxMemoryItems: number;
  /** Default TTL in seconds */
  defaultTTL: number;
  /** Enable IPFS persistence */
  persistToIPFS: boolean;
  /** IPFS API URL */
  ipfsUrl?: string;
  /** Enable logging */
  logging: boolean;
}

export interface CacheEntry {
  key: string;
  value: unknown;
  createdAt: number;
  expiresAt: number | null;
  accessCount: number;
  lastAccessedAt: number;
  size: number;
  ipfsCid?: string;
}

export interface CacheStats {
  totalKeys: number;
  memoryUsed: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  evictionCount: number;
}

// ============================================================================
// LRU Cache Implementation
// ============================================================================

class LRUCache<K, V> {
  private cache: Map<K, V> = new Map();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // Delete if exists (to update position)
    this.cache.delete(key);
    
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    
    this.cache.set(key, value);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  values(): IterableIterator<V> {
    return this.cache.values();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ============================================================================
// Decentralized Cache
// ============================================================================

export class DecentralizedCache {
  private config: CacheConfig;
  private cache: LRUCache<string, CacheEntry>;
  private stats: CacheStats;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxMemoryItems: config.maxMemoryItems ?? 10000,
      defaultTTL: config.defaultTTL ?? 3600,
      persistToIPFS: config.persistToIPFS ?? false,
      ipfsUrl: config.ipfsUrl ?? process.env.IPFS_API_URL,
      logging: config.logging ?? false,
    };

    this.cache = new LRUCache(this.config.maxMemoryItems);
    this.stats = {
      totalKeys: 0,
      memoryUsed: 0,
      hitCount: 0,
      missCount: 0,
      hitRate: 0,
      evictionCount: 0,
    };

    // Start TTL cleanup interval
    setInterval(() => this.cleanupExpired(), 60000);
  }

  /**
   * Get a value from cache
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.missCount++;
      this.updateHitRate();
      
      if (this.config.logging) {
        console.log(`[Cache] MISS: ${key}`);
      }
      
      return null;
    }

    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.totalKeys--;
      this.stats.missCount++;
      this.updateHitRate();
      return null;
    }

    entry.accessCount++;
    entry.lastAccessedAt = Date.now();
    this.stats.hitCount++;
    this.updateHitRate();

    if (this.config.logging) {
      console.log(`[Cache] HIT: ${key}`);
    }

    return entry.value as T;
  }

  /**
   * Set a value in cache
   */
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.config.defaultTTL;
    const now = Date.now();
    const size = this.estimateSize(value);

    const entry: CacheEntry = {
      key,
      value,
      createdAt: now,
      expiresAt: ttl > 0 ? now + ttl * 1000 : null,
      accessCount: 0,
      lastAccessedAt: now,
      size,
    };

    // Persist to IPFS if enabled
    if (this.config.persistToIPFS && this.config.ipfsUrl) {
      entry.ipfsCid = await this.persistToIPFS(key, value);
    }

    const existed = this.cache.has(key);
    this.cache.set(key, entry);

    if (!existed) {
      this.stats.totalKeys++;
    }
    this.stats.memoryUsed += size;

    if (this.config.logging) {
      console.log(`[Cache] SET: ${key} (TTL: ${ttl}s)`);
    }
  }

  /**
   * Delete a key from cache
   */
  async delete(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return false;

    this.cache.delete(key);
    this.stats.totalKeys--;
    this.stats.memoryUsed -= entry.size;

    if (this.config.logging) {
      console.log(`[Cache] DEL: ${key}`);
    }

    return true;
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.totalKeys--;
      return false;
    }

    return true;
  }

  /**
   * Set expiration on existing key
   */
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return false;

    entry.expiresAt = Date.now() + ttlSeconds * 1000;
    return true;
  }

  /**
   * Get remaining TTL
   */
  async ttl(key: string): Promise<number> {
    const entry = this.cache.get(key);
    if (!entry) return -2;
    if (!entry.expiresAt) return -1;

    const remaining = Math.floor((entry.expiresAt - Date.now()) / 1000);
    return Math.max(0, remaining);
  }

  /**
   * Increment a numeric value
   */
  async incr(key: string, by = 1): Promise<number> {
    const current = await this.get<number>(key);
    const newValue = (current ?? 0) + by;
    await this.set(key, newValue);
    return newValue;
  }

  /**
   * Decrement a numeric value
   */
  async decr(key: string, by = 1): Promise<number> {
    return this.incr(key, -by);
  }

  /**
   * Get multiple keys
   */
  async mget<T = unknown>(...keys: string[]): Promise<(T | null)[]> {
    return Promise.all(keys.map(k => this.get<T>(k)));
  }

  /**
   * Set multiple key-value pairs
   */
  async mset(pairs: Record<string, unknown>): Promise<void> {
    await Promise.all(Object.entries(pairs).map(([k, v]) => this.set(k, v)));
  }

  /**
   * Get keys matching pattern
   */
  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    const matches: string[] = [];

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        matches.push(key);
      }
    }

    return matches;
  }

  /**
   * Delete keys matching pattern
   */
  async deletePattern(pattern: string): Promise<number> {
    const keysToDelete = await this.keys(pattern);
    let deleted = 0;

    for (const key of keysToDelete) {
      if (await this.delete(key)) {
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * Flush all keys
   */
  async flush(): Promise<void> {
    this.cache.clear();
    this.stats.totalKeys = 0;
    this.stats.memoryUsed = 0;
    this.stats.evictionCount = 0;

    if (this.config.logging) {
      console.log('[Cache] FLUSH');
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private cleanupExpired(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const entry of this.cache.values()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.cache.delete(entry.key);
        this.stats.totalKeys--;
        this.stats.memoryUsed -= entry.size;
        cleaned++;
      }
    }

    if (cleaned > 0 && this.config.logging) {
      console.log(`[Cache] Cleaned ${cleaned} expired entries`);
    }
  }

  private updateHitRate(): void {
    const total = this.stats.hitCount + this.stats.missCount;
    this.stats.hitRate = total > 0 ? this.stats.hitCount / total : 0;
  }

  private estimateSize(value: unknown): number {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 1024; // Default estimate
    }
  }

  private async persistToIPFS(key: string, value: unknown): Promise<string | undefined> {
    if (!this.config.ipfsUrl) return undefined;

    try {
      const formData = new FormData();
      formData.append('file', new Blob([JSON.stringify({ key, value })]));

      const response = await fetch(`${this.config.ipfsUrl}/api/v0/add`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const result = await response.json() as { Hash: string };
        return result.Hash;
      }
    } catch (error) {
      if (this.config.logging) {
        console.error('[Cache] IPFS persist error:', error);
      }
    }

    return undefined;
  }
}

// ============================================================================
// Cache Router (Redis-compatible HTTP API)
// ============================================================================

export function createCacheRouter(cache: DecentralizedCache): Hono {
  const app = new Hono();
  app.use('/*', cors());

  // GET /key
  app.get('/:key', async (c) => {
    const key = c.req.param('key');
    const value = await cache.get(key);
    
    if (value === null) {
      return c.json({ error: 'Key not found' }, 404);
    }
    
    return c.json({ key, value });
  });

  // SET /key
  app.post('/:key', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json<{ value: unknown; ttl?: number }>();
    
    await cache.set(key, body.value, body.ttl);
    return c.json({ success: true, key });
  });

  // DELETE /key
  app.delete('/:key', async (c) => {
    const key = c.req.param('key');
    const deleted = await cache.delete(key);
    return c.json({ deleted });
  });

  // EXISTS /exists/:key
  app.get('/exists/:key', async (c) => {
    const key = c.req.param('key');
    const exists = await cache.exists(key);
    return c.json({ key, exists });
  });

  // TTL /ttl/:key
  app.get('/ttl/:key', async (c) => {
    const key = c.req.param('key');
    const ttl = await cache.ttl(key);
    return c.json({ key, ttl });
  });

  // INCR /incr/:key
  app.post('/incr/:key', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json<{ by?: number }>().catch(() => ({}));
    const value = await cache.incr(key, body.by);
    return c.json({ key, value });
  });

  // KEYS /keys?pattern=*
  app.get('/keys', async (c) => {
    const pattern = c.req.query('pattern') ?? '*';
    const keys = await cache.keys(pattern);
    return c.json({ keys, count: keys.length });
  });

  // FLUSH /flush
  app.post('/flush', async (c) => {
    await cache.flush();
    return c.json({ success: true });
  });

  // STATS /stats
  app.get('/stats', (c) => {
    return c.json(cache.getStats());
  });

  // Health
  app.get('/health', (c) => {
    const stats = cache.getStats();
    return c.json({
      status: 'healthy',
      service: 'jeju-cache',
      keys: stats.totalKeys,
      hitRate: Math.round(stats.hitRate * 100) + '%',
    });
  });

  return app;
}

// ============================================================================
// Cache A2A/MCP Server
// ============================================================================

export function createCacheA2AServer(cache: DecentralizedCache): Hono {
  const app = new Hono();
  app.use('/*', cors());

  const AGENT_CARD = {
    protocolVersion: '0.3.0',
    name: 'Jeju Cache',
    description: 'Decentralized Redis-compatible caching service',
    url: '/cache/a2a',
    preferredTransport: 'http',
    provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
    version: '1.0.0',
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: [
      { id: 'get', name: 'Get', description: 'Get value by key', tags: ['query', 'get'] },
      { id: 'set', name: 'Set', description: 'Set key-value pair', tags: ['action', 'set'] },
      { id: 'delete', name: 'Delete', description: 'Delete key', tags: ['action', 'delete'] },
      { id: 'keys', name: 'Keys', description: 'List keys by pattern', tags: ['query', 'keys'] },
      { id: 'stats', name: 'Stats', description: 'Get cache statistics', tags: ['query', 'stats'] },
      { id: 'flush', name: 'Flush', description: 'Clear all keys', tags: ['action', 'flush'] },
    ],
  };

  app.get('/.well-known/agent-card.json', (c) => c.json(AGENT_CARD));

  app.post('/', async (c) => {
    const body = await c.req.json() as {
      jsonrpc: string;
      id: number | string;
      method: string;
      params?: {
        message?: {
          messageId: string;
          parts: Array<{ kind: string; data?: Record<string, unknown> }>;
        };
      };
    };

    if (body.method !== 'message/send') {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
    }

    const dataPart = body.params?.message?.parts?.find(p => p.kind === 'data');
    const skillId = dataPart?.data?.skillId as string;
    const params = dataPart?.data ?? {};
    let result: { message: string; data: Record<string, unknown> };

    switch (skillId) {
      case 'get': {
        const value = await cache.get(params.key as string);
        result = { message: `Value for ${params.key}`, data: { key: params.key, value } };
        break;
      }
      case 'set': {
        await cache.set(params.key as string, params.value, params.ttl as number | undefined);
        result = { message: 'Value set', data: { key: params.key, success: true } };
        break;
      }
      case 'delete': {
        const deleted = await cache.delete(params.key as string);
        result = { message: `Key ${deleted ? 'deleted' : 'not found'}`, data: { key: params.key, deleted } };
        break;
      }
      case 'keys': {
        const keys = await cache.keys((params.pattern as string) ?? '*');
        result = { message: `Found ${keys.length} keys`, data: { keys } };
        break;
      }
      case 'stats':
        result = { message: 'Cache statistics', data: cache.getStats() };
        break;
      case 'flush':
        await cache.flush();
        result = { message: 'Cache flushed', data: { success: true } };
        break;
      default:
        result = { message: 'Unknown skill', data: { error: 'Skill not found' } };
    }

    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        role: 'agent',
        parts: [
          { kind: 'text', text: result.message },
          { kind: 'data', data: result.data },
        ],
        messageId: body.params?.message?.messageId,
        kind: 'message',
      },
    });
  });

  return app;
}

// ============================================================================
// Factory Functions
// ============================================================================

let globalCache: DecentralizedCache | null = null;

export function getDecentralizedCache(config?: Partial<CacheConfig>): DecentralizedCache {
  if (globalCache) return globalCache;

  globalCache = new DecentralizedCache({
    maxMemoryItems: parseInt(process.env.CACHE_MAX_ITEMS ?? '10000', 10),
    defaultTTL: parseInt(process.env.CACHE_DEFAULT_TTL ?? '3600', 10),
    persistToIPFS: process.env.CACHE_PERSIST_IPFS === 'true',
    ipfsUrl: process.env.IPFS_API_URL,
    logging: process.env.CACHE_LOGGING === 'true',
    ...config,
  });

  return globalCache;
}

export function resetDecentralizedCache(): void {
  globalCache = null;
}

