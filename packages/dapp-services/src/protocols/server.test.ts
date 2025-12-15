/**
 * Tests for Unified Protocol Server
 */

import { describe, expect, test } from 'bun:test';
import {
  createUnifiedServer,
  skillSuccess,
  skillError,
  skillRequiresPayment,
  type UnifiedServerConfig,
  type SkillContext,
} from './server';

// Test configuration
const testConfig: UnifiedServerConfig = {
  name: 'Test Service',
  description: 'A test service for unit testing',
  version: '1.0.0',
  
  skills: [
    {
      id: 'test-skill',
      name: 'Test Skill',
      description: 'A test skill that returns success',
      tags: ['test'],
    },
    {
      id: 'error-skill',
      name: 'Error Skill',
      description: 'A skill that returns an error',
      tags: ['test', 'error'],
    },
    {
      id: 'payment-skill',
      name: 'Payment Skill',
      description: 'A skill that requires payment',
      tags: ['test', 'payment'],
    },
  ],
  
  resources: [
    { uri: 'test://resource', name: 'Test Resource', description: 'A test resource', mimeType: 'application/json' },
  ],
  
  tools: [
    {
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input value' },
        },
        required: ['input'],
      },
    },
  ],
  
  executeSkill: async (skillId: string, params: Record<string, unknown>, _context: SkillContext) => {
    switch (skillId) {
      case 'test-skill':
        return skillSuccess('Test successful', { input: params.input, output: 'success' });
      case 'error-skill':
        return skillError('Test error', { code: 'TEST_ERROR' });
      case 'payment-skill':
        return skillRequiresPayment('/a2a', '1000000000000000', 'Test payment');
      default:
        return skillError('Unknown skill', { skillId });
    }
  },
  
  readResource: async (uri: string, _context: SkillContext) => {
    if (uri === 'test://resource') {
      return { data: 'test data' };
    }
    throw new Error('Resource not found');
  },
  
  callTool: async (name: string, args: Record<string, unknown>, _context: SkillContext) => {
    if (name === 'test_tool') {
      return { result: { input: args.input, processed: true }, isError: false };
    }
    return { result: { error: 'Unknown tool' }, isError: true };
  },
};

describe('Unified Protocol Server', () => {
  const app = createUnifiedServer(testConfig);
  
  describe('Health and Info Endpoints', () => {
    test('GET /health returns ok status', async () => {
      const req = new Request('http://localhost/health');
      const res = await app.fetch(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.service).toBe('Test Service');
    });
    
    test('GET / returns service info', async () => {
      const req = new Request('http://localhost/');
      const res = await app.fetch(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.description).toBe('A test service for unit testing');
      expect(body.endpoints.a2a).toBe('/a2a');
      expect(body.endpoints.mcp).toBe('/mcp');
    });
  });
  
  describe('Agent Card', () => {
    test('GET /.well-known/agent-card.json returns agent card', async () => {
      const req = new Request('http://localhost/.well-known/agent-card.json');
      const res = await app.fetch(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.protocolVersion).toBe('0.3.0');
      expect(body.skills).toHaveLength(3);
    });
    
    test('GET /a2a/.well-known/agent-card.json returns same agent card', async () => {
      const req = new Request('http://localhost/a2a/.well-known/agent-card.json');
      const res = await app.fetch(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.protocolVersion).toBe('0.3.0');
    });
  });
  
  describe('A2A Protocol', () => {
    test('POST /a2a with valid skill returns success', async () => {
      const req = new Request('http://localhost/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: {
            message: {
              messageId: 'test-1',
              parts: [{ kind: 'data', data: { skillId: 'test-skill', input: 'hello' } }],
            },
          },
          id: 1,
        }),
      });
      const res = await app.fetch(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.parts[0].text).toBe('Test successful');
      expect(body.result.parts[1].data.output).toBe('success');
    });
    
    test('POST /a2a with error skill returns error data', async () => {
      const req = new Request('http://localhost/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: {
            message: {
              messageId: 'test-2',
              parts: [{ kind: 'data', data: { skillId: 'error-skill' } }],
            },
          },
          id: 2,
        }),
      });
      const res = await app.fetch(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.parts[0].text).toBe('Test error');
      expect(body.result.parts[1].data.error).toBe('Test error');
    });
    
    test('POST /a2a with payment-required skill returns 402', async () => {
      const req = new Request('http://localhost/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: {
            message: {
              messageId: 'test-3',
              parts: [{ kind: 'data', data: { skillId: 'payment-skill' } }],
            },
          },
          id: 3,
        }),
      });
      const res = await app.fetch(req);
      
      expect(res.status).toBe(402);
      const body = await res.json();
      expect(body.error.code).toBe(402);
      expect(body.error.data.x402Version).toBe(1);
    });
    
    test('POST /a2a with invalid method returns error', async () => {
      const req = new Request('http://localhost/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'invalid/method',
          params: {},
          id: 4,
        }),
      });
      const res = await app.fetch(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.error.code).toBe(-32601);
    });
  });
  
  describe('MCP Protocol', () => {
    test('POST /mcp/initialize returns server info', async () => {
      const req = new Request('http://localhost/mcp/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await app.fetch(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.protocolVersion).toBe('2024-11-05');
      expect(body.serverInfo.name).toBe('Test Service');
      expect(body.capabilities.resources).toBe(true);
      expect(body.capabilities.tools).toBe(true);
    });
    
    test('POST /mcp/resources/list returns resources', async () => {
      const req = new Request('http://localhost/mcp/resources/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await app.fetch(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.resources).toHaveLength(1);
      expect(body.resources[0].uri).toBe('test://resource');
    });
    
    test('POST /mcp/tools/list returns tools', async () => {
      const req = new Request('http://localhost/mcp/tools/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await app.fetch(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe('test_tool');
    });
    
    test('GET /mcp returns server overview', async () => {
      const req = new Request('http://localhost/mcp');
      const res = await app.fetch(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.server).toBe('Test Service');
      expect(body.resources).toHaveLength(1);
      expect(body.tools).toHaveLength(1);
    });
  });
});

describe('Skill Helper Functions', () => {
  test('skillSuccess creates proper result', () => {
    const result = skillSuccess('Operation successful', { count: 5 });
    expect(result.message).toBe('Operation successful');
    expect(result.data.count).toBe(5);
    expect(result.requiresPayment).toBeUndefined();
  });
  
  test('skillError creates proper error result', () => {
    const result = skillError('Operation failed', { code: 'ERR_001' });
    expect(result.message).toBe('Operation failed');
    expect(result.data.error).toBe('Operation failed');
    expect(result.data.code).toBe('ERR_001');
  });
});

