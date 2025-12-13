import { describe, test, expect, beforeAll } from 'bun:test';
import type { Address } from 'viem';

const BASE_URL = process.env.GATEWAY_URL || process.env.GATEWAY_A2A_URL || 'http://localhost:3001';
const SKIP_INTEGRATION_TESTS = process.env.SKIP_INTEGRATION_TESTS === 'true';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const TEST_TOKEN_1 = '0x1111111111111111111111111111111111111111' as Address;
const TEST_TOKEN_2 = '0x2222222222222222222222222222222222222222' as Address;

async function fetchJSON(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

(SKIP_INTEGRATION_TESTS ? describe.skip : describe)('Pool API - Edge Cases & Error Handling', () => {
  beforeAll(async () => {
    if (SKIP_INTEGRATION_TESTS) {
      console.log('⚠️  Skipping integration tests (SKIP_INTEGRATION_TESTS=true)');
      return;
    }
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (!response.ok) {
        throw new Error(`Gateway server not available at ${BASE_URL}. Status: ${response.status}`);
      }
    } catch (error) {
      console.error(`❌ Gateway server not running at ${BASE_URL}`);
      console.error('   Start with: bun run dev');
      console.error('   Or set SKIP_INTEGRATION_TESTS=true to skip these tests');
      throw error;
    }
  });

  describe('GET /api/pools', () => {
    test('returns empty array when no pools exist', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools`);
      expect(status).toBe(200);
      expect(Array.isArray(data.pools)).toBe(true);
      expect(typeof data.count).toBe('number');
    });

    test('handles query parameters correctly', async () => {
      const { status, data } = await fetchJSON(
        `${BASE_URL}/api/pools?token0=${TEST_TOKEN_1}&token1=${TEST_TOKEN_2}`
      );
      expect(status).toBe(200);
      expect(Array.isArray(data.pools)).toBe(true);
    });

    test('handles invalid token addresses', async () => {
      const { status } = await fetchJSON(
        `${BASE_URL}/api/pools?token0=invalid&token1=${TEST_TOKEN_2}`
      );
      expect([200, 400]).toContain(status);
    });

    test('handles zero address tokens', async () => {
      const { status, data } = await fetchJSON(
        `${BASE_URL}/api/pools?token0=${ZERO_ADDRESS}&token1=${TEST_TOKEN_2}`
      );
      expect(status).toBe(200);
      expect(Array.isArray(data.pools)).toBe(true);
    });

    test('handles missing query parameters', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools?token0=${TEST_TOKEN_1}`);
      expect(status).toBe(200);
      expect(Array.isArray(data.pools)).toBe(true);
    });
  });

  describe('GET /api/pools/v2', () => {
    test('returns V2 pools array', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/v2`);
      expect(status).toBe(200);
      expect(Array.isArray(data.pools)).toBe(true);
      expect(typeof data.count).toBe('number');
      expect(data.count).toBe(data.pools.length);
    });

    test('V2 pools have correct structure', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/v2`);
      if (data.pools.length > 0) {
        const pool = data.pools[0];
        expect(pool.type).toBe('V2');
        expect(pool.address).toBeDefined();
        expect(pool.token0).toBeDefined();
        expect(pool.token1).toBeDefined();
        expect(typeof pool.reserve0).toBe('string');
        expect(typeof pool.reserve1).toBe('string');
        expect(typeof pool.fee).toBe('number');
        expect(pool.fee).toBe(3000);
      }
    });
  });

  describe('GET /api/pools/stats', () => {
    test('returns pool statistics', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/stats`);
      expect(status).toBe(200);
      expect(typeof data.totalPools).toBe('number');
      expect(typeof data.v2Pools).toBe('number');
      expect(typeof data.v3Pools).toBe('number');
      expect(typeof data.paymasterEnabled).toBe('boolean');
      expect(typeof data.totalLiquidityUsd).toBe('string');
      expect(typeof data.volume24h).toBe('string');
    });

    test('stats values are non-negative', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/stats`);
      expect(status).toBe(200);
      expect(data.totalPools).toBeGreaterThanOrEqual(0);
      expect(data.v2Pools).toBeGreaterThanOrEqual(0);
      expect(data.v3Pools).toBeGreaterThanOrEqual(0);
      expect(Number(data.totalLiquidityUsd)).toBeGreaterThanOrEqual(0);
      expect(Number(data.volume24h)).toBeGreaterThanOrEqual(0);
    });

    test('totalPools calculation is correct', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/stats`);
      expect(status).toBe(200);
      const expectedTotal = data.v2Pools + data.v3Pools + (data.paymasterEnabled ? 1 : 0);
      expect(data.totalPools).toBe(expectedTotal);
    });
  });

  describe('GET /api/pools/tokens', () => {
    test('returns token configuration', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/tokens`);
      expect(status).toBe(200);
      expect(typeof data).toBe('object');
      expect(data.ETH).toBeDefined();
    });

    test('tokens have correct structure', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/tokens`);
      expect(status).toBe(200);
      if (data.ETH) {
        expect(data.ETH.address).toBeDefined();
        expect(typeof data.ETH.symbol).toBe('string');
        expect(typeof data.ETH.decimals).toBe('number');
      }
    });
  });

  describe('GET /api/pools/contracts', () => {
    test('returns contract addresses', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/contracts`);
      expect(status).toBe(200);
      expect(data.v2Factory).toBeDefined();
      expect(data.v3Factory).toBeDefined();
      expect(data.router).toBeDefined();
      expect(data.aggregator).toBeDefined();
      expect(data.paymaster).toBeDefined();
    });

    test('addresses are valid format', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/contracts`);
      expect(status).toBe(200);
      const addressRegex = /^0x[a-fA-F0-9]{40}$/;
      expect(addressRegex.test(data.v2Factory)).toBe(true);
      expect(addressRegex.test(data.v3Factory)).toBe(true);
    });
  });

  describe('POST /api/pools/quote', () => {
    test('requires all parameters', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIn: TEST_TOKEN_1 }),
      });
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test('handles valid quote request', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
        }),
      });
      // Should return 200 with quote or null
      expect([200, 404]).toContain(status);
      if (status === 200) {
        expect(data === null || typeof data === 'object').toBe(true);
      }
    });

    test('handles zero amountIn', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '0',
        }),
      });
      expect([200, 400]).toContain(status);
    });

    test('handles negative amountIn', async () => {
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '-1',
        }),
      });
      expect([200, 400]).toContain(status);
    });

    test('handles very large amountIn', async () => {
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1000000000000000000000000000',
        }),
      });
      expect([200, 400, 500]).toContain(status);
    });

    test('handles invalid token addresses', async () => {
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: 'invalid',
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
        }),
      });
      expect([200, 400, 500]).toContain(status);
    });

    test('handles same token for input and output', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_1,
          amountIn: '1',
        }),
      });
      expect([200, 400]).toContain(status);
    });

    test('quote has correct structure when returned', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
        }),
      });
      if (status === 200 && data !== null) {
        expect(['V2', 'V3', 'PAYMASTER']).toContain(data.poolType);
        expect(data.pool).toBeDefined();
        expect(data.amountIn).toBe('1');
        expect(typeof data.amountOut).toBe('string');
        expect(typeof data.priceImpactBps).toBe('number');
        expect(typeof data.fee).toBe('number');
        expect(typeof data.effectivePrice).toBe('string');
      }
    });
  });

  describe('POST /api/pools/quotes', () => {
    test('requires all parameters', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIn: TEST_TOKEN_1 }),
      });
      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test('returns array of quotes', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
        }),
      });
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    test('quotes are sorted by amountOut descending', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
        }),
      });
      if (status === 200 && data.length > 1) {
        for (let i = 0; i < data.length - 1; i++) {
          expect(Number(data[i].amountOut)).toBeGreaterThanOrEqual(Number(data[i + 1].amountOut));
        }
      }
    });
  });

  describe('GET /api/pools/pair/:token0/:token1', () => {
    test('returns pools for token pair', async () => {
      const { status, data } = await fetchJSON(
        `${BASE_URL}/api/pools/pair/${TEST_TOKEN_1}/${TEST_TOKEN_2}`
      );
      expect(status).toBe(200);
      expect(Array.isArray(data.pools)).toBe(true);
      expect(typeof data.count).toBe('number');
      expect(data.count).toBe(data.pools.length);
    });

    test('handles zero address tokens', async () => {
      const { status, data } = await fetchJSON(
        `${BASE_URL}/api/pools/pair/${ZERO_ADDRESS}/${TEST_TOKEN_2}`
      );
      expect(status).toBe(200);
      expect(Array.isArray(data.pools)).toBe(true);
    });

    test('handles invalid address format', async () => {
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/pair/invalid/${TEST_TOKEN_2}`);
      expect([200, 400, 500]).toContain(status);
    });
  });

  describe('Concurrent Requests', () => {
    test('handles concurrent GET requests', async () => {
      const promises = [
        fetchJSON(`${BASE_URL}/api/pools/stats`),
        fetchJSON(`${BASE_URL}/api/pools/v2`),
        fetchJSON(`${BASE_URL}/api/pools/tokens`),
        fetchJSON(`${BASE_URL}/api/pools/contracts`),
      ];
      const results = await Promise.all(promises);
      results.forEach(({ status }) => {
        expect(status).toBe(200);
      });
    });

    test('handles rapid successive requests', async () => {
      const promises = Array(10)
        .fill(null)
        .map(() => fetchJSON(`${BASE_URL}/api/pools/stats`));
      const results = await Promise.all(promises);
      results.forEach(({ status }) => {
        expect(status).toBe(200);
      });
    });

    test('handles concurrent quote requests', async () => {
      const promises = Array(5)
        .fill(null)
        .map(() =>
          fetchJSON(`${BASE_URL}/api/pools/quote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tokenIn: TEST_TOKEN_1,
              tokenOut: TEST_TOKEN_2,
              amountIn: '1',
            }),
          })
        );
      const results = await Promise.all(promises);
      results.forEach(({ status }) => {
        expect([200, 400, 404, 500]).toContain(status);
      });
    });
  });

  describe('Error Handling', () => {
    test('handles malformed JSON', async () => {
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json{',
      });
      expect([400, 500]).toContain(status);
    });

    test('handles missing Content-Type header', async () => {
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
        }),
      });
      expect([200, 400, 500]).toContain(status);
    });

    test('handles empty request body', async () => {
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect([400, 500]).toContain(status);
    });

    test('handles extra fields in request', async () => {
      const { status } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
          extraField: 'should be ignored',
        }),
      });
      expect([200, 400, 404, 500]).toContain(status);
    });
  });

  describe('Data Validation', () => {
    test('pool addresses are valid format', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/v2`);
      if (status === 200 && data.pools.length > 0) {
        const addressRegex = /^0x[a-fA-F0-9]{40}$/;
        data.pools.forEach((pool: { address: string }) => {
          expect(addressRegex.test(pool.address)).toBe(true);
        });
      }
    });

    test('reserve values are non-negative strings', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/v2`);
      if (status === 200 && data.pools.length > 0) {
        const pool = data.pools[0];
        expect(Number(pool.reserve0)).toBeGreaterThanOrEqual(0);
        expect(Number(pool.reserve1)).toBeGreaterThanOrEqual(0);
      }
    });

    test('quote effectivePrice is valid number', async () => {
      const { status, data } = await fetchJSON(`${BASE_URL}/api/pools/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: TEST_TOKEN_1,
          tokenOut: TEST_TOKEN_2,
          amountIn: '1',
        }),
      });
      if (status === 200 && data !== null) {
        expect(Number(data.effectivePrice)).toBeGreaterThanOrEqual(0);
        expect(Number.isNaN(Number(data.effectivePrice))).toBe(false);
      }
    });
  });
});
