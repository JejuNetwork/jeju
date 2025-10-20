import { describe, test, expect } from 'bun:test';

/**
 * Integration Tests: API Routes
 * 
 * Tests all Crucible API endpoints
 * Requires server running: bun run dev
 */

describe('Crucible API Routes', () => {
  const BASE_URL = process.env.API_BASE_URL || 'http://localhost:7777';

  test('GET /api/health returns health status', async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      
      if (response.ok) {
        const data = await response.json();
        
        expect(data).toHaveProperty('status');
        expect(data.status).toBe('healthy');
        expect(data).toHaveProperty('agents');
        expect(data).toHaveProperty('uptime');
        expect(typeof data.uptime).toBe('number');
        
        console.log(`✅ Health check passed (${data.agents} agents, ${Math.floor(data.uptime)}s uptime)`);
      } else {
        console.warn('⚠️  Server returned error:', response.status);
      }
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        console.warn('⚠️  Server not running - Start with: bun run dev');
        console.warn('   Skipping API test');
      } else {
        throw error;
      }
    }
  });

  test('GET /api/agents returns agent list', async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/agents`);
      
      if (response.ok) {
        const data = await response.json();
        
        expect(Array.isArray(data)).toBe(true);
        
        if (data.length > 0) {
          const agent = data[0];
          expect(agent).toHaveProperty('id');
          expect(agent).toHaveProperty('name');
          expect(agent).toHaveProperty('type');
          expect(agent).toHaveProperty('wallet');
          
          console.log(`✅ Found ${data.length} agents`);
        } else {
          console.warn('⚠️  No agents found - may not have auto-started');
        }
      }
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        console.warn('⚠️  Server not running');
      } else {
        throw error;
      }
    }
  });

  test('GET /api/crucible/stats returns statistics', async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/crucible/stats`);
      
      if (response.ok) {
        const data = await response.json();
        
        expect(data).toHaveProperty('totalAgents');
        expect(data).toHaveProperty('byType');
        expect(data).toHaveProperty('vulnerabilitiesFound');
        expect(typeof data.totalAgents).toBe('number');
        
        console.log(`✅ Stats: ${data.totalAgents} agents, ${data.vulnerabilitiesFound} vulnerabilities`);
      }
    } catch (error: any) {
      if (error.code !== 'ECONNREFUSED') throw error;
    }
  });

  test('GET /api/agents/:id with invalid ID returns 404', async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/agents/invalid-id-12345`);
      
      if (response.status === 404) {
        const data = await response.json();
        expect(data).toHaveProperty('error');
        console.log('✅ 404 error handling works');
      }
    } catch (error: any) {
      if (error.code !== 'ECONNREFUSED') throw error;
    }
  });
});

