/**
 * Council Operations Tests
 * 
 * Tests for council status queries (no blockchain required).
 */

import { test, expect } from '@playwright/test';

test.describe('Council Operations', () => {
  const sendA2AMessage = async (
    request: ReturnType<typeof test['request']>,
    skillId: string,
    params?: Record<string, unknown>
  ) => {
    const response = await request.post('http://localhost:8010/a2a', {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: `msg-${Date.now()}`,
            parts: [
              { kind: 'data', data: { skillId, params: params || {} } }
            ]
          }
        }
      }
    });
    return response.json();
  };

  test('get council status returns agent roles', async ({ request }) => {
    const result = await sendA2AMessage(request, 'get-council-status');

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart.data.agents).toBeDefined();
    expect(dataPart.data.agents.length).toBe(4); // Treasury, Code, Community, Security
    
    const roles = dataPart.data.agents.map((a: { role: string }) => a.role);
    expect(roles).toContain('Treasury');
    expect(roles).toContain('Code');
    expect(roles).toContain('Community');
    expect(roles).toContain('Security');
  });

  test('add commentary skill responds correctly', async ({ request }) => {
    const result = await sendA2AMessage(request, 'add-commentary', {
      proposalId: '0x1234567890123456789012345678901234567890123456789012345678901234',
      content: 'This is a test comment on the proposal.',
      sentiment: 'positive'
    });

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart.data.content).toBe('This is a test comment on the proposal.');
    expect(dataPart.data.sentiment).toBe('positive');
  });

  test('unknown skill returns error', async ({ request }) => {
    const result = await sendA2AMessage(request, 'nonexistent-skill', {});

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart.data.error).toBeDefined();
  });
});
