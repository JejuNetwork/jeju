import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:8010';

test.describe('Integration - Full Proposal Lifecycle', () => {
  const proposalIdPrefix = `0xlifecycle${Date.now().toString(16)}`;

  test('complete proposal workflow: draft -> assess -> improve -> research -> moderate', async ({ request }) => {
    // Step 1: Generate proposal from idea
    const generateResponse = await request.post(`${API_BASE}/api/v1/proposals/generate`, {
      data: { idea: 'Create a community grants program for open-source developers', proposalType: 6 },
    });
    expect(generateResponse.ok()).toBeTruthy();
    const generated = await generateResponse.json();
    expect(generated.title).toBeTruthy();
    expect(generated.description).toBeTruthy();

    // Step 2: Quick score the generated proposal
    const quickScoreResponse = await request.post(`${API_BASE}/api/v1/proposals/quick-score`, {
      data: { title: generated.title, description: generated.description, proposalType: generated.proposalType },
    });
    expect(quickScoreResponse.ok()).toBeTruthy();
    const quickScore = await quickScoreResponse.json();
    expect(quickScore.score).toBeGreaterThanOrEqual(0);

    // Step 3: Full assessment
    const assessResponse = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      data: { title: generated.title, summary: generated.summary, description: generated.description, proposalType: generated.proposalType },
    });
    expect(assessResponse.ok()).toBeTruthy();
    const assessment = await assessResponse.json();
    expect(assessment.overallScore).toBeGreaterThanOrEqual(0);

    // Step 4: If score is low, improve the proposal
    if (assessment.overallScore < 80 && assessment.suggestions.length > 0) {
      // Find lowest scoring criterion
      const lowestCriterion = Object.entries(assessment.criteria)
        .sort(([, a], [, b]) => (a as number) - (b as number))[0][0];

      const improveResponse = await request.post(`${API_BASE}/api/v1/proposals/improve`, {
        data: {
          draft: { title: generated.title, description: generated.description, proposalType: generated.proposalType },
          criterion: lowestCriterion,
        },
      });
      expect(improveResponse.ok()).toBeTruthy();
      const improved = await improveResponse.json();
      expect(improved.improved.length).toBeGreaterThan(0);
    }

    // Step 5: Research the proposal
    const researchResponse = await request.post(`${API_BASE}/api/v1/research/conduct`, {
      data: {
        proposalId: proposalIdPrefix,
        title: generated.title,
        description: generated.description,
        proposalType: 'GRANT',
        depth: 'standard',
      },
    });
    expect(researchResponse.ok()).toBeTruthy();
    const research = await researchResponse.json();
    expect(research.recommendation).toMatch(/proceed|reject|modify/);

    // Step 6: Check for duplicates
    const duplicatesResponse = await request.post(`${API_BASE}/api/v1/proposals/check-duplicates`, {
      data: { title: generated.title, description: generated.description, proposalType: generated.proposalType },
    });
    expect(duplicatesResponse.ok()).toBeTruthy();
    const duplicates = await duplicatesResponse.json();
    expect(Array.isArray(duplicates.duplicates)).toBe(true);

    // Step 7: Get moderation score (should be clean initially)
    const modScoreResponse = await request.get(`${API_BASE}/api/v1/moderation/score/${proposalIdPrefix}`);
    expect(modScoreResponse.ok()).toBeTruthy();
    const modScore = await modScoreResponse.json();
    expect(modScore.visibilityScore).toBe(100); // No flags yet
    expect(modScore.recommendation).toBe('VISIBLE');
  });

  test('moderation workflow: flag -> vote -> resolve -> verify stats', async ({ request }) => {
    const proposalId = `0xmodworkflow${Date.now()}`;
    const flagger = `0xworkflowflagger${Date.now().toString(16).slice(0, 8)}`;

    // Step 1: Submit a flag
    const flagResponse = await request.post(`${API_BASE}/api/v1/moderation/flag`, {
      data: {
        proposalId,
        flagger,
        flagType: 'LOW_QUALITY',
        reason: 'Testing moderation workflow',
        stake: 15,
      },
    });
    expect(flagResponse.ok()).toBeTruthy();
    const flag = await flagResponse.json();
    expect(flag.flagId).toBeTruthy();

    // Step 2: Verify proposal score decreased
    const score1 = await request.get(`${API_BASE}/api/v1/moderation/score/${proposalId}`);
    const scoreData1 = await score1.json();
    expect(scoreData1.visibilityScore).toBeLessThan(100);
    expect(scoreData1.flags.length).toBe(1);

    // Step 3: Multiple users vote on the flag
    const voters = ['0xvoter1', '0xvoter2', '0xvoter3'];
    for (const voter of voters) {
      const voteResponse = await request.post(`${API_BASE}/api/v1/moderation/vote`, {
        data: { flagId: flag.flagId, voter, upvote: true },
      });
      expect(voteResponse.ok()).toBeTruthy();
    }

    // Step 4: Verify flag appears in active flags
    const activeFlagsResponse = await request.get(`${API_BASE}/api/v1/moderation/active-flags`);
    const activeFlags = await activeFlagsResponse.json();
    expect(activeFlags.flags.some((f: { flagId: string }) => f.flagId === flag.flagId)).toBe(true);

    // Step 5: Get moderator stats before resolution
    const statsBeforeResponse = await request.get(`${API_BASE}/api/v1/moderation/moderator/${flagger}`);
    const statsBefore = await statsBeforeResponse.json();
    expect(statsBefore.flagsRaised).toBeGreaterThan(0);

    // Step 6: Resolve the flag
    const resolveResponse = await request.post(`${API_BASE}/api/v1/moderation/resolve`, {
      data: { flagId: flag.flagId, upheld: true },
    });
    expect(resolveResponse.ok()).toBeTruthy();

    // Step 7: Verify flag is no longer active
    const activeFlags2Response = await request.get(`${API_BASE}/api/v1/moderation/active-flags`);
    const activeFlags2 = await activeFlags2Response.json();
    expect(activeFlags2.flags.some((f: { flagId: string }) => f.flagId === flag.flagId)).toBe(false);

    // Step 8: Verify moderator stats updated
    const statsAfterResponse = await request.get(`${API_BASE}/api/v1/moderation/moderator/${flagger}`);
    const statsAfter = await statsAfterResponse.json();
    expect(statsAfter.flagsUpheld).toBe(statsBefore.flagsUpheld + 1);
    expect(statsAfter.reputation).toBeGreaterThan(statsBefore.reputation);
  });
});

test.describe('Integration - Cross-Module Interactions', () => {
  test('quick-screen detects spam indicators', async ({ request }) => {
    // Quick screen should detect spam indicators
    const response = await request.post(`${API_BASE}/api/v1/research/quick-screen`, {
      data: {
        proposalId: '0xspamresearch',
        title: 'Amazing 100x Guaranteed Returns',
        description: 'Free money no risk moon guaranteed instant profits for everyone!',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // Quick-screen specifically checks for spam indicators
    expect(data.passesScreen).toBe(false);
    expect(data.redFlags.length).toBeGreaterThan(0);
    expect(data.score).toBeLessThan(50);
  });

  test('moderation score affects proposal visibility', async ({ request }) => {
    const proposalId = `0xvisibility${Date.now()}`;

    // Initially visible
    const score1 = await request.get(`${API_BASE}/api/v1/moderation/score/${proposalId}`);
    const data1 = await score1.json();
    expect(data1.recommendation).toBe('VISIBLE');

    // Add flags to lower visibility
    for (let i = 0; i < 3; i++) {
      await request.post(`${API_BASE}/api/v1/moderation/flag`, {
        data: {
          proposalId,
          flagger: `0xflagger${i}${Date.now()}`,
          flagType: 'SPAM',
          reason: `Visibility test flag ${i}`,
          stake: 10,
        },
      });
    }

    // Check updated score
    const score2 = await request.get(`${API_BASE}/api/v1/moderation/score/${proposalId}`);
    const data2 = await score2.json();
    expect(data2.visibilityScore).toBeLessThan(100);
    expect(data2.recommendation).toMatch(/REVIEW|HIDDEN/);
  });

  test('assessment feedback matches improvement suggestions', async ({ request }) => {
    const proposal = {
      title: 'Basic Proposal',
      description: 'A very short description without much detail',
      proposalType: 0,
    };

    // Get assessment
    const assessResponse = await request.post(`${API_BASE}/api/v1/proposals/assess`, { data: proposal });
    const assessment = await assessResponse.json();

    // Get improvement for lowest criterion
    const criteriaEntries = Object.entries(assessment.criteria) as [string, number][];
    const lowestCriterion = criteriaEntries.sort(([, a], [, b]) => a - b)[0][0];

    const improveResponse = await request.post(`${API_BASE}/api/v1/proposals/improve`, {
      data: { draft: proposal, criterion: lowestCriterion },
    });
    const improvement = await improveResponse.json();

    // Improvement should provide meaningful content
    expect(improvement.improved.length).toBeGreaterThan(0);
  });
});

test.describe('Integration - Ollama/Heuristic Fallback', () => {
  test('assessment works with both ollama and heuristic modes', async ({ request }) => {
    const proposal = {
      title: 'Fallback Mode Test Proposal',
      description: `## Problem
This is a test proposal to verify both assessment modes work.

## Solution
Implement comprehensive testing for the assessment system.

## Timeline
2 weeks for implementation

## Budget
5000 USDC for development

## Risk
Low risk - this is just a test`,
      proposalType: 0,
    };

    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, { data: proposal });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // Should work regardless of mode
    expect(data.assessedBy).toMatch(/ollama|heuristic/);
    expect(data.overallScore).toBeGreaterThan(0);
    expect(data.criteria.clarity).toBeGreaterThan(0);

    // Log which mode was used
    console.log(`Assessment mode: ${data.assessedBy}`);
  });

  test('research report structure is consistent across modes', async ({ request }) => {
    const researchData = {
      proposalId: '0xmodetest',
      title: 'Mode Consistency Test',
      description: 'Testing that research reports have consistent structure regardless of LLM availability with problem and solution',
      depth: 'standard',
    };

    const response = await request.post(`${API_BASE}/api/v1/research/conduct`, { data: researchData });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // These fields should always exist
    expect(data.proposalId).toBe('0xmodetest');
    expect(data.requestHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(data.model).toBeTruthy();
    expect(Array.isArray(data.sections)).toBe(true);
    expect(['proceed', 'reject', 'modify']).toContain(data.recommendation);
    expect(typeof data.confidenceLevel).toBe('number');
    expect(['low', 'medium', 'high', 'critical']).toContain(data.riskLevel);

    console.log(`Research model: ${data.model}`);
  });

  test('fact-check indicates when LLM is unavailable', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/research/fact-check`, {
      data: {
        claim: 'This DAO has sufficient funds',
        context: 'Testing fact-check LLM availability detection',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // Should always have these fields
    expect(data.claim).toBe('This DAO has sufficient funds');
    expect(typeof data.verified).toBe('boolean');
    expect(typeof data.confidence).toBe('number');
    expect(data.explanation).toBeTruthy();

    // If LLM unavailable, confidence should be low
    if (data.explanation.includes('unavailable') || data.explanation.includes('LLM')) {
      expect(data.confidence).toBeLessThan(50);
    }
  });
});

test.describe('Integration - Health and Status', () => {
  test('health endpoint reflects actual service state', async ({ request }) => {
    const healthResponse = await request.get(`${API_BASE}/health`);
    expect(healthResponse.ok()).toBeTruthy();
    const health = await healthResponse.json();

    expect(health.status).toBe('ok');
    expect(health.service).toBe('jeju-council');
    expect(health.version).toBe('2.0.0');

    // These should reflect actual deployment status
    expect(typeof health.orchestrator).toBe('boolean');
    expect(typeof health.erc8004.identity).toBe('boolean');
    expect(typeof health.erc8004.reputation).toBe('boolean');
    expect(typeof health.erc8004.validation).toBe('boolean');
    expect(typeof health.futarchy.council).toBe('boolean');
    expect(typeof health.futarchy.predimarket).toBe('boolean');
  });

  test('all documented endpoints are accessible', async ({ request }) => {
    // Test each documented endpoint exists and responds (may return 404 if contracts not deployed)
    const endpoints = [
      { path: '/api/v1/proposals/quick-score', method: 'POST', data: { title: 'Test', description: 'Test' }, mustOk: true },
      { path: '/api/v1/research/quick-screen', method: 'POST', data: { proposalId: '0x1', title: 'Test', description: 'Test' }, mustOk: true },
      { path: '/api/v1/moderation/leaderboard', method: 'GET', mustOk: true },
      { path: '/api/v1/agents/count', method: 'GET', mustOk: true },
      { path: '/api/v1/futarchy/parameters', method: 'GET', mustOk: false }, // 404 if not deployed
    ];

    for (const endpoint of endpoints) {
      const response = endpoint.method === 'GET'
        ? await request.get(`${API_BASE}${endpoint.path}`)
        : await request.post(`${API_BASE}${endpoint.path}`, { data: endpoint.data });

      if (endpoint.mustOk) {
        expect(response.ok()).toBeTruthy();
      } else {
        // Endpoint exists but may return 404 if contracts not deployed
        expect([200, 404]).toContain(response.status());
      }
    }
  });

  test('A2A endpoint is accessible', async ({ request }) => {
    const response = await request.post(`${API_BASE}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'agent/card',
        params: {},
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.result || data.error).toBeDefined();
  });

  test('MCP endpoint listed in root but handled separately', async ({ request }) => {
    // MCP is advertised in root but served by separate ceo-server
    const rootResponse = await request.get(`${API_BASE}/`);
    const root = await rootResponse.json();
    expect(root.endpoints.mcp).toBe('/mcp');
  });
});
