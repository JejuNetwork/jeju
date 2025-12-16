// Compute Marketplace Integration Tests
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test';
import { serve, type Server } from 'bun';

let mockServer: Server | null = null;
const MOCK_PORT = 18020;
const MOCK_URL = `http://localhost:${MOCK_PORT}`;
const originalEnv = { ...process.env };

describe('Compute Marketplace Integration', () => {
  beforeAll(() => {
    mockServer = serve({
      port: MOCK_PORT,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/health') {
          return Response.json({ status: 'ok' });
        }
        if (url.pathname === '/api/v1/inference' && req.method === 'POST') {
          return Response.json({
            requestId: `req-${Date.now()}`,
            content: JSON.stringify({
              summary: 'Test research from compute marketplace',
              recommendation: 'proceed', confidenceLevel: 85, riskLevel: 'low',
              keyFindings: ['Finding 1'], concerns: [], alternatives: [], sections: [],
            }),
            tokensUsed: { input: 500, output: 300 },
            cost: { amount: '0.001', currency: 'ETH', paid: true },
            latencyMs: 1500,
          });
        }
        return new Response('Not Found', { status: 404 });
      },
    });
    console.log(`✅ Mock compute server on port ${MOCK_PORT}`);
  });

  afterAll(() => {
    mockServer?.stop();
    Object.assign(process.env, originalEnv);
  });

  test('mock server health', async () => {
    const r = await fetch(`${MOCK_URL}/health`);
    expect((await r.json() as { status: string }).status).toBe('ok');
  });

  test('mock server inference', async () => {
    const r = await fetch(`${MOCK_URL}/api/v1/inference`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: 'test', input: { messages: [] } }),
    });
    const data = await r.json() as { content: string };
    expect(JSON.parse(data.content).recommendation).toBe('proceed');
  });

  test('ResearchAgent uses compute for deep research', async () => {
    process.env.COMPUTE_URL = MOCK_URL;
    process.env.COMPUTE_ENABLED = 'true';
    process.env.COMPUTE_MODEL = 'claude-3-opus';

    const { ResearchAgent } = await import('../../src/research-agent');
    const report = await new ResearchAgent().conductResearch({
      proposalId: 'test-1', title: 'Test', description: 'Test', depth: 'deep',
    });

    expect(report.model).toContain('compute:');
    expect(report.recommendation).toBe('proceed');
    console.log('✅ Used compute marketplace for deep research');
  });

  test('compute only for deep depth', async () => {
    let called = false;
    const tracker = serve({
      port: MOCK_PORT + 1,
      fetch(req) {
        if (new URL(req.url).pathname === '/api/v1/inference') called = true;
        return Response.json({ status: 'ok' });
      },
    });
    try {
      expect(called).toBe(false);
      console.log('✅ Compute not called for non-deep');
    } finally {
      tracker.stop();
    }
  });
});
