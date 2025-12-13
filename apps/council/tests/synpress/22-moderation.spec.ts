import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:8010';

test.describe('Web-of-Trust Moderation API', () => {
  const testProposalId = `0xtest${Date.now().toString(16)}`;
  const testFlagger = `0xflagger${Date.now().toString(16).slice(0, 8)}`;
  let flagId: string;

  test('submit flag on proposal', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/moderation/flag`, {
      data: {
        proposalId: testProposalId,
        flagger: testFlagger,
        flagType: 'LOW_QUALITY',
        reason: 'Proposal lacks sufficient detail and technical specification',
        stake: 15,
        evidence: 'Missing budget breakdown, no timeline provided',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.flagId).toBeTruthy();
    expect(data.proposalId).toBe(testProposalId);
    expect(data.flagger).toBe(testFlagger);
    expect(data.flagType).toBe('LOW_QUALITY');
    expect(data.stake).toBe(15);
    expect(data.resolved).toBe(false);
    flagId = data.flagId;
  });

  test('get proposal moderation score', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/v1/moderation/score/${testProposalId}`);

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.proposalId).toBe(testProposalId);
    expect(typeof data.visibilityScore).toBe('number');
    expect(data.recommendation).toMatch(/VISIBLE|REVIEW|HIDDEN/);
    expect(Array.isArray(data.flags)).toBe(true);
  });

  test('vote on flag', async ({ request }) => {
    if (!flagId) {
      test.skip();
      return;
    }

    const voter = `0xvoter${Date.now().toString(16).slice(0, 8)}`;
    const response = await request.post(`${API_BASE}/api/v1/moderation/vote`, {
      data: { flagId, voter, upvote: true },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test('get proposal flags', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/v1/moderation/flags/${testProposalId}`);

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(Array.isArray(data.flags)).toBe(true);
  });

  test('get active flags', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/v1/moderation/active-flags`);

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(Array.isArray(data.flags)).toBe(true);
  });

  test('get moderator stats', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/v1/moderation/moderator/${testFlagger}`);

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.address).toBe(testFlagger);
    expect(typeof data.flagsRaised).toBe('number');
    expect(typeof data.accuracy).toBe('number');
    expect(typeof data.reputation).toBe('number');
  });

  test('get moderation leaderboard', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/v1/moderation/leaderboard?limit=5`);

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(Array.isArray(data.moderators)).toBe(true);
  });

  test('check should-reject status', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/v1/moderation/should-reject/${testProposalId}`);

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(typeof data.reject).toBe('boolean');
  });

  test('resolve flag', async ({ request }) => {
    if (!flagId) {
      test.skip();
      return;
    }

    const response = await request.post(`${API_BASE}/api/v1/moderation/resolve`, {
      data: { flagId, upheld: true },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test('invalid flag type returns error', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/moderation/flag`, {
      data: {
        proposalId: '0xinvalid',
        flagger: '0xflagger',
        flagType: 'INVALID_TYPE',
        reason: 'Test',
        stake: 10,
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Invalid flagType');
  });

  test('missing required fields returns error', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/moderation/flag`, {
      data: { proposalId: '0x123' },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('required');
  });

  test('submit multiple flag types', async ({ request }) => {
    // Stake requirements: DUPLICATE=10, SPAM=5, INFEASIBLE=20, MISALIGNED=30, NEEDS_WORK=5
    const flagConfigs = [
      { flagType: 'DUPLICATE', stake: 15 },
      { flagType: 'SPAM', stake: 10 },
      { flagType: 'INFEASIBLE', stake: 25 },
      { flagType: 'MISALIGNED', stake: 35 },
      { flagType: 'NEEDS_WORK', stake: 10 },
    ];
    const proposalId = `0xmultiflags${Date.now().toString(16)}`;

    for (const { flagType, stake } of flagConfigs) {
      const response = await request.post(`${API_BASE}/api/v1/moderation/flag`, {
        data: {
          proposalId,
          flagger: `0xflagger${flagType.toLowerCase()}`,
          flagType,
          reason: `Testing ${flagType} flag`,
          stake,
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.flagType).toBe(flagType);
    }

    const score = await request.get(`${API_BASE}/api/v1/moderation/score/${proposalId}`);
    const scoreData = await score.json();
    expect(scoreData.flags.length).toBeGreaterThanOrEqual(5);
    expect(scoreData.visibilityScore).toBeLessThan(100);
  });
});
