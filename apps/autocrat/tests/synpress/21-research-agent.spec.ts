import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:8010';

test.describe('Research Agent API', () => {
  test('conduct research on proposal', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/research/conduct`, {
      data: {
        proposalId: '0x1234567890abcdef',
        title: 'Implement Staking Rewards',
        description: `
This proposal implements a staking reward mechanism.

## Problem
Users have no incentive to stake tokens long-term.

## Solution
Implement time-weighted staking rewards with bonuses for longer lock periods.

## Implementation
1. Deploy staking contract with reward distribution
2. Integrate with existing token contracts
3. Add UI for staking interface

## Timeline
- Week 1-2: Contract development
- Week 3: Audits
- Week 4: Deployment

## Budget
- Development: 15,000 USDC
- Audit: 5,000 USDC

## Risks
- Economic: Inflation from rewards
- Technical: Smart contract bugs
        `,
        proposalType: 'PARAMETER_CHANGE',
        depth: 'standard',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.proposalId).toBe('0x1234567890abcdef');
    expect(data.requestHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(data.model).toBeTruthy();
    expect(Array.isArray(data.sections)).toBe(true);
    expect(data.recommendation).toMatch(/proceed|reject|modify/);
    expect(data.confidenceLevel).toBeGreaterThanOrEqual(0);
    expect(data.confidenceLevel).toBeLessThanOrEqual(100);
    expect(data.riskLevel).toMatch(/low|medium|high|critical/);
    expect(data.summary).toBeTruthy();
    expect(data.executionTime).toBeGreaterThan(0);
  });

  test('quick screen passes good proposal', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/research/quick-screen`, {
      data: {
        proposalId: '0xgoodproposal',
        title: 'Well-Structured Governance Proposal',
        description: `
This proposal addresses the problem of governance efficiency.
We propose to implement a solution that streamlines voting.
The implementation timeline spans 3 months with clear milestones.
Budget breakdown: Development 20k, Audits 10k, Infrastructure 5k.
Risk assessment: Low technical risk, mitigated by testing.
        `,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.passesScreen).toBe(true);
    expect(data.score).toBeGreaterThanOrEqual(50);
    expect(data.redFlags.length).toBeLessThan(3);
  });

  test('quick screen fails spam proposal', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/research/quick-screen`, {
      data: {
        proposalId: '0xspamproposal',
        title: 'GUARANTEED 100x MOON',
        description: 'Free money no risk guaranteed returns instant profits!',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.passesScreen).toBe(false);
    expect(data.redFlags.length).toBeGreaterThan(0);
    expect(data.score).toBeLessThan(50);
  });

  test('fact check returns analysis', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/research/fact-check`, {
      data: {
        claim: 'The DAO treasury has sufficient funds for this proposal',
        context: 'Proposal requests 50,000 USDC for development',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.claim).toBe('The DAO treasury has sufficient funds for this proposal');
    expect(typeof data.verified).toBe('boolean');
    expect(data.confidence).toBeGreaterThanOrEqual(0);
    expect(data.explanation).toBeTruthy();
  });

  test('missing required fields returns error', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/research/conduct`, {
      data: { proposalId: '0x123' },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('required');
  });

  test('research caches results', async ({ request }) => {
    const requestData = {
      proposalId: '0xcached123',
      title: 'Cached Proposal Test',
      description: 'Testing caching behavior of research agent',
    };

    const first = await request.post(`${API_BASE}/api/v1/research/conduct`, { data: requestData });
    const firstData = await first.json();

    const second = await request.post(`${API_BASE}/api/v1/research/conduct`, { data: requestData });
    const secondData = await second.json();

    expect(firstData.requestHash).toBe(secondData.requestHash);
  });
});
