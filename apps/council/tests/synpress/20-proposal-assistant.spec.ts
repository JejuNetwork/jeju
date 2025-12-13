import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:8010';

test.describe('Proposal Assistant API', () => {
  test('assess proposal with complete content', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      data: {
        title: 'Implement Cross-Chain Bridge for Jeju Network',
        summary: 'This proposal aims to implement a cross-chain bridge enabling asset transfers between Jeju and other EVM chains.',
        description: `
## Problem
Currently, Jeju Network operates in isolation, limiting liquidity and user adoption.

## Solution
Implement a trustless bridge using MPC signatures and fraud proofs.

## Implementation
1. Deploy bridge contracts on Jeju and target chains
2. Set up MPC validator network
3. Implement fraud proof system
4. Create user-friendly UI

## Timeline
- Month 1: Contract development and audits
- Month 2: Validator network setup
- Month 3: Testing and mainnet deployment

## Budget
- Development: 50,000 USDC
- Audits: 20,000 USDC
- Infrastructure: 10,000 USDC

## Risks
- Smart contract vulnerabilities: Mitigated by multiple audits
- Validator collusion: Mitigated by economic slashing
- Bridge exploits: Mitigated by rate limiting and monitoring
        `,
        proposalType: 2,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.overallScore).toBeGreaterThan(60);
    expect(data.criteria).toHaveProperty('clarity');
    expect(data.criteria).toHaveProperty('completeness');
    expect(data.criteria).toHaveProperty('feasibility');
    expect(data.criteria).toHaveProperty('alignment');
    expect(data.criteria).toHaveProperty('impact');
    expect(data.criteria).toHaveProperty('riskAssessment');
    expect(data.criteria).toHaveProperty('costBenefit');
    expect(data.assessedBy).toMatch(/ollama|heuristic/);
  });

  test('assess low-quality proposal gets low score', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      data: {
        title: 'Do stuff',
        description: 'Make things better.',
        proposalType: 0,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.overallScore).toBeLessThan(50);
    expect(data.readyToSubmit).toBe(false);
  });

  test('quick-score returns score and content hash', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/quick-score`, {
      data: {
        title: 'Test Proposal',
        summary: 'A test proposal for the DAO governance system.',
        description: 'This proposal addresses the problem of testing. We propose to implement comprehensive tests.',
        proposalType: 0,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.score).toBeGreaterThanOrEqual(0);
    expect(data.score).toBeLessThanOrEqual(100);
    expect(data.contentHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(typeof data.readyForFullAssessment).toBe('boolean');
  });

  test('generate proposal from idea', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/generate`, {
      data: {
        idea: 'Create a grants program to fund open-source development',
        proposalType: 6,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.title).toBeTruthy();
    expect(data.description).toBeTruthy();
    expect(data.proposalType).toBe(6);
  });

  test('check duplicates returns similar proposals', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/check-duplicates`, {
      data: {
        title: 'Treasury Allocation',
        description: 'Allocate funds for development',
        proposalType: 1,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(Array.isArray(data.duplicates)).toBe(true);
  });

  test('improve proposal returns suggestions', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/improve`, {
      data: {
        draft: {
          title: 'Simple Proposal',
          description: 'A basic proposal without much detail.',
          proposalType: 0,
        },
        criterion: 'completeness',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.improved).toBeTruthy();
    expect(data.improved.length).toBeGreaterThan(0);
  });

  test('missing title returns error', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      data: { description: 'No title provided' },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('title');
  });

  test('missing description returns error', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      data: { title: 'No description provided' },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('description');
  });
});
