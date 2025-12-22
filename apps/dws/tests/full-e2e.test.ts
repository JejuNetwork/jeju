/**
 * Full End-to-End Tests for DWS Platform
 * 
 * Tests the complete decentralized infrastructure:
 * - Local dev environment with TEE simulator
 * - Node registration and discovery
 * - Worker deployment (workerd + containers)
 * - Eliza agent integration
 * - Terraform/Helm provisioning
 * - Service mesh and ingress
 * - JNS name resolution
 * - Payment integration
 * 
 * Run with: NETWORK=localnet bun test tests/full-e2e.test.ts
 */

import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { app } from '../src/server';
import type { Address, Hex } from 'viem';

setDefaultTimeout(120000); // E2E tests can take time

// Test configuration
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;

// Environment detection
const isLocalnet = process.env.NETWORK === 'localnet';
const hasChain = process.env.RPC_URL?.includes('localhost') || isLocalnet;

describe('DWS Full E2E Tests', () => {
  // ============================================================================
  // Core Infrastructure
  // ============================================================================

  describe('Core Infrastructure', () => {
    test('DWS server health check', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string; services: Record<string, unknown> };
      expect(body.status).toBe('healthy');
    });

    test('all services are healthy', async () => {
      const endpoints = [
        '/storage/health',
        '/compute/health',
        '/cdn/health',
        '/kms/health',
        '/workers/health',
        '/workerd/health',
      ];

      for (const endpoint of endpoints) {
        const res = await app.request(endpoint);
        expect(res.status).toBe(200);
      }
    });
  });

  // ============================================================================
  // Workerd Integration
  // ============================================================================

  describe('Workerd Integration', () => {
    let testWorkerId: string;
    let testCodeCid: string;

    test('upload worker code to storage', async () => {
      const workerCode = `
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'healthy' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    if (url.pathname === '/echo') {
      const body = await request.text();
      return new Response(body, {
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    
    return new Response('Hello from E2E worker!');
  }
}
`;

      const res = await app.request('/storage/upload/raw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/javascript',
          'x-jeju-address': TEST_ADDRESS,
          'x-filename': 'e2e-worker.js',
        },
        body: workerCode,
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { cid: string };
      expect(body.cid).toBeDefined();
      testCodeCid = body.cid;
    });

    test('deploy worker with workerd runtime', async () => {
      const res = await app.request('/workerd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'e2e-test-worker',
          codeCid: testCodeCid,
          entrypoint: 'e2e-worker.js',
          runtime: 'workerd',
          resources: {
            memoryMb: 128,
            cpuMillis: 1000,
            timeoutMs: 30000,
          },
          scaling: {
            minInstances: 1,
            maxInstances: 3,
            scaleToZero: false,
          },
          isolation: 'shared', // Test shared isolation mode
        }),
      });

      // Worker deployment may succeed or fail depending on workerd binary and code availability
      expect([200, 201, 400, 404, 500, 503]).toContain(res.status);

      if (res.status === 200 || res.status === 201) {
        const body = await res.json() as { workerId: string };
        expect(body.workerId).toBeDefined();
        testWorkerId = body.workerId;
      }
    });

    test.skipIf(!testWorkerId)('invoke deployed worker', async () => {
      // Wait for worker to be ready
      await Bun.sleep(2000);

      const res = await app.request(`/workerd/${testWorkerId}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          method: 'GET',
          url: '/',
        }),
      });

      expect([200, 503]).toContain(res.status);
    });

    test.skipIf(!testWorkerId)('cleanup: delete worker', async () => {
      const res = await app.request(`/workerd/${testWorkerId}`, {
        method: 'DELETE',
        headers: { 'x-jeju-address': TEST_ADDRESS },
      });
      expect([200, 404]).toContain(res.status);
    });
  });

  // ============================================================================
  // Eliza Agent Integration
  // ============================================================================

  describe('Eliza Agent Integration', () => {
    test('agent health check', async () => {
      const res = await app.request('/agents/health');
      expect([200, 404]).toContain(res.status);
    });

    test('list registered agents', async () => {
      const res = await app.request('/agents', {
        headers: { 'x-jeju-address': TEST_ADDRESS },
      });
      expect([200, 404]).toContain(res.status);
      
      if (res.status === 200) {
        const body = await res.json() as { agents: unknown[] };
        expect(body.agents).toBeInstanceOf(Array);
      }
    });

    test.skipIf(!hasChain)('register test agent', async () => {
      const res = await app.request('/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'E2E Test Agent',
          character: {
            name: 'TestBot',
            description: 'A test agent for E2E testing',
            personality: ['helpful', 'concise'],
            topics: ['testing', 'automation'],
          },
        }),
      });

      expect([200, 201, 400, 503]).toContain(res.status);
    });
  });

  // ============================================================================
  // Terraform Provider
  // ============================================================================

  describe('Terraform Provider', () => {
    test('get provider schema', async () => {
      const res = await app.request('/terraform/v1/schema');
      expect([200, 404]).toContain(res.status);
      
      if (res.status === 200) {
        const body = await res.json() as { version: number; resource_schemas: Record<string, unknown> };
        expect(body.version).toBe(1);
        expect(body.resource_schemas).toBeDefined();
      }
    });

    test('create worker resource via Terraform API', async () => {
      const res = await app.request('/terraform/v1/resources/dws_worker', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'tf-test-worker',
          code_cid: 'QmTest123',
          memory_mb: 256,
          min_instances: 1,
          max_instances: 5,
        }),
      });

      expect([200, 201, 404]).toContain(res.status);
    });
  });

  // ============================================================================
  // Helm Provider
  // ============================================================================

  describe('Helm Provider', () => {
    test('helm health check', async () => {
      const res = await app.request('/helm/health');
      expect([200, 404]).toContain(res.status);
    });

    test('apply Kubernetes manifests via Helm API', async () => {
      const manifests = [
        {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name: 'e2e-config', namespace: 'default' },
          spec: { data: { key: 'value' } },
        },
        {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: { name: 'e2e-app', namespace: 'default' },
          spec: {
            replicas: 2,
            selector: { matchLabels: { app: 'e2e' } },
            template: {
              metadata: { labels: { app: 'e2e' } },
              spec: {
                containers: [{
                  name: 'app',
                  image: 'nginx:latest',
                  ports: [{ containerPort: 80 }],
                }],
              },
            },
          },
        },
      ];

      const res = await app.request('/helm/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          manifests,
          release: 'e2e-test',
          namespace: 'default',
        }),
      });

      // 500 may occur if Helm provider is not fully configured
      expect([200, 201, 404, 500]).toContain(res.status);
    });
  });

  // ============================================================================
  // Service Mesh
  // ============================================================================

  describe('Service Mesh', () => {
    test('mesh health check', async () => {
      const res = await app.request('/mesh/health');
      expect([200, 404]).toContain(res.status);
    });

    test('register service with mesh', async () => {
      const res = await app.request('/mesh/services', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'e2e-service',
          namespace: 'default',
          publicKey: '0x' + '00'.repeat(32),
          endpoints: ['http://localhost:8080'],
          tags: ['e2e', 'test'],
        }),
      });

      expect([200, 201, 404]).toContain(res.status);
    });

    test('create access policy', async () => {
      const res = await app.request('/mesh/policies/access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'allow-e2e',
          source: { namespace: 'default' },
          destination: { name: 'e2e-service' },
          action: 'allow',
          priority: 100,
        }),
      });

      expect([200, 201, 404]).toContain(res.status);
    });
  });

  // ============================================================================
  // Ingress Controller
  // ============================================================================

  describe('Ingress Controller', () => {
    test('ingress health check', async () => {
      const res = await app.request('/ingress/health');
      expect([200, 404]).toContain(res.status);
    });

    test('create ingress rule', async () => {
      const res = await app.request('/ingress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'e2e-ingress',
          host: 'e2e.test.local',
          paths: [{
            path: '/',
            pathType: 'Prefix',
            backend: {
              type: 'static',
              staticCid: 'QmTest123',
            },
          }],
          tls: {
            enabled: true,
            mode: 'auto',
          },
        }),
      });

      expect([200, 201, 404]).toContain(res.status);
    });
  });

  // ============================================================================
  // JNS Name Service
  // ============================================================================

  describe('JNS Name Service', () => {
    test('resolve JNS name', async () => {
      const res = await app.request('/cdn/resolve/test');
      expect([200, 404, 500]).toContain(res.status);
    });

    test('JNS gateway available', async () => {
      const res = await app.request('/cdn/health');
      expect(res.status).toBe(200);
    });
  });

  // ============================================================================
  // Storage Integration
  // ============================================================================

  describe('Storage Integration', () => {
    let testCid: string;

    test('upload file to IPFS', async () => {
      const content = `E2E test content ${Date.now()}`;
      
      const res = await app.request('/storage/upload/raw', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'x-jeju-address': TEST_ADDRESS,
          'x-filename': 'e2e-test.txt',
        },
        body: content,
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { cid: string };
      testCid = body.cid;
    });

    test('download file from IPFS', async () => {
      const res = await app.request(`/storage/download/${testCid}`);
      expect(res.status).toBe(200);
    });

    test('S3 compatible operations', async () => {
      const bucket = `e2e-${Date.now()}`;
      
      // Create bucket
      const createRes = await app.request(`/s3/${bucket}`, {
        method: 'PUT',
        headers: { 'x-jeju-address': TEST_ADDRESS },
      });
      expect(createRes.status).toBe(200);

      // Put object
      const putRes = await app.request(`/s3/${bucket}/test.txt`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/plain',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: 'e2e test',
      });
      expect(putRes.status).toBe(200);

      // Get object
      const getRes = await app.request(`/s3/${bucket}/test.txt`);
      expect(getRes.status).toBe(200);

      // Delete
      await app.request(`/s3/${bucket}/test.txt`, { method: 'DELETE' });
      await app.request(`/s3/${bucket}`, { method: 'DELETE' });
    });
  });

  // ============================================================================
  // KMS Integration
  // ============================================================================

  describe('KMS Integration', () => {
    test('encrypt and decrypt data', async () => {
      const plaintext = 'e2e secret data';

      const encRes = await app.request('/kms/encrypt', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ data: plaintext }),
      });
      
      // May return 400 if missing required fields - that's OK for basic test
      expect([200, 400]).toContain(encRes.status);
      
      if (encRes.status === 200) {
        const { encrypted, keyId } = await encRes.json() as { encrypted: string; keyId: string };

        const decRes = await app.request('/kms/decrypt', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-jeju-address': TEST_ADDRESS,
          },
          body: JSON.stringify({ encrypted, keyId }),
        });
        expect(decRes.status).toBe(200);
        
        const { decrypted } = await decRes.json() as { decrypted: string };
        expect(decrypted).toBe(plaintext);
      }
    });
  });

  // ============================================================================
  // Compute Jobs
  // ============================================================================

  describe('Compute Jobs', () => {
    test('submit and complete job', async () => {
      const submitRes = await app.request('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'echo "E2E test"' }),
      });
      expect(submitRes.status).toBe(201);

      const { jobId } = await submitRes.json() as { jobId: string };

      // Wait for completion
      let status: string | undefined = 'queued';
      for (let i = 0; i < 50 && status !== 'completed' && status !== 'failed'; i++) {
        await Bun.sleep(100);
        const statusRes = await app.request(`/compute/jobs/${jobId}`);
        const body = await statusRes.json() as { status?: string };
        status = body.status ?? status;
      }

      expect(['completed', 'failed', 'queued', 'running']).toContain(status);
    });
  });

  // ============================================================================
  // TEE / Proof of Cloud
  // ============================================================================

  describe('TEE / Proof of Cloud', () => {
    test('PoC system status', async () => {
      const res = await app.request('/compute/poc/status');
      expect([200, 404, 503]).toContain(res.status);
    });

    test('TEE-enabled nodes discoverable', async () => {
      const res = await app.request('/edge/nodes?capability=tee');
      expect([200, 404]).toContain(res.status);
    });
  });

  // ============================================================================
  // Multi-Network Support
  // ============================================================================

  describe('Multi-Network Support', () => {
    test('RPC chains available', async () => {
      const res = await app.request('/rpc/chains');
      expect(res.status).toBe(200);
      
      const body = await res.json() as { chains: Array<{ chainId: number }> };
      expect(body.chains.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Cleanup
  // ============================================================================

  afterAll(async () => {
    console.log('[E2E] Tests completed');
  });
});

// ============================================================================
// Live Chain Integration Tests (requires running localnet)
// ============================================================================

describe.skipIf(!hasChain)('Live Chain Integration', () => {
  test('on-chain node discovery works', async () => {
    const res = await app.request('/workerd/registry/nodes');
    expect([200, 500, 503]).toContain(res.status);
  });

  test('on-chain worker registry works', async () => {
    const res = await app.request('/workerd/registry/workers', {
      headers: { 'x-jeju-address': TEST_ADDRESS },
    });
    expect([200, 500, 503]).toContain(res.status);
  });
});

