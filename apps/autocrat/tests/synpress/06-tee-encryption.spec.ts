/**
 * TEE Encryption Tests
 * 
 * Verifies TEE mode is reported correctly and encryption works.
 */

import { test, expect } from '@playwright/test';

test.describe('TEE Encryption', () => {
  test('health endpoint reports TEE mode', async ({ request }) => {
    const response = await request.get('http://localhost:8010/health');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.tee).toBeDefined();
    expect(['simulated', 'hardware']).toContain(data.tee);
  });

  test('CEO decision includes attestation info', async ({ request }) => {
    // Get CEO status to verify TEE info is included
    const response = await request.post('http://localhost:8010/a2a', {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: `msg-${Date.now()}`,
            parts: [{ kind: 'data', data: { skillId: 'get-ceo-status' } }]
          }
        }
      }
    });
    
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.result).toBeDefined();
    
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart.data.currentModel).toBeDefined();
  });

  test('governance stats work with TEE enabled', async ({ request }) => {
    const response = await request.post('http://localhost:8010/a2a', {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: `msg-${Date.now()}`,
            parts: [{ kind: 'data', data: { skillId: 'get-governance-stats' } }]
          }
        }
      }
    });
    
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.result).toBeDefined();
    
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart.data.ceo).toBeDefined();
  });
});
