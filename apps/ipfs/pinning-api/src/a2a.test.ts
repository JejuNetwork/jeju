/**
 * A2A Integration Tests for IPFS Storage Service
 */

import { describe, test, expect, beforeAll } from 'bun:test';

const BASE_URL = process.env.IPFS_API_URL || 'http://localhost:3100';

describe('IPFS A2A Agent', () => {
  beforeAll(async () => {
    // Wait for service to be ready
    let retries = 5;
    while (retries > 0) {
      try {
        const response = await fetch(`${BASE_URL}/health`);
        if (response.ok) break;
      } catch (e) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        retries--;
      }
    }
  });

  test('should serve agent card at well-known endpoint', async () => {
    const response = await fetch(`${BASE_URL}/.well-known/agent-card.json`);
    
    expect(response.status).toBe(200);
    const card = await response.json();
    
    expect(card.protocolVersion).toBe('0.3.0');
    expect(card.name).toBe('Jeju IPFS Storage Service');
    expect(card.description).toContain('Decentralized file storage');
  });

  test('should list all IPFS storage skills', async () => {
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
    expect(dataPart.data.costUSDC).toBeGreaterThan(0);
    expect(dataPart.data.sizeGB).toBeCloseTo(0.01, 2); // 10 MB ≈ 0.01 GB
  });

  test('should execute get-storage-stats skill', async () => {
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
    const response = await fetch(`${BASE_URL}/health`);
    expect(response.status).toBe(200);
    
    const health = await response.json();
    expect(health.status).toBe('healthy');
    expect(health.ipfs).toBeDefined();
    expect(health.database).toBeDefined();
  });

  test('should list pins via standard API', async () => {
    const response = await fetch(`${BASE_URL}/pins?limit=10`);
    expect(response.status).toBe(200);
    
    const result = await response.json();
    expect(result.count).toBeDefined();
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
  });
});
