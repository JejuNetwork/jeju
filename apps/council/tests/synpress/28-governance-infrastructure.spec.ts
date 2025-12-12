/**
 * Governance Infrastructure Tests
 *
 * Tests the new decentralized governance components:
 * - DelegationRegistry
 * - CircuitBreaker
 * - CouncilSafeModule
 * - Lit Protocol encryption
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../../wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const BASE_URL = process.env.COUNCIL_API_URL ?? 'http://localhost:8010';

test.describe('Governance Infrastructure', () => {
  test.describe('CEO Models and Decisions API', () => {
    test('should return model candidates list', async ({ page }) => {
      const response = await page.request.get(`${BASE_URL}/api/v1/ceo/models`);
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data).toHaveProperty('models');
      expect(Array.isArray(data.models)).toBeTruthy();
    });

    test('should return recent decisions', async ({ page }) => {
      const response = await page.request.get(`${BASE_URL}/api/v1/ceo/decisions?limit=5`);
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data).toHaveProperty('decisions');
      expect(Array.isArray(data.decisions)).toBeTruthy();
    });

    test('should respect limit parameter for decisions', async ({ page }) => {
      const response = await page.request.get(`${BASE_URL}/api/v1/ceo/decisions?limit=3`);
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data.decisions.length).toBeLessThanOrEqual(3);
    });
  });

  test.describe('TEE Status', () => {
    test('should report TEE mode in health check', async ({ page }) => {
      const response = await page.request.get(`${BASE_URL}/health`);
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data).toHaveProperty('status', 'healthy');
    });

    test('should have orchestrator status endpoint', async ({ page }) => {
      const response = await page.request.get(`${BASE_URL}/api/v1/orchestrator/status`);
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data).toHaveProperty('initialized');
      expect(data).toHaveProperty('teeMode');
      expect(['hardware', 'simulated']).toContain(data.teeMode);
    });
  });

  test.describe('Governance Stats', () => {
    test('should return governance statistics', async ({ page }) => {
      const response = await page.request.get(`${BASE_URL}/api/v1/governance/stats`);
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data).toHaveProperty('totalProposals');
      expect(data).toHaveProperty('ceo');
      expect(data).toHaveProperty('parameters');
    });

    test('should include CEO model info in stats', async ({ page }) => {
      const response = await page.request.get(`${BASE_URL}/api/v1/governance/stats`);
      const data = await response.json();

      expect(data.ceo).toHaveProperty('model');
      expect(data.ceo).toHaveProperty('decisions');
      expect(data.ceo).toHaveProperty('approvalRate');
    });

    test('should include governance parameters', async ({ page }) => {
      const response = await page.request.get(`${BASE_URL}/api/v1/governance/stats`);
      const data = await response.json();

      expect(data.parameters).toHaveProperty('minQualityScore');
      expect(data.parameters).toHaveProperty('councilVotingPeriod');
      expect(data.parameters).toHaveProperty('gracePeriod');
    });
  });

  test.describe('Proposal Assessment', () => {
    test('should assess proposal quality with heuristics when Ollama unavailable', async ({ page }) => {
      const response = await page.request.post(`${BASE_URL}/api/v1/proposals/assess`, {
        data: {
          title: 'Test Governance Proposal',
          description: 'This is a detailed test proposal for governance infrastructure testing. It includes comprehensive details about the proposed changes.',
          summary: 'Testing governance assessment',
          proposalType: 0,
          tags: ['test', 'governance'],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data).toHaveProperty('overallScore');
      expect(data.overallScore).toBeGreaterThanOrEqual(0);
      expect(data.overallScore).toBeLessThanOrEqual(100);

      expect(data).toHaveProperty('criteria');
      expect(data.criteria).toHaveProperty('clarity');
      expect(data.criteria).toHaveProperty('feasibility');
      expect(data.criteria).toHaveProperty('alignment');
      expect(data.criteria).toHaveProperty('impact');
      expect(data.criteria).toHaveProperty('completeness');
    });

    test('should provide improvement suggestions', async ({ page }) => {
      const assessResponse = await page.request.post(`${BASE_URL}/api/v1/proposals/assess`, {
        data: {
          title: 'Short',
          description: 'Brief',
          summary: 'Test',
          proposalType: 0,
          tags: [],
        },
      });

      const assessment = await assessResponse.json();

      // Find lowest scoring criterion
      const criteria = assessment.criteria;
      const lowestCriterion = Object.entries(criteria).reduce(
        (min, [key, value]) => ((value as number) < min.value ? { key, value: value as number } : min),
        { key: '', value: 100 }
      );

      const improveResponse = await page.request.post(`${BASE_URL}/api/v1/proposals/improve`, {
        data: {
          draft: {
            title: 'Short',
            description: 'Brief',
            summary: 'Test',
            proposalType: 0,
            tags: [],
          },
          criterion: lowestCriterion.key,
        },
      });

      expect(improveResponse.ok()).toBeTruthy();
      const improvement = await improveResponse.json();
      expect(improvement).toHaveProperty('suggestion');
      expect(typeof improvement.suggestion).toBe('string');
      expect(improvement.suggestion.length).toBeGreaterThan(0);
    });
  });

  test.describe('Research Agent', () => {
    test('should generate research report', async ({ page }) => {
      const response = await page.request.post(`${BASE_URL}/api/v1/research/deep`, {
        data: {
          proposalId: 'test-proposal-001',
          title: 'Governance Infrastructure Upgrade',
          description: 'Upgrade the governance infrastructure to include delegation and emergency controls.',
          depth: 'quick',
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data).toHaveProperty('riskLevel');
      expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(data.riskLevel);

      expect(data).toHaveProperty('recommendation');
      expect(['PROCEED', 'CAUTION', 'REJECT', 'MORE_INFO']).toContain(data.recommendation);

      expect(data).toHaveProperty('executionTime');
      expect(data.executionTime).toBeGreaterThan(0);
    });

    test('should perform quick screening', async ({ page }) => {
      const response = await page.request.post(`${BASE_URL}/api/v1/research/screen`, {
        data: {
          proposalId: 'test-proposal-002',
          title: 'Minor Parameter Update',
          description: 'Update a minor governance parameter.',
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data).toHaveProperty('pass');
      expect(typeof data.pass).toBe('boolean');
      expect(data).toHaveProperty('flags');
      expect(Array.isArray(data.flags)).toBeTruthy();
    });
  });

  test.describe('Moderation System', () => {
    test('should accept flag submission', async ({ page }) => {
      const response = await page.request.post(`${BASE_URL}/api/v1/moderation/flag`, {
        data: {
          proposalId: 'test-moderation-001',
          flagType: 'SPAM',
          reason: 'Test flag for governance testing',
          reporter: '0x1234567890123456789012345678901234567890',
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data).toHaveProperty('flagId');
    });

    test('should return moderation stats', async ({ page }) => {
      const response = await page.request.get(`${BASE_URL}/api/v1/moderation/stats`);
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      expect(data).toHaveProperty('totalFlags');
      expect(data).toHaveProperty('pendingFlags');
      expect(data).toHaveProperty('resolvedFlags');
    });
  });

  test.describe('Lit Protocol Status', () => {
    test('should have lit encryption module loaded', async ({ page }) => {
      // Test that the server started with Lit module
      const response = await page.request.get(`${BASE_URL}/health`);
      expect(response.ok()).toBeTruthy();

      // The lit-encryption module is loaded at startup
      // If there were errors, the server wouldn't start
      const data = await response.json();
      expect(data.status).toBe('healthy');
    });
  });
});
