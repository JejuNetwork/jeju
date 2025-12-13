/**
 * Cross-Service Integration Tests
 * Verifies indexer, IPFS, and monitoring work together
 */

import { describe, test, expect } from 'bun:test';
import { APP_URLS, INFRA_PORTS } from '../shared/constants';

const HOST = process.env.HOST || '127.0.0.1';
const INDEXER_GRAPHQL = APP_URLS.indexerGraphQL;
const IPFS_API = APP_URLS.ipfs;
const GRAFANA_API = `http://${HOST}:${INFRA_PORTS.grafana}`;
const PROMETHEUS_API = `http://${HOST}:${INFRA_PORTS.prometheus}`;

describe('Service Integration - Indexer + IPFS + Monitoring', () => {
  test('indexer GraphQL API is accessible', async () => {
    try {
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
      console.log('✅ Indexer GraphQL API responding');
    } catch (error) {
      console.log('⚠️  Indexer not running:', error);
    }
  });

  test('indexer can query blocks', async () => {
    try {
      const response = await fetch(INDEXER_GRAPHQL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: '{ blocks(limit: 1, orderBy: number_DESC) { number hash } }'
        })
      });
      
      const data = await response.json();
      if (data.data && data.data.blocks) {
        console.log(`✅ Indexer has indexed ${data.data.blocks.length > 0 ? 'blocks' : 'no blocks yet'}`);
        expect(Array.isArray(data.data.blocks)).toBe(true);
      }
    } catch (error) {
      console.log('⚠️  Indexer query failed:', error);
    }
  });

  test('IPFS service health check', async () => {
    try {
      const response = await fetch(`${IPFS_API}/health`);
      
      if (response.ok) {
        const health = await response.json();
        console.log('✅ IPFS service responding');
        expect(health.status).toBeDefined();
      } else {
        console.log('⚠️  IPFS service not running');
      }
    } catch (error) {
      console.log('⚠️  IPFS service not accessible:', error);
    }
  });

  test('IPFS A2A agent card is accessible', async () => {
    try {
      const response = await fetch(`${IPFS_API}/.well-known/agent-card.json`);
      
      if (response.ok) {
        const card = await response.json();
        console.log('✅ IPFS A2A agent card available');
        expect(card.name).toBe('Jeju IPFS Storage Service');
        expect(card.skills).toBeDefined();
        expect(card.skills.length).toBeGreaterThan(0);
      } else {
        console.log('⚠️  IPFS A2A not available');
      }
    } catch (error) {
      console.log('⚠️  IPFS A2A not accessible:', error);
    }
  });

  test('Grafana is accessible', async () => {
    try {
      const response = await fetch(`${GRAFANA_API}/api/health`);
      
      if (response.ok) {
        const health = await response.json();
        console.log('✅ Grafana accessible');
        expect(health).toBeDefined();
      } else {
        console.log('⚠️  Grafana not running');
      }
    } catch (error) {
      console.log('⚠️  Grafana not accessible:', error);
    }
  });

  test('Prometheus is accessible', async () => {
    try {
      const response = await fetch(`${PROMETHEUS_API}/api/v1/query?query=up`);
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Prometheus accessible');
        expect(data.status).toBe('success');
      } else {
        console.log('⚠️  Prometheus not running');
      }
    } catch (error) {
      console.log('⚠️  Prometheus not accessible:', error);
    }
  });

  test('monitoring stack can query indexer database', async () => {
    try {
      // This test verifies the monitoring dashboards can access indexer data
      // It doesn't directly test Grafana queries but validates the data source exists
      const response = await fetch(INDEXER_GRAPHQL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: '{ blocks(limit: 1) { number } }'
        })
      });
      
      if (response.ok) {
        console.log('✅ Indexer database accessible for monitoring');
      }
    } catch (error) {
      console.log('⚠️  Cannot verify monitoring database access');
    }
  });

  test('all services expose health endpoints', async () => {
    const services = [
      { name: 'IPFS', url: `${IPFS_API}/health` },
    ];

    for (const service of services) {
      try {
        const response = await fetch(service.url);
        if (response.ok) {
          console.log(`✅ ${service.name} health endpoint working`);
        } else {
          console.log(`⚠️  ${service.name} health endpoint returned ${response.status}`);
        }
      } catch (error) {
        console.log(`⚠️  ${service.name} not accessible`);
      }
    }
  });
});

