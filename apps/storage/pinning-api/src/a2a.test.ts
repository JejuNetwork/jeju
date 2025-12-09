/**
 * A2A Integration Tests for IPFS Storage Service
 * 
 * These tests require a running server. They skip gracefully if unavailable.
 */

import { describe, test, expect, beforeAll } from 'bun:test';

const BASE_URL = process.env.IPFS_API_URL || 'http://localhost:3100';
let serverAvailable = false;

async function checkServer(): Promise<boolean> {
  const response = await fetch(`${BASE_URL}/health`, { 
    signal: AbortSignal.timeout(2000) 
  }).catch(() => null);
  return response?.ok ?? false;
}

describe('IPFS A2A Agent', () => {
  beforeAll(async () => {
    serverAvailable = await checkServer();
    if (!serverAvailable) {
      console.log(`⚠️  Server not running at ${BASE_URL} - skipping A2A integration tests`);
    }
  });

  test('should serve agent card at well-known endpoint', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${BASE_URL}/.well-known/agent-card.json`);
    
    expect(response.status).toBe(200);
    const card = await response.json();
    
    expect(card.protocolVersion).toBe('0.3.0');
    expect(card.name).toBe('Jeju IPFS Storage Service');
    expect(card.description).toContain('Decentralized file storage');
  });

  test('should list all IPFS storage skills', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${BASE_URL}/.well-known/agent-card.json`);
    const card = await response.json();
    
    const skillIds = card.skills.map((s: { id: string }) => s.id);
    
    expect(skillIds).toContain('upload-file');
    expect(skillIds).toContain('pin-existing-cid');
    expect(skillIds).toContain('retrieve-file');
    expect(skillIds).toContain('list-pins');
    expect(skillIds).toContain('calculate-cost');
    expect(skillIds).toContain('get-storage-stats');
  });

  test('should execute calculate-cost skill', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const request = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'test-001',
          parts: [
            {
              kind: 'data',
              data: {
                skillId: 'calculate-cost',
                sizeBytes: 10485760, // 10 MB
                durationMonths: 3,
              },
            },
          ],
        },
      },
      id: 1,
    };

    const response = await fetch(`${BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(200);
    const result = await response.json();

    expect(result.jsonrpc).toBe('2.0');
    expect(result.result).toBeDefined();
    expect(result.result.parts).toBeDefined();

    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
    // Updated: A2A now returns costETH and costWei instead of costUSDC
    expect(dataPart.data.costETH).toBeDefined();
    expect(dataPart.data.costWei).toBeDefined();
    expect(BigInt(dataPart.data.costWei)).toBeGreaterThan(0n);
    expect(dataPart.data.sizeGB).toBeCloseTo(0.01, 2); // 10 MB ≈ 0.01 GB
  });

  test('should execute get-storage-stats skill', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const request = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'test-002',
          parts: [
            {
              kind: 'data',
              data: {
                skillId: 'get-storage-stats',
              },
            },
          ],
        },
      },
      id: 2,
    };

    const response = await fetch(`${BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(200);
    const result = await response.json();

    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
    expect(dataPart.data.totalPins).toBeDefined();
    expect(dataPart.data.totalSizeGB).toBeDefined();
  });

  test('should return error for unknown skill', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const request = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'test-003',
          parts: [
            {
              kind: 'data',
              data: {
                skillId: 'unknown-skill',
              },
            },
          ],
        },
      },
      id: 3,
    };

    const response = await fetch(`${BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(200);
    const result = await response.json();

    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart.data.error).toBe('Skill not found');
  });

  test('should handle missing skillId parameter', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const request = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'test-004',
          parts: [
            {
              kind: 'data',
              data: {},
            },
          ],
        },
      },
      id: 4,
    };

    const response = await fetch(`${BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602);
  });

  test('should handle health check', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${BASE_URL}/health`);
    expect(response.status).toBe(200);
    
    const health = await response.json();
    expect(health.status).toBe('healthy');
    expect(health.ipfs).toBeDefined();
    expect(health.database).toBeDefined();
  });

  test('should list pins via standard API', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${BASE_URL}/pins?limit=10`);
    expect(response.status).toBe(200);
    
    const result = await response.json();
    expect(result.count).toBeDefined();
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
  });
});
