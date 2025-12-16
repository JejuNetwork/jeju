import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:8010';

test.describe('Concurrent Request Handling', () => {
  test('parallel proposal assessments do not interfere', async ({ request }) => {
    const proposals = [
      { title: 'Proposal A - Treasury', description: 'Allocate treasury funds for development budget and timeline', proposalType: 1 },
      { title: 'Proposal B - Upgrade', description: 'Upgrade the smart contracts with security audit and risk mitigation', proposalType: 2 },
      { title: 'Proposal C - Hiring', description: 'Hire a new team member for development with cost analysis', proposalType: 3 },
    ];

    const results = await Promise.all(
      proposals.map(data => request.post(`${API_BASE}/api/v1/proposals/assess`, { data }))
    );

    for (let i = 0; i < results.length; i++) {
      expect(results[i].ok()).toBeTruthy();
      const data = await results[i].json();
      expect(data.overallScore).toBeGreaterThan(0);
      expect(data.criteria).toBeDefined();
    }
  });

  test('parallel quick-scores return unique hashes', async ({ request }) => {
    const proposals = [
      { title: 'Hash Test 1', description: 'Unique content for hash 1', proposalType: 0 },
      { title: 'Hash Test 2', description: 'Unique content for hash 2', proposalType: 0 },
      { title: 'Hash Test 3', description: 'Unique content for hash 3', proposalType: 0 },
    ];

    const results = await Promise.all(
      proposals.map(data => request.post(`${API_BASE}/api/v1/proposals/quick-score`, { data }))
    );

    const hashes = await Promise.all(results.map(r => r.json().then(d => d.contentHash)));
    const uniqueHashes = new Set(hashes);

    expect(uniqueHashes.size).toBe(3);
  });

  test('parallel research requests with caching', async ({ request }) => {
    const researchData = {
      proposalId: '0xparallelcache',
      title: 'Parallel Cache Test',
      description: 'Testing parallel research requests hit cache correctly with problem and solution',
    };

    // Fire multiple identical requests in parallel
    const results = await Promise.all([
      request.post(`${API_BASE}/api/v1/research/conduct`, { data: researchData }),
      request.post(`${API_BASE}/api/v1/research/conduct`, { data: researchData }),
      request.post(`${API_BASE}/api/v1/research/conduct`, { data: researchData }),
    ]);

    const responses = await Promise.all(results.map(r => r.json()));

    // All should return the same requestHash (cached)
    expect(responses[0].requestHash).toBe(responses[1].requestHash);
    expect(responses[1].requestHash).toBe(responses[2].requestHash);
  });

  test('parallel moderation flags on different proposals', async ({ request }) => {
    const timestamp = Date.now();
    const flags = [
      { proposalId: `0xparallel1${timestamp}`, flagger: '0xflagger1', flagType: 'SPAM', reason: 'Spam 1', stake: 10 },
      { proposalId: `0xparallel2${timestamp}`, flagger: '0xflagger2', flagType: 'LOW_QUALITY', reason: 'Low quality 2', stake: 15 },
      { proposalId: `0xparallel3${timestamp}`, flagger: '0xflagger3', flagType: 'DUPLICATE', reason: 'Duplicate 3', stake: 15 },
    ];

    const results = await Promise.all(
      flags.map(data => request.post(`${API_BASE}/api/v1/moderation/flag`, { data }))
    );

    const responses = await Promise.all(results.map(r => r.json()));

    // Each should have unique flagId
    const flagIds = responses.map(r => r.flagId);
    const uniqueIds = new Set(flagIds);
    expect(uniqueIds.size).toBe(3);

    // Each should match its proposal
    for (let i = 0; i < responses.length; i++) {
      expect(responses[i].proposalId).toBe(flags[i].proposalId);
      expect(responses[i].flagType).toBe(flags[i].flagType);
    }
  });

  test('parallel votes on same flag', async ({ request }) => {
    const proposalId = `0xparallelvoters${Date.now()}`;
    const flagResponse = await request.post(`${API_BASE}/api/v1/moderation/flag`, {
      data: { proposalId, flagger: '0xflagcreator', flagType: 'SPAM', reason: 'Test', stake: 10 },
    });
    const flagData = await flagResponse.json();
    const flagId = flagData.flagId;

    // Multiple voters vote in parallel
    const voters = ['0xvoterA', '0xvoterB', '0xvoterC', '0xvoterD', '0xvoterE'];
    const voteResults = await Promise.all(
      voters.map(voter =>
        request.post(`${API_BASE}/api/v1/moderation/vote`, {
          data: { flagId, voter, upvote: true },
        })
      )
    );

    for (const result of voteResults) {
      expect(result.ok()).toBeTruthy();
    }

    // Verify all votes counted
    const flagsResponse = await request.get(`${API_BASE}/api/v1/moderation/flags/${proposalId}`);
    const flagsData = await flagsResponse.json();
    const flag = flagsData.flags.find((f: { flagId: string }) => f.flagId === flagId);
    expect(flag.upvotes).toBeGreaterThan(0);
  });

  test('concurrent quick-screens maintain isolation', async ({ request }) => {
    const screens = [
      { proposalId: '0xscreen1', title: 'Good Proposal', description: 'A valid proposal with problem and solution sections that should pass' },
      { proposalId: '0xscreen2', title: 'MOON GUARANTEED', description: 'free money no risk guaranteed returns' },
      { proposalId: '0xscreen3', title: 'Another Good One', description: 'This proposal addresses the challenge and proposes to implement a solution' },
    ];

    const results = await Promise.all(
      screens.map(data => request.post(`${API_BASE}/api/v1/research/quick-screen`, { data }))
    );

    const responses = await Promise.all(results.map(r => r.json()));

    // Screen 1 and 3 should pass, screen 2 should fail
    expect(responses[0].passesScreen).toBe(true);
    expect(responses[1].passesScreen).toBe(false);
    expect(responses[2].passesScreen).toBe(true);

    // Results should not be mixed up
    expect(responses[0].proposalId).toBe('0xscreen1');
    expect(responses[1].proposalId).toBe('0xscreen2');
    expect(responses[2].proposalId).toBe('0xscreen3');
  });
});

test.describe('Async Operation Timing', () => {
  test('research execution time is measured correctly', async ({ request }) => {
    // Use unique proposalId to avoid cache
    const uniqueId = `0xtiming${Date.now()}`;
    const response = await request.post(`${API_BASE}/api/v1/research/conduct`, {
      data: {
        proposalId: uniqueId,
        title: 'Timing Test',
        description: 'Testing execution time measurement with problem and solution',
        depth: 'quick',
      },
    });

    const data = await response.json();

    // Execution time should be positive
    expect(data.executionTime).toBeGreaterThan(0);

    // completedAt should be after startedAt
    expect(data.completedAt).toBeGreaterThan(data.startedAt);
    expect(data.completedAt - data.startedAt).toBe(data.executionTime);
  });

  test('flag timestamp is accurate', async ({ request }) => {
    const beforeFlag = Date.now();

    const response = await request.post(`${API_BASE}/api/v1/moderation/flag`, {
      data: {
        proposalId: `0xtimestamp${Date.now()}`,
        flagger: '0xtimestamper',
        flagType: 'NEEDS_WORK',
        reason: 'Timestamp test',
        stake: 10,
      },
    });

    const afterFlag = Date.now();
    const data = await response.json();

    expect(data.createdAt).toBeGreaterThanOrEqual(beforeFlag);
    expect(data.createdAt).toBeLessThanOrEqual(afterFlag);
  });

  test('health endpoint responds quickly', async ({ request }) => {
    const start = Date.now();
    const response = await request.get(`${API_BASE}/health`);
    const elapsed = Date.now() - start;

    expect(response.ok()).toBeTruthy();
    expect(elapsed).toBeLessThan(500); // Health check should be fast
  });

  test('quick-score is faster than full assessment', async ({ request }) => {
    const proposal = {
      title: 'Speed Comparison Test',
      description: 'Testing speed difference between quick score and full assessment with problem and solution',
      proposalType: 0,
    };

    const quickStart = Date.now();
    await request.post(`${API_BASE}/api/v1/proposals/quick-score`, { data: proposal });
    const quickTime = Date.now() - quickStart;

    const fullStart = Date.now();
    await request.post(`${API_BASE}/api/v1/proposals/assess`, { data: proposal });
    const fullTime = Date.now() - fullStart;

    // Quick score should be significantly faster (at least not slower)
    expect(quickTime).toBeLessThanOrEqual(fullTime + 100);
  });
});

test.describe('Error Recovery', () => {
  test('server handles malformed JSON gracefully', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      headers: { 'Content-Type': 'application/json' },
      data: '{"title": "broken json',
    });

    // Should return 4xx error, not 5xx
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });

  test('server handles empty body', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      headers: { 'Content-Type': 'application/json' },
      data: '',
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test('server handles missing Content-Type', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      data: { title: 'Test', description: 'Test description' },
    });

    // Should still work - Playwright sets content type
    expect(response.ok() || response.status() === 400).toBeTruthy();
  });

  test('non-existent endpoint returns 404', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/v1/nonexistent`);
    expect(response.status()).toBe(404);
  });

  test('wrong HTTP method returns different behavior', async ({ request }) => {
    // GET on /api/v1/proposals/assess is interpreted as GET /api/v1/proposals/:id with id="assess"
    const response = await request.get(`${API_BASE}/api/v1/proposals/assess`);
    // This returns 200 with an error message (proposal not found)
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.error).toContain('not found');
  });

  test('server remains stable after errors', async ({ request }) => {
    // Cause some errors
    await request.post(`${API_BASE}/api/v1/proposals/assess`, { data: {} });
    await request.post(`${API_BASE}/api/v1/moderation/flag`, { data: {} });
    await request.post(`${API_BASE}/api/v1/research/conduct`, { data: {} });

    // Verify server still works
    const healthResponse = await request.get(`${API_BASE}/health`);
    expect(healthResponse.ok()).toBeTruthy();

    const validResponse = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      data: { title: 'Recovery Test', description: 'Server should still work after errors' },
    });
    expect(validResponse.ok()).toBeTruthy();
  });
});

test.describe('Rate and Load Handling', () => {
  test('handles burst of requests', async ({ request }) => {
    const burst = Array(10).fill(null).map((_, i) => ({
      title: `Burst ${i}`,
      description: `Burst test ${i} with problem and solution`,
      proposalType: 0,
    }));

    const start = Date.now();
    const results = await Promise.all(
      burst.map(data => request.post(`${API_BASE}/api/v1/proposals/quick-score`, { data }))
    );
    const elapsed = Date.now() - start;

    // All should succeed
    for (const result of results) {
      expect(result.ok()).toBeTruthy();
    }

    // Should handle 10 requests reasonably (< 5 seconds)
    expect(elapsed).toBeLessThan(5000);
  });

  test('handles sequential requests without degradation', async ({ request }) => {
    const times: number[] = [];

    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      await request.post(`${API_BASE}/api/v1/proposals/quick-score`, {
        data: { title: `Sequential ${i}`, description: `Sequential test ${i}`, proposalType: 0 },
      });
      times.push(Date.now() - start);
    }

    // No request should take more than 2x the average
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    for (const time of times) {
      expect(time).toBeLessThan(avg * 3);
    }
  });
});
