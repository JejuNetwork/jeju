/**
 * Jeju Cache Service
 *
 * Decentralized Redis-compatible cache running in TEE.
 * Provides fast, secure caching with attestation verification.
 *
 * Features:
 * - Redis-compatible API
 * - TEE attestation for security
 * - Multi-tenant namespacing
 * - Rentable cache instances
 * - A2A and MCP integration
 */

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { Address, Hex } from 'viem';
import { getCacheStore, type CacheStore } from './store.js';
import type {
  CacheServiceConfig,
  CacheInstance,
  CacheRentalPlan,
  CreateCacheRequest,
  CacheSetRequest,
  CacheGetRequest,
  CacheBatchSetRequest,
  CacheBatchGetRequest,
} from './types.js';

// ============================================================================
// Configuration
// ============================================================================

const config: CacheServiceConfig = {
  port: parseInt(process.env.CACHE_SERVICE_PORT ?? '4015'),
  defaultTtlSeconds: parseInt(process.env.CACHE_DEFAULT_TTL ?? '3600'),
  maxMemoryMb: parseInt(process.env.CACHE_MAX_MEMORY_MB ?? '256'),
  teeProvider: process.env.TEE_PROVIDER as 'phala' | 'marlin' | 'oasis' | undefined,
  teeEndpoint: process.env.TEE_ENDPOINT,
  teeApiKey: process.env.TEE_API_KEY,
  persistToIpfs: process.env.CACHE_PERSIST_IPFS === 'true',
  ipfsEndpoint: process.env.IPFS_ENDPOINT,
};

// ============================================================================
// Server
// ============================================================================

export class CacheServer {
  private app: Hono;
  private store: CacheStore;
  private instances: Map<string, CacheInstance> = new Map();
  private plans: CacheRentalPlan[] = [];

  constructor() {
    this.app = new Hono();
    this.store = getCacheStore(config.maxMemoryMb, config.defaultTtlSeconds);
    this.initPlans();
    this.setupRoutes();
  }

  private initPlans(): void {
    this.plans = [
      {
        id: 'free',
        name: 'Free Tier',
        maxMemoryMb: 16,
        maxKeys: 1000,
        pricePerHour: 0n,
        pricePerMonth: 0n,
        paymentToken: '0x0000000000000000000000000000000000000000' as Address,
        teeRequired: false,
      },
      {
        id: 'basic',
        name: 'Basic',
        maxMemoryMb: 64,
        maxKeys: 10000,
        pricePerHour: 100000000000000n, // 0.0001 ETH
        pricePerMonth: 50000000000000000n, // 0.05 ETH
        paymentToken: '0x0000000000000000000000000000000000000000' as Address,
        teeRequired: false,
      },
      {
        id: 'pro',
        name: 'Pro (TEE)',
        maxMemoryMb: 256,
        maxKeys: 100000,
        pricePerHour: 500000000000000n, // 0.0005 ETH
        pricePerMonth: 300000000000000000n, // 0.3 ETH
        paymentToken: '0x0000000000000000000000000000000000000000' as Address,
        teeRequired: true,
      },
      {
        id: 'enterprise',
        name: 'Enterprise (TEE)',
        maxMemoryMb: 1024,
        maxKeys: 1000000,
        pricePerHour: 2000000000000000n, // 0.002 ETH
        pricePerMonth: 1000000000000000000n, // 1 ETH
        paymentToken: '0x0000000000000000000000000000000000000000' as Address,
        teeRequired: true,
      },
    ];
  }

  private setupRoutes(): void {
    this.app.use('/*', cors());

    this.app.get('/health', (c: Context) => {
      return c.json({ status: 'healthy', service: 'cache-service', timestamp: new Date().toISOString() });
    });

    // Prometheus metrics
    this.app.get('/metrics', (c: Context) => {
      const stats = this.store.getStats();
      const lines = [
        '# HELP cache_keys_total Total number of keys in cache',
        '# TYPE cache_keys_total gauge',
        `cache_keys_total ${stats.totalKeys}`,
        '# HELP cache_namespaces Total number of namespaces',
        '# TYPE cache_namespaces gauge',
        `cache_namespaces ${stats.namespaces}`,
        '# HELP cache_memory_used_mb Memory used in MB',
        '# TYPE cache_memory_used_mb gauge',
        `cache_memory_used_mb ${stats.usedMemoryMb.toFixed(4)}`,
        '# HELP cache_memory_max_mb Maximum memory in MB',
        '# TYPE cache_memory_max_mb gauge',
        `cache_memory_max_mb ${stats.totalMemoryMb}`,
        '# HELP cache_hits_total Total cache hits',
        '# TYPE cache_hits_total counter',
        `cache_hits_total ${stats.hits}`,
        '# HELP cache_misses_total Total cache misses',
        '# TYPE cache_misses_total counter',
        `cache_misses_total ${stats.misses}`,
        '# HELP cache_hit_rate Cache hit rate',
        '# TYPE cache_hit_rate gauge',
        `cache_hit_rate ${stats.hitRate.toFixed(4)}`,
        '# HELP cache_instances_total Total cache instances',
        '# TYPE cache_instances_total gauge',
        `cache_instances_total ${stats.totalInstances}`,
      ];
      return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; version=0.0.4' } });
    });

    // SET
    this.app.post('/cache/set', async (c: Context) => {
      const req = await c.req.json<CacheSetRequest>();
      const namespace = req.namespace ?? 'default';

      this.store.set(namespace, req.key, req.value, req.ttl);

      return c.json({ success: true, key: req.key });
    });

    // GET
    this.app.get('/cache/get', async (c: Context) => {
      const key = c.req.query('key');
      const namespace = c.req.query('namespace') ?? 'default';

      if (!key) {
        return c.json({ error: 'Key required' }, 400);
      }

      const value = this.store.get(namespace, key);

      return c.json({
        key,
        value,
        found: value !== null,
      });
    });

    // DELETE
    this.app.delete('/cache/delete', async (c: Context) => {
      const key = c.req.query('key');
      const namespace = c.req.query('namespace') ?? 'default';

      if (!key) {
        return c.json({ error: 'Key required' }, 400);
      }

      const deleted = this.store.delete(namespace, key);

      return c.json({ success: deleted, key });
    });

    // MSET (batch set)
    this.app.post('/cache/mset', async (c: Context) => {
      const req = await c.req.json<CacheBatchSetRequest>();
      const namespace = req.namespace ?? 'default';

      this.store.mset(namespace, req.entries);

      return c.json({ success: true, count: req.entries.length });
    });

    // MGET (batch get)
    this.app.post('/cache/mget', async (c: Context) => {
      const req = await c.req.json<CacheBatchGetRequest>();
      const namespace = req.namespace ?? 'default';

      const results = this.store.mget(namespace, req.keys);
      const entries: Record<string, string | null> = {};
      results.forEach((val, key) => {
        entries[key] = val;
      });

      return c.json({ entries });
    });

    // KEYS
    this.app.get('/cache/keys', (c: Context) => {
      const namespace = c.req.query('namespace') ?? 'default';
      const pattern = c.req.query('pattern');

      const keys = this.store.keys(namespace, pattern ?? undefined);

      return c.json({ keys, count: keys.length });
    });

    // TTL
    this.app.get('/cache/ttl', (c: Context) => {
      const key = c.req.query('key');
      const namespace = c.req.query('namespace') ?? 'default';

      if (!key) {
        return c.json({ error: 'Key required' }, 400);
      }

      const ttl = this.store.ttl(namespace, key);

      return c.json({ key, ttl });
    });

    // EXPIRE
    this.app.post('/cache/expire', async (c: Context) => {
      const body = await c.req.json<{ key: string; ttl: number; namespace?: string }>();
      const namespace = body.namespace ?? 'default';

      const success = this.store.expire(namespace, body.key, body.ttl);

      return c.json({ success, key: body.key });
    });

    // CLEAR namespace
    this.app.delete('/cache/clear', (c: Context) => {
      const namespace = c.req.query('namespace') ?? 'default';

      this.store.clearNamespace(namespace);

      return c.json({ success: true, namespace });
    });

    // ========== Rental Management ==========

    // List plans
    this.app.get('/plans', (c: Context) => {
      // Convert BigInt to string for JSON serialization
      const serializablePlans = this.plans.map((plan) => ({
        ...plan,
        pricePerHour: plan.pricePerHour.toString(),
        pricePerMonth: plan.pricePerMonth.toString(),
      }));
      return c.json({ plans: serializablePlans });
    });

    // Create cache instance
    this.app.post('/instances', async (c: Context) => {
      const req = await c.req.json<CreateCacheRequest>();
      const plan = this.plans.find((p) => p.id === req.planId);

      if (!plan) {
        return c.json({ error: 'Invalid plan ID' }, 400);
      }

      const instanceId = `cache-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const namespace = req.namespace ?? instanceId;
      const durationHours = req.durationHours ?? 720; // Default 30 days

      const instance: CacheInstance = {
        id: instanceId,
        owner: '0x0000000000000000000000000000000000000000' as Address, // Would come from auth
        namespace,
        maxMemoryMb: plan.maxMemoryMb,
        usedMemoryMb: 0,
        keyCount: 0,
        createdAt: Date.now(),
        expiresAt: Date.now() + durationHours * 60 * 60 * 1000,
        status: 'running',
        teeInfo: null, // Would be populated if TEE is used
      };

      this.instances.set(instanceId, instance);

      return c.json({ instance });
    });

    // Get instance
    this.app.get('/instances/:id', (c: Context) => {
      const id = c.req.param('id');
      const instance = this.instances.get(id);

      if (!instance) {
        return c.json({ error: 'Instance not found' }, 404);
      }

      // Update stats
      const stats = this.store.getInstanceStats(instance.namespace);
      if (stats) {
        instance.usedMemoryMb = stats.memoryUsedMb;
        instance.keyCount = stats.keyCount;
      }

      return c.json({ instance });
    });

    // List instances
    this.app.get('/instances', (c: Context) => {
      const instances = Array.from(this.instances.values());
      return c.json({ instances });
    });

    // Delete instance
    this.app.delete('/instances/:id', (c: Context) => {
      const id = c.req.param('id');
      const instance = this.instances.get(id);

      if (!instance) {
        return c.json({ error: 'Instance not found' }, 404);
      }

      // Clear cache data
      this.store.clearNamespace(instance.namespace);
      this.instances.delete(id);

      return c.json({ success: true });
    });

    // ========== Stats ==========

    this.app.get('/stats', (c: Context) => {
      const stats = this.store.getStats();
      return c.json({ stats });
    });

    this.app.get('/stats/:namespace', (c: Context) => {
      const namespace = c.req.param('namespace');
      const stats = this.store.getInstanceStats(namespace);

      if (!stats) {
        return c.json({ error: 'Namespace not found' }, 404);
      }

      return c.json({ stats });
    });

    // ========== A2A Agent Card ==========

    this.app.get('/.well-known/agent.json', (c: Context) => {
      return c.json({
        name: 'jeju-cache',
        version: '1.0.0',
        description: 'Decentralized cache service with TEE attestation',
        skills: [
          {
            id: 'cache-set',
            name: 'Set Cache Value',
            description: 'Store a value in the cache',
            input: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' }, ttl: { type: 'number' } } },
          },
          {
            id: 'cache-get',
            name: 'Get Cache Value',
            description: 'Retrieve a value from the cache',
            input: { type: 'object', properties: { key: { type: 'string' } } },
          },
          {
            id: 'cache-delete',
            name: 'Delete Cache Value',
            description: 'Remove a value from the cache',
            input: { type: 'object', properties: { key: { type: 'string' } } },
          },
          {
            id: 'create-instance',
            name: 'Create Cache Instance',
            description: 'Create a new rentable cache instance',
            input: { type: 'object', properties: { planId: { type: 'string' } } },
          },
        ],
        endpoints: {
          a2a: `/a2a`,
        },
      });
    });
  }

  start(): void {
    console.log(`[Cache Service] Starting on port ${config.port}`);
    Bun.serve({
      port: config.port,
      fetch: this.app.fetch,
    });
    console.log(`[Cache Service] Listening on http://localhost:${config.port}`);
  }

  getApp(): Hono {
    return this.app;
  }
}

// ============================================================================
// Exports
// ============================================================================

export { getCacheStore, resetCacheStore, CacheStore } from './store.js';
export type * from './types.js';

// ============================================================================
// Main
// ============================================================================

if (import.meta.main) {
  const server = new CacheServer();
  server.start();
}

