/**
 * Server Integration Tests
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createServer } from '../src/server';
import { resetConfig } from '../src/config';
import { clearNonceCache } from '../src/services/nonce-manager';

const app = createServer();

describe('Health Endpoints', () => {
  beforeAll(() => {
    resetConfig();
    clearNonceCache();
  });

  afterAll(() => {
    clearNonceCache();
  });

  test('GET / returns service info', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.service).toBe('Jeju x402 Facilitator');
    expect(body.version).toBe('1.0.0');
    expect(body.status).toBeDefined();
    expect(body.endpoints).toBeDefined();
    expect(body.endpoints.verify).toBe('POST /verify');
    expect(body.endpoints.settle).toBe('POST /settle');
  });

  test('GET /health returns ok', async () => {
    const res = await app.request('/health');
    // May return 503 if RPC is not available, but should have valid JSON
    const body = await res.json();
    expect(body.status).toBeDefined();
    expect(body.timestamp).toBeDefined();
  });

  test('GET /ready returns readiness status', async () => {
    const res = await app.request('/ready');
    const body = await res.json();
    expect(body.status).toBeDefined();
    expect(body.timestamp).toBeDefined();
  });
});

describe('Supported Schemes Endpoint', () => {
  test('GET /supported returns supported schemes', async () => {
    const res = await app.request('/supported');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.kinds).toBeInstanceOf(Array);
    expect(body.x402Version).toBe(1);
    expect(body.facilitator).toBeDefined();
    expect(body.facilitator.name).toBe('Jeju x402 Facilitator');
  });

  test('GET /supported includes jeju network with both exact and upto schemes', async () => {
    const res = await app.request('/supported');
    const body = await res.json();

    const jejuSchemes = body.kinds.filter((k: { scheme: string; network: string }) => k.network === 'jeju');
    expect(jejuSchemes.length).toBeGreaterThanOrEqual(2);
    
    const exactScheme = jejuSchemes.find((k: { scheme: string }) => k.scheme === 'exact');
    const uptoScheme = jejuSchemes.find((k: { scheme: string }) => k.scheme === 'upto');
    
    expect(exactScheme).toBeDefined();
    expect(uptoScheme).toBeDefined();
  });

  test('GET /supported/networks returns network details', async () => {
    const res = await app.request('/supported/networks');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.networks).toBeInstanceOf(Array);

    const jeju = body.networks.find((n: { network: string }) => n.network === 'jeju');
    expect(jeju).toBeDefined();
    expect(jeju.chainId).toBe(420691);
  });

  test('GET /supported/tokens/:network returns tokens', async () => {
    const res = await app.request('/supported/tokens/jeju');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.network).toBe('jeju');
    expect(body.tokens).toBeInstanceOf(Array);

    // Should have USDC
    const usdc = body.tokens.find((t: { symbol: string }) => t.symbol === 'USDC');
    expect(usdc).toBeDefined();
    expect(usdc.decimals).toBe(6);
  });

  test('GET /supported/tokens/:network returns 400 for invalid network', async () => {
    const res = await app.request('/supported/tokens/invalid-network');
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('Unsupported network');
  });
});

describe('Verify Endpoint', () => {
  test('POST /verify returns 400 for invalid JSON', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toContain('Invalid JSON');
  });

  test('POST /verify returns 400 for missing paymentHeader', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentRequirements: {},
      }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toContain('Missing paymentHeader');
  });

  test('POST /verify returns 400 for missing paymentRequirements', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
      }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toContain('Missing paymentRequirements');
  });

  test('POST /verify returns 400 for unsupported version', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 2,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {},
      }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toContain('Unsupported x402Version');
  });
});

describe('Settle Endpoint', () => {
  test('POST /settle returns 400 for invalid JSON', async () => {
    const res = await app.request('/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid JSON');
  });

  test('POST /settle returns 400 for missing paymentHeader', async () => {
    const res = await app.request('/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentRequirements: {},
      }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Missing paymentHeader');
  });

  test('POST /settle returns 400 for missing paymentRequirements', async () => {
    const res = await app.request('/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
      }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Missing paymentRequirements');
  });
});

describe('Error Handling', () => {
  test('returns 404 for unknown routes', async () => {
    const res = await app.request('/unknown/route');
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Not found');
  });

  test('CORS headers are set', async () => {
    const res = await app.request('/', {
      method: 'OPTIONS',
    });

    // Should allow all origins
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
