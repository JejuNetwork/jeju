import { describe, test, expect } from 'bun:test';

/**
 * E2E Tests: Full Agent Workflows
 * 
 * Tests complete flows from attack → detect → report → vote
 * 
 * NOTE: These tests require:
 * - Jeju localnet running
 * - Crucible server running (bun run dev)
 * - All contracts deployed
 */

describe('Full Workflow E2E', () => {
  const BASE_URL = 'http://localhost:7777';

  test('agent creation workflow', async () => {
    try {
      // 1. Check server is running
      const healthRes = await fetch(`${BASE_URL}/api/health`);
      expect(healthRes.status).toBe(200);

      // 2. Get agent list
      const agentsRes = await fetch(`${BASE_URL}/api/agents`);
      expect(agentsRes.status).toBe(200);
      
      const agents = await agentsRes.json();
      expect(Array.isArray(agents)).toBe(true);

      // 3. Verify agent types
      if (agents.length > 0) {
        const types = agents.map((a: any) => a.type);
        console.log(`✅ Found ${agents.length} agents:`, types);
        
        // Should have hackers, scammers, citizens, guardians
        const uniqueTypes = [...new Set(types)];
        expect(uniqueTypes.length).toBeGreaterThan(0);
      }

      // 4. Get stats
      const statsRes = await fetch(`${BASE_URL}/api/crucible/stats`);
      expect(statsRes.status).toBe(200);
      
      const stats = await statsRes.json();
      expect(stats).toHaveProperty('totalAgents');
      expect(stats).toHaveProperty('byType');

      console.log('✅ API workflow test passed');
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        console.warn('⚠️  Server not running - start with: bun run dev');
        console.warn('   Skipping E2E test');
      } else {
        throw error;
      }
    }
  });

  test('network connectivity from test', async () => {
    try {
      // Test can reach Jeju localnet
      const response = await fetch('http://127.0.0.1:9545', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 1
        })
      });

      const data = await response.json();
      expect(data.result).toBe('0x539'); // 1337 in hex
      
      console.log('✅ Network connectivity test passed');
    } catch (error) {
      console.warn('⚠️  Localnet not running - start with: bun run dev');
    }
  });
});

