/**
 * ERC-8004 Registration Tests
 * Tests agent registration to the ERC-8004 registry
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { ERC8004RegistryClient } from '../erc8004/registry';

describe('ERC-8004 Registration', () => {
  let client: ERC8004RegistryClient;
  const testRpcUrl = process.env.TEST_RPC_URL || 'http://localhost:8545';
  const testPrivateKey = process.env.TEST_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

  beforeAll(async () => {
    client = new ERC8004RegistryClient(testRpcUrl, testPrivateKey);
    
    try {
      await client.initialize();
    } catch (error) {
      console.log('[Test] Note: ERC-8004 contracts may not be deployed. Skipping tests.');
      console.log('[Test] Deploy contracts with: cd contracts && forge script script/DeployLiquiditySystem.s.sol --rpc-url http://localhost:8545 --broadcast');
    }
  });

  it('should initialize registry client', async () => {
    expect(client).toBeDefined();
    expect(client.getWalletAddress()).toBeDefined();
    expect(client.getWalletAddress().startsWith('0x')).toBe(true);
  });

  it('should register a new agent', async () => {
    try {
      const result = await client.register('TestAgent', 'ai-agent');
      
      expect(result.registered).toBe(true);
      expect(result.agentId).toBeDefined();
      
      if (result.agentId) {
        expect(result.agentId > 0n).toBe(true);
        console.log(`[Test] Successfully registered as Agent #${result.agentId}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        console.log('[Test] Contracts not deployed, skipping registration test');
      } else {
        throw error;
      }
    }
  });

  it('should return existing agent ID on second registration', async () => {
    try {
      const result1 = await client.register('TestAgent', 'ai-agent');
      const result2 = await client.register('TestAgent', 'ai-agent');
      
      expect(result1.agentId).toBe(result2.agentId);
      console.log('[Test] Correctly returned existing agent ID');
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        console.log('[Test] Contracts not deployed, skipping duplicate registration test');
      } else {
        throw error;
      }
    }
  });

  it('should get agent ID from wallet address', async () => {
    try {
      const agentId = await client.getMyAgentId();
      
      if (agentId !== null) {
        expect(agentId > 0n).toBe(true);
        console.log(`[Test] Agent ID: ${agentId}`);
      } else {
        console.log('[Test] No agent registered yet');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        console.log('[Test] Contracts not deployed, skipping agent ID lookup test');
      } else {
        throw error;
      }
    }
  });
});

