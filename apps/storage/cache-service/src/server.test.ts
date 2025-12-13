/**
 * Cache Service HTTP Integration Tests
 * 
 * These tests actually start the HTTP server and make real requests.
 * No mocking - this tests the full request/response cycle.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { CacheServer } from './index.js';

describe('Cache Service HTTP API', () => {
  let server: CacheServer;
  const baseUrl = 'http://localhost:14015'; // Use a unique port for tests
  
  beforeAll(async () => {
    process.env.CACHE_SERVICE_PORT = '14015';
    server = new CacheServer();
    // Start server
    Bun.serve({
      port: 14015,
      fetch: server.getApp().fetch,
    });
    // Give server time to start
    await new Promise(r => setTimeout(r, 100));
  });
  
  afterAll(() => {
    // Server will be cleaned up when process ends
  });

  describe('Health', () => {
    it('should return healthy status', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.status).toBe('healthy');
      expect(data.service).toBe('cache-service');
      expect(data.timestamp).toBeDefined();
    });

    it('should return Prometheus metrics', async () => {
      const res = await fetch(`${baseUrl}/metrics`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
      
      const body = await res.text();
      expect(body).toContain('cache_keys_total');
      expect(body).toContain('cache_hits_total');
      expect(body).toContain('cache_misses_total');
      expect(body).toContain('cache_hit_rate');
      expect(body).toContain('cache_memory_used_mb');
    });
  });

  describe('Basic Cache Operations', () => {
    it('should set and get a value', async () => {
      // Set
      const setRes = await fetch(`${baseUrl}/cache/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'test-key', value: 'test-value', namespace: 'test-ns' }),
      });
      expect(setRes.status).toBe(200);
      const setData = await setRes.json();
      expect(setData.success).toBe(true);

      // Get
      const getRes = await fetch(`${baseUrl}/cache/get?namespace=test-ns&key=test-key`);
      expect(getRes.status).toBe(200);
      const getData = await getRes.json();
      expect(getData.value).toBe('test-value');
      expect(getData.found).toBe(true);
    });

    it('should return null for non-existent key', async () => {
      const res = await fetch(`${baseUrl}/cache/get?namespace=test-ns&key=nonexistent`);
      const data = await res.json();
      expect(data.value).toBeNull();
      expect(data.found).toBe(false);
    });

    it('should delete a key', async () => {
      // Set first
      await fetch(`${baseUrl}/cache/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'to-delete', value: 'temp', namespace: 'test-ns' }),
      });

      // Delete
      const delRes = await fetch(`${baseUrl}/cache/delete?namespace=test-ns&key=to-delete`, {
        method: 'DELETE',
      });
      expect(delRes.status).toBe(200);
      const delData = await delRes.json();
      expect(delData.success).toBe(true);

      // Verify deleted
      const getRes = await fetch(`${baseUrl}/cache/get?namespace=test-ns&key=to-delete`);
      const getData = await getRes.json();
      expect(getData.found).toBe(false);
    });

    it('should require key parameter for get', async () => {
      const res = await fetch(`${baseUrl}/cache/get?namespace=test-ns`);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Key required');
    });
  });

  describe('Batch Operations', () => {
    it('should mset multiple keys', async () => {
      const res = await fetch(`${baseUrl}/cache/mset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: 'batch-ns',
          entries: [
            { key: 'k1', value: 'v1' },
            { key: 'k2', value: 'v2' },
            { key: 'k3', value: 'v3' },
          ],
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.count).toBe(3);

      // Verify with mget
      const mgetRes = await fetch(`${baseUrl}/cache/mget`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace: 'batch-ns', keys: ['k1', 'k2', 'k3', 'k4'] }),
      });
      const mgetData = await mgetRes.json();
      expect(mgetData.entries.k1).toBe('v1');
      expect(mgetData.entries.k2).toBe('v2');
      expect(mgetData.entries.k3).toBe('v3');
      expect(mgetData.entries.k4).toBeNull();
    });
  });

  describe('Keys and Patterns', () => {
    it('should list keys in namespace', async () => {
      // Setup
      await fetch(`${baseUrl}/cache/mset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: 'keys-ns',
          entries: [
            { key: 'user:1', value: 'a' },
            { key: 'user:2', value: 'b' },
            { key: 'session:1', value: 'c' },
          ],
        }),
      });

      // List all
      const allRes = await fetch(`${baseUrl}/cache/keys?namespace=keys-ns`);
      const allData = await allRes.json();
      expect(allData.count).toBe(3);

      // Filter by pattern
      const userRes = await fetch(`${baseUrl}/cache/keys?namespace=keys-ns&pattern=user:*`);
      const userData = await userRes.json();
      expect(userData.count).toBe(2);
      expect(userData.keys).toContain('user:1');
      expect(userData.keys).toContain('user:2');
    });
  });

  describe('TTL Operations', () => {
    it('should get TTL for key', async () => {
      await fetch(`${baseUrl}/cache/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'ttl-key', value: 'v', ttl: 60, namespace: 'ttl-ns' }),
      });

      const res = await fetch(`${baseUrl}/cache/ttl?namespace=ttl-ns&key=ttl-key`);
      const data = await res.json();
      expect(data.ttl).toBeGreaterThan(55);
      expect(data.ttl).toBeLessThanOrEqual(60);
    });

    it('should update TTL with expire', async () => {
      await fetch(`${baseUrl}/cache/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'expire-key', value: 'v', ttl: 60, namespace: 'ttl-ns' }),
      });

      // Extend TTL
      const expireRes = await fetch(`${baseUrl}/cache/expire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'expire-key', ttl: 120, namespace: 'ttl-ns' }),
      });
      expect((await expireRes.json()).success).toBe(true);

      const ttlRes = await fetch(`${baseUrl}/cache/ttl?namespace=ttl-ns&key=expire-key`);
      const ttlData = await ttlRes.json();
      expect(ttlData.ttl).toBeGreaterThan(115);
    });
  });

  describe('Namespace Clear', () => {
    it('should clear a namespace', async () => {
      // Setup
      await fetch(`${baseUrl}/cache/mset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: 'clear-ns',
          entries: [{ key: 'a', value: '1' }, { key: 'b', value: '2' }],
        }),
      });

      // Clear
      const clearRes = await fetch(`${baseUrl}/cache/clear?namespace=clear-ns`, { method: 'DELETE' });
      expect((await clearRes.json()).success).toBe(true);

      // Verify empty
      const keysRes = await fetch(`${baseUrl}/cache/keys?namespace=clear-ns`);
      expect((await keysRes.json()).count).toBe(0);
    });
  });

  describe('Stats', () => {
    it('should return overall stats', async () => {
      const res = await fetch(`${baseUrl}/stats`);
      const data = await res.json();
      expect(data.stats.totalKeys).toBeGreaterThanOrEqual(0);
      expect(data.stats.namespaces).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Rental Plans', () => {
    it('should list available plans', async () => {
      const res = await fetch(`${baseUrl}/plans`);
      const data = await res.json();
      expect(data.plans.length).toBeGreaterThan(0);
      expect(data.plans[0]).toHaveProperty('id');
      expect(data.plans[0]).toHaveProperty('name');
      expect(data.plans[0]).toHaveProperty('maxMemoryMb');
    });

    it('should create and get instance', async () => {
      // Create
      const createRes = await fetch(`${baseUrl}/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: 'free', namespace: 'rental-test' }),
      });
      expect(createRes.status).toBe(200);
      const createData = await createRes.json();
      const instanceId = createData.instance.id;
      expect(instanceId).toBeDefined();

      // Get
      const getRes = await fetch(`${baseUrl}/instances/${instanceId}`);
      const getData = await getRes.json();
      expect(getData.instance.id).toBe(instanceId);
      expect(getData.instance.namespace).toBe('rental-test');

      // Delete
      const delRes = await fetch(`${baseUrl}/instances/${instanceId}`, { method: 'DELETE' });
      expect((await delRes.json()).success).toBe(true);
    });

    it('should reject invalid plan', async () => {
      const res = await fetch(`${baseUrl}/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: 'nonexistent' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Agent Card', () => {
    it('should return agent.json', async () => {
      const res = await fetch(`${baseUrl}/.well-known/agent.json`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.name).toBe('jeju-cache');
      expect(data.skills.length).toBeGreaterThan(0);
    });
  });
});

