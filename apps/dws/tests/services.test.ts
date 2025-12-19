/**
 * DWS Services Tests
 * Tests for S3, workers, KMS, VPN, scraping, and RPC services
 */

import { describe, test, expect } from 'bun:test';
import { app } from '../src/server';

describe('DWS Services', () => {
  describe('Health Endpoints', () => {
    test('main health endpoint', async () => {
      const response = await app.request('/health');
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { status: string; services: Record<string, unknown> };
      expect(data.status).toBe('healthy');
      expect(data.services).toBeDefined();
    });

    test('S3 health endpoint', async () => {
      const response = await app.request('/s3/health');
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { service: string };
      expect(data.service).toBe('dws-s3');
    });

    test('Workers health endpoint', async () => {
      const response = await app.request('/workers/health');
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { service: string };
      expect(data.service).toBe('dws-workers');
    });

    test('KMS health endpoint', async () => {
      const response = await app.request('/kms/health');
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { service: string };
      expect(data.service).toBe('dws-kms');
    });

    test('VPN health endpoint', async () => {
      const response = await app.request('/vpn/health');
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { service: string };
      expect(data.service).toBe('dws-vpn');
    });

    test('Scraping health endpoint', async () => {
      const response = await app.request('/scraping/health');
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { service: string };
      expect(data.service).toBe('dws-scraping');
    });

    test('RPC health endpoint', async () => {
      const response = await app.request('/rpc/health');
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { service: string };
      expect(data.service).toBe('dws-rpc');
    });
  });

  describe('S3 API', () => {
    const testBucket = `test-bucket-${Date.now()}`;
    const testKey = 'test-object.txt';
    const testContent = 'Hello, DWS S3!';

    test('list buckets (empty)', async () => {
      const response = await app.request('/s3');
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { Buckets: unknown[] };
      expect(data.Buckets).toBeDefined();
    });

    test('create bucket', async () => {
      const response = await app.request(`/s3/${testBucket}`, {
        method: 'PUT',
        headers: { 'x-jeju-address': '0x1234567890123456789012345678901234567890' },
      });
      expect(response.ok).toBe(true);
    });

    test('put object', async () => {
      const response = await app.request(`/s3/${testBucket}/${testKey}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/plain',
          'x-jeju-address': '0x1234567890123456789012345678901234567890',
        },
        body: testContent,
      });
      expect(response.ok).toBe(true);
      expect(response.headers.get('ETag')).toBeTruthy();
    });

    test('get object', async () => {
      const response = await app.request(`/s3/${testBucket}/${testKey}`);
      expect(response.ok).toBe(true);
      
      const body = await response.text();
      expect(body).toBe(testContent);
    });

    test('head object', async () => {
      const response = await app.request(`/s3/${testBucket}/${testKey}`, {
        method: 'HEAD',
      });
      expect(response.ok).toBe(true);
      expect(response.headers.get('Content-Length')).toBe(String(testContent.length));
    });

    test('list objects', async () => {
      const response = await app.request(`/s3/${testBucket}?list-type=2`);
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { Contents: unknown[] };
      expect(data.Contents).toBeDefined();
      expect(data.Contents.length).toBeGreaterThan(0);
    });

    test('delete object', async () => {
      const response = await app.request(`/s3/${testBucket}/${testKey}`, {
        method: 'DELETE',
      });
      expect(response.status).toBe(204);
    });

    test('delete bucket', async () => {
      const response = await app.request(`/s3/${testBucket}`, {
        method: 'DELETE',
      });
      expect(response.status).toBe(204);
    });
  });

  describe('KMS API', () => {
    let keyId: string;
    const testAddress = '0x1234567890123456789012345678901234567890';

    test('generate MPC key', async () => {
      const response = await app.request('/kms/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': testAddress,
        },
        body: JSON.stringify({ threshold: 3, totalParties: 5 }),
      });
      expect(response.status).toBe(201);
      
      const data = await response.json() as { keyId: string; publicKey: string; address: string };
      expect(data.keyId).toBeDefined();
      expect(data.publicKey).toBeDefined();
      expect(data.address).toBeDefined();
      keyId = data.keyId;
    });

    test('list keys', async () => {
      const response = await app.request('/kms/keys', {
        headers: { 'x-jeju-address': testAddress },
      });
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { keys: unknown[] };
      expect(data.keys).toBeDefined();
      expect(data.keys.length).toBeGreaterThan(0);
    });

    test('get key details', async () => {
      const response = await app.request(`/kms/keys/${keyId}`);
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { keyId: string; threshold: number };
      expect(data.keyId).toBe(keyId);
      expect(data.threshold).toBe(3);
    });

    test('sign message', async () => {
      const response = await app.request('/kms/sign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': testAddress,
        },
        body: JSON.stringify({
          keyId,
          messageHash: '0x' + '00'.repeat(32),
        }),
      });
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { signature: string };
      expect(data.signature).toBeDefined();
    });

    test('store secret', async () => {
      const response = await app.request('/kms/vault/secrets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': testAddress,
        },
        body: JSON.stringify({
          name: 'test-secret',
          value: 'super-secret-value',
        }),
      });
      expect(response.status).toBe(201);
      
      const data = await response.json() as { id: string; name: string };
      expect(data.id).toBeDefined();
      expect(data.name).toBe('test-secret');
    });
  });

  describe('VPN API', () => {
    test('get regions', async () => {
      const response = await app.request('/vpn/regions');
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { regions: unknown[] };
      expect(data.regions).toBeDefined();
      expect(data.regions.length).toBeGreaterThan(0);
    });

    test('list nodes (empty)', async () => {
      const response = await app.request('/vpn/nodes');
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { nodes: unknown[] };
      expect(data.nodes).toBeDefined();
    });
  });

  describe('Scraping API', () => {
    test('list nodes', async () => {
      const response = await app.request('/scraping/nodes');
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { nodes: unknown[] };
      expect(data.nodes).toBeDefined();
    });

    test('scrape content', async () => {
      const response = await app.request('/scraping/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://example.com',
        }),
      });
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { url: string; html: string };
      expect(data.url).toBe('https://example.com');
      expect(data.html).toBeDefined();
    });

    test('quick fetch', async () => {
      const response = await app.request('/scraping/fetch?url=https://example.com');
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { statusCode: number };
      expect(data.statusCode).toBe(200);
    });
  });

  describe('RPC API', () => {
    test('list chains', async () => {
      const response = await app.request('/rpc/chains');
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { chains: unknown[] };
      expect(data.chains).toBeDefined();
      expect(data.chains.length).toBeGreaterThan(0);
    });

    test('list chains with testnets', async () => {
      const response = await app.request('/rpc/chains?testnet=true');
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { chains: Array<{ isTestnet: boolean }> };
      expect(data.chains.some((c) => c.isTestnet)).toBe(true);
    });

    test('get chain info', async () => {
      const response = await app.request('/rpc/chains/1');
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { name: string; id: number };
      expect(data.name).toBe('Ethereum');
      expect(data.id).toBe(1);
    });

    test('create API key', async () => {
      const response = await app.request('/rpc/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': '0x1234567890123456789012345678901234567890',
        },
        body: JSON.stringify({ tier: 'free' }),
      });
      expect(response.status).toBe(201);
      
      const data = await response.json() as { apiKey: string };
      expect(data.apiKey).toBeDefined();
      expect(data.apiKey.startsWith('dws_')).toBe(true);
    });
  });

  describe('Workers API', () => {
    test('list functions (empty)', async () => {
      const response = await app.request('/workers');
      expect(response.ok).toBe(true);
      
      const data = await response.json() as { functions: unknown[] };
      expect(data.functions).toBeDefined();
    });
  });
});
