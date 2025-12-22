/**
 * Cross-Service Integration Tests
 * Verifies indexer, IPFS, and monitoring work together
 * 
 * These tests check service availability and skip gracefully when services
 * are not running. Use describe.skipIf(condition) for conditional test suites.
 */

import { describe, test, expect } from 'bun:test';
import { APP_URLS, INFRA_PORTS } from '../shared/constants';

const HOST = process.env.HOST || '127.0.0.1';
const INDEXER_GRAPHQL = APP_URLS.indexerGraphQL;
const IPFS_API = APP_URLS.ipfs;
const GRAFANA_API = `http://${HOST}:${INFRA_PORTS.grafana}`;
const PROMETHEUS_API = `http://${HOST}:${INFRA_PORTS.prometheus}`;

// Service availability checks
async function isServiceAvailable(url: string, method = 'GET', body?: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body,
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Check service availability at module load time for skipIf
const indexerAvailable = await isServiceAvailable(INDEXER_GRAPHQL, 'POST', JSON.stringify({ query: '{ __typename }' }));
const ipfsAvailable = await isServiceAvailable(`${IPFS_API}/health`);
const grafanaAvailable = await isServiceAvailable(`${GRAFANA_API}/api/health`);
const prometheusAvailable = await isServiceAvailable(`${PROMETHEUS_API}/api/v1/query?query=up`);

describe.skipIf(!indexerAvailable)('Indexer Integration', () => {
  test('GraphQL API returns schema information', async () => {
    const response = await fetch(INDEXER_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: '{ __schema { queryType { name } } }'
      })
    });
    
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.data).toBeDefined();
    expect(data.data.__schema).toBeDefined();
    console.log('✅ Indexer GraphQL API responding');
  });

  test('can query blocks', async () => {
    const response = await fetch(INDEXER_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: '{ blocks(limit: 1, orderBy: number_DESC) { number hash } }'
      })
    });
    
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.data).toBeDefined();
    expect(data.data.blocks).toBeDefined();
    expect(Array.isArray(data.data.blocks)).toBe(true);
    console.log(`✅ Indexer has indexed ${data.data.blocks.length > 0 ? 'blocks' : 'no blocks yet'}`);
  });
});

describe.skipIf(!ipfsAvailable)('IPFS Integration', () => {
  test('health check returns status', async () => {
    const response = await fetch(`${IPFS_API}/health`);
    
    expect(response.ok).toBe(true);
    const health = await response.json();
    expect(health.status).toBeDefined();
    console.log('✅ IPFS service responding');
  });

  test('A2A agent card is accessible', async () => {
    const response = await fetch(`${IPFS_API}/.well-known/agent-card.json`);
    
    expect(response.ok).toBe(true);
    const card = await response.json();
    expect(card.name).toBe('IPFS Storage Service');
    expect(card.skills).toBeDefined();
    expect(card.skills.length).toBeGreaterThan(0);
    console.log('✅ IPFS A2A agent card available');
  });

  test('health endpoint returns valid response', async () => {
    const response = await fetch(`${IPFS_API}/health`);
    
    expect(response.ok).toBe(true);
    console.log('✅ IPFS health endpoint working');
  });
});

describe.skipIf(!grafanaAvailable)('Grafana Integration', () => {
  test('health API is accessible', async () => {
    const response = await fetch(`${GRAFANA_API}/api/health`);
    
    expect(response.ok).toBe(true);
    const health = await response.json();
    expect(health).toBeDefined();
    console.log('✅ Grafana accessible');
  });
});

describe.skipIf(!prometheusAvailable)('Prometheus Integration', () => {
  test('query API is accessible', async () => {
    const response = await fetch(`${PROMETHEUS_API}/api/v1/query?query=up`);
    
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.status).toBe('success');
    console.log('✅ Prometheus accessible');
  });
});

describe('Service Availability Summary', () => {
  test('reports which services are running', () => {
    console.log('\n📊 Service Availability:');
    console.log(`   Indexer:    ${indexerAvailable ? '✅ Running' : '⏭️  Not running'}`);
    console.log(`   IPFS:       ${ipfsAvailable ? '✅ Running' : '⏭️  Not running'}`);
    console.log(`   Grafana:    ${grafanaAvailable ? '✅ Running' : '⏭️  Not running'}`);
    console.log(`   Prometheus: ${prometheusAvailable ? '✅ Running' : '⏭️  Not running'}`);
    
    // At least one service should be running for meaningful integration tests
    const anyRunning = indexerAvailable || ipfsAvailable || grafanaAvailable || prometheusAvailable;
    if (!anyRunning) {
      console.log('\n⚠️  No services running - start services for integration testing');
    }
  });
});
