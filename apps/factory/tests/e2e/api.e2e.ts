/**
 * API Endpoints E2E Tests
 * Tests REST, MCP, and A2A endpoints
 */

import { test, expect } from '@playwright/test';

test.describe('REST API', () => {
  test.describe('Health', () => {
    test('should return health status', async ({ request }) => {
      const response = await request.get('/api/health');
      // Health can return 503 if services are degraded, but should still return JSON
      const data = await response.json();
      expect(data.status).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(data.status);
    });
  });

  test.describe('Bounties API', () => {
    test('should list bounties', async ({ request }) => {
      const response = await request.get('/api/bounties');
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.bounties).toBeDefined();
      expect(Array.isArray(data.bounties)).toBeTruthy();
    });

    test('should filter bounties by status', async ({ request }) => {
      const response = await request.get('/api/bounties?status=open');
      expect(response.ok()).toBeTruthy();
    });
  });

  test.describe('Jobs API', () => {
    test('should list jobs', async ({ request }) => {
      const response = await request.get('/api/jobs');
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.jobs).toBeDefined();
    });
  });

  test.describe('Git API', () => {
    test('should list repositories', async ({ request }) => {
      const response = await request.get('/api/git');
      expect(response.ok()).toBeTruthy();
    });
  });

  test.describe('Packages API', () => {
    test('should list packages', async ({ request }) => {
      const response = await request.get('/api/packages');
      expect(response.ok()).toBeTruthy();
    });
  });

  test.describe('Models API', () => {
    test('should list models', async ({ request }) => {
      const response = await request.get('/api/models');
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.models).toBeDefined();
    });
  });

  test.describe('Containers API', () => {
    test('should list containers', async ({ request }) => {
      const response = await request.get('/api/containers');
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.containers).toBeDefined();
    });
  });

  test.describe('Projects API', () => {
    test('should list projects', async ({ request }) => {
      const response = await request.get('/api/projects');
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.projects).toBeDefined();
    });
  });

  test.describe('Issues API', () => {
    test('should list issues', async ({ request }) => {
      const response = await request.get('/api/issues');
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.issues).toBeDefined();
    });
  });

  test.describe('Pull Requests API', () => {
    test('should list pull requests', async ({ request }) => {
      const response = await request.get('/api/pulls');
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.pulls).toBeDefined();
    });
  });

  test.describe('Datasets API', () => {
    test('should list datasets', async ({ request }) => {
      const response = await request.get('/api/datasets');
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.datasets).toBeDefined();
    });
  });

  test.describe('CI/CD API', () => {
    test('should list CI runs', async ({ request }) => {
      const response = await request.get('/api/ci');
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.runs).toBeDefined();
    });
  });
});

test.describe('MCP API', () => {
  test('should return MCP server info', async ({ request }) => {
    const response = await request.get('/api/mcp/info');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.server).toBe('jeju-factory');
    expect(data.resources).toBeDefined();
    expect(data.tools).toBeDefined();
  });

  test('should initialize MCP session', async ({ request }) => {
    const response = await request.post('/api/mcp/initialize');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.protocolVersion).toBeDefined();
    expect(data.serverInfo).toBeDefined();
    expect(data.capabilities).toBeDefined();
  });

  test('should list MCP resources', async ({ request }) => {
    const response = await request.post('/api/mcp/resources/list');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.resources).toBeDefined();
    expect(Array.isArray(data.resources)).toBeTruthy();
    expect(data.resources.length).toBeGreaterThan(0);
  });

  test('should read MCP resource', async ({ request }) => {
    const response = await request.post('/api/mcp/resources/read', {
      data: { uri: 'factory://bounties' },
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.contents).toBeDefined();
  });

  test('should list MCP tools', async ({ request }) => {
    const response = await request.post('/api/mcp/tools/list');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.tools).toBeDefined();
    expect(Array.isArray(data.tools)).toBeTruthy();
    expect(data.tools.length).toBeGreaterThan(0);
  });

  test('should call MCP tool', async ({ request }) => {
    const response = await request.post('/api/mcp/tools/call', {
      data: {
        name: 'list_bounties',
        arguments: { status: 'open' },
      },
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.content).toBeDefined();
  });

  test('should list MCP prompts', async ({ request }) => {
    const response = await request.post('/api/mcp/prompts/list');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.prompts).toBeDefined();
  });
});

test.describe('A2A API', () => {
  test('should return agent card', async ({ request }) => {
    const response = await request.get('/api/a2a');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.name).toBe('Jeju Factory');
    expect(data.skills).toBeDefined();
    expect(Array.isArray(data.skills)).toBeTruthy();
  });

  test('should serve agent card from public', async ({ request }) => {
    const response = await request.get('/agent-card.json');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.protocolVersion).toBe('0.3.0');
    expect(data.skills).toBeDefined();
  });

  test('should handle A2A message/send', async ({ request }) => {
    const response = await request.post('/api/a2a', {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-123',
            parts: [
              { kind: 'data', data: { skillId: 'list-repos' } },
            ],
          },
        },
        id: 1,
      },
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.jsonrpc).toBe('2.0');
    expect(data.result).toBeDefined();
    expect(data.result.parts).toBeDefined();
  });

  test('should execute list-bounties skill', async ({ request }) => {
    const response = await request.post('/api/a2a', {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-456',
            parts: [
              { kind: 'data', data: { skillId: 'list-bounties' } },
            ],
          },
        },
        id: 2,
      },
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.result.parts).toBeDefined();
    const dataPart = data.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart?.data?.bounties).toBeDefined();
  });

  test('should execute search-packages skill', async ({ request }) => {
    const response = await request.post('/api/a2a', {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-789',
            parts: [
              { kind: 'data', data: { skillId: 'search-packages', query: 'sdk' } },
            ],
          },
        },
        id: 3,
      },
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.result).toBeDefined();
  });

  test('should handle unknown method', async ({ request }) => {
    const response = await request.post('/api/a2a', {
      data: {
        jsonrpc: '2.0',
        method: 'unknown/method',
        id: 99,
      },
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(-32601);
  });
});

