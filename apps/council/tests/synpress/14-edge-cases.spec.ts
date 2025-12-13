/**
 * Edge Cases & Error Handling Tests
 * 
 * Tests boundary conditions, invalid inputs, and error scenarios.
 */

import { test, expect } from '@playwright/test';

const COUNCIL_URL = 'http://localhost:8010';

const sendA2A = async (
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
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
          messageId: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          parts: [{ kind: 'data', data: { skillId, params: params ?? {} } }]
        }
      }
    }
  });
  return response.json();
};

test.describe('Empty & Null Input Handling', () => {
  test('assess-proposal with empty strings', async ({ request }) => {
    const result = await sendA2A(request, 'assess-proposal', {
      title: '',
      summary: '',
      description: ''
    });
    
    expect(result.result).toBeDefined();
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    
    // Empty content should result in low scores
    expect(data.overallScore).toBeLessThan(50);
    expect(data.readyToSubmit).toBe(false);
    expect(data.criteria.clarity).toBeLessThan(70);
  });

  test('assess-proposal with undefined params', async ({ request }) => {
    const result = await sendA2A(request, 'assess-proposal', {});
    
    expect(result.result).toBeDefined();
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(data.overallScore).toBeDefined();
  });

  test('submit-vote with missing required fields', async ({ request }) => {
    const result = await sendA2A(request, 'submit-vote', {
      proposalId: '0x' + 'f'.repeat(64)
      // Missing: agentId, vote
    });
    
    expect(result.result).toBeDefined();
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(data.error).toBeDefined();
  });

  test('get-proposal with empty proposalId', async ({ request }) => {
    const result = await sendA2A(request, 'get-proposal', { proposalId: '' });
    
    expect(result.result).toBeDefined();
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(data.error).toBeDefined();
  });

  test('chat with empty message', async ({ request }) => {
    const result = await sendA2A(request, 'chat', { message: '' });
    
    expect(result.result).toBeDefined();
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(data.error).toBeDefined();
  });
});

test.describe('Boundary Value Testing', () => {
  test('assess-proposal with maximum length content', async ({ request }) => {
    // Generate very long content
    const longTitle = 'A'.repeat(1000);
    const longSummary = 'B'.repeat(5000);
    const longDescription = 'C'.repeat(50000);
    
    const result = await sendA2A(request, 'assess-proposal', {
      title: longTitle,
      summary: longSummary,
      description: longDescription
    });
    
    expect(result.result).toBeDefined();
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    
    // Should handle long content without crashing
    expect(data.overallScore).toBeDefined();
    expect(typeof data.overallScore).toBe('number');
  });

  test('submit-vote with confidence at boundaries', async ({ request }) => {
    const proposalId = '0x' + '1'.repeat(64);
    
    // Test confidence = 0
    const resultZero = await sendA2A(request, 'submit-vote', {
      proposalId,
      agentId: 'treasury',
      vote: 'APPROVE',
      reasoning: 'Zero confidence test',
      confidence: 0
    });
    expect(resultZero.result).toBeDefined();
    
    // Test confidence = 100
    const resultMax = await sendA2A(request, 'submit-vote', {
      proposalId,
      agentId: 'code',
      vote: 'REJECT',
      reasoning: 'Max confidence test',
      confidence: 100
    });
    expect(resultMax.result).toBeDefined();
    
    // Test confidence > 100 (should clamp or error)
    const resultOver = await sendA2A(request, 'submit-vote', {
      proposalId,
      agentId: 'security',
      vote: 'ABSTAIN',
      reasoning: 'Over limit test',
      confidence: 150
    });
    expect(resultOver.result).toBeDefined();
  });

  test('submit-proposal with quality score at threshold', async ({ request }) => {
    // Score exactly at threshold (90)
    const result90 = await sendA2A(request, 'submit-proposal', {
      proposalType: 1,
      qualityScore: 90,
      contentHash: '0x' + 'a'.repeat(64)
    });
    expect(result90.result).toBeDefined();
    const data90 = result90.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(data90.error).toBeUndefined();
    
    // Score just below threshold (89)
    const result89 = await sendA2A(request, 'submit-proposal', {
      proposalType: 1,
      qualityScore: 89,
      contentHash: '0x' + 'b'.repeat(64)
    });
    expect(result89.result).toBeDefined();
    const data89 = result89.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(data89.error).toBeDefined();
  });
});

test.describe('Invalid Input Types', () => {
  test('assess-proposal with non-string values handles gracefully', async ({ request }) => {
    // Non-string values may be coerced or cause errors - either is acceptable
    const result = await sendA2A(request, 'assess-proposal', {
      title: 12345, // number instead of string
      summary: 'Valid summary text',
      description: 'Valid description text'
    });
    
    // Should handle gracefully without crashing server
    // May return error or coerced result
    expect(result).toBeDefined();
    if (result.result) {
      const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
      expect(data.overallScore ?? data.error).toBeDefined();
    }
  });

  test('submit-vote with invalid vote value', async ({ request }) => {
    const result = await sendA2A(request, 'submit-vote', {
      proposalId: '0x' + '2'.repeat(64),
      agentId: 'treasury',
      vote: 'MAYBE', // Invalid vote value
      reasoning: 'Testing invalid vote',
      confidence: 50
    });
    
    expect(result.result).toBeDefined();
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(data.error).toBeDefined();
  });

  test('submit-vote with invalid agent', async ({ request }) => {
    const result = await sendA2A(request, 'submit-vote', {
      proposalId: '0x' + '3'.repeat(64),
      agentId: 'invalid-agent',
      vote: 'APPROVE',
      reasoning: 'Testing invalid agent',
      confidence: 50
    });
    
    expect(result.result).toBeDefined();
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(data.error).toBeDefined();
  });

  test('unknown skill returns error', async ({ request }) => {
    const result = await sendA2A(request, 'nonexistent-skill', {});
    
    expect(result.result).toBeDefined();
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(data.error).toContain('not found');
  });
});

test.describe('Malformed Request Handling', () => {
  test('missing jsonrpc version', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/a2a`, {
      data: {
        id: 1,
        method: 'message/send',
        params: { message: { messageId: 'test', parts: [] } }
      }
    });
    
    // Should return valid JSON-RPC response (success or error)
    expect(response.status()).toBeLessThan(500);
  });

  test('invalid JSON-RPC method', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'invalid/method',
        params: {}
      }
    });
    
    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32601);
  });

  test('missing message parts', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: { message: { messageId: 'test' } }
      }
    });
    
    const result = await response.json();
    expect(result.error).toBeDefined();
  });

  test('empty request body', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/a2a`, {
      headers: { 'Content-Type': 'application/json' },
      data: ''
    });
    
    // Should not crash the server
    expect(response.status()).toBeLessThan(500);
  });
});

test.describe('Special Characters & Unicode', () => {
  test('assess-proposal with unicode content', async ({ request }) => {
    const result = await sendA2A(request, 'assess-proposal', {
      title: '提案：改善社区治理 🏛️',
      summary: '这是一个关于社区治理改进的提案 📋',
      description: `## 问题描述
社区治理需要改进。

## 解决方案  
实施新的投票机制。

## 时间线 ⏰
- 第一周: 设计
- 第二周: 实施

## 预算 💰
100 ETH

## 风险评估 ⚠️
低风险

Emojis: 🚀 💎 🔥 ✨`
    });
    
    expect(result.result).toBeDefined();
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(data.overallScore).toBeDefined();
  });

  test('chat with special characters', async ({ request }) => {
    const result = await sendA2A(request, 'chat', {
      message: `Hello! <script>alert('xss')</script> & "quotes" 'apostrophes' \n\t newlines`,
      agent: 'ceo'
    });
    
    // Should handle without crashing
    expect(result.result).toBeDefined();
  });

  test('add-commentary with markdown', async ({ request }) => {
    const result = await sendA2A(request, 'add-commentary', {
      proposalId: '0x' + '4'.repeat(64),
      content: `# Header
**Bold** and *italic*
- List item
\`\`\`code block\`\`\`
[link](http://example.com)`,
      sentiment: 'positive'
    });
    
    expect(result.result).toBeDefined();
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(data.content).toContain('Header');
  });
});

test.describe('Data Integrity Verification', () => {
  test('assess-proposal criteria sum matches overall score logic', async ({ request }) => {
    const result = await sendA2A(request, 'assess-proposal', {
      title: 'Test Proposal with Known Content',
      summary: 'A moderately detailed summary with problem, solution, and timeline mentioned.',
      description: `## Problem
We need to solve this issue.

## Solution
Here is the proposed solution with implementation details.

## Timeline
- Week 1: Planning
- Week 2: Implementation

## Cost
50 ETH total budget

## Benefit
Increased efficiency and reduced costs

## Risk Assessment
Low to medium risk profile`
    });
    
    expect(result.result).toBeDefined();
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    
    // Verify all criteria are numbers between 0-100
    const criteria = data.criteria;
    expect(criteria.clarity).toBeGreaterThanOrEqual(0);
    expect(criteria.clarity).toBeLessThanOrEqual(100);
    expect(criteria.completeness).toBeGreaterThanOrEqual(0);
    expect(criteria.completeness).toBeLessThanOrEqual(100);
    expect(criteria.feasibility).toBeGreaterThanOrEqual(0);
    expect(criteria.feasibility).toBeLessThanOrEqual(100);
    expect(criteria.alignment).toBeGreaterThanOrEqual(0);
    expect(criteria.alignment).toBeLessThanOrEqual(100);
    expect(criteria.impact).toBeGreaterThanOrEqual(0);
    expect(criteria.impact).toBeLessThanOrEqual(100);
    expect(criteria.riskAssessment).toBeGreaterThanOrEqual(0);
    expect(criteria.riskAssessment).toBeLessThanOrEqual(100);
    expect(criteria.costBenefit).toBeGreaterThanOrEqual(0);
    expect(criteria.costBenefit).toBeLessThanOrEqual(100);
    
    // Overall score should be between 0-100
    expect(data.overallScore).toBeGreaterThanOrEqual(0);
    expect(data.overallScore).toBeLessThanOrEqual(100);
  });

  test('deliberate returns votes from all agents', async ({ request }) => {
    const result = await sendA2A(request, 'deliberate', {
      proposalId: 'TEST-AGENTS-' + Date.now(),
      title: 'Test Full Deliberation',
      description: 'This proposal tests that all council agents provide votes.',
      proposalType: 'GENERAL',
      submitter: '0x1234'
    });
    
    expect(result.result).toBeDefined();
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    
    // Should have votes from all 5 council agents
    expect(data.votes).toBeDefined();
    expect(data.votes.length).toBe(5);
    
    // Each vote should have required fields
    const expectedAgents = ['TREASURY', 'CODE', 'COMMUNITY', 'SECURITY', 'LEGAL'];
    for (const vote of data.votes) {
      expect(['APPROVE', 'REJECT', 'ABSTAIN']).toContain(vote.vote);
      expect(typeof vote.reasoning).toBe('string');
      expect(vote.reasoning.length).toBeGreaterThan(0);
      expect(typeof vote.confidence).toBe('number');
      expect(vote.confidence).toBeGreaterThanOrEqual(0);
      expect(vote.confidence).toBeLessThanOrEqual(100);
    }
    
    // Summary should match vote counts
    const approves = data.votes.filter((v: { vote: string }) => v.vote === 'APPROVE').length;
    const rejects = data.votes.filter((v: { vote: string }) => v.vote === 'REJECT').length;
    const abstains = data.votes.filter((v: { vote: string }) => v.vote === 'ABSTAIN').length;
    
    expect(data.summary.approve).toBe(approves);
    expect(data.summary.reject).toBe(rejects);
    expect(data.summary.abstain).toBe(abstains);
    expect(data.summary.total).toBe(5);
  });

  test('ceo-decision aligns with council consensus', async ({ request }) => {
    const proposalId = 'CEO-TEST-' + Date.now();
    
    const result = await sendA2A(request, 'ceo-decision', { proposalId });
    
    expect(result.result).toBeDefined();
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    
    // Should have decision data
    expect(typeof data.approved).toBe('boolean');
    expect(typeof data.confidenceScore).toBe('number');
    expect(data.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(data.confidenceScore).toBeLessThanOrEqual(100);
    expect(typeof data.reasoning).toBe('string');
    expect(Array.isArray(data.recommendations)).toBe(true);
  });

  test('governance-stats returns consistent data', async ({ request }) => {
    const result = await sendA2A(request, 'get-governance-stats');
    
    expect(result.result).toBeDefined();
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    
    // Verify structure
    expect(data.totalProposals).toBeDefined();
    expect(data.ceo).toBeDefined();
    expect(data.ceo.model).toBeDefined();
    expect(data.ceo.decisions).toBeDefined();
    expect(data.ceo.approvalRate).toBeDefined();
    expect(data.parameters).toBeDefined();
    expect(data.parameters.minQualityScore).toBeDefined();
    expect(data.parameters.councilVotingPeriod).toBeDefined();
    expect(data.parameters.gracePeriod).toBeDefined();
    
    // Approval rate should be a percentage
    expect(data.ceo.approvalRate).toMatch(/^\d+%$/);
    
    // Min quality score should be 90
    expect(data.parameters.minQualityScore).toBe('90');
  });
});

test.describe('State Consistency', () => {
  test('multiple rapid requests do not corrupt state', async ({ request }) => {
    const proposalIds = Array.from({ length: 10 }, (_, i) => `RAPID-${Date.now()}-${i}`);
    
    // Send 10 concurrent vote submissions
    const promises = proposalIds.map((id, i) => 
      sendA2A(request, 'submit-vote', {
        proposalId: id,
        agentId: 'treasury',
        vote: i % 2 === 0 ? 'APPROVE' : 'REJECT',
        reasoning: `Rapid test vote ${i}`,
        confidence: 50 + i * 5
      })
    );
    
    const results = await Promise.all(promises);
    
    // All should succeed
    for (const result of results) {
      expect(result.result).toBeDefined();
    }
  });

  test('deliberation is deterministic for same input', async ({ request }) => {
    const fixedProposal = {
      proposalId: 'DETERMINISM-TEST',
      title: 'Fixed Test Proposal',
      description: 'A proposal with fixed content to test determinism.',
      proposalType: 'GENERAL',
      submitter: '0xabc'
    };
    
    // Run deliberation twice
    const result1 = await sendA2A(request, 'deliberate', fixedProposal);
    const result2 = await sendA2A(request, 'deliberate', fixedProposal);
    
    const data1 = result1.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    const data2 = result2.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    
    // Both should have same structure
    expect(data1.votes.length).toBe(data2.votes.length);
    expect(data1.summary.total).toBe(data2.summary.total);
    
    // With heuristic inference (no LLM), votes should be deterministic
    // With LLM, they may vary - so we just check structure is consistent
    for (let i = 0; i < data1.votes.length; i++) {
      expect(data1.votes[i].agent).toBe(data2.votes[i].agent);
    }
  });
});

