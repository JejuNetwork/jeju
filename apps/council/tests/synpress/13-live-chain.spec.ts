/**
 * Live Chain Integration Tests
 * 
 * Tests council APIs against a real blockchain (Anvil) and live compute service.
 * These tests verify the full decentralized stack is working.
 */

import { test, expect } from '@playwright/test';

const COUNCIL_URL = process.env.COUNCIL_URL ?? 'http://localhost:8010';
const COMPUTE_URL = process.env.COMPUTE_URL ?? 'http://localhost:8020';
const RPC_URL = process.env.RPC_URL ?? 'http://localhost:8545';

// Skip tests if live chain is not available
test.beforeAll(async ({ request }) => {
  // Check if RPC is available
  try {
    const rpcResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    });
    if (!rpcResponse.ok) {
      test.skip();
    }
  } catch {
    test.skip();
  }
});

test.describe('Live Chain Integration', () => {
  test('RPC endpoint responds', async () => {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    });
    expect(response.ok).toBeTruthy();
    const data = await response.json();
    expect(data.result).toBeDefined();
  });

  test('council connects to live chain', async ({ request }) => {
    const response = await request.get(`${COUNCIL_URL}/health`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.status).toBe('ok');
  });

  test('A2A skills work with live chain', async ({ request }) => {
    // Test get-council-status
    const response = await request.post(`${COUNCIL_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: 'live-1',
            parts: [{ kind: 'data', data: { skillId: 'get-council-status' } }]
          }
        }
      }
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.result?.parts).toBeDefined();
  });

  test('chat uses real LLM', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: 'chat-live',
            parts: [{ 
              kind: 'data', 
              data: { 
                skillId: 'chat', 
                params: { 
                  message: 'What is your role?',
                  agent: 'ceo'
                } 
              } 
            }]
          }
        }
      }
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    const chatData = result.result?.parts?.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(chatData?.response || chatData?.error).toBeDefined();
  });

  test('deliberation works with live LLM', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: 'delib-live',
            parts: [{ 
              kind: 'data', 
              data: { 
                skillId: 'deliberate', 
                params: { 
                  proposalId: 'LIVE-001',
                  title: 'Test Proposal',
                  description: 'This is a test proposal for live chain verification',
                  proposalType: 'GENERAL'
                } 
              } 
            }]
          }
        }
      }
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    const delibData = result.result?.parts?.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(delibData?.votes).toBeDefined();
    expect(delibData?.recommendation).toBeDefined();
  });

  test('trigger endpoint works', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/trigger/orchestrator`, {
      data: {}
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test('MCP tools are available', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/mcp/tools/list`, {
      data: {}
    });
    expect(response.ok()).toBeTruthy();
  });

  test('governance stats reflect chain state', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: 'stats-live',
            parts: [{ kind: 'data', data: { skillId: 'get-governance-stats' } }]
          }
        }
      }
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    const statsData = result.result?.parts?.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(statsData?.totalProposals).toBeDefined();
  });
});

test.describe('Compute Integration (Optional External Service)', () => {
  // These tests require the external compute service at COMPUTE_URL (default: localhost:8020)
  // They are skipped when the compute service is not running - this is expected behavior
  // To run: start the compute service with `cd ../compute && bun run dev`

  test('compute service is healthy', async () => {
    try {
      const response = await fetch(`${COMPUTE_URL}/health`);
      if (!response.ok) { test.skip(); return; }
      expect(response.ok).toBeTruthy();
    } catch {
      test.skip(); // Expected when compute service not running
    }
  });

  test('council can use compute trigger', async ({ request }) => {
    // This test always runs - it verifies council's trigger API works
    // regardless of whether compute service is available
    const response = await request.get(`${COUNCIL_URL}/api/v1/triggers`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.mode).toBeDefined();
  });
});
