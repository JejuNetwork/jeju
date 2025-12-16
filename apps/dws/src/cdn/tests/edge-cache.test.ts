/**
 * Edge Cache Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { EdgeCache, resetEdgeCache } from '../cache/edge-cache';
import { DEFAULT_TTL_CONFIG } from '@jejunetwork/types';

describe('EdgeCache', () => {
  let cache: EdgeCache;

  beforeEach(() => {
    resetEdgeCache();
    cache = new EdgeCache({
      maxSizeBytes: 10 * 1024 * 1024, // 10MB
      maxEntries: 1000,
      defaultTTL: 3600,
      ttlConfig: DEFAULT_TTL_CONFIG,
      rules: [],
      enableCompression: true,
      compressionThreshold: 1024,
      staleWhileRevalidate: 60,
      staleIfError: 300,
    });
  });

  afterEach(() => {
    resetEdgeCache();
  });

  describe('Basic Operations', () => {
    it('should store and retrieve entries', () => {
      const data = Buffer.from('Hello, World!');
      cache.set('/test.txt', data, { contentType: 'text/plain' });

      const { entry, status } = cache.get('/test.txt');
      expect(entry).not.toBeNull();
      expect(status).toBe('HIT');
      expect(entry!.data.toString()).toBe('Hello, World!');
    });

    it('should return MISS for non-existent keys', () => {
      const { entry, status } = cache.get('/not-found');
      expect(entry).toBeNull();
      expect(status).toBe('MISS');
    });

    it('should delete entries', () => {
      cache.set('/test.txt', Buffer.from('test'), {});
      expect(cache.has('/test.txt')).toBe(true);

      cache.delete('/test.txt');
      expect(cache.has('/test.txt')).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('/a.txt', Buffer.from('a'), {});
      cache.set('/b.txt', Buffer.from('b'), {});
      cache.set('/c.txt', Buffer.from('c'), {});

      cache.clear();

      expect(cache.has('/a.txt')).toBe(false);
      expect(cache.has('/b.txt')).toBe(false);
      expect(cache.has('/c.txt')).toBe(false);
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate simple keys from paths', () => {
      const key = cache.generateKey({ path: '/assets/main.js' });
      expect(key).toBe('/assets/main.js');
    });

    it('should include query string in keys', () => {
      const key = cache.generateKey({ path: '/api/users', query: 'page=1&limit=10' });
      expect(key).toBe('/api/users?page=1&limit=10');
    });

    it('should hash vary headers for cache key', () => {
      const key1 = cache.generateKey({
        path: '/api/data',
        varyHeaders: { 'accept-encoding': 'gzip' },
      });
      const key2 = cache.generateKey({
        path: '/api/data',
        varyHeaders: { 'accept-encoding': 'br' },
      });
      
      expect(key1).not.toBe(key2);
      expect(key1).toContain('/api/data#');
      expect(key2).toContain('/api/data#');
    });
  });

  describe('TTL Calculation', () => {
    it('should respect max-age in cache-control', () => {
      const ttl = cache.calculateTTL('/test.html', {
        cacheControl: 'max-age=600',
      });
      expect(ttl).toBe(600);
    });

    it('should return 0 for no-store', () => {
      const ttl = cache.calculateTTL('/test.html', {
        cacheControl: 'no-store',
      });
      expect(ttl).toBe(0);
    });

    it('should return 0 for no-cache', () => {
      const ttl = cache.calculateTTL('/test.html', {
        cacheControl: 'no-cache',
      });
      expect(ttl).toBe(0);
    });

    it('should use long TTL for immutable content', () => {
      const ttl = cache.calculateTTL('/assets/main.abc123.js', {
        immutable: true,
      });
      expect(ttl).toBe(DEFAULT_TTL_CONFIG.immutableAssets);
    });

    it('should detect content hash in path', () => {
      // Paths with hashes should get immutable TTL
      const paths = [
        '/assets/main.a1b2c3d4.js',
        '/static/style-12345678.css',
        '/bundle.abcd1234.js',
      ];

      for (const path of paths) {
        const ttl = cache.calculateTTL(path, {
          contentType: 'application/javascript',
        });
        expect(ttl).toBe(DEFAULT_TTL_CONFIG.immutableAssets);
      }
    });

    it('should use HTML TTL for text/html', () => {
      const ttl = cache.calculateTTL('/index.html', {
        contentType: 'text/html',
      });
      expect(ttl).toBe(DEFAULT_TTL_CONFIG.html);
    });

    it('should use font TTL for fonts', () => {
      const ttl = cache.calculateTTL('/fonts/roboto.woff2', {
        contentType: 'font/woff2',
      });
      expect(ttl).toBe(DEFAULT_TTL_CONFIG.fonts);
    });
  });

  describe('Conditional Requests', () => {
    it('should return REVALIDATED for matching ETag', () => {
      const data = Buffer.from('test content');
      cache.set('/test.txt', data, {
        contentType: 'text/plain',
        etag: '"abc123"',
      });

      const { status, notModified } = cache.getConditional(
        '/test.txt',
        '"abc123"',
        undefined
      );

      expect(status).toBe('REVALIDATED');
      expect(notModified).toBe(true);
    });

    it('should return HIT for non-matching ETag', () => {
      const data = Buffer.from('test content');
      cache.set('/test.txt', data, {
        contentType: 'text/plain',
        etag: '"abc123"',
      });

      const { status, notModified } = cache.getConditional(
        '/test.txt',
        '"xyz789"',
        undefined
      );

      expect(status).toBe('HIT');
      expect(notModified).toBe(false);
    });

    it('should return REVALIDATED for matching Last-Modified', () => {
      const lastMod = Date.now() - 1000;
      const data = Buffer.from('test content');
      cache.set('/test.txt', data, {
        contentType: 'text/plain',
        lastModified: lastMod,
      });

      const { status, notModified } = cache.getConditional(
        '/test.txt',
        undefined,
        lastMod + 1000 // If-Modified-Since is after last modified
      );

      expect(status).toBe('REVALIDATED');
      expect(notModified).toBe(true);
    });
  });

  describe('Purge', () => {
    beforeEach(() => {
      cache.set('/assets/main.js', Buffer.from('main'), {});
      cache.set('/assets/style.css', Buffer.from('style'), {});
      cache.set('/assets/image.png', Buffer.from('image'), {});
      cache.set('/api/users', Buffer.from('users'), {});
      cache.set('/api/posts', Buffer.from('posts'), {});
    });

    it('should purge by exact path', () => {
      const count = cache.purge('/assets/main.js');
      expect(count).toBe(1);
      expect(cache.has('/assets/main.js')).toBe(false);
      expect(cache.has('/assets/style.css')).toBe(true);
    });

    it('should purge by pattern', () => {
      const count = cache.purge('/assets/*');
      expect(count).toBe(3);
      expect(cache.has('/assets/main.js')).toBe(false);
      expect(cache.has('/assets/style.css')).toBe(false);
      expect(cache.has('/assets/image.png')).toBe(false);
      expect(cache.has('/api/users')).toBe(true);
    });

    it('should purge by prefix pattern', () => {
      const count = cache.purge('/api/*');
      expect(count).toBe(2);
      expect(cache.has('/api/users')).toBe(false);
      expect(cache.has('/api/posts')).toBe(false);
      expect(cache.has('/assets/main.js')).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should track hit/miss counts', () => {
      cache.set('/test', Buffer.from('test'), {});

      // Generate some hits and misses
      cache.get('/test'); // hit
      cache.get('/test'); // hit
      cache.get('/not-found'); // miss
      cache.get('/also-not-found'); // miss
      cache.get('/test'); // hit

      const stats = cache.getStats();
      expect(stats.hitCount).toBe(3);
      expect(stats.missCount).toBe(2);
      expect(stats.hitRate).toBeCloseTo(0.6, 1);
    });

    it('should track cache size', () => {
      const data1 = Buffer.alloc(1000);
      const data2 = Buffer.alloc(2000);

      cache.set('/file1', data1, {});
      cache.set('/file2', data2, {});

      const stats = cache.getStats();
      expect(stats.entries).toBe(2);
      expect(stats.sizeBytes).toBe(3000);
    });

    it('should reset statistics', () => {
      cache.set('/test', Buffer.from('test'), {});
      cache.get('/test');
      cache.get('/not-found');

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hitCount).toBe(0);
      expect(stats.missCount).toBe(0);
    });
  });

  describe('Stale-While-Revalidate', () => {
    it('should mark entry as revalidating', () => {
      const key = '/test';
      expect(cache.isRevalidating(key)).toBe(false);

      cache.startRevalidation(key);
      expect(cache.isRevalidating(key)).toBe(true);

      cache.completeRevalidation(key);
      expect(cache.isRevalidating(key)).toBe(false);
    });
  });
});

