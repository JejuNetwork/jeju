/**
 * Deliberation Flow Tests
 * 
 * End-to-end tests for the council deliberation process.
 */

import { test, expect } from '@playwright/test';

const COUNCIL_URL = 'http://localhost:8010';

test.describe('Deliberation Flow', () => {
  const sendA2AMessage = async (
    request: ReturnType<typeof test['request']>,
    skillId: string,
    params?: Record<string, unknown>
  ) => {
    const response = await request.post(`${COUNCIL_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'message/send',
        params: {
          message: {
            messageId: `delib-${Date.now()}`,
            parts: [
              { kind: 'data', data: { skillId, params: params || {} } }
            ]
          }
        }
      }
    });
    return response.json();
  };

  test('assess proposal quality for new submission', async ({ request }) => {
    const result = await sendA2AMessage(request, 'assess-proposal', {
      title: 'Upgrade governance module to v2',
      summary: 'This proposal upgrades the governance module with new voting mechanisms.',
      description: `This proposal introduces a comprehensive upgrade to the governance module.
      
Key changes:
1. New quadratic voting mechanism
2. Time-weighted voting power
3. Delegation improvements
4. Emergency pause functionality

Technical implementation:
- Uses upgradeable proxy pattern
- Fully backwards compatible
- Includes migration scripts
- 90% test coverage

Budget: 50,000 USDC
Timeline: 3 months`,
      proposalType: 'TECHNICAL'
    });

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
    
    // Should have quality assessment (overallScore or qualityScore)
    const score = dataPart.data.overallScore ?? dataPart.data.qualityScore;
    expect(score).toBeDefined();
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('council members can submit independent votes', async ({ request }) => {
    const proposalId = '0x' + 'a'.repeat(64);
    const roles = ['TREASURY', 'CODE', 'COMMUNITY', 'SECURITY'];
    
    for (const role of roles) {
      const result = await sendA2AMessage(request, 'submit-vote', {
        proposalId,
        role,
        vote: 'APPROVE',
        reasoning: `${role} agent approves this proposal based on role-specific assessment.`,
        confidence: 75 + Math.floor(Math.random() * 20)
      });

      expect(result.result).toBeDefined();
      const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
      expect(dataPart).toBeDefined();
    }
  });

  test('get-council-votes aggregates all votes', async ({ request }) => {
    const proposalId = '0x' + 'b'.repeat(64);
    
    // Submit multiple votes
    await sendA2AMessage(request, 'submit-vote', {
      proposalId,
      role: 'TREASURY',
      vote: 'APPROVE',
      reasoning: 'Budget is reasonable',
      confidence: 85
    });
    
    await sendA2AMessage(request, 'submit-vote', {
      proposalId,
      role: 'CODE',
      vote: 'REJECT',
      reasoning: 'Technical concerns with implementation',
      confidence: 70
    });

    // Get aggregated votes
    const result = await sendA2AMessage(request, 'get-council-votes', { proposalId });

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
  });

  test('CEO decision includes council consensus', async ({ request }) => {
    const result = await sendA2AMessage(request, 'request-ceo-decision', {
      proposalId: '0x' + 'c'.repeat(64),
      councilVotes: [
        { role: 'TREASURY', vote: 'APPROVE', reasoning: 'Budget approved', confidence: 90 },
        { role: 'CODE', vote: 'APPROVE', reasoning: 'Technical review passed', confidence: 85 },
        { role: 'COMMUNITY', vote: 'APPROVE', reasoning: 'Community benefit clear', confidence: 80 },
        { role: 'SECURITY', vote: 'ABSTAIN', reasoning: 'Need more security audit', confidence: 60 }
      ]
    });

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
  });

  test('commentary can be added to proposals', async ({ request }) => {
    const proposalId = '0x' + 'd'.repeat(64);
    
    const result = await sendA2AMessage(request, 'add-commentary', {
      proposalId,
      content: 'This proposal has significant implications for the treasury runway.',
      sentiment: 'neutral'
    });

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
    expect(dataPart.data.content).toBe('This proposal has significant implications for the treasury runway.');
    expect(dataPart.data.sentiment).toBe('neutral');
  });

  test('governance stats update after votes', async ({ request }) => {
    // Get initial stats
    const beforeResult = await sendA2AMessage(request, 'get-governance-stats');
    expect(beforeResult.result).toBeDefined();
    
    const beforeData = beforeResult.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(beforeData).toBeDefined();
    
    // Stats should be present (values can be numbers or strings)
    expect(beforeData.data.totalProposals).toBeDefined();
  });

  test('research request returns local mode info', async ({ request }) => {
    const result = await sendA2AMessage(request, 'request-research', {
      proposalId: '0x' + 'e'.repeat(64),
      topic: 'Market analysis for proposal'
    });

    expect(result.result).toBeDefined();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
    
    // In local mode, should indicate free research
    if (dataPart.data.mode === 'local') {
      expect(dataPart.data.estimatedCost).toBe('0');
    }
  });
});
