/**
 * JejuDA Server Tests
 */

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test';
import { DAServer } from './server';
import { keccak256 } from 'ethers';

// Mock IPFS responses
const mockIPFSData = new Map<string, Buffer>();
let mockIPFSHealthy = true;

// Mock fetch for IPFS API calls
const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();

    // IPFS health check
    if (url.includes('/api/v0/id')) {
      if (!mockIPFSHealthy) {
        return new Response('', { status: 503 });
      }
      return new Response(
        JSON.stringify({
          ID: 'QmTest123',
          PublicKey: 'testkey',
          Addresses: [],
          AgentVersion: 'test',
          ProtocolVersion: 'test',
        }),
        { status: 200 }
      );
    }

    // IPFS add
    if (url.includes('/api/v0/add')) {
      const body = init?.body;
      if (body instanceof FormData) {
        const file = body.get('file') as Blob;
        const buffer = Buffer.from(await file.arrayBuffer());
        // Generate a fake CID based on content hash
        const cid = `Qm${keccak256(buffer).slice(2, 48)}`;
        mockIPFSData.set(cid, buffer);
        return new Response(
          JSON.stringify({ Hash: cid, Size: buffer.length.toString(), Name: 'file' }),
          { status: 200 }
        );
      }
      return new Response('Invalid request', { status: 400 });
    }

    // IPFS pin add
    if (url.includes('/api/v0/pin/add')) {
      return new Response(JSON.stringify({ Pins: [] }), { status: 200 });
    }

    // IPFS gateway get
    if (url.includes('/ipfs/')) {
      const cid = url.split('/ipfs/')[1];
      const data = mockIPFSData.get(cid);
      if (data) {
        return new Response(data, { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }

    // Fallback to original fetch
    return originalFetch(input, init);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('JejuDA Server', () => {
  let server: DAServer;

  beforeAll(async () => {
    server = new DAServer({
      port: 3199,
      ipfsApiUrl: 'http://localhost:5001',
      ipfsGatewayUrl: 'http://localhost:8080',
      dataDir: '/tmp/jejuda-test',
    });
    await server.init();
  });

  describe('PUT /put', () => {
    test('stores data and returns commitment', async () => {
      const app = server.getApp();
      const testData = Buffer.from('Hello, JejuDA!');
      const expectedCommitment = keccak256(testData);

      const response = await app.request('/put', {
        method: 'PUT',
        body: testData,
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.commitment).toBe(expectedCommitment);
      expect(json.cid).toMatch(/^Qm/);
      expect(json.size).toBe(testData.length);
      expect(json.timestamp).toBeGreaterThan(0);
    });

    test('rejects empty data', async () => {
      const app = server.getApp();

      const response = await app.request('/put', {
        method: 'PUT',
        body: Buffer.alloc(0),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Empty data');
    });

    test('handles max size data (128KB)', async () => {
      const app = server.getApp();
      const maxData = Buffer.alloc(128 * 1024, 'x'); // 128KB (max blob size)
      const expectedCommitment = keccak256(maxData);

      const response = await app.request('/put', {
        method: 'PUT',
        body: maxData,
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.commitment).toBe(expectedCommitment);
      expect(json.size).toBe(maxData.length);
    });

    test('rejects data exceeding max size', async () => {
      const app = server.getApp();
      const oversizedData = Buffer.alloc(128 * 1024 + 1, 'x'); // 128KB + 1 byte

      const response = await app.request('/put', {
        method: 'PUT',
        body: oversizedData,
      });

      expect(response.status).toBe(413);
      const json = await response.json();
      expect(json.error).toContain('exceeds max size');
    });

    test('handles binary data', async () => {
      const app = server.getApp();
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      const expectedCommitment = keccak256(binaryData);

      const response = await app.request('/put', {
        method: 'PUT',
        body: binaryData,
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.commitment).toBe(expectedCommitment);
    });
  });

  describe('GET /get/:commitment', () => {
    test('retrieves data by commitment', async () => {
      const app = server.getApp();
      const testData = Buffer.from('Retrieve me!');

      // First, store the data
      const putResponse = await app.request('/put', {
        method: 'PUT',
        body: testData,
      });
      const { commitment } = await putResponse.json();

      // Then retrieve it
      const getResponse = await app.request(`/get/${commitment}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.headers.get('Content-Type')).toBe('application/octet-stream');
      expect(getResponse.headers.get('X-DA-Commitment')).toBe(commitment);

      const retrievedData = Buffer.from(await getResponse.arrayBuffer());
      expect(retrievedData.toString()).toBe(testData.toString());
    });

    test('handles commitment without 0x prefix', async () => {
      const app = server.getApp();
      const testData = Buffer.from('Test without prefix');

      const putResponse = await app.request('/put', {
        method: 'PUT',
        body: testData,
      });
      const { commitment } = await putResponse.json();

      // Remove 0x prefix
      const commitmentWithoutPrefix = commitment.slice(2);
      const getResponse = await app.request(`/get/${commitmentWithoutPrefix}`);

      expect(getResponse.status).toBe(200);
    });

    test('returns 404 for unknown commitment', async () => {
      const app = server.getApp();
      const fakeCommitment = '0x' + '0'.repeat(64);

      const response = await app.request(`/get/${fakeCommitment}`);

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error).toBe('Commitment not found');
    });

    test('returns 400 for invalid commitment format (too short)', async () => {
      const app = server.getApp();

      const response = await app.request('/get/0x1234');

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Invalid commitment format');
    });

    test('returns 400 for invalid commitment format (non-hex)', async () => {
      const app = server.getApp();
      const invalidCommitment = '0x' + 'g'.repeat(64); // 'g' is not hex

      const response = await app.request(`/get/${invalidCommitment}`);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Invalid commitment format');
    });
  });

  describe('Health endpoints', () => {
    test('GET /health returns healthy status', async () => {
      mockIPFSHealthy = true;
      const app = server.getApp();

      const response = await app.request('/health');

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.status).toBe('healthy');
      expect(json.ipfs).toBe(true);
      expect(json.version).toBe('1.0.0');
      expect(json.uptime).toBeGreaterThan(0);
    });

    test('GET /health returns degraded when IPFS is down', async () => {
      mockIPFSHealthy = false;
      const app = server.getApp();

      const response = await app.request('/health');

      expect(response.status).toBe(503);
      const json = await response.json();
      expect(json.status).toBe('degraded');
      expect(json.ipfs).toBe(false);

      mockIPFSHealthy = true; // Reset
    });

    test('GET /ready returns ready when healthy', async () => {
      mockIPFSHealthy = true;
      const app = server.getApp();

      const response = await app.request('/ready');

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.ready).toBe(true);
    });

    test('GET /ready returns not ready when IPFS is down', async () => {
      mockIPFSHealthy = false;
      const app = server.getApp();

      const response = await app.request('/ready');

      expect(response.status).toBe(503);
      const json = await response.json();
      expect(json.ready).toBe(false);
      expect(json.reason).toBe('IPFS unavailable');

      mockIPFSHealthy = true; // Reset
    });
  });

  describe('Metrics', () => {
    test('GET /metrics returns Prometheus format', async () => {
      const app = server.getApp();

      const response = await app.request('/metrics');

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/plain');

      const text = await response.text();
      expect(text).toContain('jejuda_puts_total');
      expect(text).toContain('jejuda_gets_total');
      expect(text).toContain('jejuda_bytes_total');
      expect(text).toContain('jejuda_cache_size');
      expect(text).toContain('jejuda_uptime_seconds');
    });

    test('GET /stats returns JSON stats', async () => {
      const app = server.getApp();

      const response = await app.request('/stats');

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(typeof json.totalPuts).toBe('number');
      expect(typeof json.totalGets).toBe('number');
      expect(typeof json.totalBytes).toBe('number');
      expect(typeof json.cacheSize).toBe('number');
      expect(typeof json.uptime).toBe('number');
    });
  });

  describe('End-to-end flow', () => {
    test('full put/get cycle with verification', async () => {
      const app = server.getApp();
      const testData = Buffer.from(JSON.stringify({
        batchIndex: 12345,
        transactions: ['tx1', 'tx2', 'tx3'],
        timestamp: Date.now(),
      }));

      // 1. Store batch data
      const putResponse = await app.request('/put', {
        method: 'PUT',
        body: testData,
      });
      expect(putResponse.status).toBe(200);

      const { commitment, cid } = await putResponse.json();
      expect(commitment).toMatch(/^0x[a-f0-9]{64}$/);
      expect(cid).toMatch(/^Qm/);

      // 2. Retrieve by commitment
      const getResponse = await app.request(`/get/${commitment}`);
      expect(getResponse.status).toBe(200);

      // 3. Verify data integrity
      const retrievedData = Buffer.from(await getResponse.arrayBuffer());
      expect(retrievedData.toString()).toBe(testData.toString());

      // 4. Verify commitment matches
      const computedCommitment = keccak256(retrievedData);
      expect(computedCommitment).toBe(commitment);
    });

    test('simulates op-batcher and op-node interaction', async () => {
      const app = server.getApp();

      // Simulate op-batcher sending batch data
      const batchData = Buffer.from('L2 batch data: block 1000-1010');
      
      // op-batcher: PUT batch data
      const putResponse = await app.request('/put', {
        method: 'PUT',
        body: batchData,
      });
      expect(putResponse.status).toBe(200);

      const { commitment } = await putResponse.json();

      // op-batcher posts commitment to L1 (simulated)
      console.log(`[op-batcher] Posted commitment to L1: ${commitment}`);

      // op-node: reads commitment from L1 and retrieves data
      const getResponse = await app.request(`/get/${commitment}`);
      expect(getResponse.status).toBe(200);

      const retrieved = Buffer.from(await getResponse.arrayBuffer());
      expect(retrieved.toString()).toBe(batchData.toString());

      // op-node: verifies commitment
      const verifiedCommitment = keccak256(retrieved);
      expect(verifiedCommitment).toBe(commitment);
      console.log(`[op-node] Verified batch data for commitment: ${commitment}`);
    });
  });
});

describe('CommitmentStore', () => {
  test('persists and loads commitments', async () => {
    const { CommitmentStore } = await import('./store');
    const store = new CommitmentStore('/tmp/jejuda-store-test');
    await store.init();

    const commitment = '0x' + '1'.repeat(64);
    const cid = 'QmTestCID123';

    // Set commitment
    await store.set(commitment, cid, 1024);

    // Should be in cache
    expect(store.has(commitment)).toBe(true);
    expect(store.get(commitment)?.cid).toBe(cid);

    // Create new store to test persistence
    const store2 = new CommitmentStore('/tmp/jejuda-store-test');
    await store2.init();

    // Should load from disk
    const loaded = await store2.loadIfMissing(commitment);
    expect(loaded?.cid).toBe(cid);
  });
});

describe('IPFSClient', () => {
  test('add and get roundtrip', async () => {
    const { IPFSClient } = await import('./ipfs');
    const client = new IPFSClient('http://localhost:5001', 'http://localhost:8080');

    const testData = Buffer.from('IPFS roundtrip test');
    
    // Add
    const cid = await client.add(testData);
    expect(cid).toMatch(/^Qm/);

    // Get
    const retrieved = await client.get(cid);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.toString()).toBe(testData.toString());
  });

  test('isHealthy returns true when mock is healthy', async () => {
    mockIPFSHealthy = true;
    const { IPFSClient } = await import('./ipfs');
    const client = new IPFSClient('http://localhost:5001', 'http://localhost:8080');

    const healthy = await client.isHealthy();
    expect(healthy).toBe(true);
  });

  test('isHealthy returns false when mock is unhealthy', async () => {
    mockIPFSHealthy = false;
    const { IPFSClient } = await import('./ipfs');
    const client = new IPFSClient('http://localhost:5001', 'http://localhost:8080');

    const healthy = await client.isHealthy();
    expect(healthy).toBe(false);

    mockIPFSHealthy = true; // Reset
  });
});

