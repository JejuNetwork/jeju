/**
 * @fileoverview A2A Agent discovery and interaction tests
 * @module gateway/tests/a2a/agent-discovery
 */

import { expect, test, describe } from 'bun:test';

const A2A_BASE_URL = 'http://localhost:4003';

describe('A2A Agent Card Discovery', () => {
  test('should serve agent card at well-known endpoint', async () => {
    const response = await fetch(`${A2A_BASE_URL}/.well-known/agent-card.json`);
    
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    
    const agentCard = await response.json();
    
    expect(agentCard.protocolVersion).toBe('0.3.0');
    expect(agentCard.name).toBe('Gateway Portal - Protocol Infrastructure Hub');
    expect(agentCard.description).toContain('Multi-token paymaster system');
  });

  test('should list all available skills', async () => {
    const response = await fetch(`${A2A_BASE_URL}/.well-known/agent-card.json`);
    const agentCard = await response.json();
    
    expect(agentCard.skills).toBeDefined();
    expect(Array.isArray(agentCard.skills)).toBe(true);
    expect(agentCard.skills.length).toBeGreaterThan(0);
    
    // Check for expected skills
    const skillIds = agentCard.skills.map((s: { id: string }) => s.id);
    expect(skillIds).toContain('list-protocol-tokens');
    expect(skillIds).toContain('get-node-stats');
    expect(skillIds).toContain('list-nodes');
    expect(skillIds).toContain('list-registered-apps');
    expect(skillIds).toContain('get-app-by-tag');
  });

  test('should include capability metadata', async () => {
    const response = await fetch(`${A2A_BASE_URL}/.well-known/agent-card.json`);
    const agentCard = await response.json();
    
    expect(agentCard.capabilities).toBeDefined();
    expect(agentCard.capabilities.streaming).toBe(false);
    expect(agentCard.capabilities.pushNotifications).toBe(false);
  });

  test('should specify transport preferences', async () => {
    const response = await fetch(`${A2A_BASE_URL}/.well-known/agent-card.json`);
    const agentCard = await response.json();
    
    expect(agentCard.preferredTransport).toBe('http');
    expect(agentCard.url).toContain('/a2a');
  });
});

describe('A2A JSON-RPC Communication', () => {
  test('should respond to message/send method', async () => {
    const request = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'test-msg-001',
          parts: [
            { kind: 'text', text: 'List protocol tokens' },
            { kind: 'data', data: { skillId: 'list-protocol-tokens' } }
          ]
        }
      },
      id: 1
    };
    
    const response = await fetch(`${A2A_BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    expect(response.status).toBe(200);
    
    const result = await response.json();
    expect(result.jsonrpc).toBe('2.0');
    expect(result.id).toBe(1);
    expect(result.result).toBeDefined();
  });

  test('should return error for unknown method', async () => {
    const request = {
      jsonrpc: '2.0',
      method: 'unknown/method',
      params: {},
      id: 2
    };
    
    const response = await fetch(`${A2A_BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32601);
    expect(result.error.message).toBe('Method not found');
  });

  test('should execute list-protocol-tokens skill', async () => {
    const request = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'test-msg-002',
          parts: [
            { kind: 'data', data: { skillId: 'list-protocol-tokens' } }
          ]
        }
      },
      id: 3
    };
    
    const response = await fetch(`${A2A_BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    const result = await response.json();
    
    expect(result.result.parts).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    
    expect(dataPart).toBeDefined();
    expect(dataPart.data.tokens).toBeDefined();
    expect(Array.isArray(dataPart.data.tokens)).toBe(true);
    
    // Should include all protocol tokens
    const symbols = dataPart.data.tokens.map((t: { symbol: string }) => t.symbol);
    expect(symbols).toContain('elizaOS');
    expect(symbols).toContain('CLANKER');
    expect(symbols).toContain('VIRTUAL');
    expect(symbols).toContain('CLANKERMON');
  });

  test('should execute get-node-stats skill', async () => {
    const request = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'test-msg-003',
          parts: [
            { kind: 'data', data: { skillId: 'get-node-stats' } }
          ]
        }
      },
      id: 4
    };
    
    const response = await fetch(`${A2A_BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    const result = await response.json();
    expect(result.result).toBeDefined();
    expect(result.result.parts.length).toBeGreaterThan(0);
  });

  test('should execute list-nodes skill', async () => {
    const request = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'test-msg-004',
          parts: [
            { kind: 'data', data: { skillId: 'list-nodes' } }
          ]
        }
      },
      id: 5
    };
    
    const response = await fetch(`${A2A_BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    const result = await response.json();
    expect(result.result).toBeDefined();
  });

  test('should execute list-registered-apps skill', async () => {
    const request = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'test-msg-005',
          parts: [
            { kind: 'data', data: { skillId: 'list-registered-apps' } }
          ]
        }
      },
      id: 6
    };
    
    const response = await fetch(`${A2A_BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    const result = await response.json();
    expect(result.result).toBeDefined();
  });

  test('should execute get-app-by-tag skill', async () => {
    const request = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'test-msg-006',
          parts: [
            { kind: 'data', data: { skillId: 'get-app-by-tag', tag: 'game' } }
          ]
        }
      },
      id: 7
    };
    
    const response = await fetch(`${A2A_BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    const result = await response.json();
    expect(result.result).toBeDefined();
  });

  test('should return error for unknown skill', async () => {
    const request = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'test-msg-007',
          parts: [
            { kind: 'data', data: { skillId: 'unknown-skill' } }
          ]
        }
      },
      id: 8
    };
    
    const response = await fetch(`${A2A_BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    const result = await response.json();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    
    expect(dataPart.data.error).toBe('Skill not found');
  });

  test('should handle missing params gracefully', async () => {
    const request = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {},
      id: 9
    };
    
    const response = await fetch(`${A2A_BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602);
  });
});

