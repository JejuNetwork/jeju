#!/usr/bin/env bun

import autocannon from 'autocannon';

interface LoadTestConfig {
  name: string;
  url: string;
  connections: number;
  duration: number;
  pipelining: number;
  thresholds: {
    p99Latency: number;
    errorRate: number;
    minRps: number;
  };
}

const BASE_URL = process.env.LOAD_TEST_URL || 'http://localhost:4352';

const scenarios: LoadTestConfig[] = [
  {
    name: 'Health Check',
    url: `${BASE_URL}/health`,
    connections: 100,
    duration: 10,
    pipelining: 1,
    thresholds: { p99Latency: 50, errorRate: 0.01, minRps: 1000 },
  },
  {
    name: 'Search - Simple Query',
    url: `${BASE_URL}/api/search?q=agent`,
    connections: 50,
    duration: 10,
    pipelining: 1,
    thresholds: { p99Latency: 500, errorRate: 0.05, minRps: 100 },
  },
  {
    name: 'Search - With Filters',
    url: `${BASE_URL}/api/search?q=oracle&type=a2a&category=agent&verified=true&limit=20`,
    connections: 50,
    duration: 10,
    pipelining: 1,
    thresholds: { p99Latency: 500, errorRate: 0.05, minRps: 50 },
  },
  {
    name: 'Agents List',
    url: `${BASE_URL}/api/agents?limit=50`,
    connections: 50,
    duration: 10,
    pipelining: 1,
    thresholds: { p99Latency: 300, errorRate: 0.05, minRps: 100 },
  },
  {
    name: 'Tags',
    url: `${BASE_URL}/api/tags`,
    connections: 100,
    duration: 10,
    pipelining: 1,
    thresholds: { p99Latency: 200, errorRate: 0.01, minRps: 200 },
  },
  {
    name: 'Stats',
    url: `${BASE_URL}/api/stats`,
    connections: 100,
    duration: 10,
    pipelining: 1,
    thresholds: { p99Latency: 100, errorRate: 0.01, minRps: 500 },
  },
];

interface TestResult {
  name: string;
  passed: boolean;
  rps: number;
  p99: number;
  errorRate: number;
  errors: string[];
}

async function runScenario(config: LoadTestConfig): Promise<TestResult> {
  console.log(`\n📊 Running: ${config.name}`);
  console.log(`   URL: ${config.url}`);
  console.log(`   Connections: ${config.connections}, Duration: ${config.duration}s`);

  return new Promise((resolve) => {
    const instance = autocannon({
      url: config.url,
      connections: config.connections,
      duration: config.duration,
      pipelining: config.pipelining,
    });

    autocannon.track(instance, { renderProgressBar: true });

    instance.on('done', (results) => {
      const rps = results.requests.average;
      const p99 = results.latency.p99;
      const totalRequests = results.requests.total;
      const errorCount = results.errors + results.timeouts + 
        (results.non2xx || 0);
      const errorRate = totalRequests > 0 ? errorCount / totalRequests : 0;

      const errors: string[] = [];
      if (p99 > config.thresholds.p99Latency) {
        errors.push(`P99 latency ${p99}ms exceeds ${config.thresholds.p99Latency}ms`);
      }
      if (errorRate > config.thresholds.errorRate) {
        errors.push(`Error rate ${(errorRate * 100).toFixed(2)}% exceeds ${config.thresholds.errorRate * 100}%`);
      }
      if (rps < config.thresholds.minRps) {
        errors.push(`RPS ${rps.toFixed(0)} below ${config.thresholds.minRps}`);
      }

      const passed = errors.length === 0;

      console.log(`\n   Results:`);
      console.log(`   - RPS: ${rps.toFixed(0)} (min: ${config.thresholds.minRps})`);
      console.log(`   - P99: ${p99}ms (max: ${config.thresholds.p99Latency}ms)`);
      console.log(`   - Errors: ${(errorRate * 100).toFixed(2)}% (max: ${config.thresholds.errorRate * 100}%)`);
      console.log(`   ${passed ? '✅ PASSED' : '❌ FAILED'}`);
      
      if (!passed) {
        errors.forEach(e => console.log(`      - ${e}`));
      }

      resolve({ name: config.name, passed, rps, p99, errorRate, errors });
    });
  });
}

async function checkServerAvailable(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    LOAD TEST SUITE                            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nTarget: ${BASE_URL}`);

  const available = await checkServerAvailable(BASE_URL);
  if (!available) {
    console.log('\n❌ Server not available. Start with: bun run api:rest');
    console.log('   Or set LOAD_TEST_URL environment variable');
    process.exit(1);
  }

  console.log('✅ Server is available\n');

  const results: TestResult[] = [];
  for (const scenario of scenarios) {
    const result = await runScenario(scenario);
    results.push(result);
  }

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    SUMMARY                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  let allPassed = true;
  for (const result of results) {
    const status = result.passed ? '✅' : '❌';
    console.log(`${status} ${result.name}`);
    console.log(`   RPS: ${result.rps.toFixed(0)} | P99: ${result.p99}ms | Errors: ${(result.errorRate * 100).toFixed(2)}%`);
    if (!result.passed) {
      allPassed = false;
      result.errors.forEach(e => console.log(`   ⚠️  ${e}`));
    }
  }

  console.log('\n' + (allPassed ? '✅ All load tests passed' : '❌ Some load tests failed'));
  process.exit(allPassed ? 0 : 1);
}

main().catch(console.error);
