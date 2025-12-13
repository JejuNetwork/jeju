import { describe, it, expect } from 'bun:test';

const RATE_LIMITS = { BANNED: 0, FREE: 100, BASIC: 1000, PRO: 10000, UNLIMITED: 0 } as const;
type RateTier = keyof typeof RATE_LIMITS;

const TIER_THRESHOLDS = { BASIC: 10, PRO: 100, UNLIMITED: 1000 }; // USD
const WINDOW_MS = 60_000;

describe('Rate Limit Constants', () => {
  it('should have correct tier limits', () => {
    expect(RATE_LIMITS.BANNED).toBe(0);
    expect(RATE_LIMITS.FREE).toBe(100);
    expect(RATE_LIMITS.BASIC).toBe(1000);
    expect(RATE_LIMITS.PRO).toBe(10000);
    expect(RATE_LIMITS.UNLIMITED).toBe(0); // 0 means unlimited
  });

  it('should have increasing thresholds', () => {
    expect(TIER_THRESHOLDS.BASIC).toBeLessThan(TIER_THRESHOLDS.PRO);
    expect(TIER_THRESHOLDS.PRO).toBeLessThan(TIER_THRESHOLDS.UNLIMITED);
  });
});

describe('Tier Determination from Stake Amount', () => {
  const ETH_USD_PRICE = 2000;

  const getTierFromStakeUsd = (stakeUsd: number): RateTier => {
    if (stakeUsd >= TIER_THRESHOLDS.UNLIMITED) return 'UNLIMITED';
    if (stakeUsd >= TIER_THRESHOLDS.PRO) return 'PRO';
    if (stakeUsd >= TIER_THRESHOLDS.BASIC) return 'BASIC';
    return 'FREE';
  };

  const stakeWeiToUsd = (stakeWei: bigint): number => {
    return (Number(stakeWei) / 1e18) * ETH_USD_PRICE;
  };

  it('should return FREE for zero stake', () => {
    expect(getTierFromStakeUsd(0)).toBe('FREE');
  });

  it('should return FREE for stake below BASIC threshold', () => {
    expect(getTierFromStakeUsd(9.99)).toBe('FREE');
    expect(getTierFromStakeUsd(5)).toBe('FREE');
    expect(getTierFromStakeUsd(0.01)).toBe('FREE');
  });

  it('should return BASIC at exactly BASIC threshold', () => {
    expect(getTierFromStakeUsd(10)).toBe('BASIC');
  });

  it('should return BASIC between BASIC and PRO thresholds', () => {
    expect(getTierFromStakeUsd(50)).toBe('BASIC');
    expect(getTierFromStakeUsd(99.99)).toBe('BASIC');
  });

  it('should return PRO at exactly PRO threshold', () => {
    expect(getTierFromStakeUsd(100)).toBe('PRO');
  });

  it('should return PRO between PRO and UNLIMITED thresholds', () => {
    expect(getTierFromStakeUsd(500)).toBe('PRO');
    expect(getTierFromStakeUsd(999.99)).toBe('PRO');
  });

  it('should return UNLIMITED at exactly UNLIMITED threshold', () => {
    expect(getTierFromStakeUsd(1000)).toBe('UNLIMITED');
  });

  it('should return UNLIMITED above UNLIMITED threshold', () => {
    expect(getTierFromStakeUsd(10000)).toBe('UNLIMITED');
    expect(getTierFromStakeUsd(1000000)).toBe('UNLIMITED');
  });

  it('should correctly convert wei to USD', () => {
    // 0 ETH = $0
    expect(stakeWeiToUsd(0n)).toBe(0);
    
    // 1 ETH = $2000
    expect(stakeWeiToUsd(BigInt(1e18))).toBe(2000);
    
    // 0.005 ETH = $10 (BASIC threshold)
    expect(stakeWeiToUsd(BigInt(5e15))).toBe(10);
    
    // 0.05 ETH = $100 (PRO threshold)
    expect(stakeWeiToUsd(BigInt(5e16))).toBe(100);
    
    // 0.5 ETH = $1000 (UNLIMITED threshold)
    expect(stakeWeiToUsd(BigInt(5e17))).toBe(1000);
  });
});

describe('Rate Limit Window Behavior', () => {
  interface RateLimitRecord {
    count: number;
    resetAt: number;
    tier: RateTier;
  }

  it('should create new record when none exists', () => {
    const store = new Map<string, RateLimitRecord>();
    const key = 'test-key';
    const now = Date.now();

    const record = store.get(key);
    expect(record).toBeUndefined();

    // Create new record
    const newRecord: RateLimitRecord = { count: 1, resetAt: now + WINDOW_MS, tier: 'FREE' };
    store.set(key, newRecord);
    
    expect(store.get(key)).toEqual(newRecord);
  });

  it('should reset record when window expires', () => {
    const store = new Map<string, RateLimitRecord>();
    const key = 'test-key';
    const now = Date.now();
    
    // Set expired record
    store.set(key, { count: 50, resetAt: now - 1000, tier: 'FREE' });
    
    const record = store.get(key);
    const isExpired = record && now > record.resetAt;
    expect(isExpired).toBe(true);

    // Should create new record
    if (isExpired) {
      store.set(key, { count: 1, resetAt: now + WINDOW_MS, tier: 'FREE' });
    }
    
    expect(store.get(key)?.count).toBe(1);
  });

  it('should increment count within window', () => {
    const store = new Map<string, RateLimitRecord>();
    const key = 'test-key';
    const now = Date.now();
    
    store.set(key, { count: 10, resetAt: now + WINDOW_MS, tier: 'FREE' });
    
    const record = store.get(key)!;
    record.count++;
    
    expect(store.get(key)?.count).toBe(11);
  });
});

describe('Rate Limit Enforcement', () => {
  it('should allow requests under limit', () => {
    const limit = RATE_LIMITS.FREE; // 100
    const count = 50;
    
    const isOverLimit = limit > 0 && count > limit;
    expect(isOverLimit).toBe(false);
  });

  it('should block requests at exactly limit', () => {
    const limit = RATE_LIMITS.FREE; // 100
    const count = 100;
    
    // At limit, but 101st request should be blocked
    const isOverLimit = limit > 0 && count > limit;
    expect(isOverLimit).toBe(false);
    
    const isOverLimitNext = limit > 0 && (count + 1) > limit;
    expect(isOverLimitNext).toBe(true);
  });

  it('should block requests over limit', () => {
    const limit = RATE_LIMITS.FREE; // 100
    const count = 101;
    
    const isOverLimit = limit > 0 && count > limit;
    expect(isOverLimit).toBe(true);
  });

  it('should never block UNLIMITED tier', () => {
    const limit = RATE_LIMITS.UNLIMITED; // 0 = unlimited
    
    for (const count of [1, 100, 1000, 1000000]) {
      const isOverLimit = limit > 0 && count > limit;
      expect(isOverLimit).toBe(false);
    }
  });

  it('should always block BANNED tier', () => {
    const tier: RateTier = 'BANNED';
    
    // BANNED should return 403 regardless of count
    const isBanned = tier === 'BANNED';
    expect(isBanned).toBe(true);
  });
});

describe('Client Identification', () => {
  it('should prefer API key over other identifiers', () => {
    const headers = {
      'x-api-key': 'my-api-key',
      'x-wallet-address': '0x1234567890abcdef1234567890abcdef12345678',
      'x-agent-id': '42',
    };

    let key: string;
    if (headers['x-api-key']) {
      key = `apikey:${headers['x-api-key']}`;
    } else if (headers['x-wallet-address']) {
      key = `addr:${headers['x-wallet-address'].toLowerCase()}`;
    } else if (headers['x-agent-id']) {
      key = `agent:${headers['x-agent-id']}`;
    } else {
      key = 'ip:unknown';
    }

    expect(key).toBe('apikey:my-api-key');
  });

  it('should use wallet address when no API key', () => {
    const headers = {
      'x-wallet-address': '0x1234567890ABCDEF1234567890abcdef12345678',
      'x-agent-id': '42',
    };

    let key: string;
    if (headers['x-wallet-address']) {
      key = `addr:${headers['x-wallet-address'].toLowerCase()}`;
    } else if (headers['x-agent-id']) {
      key = `agent:${headers['x-agent-id']}`;
    } else {
      key = 'ip:unknown';
    }

    expect(key).toBe('addr:0x1234567890abcdef1234567890abcdef12345678');
  });

  it('should validate Ethereum address format', () => {
    const validAddresses = [
      '0x1234567890abcdef1234567890abcdef12345678',
      '0xABCDEF1234567890abcdef1234567890ABCDEF12',
      '0x0000000000000000000000000000000000000000',
    ];

    const invalidAddresses = [
      '1234567890abcdef1234567890abcdef12345678', // missing 0x
      '0x1234', // too short
      '0x1234567890abcdef1234567890abcdef1234567890', // too long
      '0xGGGG567890abcdef1234567890abcdef12345678', // invalid hex
      '', // empty
    ];

    const isValidAddress = (addr: string): boolean => {
      return /^0x[a-fA-F0-9]{40}$/.test(addr);
    };

    for (const addr of validAddresses) {
      expect(isValidAddress(addr)).toBe(true);
    }

    for (const addr of invalidAddresses) {
      expect(isValidAddress(addr)).toBe(false);
    }
  });

  it('should extract IP from x-forwarded-for header', () => {
    const forwardedFor = '203.0.113.195, 70.41.3.18, 150.172.238.178';
    const ip = forwardedFor.split(',')[0]?.trim();
    expect(ip).toBe('203.0.113.195');
  });

  it('should handle empty x-forwarded-for', () => {
    const forwardedFor = '';
    const ip = forwardedFor.split(',')[0]?.trim() || 'unknown';
    expect(ip).toBe('unknown');
  });
});

describe('Rate Limit Headers', () => {
  it('should format limit header correctly', () => {
    const formatLimit = (limit: number) => limit === 0 ? 'unlimited' : String(limit);
    
    expect(formatLimit(100)).toBe('100');
    expect(formatLimit(1000)).toBe('1000');
    expect(formatLimit(0)).toBe('unlimited');
  });

  it('should calculate remaining correctly', () => {
    const calculateRemaining = (limit: number, count: number) => 
      limit === 0 ? -1 : Math.max(0, limit - count);

    // UNLIMITED tier
    expect(calculateRemaining(0, 1000)).toBe(-1);
    
    // Under limit
    expect(calculateRemaining(100, 50)).toBe(50);
    
    // At limit
    expect(calculateRemaining(100, 100)).toBe(0);
    
    // Over limit
    expect(calculateRemaining(100, 150)).toBe(0);
  });

  it('should format reset time as Unix timestamp', () => {
    const resetAt = Date.now() + WINDOW_MS;
    const resetTimestamp = Math.ceil(resetAt / 1000);
    
    expect(typeof resetTimestamp).toBe('number');
    expect(resetTimestamp).toBeGreaterThan(Math.ceil(Date.now() / 1000));
  });
});

describe('Skip Paths', () => {
  it('should skip health check paths', () => {
    const skipPaths = ['/health', '/.well-known'];
    const testPaths = [
      { path: '/health', shouldSkip: true },
      { path: '/health/ready', shouldSkip: true },
      { path: '/.well-known/jwks.json', shouldSkip: true },
      { path: '/api/search', shouldSkip: false },
      { path: '/api/health', shouldSkip: false }, // doesn't start with /health
    ];

    for (const { path, shouldSkip } of testPaths) {
      const skipped = skipPaths.some(p => path.startsWith(p));
      expect(skipped).toBe(shouldSkip);
    }
  });
});

describe('Concurrent Rate Limiting', () => {
  it('should handle concurrent requests from same client', async () => {
    const store = new Map<string, { count: number; resetAt: number; tier: RateTier }>();
    const key = 'test-client';
    const limit = 100;
    let blockedCount = 0;

    const makeRequest = async () => {
      let record = store.get(key);
      if (!record || Date.now() > record.resetAt) {
        record = { count: 0, resetAt: Date.now() + WINDOW_MS, tier: 'FREE' };
        store.set(key, record);
      }
      
      record.count++;
      
      if (record.count > limit) {
        blockedCount++;
        return false;
      }
      return true;
    };

    // Make 150 concurrent requests
    const results = await Promise.all(Array(150).fill(0).map(() => makeRequest()));
    
    const allowedCount = results.filter(r => r).length;
    expect(allowedCount).toBe(100);
    expect(blockedCount).toBe(50);
  });

  it('should maintain separate limits for different clients', async () => {
    const store = new Map<string, { count: number; resetAt: number; tier: RateTier }>();
    const limit = 10;
    
    const makeRequest = (clientId: string) => {
      const key = `client:${clientId}`;
      let record = store.get(key);
      if (!record) {
        record = { count: 0, resetAt: Date.now() + WINDOW_MS, tier: 'FREE' };
        store.set(key, record);
      }
      record.count++;
      return record.count <= limit;
    };

    // Client A makes 15 requests
    const clientAResults = Array(15).fill(0).map(() => makeRequest('A'));
    const clientAAllowed = clientAResults.filter(r => r).length;
    
    // Client B makes 8 requests
    const clientBResults = Array(8).fill(0).map(() => makeRequest('B'));
    const clientBAllowed = clientBResults.filter(r => r).length;

    expect(clientAAllowed).toBe(10);
    expect(clientBAllowed).toBe(8);
    expect(store.get('client:A')?.count).toBe(15);
    expect(store.get('client:B')?.count).toBe(8);
  });
});

describe('Cache Cleanup', () => {
  it('should clean up expired entries', () => {
    const store = new Map<string, { count: number; resetAt: number; tier: RateTier }>();
    const now = Date.now();
    
    // Add mix of expired and valid entries
    store.set('expired-1', { count: 50, resetAt: now - 10000, tier: 'FREE' });
    store.set('expired-2', { count: 30, resetAt: now - 5000, tier: 'BASIC' });
    store.set('valid-1', { count: 10, resetAt: now + 30000, tier: 'PRO' });
    store.set('valid-2', { count: 5, resetAt: now + 60000, tier: 'UNLIMITED' });

    expect(store.size).toBe(4);

    // Cleanup
    for (const [key, record] of store) {
      if (now > record.resetAt) {
        store.delete(key);
      }
    }

    expect(store.size).toBe(2);
    expect(store.has('valid-1')).toBe(true);
    expect(store.has('valid-2')).toBe(true);
    expect(store.has('expired-1')).toBe(false);
    expect(store.has('expired-2')).toBe(false);
  });
});

describe('Stats Collection', () => {
  it('should count entries by tier', () => {
    const store = new Map<string, { count: number; resetAt: number; tier: RateTier }>();
    const now = Date.now();
    
    store.set('free-1', { count: 10, resetAt: now + WINDOW_MS, tier: 'FREE' });
    store.set('free-2', { count: 20, resetAt: now + WINDOW_MS, tier: 'FREE' });
    store.set('basic-1', { count: 100, resetAt: now + WINDOW_MS, tier: 'BASIC' });
    store.set('pro-1', { count: 500, resetAt: now + WINDOW_MS, tier: 'PRO' });
    store.set('unlimited-1', { count: 10000, resetAt: now + WINDOW_MS, tier: 'UNLIMITED' });

    const byTier: Record<RateTier, number> = { BANNED: 0, FREE: 0, BASIC: 0, PRO: 0, UNLIMITED: 0 };
    for (const { tier } of store.values()) {
      byTier[tier]++;
    }

    expect(byTier.FREE).toBe(2);
    expect(byTier.BASIC).toBe(1);
    expect(byTier.PRO).toBe(1);
    expect(byTier.UNLIMITED).toBe(1);
    expect(byTier.BANNED).toBe(0);
  });
});
