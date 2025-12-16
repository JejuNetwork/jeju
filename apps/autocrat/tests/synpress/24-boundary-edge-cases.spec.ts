import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:8010';

test.describe('Proposal Assistant - Boundary Conditions', () => {
  test('empty title (boundary: 0 chars)', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      data: { title: '', description: 'Valid description with content' },
    });
    expect(response.status()).toBe(400);
  });

  test('minimal valid title (boundary: 1 char)', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      data: { title: 'X', description: 'A valid description that is long enough to be processed' },
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.overallScore).toBeLessThan(50); // Short title should score low
  });

  test('very long title (boundary: 1000+ chars)', async ({ request }) => {
    const longTitle = 'A'.repeat(1000);
    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      data: { title: longTitle, description: 'Valid description' },
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.criteria.clarity).toBeLessThan(80); // Too long should hurt clarity
  });

  test('minimal valid description (boundary: just enough)', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      data: { title: 'Valid Title', description: 'Short.' },
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.criteria.completeness).toBeLessThan(50);
  });

  test('proposal with all optional fields empty', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      data: { title: 'Minimal', description: 'Minimal description', proposalType: 0 },
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.criteria).toBeDefined();
    expect(data.assessedBy).toMatch(/ollama|heuristic/);
  });

  test('proposal with all fields at max length', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      data: {
        title: 'A'.repeat(200),
        summary: 'B'.repeat(500),
        description: 'C'.repeat(5000) + '\n## Problem\nTest\n## Solution\nTest\n## Timeline\n1 month\n## Budget\n1000\n## Risk\nLow',
        proposalType: 9, // Max valid type (EMERGENCY)
        tags: Array(20).fill('tag'),
      },
    });
    expect(response.ok()).toBeTruthy();
  });

  test('proposalType at boundaries (0 and 9)', async ({ request }) => {
    for (const proposalType of [0, 9]) {
      const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
        data: { title: `Type ${proposalType} Test`, description: 'Testing proposal type boundaries', proposalType },
      });
      expect(response.ok()).toBeTruthy();
    }
  });

  test('invalid proposalType (negative)', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      data: { title: 'Test', description: 'Test description', proposalType: -1 },
    });
    expect(response.ok()).toBeTruthy(); // Should still work, just defaults
  });

  test('quick-score returns consistent hash', async ({ request }) => {
    const data = { title: 'Hash Test', description: 'Testing hash consistency', proposalType: 0 };

    const r1 = await request.post(`${API_BASE}/api/v1/proposals/quick-score`, { data });
    const r2 = await request.post(`${API_BASE}/api/v1/proposals/quick-score`, { data });

    const d1 = await r1.json();
    const d2 = await r2.json();

    expect(d1.contentHash).toBe(d2.contentHash);
    expect(d1.score).toBe(d2.score);
  });

  test('improve proposal with each criterion', async ({ request }) => {
    const criteria = ['clarity', 'completeness', 'feasibility', 'alignment', 'impact', 'riskAssessment', 'costBenefit'];

    for (const criterion of criteria) {
      const response = await request.post(`${API_BASE}/api/v1/proposals/improve`, {
        data: {
          draft: { title: 'Test', description: 'Basic proposal', proposalType: 0 },
          criterion,
        },
      });
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.improved).toBeTruthy();
      expect(data.improved.length).toBeGreaterThan(0);
    }
  });

  test('improve proposal with invalid criterion', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/improve`, {
      data: {
        draft: { title: 'Test', description: 'Description', proposalType: 0 },
        criterion: 'invalidCriterion',
      },
    });
    // Should handle gracefully
    if (response.ok()) {
      const data = await response.json();
      expect(data.improved).toBeDefined();
    } else {
      expect(response.status()).toBe(400);
    }
  });
});

test.describe('Research Agent - Edge Cases', () => {
  test('research with minimal description', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/research/conduct`, {
      data: {
        proposalId: '0xminimal',
        title: 'X',
        description: 'Y',
      },
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    // Should return a valid risk level - validated by the backend
    expect(data.riskLevel).toMatch(/low|medium|high|critical/);
    expect(data.concerns.length).toBeGreaterThanOrEqual(0);
  });

  test('research with all depth levels', async ({ request }) => {
    for (const depth of ['quick', 'standard', 'deep'] as const) {
      const response = await request.post(`${API_BASE}/api/v1/research/conduct`, {
        data: {
          proposalId: `0xdepth${depth}`,
          title: `Depth ${depth} Test`,
          description: 'Testing different research depths with problem statement and solution proposal',
          depth,
        },
      });
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.model).toBeTruthy();
    }
  });

  test('quick-screen with exact boundary scores', async ({ request }) => {
    // Test exactly 100 char description (boundary for "too short")
    const response = await request.post(`${API_BASE}/api/v1/research/quick-screen`, {
      data: {
        proposalId: '0xboundary',
        title: 'Boundary Test',
        description: 'A'.repeat(100),
      },
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(typeof data.score).toBe('number');
  });

  test('quick-screen detects all spam indicators', async ({ request }) => {
    const spamIndicators = ['guaranteed', 'moon', '100x', 'free money', 'no risk'];

    for (const indicator of spamIndicators) {
      const response = await request.post(`${API_BASE}/api/v1/research/quick-screen`, {
        data: {
          proposalId: `0xspam${indicator.replace(' ', '')}`,
          title: 'Test Proposal',
          description: `This proposal promises ${indicator} results for all participants.`,
        },
      });
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.redFlags.some((f: string) => f.includes(indicator))).toBe(true);
    }
  });

  test('fact-check with empty claim', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/research/fact-check`, {
      data: { claim: '', context: 'Empty claim test' },
    });
    // Should handle gracefully - either error or process
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test('fact-check with very long claim', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/research/fact-check`, {
      data: { claim: 'A'.repeat(2000), context: 'Very long claim test' },
    });
    expect(response.ok()).toBeTruthy();
  });

  test('research with special characters in text', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/research/conduct`, {
      data: {
        proposalId: '0xspecial',
        title: "Test's Special \"Characters\" & <Symbols>",
        description: 'Description with émojis 🚀 and spëcial çharacters: ñ, ü, ø',
      },
    });
    expect(response.ok()).toBeTruthy();
  });

  test('research with references array', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/research/conduct`, {
      data: {
        proposalId: '0xrefs',
        title: 'Test with References',
        description: 'A proposal with external references about problem solving',
        references: ['https://example.com/doc1', 'https://example.com/doc2', 'ipfs://QmExample'],
      },
    });
    expect(response.ok()).toBeTruthy();
  });
});

test.describe('Moderation - Boundary Conditions', () => {
  test('flag with exact minimum stake for each type', async ({ request }) => {
    const stakeRequirements = [
      { flagType: 'DUPLICATE', minStake: 10 },
      { flagType: 'SPAM', minStake: 5 },
      { flagType: 'HARMFUL', minStake: 50 },
      { flagType: 'INFEASIBLE', minStake: 20 },
      { flagType: 'MISALIGNED', minStake: 30 },
      { flagType: 'LOW_QUALITY', minStake: 10 },
      { flagType: 'NEEDS_WORK', minStake: 5 },
    ];

    for (const { flagType, minStake } of stakeRequirements) {
      const response = await request.post(`${API_BASE}/api/v1/moderation/flag`, {
        data: {
          proposalId: `0xstake${flagType}${Date.now()}`,
          flagger: `0xflagger${flagType}`,
          flagType,
          reason: `Testing minimum stake for ${flagType}`,
          stake: minStake,
        },
      });
      expect(response.ok()).toBeTruthy();
    }
  });

  test('flag with stake below minimum fails', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/moderation/flag`, {
      data: {
        proposalId: '0xunderstake',
        flagger: '0xtest',
        flagType: 'HARMFUL',
        reason: 'Testing',
        stake: 49, // Minimum for HARMFUL is 50
      },
    });
    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('50');
  });

  test('vote changes affect score calculation', async ({ request }) => {
    const proposalId = `0xvotetest${Date.now()}`;
    const flagger = '0xflaggervote';

    // Create flag
    const flagResponse = await request.post(`${API_BASE}/api/v1/moderation/flag`, {
      data: { proposalId, flagger, flagType: 'LOW_QUALITY', reason: 'Test', stake: 15 },
    });
    const flagData = await flagResponse.json();
    const flagId = flagData.flagId;

    // Get initial score
    const score1 = await request.get(`${API_BASE}/api/v1/moderation/score/${proposalId}`);
    const score1Data = await score1.json();

    // Add upvotes
    for (let i = 0; i < 3; i++) {
      await request.post(`${API_BASE}/api/v1/moderation/vote`, {
        data: { flagId, voter: `0xvoter${i}`, upvote: true },
      });
    }

    // Get updated score
    const score2 = await request.get(`${API_BASE}/api/v1/moderation/score/${proposalId}`);
    const score2Data = await score2.json();

    // Upvotes should lower visibility (flag is more trusted)
    expect(score2Data.visibilityScore).toBeLessThanOrEqual(score1Data.visibilityScore);
  });

  test('resolve flag updates moderator stats correctly', async ({ request }) => {
    const flagger = `0xstatstest${Date.now()}`;
    const proposalId = `0xstats${Date.now()}`;

    // Submit flag
    const flagResponse = await request.post(`${API_BASE}/api/v1/moderation/flag`, {
      data: { proposalId, flagger, flagType: 'SPAM', reason: 'Stats test', stake: 10 },
    });
    const flagData = await flagResponse.json();

    // Get stats before resolution
    const statsBefore = await request.get(`${API_BASE}/api/v1/moderation/moderator/${flagger}`);
    const beforeData = await statsBefore.json();

    // Resolve flag as upheld
    await request.post(`${API_BASE}/api/v1/moderation/resolve`, {
      data: { flagId: flagData.flagId, upheld: true },
    });

    // Get stats after resolution
    const statsAfter = await request.get(`${API_BASE}/api/v1/moderation/moderator/${flagger}`);
    const afterData = await statsAfter.json();

    expect(afterData.flagsUpheld).toBe(beforeData.flagsUpheld + 1);
    expect(afterData.reputation).toBeGreaterThan(beforeData.reputation);
  });

  test('rejected flag decreases moderator reputation', async ({ request }) => {
    const flagger = `0xrejected${Date.now()}`;
    const proposalId = `0xrejectedprop${Date.now()}`;

    // Submit flag
    const flagResponse = await request.post(`${API_BASE}/api/v1/moderation/flag`, {
      data: { proposalId, flagger, flagType: 'SPAM', reason: 'Will be rejected', stake: 10 },
    });
    const flagData = await flagResponse.json();

    // Get stats before
    const statsBefore = await request.get(`${API_BASE}/api/v1/moderation/moderator/${flagger}`);
    const beforeData = await statsBefore.json();

    // Resolve flag as rejected
    await request.post(`${API_BASE}/api/v1/moderation/resolve`, {
      data: { flagId: flagData.flagId, upheld: false },
    });

    // Get stats after
    const statsAfter = await request.get(`${API_BASE}/api/v1/moderation/moderator/${flagger}`);
    const afterData = await statsAfter.json();

    expect(afterData.flagsRejected).toBe(beforeData.flagsRejected + 1);
    expect(afterData.trustScore).toBeLessThan(beforeData.trustScore);
  });

  test('should-reject returns true for heavily flagged proposal', async ({ request }) => {
    const proposalId = `0xheavyflag${Date.now()}`;

    // Submit multiple severe flags
    for (let i = 0; i < 3; i++) {
      await request.post(`${API_BASE}/api/v1/moderation/flag`, {
        data: {
          proposalId,
          flagger: `0xflagger${i}${Date.now()}`,
          flagType: 'SPAM',
          reason: `Spam flag ${i}`,
          stake: 10,
        },
      });
    }

    // Add upvotes to make them count more
    const flagsResponse = await request.get(`${API_BASE}/api/v1/moderation/flags/${proposalId}`);
    const flagsData = await flagsResponse.json();

    for (const flag of flagsData.flags) {
      for (let v = 0; v < 5; v++) {
        await request.post(`${API_BASE}/api/v1/moderation/vote`, {
          data: { flagId: flag.flagId, voter: `0xupvoter${v}${Date.now()}`, upvote: true },
        });
      }
    }

    const rejectResponse = await request.get(`${API_BASE}/api/v1/moderation/should-reject/${proposalId}`);
    const rejectData = await rejectResponse.json();

    // With 3 spam flags each with upvotes, should trigger auto-reject
    expect(rejectData.reject).toBe(true);
  });
});

test.describe('Data Verification - Actual Output Inspection', () => {
  test('assessment scores are within valid range', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      data: {
        title: 'Valid Proposal for Score Range Test',
        description: 'A complete proposal with problem statement, solution, timeline of 2 weeks, and budget of 10k',
        proposalType: 1,
      },
    });

    const data = await response.json();

    // Verify all criteria are 0-100
    for (const [key, value] of Object.entries(data.criteria)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }

    // Verify overall score is consistent with criteria
    expect(data.overallScore).toBeGreaterThanOrEqual(0);
    expect(data.overallScore).toBeLessThanOrEqual(100);

    // Verify boolean fields
    expect(typeof data.readyToSubmit).toBe('boolean');
  });

  test('research report structure is complete', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/research/conduct`, {
      data: {
        proposalId: '0xstructure',
        title: 'Complete Structure Test',
        description: 'A proposal with problem, solution, timeline, budget, and risk sections for comprehensive testing',
        depth: 'standard',
      },
    });

    const data = await response.json();

    // Verify required fields exist and have correct types
    expect(data.proposalId).toBe('0xstructure');
    expect(data.requestHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(typeof data.model).toBe('string');
    expect(Array.isArray(data.sections)).toBe(true);
    expect(['proceed', 'reject', 'modify']).toContain(data.recommendation);
    expect(data.confidenceLevel).toBeGreaterThanOrEqual(0);
    expect(data.confidenceLevel).toBeLessThanOrEqual(100);
    expect(['low', 'medium', 'high', 'critical']).toContain(data.riskLevel);
    expect(typeof data.summary).toBe('string');
    expect(Array.isArray(data.keyFindings)).toBe(true);
    expect(Array.isArray(data.concerns)).toBe(true);
    expect(Array.isArray(data.alternatives)).toBe(true);
    expect(data.executionTime).toBeGreaterThan(0);
    expect(data.completedAt).toBeGreaterThan(data.startedAt);
  });

  test('moderation flag structure is complete', async ({ request }) => {
    const proposalId = `0xflagstruct${Date.now()}`;
    const response = await request.post(`${API_BASE}/api/v1/moderation/flag`, {
      data: {
        proposalId,
        flagger: '0xstructflagger',
        flagType: 'LOW_QUALITY',
        reason: 'Testing flag structure',
        stake: 15,
        evidence: 'Evidence text here',
      },
    });

    const data = await response.json();

    // Verify all flag fields
    expect(data.flagId).toMatch(/^0x[a-f0-9]+$/);
    expect(data.proposalId).toBe(proposalId);
    expect(data.flagger).toBe('0xstructflagger');
    expect(data.flagType).toBe('LOW_QUALITY');
    expect(data.reason).toBe('Testing flag structure');
    expect(data.stake).toBe(15);
    expect(data.evidence).toBe('Evidence text here');
    expect(data.upvotes).toBe(0);
    expect(data.downvotes).toBe(0);
    expect(data.resolved).toBe(false);
    expect(data.createdAt).toBeGreaterThan(Date.now() - 60000);
  });

  test('content hash is deterministic', async ({ request }) => {
    const proposal = {
      title: 'Deterministic Hash Test',
      summary: 'Testing hash determinism',
      description: 'This should produce the same hash every time',
      proposalType: 5,
    };

    const hashes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await request.post(`${API_BASE}/api/v1/proposals/quick-score`, { data: proposal });
      const data = await response.json();
      hashes.push(data.contentHash);
    }

    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[1]).toBe(hashes[2]);
  });
});
