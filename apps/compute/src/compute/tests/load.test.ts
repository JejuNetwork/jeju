/**
 * Load Tests for Trigger System
 * Measures throughput, latency, and concurrent execution performance.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { serve } from 'bun';
import { Wallet } from 'ethers';
import { TriggerIntegration, type HttpTarget } from '../sdk/trigger-integration';
import type { Address } from 'viem';

type BunServer = ReturnType<typeof serve>;

const TEST_PORT = 9900;
const EXECUTOR_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Stats collection helper
const createStats = () => ({ count: 0, total: 0, min: Infinity, max: 0, values: [] as number[] });

const percentile = (vals: number[], p: number): number => {
  if (!vals.length) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p / 100 * sorted.length) - 1)];
};

const recordLatency = (stats: ReturnType<typeof createStats>, ms: number) => {
  stats.count++; stats.total += ms; stats.values.push(ms);
  stats.min = Math.min(stats.min, ms); stats.max = Math.max(stats.max, ms);
};

const formatStats = (s: ReturnType<typeof createStats>): string =>
  `count=${s.count} avg=${(s.total / s.count).toFixed(2)}ms p50=${percentile(s.values, 50).toFixed(2)}ms p95=${percentile(s.values, 95).toFixed(2)}ms p99=${percentile(s.values, 99).toFixed(2)}ms`;

// HTTP target helper
const httpTarget = (port: number, path: string): HttpTarget => ({
  type: 'http', endpoint: `http://localhost:${port}${path}`, method: 'POST', timeout: 30,
});

describe('Load Tests', () => {
  let server: BunServer;
  let integration: TriggerIntegration;
  let requestCount = 0;
  const latencies: number[] = [];

  beforeAll(() => {
    server = serve({
      port: TEST_PORT,
      fetch: async () => {
        const start = Date.now();
        requestCount++;
        await new Promise(r => setTimeout(r, 1));
        latencies.push(Date.now() - start);
        return new Response(JSON.stringify({ ok: true, count: requestCount }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    const wallet = new Wallet(EXECUTOR_KEY);
    integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      enableOnChainRegistration: false,
      executorWallet: wallet,
    });
  });

  afterAll(() => {
    server.stop();
    console.log('\n--- Load Test Summary ---');
    console.log(`Total requests: ${requestCount}`);
    if (latencies.length > 0) {
      console.log(`Server-side latency: ${formatStats({
        count: latencies.length,
        total: latencies.reduce((a, b) => a + b, 0),
        min: Math.min(...latencies),
        max: Math.max(...latencies),
        values: latencies,
      })}`);
    }
  });

  test('sequential trigger execution (100 requests)', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'load-sequential', eventTypes: ['load-test'],
      target: httpTarget(TEST_PORT, '/trigger'), active: true,
    });

    const stats = createStats();
    const iterations = 100;

    const startAll = Date.now();
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      const result = await integration.executeTrigger({ triggerId });
      expect(result.status).toBe('success');
      recordLatency(stats, Date.now() - start);
    }
    const totalTime = Date.now() - startAll;

    console.log(`\n[Sequential] ${formatStats(stats)}`);
    console.log(`[Sequential] Total: ${totalTime}ms, Throughput: ${(iterations / (totalTime / 1000)).toFixed(2)} req/s`);

    expect(stats.count).toBe(iterations);
    expect(percentile(stats.values, 95)).toBeLessThan(100);
  });

  test('concurrent trigger execution (50 concurrent)', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'load-concurrent-50', eventTypes: ['concurrent'],
      target: httpTarget(TEST_PORT, '/concurrent'), active: true,
    });

    const concurrency = 50;
    const stats = createStats();

    const startAll = Date.now();
    const results = await Promise.all(Array.from({ length: concurrency }, async () => {
      const start = Date.now();
      const result = await integration.executeTrigger({ triggerId });
      return { result, elapsed: Date.now() - start };
    }));
    const totalTime = Date.now() - startAll;

    for (const { result, elapsed } of results) {
      expect(result.status).toBe('success');
      recordLatency(stats, elapsed);
    }

    console.log(`\n[Concurrent-50] ${formatStats(stats)}`);
    console.log(`[Concurrent-50] Total: ${totalTime}ms, Throughput: ${(concurrency / (totalTime / 1000)).toFixed(2)} req/s`);

    expect(stats.count).toBe(concurrency);
  });

  test('burst load (200 requests in batches of 20)', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'load-burst', eventTypes: ['burst'],
      target: httpTarget(TEST_PORT, '/burst'), active: true,
    });

    const [totalRequests, batchSize] = [200, 20];
    const stats = createStats();

    const startAll = Date.now();
    for (let batch = 0; batch < totalRequests / batchSize; batch++) {
      const results = await Promise.all(Array.from({ length: batchSize }, async () => {
        const start = Date.now();
        const result = await integration.executeTrigger({ triggerId });
        return { result, elapsed: Date.now() - start };
      }));
      for (const { result, elapsed } of results) {
        expect(result.status).toBe('success');
        recordLatency(stats, elapsed);
      }
    }
    const totalTime = Date.now() - startAll;

    console.log(`\n[Burst-200] ${formatStats(stats)}`);
    console.log(`[Burst-200] Total: ${totalTime}ms, Throughput: ${(totalRequests / (totalTime / 1000)).toFixed(2)} req/s`);

    expect(stats.count).toBe(totalRequests);
  });

  test('subscriber notification latency', async () => {
    let notificationCount = 0;
    const subscriberServer = serve({
      port: TEST_PORT + 1,
      fetch: async () => { notificationCount++; return new Response(JSON.stringify({ received: true })); },
    });

    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'load-subscriber', eventTypes: ['subscriber'],
      target: httpTarget(TEST_PORT, '/sub'), active: true,
    });

    await integration.subscribe({
      triggerId, subscriberAddress: Wallet.createRandom().address as Address,
      callbackEndpoint: `http://localhost:${TEST_PORT + 1}/notify`, callbackMethod: 'POST',
      payment: { mode: 'free', pricePerExecution: 0n }, maxExecutions: 100,
    });

    const stats = createStats();
    const iterations = 50;
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await integration.executeTrigger({ triggerId });
      recordLatency(stats, Date.now() - start);
    }

    subscriberServer.stop();

    console.log(`\n[Subscriber Notify] ${formatStats(stats)}`);
    console.log(`[Subscriber Notify] Received: ${notificationCount}`);

    expect(notificationCount).toBeGreaterThanOrEqual(iterations);
  });

  test('cron evaluation throughput', async () => {
    const { shouldExecuteCron } = await import('../sdk/trigger-integration');

    const iterations = 10000;
    const cronExpressions = [
      '*/5 * * * *',
      '0 * * * *',
      '30 9 * * 1-5',
      '0 0 1 * *',
      '*/15 * * * *',
    ];

    const start = Date.now();
    let evalCount = 0;

    for (let i = 0; i < iterations; i++) {
      for (const expr of cronExpressions) {
        shouldExecuteCron(expr);
        evalCount++;
      }
    }

    const elapsed = Date.now() - start;
    const throughput = (evalCount / (elapsed / 1000)).toFixed(0);

    console.log(`\n[Cron Eval] ${evalCount} evaluations in ${elapsed}ms (${throughput} evals/s)`);

    expect(parseFloat(throughput)).toBeGreaterThan(100000);
  });

  test('proof generation throughput', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'load-proof', eventTypes: ['proof'],
      target: httpTarget(TEST_PORT, '/proof'), active: true,
    });

    const iterations = 100;
    const start = Date.now();
    for (let i = 0; i < iterations; i++) await integration.executeTrigger({ triggerId });
    const elapsed = Date.now() - start;
    const throughput = iterations / (elapsed / 1000);

    console.log(`\n[Proof Gen] ${iterations} proofs in ${elapsed}ms (${throughput.toFixed(2)} proofs/s)`);
    expect(throughput).toBeGreaterThan(50);
  });
});

describe('Stress Tests', () => {
  let server: BunServer;
  let integration: TriggerIntegration;
  let errorCount = 0;

  beforeAll(() => {
    server = serve({
      port: TEST_PORT + 10,
      fetch: async () => {
        if (Math.random() < 0.05) {
          errorCount++;
          return new Response('Server Error', { status: 500 });
        }
        return new Response(JSON.stringify({ ok: true }));
      },
    });

    const wallet = new Wallet(EXECUTOR_KEY);
    integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      enableOnChainRegistration: false,
      executorWallet: wallet,
    });
  });

  afterAll(() => {
    server.stop();
    console.log(`\n[Stress] Server errors injected: ${errorCount}`);
  });

  test('handles partial failures gracefully', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'stress-failures', eventTypes: ['stress'],
      target: httpTarget(TEST_PORT + 10, '/stress'), active: true,
    });

    const iterations = 100;
    let [successCount, failCount] = [0, 0];

    for (let i = 0; i < iterations; i++) {
      try {
        const result = await integration.executeTrigger({ triggerId });
        result.status === 'success' ? successCount++ : failCount++;
      } catch { failCount++; }
    }

    console.log(`\n[Stress] Success: ${successCount}, Failed: ${failCount}`);
    expect(successCount).toBeGreaterThan(80);
    expect(successCount + failCount).toBe(iterations);
  });

  test('memory stability under load', async () => {
    const memServer = serve({
      port: TEST_PORT + 11,
      fetch: async () => new Response(JSON.stringify({ ok: true })),
    });

    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'stress-memory', eventTypes: ['memory'],
      target: httpTarget(TEST_PORT + 11, '/memory'), active: true,
    });

    const iterations = 500;
    const memBefore = process.memoryUsage().heapUsed;

    for (let i = 0; i < iterations; i++) {
      try { await integration.executeTrigger({ triggerId }); } catch { /* ignore */ }
    }

    memServer.stop();
    if (global.gc) global.gc();

    const memAfter = process.memoryUsage().heapUsed;
    const memGrowthMB = (memAfter - memBefore) / 1024 / 1024;

    console.log(`\n[Memory] Before: ${(memBefore / 1024 / 1024).toFixed(2)}MB, After: ${(memAfter / 1024 / 1024).toFixed(2)}MB`);
    console.log(`[Memory] Growth: ${memGrowthMB.toFixed(2)}MB over ${iterations} iterations`);

    expect(memGrowthMB).toBeLessThan(50);
  });
});
