/**
 * MCP Resources Tests
 * 
 * Tests for MCP server resource access.
 */

import { test, expect } from '@playwright/test';

test.describe('MCP Resources', () => {
  test('council agents resource returns roles', async ({ request }) => {
    const response = await request.post('http://localhost:8010/mcp/resources/read', {
      data: { uri: 'council://council/agents' }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.contents).toBeDefined();
    expect(data.contents.length).toBe(1);
    
    const content = JSON.parse(data.contents[0].text);
    expect(content.agents).toBeDefined();
    expect(content.agents.length).toBe(4);
    
    const roles = content.agents.map((a: { role: string }) => a.role);
    expect(roles).toContain('Treasury');
    expect(roles).toContain('Code');
    expect(roles).toContain('Community');
    expect(roles).toContain('Security');
  });

  test('invalid resource returns 404', async ({ request }) => {
    const response = await request.post('http://localhost:8010/mcp/resources/read', {
      data: { uri: 'council://invalid/resource' }
    });

    expect(response.status()).toBe(404);
  });

  test('MCP initialize returns capabilities', async ({ request }) => {
    const response = await request.post('http://localhost:8010/mcp/initialize');

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.protocolVersion).toBeDefined();
    expect(data.serverInfo).toBeDefined();
    expect(data.serverInfo.name).toBe('jeju-council');
    expect(data.capabilities.resources).toBe(true);
    expect(data.capabilities.tools).toBe(true);
  });

  test('MCP discovery endpoint works', async ({ request }) => {
    const response = await request.get('http://localhost:8010/mcp');

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.server).toBe('jeju-council');
    expect(data.resources).toBeDefined();
    expect(data.tools).toBeDefined();
  });

  test('MCP lists all available tools', async ({ request }) => {
    const response = await request.post('http://localhost:8010/mcp/tools/list');

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.tools).toBeDefined();
    expect(data.tools.length).toBeGreaterThan(0);
    
    const toolNames = data.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain('assess_proposal_quality');
    expect(toolNames).toContain('prepare_proposal_submission');
    expect(toolNames).toContain('request_deep_research');
  });
});
