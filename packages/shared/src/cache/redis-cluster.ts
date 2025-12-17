/**
 * Redis Cluster Client - Production Implementation
 *
 * Uses ioredis for actual Redis Cluster connectivity with:
 * - Automatic sharding via cluster mode
 * - Read replica routing
 * - Connection pooling
 * - Pipeline support for batch operations
 * - AES-256-GCM encryption for sensitive data
 * - Circuit breaker for fault tolerance
 * - Prometheus metrics export
 */

import { Cluster, Redis } from 'ioredis';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { Registry, Counter, Histogram, Gauge } from 'prom-client';
import { z } from 'zod';

// ============================================================================
// Configuration Schema
// ============================================================================

const RedisNodeSchema = z.object({
  host: z.string(),
  port: z.number().min(1).max(65535),
});

const RedisClusterConfigSchema = z.object({
  nodes: z.array(RedisNodeSchema).min(1),
  password: z.string().optional(),
  tls: z.boolean().default(false),
  connectTimeout: z.number().default(5000),
  commandTimeout: z.number().default(5000),
  maxRetriesPerRequest: z.number().default(3),
  enableReadFromReplicas: z.boolean().default(true),
  keyPrefix: z.string().default(''),
  encryptionKey: z.string().length(64).optional(), // 32 bytes hex
  enableOfflineQueue: z.boolean().default(true),
  lazyConnect: z.boolean().default(false),
});

export type RedisClusterConfig = z.infer<typeof RedisClusterConfigSchema>;

// ============================================================================
// Prometheus Metrics
// ============================================================================

const metricsRegistry = new Registry();

const redisOperationsTotal = new Counter({
  name: 'redis_operations_total',
  help: 'Total Redis operations',
  labelNames: ['operation', 'status'],
  registers: [metricsRegistry],
});

const redisOperationDuration = new Histogram({
  name: 'redis_operation_duration_seconds',
  help: 'Redis operation duration',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [metricsRegistry],
});

const redisConnectionsGauge = new Gauge({
  name: 'redis_connections_active',
  help: 'Active Redis connections',
  labelNames: ['node'],
  registers: [metricsRegistry],
});

const redisCacheHits = new Counter({
  name: 'redis_cache_hits_total',
  help: 'Redis cache hits',
  registers: [metricsRegistry],
});

const redisCacheMisses = new Counter({
  name: 'redis_cache_misses_total',
  help: 'Redis cache misses',
  registers: [metricsRegistry],
});

// ============================================================================
// Circuit Breaker
// ============================================================================

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

class CircuitBreaker {
  private state: CircuitBreakerState = {
    failures: 0,
    lastFailure: 0,
    state: 'closed',
  };
  private readonly threshold: number;
  private readonly resetTimeout: number;

  constructor(threshold = 5, resetTimeout = 30000) {
    this.threshold = threshold;
    this.resetTimeout = resetTimeout;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state.state === 'open') {
      if (Date.now() - this.state.lastFailure > this.resetTimeout) {
        this.state.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.state.failures = 0;
    this.state.state = 'closed';
  }

  private onFailure(): void {
    this.state.failures++;
    this.state.lastFailure = Date.now();
    if (this.state.failures >= this.threshold) {
      this.state.state = 'open';
    }
  }

  getState(): CircuitBreakerState['state'] {
    return this.state.state;
  }
}

// ============================================================================
// Redis Cluster Client
// ============================================================================

export class RedisClusterClient {
  private cluster: Cluster;
  private config: RedisClusterConfig;
  private circuitBreaker: CircuitBreaker;
  private encryptionKey: Buffer | null = null;

  constructor(config: Partial<RedisClusterConfig>) {
    // Validate configuration
    this.config = RedisClusterConfigSchema.parse({
      nodes: config.nodes ?? [{ host: 'localhost', port: 6379 }],
      ...config,
    });

    // Setup encryption key if provided
    if (this.config.encryptionKey) {
      this.encryptionKey = Buffer.from(this.config.encryptionKey, 'hex');
    }

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker(5, 30000);

    // Create Redis Cluster connection
    this.cluster = new Cluster(
      this.config.nodes.map((n) => ({ host: n.host, port: n.port })),
      {
        redisOptions: {
          password: this.config.password,
          tls: this.config.tls ? {} : undefined,
          connectTimeout: this.config.connectTimeout,
          commandTimeout: this.config.commandTimeout,
          maxRetriesPerRequest: this.config.maxRetriesPerRequest,
          keyPrefix: this.config.keyPrefix,
          enableOfflineQueue: this.config.enableOfflineQueue,
          lazyConnect: this.config.lazyConnect,
        },
        scaleReads: this.config.enableReadFromReplicas ? 'slave' : 'master',
        enableReadyCheck: true,
        maxRedirections: 16,
        retryDelayOnFailover: 100,
        retryDelayOnClusterDown: 100,
        retryDelayOnTryAgain: 100,
      }
    );

    // Setup event handlers
    this.cluster.on('connect', () => {
      console.log('[Redis] Connected to cluster');
    });

    this.cluster.on('ready', () => {
      console.log('[Redis] Cluster ready');
    });

    this.cluster.on('error', (err) => {
      console.error('[Redis] Cluster error:', err.message);
    });

    this.cluster.on('close', () => {
      console.log('[Redis] Cluster connection closed');
    });

    this.cluster.on('+node', (node) => {
      redisConnectionsGauge.inc({ node: `${node.options.host}:${node.options.port}` });
    });

    this.cluster.on('-node', (node) => {
      redisConnectionsGauge.dec({ node: `${node.options.host}:${node.options.port}` });
    });
  }

  // ============================================================================
  // Core Operations
  // ============================================================================

  async get(key: string): Promise<string | null> {
    const timer = redisOperationDuration.startTimer({ operation: 'get' });

    try {
      const result = await this.circuitBreaker.execute(() => this.cluster.get(key));
      redisOperationsTotal.inc({ operation: 'get', status: 'success' });

      if (result === null) {
        redisCacheMisses.inc();
        return null;
      }

      redisCacheHits.inc();
      return this.decrypt(result);
    } catch (error) {
      redisOperationsTotal.inc({ operation: 'get', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const timer = redisOperationDuration.startTimer({ operation: 'set' });
    const encryptedValue = this.encrypt(value);

    try {
      await this.circuitBreaker.execute(async () => {
        if (ttlSeconds) {
          await this.cluster.setex(key, ttlSeconds, encryptedValue);
        } else {
          await this.cluster.set(key, encryptedValue);
        }
      });
      redisOperationsTotal.inc({ operation: 'set', status: 'success' });
    } catch (error) {
      redisOperationsTotal.inc({ operation: 'set', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  async delete(key: string): Promise<boolean> {
    const timer = redisOperationDuration.startTimer({ operation: 'delete' });

    try {
      const result = await this.circuitBreaker.execute(() => this.cluster.del(key));
      redisOperationsTotal.inc({ operation: 'delete', status: 'success' });
      return result > 0;
    } catch (error) {
      redisOperationsTotal.inc({ operation: 'delete', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  async exists(key: string): Promise<boolean> {
    const timer = redisOperationDuration.startTimer({ operation: 'exists' });

    try {
      const result = await this.circuitBreaker.execute(() => this.cluster.exists(key));
      redisOperationsTotal.inc({ operation: 'exists', status: 'success' });
      return result > 0;
    } catch (error) {
      redisOperationsTotal.inc({ operation: 'exists', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  async ttl(key: string): Promise<number> {
    const timer = redisOperationDuration.startTimer({ operation: 'ttl' });

    try {
      const result = await this.circuitBreaker.execute(() => this.cluster.ttl(key));
      redisOperationsTotal.inc({ operation: 'ttl', status: 'success' });
      return result;
    } catch (error) {
      redisOperationsTotal.inc({ operation: 'ttl', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const timer = redisOperationDuration.startTimer({ operation: 'expire' });

    try {
      const result = await this.circuitBreaker.execute(() =>
        this.cluster.expire(key, ttlSeconds)
      );
      redisOperationsTotal.inc({ operation: 'expire', status: 'success' });
      return result === 1;
    } catch (error) {
      redisOperationsTotal.inc({ operation: 'expire', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  // ============================================================================
  // Batch Operations with Pipelining
  // ============================================================================

  async mget(keys: string[]): Promise<Map<string, string | null>> {
    if (keys.length === 0) return new Map();

    const timer = redisOperationDuration.startTimer({ operation: 'mget' });

    try {
      // Group keys by slot for optimal routing
      const slotGroups = this.groupKeysBySlot(keys);
      const results = new Map<string, string | null>();

      // Execute pipelined MGET for each slot group
      await Promise.all(
        Array.from(slotGroups.entries()).map(async ([_slot, slotKeys]) => {
          const pipeline = this.cluster.pipeline();

          for (const key of slotKeys) {
            pipeline.get(key);
          }

          const pipelineResults = await pipeline.exec();

          if (pipelineResults) {
            for (let i = 0; i < slotKeys.length; i++) {
              const [err, value] = pipelineResults[i];
              if (err) {
                results.set(slotKeys[i], null);
              } else {
                const decrypted = value ? this.decrypt(value as string) : null;
                results.set(slotKeys[i], decrypted);
                if (decrypted) {
                  redisCacheHits.inc();
                } else {
                  redisCacheMisses.inc();
                }
              }
            }
          }
        })
      );

      redisOperationsTotal.inc({ operation: 'mget', status: 'success' });
      return results;
    } catch (error) {
      redisOperationsTotal.inc({ operation: 'mget', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  async mset(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    if (entries.length === 0) return;

    const timer = redisOperationDuration.startTimer({ operation: 'mset' });

    try {
      // Group by slot
      const slotGroups = this.groupEntriesBySlot(entries);

      await Promise.all(
        Array.from(slotGroups.entries()).map(async ([_slot, slotEntries]) => {
          const pipeline = this.cluster.pipeline();

          for (const entry of slotEntries) {
            const encrypted = this.encrypt(entry.value);
            if (entry.ttl) {
              pipeline.setex(entry.key, entry.ttl, encrypted);
            } else {
              pipeline.set(entry.key, encrypted);
            }
          }

          await pipeline.exec();
        })
      );

      redisOperationsTotal.inc({ operation: 'mset', status: 'success' });
    } catch (error) {
      redisOperationsTotal.inc({ operation: 'mset', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  async mdelete(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;

    const timer = redisOperationDuration.startTimer({ operation: 'mdelete' });

    try {
      const slotGroups = this.groupKeysBySlot(keys);
      let deleted = 0;

      await Promise.all(
        Array.from(slotGroups.entries()).map(async ([_slot, slotKeys]) => {
          const pipeline = this.cluster.pipeline();

          for (const key of slotKeys) {
            pipeline.del(key);
          }

          const results = await pipeline.exec();
          if (results) {
            for (const [err, count] of results) {
              if (!err && typeof count === 'number') {
                deleted += count;
              }
            }
          }
        })
      );

      redisOperationsTotal.inc({ operation: 'mdelete', status: 'success' });
      return deleted;
    } catch (error) {
      redisOperationsTotal.inc({ operation: 'mdelete', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  // ============================================================================
  // Hash Operations
  // ============================================================================

  async hget(key: string, field: string): Promise<string | null> {
    const timer = redisOperationDuration.startTimer({ operation: 'hget' });

    try {
      const result = await this.circuitBreaker.execute(() => this.cluster.hget(key, field));
      redisOperationsTotal.inc({ operation: 'hget', status: 'success' });
      return result ? this.decrypt(result) : null;
    } catch (error) {
      redisOperationsTotal.inc({ operation: 'hget', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    const timer = redisOperationDuration.startTimer({ operation: 'hset' });

    try {
      const encrypted = this.encrypt(value);
      await this.circuitBreaker.execute(() => this.cluster.hset(key, field, encrypted));
      redisOperationsTotal.inc({ operation: 'hset', status: 'success' });
    } catch (error) {
      redisOperationsTotal.inc({ operation: 'hset', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const timer = redisOperationDuration.startTimer({ operation: 'hgetall' });

    try {
      const result = await this.circuitBreaker.execute(() => this.cluster.hgetall(key));
      redisOperationsTotal.inc({ operation: 'hgetall', status: 'success' });

      const decrypted: Record<string, string> = {};
      for (const [field, value] of Object.entries(result)) {
        decrypted[field] = this.decrypt(value);
      }
      return decrypted;
    } catch (error) {
      redisOperationsTotal.inc({ operation: 'hgetall', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  // ============================================================================
  // List Operations
  // ============================================================================

  async lpush(key: string, ...values: string[]): Promise<number> {
    const timer = redisOperationDuration.startTimer({ operation: 'lpush' });

    try {
      const encrypted = values.map((v) => this.encrypt(v));
      const result = await this.circuitBreaker.execute(() =>
        this.cluster.lpush(key, ...encrypted)
      );
      redisOperationsTotal.inc({ operation: 'lpush', status: 'success' });
      return result;
    } catch (error) {
      redisOperationsTotal.inc({ operation: 'lpush', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  async rpop(key: string): Promise<string | null> {
    const timer = redisOperationDuration.startTimer({ operation: 'rpop' });

    try {
      const result = await this.circuitBreaker.execute(() => this.cluster.rpop(key));
      redisOperationsTotal.inc({ operation: 'rpop', status: 'success' });
      return result ? this.decrypt(result) : null;
    } catch (error) {
      redisOperationsTotal.inc({ operation: 'rpop', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const timer = redisOperationDuration.startTimer({ operation: 'lrange' });

    try {
      const result = await this.circuitBreaker.execute(() =>
        this.cluster.lrange(key, start, stop)
      );
      redisOperationsTotal.inc({ operation: 'lrange', status: 'success' });
      return result.map((v) => this.decrypt(v));
    } catch (error) {
      redisOperationsTotal.inc({ operation: 'lrange', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  // ============================================================================
  // Pub/Sub
  // ============================================================================

  async publish(channel: string, message: string): Promise<number> {
    const timer = redisOperationDuration.startTimer({ operation: 'publish' });

    try {
      const result = await this.circuitBreaker.execute(() =>
        this.cluster.publish(channel, message)
      );
      redisOperationsTotal.inc({ operation: 'publish', status: 'success' });
      return result;
    } catch (error) {
      redisOperationsTotal.inc({ operation: 'publish', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  // ============================================================================
  // Health & Metrics
  // ============================================================================

  async ping(): Promise<boolean> {
    try {
      const result = await this.cluster.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async getClusterInfo(): Promise<{
    nodes: number;
    connected: boolean;
    circuitBreakerState: string;
  }> {
    const nodes = this.cluster.nodes('all');
    const connected = await this.ping();

    return {
      nodes: nodes.length,
      connected,
      circuitBreakerState: this.circuitBreaker.getState(),
    };
  }

  async getMetrics(): Promise<string> {
    return metricsRegistry.metrics();
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async connect(): Promise<void> {
    if (this.config.lazyConnect) {
      await this.cluster.connect();
    }
  }

  async disconnect(): Promise<void> {
    await this.cluster.quit();
    console.log('[Redis] Disconnected');
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private encrypt(value: string): string {
    if (!this.encryptionKey) return value;

    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return `enc:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decrypt(value: string): string {
    if (!this.encryptionKey || !value.startsWith('enc:')) return value;

    const parts = value.split(':');
    if (parts.length !== 4) return value;

    const iv = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const encrypted = parts[3];

    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  private calculateSlot(key: string): number {
    // Check for hash tag {xxx}
    const start = key.indexOf('{');
    const end = key.indexOf('}', start + 1);

    const hashKey =
      start !== -1 && end !== -1 && end > start + 1 ? key.slice(start + 1, end) : key;

    return this.crc16(Buffer.from(hashKey)) % 16384;
  }

  private crc16(data: Buffer): number {
    let crc = 0;
    for (const byte of data) {
      crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ byte) & 0xff]) & 0xffff;
    }
    return crc;
  }

  private groupKeysBySlot(keys: string[]): Map<number, string[]> {
    const groups = new Map<number, string[]>();
    for (const key of keys) {
      const slot = this.calculateSlot(key);
      const existing = groups.get(slot) ?? [];
      existing.push(key);
      groups.set(slot, existing);
    }
    return groups;
  }

  private groupEntriesBySlot(
    entries: Array<{ key: string; value: string; ttl?: number }>
  ): Map<number, Array<{ key: string; value: string; ttl?: number }>> {
    const groups = new Map<number, Array<{ key: string; value: string; ttl?: number }>>();
    for (const entry of entries) {
      const slot = this.calculateSlot(entry.key);
      const existing = groups.get(slot) ?? [];
      existing.push(entry);
      groups.set(slot, existing);
    }
    return groups;
  }
}

// CRC16 lookup table for Redis cluster slot calculation
const CRC16_TABLE = new Uint16Array(256);
(() => {
  for (let i = 0; i < 256; i++) {
    let crc = i << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
    CRC16_TABLE[i] = crc & 0xffff;
  }
})();

// ============================================================================
// Factory with Singleton
// ============================================================================

let instance: RedisClusterClient | null = null;

export function getRedisClient(config?: Partial<RedisClusterConfig>): RedisClusterClient {
  if (!instance) {
    instance = new RedisClusterClient({
      nodes: parseRedisNodes(process.env.REDIS_NODES ?? 'localhost:6379'),
      password: process.env.REDIS_PASSWORD,
      tls: process.env.REDIS_TLS === 'true',
      enableReadFromReplicas: process.env.REDIS_ENABLE_REPLICAS !== 'false',
      keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'jeju:',
      encryptionKey: process.env.REDIS_ENCRYPTION_KEY,
      ...config,
    });
  }
  return instance;
}

function parseRedisNodes(nodesStr: string): Array<{ host: string; port: number }> {
  return nodesStr.split(',').map((node) => {
    const [host, portStr] = node.trim().split(':');
    return { host, port: parseInt(portStr) || 6379 };
  });
}

export async function closeRedisClient(): Promise<void> {
  if (instance) {
    await instance.disconnect();
    instance = null;
  }
}
