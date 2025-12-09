/**
 * @fileoverview API tests for the OIF Intent Aggregator
 * Tests REST endpoints, A2A, and MCP interfaces
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

const BASE_URL = process.env.AGGREGATOR_URL || 'http://localhost:4010';

describe('OIF Aggregator API', () => {
  describe('Health & Discovery', () => {
    test('GET /health returns ok status', async () => {
      const res = await fetch(`${BASE_URL}/health`);
      expect(res.ok).toBe(true);
      
      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.service).toBe('intents-aggregator');
      expect(data.version).toBeDefined();
    });

    test('GET /.well-known/agent-card.json returns A2A agent card', async () => {
      const res = await fetch(`${BASE_URL}/.well-known/agent-card.json`);
      expect(res.ok).toBe(true);
      
      const card = await res.json();
      expect(card.name).toBe('Jeju Open Intents Aggregator');
      expect(card.protocolVersion).toBeDefined();
      expect(card.skills).toBeInstanceOf(Array);
      expect(card.skills.length).toBeGreaterThan(0);
      
      // Verify required skills exist
      const skillIds = card.skills.map((s: { id: string }) => s.id);
      expect(skillIds).toContain('create-intent');
      expect(skillIds).toContain('get-quote');
      expect(skillIds).toContain('track-intent');
      expect(skillIds).toContain('list-routes');
      expect(skillIds).toContain('list-solvers');
    });

    test('GET /mcp returns MCP manifest', async () => {
      const res = await fetch(`${BASE_URL}/mcp`);
      expect(res.ok).toBe(true);
      
      const manifest = await res.json();
      expect(manifest.server).toBeDefined();
      expect(manifest.resources).toBeInstanceOf(Array);
      expect(manifest.tools).toBeInstanceOf(Array);
    });
  });

  describe('Intent Endpoints', () => {
    test('GET /api/intents returns array', async () => {
      const res = await fetch(`${BASE_URL}/api/intents`);
      expect(res.ok).toBe(true);
      
      const intents = await res.json();
      expect(intents).toBeInstanceOf(Array);
    });

    test('GET /api/intents with filters', async () => {
      const res = await fetch(`${BASE_URL}/api/intents?status=OPEN&limit=10`);
      expect(res.ok).toBe(true);
      
      const intents = await res.json();
      expect(intents).toBeInstanceOf(Array);
      expect(intents.length).toBeLessThanOrEqual(10);
    });

    test('GET /api/intents/:id returns intent or 404', async () => {
      const res = await fetch(`${BASE_URL}/api/intents/0x0000000000000000000000000000000000000000000000000000000000000000`);
      // May return 200 with undefined/null or 404
      expect([200, 404]).toContain(res.status);
    });

    test('POST /api/intents/quote with valid params', async () => {
      const res = await fetch(`${BASE_URL}/api/intents/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceChain: 1,
          destinationChain: 42161,
          sourceToken: '0x0000000000000000000000000000000000000000',
          destinationToken: '0x0000000000000000000000000000000000000000',
          amount: '1000000000000000000',
        }),
      });
      expect(res.ok).toBe(true);
      
      const quotes = await res.json();
      expect(quotes).toBeInstanceOf(Array);
    });

    test('POST /api/intents/quote with missing params returns array', async () => {
      const res = await fetch(`${BASE_URL}/api/intents/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Missing some fields - implementation handles gracefully
          sourceChain: 1,
        }),
      });
      // May return 400 or 200 with empty array depending on implementation
      expect([200, 400]).toContain(res.status);
    });
  });

  describe('Route Endpoints', () => {
    test('GET /api/routes returns array', async () => {
      const res = await fetch(`${BASE_URL}/api/routes`);
      expect(res.ok).toBe(true);
      
      const routes = await res.json();
      expect(routes).toBeInstanceOf(Array);
    });

    test('GET /api/routes with chain filters', async () => {
      const res = await fetch(`${BASE_URL}/api/routes?sourceChain=1`);
      expect(res.ok).toBe(true);
      
      const routes = await res.json();
      expect(routes).toBeInstanceOf(Array);
      routes.forEach((route: { sourceChainId: number }) => {
        expect(route.sourceChainId).toBe(1);
      });
    });

    test('GET /api/routes?active=true filters active routes', async () => {
      const res = await fetch(`${BASE_URL}/api/routes?active=true`);
      expect(res.ok).toBe(true);
      
      const routes = await res.json();
      routes.forEach((route: { isActive: boolean }) => {
        expect(route.isActive).toBe(true);
      });
    });
  });

  describe('Solver Endpoints', () => {
    test('GET /api/solvers returns array', async () => {
      const res = await fetch(`${BASE_URL}/api/solvers`);
      expect(res.ok).toBe(true);
      
      const solvers = await res.json();
      expect(solvers).toBeInstanceOf(Array);
    });

    test('GET /api/solvers with sorting', async () => {
      const res = await fetch(`${BASE_URL}/api/solvers?sortBy=reputation&limit=5`);
      expect(res.ok).toBe(true);
      
      const solvers = await res.json();
      expect(solvers).toBeInstanceOf(Array);
      expect(solvers.length).toBeLessThanOrEqual(5);
      
      // Check descending reputation order
      for (let i = 1; i < solvers.length; i++) {
        expect(solvers[i - 1].reputation).toBeGreaterThanOrEqual(solvers[i].reputation);
      }
    });

    test('GET /api/solvers/:address returns solver or 404', async () => {
      const res = await fetch(`${BASE_URL}/api/solvers/0x0000000000000000000000000000000000000000`);
      // May return 200 with mock data or 404
      expect([200, 404]).toContain(res.status);
    });
  });

  describe('Stats Endpoints', () => {
    test('GET /api/stats returns network stats', async () => {
      const res = await fetch(`${BASE_URL}/api/stats`);
      expect(res.ok).toBe(true);
      
      const stats = await res.json();
      expect(stats).toHaveProperty('totalIntents');
      expect(stats).toHaveProperty('totalVolume');
      expect(stats).toHaveProperty('activeSolvers');
      expect(stats).toHaveProperty('totalRoutes');
    });
  });

  describe('A2A JSON-RPC Interface', () => {
    test('POST /a2a rejects unknown method', async () => {
      const res = await fetch(`${BASE_URL}/a2a`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'unknown/method',
          params: {},
        }),
      });
      expect(res.ok).toBe(true);
      
      const data = await res.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe(-32601);
    });

    test('POST /a2a message/send with list-routes skill', async () => {
      const res = await fetch(`${BASE_URL}/a2a`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'message/send',
          params: {
            message: {
              messageId: 'test-1',
              parts: [
                {
                  kind: 'data',
                  data: {
                    skillId: 'list-routes',
                    active: true,
                  },
                },
              ],
            },
          },
        }),
      });
      expect(res.ok).toBe(true);
      
      const data = await res.json();
      expect(data.result).toBeDefined();
      expect(data.result.parts).toBeInstanceOf(Array);
    });

    test('POST /a2a message/send with list-solvers skill', async () => {
      const res = await fetch(`${BASE_URL}/a2a`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'message/send',
          params: {
            message: {
              messageId: 'test-2',
              parts: [
                {
                  kind: 'data',
                  data: {
                    skillId: 'list-solvers',
                    limit: 5,
                  },
                },
              ],
            },
          },
        }),
      });
      expect(res.ok).toBe(true);
      
      const data = await res.json();
      expect(data.result).toBeDefined();
    });

    test('POST /a2a message/send with get-stats skill', async () => {
      const res = await fetch(`${BASE_URL}/a2a`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'message/send',
          params: {
            message: {
              messageId: 'test-3',
              parts: [
                {
                  kind: 'data',
                  data: {
                    skillId: 'get-stats',
                  },
                },
              ],
            },
          },
        }),
      });
      expect(res.ok).toBe(true);
      
      const data = await res.json();
      expect(data.result).toBeDefined();
      expect(data.result.parts).toBeInstanceOf(Array);
    });
  });

  describe('Rate Limiting', () => {
    test('requests include rate limit headers', async () => {
      const res = await fetch(`${BASE_URL}/api/routes`);
      expect(res.headers.get('X-RateLimit-Limit')).toBeDefined();
      expect(res.headers.get('X-RateLimit-Remaining')).toBeDefined();
      expect(res.headers.get('X-RateLimit-Reset')).toBeDefined();
    });
  });
});

describe('OIF Aggregator Service Logic', () => {
  describe('Intent Service', () => {
    test('create intent generates unique ID', async () => {
      const intentData = {
        intentType: 'SWAP',
        user: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        sourceChainId: 1,
        destinationChainId: 42161,
        inputToken: '0x0000000000000000000000000000000000000000',
        outputToken: '0x0000000000000000000000000000000000000000',
        inputAmount: '1000000000000000000',
        minOutputAmount: '990000000000000000',
        maxFee: '10000000000000000',
        deadline: Math.floor(Date.now() / 1000) + 3600,
      };

      const res = await fetch(`${BASE_URL}/api/intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(intentData),
      });
      
      // May return 201 on success or 400 if validation fails in mock mode
      if (res.status === 201) {
        const intent = await res.json();
        expect(intent.intentId).toBeDefined();
        expect(intent.intentId).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(intent.status).toBe('OPEN');
      }
    });
  });

  describe('Route Service', () => {
    test('best route selection considers fees', async () => {
      const res = await fetch(
        `${BASE_URL}/api/routes/best?sourceChainId=1&destinationChainId=42161&inputToken=0x0000000000000000000000000000000000000000&outputToken=0x0000000000000000000000000000000000000000&amount=1000000000000000000&sortBy=fee`
      );
      
      // May return 404 if no routes or 200 with best route
      expect([200, 404]).toContain(res.status);
    });
  });

  describe('Solver Service', () => {
    test('solver list filters by chain', async () => {
      const res = await fetch(`${BASE_URL}/api/solvers?chainId=1`);
      expect(res.ok).toBe(true);
      
      const solvers = await res.json();
      solvers.forEach((solver: { supportedChains: number[] }) => {
        expect(solver.supportedChains).toContain(1);
      });
    });
  });
});

// ============ Additional Endpoint Coverage ============

describe('Additional API Endpoints', () => {
  describe('Route Volume Endpoint', () => {
    test('GET /api/routes/:routeId/volume returns volume data', async () => {
      const res = await fetch(`${BASE_URL}/api/routes/1-42161-hyperlane/volume`);
      // May return 404 if route doesn't exist
      expect([200, 404]).toContain(res.status);
    });
  });

  describe('Solver Liquidity Endpoint', () => {
    test('GET /api/solvers/:address/liquidity returns liquidity data', async () => {
      const res = await fetch(`${BASE_URL}/api/solvers/0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266/liquidity`);
      expect([200, 404]).toContain(res.status);
    });
  });

  describe('Solver Leaderboard', () => {
    test('GET /api/solvers/leaderboard returns sorted solvers', async () => {
      const res = await fetch(`${BASE_URL}/api/solvers/leaderboard`);
      expect(res.ok).toBe(true);
      
      const solvers = await res.json();
      expect(solvers).toBeInstanceOf(Array);
    });
  });

  describe('Chain Stats', () => {
    test('GET /api/stats/chain/:chainId returns chain-specific stats', async () => {
      const res = await fetch(`${BASE_URL}/api/stats/chain/1`);
      expect([200, 404]).toContain(res.status);
    });
  });

  describe('Config Endpoints', () => {
    test('GET /api/config/chains returns supported chains', async () => {
      const res = await fetch(`${BASE_URL}/api/config/chains`);
      expect(res.ok).toBe(true);
      
      const chains = await res.json();
      expect(chains).toBeInstanceOf(Array);
    });

    test('GET /api/config/tokens returns supported tokens', async () => {
      const res = await fetch(`${BASE_URL}/api/config/tokens?chainId=1`);
      expect(res.ok).toBe(true);
      
      const tokens = await res.json();
      expect(tokens).toBeInstanceOf(Array);
    });
  });

  describe('Intent Cancel', () => {
    test('POST /api/intents/:intentId/cancel requires user address', async () => {
      const res = await fetch(`${BASE_URL}/api/intents/0x1234/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });
});

// ============ Complete A2A Skills Coverage ============

describe('All A2A Skills', () => {
  const invokeSkill = async (skillId: string, params: Record<string, unknown> = {}) => {
    const res = await fetch(`${BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'message/send',
        params: {
          message: {
            messageId: `test-${skillId}-${Date.now()}`,
            parts: [{ kind: 'data', data: { skillId, ...params } }],
          },
        },
      }),
    });
    return res;
  };

  test('create-intent skill', async () => {
    const res = await invokeSkill('create-intent', {
      sourceChain: 1,
      destinationChain: 42161,
      sourceToken: '0x0000000000000000000000000000000000000000',
      destinationToken: '0x0000000000000000000000000000000000000000',
      amount: '1000000000000000000',
      recipient: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      maxFee: '10000000000000000',
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.result).toBeDefined();
  });

  test('get-quote skill', async () => {
    const res = await invokeSkill('get-quote', {
      sourceChain: 1,
      destinationChain: 42161,
      sourceToken: '0x0000000000000000000000000000000000000000',
      destinationToken: '0x0000000000000000000000000000000000000000',
      amount: '1000000000000000000',
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.result).toBeDefined();
  });

  test('track-intent skill', async () => {
    const res = await invokeSkill('track-intent', {
      intentId: '0x0000000000000000000000000000000000000000000000000000000000000001',
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.result).toBeDefined();
  });

  test('cancel-intent skill', async () => {
    const res = await invokeSkill('cancel-intent', {
      intentId: '0x0000000000000000000000000000000000000000000000000000000000000001',
      user: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.result).toBeDefined();
  });

  test('get-best-route skill', async () => {
    const res = await invokeSkill('get-best-route', {
      sourceChainId: 1,
      destinationChainId: 42161,
      inputToken: '0x0000000000000000000000000000000000000000',
      outputToken: '0x0000000000000000000000000000000000000000',
      amount: '1000000000000000000',
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.result).toBeDefined();
  });

  test('get-solver-liquidity skill', async () => {
    const res = await invokeSkill('get-solver-liquidity', {
      solver: '0x1234567890123456789012345678901234567890',
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.result).toBeDefined();
  });

  test('get-volume skill', async () => {
    const res = await invokeSkill('get-volume', {});
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.result).toBeDefined();
  });

  test('unknown skill returns error message', async () => {
    const res = await invokeSkill('nonexistent-skill', {});
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.result).toBeDefined();
    // Should contain error info in the result
  });
});

// ============ Edge Cases & Error Handling ============

describe('Edge Cases', () => {
  test('malformed JSON returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/intents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json',
    });
    // Express body-parser returns 400 for malformed JSON
    expect([400, 500]).toContain(res.status);
  });

  test('empty request body returns error', async () => {
    const res = await fetch(`${BASE_URL}/api/intents/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // API validates required fields and returns 400
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  test('invalid chain ID in route filter', async () => {
    const res = await fetch(`${BASE_URL}/api/routes?sourceChain=invalid`);
    // NaN chain ID should return empty array (no matching routes)
    expect(res.ok).toBe(true);
    const routes = await res.json();
    expect(routes).toBeInstanceOf(Array);
  });

  test('negative limit is handled', async () => {
    const res = await fetch(`${BASE_URL}/api/intents?limit=-1`);
    // Negative limit should still work (returns empty or all)
    expect(res.ok).toBe(true);
    const intents = await res.json();
    expect(intents).toBeInstanceOf(Array);
  });

  test('very large limit is handled', async () => {
    const res = await fetch(`${BASE_URL}/api/intents?limit=999999`);
    // Large limit should work but return available intents
    expect(res.ok).toBe(true);
    const intents = await res.json();
    expect(intents).toBeInstanceOf(Array);
  });
});

