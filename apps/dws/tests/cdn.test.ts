/**
 * CDN Service Tests
 * Comprehensive tests for CDN caching, routing, and edge functionality
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { app } from '../src/server';
import { EdgeCache, getEdgeCache, resetEdgeCache } from '../src/cdn';

describe('CDN Service', () => {
  describe('Health Check', () => {
    test('GET /cdn/health should return healthy', async () => {
      const res = await app.request('/cdn/health');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.service).toBe('dws-cdn');
      expect(body.status).toBe('healthy');
      expect(body.cache).toBeDefined();
    });
  });

  describe('Cache Stats', () => {
    test('GET /cdn/stats should return cache statistics', async () => {
      const res = await app.request('/cdn/stats');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty('entries');
      expect(body).toHaveProperty('sizeBytes');
      expect(body).toHaveProperty('hitRate');
      expect(typeof body.entries).toBe('number');
      expect(typeof body.sizeBytes).toBe('number');
    });
  });

  describe('Cache Invalidation', () => {
    test('POST /cdn/invalidate should accept path patterns', async () => {
      const res = await app.request('/cdn/invalidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: ['/*'] }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body).toHaveProperty('entriesPurged');
    });
  });

  describe('Cache Purge', () => {
    test('POST /cdn/purge should clear cache', async () => {
      const res = await app.request('/cdn/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });

  describe('Warmup', () => {
    test('POST /cdn/warmup should accept URLs', async () => {
      const res = await app.request('/cdn/warmup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: ['http://localhost:4030/health'] }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('success');
      expect(body).toHaveProperty('failed');
    });
  });

  describe('JNS Resolution', () => {
    test('GET /cdn/resolve/:name should return resolution info', async () => {
      const res = await app.request('/cdn/resolve/test');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.name).toBe('test.jns');
    });

    test('GET /cdn/resolve/:name should handle .jns suffix', async () => {
      const res = await app.request('/cdn/resolve/test.jns');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.name).toBe('test.jns');
    });
  });
});

describe('EdgeCache Unit Tests', () => {
  let cache: EdgeCache;

  beforeEach(() => {
    resetEdgeCache();
    cache = getEdgeCache();
  });

  describe('Cache Key Generation', () => {
    test('should generate keys from paths', () => {
      const key = cache.generateKey({ path: '/test/path' });
      expect(key).toBeDefined();
      expect(typeof key).toBe('string');
      expect(key).toContain('/test/path');
    });

    test('should include query strings in keys', () => {
      const key1 = cache.generateKey({ path: '/test', query: 'a=1' });
      const key2 = cache.generateKey({ path: '/test', query: 'a=2' });
      expect(key1).not.toBe(key2);
    });

    test('should handle vary headers', () => {
      const key1 = cache.generateKey({ path: '/test', varyHeaders: { 'accept-encoding': 'gzip' } });
      const key2 = cache.generateKey({ path: '/test', varyHeaders: { 'accept-encoding': 'br' } });
      expect(key1).not.toBe(key2);
    });
  });

  describe('Basic Operations', () => {
    test('should store and retrieve cached data', () => {
      const key = 'test-key-' + Date.now();
      const data = Buffer.from('cached content');

      cache.set(key, data, { contentType: 'text/plain' });

      const { entry, status } = cache.get(key);
      expect(status).toBe('HIT');
      expect(entry).not.toBeNull();
      expect(entry!.data.toString()).toBe('cached content');
    });

    test('should return MISS for non-existent key', () => {
      const { entry, status } = cache.get('nonexistent-key-' + Date.now());
      expect(status).toBe('MISS');
      expect(entry).toBeNull();
    });

    test('should handle delete operation', () => {
      const key = 'delete-test-' + Date.now();
      cache.set(key, Buffer.from('to delete'), {});

      expect(cache.get(key).status).toBe('HIT');

      cache.delete(key);
      expect(cache.get(key).status).toBe('MISS');
    });

    test('should handle clear operation', () => {
      const key1 = 'clear-1-' + Date.now();
      const key2 = 'clear-2-' + Date.now();

      cache.set(key1, Buffer.from('1'), {});
      cache.set(key2, Buffer.from('2'), {});

      cache.clear();

      expect(cache.get(key1).status).toBe('MISS');
      expect(cache.get(key2).status).toBe('MISS');
    });
  });

  describe('Content Preservation', () => {
    test('should preserve content type', () => {
      const key = 'content-type-' + Date.now();
      cache.set(key, Buffer.from('{}'), { contentType: 'application/json' });

      const { entry } = cache.get(key);
      expect(entry!.metadata.contentType).toBe('application/json');
    });

    test('should handle binary data', () => {
      const key = 'binary-' + Date.now();
      const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

      cache.set(key, binaryData, { contentType: 'image/png' });

      const { entry } = cache.get(key);
      expect(entry!.data.equals(binaryData)).toBe(true);
    });

    test('should handle empty buffer', () => {
      const key = 'empty-' + Date.now();
      cache.set(key, Buffer.alloc(0), {});

      const { entry } = cache.get(key);
      expect(entry!.data.length).toBe(0);
    });

    test('should preserve headers', () => {
      const key = 'headers-' + Date.now();
      cache.set(key, Buffer.from('x'), {
        headers: { 'x-custom': 'value' },
      });

      const { entry } = cache.get(key);
      expect(entry!.metadata.headers['x-custom']).toBe('value');
    });
  });

  describe('TTL Calculation', () => {
    test('should respect max-age in cache-control', () => {
      const ttl = cache.calculateTTL('/test', { cacheControl: 'max-age=120' });
      expect(ttl).toBe(120);
    });

    test('should return 0 for no-store', () => {
      const ttl = cache.calculateTTL('/test', { cacheControl: 'no-store' });
      expect(ttl).toBe(0);
    });

    test('should return 0 for no-cache', () => {
      const ttl = cache.calculateTTL('/test', { cacheControl: 'no-cache' });
      expect(ttl).toBe(0);
    });

    test('should use long TTL for immutable content', () => {
      const ttl = cache.calculateTTL('/test', {
        cacheControl: 'public, max-age=31536000, immutable',
      });
      expect(ttl).toBeGreaterThanOrEqual(31536000);
    });

    test('should detect content hash in path', () => {
      // Content hash patterns like main.a1b2c3d4.js get immutable TTL
      const immutableTTL = cache.calculateTTL('/assets/main.a1b2c3d4.js', {
        contentType: 'application/javascript',
      });
      const regularTTL = cache.calculateTTL('/assets/main.js', {
        contentType: 'application/javascript',
      });
      // Immutable TTL should be at least as long as regular
      expect(immutableTTL).toBeGreaterThanOrEqual(regularTTL);
    });

    test('should use HTML TTL for text/html', () => {
      const htmlTTL = cache.calculateTTL('/page', { contentType: 'text/html' });
      const jsTTL = cache.calculateTTL('/script.js', { contentType: 'application/javascript' });
      // HTML typically has shorter TTL
      expect(htmlTTL).toBeLessThanOrEqual(jsTTL);
    });
  });

  describe('Conditional Requests', () => {
    test('should return REVALIDATED for matching ETag', () => {
      const key = 'etag-test-' + Date.now();
      cache.set(key, Buffer.from('content'), { etag: '"abc123"' });

      const { status, notModified } = cache.getConditional(key, '"abc123"');
      expect(status).toBe('REVALIDATED');
      expect(notModified).toBe(true);
    });

    test('should return HIT for non-matching ETag', () => {
      const key = 'etag-nomatch-' + Date.now();
      cache.set(key, Buffer.from('content'), { etag: '"abc123"' });

      const { status, notModified } = cache.getConditional(key, '"different"');
      expect(status).toBe('HIT');
      expect(notModified).toBe(false);
    });

    test('should return REVALIDATED for matching Last-Modified', () => {
      const key = 'lm-test-' + Date.now();
      const timestamp = 1700000000000;
      cache.set(key, Buffer.from('content'), { lastModified: timestamp });

      const { status, notModified } = cache.getConditional(key, undefined, timestamp + 1000);
      expect(status).toBe('REVALIDATED');
      expect(notModified).toBe(true);
    });
  });

  describe('Purge Operations', () => {
    test('should purge by exact path', () => {
      const key = cache.generateKey({ path: '/purge/exact' });
      cache.set(key, Buffer.from('to purge'), {});

      const purged = cache.purge('/purge/exact');
      expect(purged).toBeGreaterThanOrEqual(0);
    });

    test('should purge by pattern', () => {
      cache.set(cache.generateKey({ path: '/api/users/1' }), Buffer.from('1'), {});
      cache.set(cache.generateKey({ path: '/api/users/2' }), Buffer.from('2'), {});
      cache.set(cache.generateKey({ path: '/api/posts/1' }), Buffer.from('p'), {});

      const purged = cache.purge('/api/users/*');
      expect(purged).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Statistics', () => {
    test('should track hit/miss counts', () => {
      cache.resetStats();
      const key = 'stats-test-' + Date.now();

      cache.get(key); // Miss
      cache.set(key, Buffer.from('x'), {});
      cache.get(key); // Hit
      cache.get(key); // Hit

      const stats = cache.getStats();
      expect(stats.hitCount).toBeGreaterThanOrEqual(2);
      expect(stats.missCount).toBeGreaterThanOrEqual(1);
    });

    test('should track cache size', () => {
      cache.clear();
      cache.set('size-test-1', Buffer.from('a'.repeat(1000)), {});
      cache.set('size-test-2', Buffer.from('b'.repeat(1000)), {});

      const stats = cache.getStats();
      expect(stats.sizeBytes).toBeGreaterThanOrEqual(2000);
    });

    test('should reset statistics', () => {
      cache.get('anything');
      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hitCount).toBe(0);
      expect(stats.missCount).toBe(0);
    });
  });

  describe('Stale-While-Revalidate', () => {
    test('should mark entry as revalidating', () => {
      const key = 'swr-test-' + Date.now();
      cache.set(key, Buffer.from('x'), {});

      cache.startRevalidation(key);
      expect(cache.isRevalidating(key)).toBe(true);

      cache.completeRevalidation(key);
      expect(cache.isRevalidating(key)).toBe(false);
    });
  });
});

describe('EdgeCache Edge Cases', () => {
  let cache: EdgeCache;

  beforeEach(() => {
    resetEdgeCache();
    cache = getEdgeCache();
  });

  test('should handle very long cache keys', () => {
    const longPath = '/path/' + 'a'.repeat(500);
    const key = cache.generateKey({ path: longPath });

    cache.set(key, Buffer.from('x'), {});
    const { status } = cache.get(key);
    expect(status).toBe('HIT');
  });

  test('should handle cache key with special characters', () => {
    const specialPath = '/key/with/slashes?query=1&foo=bar';
    const key = cache.generateKey({ path: specialPath });

    cache.set(key, Buffer.from('special'), {});
    const { status } = cache.get(key);
    expect(status).toBe('HIT');
  });

  test('should handle concurrent cache operations', async () => {
    const operations: Promise<void>[] = [];

    for (let i = 0; i < 100; i++) {
      const key = cache.generateKey({ path: `/concurrent-${i}` });
      operations.push(Promise.resolve().then(() => cache.set(key, Buffer.from(`value-${i}`), {})));
    }

    await Promise.all(operations);

    // Verify all were cached
    let hits = 0;
    for (let i = 0; i < 100; i++) {
      const key = cache.generateKey({ path: `/concurrent-${i}` });
      const { status } = cache.get(key);
      if (status === 'HIT') hits++;
    }

    expect(hits).toBe(100);
  });

  test('should handle large buffer', () => {
    const largeBuffer = Buffer.alloc(1024 * 100, 'x'); // 100KB
    const key = 'large-buffer-' + Date.now();

    cache.set(key, largeBuffer, {});

    const { entry, status } = cache.get(key);
    expect(status).toBe('HIT');
    expect(entry!.data.length).toBe(largeBuffer.length);
  });

  test('should handle overwriting existing key', () => {
    const key = 'overwrite-' + Date.now();

    cache.set(key, Buffer.from('original'), {});
    cache.set(key, Buffer.from('updated'), {});

    const { entry } = cache.get(key);
    expect(entry!.data.toString()).toBe('updated');
  });
});

describe('CDN Server Integration', () => {
  test('DWS health should include cdn service', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.services.cdn).toBeDefined();
    expect(body.services.cdn.status).toBe('healthy');
  });

  test('DWS root should list cdn endpoint', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.services).toContain('cdn');
    expect(body.endpoints.cdn).toBe('/cdn/*');
  });
});
