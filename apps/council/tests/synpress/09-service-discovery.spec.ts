/**
 * Service Discovery Tests
 * 
 * Tests for A2A/MCP service discovery across council and CEO agents.
 */

import { test, expect } from '@playwright/test';

const COUNCIL_URL = 'http://localhost:8010';
const CEO_URL = 'http://localhost:8004';

test.describe('Service Discovery', () => {
  test('council server exposes A2A agent card', async ({ request }) => {
    const response = await request.get(`${COUNCIL_URL}/a2a/.well-known/agent-card.json`);
    expect(response.ok()).toBeTruthy();
    
    const card = await response.json();
    expect(card.name).toBe('Jeju AI Council');
    expect(card.url).toBe('/a2a');
    expect(card.skills).toBeDefined();
    expect(Array.isArray(card.skills)).toBe(true);
  });

  test('council A2A skills include governance operations', async ({ request }) => {
    const response = await request.get(`${COUNCIL_URL}/a2a/.well-known/agent-card.json`);
    expect(response.ok()).toBeTruthy();
    
    const card = await response.json();
    const skillIds = card.skills.map((s: { id: string }) => s.id);
    
    // Core governance skills
    expect(skillIds).toContain('assess-proposal');
    expect(skillIds).toContain('get-council-status');
    expect(skillIds).toContain('add-commentary');
  });

  test('council MCP lists available tools', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/mcp/tools/list`);
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.tools).toBeDefined();
    expect(data.tools.length).toBeGreaterThan(0);
    
    const toolNames = data.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain('assess_proposal_quality');
    expect(toolNames).toContain('prepare_proposal_submission');
  });

  test('council MCP lists available resources', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/mcp/resources/list`);
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.resources).toBeDefined();
    expect(data.resources.length).toBeGreaterThan(0);
  });

  test('council health shows all components', async ({ request }) => {
    const response = await request.get(`${COUNCIL_URL}/health`);
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.service).toBe('jeju-council');
    expect(data.tee).toBeDefined();
  });

  test('MCP tools have proper schema definitions', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/mcp/tools/list`);
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    
    for (const tool of data.tools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  test('A2A skills have required fields', async ({ request }) => {
    const response = await request.get(`${COUNCIL_URL}/a2a/.well-known/agent-card.json`);
    expect(response.ok()).toBeTruthy();
    
    const card = await response.json();
    
    for (const skill of card.skills) {
      expect(skill.id).toBeDefined();
      expect(skill.name).toBeDefined();
      expect(skill.description).toBeDefined();
    }
  });

  test('MCP initialize returns capabilities', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/mcp/initialize`, {
      data: {
        protocolVersion: '2024-11-05',
        capabilities: {}
      }
    });
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.protocolVersion).toBe('2024-11-05');
    expect(data.serverInfo).toBeDefined();
    expect(data.capabilities).toBeDefined();
  });

  test('MCP resource read returns content', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/mcp/resources/read`, {
      data: { uri: 'council://council/agents' }
    });
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.contents).toBeDefined();
    expect(data.contents.length).toBeGreaterThan(0);
    expect(data.contents[0].text).toBeDefined();
  });
});
