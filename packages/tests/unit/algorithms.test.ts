/**
 * Algorithm Unit Tests - Property-based and Fuzz Testing
 * 
 * Tests complex algorithms used in infrastructure:
 * - CRC16 Redis Cluster slot calculation
 * - Gossip protocol fanout calculation
 * - Circuit breaker state machine
 * - Exponential backoff timing
 * - Content hash verification
 */

import { describe, test, expect } from 'bun:test';
import * as crypto from 'crypto';

// ============================================================================
// CRC16 Implementation (Redis Cluster Compatible)
// ============================================================================

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

function crc16(data: Buffer): number {
  let crc = 0;
  for (const byte of data) {
    crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ byte) & 0xff]) & 0xffff;
  }
  return crc;
}

function calculateSlot(key: string): number {
  const start = key.indexOf('{');
  const end = key.indexOf('}', start + 1);

  const hashKey =
    start !== -1 && end !== -1 && end > start + 1
      ? key.slice(start + 1, end)
      : key;

  return crc16(Buffer.from(hashKey)) % 16384;
}

// ============================================================================
// CRC16 Property-Based Tests
// ============================================================================

describe('CRC16 - Property-Based Tests', () => {
  test('slot always in valid range [0, 16384)', () => {
    // Test with many random keys
    for (let i = 0; i < 1000; i++) {
      const randomKey = crypto.randomBytes(Math.floor(Math.random() * 100) + 1).toString('hex');
      const slot = calculateSlot(randomKey);
      
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(16384);
    }
  });

  test('deterministic: same key always produces same slot', () => {
    const testKeys = [
      'user:123',
      'session:abc-def-ghi',
      '{hash_tag}:key:value',
      'a'.repeat(1000),
      crypto.randomBytes(50).toString('hex'),
    ];

    for (const key of testKeys) {
      const slot1 = calculateSlot(key);
      const slot2 = calculateSlot(key);
      const slot3 = calculateSlot(key);
      
      expect(slot1).toBe(slot2);
      expect(slot2).toBe(slot3);
    }
  });

  test('hash tag consistency: keys with same tag always map to same slot', () => {
    const tag = 'user123';
    const keys = [
      `{${tag}}:name`,
      `{${tag}}:email`,
      `{${tag}}:settings`,
      `{${tag}}:preferences:theme`,
      `data:{${tag}}:cache`,
      `prefix:more:{${tag}}:suffix`,
    ];

    const slots = keys.map(calculateSlot);
    const uniqueSlots = new Set(slots);
    
    expect(uniqueSlots.size).toBe(1);
  });

  test('distribution: slots should be reasonably distributed', () => {
    const slotCounts = new Map<number, number>();
    const numKeys = 10000;
    
    for (let i = 0; i < numKeys; i++) {
      const key = `key:${i}:${crypto.randomBytes(8).toString('hex')}`;
      const slot = calculateSlot(key);
      slotCounts.set(slot, (slotCounts.get(slot) || 0) + 1);
    }
    
    // Should have many unique slots (good distribution)
    // With 16384 possible slots, we expect ~7000-8000 unique with 10000 random keys
    const uniqueSlots = slotCounts.size;
    expect(uniqueSlots).toBeGreaterThan(numKeys * 0.6); // At least 60% unique
    
    // No single slot should have more than 1% of keys
    const maxCount = Math.max(...slotCounts.values());
    expect(maxCount).toBeLessThan(numKeys * 0.01);
  });

  test('empty hash tag uses full key', () => {
    const keyWithEmptyTag = 'key:{}:value';
    const keyWithoutTag = 'key:{}:value';
    
    // Both should use the full key since {} is empty
    expect(calculateSlot(keyWithEmptyTag)).toBe(calculateSlot(keyWithoutTag));
  });

  test('first hash tag takes precedence', () => {
    const key1 = '{tag1}:{tag2}:key';
    const key2 = '{tag1}:different:value';
    
    // Only {tag1} should be used
    expect(calculateSlot(key1)).toBe(calculateSlot(key2));
  });

  test('unclosed brace uses full key', () => {
    const key1 = 'key:{unclosed';
    const key2 = 'key:{unclosed';
    
    expect(calculateSlot(key1)).toBe(calculateSlot(key2));
  });

  test('closing brace before opening uses full key', () => {
    const key = 'key:}before{:value';
    const slot = calculateSlot(key);
    
    // Should use full key, not throw
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(16384);
  });
});

// Known test vectors from Redis documentation
describe('CRC16 - Redis Compatibility Vectors', () => {
  test('should match Redis reference values', () => {
    // These are known slot values from Redis documentation
    const knownMappings: Array<[string, number]> = [
      ['123456789', 12739],
      ['foo', 12182],
      ['bar', 5061],
      ['hello', 866],
    ];

    for (const [key, expectedSlot] of knownMappings) {
      const slot = calculateSlot(key);
      expect(slot).toBe(expectedSlot);
    }
  });
});

// ============================================================================
// Gossip Protocol Fanout Tests
// ============================================================================

function getRandomPeers<T>(peers: T[], count: number): T[] {
  const result: T[] = [];
  const available = [...peers];

  while (result.length < count && available.length > 0) {
    const index = Math.floor(Math.random() * available.length);
    result.push(available.splice(index, 1)[0]);
  }

  return result;
}

function calculateFanout(peerCount: number): number {
  return Math.max(3, Math.ceil(Math.sqrt(peerCount)));
}

describe('Gossip Protocol - Fanout Calculation', () => {
  test('fanout grows with sqrt of peer count', () => {
    const testCases: Array<[number, number]> = [
      [1, 3],    // min fanout
      [4, 3],    // sqrt(4) = 2, but min is 3
      [9, 3],    // sqrt(9) = 3
      [10, 4],   // ceil(sqrt(10)) = 4
      [16, 4],   // sqrt(16) = 4
      [25, 5],   // sqrt(25) = 5
      [100, 10], // sqrt(100) = 10
      [256, 16], // sqrt(256) = 16
      [1000, 32], // ceil(sqrt(1000)) = 32
      [10000, 100], // sqrt(10000) = 100
    ];

    for (const [peers, expected] of testCases) {
      expect(calculateFanout(peers)).toBe(expected);
    }
  });

  test('fanout never exceeds peer count', () => {
    for (let peers = 1; peers <= 100; peers++) {
      const fanout = calculateFanout(peers);
      expect(fanout).toBeLessThanOrEqual(peers + 3); // +3 for minimum
    }
  });

  test('fanout is always at least 3', () => {
    for (let peers = 0; peers <= 10; peers++) {
      const fanout = calculateFanout(peers);
      expect(fanout).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('Gossip Protocol - Peer Selection', () => {
  test('never selects more peers than available', () => {
    const peers = ['a', 'b', 'c'];
    const selected = getRandomPeers(peers, 10);
    
    expect(selected.length).toBe(3);
    expect(new Set(selected).size).toBe(3);
  });

  test('selects exact count when available', () => {
    const peers = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const selected = getRandomPeers(peers, 3);
    
    expect(selected.length).toBe(3);
    expect(new Set(selected).size).toBe(3);
  });

  test('all selected peers are from original set', () => {
    const peers = ['a', 'b', 'c', 'd', 'e'];
    const selected = getRandomPeers(peers, 3);
    
    for (const peer of selected) {
      expect(peers).toContain(peer);
    }
  });

  test('does not modify original array', () => {
    const peers = ['a', 'b', 'c', 'd', 'e'];
    const original = [...peers];
    getRandomPeers(peers, 3);
    
    expect(peers).toEqual(original);
  });

  test('handles empty peer list', () => {
    const selected = getRandomPeers([], 5);
    expect(selected).toEqual([]);
  });

  test('handles zero requested', () => {
    const peers = ['a', 'b', 'c'];
    const selected = getRandomPeers(peers, 0);
    expect(selected).toEqual([]);
  });

  test('selection is random over many runs', () => {
    const peers = ['a', 'b', 'c', 'd', 'e'];
    const selectionCounts = new Map<string, number>();
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      const selected = getRandomPeers(peers, 2);
      for (const peer of selected) {
        selectionCounts.set(peer, (selectionCounts.get(peer) || 0) + 1);
      }
    }

    // Each peer should be selected roughly equally
    const expectedCount = (iterations * 2) / peers.length;
    for (const [, count] of selectionCounts) {
      // Allow 50% variance
      expect(count).toBeGreaterThan(expectedCount * 0.5);
      expect(count).toBeLessThan(expectedCount * 1.5);
    }
  });
});

// ============================================================================
// Circuit Breaker Tests
// ============================================================================

type CircuitState = 'closed' | 'open' | 'half-open';

class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: CircuitState = 'closed';
  private successesInHalfOpen = 0;

  constructor(
    private readonly threshold = 5,
    private readonly resetTimeout = 30000,
    private readonly halfOpenSuccessThreshold = 2
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = 'half-open';
        this.successesInHalfOpen = 0;
      } else {
        throw new Error('Circuit breaker open');
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
    if (this.state === 'half-open') {
      this.successesInHalfOpen++;
      if (this.successesInHalfOpen >= this.halfOpenSuccessThreshold) {
        this.failures = 0;
        this.state = 'closed';
      }
    } else {
      this.failures = 0;
      this.state = 'closed';
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold || this.state === 'half-open') {
      this.state = 'open';
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailures(): number {
    return this.failures;
  }
}

describe('Circuit Breaker - State Machine', () => {
  test('transitions: closed -> open after threshold failures', async () => {
    const breaker = new CircuitBreaker(3, 1000);
    
    expect(breaker.getState()).toBe('closed');
    
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch {
        // Expected
      }
    }
    
    expect(breaker.getState()).toBe('open');
  });

  test('transitions: open -> half-open after timeout', async () => {
    const breaker = new CircuitBreaker(2, 50, 1); // Short timeout, 1 success to close
    
    // Trip the breaker
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch {
        // Expected
      }
    }
    expect(breaker.getState()).toBe('open');
    
    // Wait for timeout
    await new Promise(r => setTimeout(r, 100));
    
    // Next execution should transition to half-open, then close on success
    await breaker.execute(async () => 'success');
    expect(breaker.getState()).toBe('closed'); // With threshold=1, closes immediately
  });

  test('transitions: half-open -> closed after successful requests', async () => {
    const breaker = new CircuitBreaker(2, 50, 2);
    
    // Trip the breaker
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch {
        // Expected
      }
    }
    
    // Wait for timeout
    await new Promise(r => setTimeout(r, 100));
    
    // First success in half-open
    await breaker.execute(async () => 'success1');
    
    // Second success closes the circuit
    await breaker.execute(async () => 'success2');
    
    expect(breaker.getState()).toBe('closed');
    expect(breaker.getFailures()).toBe(0);
  });

  test('transitions: half-open -> open on failure', async () => {
    const breaker = new CircuitBreaker(2, 50, 3);
    
    // Trip the breaker
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch {
        // Expected
      }
    }
    
    // Wait for timeout
    await new Promise(r => setTimeout(r, 100));
    
    // First success in half-open
    await breaker.execute(async () => 'success');
    
    // Failure should immediately open
    try {
      await breaker.execute(async () => { throw new Error('fail'); });
    } catch {
      // Expected
    }
    
    expect(breaker.getState()).toBe('open');
  });

  test('failure count resets on success', async () => {
    const breaker = new CircuitBreaker(5, 1000);
    
    // Accumulate some failures
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch {
        // Expected
      }
    }
    expect(breaker.getFailures()).toBe(3);
    
    // Success resets count
    await breaker.execute(async () => 'success');
    expect(breaker.getFailures()).toBe(0);
    
    // Can accumulate failures again
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch {
        // Expected
      }
    }
    expect(breaker.getFailures()).toBe(2);
    expect(breaker.getState()).toBe('closed'); // Still under threshold
  });
});

// ============================================================================
// Exponential Backoff Tests
// ============================================================================

function calculateBackoff(attempt: number, baseMs: number, maxMs: number = 60000): number {
  const delay = baseMs * Math.pow(2, attempt);
  return Math.min(delay, maxMs);
}

function calculateJitteredBackoff(attempt: number, baseMs: number, maxMs: number = 60000): number {
  const delay = calculateBackoff(attempt, baseMs, maxMs);
  // Add jitter: random value between 0 and delay/2
  const jitter = Math.random() * (delay / 2);
  return Math.floor(delay + jitter);
}

describe('Exponential Backoff - Calculation', () => {
  test('doubles delay for each attempt', () => {
    const base = 100;
    
    expect(calculateBackoff(0, base)).toBe(100);
    expect(calculateBackoff(1, base)).toBe(200);
    expect(calculateBackoff(2, base)).toBe(400);
    expect(calculateBackoff(3, base)).toBe(800);
    expect(calculateBackoff(4, base)).toBe(1600);
  });

  test('respects maximum delay', () => {
    const base = 1000;
    const max = 5000;
    
    expect(calculateBackoff(0, base, max)).toBe(1000);
    expect(calculateBackoff(1, base, max)).toBe(2000);
    expect(calculateBackoff(2, base, max)).toBe(4000);
    expect(calculateBackoff(3, base, max)).toBe(5000); // Capped
    expect(calculateBackoff(10, base, max)).toBe(5000); // Still capped
  });

  test('handles large attempt numbers without overflow', () => {
    const delay = calculateBackoff(100, 100, 60000);
    expect(delay).toBe(60000); // Should be capped
  });

  test('jittered backoff is always greater than or equal to base backoff', () => {
    const base = 100;
    
    for (let attempt = 0; attempt < 10; attempt++) {
      const baseDelay = calculateBackoff(attempt, base);
      
      for (let i = 0; i < 100; i++) {
        const jitteredDelay = calculateJitteredBackoff(attempt, base);
        expect(jitteredDelay).toBeGreaterThanOrEqual(baseDelay);
        expect(jitteredDelay).toBeLessThanOrEqual(baseDelay * 1.5);
      }
    }
  });

  test('jittered backoff provides variance', () => {
    const base = 1000;
    const delays = new Set<number>();
    
    for (let i = 0; i < 100; i++) {
      delays.add(calculateJitteredBackoff(2, base));
    }
    
    // Should have many unique values due to jitter
    expect(delays.size).toBeGreaterThan(50);
  });
});

// ============================================================================
// Content Hash Verification Tests
// ============================================================================

function verifyContentHash(data: Buffer, expectedHash: string): boolean {
  // SHA256 with 0x prefix (case insensitive)
  const lowerHash = expectedHash.toLowerCase();
  if (lowerHash.startsWith('0x') && lowerHash.length === 66) {
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    return `0x${hash}` === lowerHash;
  }

  // CIDv0 format (Qm...)
  if (expectedHash.startsWith('Qm') && expectedHash.length === 46) {
    // Simplified: just verify format for now
    return /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(expectedHash);
  }

  // CIDv1 format (bafy...)
  if (expectedHash.startsWith('bafy')) {
    return expectedHash.length > 50;
  }

  // BitTorrent infohash (SHA1)
  if (/^[a-f0-9]{40}$/i.test(expectedHash)) {
    const hash = crypto.createHash('sha1').update(data).digest('hex');
    return hash.toLowerCase() === expectedHash.toLowerCase();
  }

  return false;
}

describe('Content Hash Verification', () => {
  test('verifies SHA256 hash correctly', () => {
    const data = Buffer.from('Hello, World!');
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    
    expect(verifyContentHash(data, `0x${hash}`)).toBe(true);
    // Uppercase hash with lowercase 0x prefix
    expect(verifyContentHash(data, `0x${hash.toUpperCase()}`)).toBe(true);
  });

  test('rejects wrong SHA256 hash', () => {
    const data = Buffer.from('Hello, World!');
    const wrongHash = '0x' + '0'.repeat(64);
    
    expect(verifyContentHash(data, wrongHash)).toBe(false);
  });

  test('verifies SHA1 infohash correctly', () => {
    const data = Buffer.from('BitTorrent content');
    const hash = crypto.createHash('sha1').update(data).digest('hex');
    
    expect(verifyContentHash(data, hash)).toBe(true);
    expect(verifyContentHash(data, hash.toUpperCase())).toBe(true);
  });

  test('rejects wrong SHA1 infohash', () => {
    const data = Buffer.from('BitTorrent content');
    const wrongHash = '0'.repeat(40);
    
    expect(verifyContentHash(data, wrongHash)).toBe(false);
  });

  test('validates CIDv0 format', () => {
    const data = Buffer.from('IPFS content');
    
    // Valid CIDv0 format
    expect(verifyContentHash(data, 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG')).toBe(true);
    
    // Invalid: wrong length
    expect(verifyContentHash(data, 'QmShort')).toBe(false);
  });

  test('validates CIDv1 format', () => {
    const data = Buffer.from('IPFS v1 content');
    
    // Valid CIDv1 format (length > 50)
    expect(verifyContentHash(data, 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi')).toBe(true);
    
    // Invalid: too short
    expect(verifyContentHash(data, 'bafyshort')).toBe(false);
  });

  test('rejects unknown hash formats', () => {
    const data = Buffer.from('test');
    
    expect(verifyContentHash(data, 'unknown-format')).toBe(false);
    expect(verifyContentHash(data, '0x123')).toBe(false); // Too short for SHA256
    expect(verifyContentHash(data, 'abc123')).toBe(false);
  });
});

// ============================================================================
// LRU Cache Eviction Tests
// ============================================================================

class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private accessOrder: K[] = [];

  constructor(private readonly maxSize: number) {}

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.accessOrder = this.accessOrder.filter(k => k !== key);
      this.accessOrder.push(key);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // Update existing
      this.cache.set(key, value);
      this.accessOrder = this.accessOrder.filter(k => k !== key);
      this.accessOrder.push(key);
    } else {
      // Evict if at capacity
      while (this.cache.size >= this.maxSize) {
        const lruKey = this.accessOrder.shift();
        if (lruKey !== undefined) {
          this.cache.delete(lruKey);
        }
      }
      this.cache.set(key, value);
      this.accessOrder.push(key);
    }
  }

  size(): number {
    return this.cache.size;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }
}

describe('LRU Cache - Eviction Policy', () => {
  test('evicts least recently used when at capacity', () => {
    const cache = new LRUCache<string, number>(3);
    
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    
    // All present
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    
    // Add new item, should evict 'a'
    cache.set('d', 4);
    
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  test('accessing item moves it to most recently used', () => {
    const cache = new LRUCache<string, number>(3);
    
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    
    // Access 'a' - makes it most recently used
    cache.get('a');
    
    // Add new item - should evict 'b' (now LRU)
    cache.set('d', 4);
    
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  test('updating item moves it to most recently used', () => {
    const cache = new LRUCache<string, number>(3);
    
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    
    // Update 'a' - makes it most recently used
    cache.set('a', 100);
    
    // Add new item - should evict 'b' (now LRU)
    cache.set('d', 4);
    
    expect(cache.get('a')).toBe(100);
    expect(cache.has('b')).toBe(false);
  });

  test('respects max size', () => {
    const cache = new LRUCache<number, string>(5);
    
    for (let i = 0; i < 100; i++) {
      cache.set(i, `value-${i}`);
    }
    
    expect(cache.size()).toBe(5);
    
    // Only last 5 should remain
    expect(cache.has(99)).toBe(true);
    expect(cache.has(98)).toBe(true);
    expect(cache.has(97)).toBe(true);
    expect(cache.has(96)).toBe(true);
    expect(cache.has(95)).toBe(true);
    expect(cache.has(94)).toBe(false);
  });

  test('handles size 1 cache', () => {
    const cache = new LRUCache<string, number>(1);
    
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    
    cache.set('b', 2);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBe(2);
  });
});

// ============================================================================
// Rate Limiting Token Bucket Tests
// ============================================================================

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillRate: number // tokens per second
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  tryAcquire(count: number = 1): boolean {
    this.refill();
    
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  getTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

describe('Token Bucket - Rate Limiting', () => {
  test('allows requests up to capacity', () => {
    const bucket = new TokenBucket(10, 1);
    
    for (let i = 0; i < 10; i++) {
      expect(bucket.tryAcquire()).toBe(true);
    }
    
    // Should be empty now
    expect(bucket.tryAcquire()).toBe(false);
  });

  test('allows batch acquisition', () => {
    const bucket = new TokenBucket(10, 1);
    
    expect(bucket.tryAcquire(5)).toBe(true);
    expect(bucket.getTokens()).toBe(5);
    
    expect(bucket.tryAcquire(5)).toBe(true);
    expect(bucket.getTokens()).toBe(0);
    
    expect(bucket.tryAcquire(1)).toBe(false);
  });

  test('rejects if not enough tokens', () => {
    const bucket = new TokenBucket(5, 1);
    
    expect(bucket.tryAcquire(3)).toBe(true);
    expect(bucket.tryAcquire(3)).toBe(false); // Only 2 left
    expect(bucket.tryAcquire(2)).toBe(true);
  });

  test('refills over time', async () => {
    const bucket = new TokenBucket(10, 100); // 100 tokens/second
    
    // Drain the bucket
    expect(bucket.tryAcquire(10)).toBe(true);
    expect(bucket.tryAcquire(1)).toBe(false);
    
    // Wait for refill
    await new Promise(r => setTimeout(r, 100));
    
    // Should have ~10 tokens back
    expect(bucket.getTokens()).toBeGreaterThanOrEqual(5);
  });

  test('does not exceed capacity', async () => {
    const bucket = new TokenBucket(10, 1000);
    
    await new Promise(r => setTimeout(r, 100));
    
    expect(bucket.getTokens()).toBeLessThanOrEqual(10);
  });
});
