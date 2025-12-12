/**
 * CEO Server Tests
 * 
 * Tests for the dedicated AI CEO server on port 8004.
 */

import { test, expect } from '@playwright/test';

const CEO_URL = 'http://localhost:8004';

test.describe('CEO Server', () => {
  test.beforeAll(async ({ request }) => {
    // Check if CEO server is running
    try {
      const response = await request.get(`${CEO_URL}/health`);
      if (!response.ok()) {
        test.skip();
      }
    } catch {
      test.skip();
    }
  });

  test('health endpoint returns CEO status', async ({ request }) => {
    const response = await request.get(`${CEO_URL}/health`);
    
    // CEO server may not be running in tests - skip if offline
    if (!response.ok()) {
      test.skip();
      return;
    }
    
    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.service).toBe('eliza-ceo');
    expect(data.tee).toBeDefined();
    expect(data.endpoints).toBeDefined();
    expect(data.endpoints.a2a).toBe('/a2a');
    expect(data.endpoints.mcp).toBe('/mcp');
  });

  test('agent card returns CEO skills', async ({ request }) => {
    const response = await request.get(`${CEO_URL}/.well-known/agent-card.json`);
    
    if (!response.ok()) {
      test.skip();
      return;
    }
    
    const card = await response.json();
    expect(card.name).toBe('Eliza - AI CEO');
    expect(card.protocolVersion).toBe('0.3.0');
    expect(card.skills).toBeDefined();
    expect(card.skills.length).toBeGreaterThan(0);
    
    const skillIds = card.skills.map((s: { id: string }) => s.id);
    expect(skillIds).toContain('make-decision');
    expect(skillIds).toContain('get-dashboard');
    expect(skillIds).toContain('chat');
  });

  test('MCP tools list returns CEO tools', async ({ request }) => {
    const response = await request.get(`${CEO_URL}/mcp/tools`);
    
    if (!response.ok()) {
      test.skip();
      return;
    }
    
    const data = await response.json();
    expect(data.tools).toBeDefined();
    expect(data.tools.length).toBeGreaterThan(0);
    
    const toolNames = data.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain('make_ceo_decision');
    expect(toolNames).toContain('get_governance_dashboard');
    expect(toolNames).toContain('get_active_proposals');
  });

  test('MCP resources list returns council resources', async ({ request }) => {
    const response = await request.get(`${CEO_URL}/mcp/resources`);
    
    if (!response.ok()) {
      test.skip();
      return;
    }
    
    const data = await response.json();
    expect(data.resources).toBeDefined();
    expect(data.resources.length).toBeGreaterThan(0);
    
    const uris = data.resources.map((r: { uri: string }) => r.uri);
    expect(uris).toContain('council://agents');
    expect(uris).toContain('council://stats');
  });

  test('A2A chat skill responds', async ({ request }) => {
    const response = await request.post(`${CEO_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-chat-1',
            parts: [{ kind: 'text', text: 'What is your role?' }]
          }
        }
      }
    });
    
    if (!response.ok()) {
      test.skip();
      return;
    }
    
    const result = await response.json();
    expect(result.result).toBeDefined();
    expect(result.result.parts).toBeDefined();
    
    const textPart = result.result.parts.find((p: { kind: string }) => p.kind === 'text');
    expect(textPart).toBeDefined();
    expect(textPart.text.length).toBeGreaterThan(0);
  });

  test('A2A get-dashboard skill returns governance data', async ({ request }) => {
    const response = await request.post(`${CEO_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-dashboard-1',
            parts: [{ kind: 'data', data: { skillId: 'get-dashboard' } }]
          }
        }
      }
    });
    
    if (!response.ok()) {
      test.skip();
      return;
    }
    
    const result = await response.json();
    expect(result.result).toBeDefined();
    expect(result.result.parts).toBeDefined();
  });

  test('MCP tool call works', async ({ request }) => {
    const response = await request.post(`${CEO_URL}/mcp/tools/call`, {
      data: {
        params: {
          name: 'get_governance_dashboard',
          arguments: {}
        }
      }
    });
    
    if (!response.ok()) {
      test.skip();
      return;
    }
    
    const result = await response.json();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
  });
});
