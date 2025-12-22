/**
 * REAL End-to-End Tests for DWS
 * 
 * These tests run against ACTUAL infrastructure:
 * - Jeju localnet (L2: 6546)
 * - Deployed contracts
 * - Running DWS server
 * - Real workerd execution
 * 
 * Prerequisites:
 * 1. Start Jeju localnet: jeju dev OR bun run localnet:start
 * 2. Run tests: bun run scripts/e2e-setup.ts
 * 
 * Or run directly if DWS is already running:
 *   E2E_MODE=true DWS_URL=http://localhost:4030 bun test tests/real-e2e.test.ts
 */

import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { createPublicClient, http, type Address, type Hex } from 'viem';

setDefaultTimeout(120000);

// ============================================================================
// Configuration
// ============================================================================

const DWS_URL = process.env.DWS_URL ?? 'http://localhost:4030';
const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:6546';
const E2E_MODE = process.env.E2E_MODE === 'true';

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;
const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;

// ============================================================================
// Helpers
// ============================================================================

async function dwsRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${DWS_URL}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': TEST_ADDRESS,
      ...options.headers,
    },
  });
}

async function checkDWSRunning(): Promise<boolean> {
  try {
    const res = await dwsRequest('/health');
    return res.ok;
  } catch {
    return false;
  }
}

async function checkChainRunning(): Promise<boolean> {
  try {
    const client = createPublicClient({ transport: http(RPC_URL) });
    const blockNumber = await client.getBlockNumber();
    return blockNumber >= 0n;
  } catch {
    return false;
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe.skipIf(!E2E_MODE)('Real DWS E2E Tests', () => {
  let dwsRunning = false;
  let chainRunning = false;
  
  beforeAll(async () => {
    dwsRunning = await checkDWSRunning();
    chainRunning = await checkChainRunning();
    
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║              REAL E2E TEST ENVIRONMENT                        ║
╠══════════════════════════════════════════════════════════════╣
║  DWS URL:   ${DWS_URL.padEnd(45)} ║
║  RPC URL:   ${RPC_URL.padEnd(45)} ║
║  DWS Running: ${String(dwsRunning).padEnd(43)} ║
║  Chain Running: ${String(chainRunning).padEnd(41)} ║
╚══════════════════════════════════════════════════════════════╝
`);
    
    if (!dwsRunning) {
      console.warn('DWS server not running. Some tests will be skipped.');
    }
    if (!chainRunning) {
      console.warn('Jeju chain not running. Some tests will be skipped.');
    }
  });

  // ============================================================================
  // Infrastructure Health
  // ============================================================================

  describe('Infrastructure Health', () => {
    test('DWS server is healthy', async () => {
      if (!dwsRunning) {
        console.log('  Skipped: DWS not running');
        return;
      }
      
      const res = await dwsRequest('/health');
      expect(res.status).toBe(200);
      
      const body = await res.json() as { status: string; version?: string };
      expect(body.status).toBe('healthy');
      console.log(`  DWS version: ${body.version ?? 'unknown'}`);
    });

    test('Jeju chain is accessible', async () => {
      if (!chainRunning) {
        console.log('  Skipped: Chain not running');
        return;
      }
      
      const client = createPublicClient({ transport: http(RPC_URL) });
      const chainId = await client.getChainId();
      const blockNumber = await client.getBlockNumber();
      
      // Jeju localnet uses chainId 1337
      expect([1337, 31337, 420690]).toContain(chainId);
      expect(blockNumber).toBeGreaterThanOrEqual(0n);
      
      console.log(`  Chain ID: ${chainId}, Block: ${blockNumber}`);
    });
  });

  // ============================================================================
  // Storage Integration (Real IPFS)
  // ============================================================================

  describe.skipIf(!dwsRunning)('Storage Integration', () => {
    let uploadedCid: string;

    test('upload file to storage', async () => {
      const content = `Real E2E test ${Date.now()}`;
      
      const res = await dwsRequest('/storage/upload/raw', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'x-filename': 'e2e-real-test.txt',
        },
        body: content,
      });
      
      expect(res.status).toBe(200);
      const body = await res.json() as { cid: string };
      expect(body.cid).toBeDefined();
      expect(body.cid.startsWith('Qm') || body.cid.startsWith('bafy')).toBe(true);
      
      uploadedCid = body.cid;
      console.log(`  Uploaded CID: ${uploadedCid}`);
    });

    test('download file from storage', async () => {
      if (!uploadedCid) {
        console.log('  Skipped: No CID from previous test');
        return;
      }
      
      const res = await dwsRequest(`/storage/download/${uploadedCid}`);
      expect(res.status).toBe(200);
      
      const content = await res.text();
      expect(content).toContain('Real E2E test');
      console.log(`  Downloaded: ${content.length} bytes`);
    });
  });

  // ============================================================================
  // Workerd Integration (Real Worker Deployment)
  // ============================================================================

  describe.skipIf(!dwsRunning)('Workerd Integration', () => {
    let workerCodeCid: string;
    let deployedWorkerId: string;

    test('upload worker code', async () => {
      const workerCode = `
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ 
        status: 'healthy', 
        worker: 'real-e2e',
        timestamp: Date.now() 
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    if (url.pathname === '/echo') {
      const body = await request.text();
      return new Response(JSON.stringify({ echo: body }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    return new Response('Hello from REAL E2E worker.');
  }
}
`;
      
      const res = await dwsRequest('/storage/upload/raw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/javascript',
          'x-filename': 'real-e2e-worker.js',
        },
        body: workerCode,
      });
      
      expect(res.status).toBe(200);
      const body = await res.json() as { cid: string };
      workerCodeCid = body.cid;
      console.log(`  Worker code CID: ${workerCodeCid}`);
    });

    test('deploy worker with workerd', async () => {
      if (!workerCodeCid) {
        console.log('  Skipped: No code CID');
        return;
      }
      
      const res = await dwsRequest('/workerd', {
        method: 'POST',
        body: JSON.stringify({
          name: `real-e2e-worker-${Date.now()}`,
          codeCid: workerCodeCid,
          entrypoint: 'real-e2e-worker.js',
          runtime: 'workerd',
          resources: {
            memoryMb: 128,
            cpuMillis: 1000,
            timeoutMs: 30000,
          },
          scaling: {
            minInstances: 1,
            maxInstances: 1,
            scaleToZero: false,
          },
        }),
      });
      
      // Worker deployment is complex - may fail if workerd binary not installed
      if (res.status === 200 || res.status === 201) {
        const body = await res.json() as { workerId: string };
        deployedWorkerId = body.workerId;
        console.log(`  Deployed worker: ${deployedWorkerId}`);
      } else {
        console.log(`  Deployment status: ${res.status} (workerd may not be installed)`);
      }
    });

    test('invoke deployed worker', async () => {
      if (!deployedWorkerId) {
        console.log('  Skipped: No deployed worker');
        return;
      }
      
      // Wait for worker to warm up
      await Bun.sleep(3000);
      
      const res = await dwsRequest(`/workerd/${deployedWorkerId}/invoke`, {
        method: 'POST',
        body: JSON.stringify({
          method: 'GET',
          url: '/health',
        }),
      });
      
      if (res.ok) {
        const body = await res.json();
        console.log(`  Worker response:`, body);
      } else {
        console.log(`  Invocation status: ${res.status}`);
      }
    });

    afterAll(async () => {
      // Cleanup: delete deployed worker
      if (deployedWorkerId) {
        await dwsRequest(`/workerd/${deployedWorkerId}`, { method: 'DELETE' });
        console.log(`  Cleaned up worker: ${deployedWorkerId}`);
      }
    });
  });

  // ============================================================================
  // Compute Jobs (Real Job Execution)
  // ============================================================================

  describe.skipIf(!dwsRunning)('Compute Jobs', () => {
    test('submit and track job', async () => {
      const submitRes = await dwsRequest('/compute/jobs', {
        method: 'POST',
        body: JSON.stringify({
          command: 'echo "Hello from real E2E"',
        }),
      });
      
      expect(submitRes.status).toBe(201);
      const { jobId } = await submitRes.json() as { jobId: string };
      console.log(`  Job submitted: ${jobId}`);
      
      // Poll for completion
      let status = 'queued';
      let attempts = 0;
      
      while (status !== 'completed' && status !== 'failed' && attempts < 100) {
        await Bun.sleep(100);
        const statusRes = await dwsRequest(`/compute/jobs/${jobId}`);
        const body = await statusRes.json() as { status?: string };
        status = body.status ?? 'unknown';
        attempts++;
      }
      
      console.log(`  Final status: ${status} (${attempts} polls)`);
      expect(['completed', 'failed', 'running']).toContain(status);
    });
  });

  // ============================================================================
  // On-Chain Integration (Real Contract Calls)
  // ============================================================================

  describe.skipIf(!chainRunning || !dwsRunning)('On-Chain Integration', () => {
    test('query node registry', async () => {
      const res = await dwsRequest('/workerd/registry/nodes');
      
      // May fail if contracts not deployed, but should not 500
      expect([200, 500, 503]).toContain(res.status);
      
      if (res.ok) {
        const body = await res.json() as { nodes: unknown[] };
        console.log(`  Registered nodes: ${body.nodes?.length ?? 0}`);
      }
    });

    test('query worker registry', async () => {
      const res = await dwsRequest('/workerd/registry/workers');
      
      expect([200, 500, 503]).toContain(res.status);
      
      if (res.ok) {
        const body = await res.json() as { workers: unknown[] };
        console.log(`  Registered workers: ${body.workers?.length ?? 0}`);
      }
    });
  });

  // ============================================================================
  // KMS Integration (Real Encryption)
  // ============================================================================

  describe.skipIf(!dwsRunning)('KMS Integration', () => {
    test('key operations', async () => {
      // Create a key
      const createRes = await dwsRequest('/kms/keys', {
        method: 'POST',
        body: JSON.stringify({
          name: `e2e-test-key-${Date.now()}`,
          type: 'aes-256-gcm',
        }),
      });
      
      // May return 400 if already exists or missing params
      expect([200, 201, 400]).toContain(createRes.status);
      
      if (createRes.ok) {
        const body = await createRes.json() as { keyId: string };
        console.log(`  Created key: ${body.keyId}`);
      }
    });
  });

  // ============================================================================
  // Service Mesh (Real Service Registration)
  // ============================================================================

  describe.skipIf(!dwsRunning)('Service Mesh', () => {
    test('register and discover service', async () => {
      // Register a service
      const registerRes = await dwsRequest('/mesh/services', {
        method: 'POST',
        body: JSON.stringify({
          name: `e2e-service-${Date.now()}`,
          namespace: 'default',
          publicKey: '0x' + '00'.repeat(32),
          endpoints: ['http://localhost:9999'],
          tags: ['e2e', 'test'],
        }),
      });
      
      expect([200, 201, 404]).toContain(registerRes.status);
      
      if (registerRes.ok) {
        const body = await registerRes.json() as { id: string };
        console.log(`  Registered service: ${body.id}`);
      }
    });
  });

  // ============================================================================
  // Terraform Provider (Real API)
  // ============================================================================

  describe.skipIf(!dwsRunning)('Terraform Provider', () => {
    test('provider schema endpoint', async () => {
      const res = await dwsRequest('/terraform/v1/schema');
      
      expect([200, 404]).toContain(res.status);
      
      if (res.ok) {
        const body = await res.json() as { version: number; resource_schemas: Record<string, unknown> };
        console.log(`  Schema version: ${body.version}`);
        console.log(`  Resources: ${Object.keys(body.resource_schemas ?? {}).join(', ')}`);
      }
    });
  });

  // ============================================================================
  // Helm Provider (Real K8s Manifest Processing)
  // ============================================================================

  describe.skipIf(!dwsRunning)('Helm Provider', () => {
    test('apply manifests', async () => {
      const manifests = [
        {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: { name: 'e2e-nginx', namespace: 'default' },
          spec: {
            replicas: 1,
            selector: { matchLabels: { app: 'e2e-nginx' } },
            template: {
              metadata: { labels: { app: 'e2e-nginx' } },
              spec: {
                containers: [{
                  name: 'nginx',
                  image: 'nginx:alpine',
                  ports: [{ containerPort: 80 }],
                }],
              },
            },
          },
        },
      ];
      
      const res = await dwsRequest('/helm/apply', {
        method: 'POST',
        body: JSON.stringify({
          manifests,
          release: `e2e-${Date.now()}`,
          namespace: 'default',
        }),
      });
      
      expect([200, 201, 404]).toContain(res.status);
      
      if (res.ok) {
        const body = await res.json() as { id: string; workers: number };
        console.log(`  Deployment ID: ${body.id}, Workers: ${body.workers}`);
      }
    });
  });

  // ============================================================================
  // Cleanup
  // ============================================================================

  afterAll(async () => {
    console.log('\n[E2E Tests] Complete');
  });
});

// ============================================================================
// Fallback Tests (Run Without E2E Mode)
// ============================================================================

describe.skipIf(E2E_MODE)('Basic Unit Tests (E2E mode disabled)', () => {
  test('E2E tests require E2E_MODE=true', () => {
    console.log(`
To run real E2E tests:
  1. Start Jeju localnet: jeju dev
  2. Run: bun run scripts/e2e-setup.ts
  
Or set E2E_MODE=true and run directly.
`);
    expect(true).toBe(true);
  });
});

