/**
 * CEO Operations Tests
 * 
 * Tests for CEO skills (limited without blockchain).
 */

import { test, expect } from '@playwright/test';

test.describe('CEO Operations', () => {
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

  test('back proposal skill returns transaction info', async ({ request }) => {
    const result = await sendA2AMessage(request, 'back-proposal', {
      proposalId: '0x1234567890123456789012345678901234567890123456789012345678901234',
      stakeAmount: '1000000000000000000',
      reputationWeight: 50
    });

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart.data.action).toBe('backProposal');
    expect(dataPart.data.params.proposalId).toBeDefined();
  });

  test('cast veto skill returns transaction info', async ({ request }) => {
    const result = await sendA2AMessage(request, 'cast-veto', {
      proposalId: '0x1234567890123456789012345678901234567890123456789012345678901234',
      category: 0,
      reason: 'Test reason for veto'
    });

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart.data.action).toBe('castVetoVote');
  });

  test('request research returns info (local mode free)', async ({ request }) => {
    const result = await sendA2AMessage(request, 'request-research', {
      proposalId: '0x1234567890123456789012345678901234567890123456789012345678901234',
      description: 'Test proposal for research'
    });

    // Research returns either data or error depending on Ollama availability
    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart.data).toBeDefined();
    // If Ollama is available, we get research data; otherwise, we get an error
    if (dataPart.data.error) {
      expect(dataPart.data.error).toContain('Ollama');
    } else {
      expect(dataPart.data.proposalId).toBeDefined();
      expect(dataPart.data.model).toBeDefined();
    }
  });
});
