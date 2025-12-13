import { test, expect } from '@playwright/test';

const A2A_PORT = process.env.DOCUMENTATION_A2A_PORT || '7778';
const A2A_BASE_URL = `http://localhost:${A2A_PORT}`;

test.describe('A2A Server Integration', () => {
  test.beforeAll(async ({ request }) => {
    // Check if A2A server is running
    try {
      const response = await request.get(`${A2A_BASE_URL}/.well-known/agent-card.json`);
      if (!response.ok()) {
        test.skip(true, 'A2A server not running - run "bun run a2a" first');
      }
    } catch {
      test.skip(true, 'A2A server not running - run "bun run a2a" first');
    }
  });

  test('agent card returns valid JSON', async ({ request }) => {
    const response = await request.get(`${A2A_BASE_URL}/.well-known/agent-card.json`);
    expect(response.status()).toBe(200);

    const card = await response.json();
    expect(card.protocolVersion).toBe('0.3.0');
    expect(card.name).toBe('Jeju Documentation');
    expect(card.skills).toHaveLength(3);
  });

  test('agent card has required fields', async ({ request }) => {
    const response = await request.get(`${A2A_BASE_URL}/.well-known/agent-card.json`);
    const card = await response.json();

    expect(card).toHaveProperty('protocolVersion');
    expect(card).toHaveProperty('name');
    expect(card).toHaveProperty('description');
    expect(card).toHaveProperty('url');
    expect(card).toHaveProperty('skills');
    expect(card).toHaveProperty('capabilities');
  });

  test('search-docs skill works', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        id: 1,
        params: {
          message: {
            messageId: 'test-1',
            parts: [{
              kind: 'data',
              data: { skillId: 'search-docs', params: { query: 'jeju' } }
            }]
          }
        }
      }
    });

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.result.parts).toHaveLength(2);
    expect(result.result.parts[0].kind).toBe('text');
    expect(result.result.parts[1].kind).toBe('data');
    expect(result.result.parts[1].data.results).toBeDefined();
  });

  test('list-topics skill works', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        id: 2,
        params: {
          message: {
            messageId: 'test-2',
            parts: [{
              kind: 'data',
              data: { skillId: 'list-topics', params: {} }
            }]
          }
        }
      }
    });

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.result.parts[1].data.topics).toBeDefined();
    expect(result.result.parts[1].data.topics.length).toBeGreaterThan(0);
  });

  test('get-page skill works', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        id: 3,
        params: {
          message: {
            messageId: 'test-3',
            parts: [{
              kind: 'data',
              data: { skillId: 'get-page', params: { page: 'index.md' } }
            }]
          }
        }
      }
    });

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.result.parts[1].data.content).toBeDefined();
    expect(result.result.parts[1].data.content).toContain('Jeju');
  });

  test('unknown skill returns error', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        id: 4,
        params: {
          message: {
            messageId: 'test-4',
            parts: [{
              kind: 'data',
              data: { skillId: 'nonexistent-skill', params: {} }
            }]
          }
        }
      }
    });

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32603);
  });

  test('unknown method returns error', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'unknown/method',
        id: 5,
        params: {}
      }
    });

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32601);
    expect(result.error.message).toBe('Method not found');
  });

  test('missing params returns error', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        id: 6,
        params: {}
      }
    });

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602);
  });

  test('missing data part returns error', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        id: 7,
        params: {
          message: {
            messageId: 'test-7',
            parts: [{ kind: 'text', text: 'hello' }]
          }
        }
      }
    });

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602);
  });

  test('search with special characters works', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        id: 8,
        params: {
          message: {
            messageId: 'test-8',
            parts: [{
              kind: 'data',
              data: { skillId: 'search-docs', params: { query: 'contract.*' } }
            }]
          }
        }
      }
    });

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.result).toBeDefined();
  });

  test('get nonexistent page returns error', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        id: 9,
        params: {
          message: {
            messageId: 'test-9',
            parts: [{
              kind: 'data',
              data: { skillId: 'get-page', params: { page: 'nonexistent-page-12345.md' } }
            }]
          }
        }
      }
    });

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32603);
  });
});

