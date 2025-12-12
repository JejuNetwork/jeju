/**
 * ElizaOS Integration Tests
 * 
 * Tests for ElizaOS-powered agent functionality.
 */

import { test, expect } from '@playwright/test';

const COUNCIL_URL = 'http://localhost:8010';

test.describe('ElizaOS Integration', () => {
  test('health reports service status', async ({ request }) => {
    const response = await request.get(`${COUNCIL_URL}/health`);
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.service).toBe('jeju-council');
    expect(data.tee).toBeDefined();
  });

  test('council agents have specialized roles', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: 'role-test-1',
            parts: [{ kind: 'data', data: { skillId: 'get-council-status' } }]
          }
        }
      }
    });
    expect(response.ok()).toBeTruthy();
    
    const result = await response.json();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart.data.agents).toBeDefined();
    
    // Each agent should have a unique role
    const roles = new Set(dataPart.data.agents.map((a: { role: string }) => a.role));
    expect(roles.size).toBe(dataPart.data.agents.length);
  });

  test('agent card includes A2A capabilities', async ({ request }) => {
    const response = await request.get(`${COUNCIL_URL}/a2a/.well-known/agent-card.json`);
    expect(response.ok()).toBeTruthy();
    
    const card = await response.json();
    expect(card.capabilities).toBeDefined();
    expect(card.defaultInputModes).toBeDefined();
    expect(card.defaultOutputModes).toBeDefined();
    
    expect(card.defaultInputModes).toContain('text');
    expect(card.defaultInputModes).toContain('data');
  });

  test('text-based A2A messages get handled', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: 'text-test-1',
            parts: [{ kind: 'text', text: 'What is the council status?' }]
          }
        }
      }
    });
    expect(response.ok()).toBeTruthy();
    
    const result = await response.json();
    // Text messages may return error if no text handler, but response should be valid JSON-RPC
    expect(result.jsonrpc).toBe('2.0');
    expect(result.id).toBe(1);
  });

  test('data-based A2A messages work', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: 'data-test-1',
            parts: [{ kind: 'data', data: { skillId: 'get-governance-stats' } }]
          }
        }
      }
    });
    expect(response.ok()).toBeTruthy();
    
    const result = await response.json();
    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
  });

  test('MCP tools can be invoked', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/mcp/tools/call`, {
      data: {
        params: {
          name: 'assess_proposal_quality',
          arguments: {
            title: 'Test Proposal',
            summary: 'A test proposal for quality assessment',
            description: 'This is a detailed description of the test proposal.',
            proposalType: 'TECHNICAL'
          }
        }
      }
    });
    expect(response.ok()).toBeTruthy();
    
    const result = await response.json();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].type).toBe('text');
  });

  test('MCP resources can be read', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/mcp/resources/read`, {
      data: { uri: 'council://council/agents' }
    });
    expect(response.ok()).toBeTruthy();
    
    const result = await response.json();
    expect(result.contents).toBeDefined();
    expect(result.contents[0].text).toContain('Treasury');
    expect(result.contents[0].text).toContain('Code');
  });

  test('multiple skills can be called sequentially', async ({ request }) => {
    // First call
    const response1 = await request.post(`${COUNCIL_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: 'seq-1',
            parts: [{ kind: 'data', data: { skillId: 'get-council-status' } }]
          }
        }
      }
    });
    expect(response1.ok()).toBeTruthy();
    
    // Second call
    const response2 = await request.post(`${COUNCIL_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 2,
        method: 'message/send',
        params: {
          message: {
            messageId: 'seq-2',
            parts: [{ kind: 'data', data: { skillId: 'get-governance-stats' } }]
          }
        }
      }
    });
    expect(response2.ok()).toBeTruthy();
    
    // Both should succeed
    const result1 = await response1.json();
    const result2 = await response2.json();
    
    expect(result1.result).toBeDefined();
    expect(result2.result).toBeDefined();
  });

  test('A2A JSON-RPC error handling', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'invalid/method',
        params: {}
      }
    });
    expect(response.ok()).toBeTruthy();
    
    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBeDefined();
  });

  test('MCP protocol version negotiation', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/mcp/initialize`, {
      data: {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: { listChanged: true }
        },
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      }
    });
    expect(response.ok()).toBeTruthy();
    
    const result = await response.json();
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.serverInfo).toBeDefined();
    expect(result.serverInfo.name).toBeDefined();
    expect(result.capabilities.tools).toBeDefined();
    expect(result.capabilities.resources).toBeDefined();
  });
});
