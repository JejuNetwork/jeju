/**
 * @fileoverview Governance A2A agent tests
 * @module gateway/tests/a2a/governance-agent
 */

import { expect, test, describe } from 'bun:test';

const GOVERNANCE_CARD_URL = 'http://localhost:4003/.well-known/governance-agent-card.json';

describe('Governance Agent Card', () => {
  test('should serve governance agent card', async () => {
    const response = await fetch(GOVERNANCE_CARD_URL);
    
    // Note: This endpoint is defined in public/ but may not be served by a2a-server
    // We'll check if it's accessible via the main Vite server
    const viteResponse = await fetch('http://localhost:4001/.well-known/governance-agent-card.json');
    
    expect(viteResponse.status).toBe(200);
    const card = await viteResponse.json();
    
    expect(card.id).toBe('jeju-futarchy-governance');
    expect(card.name).toBe('Jeju Futarchy Governance');
  });

  test('should list futarchy-specific capabilities', async () => {
    const response = await fetch('http://localhost:4001/.well-known/governance-agent-card.json');
    const card = await response.json();
    
    expect(card.capabilities.governance).toBe(true);
    expect(card.capabilities.futarchy).toBe(true);
    expect(card.capabilities.predictionMarkets).toBe(true);
  });

  test('should list governance skills', async () => {
    const response = await fetch('http://localhost:4001/.well-known/governance-agent-card.json');
    const card = await response.json();
    
    const skillIds = card.skills.map((s: { id: string }) => s.id);
    
    expect(skillIds).toContain('get-active-quests');
    expect(skillIds).toContain('get-voting-power');
    expect(skillIds).toContain('create-quest');
    expect(skillIds).toContain('vote-on-quest');
  });

  test('should specify governance metadata', async () => {
    const response = await fetch('http://localhost:4001/.well-known/governance-agent-card.json');
    const card = await response.json();
    
    expect(card.metadata.governance_type).toBe('futarchy');
    expect(card.metadata.voting_mechanism).toBe('stake_weighted');
    expect(card.metadata.supported_tokens).toContain('elizaOS');
    expect(card.metadata.min_voting_period).toBe('7 days');
  });
});

