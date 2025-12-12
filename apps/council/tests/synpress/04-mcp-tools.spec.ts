/**
 * MCP Tools Tests
 * 
 * Tests for MCP server tool functionality.
 */

import { test, expect } from '@playwright/test';

test.describe('MCP Tools', () => {
  test('assess_proposal_quality tool works', async ({ request }) => {
    const response = await request.post('http://localhost:8010/mcp/tools/call', {
      data: {
        name: 'assess_proposal_quality',
        arguments: {
          title: 'Improve DAO Treasury Management',
          summary: 'This proposal aims to implement better treasury management practices for long-term sustainability.',
          description: `
## Problem
Current treasury management is manual and lacks transparency.

## Solution
Implement automated treasury management with community oversight.

## Implementation
Deploy treasury contracts with multi-sig governance.

## Timeline
2 weeks for development, 1 week for testing.

## Cost
15 ETH total budget.

## Benefit
Better risk management and member trust.

## Risk Assessment
Smart contract risks mitigated by audits.
          `,
          proposalType: 'TREASURY_ALLOCATION'
        }
      }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.content).toBeDefined();
    expect(data.isError).toBe(false);
    
    const result = JSON.parse(data.content[0].text);
    expect(result.overallScore).toBeDefined();
    expect(result.criteria).toBeDefined();
  });

  test('prepare_proposal_submission tool works', async ({ request }) => {
    const response = await request.post('http://localhost:8010/mcp/tools/call', {
      data: {
        name: 'prepare_proposal_submission',
        arguments: {
          proposalType: 'GRANT',
          qualityScore: '92',
          contentHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
        }
      }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.isError).toBe(false);
    
    const result = JSON.parse(data.content[0].text);
    expect(result.transaction).toBeDefined();
    expect(result.transaction.method).toBe('submitProposal');
  });

  test('request_deep_research tool returns research info (local mode)', async ({ request }) => {
    const response = await request.post('http://localhost:8010/mcp/tools/call', {
      data: {
        name: 'request_deep_research',
        arguments: {
          proposalId: '0x1234567890123456789012345678901234567890123456789012345678901234'
        }
      }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.isError).toBe(false);
    
    const result = JSON.parse(data.content[0].text);
    // In local mode, uses local inference
    expect(result.model).toBe('local-inference');
    expect(result.mode).toBe('local');
  });
});
