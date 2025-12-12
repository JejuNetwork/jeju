/**
 * Proposal Quality Assessment Tests
 * 
 * Tests for the proposal quality scoring system (no blockchain required).
 */

import { test, expect } from '@playwright/test';

test.describe('Proposal Quality Assessment', () => {
  const sendA2AMessage = async (
    request: ReturnType<typeof test['request']>,
    skillId: string,
    params: Record<string, unknown>
  ) => {
    const response = await request.post('http://localhost:8010/a2a', {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: `msg-${Date.now()}`,
            parts: [
              { kind: 'data', data: { skillId, params } }
            ]
          }
        }
      }
    });
    return response.json();
  };

  test('low quality proposal gets low score', async ({ request }) => {
    const result = await sendA2AMessage(request, 'assess-proposal', {
      title: 'Bad',
      summary: 'Short',
      description: 'Not enough detail',
      proposalType: 'GRANT'
    });

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart.data.overallScore).toBeLessThan(90);
    expect(dataPart.data.readyToSubmit).toBe(false);
  });

  test('proposal with comprehensive content gets better score', async ({ request }) => {
    const result = await sendA2AMessage(request, 'assess-proposal', {
      title: 'Implement Cross-Chain Bridge Integration for Ecosystem Growth',
      summary: 'This proposal aims to integrate cross-chain bridge functionality to enable seamless asset transfers across multiple blockchain networks, enhancing liquidity and user experience while growing the ecosystem.',
      description: `
## Problem
Currently, users face friction when moving assets between chains. This limits our ecosystem growth and member benefit.

## Solution
Implement a secure cross-chain bridge with support for major networks. This aligns with our decentralized and open source values.

## Implementation
1. Deploy bridge contracts on target chains
2. Set up relayer infrastructure
3. Build frontend integration
4. Security audits

## Timeline
- Week 1-2: Contract development
- Week 3: Testing and audits
- Week 4: Deployment

## Cost
- Development: 50 ETH
- Audits: 30 ETH
- Infrastructure: 20 ETH

## Benefit
- 50% increase in TVL expected
- Better member experience
- Competitive advantage

## Risk Assessment
- Smart contract risk: Mitigated by audits
- Bridge security: Multi-sig controls
- Downtime risk: Fallback mechanisms

## Success Metrics
- TVL growth
- Active users
- Transaction volume
      `,
      proposalType: 'CODE_UPGRADE'
    });

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart.data.overallScore).toBeGreaterThanOrEqual(70);
    expect(dataPart.data.criteria).toBeDefined();
    expect(dataPart.data.criteria.clarity).toBeGreaterThan(50);
    expect(dataPart.data.criteria.completeness).toBeGreaterThan(50);
  });

  test('proposal missing sections gets feedback', async ({ request }) => {
    const result = await sendA2AMessage(request, 'assess-proposal', {
      title: 'Add New Feature to the Platform',
      summary: 'This proposal suggests adding a useful new feature that will benefit community members.',
      description: `
## Problem
We need a new feature.

## Solution
Add the feature.
      `,
      proposalType: 'CODE_UPGRADE'
    });

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart.data.overallScore).toBeLessThan(90);
    expect(dataPart.data.readyToSubmit).toBe(false);
  });

  test('assessment returns all quality criteria', async ({ request }) => {
    const result = await sendA2AMessage(request, 'assess-proposal', {
      title: 'Test Proposal',
      summary: 'A test proposal with enough content to be evaluated properly by the system.',
      description: 'This is a test proposal with problem, solution, implementation, timeline, cost, benefit, and risk assessment sections mentioned.',
      proposalType: 'GRANT'
    });

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart.data.criteria).toBeDefined();
    expect(dataPart.data.criteria.clarity).toBeDefined();
    expect(dataPart.data.criteria.completeness).toBeDefined();
    expect(dataPart.data.criteria.feasibility).toBeDefined();
    expect(dataPart.data.criteria.alignment).toBeDefined();
    expect(dataPart.data.criteria.impact).toBeDefined();
    expect(dataPart.data.criteria.riskAssessment).toBeDefined();
    expect(dataPart.data.criteria.costBenefit).toBeDefined();
  });
});
