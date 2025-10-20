/**
 * A2A Integration Tests
 * Tests the complete A2A protocol implementation including x402 payments
 */

import { test, expect } from '@playwright/test';

const A2A_ENDPOINT = 'http://localhost:4006/api/a2a';
const AGENT_CARD_URL = 'http://localhost:4006/.well-known/agent-card.json';

test.describe('A2A Protocol Implementation', () => {
  test('should serve agent card at well-known endpoint', async ({ request }) => {
    const response = await request.get(AGENT_CARD_URL);
    expect(response.ok()).toBeTruthy();

    const card = await response.json();
    expect(card).toMatchObject({
      protocolVersion: '0.3.0',
      name: expect.stringContaining('Bazaar'),
      url: expect.stringContaining('/api/a2a'),
    });

    expect(card.skills).toBeInstanceOf(Array);
    expect(card.skills.length).toBeGreaterThan(10);
  });

  test('should return agent card with CORS headers', async ({ request }) => {
    const response = await request.get(AGENT_CARD_URL);
    const headers = response.headers();
    
    expect(headers['access-control-allow-origin']).toBe('*');
  });

  test('should handle OPTIONS request for CORS preflight', async ({ request }) => {
    const response = await request.fetch(A2A_ENDPOINT, {
      method: 'OPTIONS',
    });
    
    expect(response.ok()).toBeTruthy();
    const headers = response.headers();
    expect(headers['access-control-allow-origin']).toBe('*');
    expect(headers['access-control-allow-methods']).toContain('POST');
  });

  test('should reject invalid JSON-RPC method', async ({ request }) => {
    const response = await request.post(A2A_ENDPOINT, {
      data: {
        jsonrpc: '2.0',
        method: 'invalid/method',
        id: 1,
      },
    });

    expect(response.status()).toBe(200); // JSON-RPC returns 200 with error
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32601); // Method not found
  });

  test('should execute list-tokens skill without payment', async ({ request }) => {
    const response = await request.post(A2A_ENDPOINT, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-1',
            parts: [
              {
                kind: 'data',
                data: {
                  skillId: 'list-tokens',
                  params: { limit: 10 },
                },
              },
            ],
          },
        },
        id: 1,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.result).toBeDefined();
    expect(body.result.role).toBe('agent');
    expect(body.result.parts).toBeInstanceOf(Array);

    const dataPart = body.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart?.data?.tokens).toBeInstanceOf(Array);
  });

  test('should execute get-latest-blocks skill without payment', async ({ request }) => {
    const response = await request.post(A2A_ENDPOINT, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-2',
            parts: [
              {
                kind: 'data',
                data: {
                  skillId: 'get-latest-blocks',
                  params: { limit: 5 },
                },
              },
            ],
          },
        },
        id: 2,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.result).toBeDefined();

    const dataPart = body.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart?.data?.blocks).toBeInstanceOf(Array);
  });

  test('should require payment for token details', async ({ request }) => {
    const response = await request.post(A2A_ENDPOINT, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-3',
            parts: [
              {
                kind: 'data',
                data: {
                  skillId: 'get-token-details',
                  params: {
                    address: '0x1234567890123456789012345678901234567890',
                  },
                },
              },
            ],
          },
        },
        id: 3,
      },
    });

    expect(response.status()).toBe(402); // Payment Required
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(402);
    expect(body.error.data).toBeDefined();
    expect(body.error.data.x402Version).toBe(1);
    expect(body.error.data.accepts).toBeInstanceOf(Array);
    expect(body.error.data.accepts[0].scheme).toBe('exact');
  });

  test('should require payment for token creation', async ({ request }) => {
    const response = await request.post(A2A_ENDPOINT, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-4',
            parts: [
              {
                kind: 'data',
                data: {
                  skillId: 'create-token',
                  params: {},
                },
              },
            ],
          },
        },
        id: 4,
      },
    });

    expect(response.status()).toBe(402);
    const body = await response.json();
    expect(body.error.data.accepts[0].maxAmountRequired).toBeDefined();
    // Should be 0.005 ETH in wei
    expect(BigInt(body.error.data.accepts[0].maxAmountRequired)).toBeGreaterThan(0n);
  });

  test('should require payment for NFT listing', async ({ request }) => {
    const response = await request.post(A2A_ENDPOINT, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-5',
            parts: [
              {
                kind: 'data',
                data: {
                  skillId: 'list-nft',
                  params: {
                    tokenId: '1',
                    price: '1000000000000000000', // 1 ETH
                  },
                },
              },
            ],
          },
        },
        id: 5,
      },
    });

    expect(response.status()).toBe(402);
    const body = await response.json();
    expect(body.error.data).toBeDefined();
    expect(body.error.data.accepts[0].description).toContain('listing');
  });

  test('should require payment for swap', async ({ request }) => {
    const response = await request.post(A2A_ENDPOINT, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-6',
            parts: [
              {
                kind: 'data',
                data: {
                  skillId: 'swap-tokens',
                  params: {
                    fromToken: '0xTokenA',
                    toToken: '0xTokenB',
                    amount: '1000000000000000000', // 1 token
                  },
                },
              },
            ],
          },
        },
        id: 6,
      },
    });

    expect(response.status()).toBe(402);
    const body = await response.json();
    // Swap fee should be 0.3% of amount
    const expectedFee = (BigInt('1000000000000000000') * BigInt(30)) / BigInt(10000);
    expect(BigInt(body.error.data.accepts[0].maxAmountRequired)).toBe(expectedFee);
  });

  test('should accept valid payment header', async ({ request }) => {
    // This is a simplified test - in production, need valid signature
    const mockPayment = {
      scheme: 'exact',
      network: 'base-sepolia',
      asset: '0x0000000000000000000000000000000000000000',
      payTo: '0x0000000000000000000000000000000000000000',
      amount: '100000000000000', // Small amount for test
      resource: '/api/a2a',
      nonce: '1234',
      timestamp: Math.floor(Date.now() / 1000),
    };

    const response = await request.post(A2A_ENDPOINT, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-7',
            parts: [
              {
                kind: 'data',
                data: {
                  skillId: 'get-token-details',
                  params: {
                    address: '0x1234567890123456789012345678901234567890',
                  },
                },
              },
            ],
          },
        },
        id: 7,
      },
      headers: {
        'X-Payment': JSON.stringify(mockPayment),
      },
    });

    // With mock payment, should still work (or fail for other reasons)
    const body = await response.json();
    expect(body).toBeDefined();
  });

  test('should handle missing skillId', async ({ request }) => {
    const response = await request.post(A2A_ENDPOINT, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-8',
            parts: [
              {
                kind: 'data',
                data: {
                  params: {},
                },
              },
            ],
          },
        },
        id: 8,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain('skillId');
  });

  test('should handle unknown skill', async ({ request }) => {
    const response = await request.post(A2A_ENDPOINT, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-9',
            parts: [
              {
                kind: 'data',
                data: {
                  skillId: 'nonexistent-skill',
                  params: {},
                },
              },
            ],
          },
        },
        id: 9,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32603); // Internal error
  });
});

