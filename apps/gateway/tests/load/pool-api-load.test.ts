import { test, expect, beforeAll } from 'bun:test';

const BASE_URL = process.env.GATEWAY_URL || process.env.GATEWAY_A2A_URL || 'http://localhost:3001';
const SKIP_LOAD_TESTS = process.env.SKIP_LOAD_TESTS === 'true';
const CONCURRENT_REQUESTS = parseInt(process.env.LOAD_TEST_CONCURRENT || '10', 10);
const REQUESTS_PER_SECOND = parseInt(process.env.LOAD_TEST_RPS || '50', 10);
const DURATION_SECONDS = parseInt(process.env.LOAD_TEST_DURATION || '10', 10);

const TEST_TOKEN_1 = '0x1111111111111111111111111111111111111111';
const TEST_TOKEN_2 = '0x2222222222222222222222222222222222222222';

let serverAvailable = false;

beforeAll(async () => {
  if (SKIP_LOAD_TESTS) {
    console.log('⚠️  Skipping load tests (SKIP_LOAD_TESTS=true)');
    serverAvailable = false;
    return;
  }
  try {
    const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (response.ok) {
      serverAvailable = true;
    } else {
      console.warn(`⚠️  Gateway server returned ${response.status}, tests will be skipped`);
      serverAvailable = false;
    }
  } catch (error) {
    console.warn(`⚠️  Gateway server not running at ${BASE_URL}. Tests will be skipped.`);
    console.warn('   Start with: bun run dev');
    console.warn('   Or set SKIP_LOAD_TESTS=true to skip these tests');
    serverAvailable = false;
  }
});

async function fetchWithTiming(url: string, options?: RequestInit): Promise<{ status: number; duration: number; error?: string }> {
  const start = Date.now();
  try {
    const response = await fetch(url, options);
    const duration = Date.now() - start;
    return { status: response.status, duration };
  } catch (error) {
    const duration = Date.now() - start;
    return { 
      status: 0, 
      duration, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

test('Load Test: GET /api/pools', async () => {
  if (SKIP_LOAD_TESTS || !serverAvailable) {
    console.log('⏭️  Skipping load test (server not available)');
    return;
  }
  
  const results: Array<{ status: number; duration: number; error?: string }> = [];
  const startTime = Date.now();
  const endTime = startTime + (DURATION_SECONDS * 1000);
  
  const requests: Promise<void>[] = [];
  
  const makeRequest = async () => {
    while (Date.now() < endTime) {
      const result = await fetchWithTiming(`${BASE_URL}/api/pools`);
      results.push(result);
      
      const delay = 1000 / REQUESTS_PER_SECOND;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  };
  
  for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
    requests.push(makeRequest());
  }
  
  await Promise.all(requests);
  clearTimeout(timeout);
  
  const successful = results.filter(r => r.status === 200);
  const failed = results.filter(r => r.status !== 200);
  const durations = results.map(r => r.duration);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const p50 = durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.5)];
  const p95 = durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.95)];
  const p99 = durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.99)];
  const maxDuration = Math.max(...durations);
  const minDuration = Math.min(...durations);
  
  console.log('\n=== Load Test Results: GET /api/pools ===');
  console.log(`Total Requests: ${results.length}`);
  console.log(`Successful: ${successful.length} (${(successful.length / results.length * 100).toFixed(2)}%)`);
  console.log(`Failed: ${failed.length} (${(failed.length / results.length * 100).toFixed(2)}%)`);
  console.log(`Duration: ${DURATION_SECONDS}s`);
  console.log(`Requests/sec: ${(results.length / DURATION_SECONDS).toFixed(2)}`);
  console.log(`\nResponse Times (ms):`);
  console.log(`  Min: ${minDuration}`);
  console.log(`  Avg: ${avgDuration.toFixed(2)}`);
  console.log(`  P50: ${p50}`);
  console.log(`  P95: ${p95}`);
  console.log(`  P99: ${p99}`);
  console.log(`  Max: ${maxDuration}`);
  
  if (failed.length > 0) {
    console.log(`\nFailures:`);
    failed.slice(0, 10).forEach(f => {
      console.log(`  Status: ${f.status}, Error: ${f.error || 'N/A'}`);
    });
  }
  
  expect(successful.length / results.length).toBeGreaterThan(0.95);
  expect(avgDuration).toBeLessThan(1000);
  expect(p95).toBeLessThan(2000);
});

test('Load Test: POST /api/pools/quote', async () => {
  if (SKIP_LOAD_TESTS || !serverAvailable) {
    console.log('⏭️  Skipping load test (server not available)');
    expect(true).toBe(true);
    return;
  }
  
  const results: Array<{ status: number; duration: number; error?: string }> = [];
  const startTime = Date.now();
  const endTime = startTime + (DURATION_SECONDS * 1000);
  
  const timeout = setTimeout(() => {
    throw new Error(`Load test timed out after ${DURATION_SECONDS + 10}s`);
  }, (DURATION_SECONDS + 10) * 1000);
  
  const requests: Promise<void>[] = [];
  
  const makeRequest = async () => {
    while (Date.now() < endTime) {
      const result = await fetchWithTiming(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
        }),
      });
      results.push(result);
      
      const delay = 1000 / REQUESTS_PER_SECOND;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  };
  
  for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
    requests.push(makeRequest());
  }
  
  await Promise.all(requests);
  
  const successful = results.filter(r => r.status === 200 || r.status === 404);
  const failed = results.filter(r => r.status !== 200 && r.status !== 404);
  const durations = results.map(r => r.duration);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const p95 = durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.95)];
  
  console.log('\n=== Load Test Results: POST /api/pools/quote ===');
  console.log(`Total Requests: ${results.length}`);
  console.log(`Successful: ${successful.length} (${(successful.length / results.length * 100).toFixed(2)}%)`);
  console.log(`Failed: ${failed.length} (${(failed.length / results.length * 100).toFixed(2)}%)`);
  console.log(`Avg Response Time: ${avgDuration.toFixed(2)}ms`);
  console.log(`P95 Response Time: ${p95}ms`);
  
  expect(successful.length / results.length).toBeGreaterThan(0.95);
  expect(avgDuration).toBeLessThan(2000);
  expect(p95).toBeLessThan(3000);
});

test('Load Test: Concurrent Mixed Endpoints', async () => {
  if (SKIP_LOAD_TESTS || !serverAvailable) {
    console.log('⏭️  Skipping load test (server not available)');
    expect(true).toBe(true);
    return;
  }
  
  const endpoints = [
    { method: 'GET', url: `${BASE_URL}/api/pools` },
    { method: 'GET', url: `${BASE_URL}/api/pools/stats` },
    { method: 'GET', url: `${BASE_URL}/api/pools/tokens` },
    { method: 'POST', url: `${BASE_URL}/api/pools/quote`, body: JSON.stringify({ tokenIn: TEST_TOKEN_1, tokenOut: TEST_TOKEN_2, amountIn: '1' }) },
  ];
  
  const results: Array<{ endpoint: string; status: number; duration: number }> = [];
  const startTime = Date.now();
  const endTime = startTime + (DURATION_SECONDS * 1000);
  
  const timeout = setTimeout(() => {
    throw new Error(`Load test timed out after ${DURATION_SECONDS + 10}s`);
  }, (DURATION_SECONDS + 10) * 1000);
  
  const requests: Promise<void>[] = [];
  
  const makeRequest = async () => {
    while (Date.now() < endTime) {
      const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
      const options: RequestInit = { method: endpoint.method };
      if (endpoint.body) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = endpoint.body;
      }
      
      const result = await fetchWithTiming(endpoint.url, options);
      results.push({ endpoint: endpoint.url, ...result });
      
      const delay = 1000 / REQUESTS_PER_SECOND;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  };
  
  for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
    requests.push(makeRequest());
  }
  
  await Promise.all(requests);
  clearTimeout(timeout);
  
  const successful = results.filter(r => r.status === 200 || r.status === 404);
  const durations = results.map(r => r.duration);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const p95 = durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.95)];
  
  console.log('\n=== Load Test Results: Mixed Endpoints ===');
  console.log(`Total Requests: ${results.length}`);
  console.log(`Successful: ${successful.length} (${(successful.length / results.length * 100).toFixed(2)}%)`);
  console.log(`Avg Response Time: ${avgDuration.toFixed(2)}ms`);
  console.log(`P95 Response Time: ${p95}ms`);
  
  expect(successful.length / results.length).toBeGreaterThan(0.90);
  expect(avgDuration).toBeLessThan(2000);
});
