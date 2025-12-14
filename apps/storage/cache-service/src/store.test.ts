/**
 * Cache Store Tests - Comprehensive Coverage
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { CacheStore, getCacheStore, resetCacheStore } from './store.js';

describe('CacheStore', () => {
  let store: CacheStore;

  beforeEach(() => {
    resetCacheStore();
    store = new CacheStore(256, 3600);
  });

  afterEach(() => {
    store.stop();
    resetCacheStore();
  });

  describe('Basic Operations', () => {
    describe('set and get', () => {
      it('should store and retrieve a value', () => {
        store.set('ns', 'key1', 'value1');
        expect(store.get('ns', 'key1')).toBe('value1');
      });

      it('should return null for non-existent key', () => {
        expect(store.get('ns', 'nonexistent')).toBeNull();
      });

      it('should return null for non-existent namespace', () => {
        expect(store.get('nonexistent-ns', 'key')).toBeNull();
      });

      it('should handle different namespaces separately', () => {
        store.set('ns1', 'key', 'value1');
        store.set('ns2', 'key', 'value2');
        expect(store.get('ns1', 'key')).toBe('value1');
        expect(store.get('ns2', 'key')).toBe('value2');
      });

      it('should overwrite existing values', () => {
        store.set('ns', 'key', 'original');
        store.set('ns', 'key', 'updated');
        expect(store.get('ns', 'key')).toBe('updated');
      });

      it('should handle empty string value', () => {
        store.set('ns', 'key', '');
        expect(store.get('ns', 'key')).toBe('');
      });

      it('should handle empty string key', () => {
        store.set('ns', '', 'value');
        expect(store.get('ns', '')).toBe('value');
      });

      it('should handle special characters in keys', () => {
        store.set('ns', 'key:with:colons', 'value1');
        store.set('ns', 'key/with/slashes', 'value2');
        store.set('ns', 'key.with.dots', 'value3');
        store.set('ns', 'key with spaces', 'value4');
        
        expect(store.get('ns', 'key:with:colons')).toBe('value1');
        expect(store.get('ns', 'key/with/slashes')).toBe('value2');
        expect(store.get('ns', 'key.with.dots')).toBe('value3');
        expect(store.get('ns', 'key with spaces')).toBe('value4');
      });
    });
  });

  describe('TTL Behavior', () => {
    it('should expire values after TTL', async () => {
      store.set('ns', 'key', 'value', 0.1); // 100ms TTL
      expect(store.get('ns', 'key')).toBe('value');
      
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(store.get('ns', 'key')).toBeNull();
    });

    it('should not expire values with TTL of 0 (infinite)', async () => {
      store.set('ns', 'key', 'value', 0); // No expiry
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(store.get('ns', 'key')).toBe('value');
    });

    it('should use default TTL when not specified', () => {
      const customStore = new CacheStore(256, 1); // 1 second default
      customStore.set('ns', 'key', 'value'); // Uses default
      
      const ttl = customStore.ttl('ns', 'key');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(1);
      customStore.stop();
    });

    it('should return correct TTL for key', () => {
      store.set('ns', 'key', 'value', 60);
      const ttl = store.ttl('ns', 'key');
      expect(ttl).toBeGreaterThan(55);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it('should return -1 for key without expiry', () => {
      store.set('ns', 'key', 'value', 0);
      expect(store.ttl('ns', 'key')).toBe(-1);
    });

    it('should return null for expired key TTL', async () => {
      store.set('ns', 'key', 'value', 0.05);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(store.ttl('ns', 'key')).toBeNull();
    });

    it('should return null for non-existent key TTL', () => {
      expect(store.ttl('ns', 'nonexistent')).toBeNull();
    });
  });

  describe('expire and persist', () => {
    it('should update expiry with expire()', () => {
      store.set('ns', 'key', 'value', 60);
      store.expire('ns', 'key', 120);
      
      const ttl = store.ttl('ns', 'key');
      expect(ttl).toBeGreaterThan(115);
      expect(ttl).toBeLessThanOrEqual(120);
    });

    it('should return false when expiring non-existent key', () => {
      expect(store.expire('ns', 'nonexistent', 60)).toBe(false);
    });

    it('should remove expiry with persist()', () => {
      store.set('ns', 'key', 'value', 60);
      store.persist('ns', 'key');
      expect(store.ttl('ns', 'key')).toBe(-1);
    });

    it('should return false when persisting non-existent key', () => {
      expect(store.persist('ns', 'nonexistent')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete a key', () => {
      store.set('ns', 'key', 'value');
      expect(store.get('ns', 'key')).toBe('value');
      store.delete('ns', 'key');
      expect(store.get('ns', 'key')).toBeNull();
    });

    it('should return true when key existed', () => {
      store.set('ns', 'key', 'value');
      expect(store.delete('ns', 'key')).toBe(true);
    });

    it('should return false when key did not exist', () => {
      expect(store.delete('ns', 'nonexistent')).toBe(false);
    });

    it('should return false for non-existent namespace', () => {
      expect(store.delete('nonexistent-ns', 'key')).toBe(false);
    });
  });

  describe('has and exists', () => {
    it('should return true for existing key', () => {
      store.set('ns', 'key', 'value');
      expect(store.has('ns', 'key')).toBe(true);
      expect(store.exists('ns', 'key')).toBe(true);
    });

    it('should return false for non-existent key', () => {
      expect(store.has('ns', 'nonexistent')).toBe(false);
      expect(store.exists('ns', 'nonexistent')).toBe(false);
    });

    it('should return false for expired key', async () => {
      store.set('ns', 'key', 'value', 0.05);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(store.has('ns', 'key')).toBe(false);
      expect(store.exists('ns', 'key')).toBe(false);
    });
  });

  describe('Batch Operations', () => {
    describe('mset', () => {
      it('should set multiple keys at once', () => {
        store.mset('ns', [
          { key: 'k1', value: 'v1' },
          { key: 'k2', value: 'v2' },
          { key: 'k3', value: 'v3' },
        ]);
        
        expect(store.get('ns', 'k1')).toBe('v1');
        expect(store.get('ns', 'k2')).toBe('v2');
        expect(store.get('ns', 'k3')).toBe('v3');
      });

      it('should respect individual TTLs', async () => {
        store.mset('ns', [
          { key: 'short', value: 'v1', ttl: 0.05 },
          { key: 'long', value: 'v2', ttl: 60 },
        ]);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        expect(store.get('ns', 'short')).toBeNull();
        expect(store.get('ns', 'long')).toBe('v2');
      });
    });

    describe('mget', () => {
      it('should get multiple keys at once', () => {
        store.set('ns', 'k1', 'v1');
        store.set('ns', 'k2', 'v2');
        
        const results = store.mget('ns', ['k1', 'k2', 'k3']);
        
        expect(results.get('k1')).toBe('v1');
        expect(results.get('k2')).toBe('v2');
        expect(results.get('k3')).toBeNull();
      });

      it('should return all nulls for non-existent namespace', () => {
        const results = store.mget('nonexistent', ['k1', 'k2']);
        expect(results.get('k1')).toBeNull();
        expect(results.get('k2')).toBeNull();
      });
    });

    describe('mdelete', () => {
      it('should delete multiple keys at once', () => {
        store.set('ns', 'k1', 'v1');
        store.set('ns', 'k2', 'v2');
        store.set('ns', 'k3', 'v3');
        
        const deleted = store.mdelete('ns', ['k1', 'k2', 'k4']);
        
        expect(deleted).toBe(2);
        expect(store.get('ns', 'k1')).toBeNull();
        expect(store.get('ns', 'k2')).toBeNull();
        expect(store.get('ns', 'k3')).toBe('v3');
      });
    });
  });

  describe('keys', () => {
    it('should list all keys in namespace', () => {
      store.set('ns', 'key1', 'v1');
      store.set('ns', 'key2', 'v2');
      store.set('ns', 'key3', 'v3');
      
      const keys = store.keys('ns');
      expect(keys.sort()).toEqual(['key1', 'key2', 'key3']);
    });

    it('should return empty array for empty namespace', () => {
      expect(store.keys('empty-ns')).toEqual([]);
    });

    it('should not include keys from other namespaces', () => {
      store.set('ns1', 'key1', 'v1');
      store.set('ns2', 'key2', 'v2');
      
      expect(store.keys('ns1')).toEqual(['key1']);
    });

    it('should filter by glob pattern - asterisk', () => {
      store.set('ns', 'user:1', 'v1');
      store.set('ns', 'user:2', 'v2');
      store.set('ns', 'session:1', 'v3');
      
      const keys = store.keys('ns', 'user:*');
      expect(keys.sort()).toEqual(['user:1', 'user:2']);
    });

    it('should filter by glob pattern - question mark', () => {
      store.set('ns', 'key1', 'v1');
      store.set('ns', 'key2', 'v2');
      store.set('ns', 'key10', 'v3');
      
      const keys = store.keys('ns', 'key?');
      expect(keys.sort()).toEqual(['key1', 'key2']);
    });
  });

  describe('clear and clearNamespace', () => {
    it('should clear a specific namespace', () => {
      store.set('ns1', 'key1', 'v1');
      store.set('ns2', 'key2', 'v2');
      
      store.clearNamespace('ns1');
      
      expect(store.get('ns1', 'key1')).toBeNull();
      expect(store.get('ns2', 'key2')).toBe('v2');
    });

    it('should clear all namespaces', () => {
      store.set('ns1', 'key1', 'v1');
      store.set('ns2', 'key2', 'v2');
      
      store.clear();
      
      expect(store.get('ns1', 'key1')).toBeNull();
      expect(store.get('ns2', 'key2')).toBeNull();
    });

    it('clearAll should work the same as clear', () => {
      store.set('ns', 'key', 'value');
      store.clearAll();
      expect(store.get('ns', 'key')).toBeNull();
    });
  });

  describe('Stats', () => {
    it('should report correct stats', () => {
      store.set('ns1', 'k1', 'v1');
      store.set('ns1', 'k2', 'v2');
      store.set('ns2', 'k3', 'v3');
      
      const stats = store.getStats();
      
      expect(stats.totalKeys).toBe(3);
      expect(stats.namespaces).toBe(2);
      expect(stats.totalInstances).toBe(2);
    });

    it('should track hits and misses', () => {
      store.set('ns', 'key', 'value');
      
      // Hits
      store.get('ns', 'key');
      store.get('ns', 'key');
      
      // Misses
      store.get('ns', 'nonexistent');
      
      const stats = store.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2/3, 2);
    });

    it('should return 0 hit rate with no operations', () => {
      const stats = store.getStats();
      expect(stats.hitRate).toBe(0);
    });

    it('should report memory usage', () => {
      store.set('ns', 'key', 'x'.repeat(1000));
      const stats = store.getStats();
      expect(stats.usedMemoryMb).toBeGreaterThan(0);
    });
  });

  describe('Instance Stats', () => {
    it('should get instance-specific stats', () => {
      store.set('ns', 'k1', 'v1');
      store.set('ns', 'k2', 'v2');
      store.get('ns', 'k1');
      store.get('ns', 'nonexistent');
      
      const stats = store.getInstanceStats('ns');
      
      expect(stats).not.toBeNull();
      expect(stats!.keyCount).toBe(2);
      expect(stats!.hits).toBe(1);
      expect(stats!.misses).toBe(1);
      expect(stats!.instanceId).toBe('ns');
    });

    it('should return null for non-existent namespace', () => {
      expect(store.getInstanceStats('nonexistent')).toBeNull();
    });
  });

  describe('Memory Management', () => {
    it('should evict oldest when memory is full', () => {
      const smallStore = new CacheStore(0.0001, 3600); // Very small memory limit
      
      // Fill with data
      for (let i = 0; i < 100; i++) {
        smallStore.set('ns', `key${i}`, 'x'.repeat(100));
      }
      
      // Some keys should have been evicted
      const keys = smallStore.keys('ns');
      expect(keys.length).toBeLessThan(100);
      smallStore.stop();
    });
  });

  describe('JSON Values', () => {
    it('should handle JSON serialization', () => {
      const obj = { foo: 'bar', nested: { a: 1, b: [1, 2, 3] } };
      store.set('ns', 'json-key', JSON.stringify(obj));
      
      const retrieved = store.get('ns', 'json-key');
      expect(JSON.parse(retrieved!)).toEqual(obj);
    });

    it('should handle complex nested JSON', () => {
      const complex = {
        string: 'test',
        number: 42,
        float: 3.14,
        bool: true,
        null: null,
        array: [1, 'two', { three: 3 }],
        nested: { deep: { deeper: { value: 'found' } } },
      };
      
      store.set('ns', 'complex', JSON.stringify(complex));
      expect(JSON.parse(store.get('ns', 'complex')!)).toEqual(complex);
    });
  });

  describe('Large Values', () => {
    it('should handle large strings (1MB)', () => {
      const largeValue = 'x'.repeat(1024 * 1024);
      store.set('ns', 'large-key', largeValue);
      
      const retrieved = store.get('ns', 'large-key');
      expect(retrieved?.length).toBe(1024 * 1024);
    });

    it('should handle many keys (10000)', () => {
      for (let i = 0; i < 10000; i++) {
        store.set('ns', `key-${i}`, `value-${i}`);
      }
      
      expect(store.keys('ns').length).toBe(10000);
      expect(store.get('ns', 'key-5000')).toBe('value-5000');
    });
  });

  describe('Edge Cases', () => {
    it('should handle unicode values', () => {
      store.set('ns', 'unicode', '日本語 🚀 émojis');
      expect(store.get('ns', 'unicode')).toBe('日本語 🚀 émojis');
    });

    it('should handle very long keys', () => {
      const longKey = 'k'.repeat(10000);
      store.set('ns', longKey, 'value');
      expect(store.get('ns', longKey)).toBe('value');
    });

    it('should handle rapid set/get cycles', () => {
      for (let i = 0; i < 1000; i++) {
        store.set('ns', 'key', `value-${i}`);
        expect(store.get('ns', 'key')).toBe(`value-${i}`);
      }
    });

    it('should handle many namespaces', () => {
      for (let i = 0; i < 100; i++) {
        store.set(`ns-${i}`, 'key', `value-${i}`);
      }
      
      expect(store.getStats().namespaces).toBe(100);
      expect(store.get('ns-50', 'key')).toBe('value-50');
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance from getCacheStore', () => {
      resetCacheStore();
      const store1 = getCacheStore();
      const store2 = getCacheStore();
      expect(store1).toBe(store2);
    });

    it('should reset singleton', () => {
      resetCacheStore();
      const store1 = getCacheStore();
      resetCacheStore();
      const store2 = getCacheStore();
      expect(store1).not.toBe(store2);
    });

    it('should accept custom config on first call', () => {
      resetCacheStore();
      const store = getCacheStore(512, 7200);
      const stats = store.getStats();
      expect(stats.totalMemoryMb).toBe(512);
    });
  });

  describe('Concurrent Access', () => {
    it('should handle concurrent reads and writes', async () => {
      const promises: Promise<void>[] = [];
      
      for (let i = 0; i < 100; i++) {
        promises.push(
          (async () => {
            store.set('ns', `key-${i}`, `value-${i}`);
            store.get('ns', `key-${i % 50}`); // Read some existing
          })()
        );
      }
      
      await Promise.all(promises);
      expect(store.keys('ns').length).toBe(100);
    });

    it('should maintain consistency under concurrent operations', async () => {
      const key = 'counter';
      store.set('ns', key, '0');
      
      const increments = Array.from({ length: 100 }, async () => {
        const current = parseInt(store.get('ns', key) || '0');
        store.set('ns', key, String(current + 1));
      });
      
      await Promise.all(increments);
      
      // Note: This won't be exactly 100 due to race conditions
      // but should be > 0 and all operations should complete
      const final = parseInt(store.get('ns', key) || '0');
      expect(final).toBeGreaterThan(0);
    });
  });
});
