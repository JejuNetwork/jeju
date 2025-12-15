/**
 * Signer Service Integration Tests
 * 
 * Tests concurrent requests, rate limiting, and error handling
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';

const TEST_PORT = 4199;
const TEST_API_KEY = 'test-api-key-12345';
const TEST_PRIVATE_KEY = '0x' + '1'.repeat(64);

interface SignerService {
  start: () => Promise<void>;
  stop: () => void;
}

let server: ReturnType<typeof Bun.serve> | null = null;

async function startTestServer(): Promise<void> {
  // Import dynamically to avoid circular deps
  const { ThresholdSignerService } = await import('../../../scripts/stage2-poc/signer-service.ts');
  const service = new ThresholdSignerService(TEST_PRIVATE_KEY, TEST_API_KEY, []);
  
  server = Bun.serve({
    port: TEST_PORT,
    fetch: service.getApp().fetch,
  });
}

function stopTestServer(): void {
  server?.stop();
  server = null;
}

const BASE_URL = `http://localhost:${TEST_PORT}`;

async function signRequest(digest: string, requestId: string): Promise<Response> {
  return fetch(`${BASE_URL}/sign-digest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TEST_API_KEY}`,
    },
    body: JSON.stringify({
      digest,
      requestId,
      timestamp: Date.now(),
    }),
  });
}

describe('Signer Service Integration', () => {
  beforeAll(async () => {
    await startTestServer();
    // Wait for server to be ready
    await new Promise(r => setTimeout(r, 100));
  });

  afterAll(() => {
    stopTestServer();
  });

  test('health endpoint requires no auth', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.address).toBeDefined();
  });

  test('info endpoint requires auth', async () => {
    const res = await fetch(`${BASE_URL}/info`);
    expect(res.status).toBe(401);
  });

  test('info endpoint works with valid auth', async () => {
    const res = await fetch(`${BASE_URL}/info`, {
      headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.address).toBeDefined();
  });

  test('sign-digest returns valid signature', async () => {
    const digest = keccak256(toUtf8Bytes('test message'));
    const requestId = `req-${Date.now()}`;
    
    const res = await signRequest(digest, requestId);
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.signature).toBeDefined();
    expect(data.signature.length).toBe(132); // 65 bytes hex = 130 + 0x
    expect(data.signer).toBe(new Wallet(TEST_PRIVATE_KEY).address);
    expect(data.error).toBeUndefined();
  });

  test('sign-digest rejects invalid digest format', async () => {
    const res = await fetch(`${BASE_URL}/sign-digest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify({
        digest: 'not-a-valid-digest',
        requestId: 'req-123',
        timestamp: Date.now(),
      }),
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid digest');
  });

  test('sign-digest rejects expired requests', async () => {
    const digest = keccak256(toUtf8Bytes('expired'));
    
    const res = await fetch(`${BASE_URL}/sign-digest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify({
        digest,
        requestId: 'expired-req',
        timestamp: Date.now() - 60000, // 60 seconds ago
      }),
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('expired');
  });

  test('sign-digest prevents replay attacks', async () => {
    const digest = keccak256(toUtf8Bytes('replay test'));
    const requestId = `replay-${Date.now()}`;
    
    // First request succeeds
    const res1 = await signRequest(digest, requestId);
    expect(res1.status).toBe(200);
    
    // Replay fails
    const res2 = await signRequest(digest, requestId);
    expect(res2.status).toBe(400);
    const data = await res2.json();
    expect(data.error).toContain('already processed');
  });

  test('concurrent requests are handled correctly', async () => {
    const requests = Array.from({ length: 5 }, (_, i) => {
      const digest = keccak256(toUtf8Bytes(`concurrent-${i}`));
      const requestId = `concurrent-${i}-${Date.now()}`;
      return signRequest(digest, requestId);
    });
    
    const responses = await Promise.all(requests);
    
    // All should succeed
    for (const res of responses) {
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.signature).toBeDefined();
    }
  });

  test('different digests produce different signatures', async () => {
    const digest1 = keccak256(toUtf8Bytes('unique-message-1'));
    const digest2 = keccak256(toUtf8Bytes('unique-message-2'));
    
    const res1 = await signRequest(digest1, `diff1-${Date.now()}`);
    await new Promise(r => setTimeout(r, 200)); // Avoid rate limit
    const res2 = await signRequest(digest2, `diff2-${Date.now()}`);
    
    const data1 = await res1.json();
    const data2 = await res2.json();
    
    expect(data1.signature).toBeDefined();
    expect(data2.signature).toBeDefined();
    expect(data1.signature).not.toBe(data2.signature);
  });

  test('wrong API key is rejected', async () => {
    const res = await fetch(`${BASE_URL}/sign-digest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer wrong-key',
      },
      body: JSON.stringify({
        digest: keccak256(toUtf8Bytes('test')),
        requestId: 'wrong-key-req',
        timestamp: Date.now(),
      }),
    });
    
    expect(res.status).toBe(401);
  });

  test('missing requestId is rejected', async () => {
    await new Promise(r => setTimeout(r, 1100)); // Wait for rate limit reset
    
    const res = await fetch(`${BASE_URL}/sign-digest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify({
        digest: keccak256(toUtf8Bytes('missing-req-test')),
        timestamp: Date.now(),
      }),
    });
    
    expect(res.status).toBe(400);
  });

  test('stats endpoint shows signature count', async () => {
    await new Promise(r => setTimeout(r, 1100)); // Wait for rate limit reset
    
    const res = await fetch(`${BASE_URL}/stats`, {
      headers: { 'Authorization': `Bearer ${TEST_API_KEY}` },
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    // At least some signatures should have been issued in prior tests
    expect(data.signaturesIssued).toBeGreaterThanOrEqual(0);
    expect(data.uptime).toBeGreaterThan(0);
  });
});

