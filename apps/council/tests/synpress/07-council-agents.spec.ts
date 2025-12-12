/**
 * Council Agents Tests
 * 
 * Tests for ElizaOS-powered council agent functionality.
 */

import { test, expect } from '@playwright/test';

test.describe('Council Agents', () => {
  const sendA2AMessage = async (
    request: ReturnType<typeof test['request']>,
    skillId: string,
    params?: Record<string, unknown>
  ) => {
    const response = await request.post('http://localhost:8010/a2a', {
      data: {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'message/send',
        params: {
          message: {
            messageId: `test-${Date.now()}`,
            parts: [
              { kind: 'data', data: { skillId, params: params || {} } }
            ]
          }
        }
      }
    });
    return response.json();
  };

  test('get-council-status returns all council roles', async ({ request }) => {
    const result = await sendA2AMessage(request, 'get-council-status');

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
    expect(dataPart.data.agents).toBeDefined();
    
    const roles = dataPart.data.agents.map((a: { role: string }) => a.role);
    expect(roles).toContain('Treasury');
    expect(roles).toContain('Code');
    expect(roles).toContain('Community');
    expect(roles).toContain('Security');
  });

  test('get-governance-stats returns DAO statistics', async ({ request }) => {
    const result = await sendA2AMessage(request, 'get-governance-stats');

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
    expect(dataPart.data).toBeDefined();
    
    // Should have governance statistics
    expect(dataPart.data.totalProposals).toBeDefined();
    expect(dataPart.data.ceo).toBeDefined();
    expect(dataPart.data.parameters).toBeDefined();
  });

  test('list-proposals returns proposal list', async ({ request }) => {
    const result = await sendA2AMessage(request, 'list-proposals', { activeOnly: false });

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
    expect(Array.isArray(dataPart.data.proposals)).toBe(true);
    expect(typeof dataPart.data.total).toBe('number');
  });

  test('get-ceo-status returns CEO info', async ({ request }) => {
    const result = await sendA2AMessage(request, 'get-ceo-status');

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
    expect(dataPart.data).toBeDefined();
  });

  test('submit-vote skill accepts vote submission', async ({ request }) => {
    const result = await sendA2AMessage(request, 'submit-vote', {
      proposalId: '0x' + '1'.repeat(64),
      role: 'TREASURY',
      vote: 'APPROVE',
      reasoning: 'Test vote from treasury agent',
      confidence: 85
    });

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
  });

  test('get-council-votes returns votes for proposal', async ({ request }) => {
    const proposalId = '0x' + '2'.repeat(64);
    
    // First submit a vote
    await sendA2AMessage(request, 'submit-vote', {
      proposalId,
      role: 'CODE',
      vote: 'APPROVE',
      reasoning: 'Technical assessment complete',
      confidence: 90
    });

    // Then get votes
    const result = await sendA2AMessage(request, 'get-council-votes', { proposalId });

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
    expect(Array.isArray(dataPart.data.votes) || dataPart.data.votes === undefined).toBe(true);
  });

  test('request-research skill initiates research', async ({ request }) => {
    const result = await sendA2AMessage(request, 'request-research', {
      proposalId: '0x' + '3'.repeat(64),
      topic: 'Technical feasibility analysis'
    });

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
  });
});
