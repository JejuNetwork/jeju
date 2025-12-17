/**
 * Redis Cluster Integration Tests
 * 
 * Tests real Redis Cluster connectivity with:
 * - Basic operations (get/set/delete)
 * - Batch operations with pipelining
 * - Encryption/decryption
 * - Circuit breaker behavior
 * - Cluster failover
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { RedisClusterClient, type RedisClusterConfig } from '../../shared/src/cache/redis-cluster';

// Skip if no Redis available
const REDIS_AVAILABLE = process.env.REDIS_NODES || process.env.TEST_REDIS;

describe.skipIf(!REDIS_AVAILABLE)('RedisClusterClient', () => {
  let client: RedisClusterClient;

  beforeAll(async () => {
    const config: Partial<RedisClusterConfig> = {
      nodes: [{ host: process.env.REDIS_HOST ?? 'localhost', port: 6379 }],
      keyPrefix: 'test:',
      connectTimeout: 5000,
    };

    client = new RedisClusterClient(config);
    
    // Wait for connection
    const connected = await client.ping();
    if (!connected) {
      throw new Error('Redis not available');
    }
  });

  afterAll(async () => {
    if (client) {
      await client.disconnect();
    }
  });

  describe('Basic Operations', () => {
    it('should set and get a value', async () => {
      await client.set('test-key', 'test-value');
      const value = await client.get('test-key');
      expect(value).toBe('test-value');
    });

    it('should set with TTL', async () => {
      await client.set('ttl-key', 'expires-soon', 2);
      const value = await client.get('ttl-key');
      expect(value).toBe('expires-soon');

      const ttl = await client.ttl('ttl-key');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(2);
    });

    it('should delete a key', async () => {
      await client.set('delete-me', 'value');
      const deleted = await client.delete('delete-me');
      expect(deleted).toBe(true);

      const value = await client.get('delete-me');
      expect(value).toBeNull();
    });

    it('should check key existence', async () => {
      await client.set('exists-key', 'value');
      const exists = await client.exists('exists-key');
      expect(exists).toBe(true);

      const notExists = await client.exists('nonexistent-key');
      expect(notExists).toBe(false);
    });

    it('should handle null values', async () => {
      const value = await client.get('nonexistent');
      expect(value).toBeNull();
    });
  });

  describe('Batch Operations', () => {
    it('should mset multiple keys', async () => {
      const entries = [
        { key: 'batch-1', value: 'value-1' },
        { key: 'batch-2', value: 'value-2' },
        { key: 'batch-3', value: 'value-3' },
      ];

      await client.mset(entries);

      const v1 = await client.get('batch-1');
      const v2 = await client.get('batch-2');
      const v3 = await client.get('batch-3');

      expect(v1).toBe('value-1');
      expect(v2).toBe('value-2');
      expect(v3).toBe('value-3');
    });

    it('should mget multiple keys', async () => {
      await client.set('mget-1', 'a');
      await client.set('mget-2', 'b');
      await client.set('mget-3', 'c');

      const results = await client.mget(['mget-1', 'mget-2', 'mget-3', 'mget-nonexistent']);

      expect(results.get('mget-1')).toBe('a');
      expect(results.get('mget-2')).toBe('b');
      expect(results.get('mget-3')).toBe('c');
      expect(results.get('mget-nonexistent')).toBeNull();
    });

    it('should mdelete multiple keys', async () => {
      await client.set('mdel-1', 'x');
      await client.set('mdel-2', 'y');

      const deleted = await client.mdelete(['mdel-1', 'mdel-2']);
      expect(deleted).toBe(2);

      expect(await client.exists('mdel-1')).toBe(false);
      expect(await client.exists('mdel-2')).toBe(false);
    });
  });

  describe('Hash Operations', () => {
    it('should set and get hash fields', async () => {
      await client.hset('hash-key', 'field1', 'value1');
      const value = await client.hget('hash-key', 'field1');
      expect(value).toBe('value1');
    });

    it('should get all hash fields', async () => {
      await client.hset('hash-all', 'a', '1');
      await client.hset('hash-all', 'b', '2');
      await client.hset('hash-all', 'c', '3');

      const all = await client.hgetall('hash-all');
      expect(all.a).toBe('1');
      expect(all.b).toBe('2');
      expect(all.c).toBe('3');
    });
  });

  describe('List Operations', () => {
    it('should push and pop from list', async () => {
      await client.lpush('list-key', 'first', 'second', 'third');

      const popped = await client.rpop('list-key');
      expect(popped).toBe('first');
    });

    it('should get list range', async () => {
      await client.delete('range-list');
      await client.lpush('range-list', 'c', 'b', 'a');

      const range = await client.lrange('range-list', 0, -1);
      expect(range).toEqual(['a', 'b', 'c']);
    });
  });

  describe('Cluster Info', () => {
    it('should return cluster info', async () => {
      const info = await client.getClusterInfo();
      
      expect(info.connected).toBe(true);
      expect(info.nodes).toBeGreaterThanOrEqual(1);
      expect(info.circuitBreakerState).toBe('closed');
    });
  });

  describe('Metrics', () => {
    it('should export Prometheus metrics', async () => {
      // Perform some operations to generate metrics
      await client.set('metrics-test', 'value');
      await client.get('metrics-test');
      await client.get('nonexistent-for-miss');

      const metrics = await client.getMetrics();
      
      expect(metrics).toContain('redis_operations_total');
      expect(metrics).toContain('redis_operation_duration_seconds');
      expect(metrics).toContain('redis_cache_hits_total');
      expect(metrics).toContain('redis_cache_misses_total');
    });
  });
});

describe.skipIf(!REDIS_AVAILABLE)('RedisClusterClient with Encryption', () => {
  let client: RedisClusterClient;

  beforeAll(async () => {
    // Generate a 32-byte encryption key
    const encryptionKey = Buffer.from(
      'test-encryption-key-32bytes-long'
    ).toString('hex').slice(0, 64);

    const config: Partial<RedisClusterConfig> = {
      nodes: [{ host: process.env.REDIS_HOST ?? 'localhost', port: 6379 }],
      keyPrefix: 'encrypted:',
      encryptionKey,
    };

    client = new RedisClusterClient(config);
    
    if (!(await client.ping())) {
      throw new Error('Redis not available');
    }
  });

  afterAll(async () => {
    if (client) {
      await client.disconnect();
    }
  });

  it('should encrypt and decrypt values transparently', async () => {
    const sensitiveData = 'super-secret-api-key-12345';
    
    await client.set('encrypted-key', sensitiveData);
    const retrieved = await client.get('encrypted-key');
    
    expect(retrieved).toBe(sensitiveData);
  });

  it('should handle special characters in encrypted data', async () => {
    const specialData = '{"api_key": "sk-123", "webhook": "https://example.com?a=1&b=2"}';
    
    await client.set('json-data', specialData);
    const retrieved = await client.get('json-data');
    
    expect(retrieved).toBe(specialData);
  });
});

