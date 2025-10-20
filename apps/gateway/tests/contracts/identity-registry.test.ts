/**
 * @fileoverview Programmatic IdentityRegistry contract tests
 * @module gateway/tests/contracts/identity-registry
 */

import { expect, test, describe } from 'bun:test';
import { getPublicClient, getContractAddresses } from '../fixtures/contracts';

describe('IdentityRegistry Contract', () => {
  const publicClient = getPublicClient();
  
  test('should calculate required stake for protocol tokens', async () => {
    const addresses = await getContractAddresses();
    const elizaOSAddress = process.env.VITE_ELIZAOS_TOKEN_ADDRESS as `0x${string}`;
    
    if (elizaOSAddress && elizaOSAddress !== '0x0000000000000000000000000000000000000000') {
      const requiredStake = await publicClient.readContract({
        address: addresses.identityRegistry,
        abi: [{
          type: 'function',
          name: 'calculateRequiredStake',
          inputs: [{ name: 'token', type: 'address' }],
          outputs: [{ name: 'amount', type: 'uint256' }],
          stateMutability: 'view',
        }],
        functionName: 'calculateRequiredStake',
        args: [elizaOSAddress],
      });
      
      expect(requiredStake).toBeDefined();
      expect(requiredStake).toBeGreaterThan(0n);
      
      // Should be approximately 0.001 ETH worth in the token
      // For elizaOS at $0.10, that's about 35 tokens (0.001 ETH * $3500 / $0.10)
    }
  });

  test('should get all registered agents', async () => {
    const addresses = await getContractAddresses();
    
    const agents = await publicClient.readContract({
      address: addresses.identityRegistry,
      abi: [{
        type: 'function',
        name: 'getAllAgents',
        inputs: [
          { name: 'offset', type: 'uint256' },
          { name: 'limit', type: 'uint256' }
        ],
        outputs: [{ name: 'agentIds', type: 'uint256[]' }],
        stateMutability: 'view',
      }],
      functionName: 'getAllAgents',
      args: [0n, 100n],
    });
    
    expect(Array.isArray(agents)).toBe(true);
  });

  test('should get agents by tag', async () => {
    const addresses = await getContractAddresses();
    
    const gameAgents = await publicClient.readContract({
      address: addresses.identityRegistry,
      abi: [{
        type: 'function',
        name: 'getAgentsByTag',
        inputs: [{ name: 'tag', type: 'string' }],
        outputs: [{ name: 'agentIds', type: 'uint256[]' }],
        stateMutability: 'view',
      }],
      functionName: 'getAgentsByTag',
      args: ['game'],
    });
    
    expect(Array.isArray(gameAgents)).toBe(true);
  });

  test('should read agent metadata if agents exist', async () => {
    const addresses = await getContractAddresses();
    
    const agents = await publicClient.readContract({
      address: addresses.identityRegistry,
      abi: [{
        type: 'function',
        name: 'getAllAgents',
        inputs: [
          { name: 'offset', type: 'uint256' },
          { name: 'limit', type: 'uint256' }
        ],
        outputs: [{ name: 'agentIds', type: 'uint256[]' }],
        stateMutability: 'view',
      }],
      functionName: 'getAllAgents',
      args: [0n, 100n],
    }) as bigint[];
    
    if (agents.length > 0) {
      const tokenURI = await publicClient.readContract({
        address: addresses.identityRegistry,
        abi: [{
          type: 'function',
          name: 'tokenURI',
          inputs: [{ name: 'agentId', type: 'uint256' }],
          outputs: [{ name: '', type: 'string' }],
          stateMutability: 'view',
        }],
        functionName: 'tokenURI',
        args: [agents[0]],
      });
      
      expect(tokenURI).toBeDefined();
      expect(typeof tokenURI).toBe('string');
    }
  });

  test('should read agent tags if agents exist', async () => {
    const addresses = await getContractAddresses();
    
    const agents = await publicClient.readContract({
      address: addresses.identityRegistry,
      abi: [{
        type: 'function',
        name: 'getAllAgents',
        inputs: [
          { name: 'offset', type: 'uint256' },
          { name: 'limit', type: 'uint256' }
        ],
        outputs: [{ name: 'agentIds', type: 'uint256[]' }],
        stateMutability: 'view',
      }],
      functionName: 'getAllAgents',
      args: [0n, 100n],
    }) as bigint[];
    
    if (agents.length > 0) {
      const tags = await publicClient.readContract({
        address: addresses.identityRegistry,
        abi: [{
          type: 'function',
          name: 'getAgentTags',
          inputs: [{ name: 'agentId', type: 'uint256' }],
          outputs: [{ name: 'tags', type: 'string[]' }],
          stateMutability: 'view',
        }],
        functionName: 'getAgentTags',
        args: [agents[0]],
      });
      
      expect(Array.isArray(tags)).toBe(true);
      const agentTags = tags as string[];
      expect(agentTags.length).toBeGreaterThan(0);
    }
  });

  test('should read stake info for registered agents', async () => {
    const addresses = await getContractAddresses();
    
    const agents = await publicClient.readContract({
      address: addresses.identityRegistry,
      abi: [{
        type: 'function',
        name: 'getAllAgents',
        inputs: [
          { name: 'offset', type: 'uint256' },
          { name: 'limit', type: 'uint256' }
        ],
        outputs: [{ name: 'agentIds', type: 'uint256[]' }],
        stateMutability: 'view',
      }],
      functionName: 'getAllAgents',
      args: [0n, 100n],
    }) as bigint[];
    
    if (agents.length > 0) {
      const stakeInfo = await publicClient.readContract({
        address: addresses.identityRegistry,
        abi: [{
          type: 'function',
          name: 'getStakeInfo',
          inputs: [{ name: 'agentId', type: 'uint256' }],
          outputs: [{
            components: [
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint256' },
              { name: 'depositedAt', type: 'uint256' },
              { name: 'withdrawn', type: 'bool' }
            ],
            type: 'tuple'
          }],
          stateMutability: 'view',
        }],
        functionName: 'getStakeInfo',
        args: [agents[0]],
      });
      
      expect(stakeInfo).toBeDefined();
      const stake = stakeInfo as {
        token: `0x${string}`;
        amount: bigint;
        depositedAt: bigint;
        withdrawn: boolean;
      };
      
      expect(stake.token).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(stake.amount).toBeGreaterThan(0n);
      expect(stake.depositedAt).toBeGreaterThan(0n);
    }
  });

  test('should verify agent ownership', async () => {
    const addresses = await getContractAddresses();
    
    const agents = await publicClient.readContract({
      address: addresses.identityRegistry,
      abi: [{
        type: 'function',
        name: 'getAllAgents',
        inputs: [
          { name: 'offset', type: 'uint256' },
          { name: 'limit', type: 'uint256' }
        ],
        outputs: [{ name: 'agentIds', type: 'uint256[]' }],
        stateMutability: 'view',
      }],
      functionName: 'getAllAgents',
      args: [0n, 100n],
    }) as bigint[];
    
    if (agents.length > 0) {
      const owner = await publicClient.readContract({
        address: addresses.identityRegistry,
        abi: [{
          type: 'function',
          name: 'ownerOf',
          inputs: [{ name: 'agentId', type: 'uint256' }],
          outputs: [{ name: 'owner', type: 'address' }],
          stateMutability: 'view',
        }],
        functionName: 'ownerOf',
        args: [agents[0]],
      });
      
      expect(owner).toBeDefined();
      expect(owner).toMatch(/^0x[a-fA-F0-9]{40}$/);
    }
  });
});


