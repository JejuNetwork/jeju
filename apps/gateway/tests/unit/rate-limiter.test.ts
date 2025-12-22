/**
 * Rate Limiter Unit Tests
 * 
 * Tests for rate limiting calculations and tier logic
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { RATE_LIMITS, type RateTier } from '../../src/rpc/middleware/rate-limiter';

// Re-implement the pure function to test its logic
// This mirrors the implementation in rate-limiter.ts
function rateLimitToTier(limit: number): RateTier {
  return limit === 0 ? 'UNLIMITED' : limit >= 1000 ? 'PRO' : limit >= 100 ? 'BASIC' : 'FREE';
}

describe('Rate Limiter - Tier Calculation', () => {
  describe('rateLimitToTier', () => {
    test('returns UNLIMITED for limit of 0', () => {
      expect(rateLimitToTier(0)).toBe('UNLIMITED');
    });

    test('returns PRO for limit >= 1000', () => {
      expect(rateLimitToTier(1000)).toBe('PRO');
      expect(rateLimitToTier(1500)).toBe('PRO');
      expect(rateLimitToTier(10000)).toBe('PRO');
      expect(rateLimitToTier(Number.MAX_SAFE_INTEGER)).toBe('PRO');
    });

    test('returns BASIC for limit >= 100 and < 1000', () => {
      expect(rateLimitToTier(100)).toBe('BASIC');
      expect(rateLimitToTier(500)).toBe('BASIC');
      expect(rateLimitToTier(999)).toBe('BASIC');
    });

    test('returns FREE for limit < 100 (excluding 0)', () => {
      expect(rateLimitToTier(1)).toBe('FREE');
      expect(rateLimitToTier(10)).toBe('FREE');
      expect(rateLimitToTier(50)).toBe('FREE');
      expect(rateLimitToTier(99)).toBe('FREE');
    });

    test('handles boundary values correctly', () => {
      expect(rateLimitToTier(99)).toBe('FREE');
      expect(rateLimitToTier(100)).toBe('BASIC');
      expect(rateLimitToTier(999)).toBe('BASIC');
      expect(rateLimitToTier(1000)).toBe('PRO');
    });
  });

  describe('RATE_LIMITS constants', () => {
    test('FREE tier has 10 requests per minute', () => {
      expect(RATE_LIMITS.FREE).toBe(10);
    });

    test('BASIC tier has 100 requests per minute', () => {
      expect(RATE_LIMITS.BASIC).toBe(100);
    });

    test('PRO tier has 1000 requests per minute', () => {
      expect(RATE_LIMITS.PRO).toBe(1000);
    });

    test('UNLIMITED tier has 0 (unlimited) requests', () => {
      expect(RATE_LIMITS.UNLIMITED).toBe(0);
    });

    test('tiers are in ascending order', () => {
      expect(RATE_LIMITS.FREE).toBeLessThan(RATE_LIMITS.BASIC);
      expect(RATE_LIMITS.BASIC).toBeLessThan(RATE_LIMITS.PRO);
    });
  });
});

describe('Rate Limiter - Key Extraction Logic', () => {
  // Test the key generation logic without needing the actual middleware
  
  interface MockHeaders {
    'X-Api-Key'?: string;
    'X-Wallet-Address'?: string;
    'X-Forwarded-For'?: string;
    'X-Real-IP'?: string;
  }

  function getUserKeyFromHeaders(headers: MockHeaders): { key: string; address: string | null } {
    const apiKey = headers['X-Api-Key'];
    if (apiKey) {
      return { key: `key:${apiKey}`, address: null };
    }
    
    const wallet = headers['X-Wallet-Address'];
    if (wallet) {
      return { key: `addr:${wallet.toLowerCase()}`, address: wallet };
    }
    
    const ip = headers['X-Forwarded-For']?.split(',')[0]?.trim() || 
               headers['X-Real-IP'] || 
               'unknown';
    return { key: `ip:${ip}`, address: null };
  }

  test('extracts API key when X-Api-Key header is present', () => {
    const headers: MockHeaders = { 'X-Api-Key': 'test-api-key-123' };
    const result = getUserKeyFromHeaders(headers);
    
    expect(result.key).toBe('key:test-api-key-123');
    expect(result.address).toBeNull();
  });

  test('extracts wallet address when X-Wallet-Address header is present', () => {
    const headers: MockHeaders = { 'X-Wallet-Address': '0x1234567890123456789012345678901234567890' };
    const result = getUserKeyFromHeaders(headers);
    
    expect(result.key).toBe('addr:0x1234567890123456789012345678901234567890');
    expect(result.address).toBe('0x1234567890123456789012345678901234567890');
  });

  test('normalizes wallet address to lowercase', () => {
    const headers: MockHeaders = { 'X-Wallet-Address': '0xABCDEF0123456789012345678901234567890123' };
    const result = getUserKeyFromHeaders(headers);
    
    expect(result.key).toBe('addr:0xabcdef0123456789012345678901234567890123');
  });

  test('prioritizes API key over wallet address', () => {
    const headers: MockHeaders = { 
      'X-Api-Key': 'my-api-key',
      'X-Wallet-Address': '0x1234567890123456789012345678901234567890'
    };
    const result = getUserKeyFromHeaders(headers);
    
    expect(result.key).toBe('key:my-api-key');
  });

  test('extracts first IP from X-Forwarded-For header', () => {
    const headers: MockHeaders = { 'X-Forwarded-For': '192.168.1.1, 10.0.0.1, 172.16.0.1' };
    const result = getUserKeyFromHeaders(headers);
    
    expect(result.key).toBe('ip:192.168.1.1');
    expect(result.address).toBeNull();
  });

  test('trims whitespace from X-Forwarded-For header', () => {
    const headers: MockHeaders = { 'X-Forwarded-For': '  192.168.1.1  , 10.0.0.1' };
    const result = getUserKeyFromHeaders(headers);
    
    expect(result.key).toBe('ip:192.168.1.1');
  });

  test('falls back to X-Real-IP when X-Forwarded-For is not present', () => {
    const headers: MockHeaders = { 'X-Real-IP': '10.0.0.100' };
    const result = getUserKeyFromHeaders(headers);
    
    expect(result.key).toBe('ip:10.0.0.100');
  });

  test('returns unknown when no identifying headers are present', () => {
    const headers: MockHeaders = {};
    const result = getUserKeyFromHeaders(headers);
    
    expect(result.key).toBe('ip:unknown');
    expect(result.address).toBeNull();
  });

  test('prioritizes wallet over IP-based identification', () => {
    const headers: MockHeaders = { 
      'X-Wallet-Address': '0x1234567890123456789012345678901234567890',
      'X-Forwarded-For': '192.168.1.1'
    };
    const result = getUserKeyFromHeaders(headers);
    
    expect(result.key).toStartWith('addr:');
  });
});

describe('Rate Limiter - Rate Limit Response Headers', () => {
  // Test the header calculation logic
  
  function calculateHeaders(tier: RateTier, remainingPoints: number, msBeforeNext: number): {
    limit: string;
    remaining: string;
    reset: string;
    retryAfter?: string;
  } {
    const limit = RATE_LIMITS[tier];
    const remaining = limit === 0 ? -1 : remainingPoints;
    const resetAt = Date.now() + msBeforeNext;
    
    return {
      limit: limit === 0 ? 'unlimited' : String(limit),
      remaining: remaining === -1 ? 'unlimited' : String(remaining),
      reset: String(Math.ceil(resetAt / 1000)),
    };
  }

  test('returns unlimited for UNLIMITED tier', () => {
    const headers = calculateHeaders('UNLIMITED', 0, 60000);
    
    expect(headers.limit).toBe('unlimited');
    expect(headers.remaining).toBe('unlimited');
  });

  test('returns numeric values for FREE tier', () => {
    const headers = calculateHeaders('FREE', 5, 30000);
    
    expect(headers.limit).toBe('10');
    expect(headers.remaining).toBe('5');
  });

  test('returns numeric values for BASIC tier', () => {
    const headers = calculateHeaders('BASIC', 75, 45000);
    
    expect(headers.limit).toBe('100');
    expect(headers.remaining).toBe('75');
  });

  test('returns numeric values for PRO tier', () => {
    const headers = calculateHeaders('PRO', 500, 15000);
    
    expect(headers.limit).toBe('1000');
    expect(headers.remaining).toBe('500');
  });

  test('calculates reset timestamp correctly', () => {
    const now = Date.now();
    const msBeforeNext = 60000;
    const headers = calculateHeaders('FREE', 5, msBeforeNext);
    
    const resetTimestamp = parseInt(headers.reset, 10);
    const expectedReset = Math.ceil((now + msBeforeNext) / 1000);
    
    // Allow 1 second tolerance for test execution time
    expect(Math.abs(resetTimestamp - expectedReset)).toBeLessThanOrEqual(1);
  });
});
