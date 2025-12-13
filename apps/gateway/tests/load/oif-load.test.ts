import { describe, test, expect, beforeAll } from 'bun:test';
import { mock } from 'bun:test';

const CONCURRENT_REQUESTS = parseInt(process.env.LOAD_TEST_CONCURRENT || '20', 10);
const ITERATIONS = parseInt(process.env.LOAD_TEST_ITERATIONS || '100', 10);

const createStats = () => ({ count: 0, total: 0, min: Infinity, max: 0, values: [] as number[] });

const percentile = (vals: number[], p: number): number => {
  if (!vals.length) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p / 100 * sorted.length) - 1)];
};

const recordLatency = (stats: ReturnType<typeof createStats>, ms: number) => {
  stats.count++;
  stats.total += ms;
  stats.values.push(ms);
  stats.min = Math.min(stats.min, ms);
  stats.max = Math.max(stats.max, ms);
};

const formatStats = (s: ReturnType<typeof createStats>): string =>
  `count=${s.count} avg=${(s.total / s.count).toFixed(2)}ms ` +
  `p50=${percentile(s.values, 50).toFixed(2)}ms ` +
  `p95=${percentile(s.values, 95).toFixed(2)}ms ` +
  `p99=${percentile(s.values, 99).toFixed(2)}ms`;

const mockPublicClient = {
  getChainId: () => Promise.resolve(84532),
  getGasPrice: () => Promise.resolve(1000000000n),
  readContract: () => Promise.resolve(true),
  getLogs: () => Promise.resolve([]),
};

mock.module('viem', () => ({
  createPublicClient: () => mockPublicClient,
  http: () => ({}),
  keccak256: (data: string) => `0x${data.slice(0, 64).padEnd(64, '0')}`,
  encodePacked: () => '0x00',
}));

import { getQuotes, type QuoteParams } from '../../src/services/quote-service';
import { recordIntentReceived, recordIntentFilled, getPrometheusMetrics } from '../../src/solver/metrics';

const quoteParams: QuoteParams = {
  sourceChain: 11155111,
  destinationChain: 84532,
  sourceToken: '0x0000000000000000000000000000000000000000',
  destinationToken: '0x0000000000000000000000000000000000000000',
  amount: '1000000000000000000',
};

describe('OIF Load Tests', () => {
  beforeAll(() => {
    process.env.OIF_DEV_SOLVER_ADDRESSES = '0x1234567890123456789012345678901234567890';
  });

  test('quote service sequential throughput', async () => {
    const stats = createStats();

    const startAll = Date.now();
    for (let i = 0; i < ITERATIONS; i++) {
      const start = Date.now();
      await getQuotes(quoteParams);
      recordLatency(stats, Date.now() - start);
    }
    const totalTime = Date.now() - startAll;

    console.log(`\n[Quote Sequential] ${formatStats(stats)}`);
    console.log(`[Quote Sequential] Total: ${totalTime}ms, Throughput: ${(ITERATIONS / (totalTime / 1000)).toFixed(2)} quotes/s`);

    expect(stats.count).toBe(ITERATIONS);
    expect(percentile(stats.values, 95)).toBeLessThan(100);
  });

  test('quote service concurrent throughput', async () => {
    const stats = createStats();

    const startAll = Date.now();
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, async () => {
        const start = Date.now();
        await getQuotes(quoteParams);
        return Date.now() - start;
      })
    );
    const totalTime = Date.now() - startAll;

    for (const elapsed of results) recordLatency(stats, elapsed);

    console.log(`\n[Quote Concurrent-${CONCURRENT_REQUESTS}] ${formatStats(stats)}`);
    console.log(`[Quote Concurrent] Total: ${totalTime}ms, Throughput: ${(CONCURRENT_REQUESTS / (totalTime / 1000)).toFixed(2)} quotes/s`);

    expect(stats.count).toBe(CONCURRENT_REQUESTS);
  });

  test('metrics recording throughput', () => {
    const iterations = 10000;
    const startAll = Date.now();

    for (let i = 0; i < iterations; i++) {
      recordIntentReceived(84532);
      recordIntentFilled(11155111, 84532, 50, 21000n);
    }
    const totalTime = Date.now() - startAll;

    console.log(`\n[Metrics Record] ${iterations * 2} operations in ${totalTime}ms`);
    console.log(`[Metrics Record] Throughput: ${((iterations * 2) / (totalTime / 1000)).toFixed(0)} ops/s`);

    expect(totalTime).toBeLessThan(1000);
  });

  test('prometheus export throughput', () => {
    for (let i = 0; i < 1000; i++) {
      recordIntentReceived(84532);
      recordIntentFilled(11155111, 84532, 50, 21000n);
    }

    const iterations = 100;
    const startAll = Date.now();

    for (let i = 0; i < iterations; i++) {
      getPrometheusMetrics();
    }
    const totalTime = Date.now() - startAll;

    console.log(`\n[Prometheus Export] ${iterations} exports in ${totalTime}ms`);
    console.log(`[Prometheus Export] Throughput: ${(iterations / (totalTime / 1000)).toFixed(2)} exports/s`);

    expect(totalTime).toBeLessThan(500);
  });

  test('burst load (batches of concurrent requests)', async () => {
    const stats = createStats();
    const batchSize = 10;
    const batches = 10;
    const startAll = Date.now();

    for (let batch = 0; batch < batches; batch++) {
      const results = await Promise.all(
        Array.from({ length: batchSize }, async () => {
          const start = Date.now();
          await getQuotes(quoteParams);
          return Date.now() - start;
        })
      );
      for (const elapsed of results) recordLatency(stats, elapsed);
    }
    const totalTime = Date.now() - startAll;

    console.log(`\n[Burst Load] ${formatStats(stats)}`);
    console.log(`[Burst Load] Total: ${totalTime}ms, Throughput: ${(stats.count / (totalTime / 1000)).toFixed(2)} req/s`);

    expect(stats.count).toBe(batchSize * batches);
  });

  test('memory stability under sustained load', async () => {
    const iterations = 500;
    const memBefore = process.memoryUsage().heapUsed;

    for (let i = 0; i < iterations; i++) {
      await getQuotes(quoteParams);
      recordIntentReceived(84532);
      if (i % 100 === 0) getPrometheusMetrics();
    }

    if (global.gc) global.gc();
    const memAfter = process.memoryUsage().heapUsed;
    const memGrowthMB = (memAfter - memBefore) / 1024 / 1024;

    console.log(`\n[Memory] Before: ${(memBefore / 1024 / 1024).toFixed(2)}MB, After: ${(memAfter / 1024 / 1024).toFixed(2)}MB`);
    console.log(`[Memory] Growth: ${memGrowthMB.toFixed(2)}MB over ${iterations} iterations`);

    expect(memGrowthMB).toBeLessThan(50);
  });
});

describe('OIF Stress Tests', () => {
  test('handles rapid quote requests without degradation', async () => {
    const phases = [10, 20, 50, 100];
    const latencies: number[][] = [];

    for (const concurrent of phases) {
      const phaseLatencies: number[] = [];
      const results = await Promise.all(
        Array.from({ length: concurrent }, async () => {
          const start = Date.now();
          await getQuotes(quoteParams);
          return Date.now() - start;
        })
      );
      phaseLatencies.push(...results);
      latencies.push(phaseLatencies);
    }

    console.log('\n[Stress Scaling]');
    phases.forEach((concurrent, i) => {
      const avg = latencies[i].reduce((a, b) => a + b, 0) / latencies[i].length;
      const p95 = percentile(latencies[i], 95);
      console.log(`  ${concurrent} concurrent: avg=${avg.toFixed(2)}ms p95=${p95.toFixed(2)}ms`);
    });

    const avgFirst = latencies[0].reduce((a, b) => a + b, 0) / latencies[0].length || 1;
    const avgLast = latencies[3].reduce((a, b) => a + b, 0) / latencies[3].length;
    expect(avgLast / avgFirst).toBeLessThan(10);
  });
});
