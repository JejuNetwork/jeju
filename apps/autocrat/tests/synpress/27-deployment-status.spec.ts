/**
 * Deployment Status Tests
 *
 * These tests verify the actual deployment state and document
 * what features are available vs. unavailable in the current environment.
 */

import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:8010';

test.describe('Deployment Status', () => {
  test('health endpoint reports deployment state', async ({ request }) => {
    const response = await request.get(`${API_BASE}/health`);
    expect(response.ok()).toBeTruthy();

    const health = await response.json();

    // Log actual deployment state for visibility
    console.log('=== DEPLOYMENT STATUS ===');
    console.log(`ERC8004 Identity: ${health.erc8004?.identity ? 'DEPLOYED' : 'NOT DEPLOYED'}`);
    console.log(`ERC8004 Reputation: ${health.erc8004?.reputation ? 'DEPLOYED' : 'NOT DEPLOYED'}`);
    console.log(`ERC8004 Validation: ${health.erc8004?.validation ? 'DEPLOYED' : 'NOT DEPLOYED'}`);
    console.log(`Futarchy Council: ${health.futarchy?.council ? 'DEPLOYED' : 'NOT DEPLOYED'}`);
    console.log(`Futarchy Predimarket: ${health.futarchy?.predimarket ? 'DEPLOYED' : 'NOT DEPLOYED'}`);
    console.log(`Orchestrator: ${health.orchestrator ? 'RUNNING' : 'STOPPED'}`);
    console.log(`TEE Mode: ${health.tee}`);
    console.log('========================');

    // Verify structure exists
    expect(health.erc8004).toBeDefined();
    expect(health.futarchy).toBeDefined();
  });

  test('document features available without contracts', async ({ request }) => {
    const health = await (await request.get(`${API_BASE}/health`)).json();

    // These features work regardless of contract deployment
    const alwaysAvailable = [
      { name: 'Proposal Quality Assessment', endpoint: '/api/v1/proposals/assess', method: 'POST' },
      { name: 'Proposal Quick Score', endpoint: '/api/v1/proposals/quick-score', method: 'POST' },
      { name: 'Research Quick Screen', endpoint: '/api/v1/research/quick-screen', method: 'POST' },
      { name: 'Moderation Flag', endpoint: '/api/v1/moderation/flag', method: 'POST' },
      { name: 'Moderation Leaderboard', endpoint: '/api/v1/moderation/leaderboard', method: 'GET' },
    ];

    for (const feature of alwaysAvailable) {
      const response = feature.method === 'GET'
        ? await request.get(`${API_BASE}${feature.endpoint}`)
        : await request.post(`${API_BASE}${feature.endpoint}`, {
            data: feature.endpoint.includes('assess') || feature.endpoint.includes('quick-score')
              ? { title: 'Test', description: 'Test proposal description with content' }
              : feature.endpoint.includes('quick-screen')
              ? { proposalId: '0x1', title: 'Test', description: 'Test' }
              : { proposalId: '0x1', flagger: '0x1', flagType: 'SPAM', reason: 'test', stake: 10 }
          });

      // All of these should respond (even if some return errors for invalid data)
      expect(response.status()).toBeLessThan(500);
      console.log(`${feature.name}: ${response.ok() ? 'OK' : response.status()}`);
    }
  });

  test('document features requiring contracts', async ({ request }) => {
    const health = await (await request.get(`${API_BASE}/health`)).json();
    const contractsDeployed = health.erc8004?.identity || health.futarchy?.council;

    // These features return empty/error when contracts not deployed
    const contractFeatures = [
      { name: 'Agent Registration', endpoint: '/api/v1/agents/register', requiresContract: true },
      { name: 'Futarchy Parameters', endpoint: '/api/v1/futarchy/parameters', requiresContract: true },
      { name: 'Futarchy Escalate', endpoint: '/api/v1/futarchy/escalate', requiresContract: true },
    ];

    if (!contractsDeployed) {
      console.log('=== CONTRACTS NOT DEPLOYED ===');
      console.log('The following features are LIMITED:');
      for (const f of contractFeatures) {
        console.log(`- ${f.name}: Returns error/empty`);
      }
      console.log('To enable full functionality, deploy contracts and set addresses in env.');
    }

    // Verify agent registration returns appropriate error when not deployed
    const regResponse = await request.post(`${API_BASE}/api/v1/agents/register`, {
      data: { name: 'Test', role: 'TEST' }
    });

    if (!health.erc8004?.identity) {
      // Should return error, not fake success
      const data = await regResponse.json();
      expect(data.registered).toBe(false);
      expect(data.error).toBeDefined();
    }
  });

  test('Ollama status affects AI features', async ({ request }) => {
    // Test assessment to see if it uses AI or heuristics
    const response = await request.post(`${API_BASE}/api/v1/proposals/assess`, {
      data: {
        title: 'Test Proposal for Ollama Check',
        description: 'This is a test proposal to verify whether Ollama AI is being used or heuristic fallback.',
        proposalType: 0
      }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    console.log(`Assessment engine: ${data.assessedBy}`);

    if (data.assessedBy === 'heuristic') {
      console.log('WARNING: Ollama not available - using keyword-based heuristics');
      console.log('AI quality may be reduced. Start Ollama with: ollama serve');
    } else {
      console.log('Ollama AI is active and processing requests');
    }

    expect(['ollama', 'heuristic']).toContain(data.assessedBy);
  });
});
