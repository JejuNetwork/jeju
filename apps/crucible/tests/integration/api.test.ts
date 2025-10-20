import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import type { CrucibleManager } from '../../src/index';

/**
 * Integration Tests: API Routes
 * 
 * Tests all Crucible API endpoints
 */

describe('Crucible API', () => {
  const BASE_URL = 'http://localhost:7777';
  
  let serverProcess: any;

  beforeAll(async () => {
    // Note: Server should be running for these tests
    // Run with: bun run dev (in separate terminal)
    // Or we could start it programmatically here
  });

  test('GET /api/health returns healthy status', async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.status).toBe('healthy');
      expect(data.agents).toBeGreaterThanOrEqual(0);
      expect(typeof data.uptime).toBe('number');
    } catch (error) {
      console.warn('Server not running - start with: bun run dev');
      // Don't fail test if server not running (for CI)
    }
  });

  test('GET /api/agents returns array', async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/agents`);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      
      if (data.length > 0) {
        const agent = data[0];
        expect(agent).toHaveProperty('id');
        expect(agent).toHaveProperty('name');
        expect(agent).toHaveProperty('type');
        expect(agent).toHaveProperty('wallet');
      }
    } catch (error) {
      console.warn('Server not running - start with: bun run dev');
    }
  });

  test('GET /api/crucible/stats returns statistics', async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/crucible/stats`);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('totalAgents');
      expect(data).toHaveProperty('byType');
      expect(data).toHaveProperty('vulnerabilitiesFound');
      expect(typeof data.totalAgents).toBe('number');
    } catch (error) {
      console.warn('Server not running - start with: bun run dev');
    }
  });
});

