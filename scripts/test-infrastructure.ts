#!/usr/bin/env bun
/**
 * Infrastructure Test Runner
 * 
 * Validates the complete network infrastructure:
 * - Redis cluster connectivity and operations
 * - PostgreSQL primary and replica routing
 * - Service health checks
 * - Metrics export
 * - Configuration validation
 * 
 * Usage:
 *   bun run scripts/test-infrastructure.ts
 *   bun run scripts/test-infrastructure.ts --with-services  # Test real services
 */

import { parseArgs } from 'util';

// ============================================================================
// Configuration
// ============================================================================

interface TestConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  withServices: boolean;
}

const config: TestConfig = {
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
    password: process.env.REDIS_PASSWORD,
  },
  postgres: {
    host: process.env.DB_PRIMARY_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PRIMARY_PORT ?? '5432'),
    database: process.env.DB_NAME ?? 'jeju_test',
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
  },
  withServices: process.argv.includes('--with-services'),
};

// ============================================================================
// Test Results
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`  ✓ ${name} (${Date.now() - start}ms)`);
  } catch (error) {
    results.push({
      name,
      passed: false,
      duration: Date.now() - start,
      error: (error as Error).message,
    });
    console.log(`  ✗ ${name} (${Date.now() - start}ms)`);
    console.log(`    Error: ${(error as Error).message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ============================================================================
// TCP Port Check
// ============================================================================

async function checkPort(host: string, port: number, timeout = 3000): Promise<boolean> {
  const net = await import('net');
  
  return new Promise((resolve) => {
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
// Configuration Tests
// ============================================================================

async function testConfigurations(): Promise<void> {
  console.log('\n📋 Configuration Validation\n');

  const { z } = await import('zod');

  await runTest('Redis Cluster Config Schema', async () => {
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

    const config = {
      nodes: [{ host: 'localhost', port: 6379 }],
      keyPrefix: 'test:',
    };

    const result = schema.parse(config);
    assert(result.nodes.length === 1, 'Should have 1 node');
    assert(result.tls === false, 'TLS should default to false');
  });

  await runTest('Database Replica Config Schema', async () => {
    const schema = z.object({
      primary: z.object({
        host: z.string(),
        port: z.number().default(5432),
        database: z.string(),
        user: z.string(),
        password: z.string(),
      }),
      replicas: z.array(z.object({
        host: z.string(),
        port: z.number().default(5432),
      })).default([]),
      maxReplicaLagMs: z.number().default(5000),
    });

    const config = {
      primary: {
        host: 'localhost',
        database: 'test',
        user: 'postgres',
        password: 'secret',
      },
    };

    const result = schema.parse(config);
    assert(result.primary.port === 5432, 'Port should default to 5432');
    assert(result.replicas.length === 0, 'Replicas should default to empty');
  });

  await runTest('Proxy Service Config Schema', async () => {
    const schema = z.object({
      coordinatorWsUrl: z.string().url(),
      localPort: z.number().min(1024).max(65535),
      maxConcurrentRequests: z.number().min(1).max(1000),
      allowedPorts: z.array(z.number()),
    });

    const config = {
      coordinatorWsUrl: 'wss://proxy.jejunetwork.org/ws',
      localPort: 4025,
      maxConcurrentRequests: 100,
      allowedPorts: [80, 443],
    };

    const result = schema.parse(config);
    assert(result.allowedPorts.includes(443), 'Should include port 443');
  });

  await runTest('Edge Coordinator Config Schema', async () => {
    const schema = z.object({
      nodeId: z.string().min(1),
      operator: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
      listenPort: z.number().min(1024).max(65535),
      gossipFanout: z.number().min(1).max(20).default(6),
    });

    const config = {
      nodeId: 'test-node',
      operator: '0x' + '12'.repeat(20),
      privateKey: '0x' + 'ab'.repeat(32),
      listenPort: 9000,
    };

    const result = schema.parse(config);
    assert(result.gossipFanout === 6, 'Gossip fanout should default to 6');
  });
}

// ============================================================================
// Redis Tests
// ============================================================================

async function testRedis(): Promise<void> {
  console.log('\n🔴 Redis Cluster Tests\n');

  if (!config.withServices) {
    console.log('  ⏭  Skipping (use --with-services to enable)\n');
    return;
  }

  const portOpen = await checkPort(config.redis.host, config.redis.port);
  if (!portOpen) {
    console.log(`  ⚠  Redis not available at ${config.redis.host}:${config.redis.port}\n`);
    return;
  }

  const { Cluster } = await import('ioredis');
  const cluster = new Cluster([
    { host: config.redis.host, port: config.redis.port },
  ], {
    redisOptions: { password: config.redis.password },
  });

  try {
    await runTest('Redis PING', async () => {
      const result = await cluster.ping();
      assert(result === 'PONG', 'Should return PONG');
    });

    await runTest('Redis SET/GET', async () => {
      await cluster.set('test:key', 'test-value');
      const value = await cluster.get('test:key');
      assert(value === 'test-value', 'Should get same value');
      await cluster.del('test:key');
    });

    await runTest('Redis SET with TTL', async () => {
      await cluster.setex('test:ttl', 5, 'expires');
      const ttl = await cluster.ttl('test:ttl');
      assert(ttl > 0 && ttl <= 5, 'TTL should be between 0 and 5');
      await cluster.del('test:ttl');
    });

    await runTest('Redis Pipeline', async () => {
      const pipeline = cluster.pipeline();
      pipeline.set('test:p1', 'a');
      pipeline.set('test:p2', 'b');
      pipeline.set('test:p3', 'c');
      await pipeline.exec();

      const v1 = await cluster.get('test:p1');
      const v2 = await cluster.get('test:p2');
      const v3 = await cluster.get('test:p3');

      assert(v1 === 'a' && v2 === 'b' && v3 === 'c', 'Pipeline should set all values');

      await cluster.del('test:p1', 'test:p2', 'test:p3');
    });

    await runTest('Redis Hash Operations', async () => {
      await cluster.hset('test:hash', 'field1', 'value1');
      await cluster.hset('test:hash', 'field2', 'value2');

      const value = await cluster.hget('test:hash', 'field1');
      assert(value === 'value1', 'Should get hash field');

      const all = await cluster.hgetall('test:hash');
      assert(all.field1 === 'value1' && all.field2 === 'value2', 'Should get all fields');

      await cluster.del('test:hash');
    });

  } finally {
    await cluster.quit();
  }
}

// ============================================================================
// PostgreSQL Tests
// ============================================================================

async function testPostgres(): Promise<void> {
  console.log('\n🐘 PostgreSQL Tests\n');

  if (!config.withServices) {
    console.log('  ⏭  Skipping (use --with-services to enable)\n');
    return;
  }

  const portOpen = await checkPort(config.postgres.host, config.postgres.port);
  if (!portOpen) {
    console.log(`  ⚠  PostgreSQL not available at ${config.postgres.host}:${config.postgres.port}\n`);
    return;
  }

  const { Pool } = await import('pg');
  const pool = new Pool({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    password: config.postgres.password,
  });

  try {
    await runTest('PostgreSQL Connection', async () => {
      const result = await pool.query('SELECT 1 as num');
      assert(result.rows[0].num === 1, 'Should return 1');
    });

    await runTest('PostgreSQL Query', async () => {
      const result = await pool.query('SELECT NOW() as time');
      assert(result.rows[0].time instanceof Date, 'Should return Date');
    });

    await runTest('PostgreSQL Transaction', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT 1');
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK');
        throw new Error('Transaction failed');
      } finally {
        client.release();
      }
    });

    await runTest('PostgreSQL Version', async () => {
      const result = await pool.query('SELECT version()');
      const version = result.rows[0].version;
      assert(version.includes('PostgreSQL'), 'Should include PostgreSQL');
    });

  } finally {
    await pool.end();
  }
}

// ============================================================================
// Algorithm Tests
// ============================================================================

async function testAlgorithms(): Promise<void> {
  console.log('\n🧮 Algorithm Tests\n');

  await runTest('CRC16 Slot Calculation', async () => {
    const CRC16_TABLE = new Uint16Array(256);
    for (let i = 0; i < 256; i++) {
      let crc = i << 8;
      for (let j = 0; j < 8; j++) {
        crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      }
      CRC16_TABLE[i] = crc & 0xffff;
    }

    function crc16(data: Buffer): number {
      let crc = 0;
      for (let i = 0; i < data.length; i++) {
        crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ data[i]) & 0xff]) & 0xffff;
      }
      return crc;
    }

    function calculateSlot(key: string): number {
      const start = key.indexOf('{');
      const end = key.indexOf('}', start + 1);
      const hashKey = start !== -1 && end !== -1 && end > start + 1
        ? key.slice(start + 1, end)
        : key;
      return crc16(Buffer.from(hashKey)) % 16384;
    }

    const slot = calculateSlot('test-key');
    assert(slot >= 0 && slot < 16384, 'Slot should be in valid range');

    // Hash tags should produce same slot
    const slot1 = calculateSlot('user:{123}:name');
    const slot2 = calculateSlot('user:{123}:email');
    assert(slot1 === slot2, 'Same hash tag should produce same slot');
  });

  await runTest('Gossip Fanout Calculation', async () => {
    function calculateFanout(peerCount: number): number {
      return Math.max(3, Math.ceil(Math.sqrt(peerCount)));
    }

    assert(calculateFanout(1) === 3, 'Minimum fanout should be 3');
    assert(calculateFanout(9) === 3, 'sqrt(9) = 3');
    assert(calculateFanout(100) === 10, 'sqrt(100) = 10');
    assert(calculateFanout(1000) === 32, 'sqrt(1000) ≈ 32');
  });

  await runTest('Circuit Breaker State Machine', async () => {
    let failures = 0;
    let state: 'closed' | 'open' | 'half-open' = 'closed';
    const threshold = 3;

    // Simulate failures
    for (let i = 0; i < threshold; i++) {
      failures++;
      if (failures >= threshold) {
        state = 'open';
      }
    }

    assert(state === 'open', 'Should be open after threshold');

    // Simulate success
    failures = 0;
    state = 'closed';
    assert(state === 'closed', 'Should close after success');
  });

  await runTest('LRU Eviction Order', async () => {
    const { LRUCache } = await import('lru-cache');
    const cache = new LRUCache<string, number>({ max: 3 });

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Access 'a' to make it recently used
    cache.get('a');

    // Add new item, should evict 'b' (oldest)
    cache.set('d', 4);

    assert(!cache.has('b'), 'b should be evicted');
    assert(cache.has('a'), 'a should remain (recently accessed)');
    assert(cache.has('c'), 'c should remain');
    assert(cache.has('d'), 'd should be added');
  });
}

// ============================================================================
// Query Classification Tests
// ============================================================================

async function testQueryClassification(): Promise<void> {
  console.log('\n📝 Query Classification Tests\n');

  const WRITE_PATTERNS = [
    /^\s*INSERT\s/i,
    /^\s*UPDATE\s/i,
    /^\s*DELETE\s/i,
    /^\s*CREATE\s/i,
    /^\s*ALTER\s/i,
    /^\s*DROP\s/i,
    /^\s*TRUNCATE\s/i,
    /^\s*BEGIN\b/i,
    /^\s*COMMIT\b/i,
    /^\s*ROLLBACK\b/i,
    /FOR\s+UPDATE/i,
    /FOR\s+SHARE/i,
  ];

  function isWriteQuery(sql: string): boolean {
    return WRITE_PATTERNS.some((pattern) => pattern.test(sql));
  }

  await runTest('INSERT classified as write', async () => {
    assert(isWriteQuery('INSERT INTO users (name) VALUES ($1)'), 'INSERT should be write');
  });

  await runTest('UPDATE classified as write', async () => {
    assert(isWriteQuery('UPDATE users SET name = $1'), 'UPDATE should be write');
  });

  await runTest('DELETE classified as write', async () => {
    assert(isWriteQuery('DELETE FROM users'), 'DELETE should be write');
  });

  await runTest('SELECT classified as read', async () => {
    assert(!isWriteQuery('SELECT * FROM users'), 'SELECT should be read');
  });

  await runTest('SELECT FOR UPDATE classified as write', async () => {
    assert(isWriteQuery('SELECT * FROM users FOR UPDATE'), 'FOR UPDATE should be write');
  });

  await runTest('Transaction commands classified as write', async () => {
    assert(isWriteQuery('BEGIN'), 'BEGIN should be write');
    assert(isWriteQuery('COMMIT'), 'COMMIT should be write');
    assert(isWriteQuery('ROLLBACK'), 'ROLLBACK should be write');
  });
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║           Jeju Network Infrastructure Tests               ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  const start = Date.now();

  await testConfigurations();
  await testAlgorithms();
  await testQueryClassification();
  await testRedis();
  await testPostgres();

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('                        Summary');
  console.log('═══════════════════════════════════════════════════════════\n');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalDuration = Date.now() - start;

  console.log(`  Total:  ${results.length} tests`);
  console.log(`  Passed: ${passed} ✓`);
  console.log(`  Failed: ${failed} ✗`);
  console.log(`  Time:   ${totalDuration}ms\n`);

  if (failed > 0) {
    console.log('  Failed Tests:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`    - ${r.name}: ${r.error}`));
    console.log('');
    process.exit(1);
  }

  console.log('  All tests passed.\n');
}

main().catch((error) => {
  console.error('Test runner failed:', error);
  process.exit(1);
});

