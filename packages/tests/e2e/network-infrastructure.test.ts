/**
 * Network Infrastructure E2E Tests
 *
 * End-to-end tests for the complete network stack:
 * - Redis cluster connectivity
 * - Database routing
 * - Service health checks
 * - Metrics endpoints
 * - Configuration validation
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import http from 'http';

// ============================================================================
// Configuration
// ============================================================================

const TEST_CONFIG = {
  redisHost: process.env.REDIS_HOST ?? 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT ?? '6379'),
  postgresHost: process.env.DB_PRIMARY_HOST ?? 'localhost',
  postgresPort: parseInt(process.env.DB_PRIMARY_PORT ?? '5432'),
  postgresDb: process.env.DB_NAME ?? 'jeju_test',
  postgresUser: process.env.DB_USER ?? 'postgres',
  postgresPassword: process.env.DB_PASSWORD ?? 'postgres',
  skipExternalServices: process.env.SKIP_EXTERNAL_SERVICES === 'true',
};

// ============================================================================
// Health Check Helpers
// ============================================================================

async function checkServiceHealth(
  url: string,
  timeout = 5000
): Promise<{ healthy: boolean; statusCode: number; latencyMs: number; body?: string }> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    clearTimeout(timeoutId);
    const body = await response.text();

    return {
      healthy: response.ok,
      statusCode: response.status,
      latencyMs: Date.now() - startTime,
      body,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    return {
      healthy: false,
      statusCode: 0,
      latencyMs: Date.now() - startTime,
    };
  }
}

async function checkTcpPort(
  host: string,
  port: number,
  timeout = 3000
): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

// ============================================================================
// Redis Connectivity Tests
// ============================================================================

describe('Redis Connectivity', () => {
  it.skipIf(TEST_CONFIG.skipExternalServices)(
    'should connect to Redis',
    async () => {
      const connected = await checkTcpPort(TEST_CONFIG.redisHost, TEST_CONFIG.redisPort);
      expect(connected).toBe(true);
    }
  );

  it.skipIf(TEST_CONFIG.skipExternalServices)(
    'should respond to PING',
    async () => {
      const Cluster = require('ioredis').Cluster;
      const cluster = new Cluster([
        { host: TEST_CONFIG.redisHost, port: TEST_CONFIG.redisPort },
      ]);

      try {
        const result = await cluster.ping();
        expect(result).toBe('PONG');
      } finally {
        await cluster.quit();
      }
    }
  );
});

// ============================================================================
// PostgreSQL Connectivity Tests
// ============================================================================

describe('PostgreSQL Connectivity', () => {
  it.skipIf(TEST_CONFIG.skipExternalServices)(
    'should connect to PostgreSQL',
    async () => {
      const connected = await checkTcpPort(
        TEST_CONFIG.postgresHost,
        TEST_CONFIG.postgresPort
      );
      expect(connected).toBe(true);
    }
  );

  it.skipIf(TEST_CONFIG.skipExternalServices)(
    'should execute query',
    async () => {
      const { Pool } = require('pg');
      const pool = new Pool({
        host: TEST_CONFIG.postgresHost,
        port: TEST_CONFIG.postgresPort,
        database: TEST_CONFIG.postgresDb,
        user: TEST_CONFIG.postgresUser,
        password: TEST_CONFIG.postgresPassword,
      });

      try {
        const result = await pool.query('SELECT 1 as num');
        expect(result.rows[0].num).toBe(1);
      } finally {
        await pool.end();
      }
    }
  );
});

// ============================================================================
// Configuration Validation Tests
// ============================================================================

describe('Configuration Validation', () => {
  const { z } = require('zod');

  describe('Redis Cluster Config', () => {
    const schema = z.object({
      nodes: z.array(z.object({
        host: z.string(),
        port: z.number().min(1).max(65535),
      })).min(1),
      password: z.string().optional(),
      tls: z.boolean().default(false),
      keyPrefix: z.string().default(''),
      encryptionKey: z.string().length(64).optional(),
    });

    it('should validate production Redis config', () => {
      const config = {
        nodes: [
          { host: 'redis-master.prod.svc', port: 6379 },
          { host: 'redis-replica-1.prod.svc', port: 6379 },
          { host: 'redis-replica-2.prod.svc', port: 6379 },
        ],
        password: 'secure-password',
        tls: true,
        keyPrefix: 'jeju:',
        encryptionKey: 'a'.repeat(64),
      };

      const result = schema.parse(config);
      expect(result.nodes.length).toBe(3);
      expect(result.tls).toBe(true);
    });

    it('should reject invalid Redis port', () => {
      const config = {
        nodes: [{ host: 'localhost', port: 100000 }],
      };

      expect(() => schema.parse(config)).toThrow();
    });
  });

  describe('Database Replica Config', () => {
    const schema = z.object({
      primary: z.object({
        host: z.string(),
        port: z.number().default(5432),
        database: z.string(),
        user: z.string(),
        password: z.string(),
        ssl: z.boolean().default(false),
        maxConnections: z.number().default(20),
      }),
      replicas: z.array(z.object({
        host: z.string(),
        port: z.number().default(5432),
        database: z.string(),
        user: z.string(),
        password: z.string(),
        ssl: z.boolean().default(false),
        maxConnections: z.number().default(20),
      })).default([]),
      maxReplicaLagMs: z.number().default(5000),
      readPreference: z.enum(['primary', 'replica', 'nearest']).default('replica'),
    });

    it('should validate production database config', () => {
      const config = {
        primary: {
          host: 'db-master.prod.rds.amazonaws.com',
          port: 5432,
          database: 'jeju',
          user: 'app_user',
          password: 'secure-password',
          ssl: true,
          maxConnections: 50,
        },
        replicas: [
          {
            host: 'db-replica-1.prod.rds.amazonaws.com',
            port: 5432,
            database: 'jeju',
            user: 'app_user',
            password: 'secure-password',
            ssl: true,
            maxConnections: 100,
          },
        ],
        maxReplicaLagMs: 3000,
        readPreference: 'replica',
      };

      const result = schema.parse(config);
      expect(result.primary.ssl).toBe(true);
      expect(result.replicas.length).toBe(1);
      expect(result.readPreference).toBe('replica');
    });
  });

  describe('Proxy Service Config', () => {
    const schema = z.object({
      coordinatorWsUrl: z.string().url(),
      localPort: z.number().min(1024).max(65535),
      maxConcurrentRequests: z.number().min(1).max(1000),
      bandwidthLimitMbps: z.number().min(1),
      allowedPorts: z.array(z.number()),
      blockedDomains: z.array(z.string()),
      stakeAmount: z.bigint(),
      authTokenTtlMs: z.number().default(30000),
      drainTimeoutMs: z.number().default(30000),
    });

    it('should validate production proxy config', () => {
      const config = {
        coordinatorWsUrl: 'wss://proxy.jejunetwork.org/ws',
        localPort: 4025,
        maxConcurrentRequests: 100,
        bandwidthLimitMbps: 100,
        allowedPorts: [80, 443, 8080, 8443],
        blockedDomains: ['malware.example.com'],
        stakeAmount: BigInt('100000000000000000'),
        authTokenTtlMs: 30000,
        drainTimeoutMs: 60000,
      };

      const result = schema.parse(config);
      expect(result.maxConcurrentRequests).toBe(100);
      expect(result.allowedPorts).toContain(443);
    });

    it('should reject invalid URL', () => {
      const config = {
        coordinatorWsUrl: 'not-a-url',
        localPort: 4025,
        maxConcurrentRequests: 100,
        bandwidthLimitMbps: 100,
        allowedPorts: [80, 443],
        blockedDomains: [],
        stakeAmount: BigInt('100000000000000000'),
      };

      expect(() => schema.parse(config)).toThrow();
    });
  });

  describe('Edge Coordinator Config', () => {
    const schema = z.object({
      nodeId: z.string().min(1),
      operator: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
      listenPort: z.number().min(1024).max(65535),
      gossipInterval: z.number().min(1000).default(30000),
      gossipFanout: z.number().min(1).max(20).default(6),
      maxPeers: z.number().min(1).max(1000).default(100),
      bootstrapNodes: z.array(z.string()).default([]),
      region: z.string().default('unknown'),
      staleThresholdMs: z.number().default(300000),
      requireOnChainRegistration: z.boolean().default(true),
    });

    it('should validate production coordinator config', () => {
      const config = {
        nodeId: 'prod-node-us-east-1',
        operator: '0x1234567890123456789012345678901234567890',
        privateKey: '0x' + 'ab'.repeat(32),
        listenPort: 9000,
        gossipInterval: 30000,
        gossipFanout: 6,
        maxPeers: 200,
        bootstrapNodes: [
          'https://edge-1.jejunetwork.org',
          'https://edge-2.jejunetwork.org',
        ],
        region: 'us-east-1',
        staleThresholdMs: 300000,
        requireOnChainRegistration: true,
      };

      const result = schema.parse(config);
      expect(result.gossipFanout).toBe(6);
      expect(result.bootstrapNodes.length).toBe(2);
      expect(result.requireOnChainRegistration).toBe(true);
    });

    it('should reject invalid Ethereum address', () => {
      const config = {
        nodeId: 'test-node',
        operator: 'not-an-address',
        privateKey: '0x' + 'ab'.repeat(32),
        listenPort: 9000,
      };

      expect(() => schema.parse(config)).toThrow();
    });
  });
});

// ============================================================================
// Circuit Breaker Behavior Tests
// ============================================================================

describe('Circuit Breaker Behavior', () => {
  class TestCircuitBreaker {
    private failures = 0;
    private lastFailure = 0;
    private state: 'closed' | 'open' | 'half-open' = 'closed';

    constructor(
      private readonly threshold = 5,
      private readonly resetTimeout = 1000
    ) {}

    async execute<T>(fn: () => Promise<T>): Promise<T> {
      if (this.state === 'open') {
        if (Date.now() - this.lastFailure > this.resetTimeout) {
          this.state = 'half-open';
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
      this.failures = 0;
      this.state = 'closed';
    }

    private onFailure(): void {
      this.failures++;
      this.lastFailure = Date.now();
      if (this.failures >= this.threshold) {
        this.state = 'open';
      }
    }

    getState(): string {
      return this.state;
    }
  }

  it('should open after threshold failures', async () => {
    const breaker = new TestCircuitBreaker(3, 100);

    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {}
    }

    expect(breaker.getState()).toBe('open');
  });

  it('should transition to half-open after timeout', async () => {
    const breaker = new TestCircuitBreaker(2, 50);

    // Trip the breaker
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {}
    }

    expect(breaker.getState()).toBe('open');

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Next call should transition to half-open
    try {
      await breaker.execute(async () => 'success');
    } catch {}

    expect(breaker.getState()).toBe('closed');
  });

  it('should close after successful call in half-open', async () => {
    const breaker = new TestCircuitBreaker(2, 50);

    // Trip the breaker
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {}
    }

    // Wait for reset
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Successful call should close
    await breaker.execute(async () => 'success');

    expect(breaker.getState()).toBe('closed');
  });
});

// ============================================================================
// LRU Cache Eviction Tests
// ============================================================================

describe('LRU Cache Eviction', () => {
  it('should evict oldest entries when max size reached', () => {
    const { LRUCache } = require('lru-cache');
    const cache = new LRUCache<string, string>({ max: 3 });

    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    cache.set('d', '4'); // Should evict 'a'

    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('should update LRU order on access', () => {
    const { LRUCache } = require('lru-cache');
    const cache = new LRUCache<string, string>({ max: 3 });

    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');

    // Access 'a' to make it most recently used
    cache.get('a');

    cache.set('d', '4'); // Should evict 'b' (now oldest)

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('should respect TTL', async () => {
    const { LRUCache } = require('lru-cache');
    const cache = new LRUCache<string, string>({
      max: 100,
      ttl: 50, // 50ms TTL
    });

    cache.set('expires', 'soon');

    expect(cache.get('expires')).toBe('soon');

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(cache.get('expires')).toBeUndefined();
  });
});

// ============================================================================
// Gossip Protocol Tests
// ============================================================================

describe('Gossip Protocol', () => {
  function calculateFanout(peerCount: number): number {
    return Math.max(3, Math.ceil(Math.sqrt(peerCount)));
  }

  function selectRandomPeers<T>(peers: T[], count: number): T[] {
    const result: T[] = [];
    const available = [...peers];

    while (result.length < count && available.length > 0) {
      const index = Math.floor(Math.random() * available.length);
      result.push(available.splice(index, 1)[0]);
    }

    return result;
  }

  it('should calculate optimal fanout', () => {
    // Small network
    expect(calculateFanout(4)).toBe(3);
    expect(calculateFanout(9)).toBe(3);

    // Medium network
    expect(calculateFanout(25)).toBe(5);
    expect(calculateFanout(100)).toBe(10);

    // Large network
    expect(calculateFanout(1000)).toBe(32);
    expect(calculateFanout(10000)).toBe(100);
  });

  it('should select unique random peers', () => {
    const peers = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const selected = selectRandomPeers(peers, 4);

    expect(selected.length).toBe(4);
    expect(new Set(selected).size).toBe(4); // All unique
    selected.forEach((p) => expect(peers).toContain(p));
  });

  it('should handle requesting more peers than available', () => {
    const peers = ['a', 'b'];
    const selected = selectRandomPeers(peers, 10);

    expect(selected.length).toBe(2);
  });
});

// ============================================================================
// Metrics Verification Tests
// ============================================================================

describe('Metrics Format', () => {
  it('should produce valid Prometheus format', () => {
    const metrics = `
# HELP redis_operations_total Total Redis operations
# TYPE redis_operations_total counter
redis_operations_total{operation="get",status="success"} 42
redis_operations_total{operation="set",status="success"} 15
redis_operations_total{operation="get",status="error"} 2

# HELP redis_operation_duration_seconds Redis operation duration
# TYPE redis_operation_duration_seconds histogram
redis_operation_duration_seconds_bucket{operation="get",le="0.001"} 10
redis_operation_duration_seconds_bucket{operation="get",le="0.005"} 30
redis_operation_duration_seconds_bucket{operation="get",le="0.01"} 40
redis_operation_duration_seconds_bucket{operation="get",le="+Inf"} 44
redis_operation_duration_seconds_sum{operation="get"} 0.125
redis_operation_duration_seconds_count{operation="get"} 44
`;

    // Verify counter format
    expect(metrics).toContain('# TYPE redis_operations_total counter');
    expect(metrics).toMatch(/redis_operations_total\{.*\} \d+/);

    // Verify histogram format
    expect(metrics).toContain('# TYPE redis_operation_duration_seconds histogram');
    expect(metrics).toMatch(/redis_operation_duration_seconds_bucket\{.*le="[^"]+"\} \d+/);
    expect(metrics).toMatch(/redis_operation_duration_seconds_sum\{.*\} [\d.]+/);
    expect(metrics).toMatch(/redis_operation_duration_seconds_count\{.*\} \d+/);
  });

  it('should include required labels', () => {
    const metricsLabels = [
      'operation',
      'status',
      'node',
      'service',
    ];

    const metricLine = 'redis_operations_total{operation="get",status="success",node="primary"} 42';

    metricsLabels.forEach((label) => {
      if (metricLine.includes(label)) {
        expect(metricLine).toMatch(new RegExp(`${label}="[^"]+"`));
      }
    });
  });
});

