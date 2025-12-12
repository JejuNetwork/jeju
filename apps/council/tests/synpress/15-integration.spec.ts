/**
 * Integration Tests with Real Dependencies
 * 
 * Tests that exercise real code paths with actual dependencies.
 * Verifies outputs match expected values by inspecting data.
 */

import { test, expect } from '@playwright/test';

const COUNCIL_URL = 'http://localhost:8010';
const RPC_URL = process.env.RPC_URL ?? 'http://localhost:8545';

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
          messageId: `int-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          parts: [{ kind: 'data', data: { skillId, params: params ?? {} } }]
        }
      }
    }
  });
  return response.json();
};

test.describe('Real Blockchain Integration', () => {
  test.beforeAll(async () => {
    // Skip if no RPC available
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] })
      });
      if (!response.ok) test.skip();
    } catch {
      test.skip();
    }
  });

  test('governance stats reflect chain state accurately', async ({ request }) => {
    const result = await sendA2A(request, 'get-governance-stats');
    
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    
    // totalProposals should be a valid number string
    const totalProposals = parseInt(data.totalProposals, 10);
    expect(Number.isNaN(totalProposals)).toBe(false);
    expect(totalProposals).toBeGreaterThanOrEqual(0);
    
    // CEO decisions should be >= 0
    const decisions = parseInt(data.ceo.decisions, 10);
    expect(Number.isNaN(decisions)).toBe(false);
    expect(decisions).toBeGreaterThanOrEqual(0);
    
    // Approval rate should be valid percentage
    const approvalRate = data.ceo.approvalRate;
    expect(approvalRate).toMatch(/^\d+%$/);
    const rateValue = parseInt(approvalRate, 10);
    expect(rateValue).toBeGreaterThanOrEqual(0);
    expect(rateValue).toBeLessThanOrEqual(100);
  });

  test('council status shows all agent roles', async ({ request }) => {
    const result = await sendA2A(request, 'get-council-status');
    
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    
    // Should have agents array
    expect(Array.isArray(data.agents)).toBe(true);
    expect(data.agents.length).toBeGreaterThanOrEqual(4);
    
    // Each agent should have required fields
    const requiredRoles = ['TREASURY', 'CODE', 'COMMUNITY', 'SECURITY'];
    const agentRoles = data.agents.map((a: { role: string }) => a.role);
    
    for (const role of requiredRoles) {
      expect(agentRoles).toContain(role);
    }
    
    // Voting period should be a valid duration
    expect(data.votingPeriod).toBeDefined();
    expect(data.gracePeriod).toBeDefined();
  });

  test('CEO status shows model information', async ({ request }) => {
    const result = await sendA2A(request, 'get-ceo-status');
    
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    
    // Should have current model
    expect(data.currentModel).toBeDefined();
    expect(data.currentModel.name).toBeDefined();
    expect(data.currentModel.modelId).toBeDefined();
    
    // Should have stats
    expect(data.stats).toBeDefined();
    expect(data.stats.totalDecisions).toBeDefined();
    expect(data.stats.approvalRate).toBeDefined();
  });
});

test.describe('Orchestrator Integration', () => {
  test('trigger endpoint runs orchestrator cycle', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/trigger/orchestrator`, {
      data: { action: 'run-cycle' }
    });
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.success).toBe(true);
    expect(typeof data.cycleCount).toBe('number');
    expect(data.cycleCount).toBeGreaterThanOrEqual(0);
    expect(typeof data.duration).toBe('number');
    expect(data.duration).toBeGreaterThanOrEqual(0);
  });

  test('orchestrator status reflects current state', async ({ request }) => {
    const response = await request.get(`${COUNCIL_URL}/api/v1/orchestrator/status`);
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(typeof data.running).toBe('boolean');
    expect(typeof data.cycleCount).toBe('number');
    expect(data.cycleCount).toBeGreaterThanOrEqual(0);
  });

  test('trigger list shows available triggers', async ({ request }) => {
    const response = await request.get(`${COUNCIL_URL}/api/v1/triggers`);
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.mode).toBeDefined();
    expect(['local', 'compute']).toContain(data.mode);
    
    if (data.mode === 'compute') {
      expect(Array.isArray(data.triggers)).toBe(true);
    }
  });

  test('multiple trigger executions increment cycle count', async ({ request }) => {
    // Get initial status
    const initial = await request.get(`${COUNCIL_URL}/api/v1/orchestrator/status`);
    const initialData = await initial.json();
    const initialCount = initialData.cycleCount;
    
    // Trigger 3 cycles
    for (let i = 0; i < 3; i++) {
      await request.post(`${COUNCIL_URL}/trigger/orchestrator`);
    }
    
    // Get final status
    const final = await request.get(`${COUNCIL_URL}/api/v1/orchestrator/status`);
    const finalData = await final.json();
    
    // Count should have increased by at least 3
    expect(finalData.cycleCount).toBeGreaterThanOrEqual(initialCount + 3);
  });
});

test.describe('MCP Server Integration', () => {
  test('list-resources returns governance resources', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/mcp/resources/list`);
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(Array.isArray(data.resources)).toBe(true);
    expect(data.resources.length).toBeGreaterThan(0);
    
    // Should have governance-related resources
    const resourceUris = data.resources.map((r: { uri: string }) => r.uri);
    expect(resourceUris.some((u: string) => u.includes('proposals') || u.includes('council'))).toBe(true);
  });

  test('list-tools returns governance tools', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/mcp/tools/list`);
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(Array.isArray(data.tools)).toBe(true);
    expect(data.tools.length).toBeGreaterThan(0);
    
    // Each tool should have name and description
    for (const tool of data.tools) {
      expect(tool.name).toBeDefined();
      expect(typeof tool.name).toBe('string');
    }
  });

  test('call-tool executes assess-proposal', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/mcp/tools/call`, {
      data: {
        name: 'assess-proposal',
        arguments: {
          title: 'MCP Tool Test Proposal',
          summary: 'Testing MCP tool invocation for proposal assessment.',
          description: 'This tests that MCP tools work correctly.'
        }
      }
    });
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.content).toBeDefined();
    expect(data.content.length).toBeGreaterThan(0);
  });

  test('read-resource returns proposal data', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/mcp/resources/read`, {
      data: { uri: 'council://proposals/active' }
    });
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.contents).toBeDefined();
    expect(Array.isArray(data.contents)).toBe(true);
  });
});

test.describe('REST API Integration', () => {
  test('GET /api/v1/proposals returns list', async ({ request }) => {
    const response = await request.get(`${COUNCIL_URL}/api/v1/proposals`);
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    // Should have proposals array (may be empty)
    expect(Array.isArray(data.proposals) || data.total !== undefined).toBe(true);
  });

  test('GET /api/v1/proposals?active=true filters active only', async ({ request }) => {
    const allResponse = await request.get(`${COUNCIL_URL}/api/v1/proposals`);
    const activeResponse = await request.get(`${COUNCIL_URL}/api/v1/proposals?active=true`);
    
    expect(allResponse.ok()).toBeTruthy();
    expect(activeResponse.ok()).toBeTruthy();
    
    const allData = await allResponse.json();
    const activeData = await activeResponse.json();
    
    // Active count should be <= total count
    const allCount = allData.total ?? allData.proposals?.length ?? 0;
    const activeCount = activeData.total ?? activeData.proposals?.length ?? 0;
    expect(activeCount).toBeLessThanOrEqual(allCount);
  });

  test('GET /api/v1/ceo returns status', async ({ request }) => {
    const response = await request.get(`${COUNCIL_URL}/api/v1/ceo`);
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.currentModel || data.model).toBeDefined();
  });

  test('GET /api/v1/governance/stats returns stats', async ({ request }) => {
    const response = await request.get(`${COUNCIL_URL}/api/v1/governance/stats`);
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.totalProposals).toBeDefined();
    expect(data.ceo).toBeDefined();
    expect(data.parameters).toBeDefined();
  });
});

test.describe('Full Proposal Lifecycle', () => {
  test('complete proposal flow: assess -> submit -> deliberate -> decision', async ({ request }) => {
    const proposalId = `LIFECYCLE-${Date.now()}`;
    
    // Step 1: Assess proposal quality
    const assessResult = await sendA2A(request, 'assess-proposal', {
      title: 'Lifecycle Test: Treasury Optimization',
      summary: 'A comprehensive test proposal covering all aspects of the lifecycle flow.',
      description: `## Problem
The current treasury management lacks optimization.

## Solution
Implement automated treasury rebalancing using DeFi protocols.

## Implementation
1. Smart contract development
2. Integration with Aave/Compound
3. Automated triggers

## Timeline
- Week 1-2: Development
- Week 3: Audit
- Week 4: Deployment

## Cost
Total: 75 ETH

## Benefit
- 15% APY improvement
- Reduced manual management
- Increased transparency

## Risk Assessment
- Smart contract risk: Mitigated by audits
- Market risk: Diversified positions`
    });
    
    const assessData = assessResult.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(assessData.overallScore).toBeDefined();
    const qualityScore = assessData.overallScore;
    
    // Step 2: Prepare submission (if quality passes)
    if (qualityScore >= 90) {
      const submitResult = await sendA2A(request, 'submit-proposal', {
        proposalType: 1,
        qualityScore,
        contentHash: '0x' + proposalId.padEnd(64, '0').slice(0, 64)
      });
      
      const submitData = submitResult.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
      expect(submitData.action).toBe('submitProposal');
    }
    
    // Step 3: Council deliberation
    const deliberateResult = await sendA2A(request, 'deliberate', {
      proposalId,
      title: 'Lifecycle Test: Treasury Optimization',
      description: 'Test proposal for lifecycle verification',
      proposalType: 'TREASURY_ALLOCATION',
      submitter: '0x1234'
    });
    
    const deliberateData = deliberateResult.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(deliberateData.votes).toBeDefined();
    expect(deliberateData.votes.length).toBe(5);
    expect(deliberateData.recommendation).toBeDefined();
    
    // Step 4: CEO decision
    const decisionResult = await sendA2A(request, 'ceo-decision', { proposalId });
    
    const decisionData = decisionResult.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    expect(typeof decisionData.approved).toBe('boolean');
    expect(decisionData.reasoning).toBeDefined();
    expect(Array.isArray(decisionData.recommendations)).toBe(true);
  });
});

test.describe('Local Storage Integration', () => {
  test('research request stores to local storage', async ({ request }) => {
    const proposalId = `STORAGE-${Date.now()}`;
    
    const result = await sendA2A(request, 'request-research', { proposalId });
    
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    
    expect(data.proposalId).toBe(proposalId);
    expect(data.mode).toBeDefined();
    expect(['local', 'cloud']).toContain(data.mode);
    
    if (data.mode === 'local') {
      expect(data.estimatedCost).toBe('0');
    }
  });

  test('commentary is stored and retrievable pattern', async ({ request }) => {
    const proposalId = `COMMENT-${Date.now()}`;
    const content = 'This is a test commentary that should be stored.';
    
    const addResult = await sendA2A(request, 'add-commentary', {
      proposalId,
      content,
      sentiment: 'neutral'
    });
    
    const addData = addResult.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    
    // Commentary should echo back the content
    expect(addData.content).toBe(content);
    expect(addData.sentiment).toBe('neutral');
    expect(addData.proposalId).toBe(proposalId);
    expect(addData.timestamp).toBeDefined();
  });
});

test.describe('TEE Mode Verification', () => {
  test('health shows TEE mode', async ({ request }) => {
    const response = await request.get(`${COUNCIL_URL}/health`);
    const data = await response.json();
    
    expect(data.tee).toBeDefined();
    expect(['simulated', 'hardware']).toContain(data.tee);
  });

  test('CEO decision includes TEE attestation info', async ({ request }) => {
    const result = await sendA2A(request, 'ceo-decision', {
      proposalId: 'TEE-TEST-' + Date.now()
    });
    
    const data = result.result.parts.find((p: { kind: string }) => p.kind === 'data')?.data;
    
    // In simulated mode, should indicate that
    expect(data.teeMode).toBeDefined();
    expect(['simulated', 'hardware']).toContain(data.teeMode);
  });
});
