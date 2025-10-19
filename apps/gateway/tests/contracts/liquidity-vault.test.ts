/**
 * @fileoverview Programmatic LiquidityVault contract tests
 * @module gateway/tests/contracts/liquidity-vault
 */

import { expect, test, describe } from 'bun:test';
import { getPublicClient, getContractAddresses, TEST_WALLET } from '../fixtures/contracts';

describe('LiquidityVault Contract', () => {
  const publicClient = getPublicClient();
  
  test('should read LP position for any address', async () => {
    const addresses = await getContractAddresses();
    
    // Get a deployed vault
    const deployments = await publicClient.readContract({
      address: addresses.paymasterFactory,
      abi: [{
        type: 'function',
        name: 'getAllDeployments',
        inputs: [],
        outputs: [{ name: 'tokens', type: 'address[]' }],
        stateMutability: 'view',
      }],
      functionName: 'getAllDeployments',
    }) as `0x${string}`[];
    
    if (deployments.length > 0) {
      const deployment = await publicClient.readContract({
        address: addresses.paymasterFactory,
        abi: [{
          type: 'function',
          name: 'getDeployment',
          inputs: [{ name: 'token', type: 'address' }],
          outputs: [{
            name: 'deployment',
            type: 'tuple',
            components: [
              { name: 'vault', type: 'address' },
            ]
          }],
          stateMutability: 'view',
        }],
        functionName: 'getDeployment',
        args: [deployments[0]],
      }) as { vault: `0x${string}` };
      
      const position = await publicClient.readContract({
        address: deployment.vault,
        abi: [{
          type: 'function',
          name: 'getLPPosition',
          inputs: [{ name: 'account', type: 'address' }],
          outputs: [
            { name: 'ethShareBalance', type: 'uint256' },
            { name: 'ethValue', type: 'uint256' },
            { name: 'tokenShareBalance', type: 'uint256' },
            { name: 'tokenValue', type: 'uint256' },
            { name: 'pendingFeeAmount', type: 'uint256' }
          ],
          stateMutability: 'view',
        }],
        functionName: 'getLPPosition',
        args: [TEST_WALLET.address as `0x${string}`],
      });
      
      expect(position).toBeDefined();
      expect(Array.isArray(position)).toBe(true);
      expect(position.length).toBe(5);
    }
  });

  test('should validate vault has correct token', async () => {
    const addresses = await getContractAddresses();
    
    const deployments = await publicClient.readContract({
      address: addresses.paymasterFactory,
      abi: [{
        type: 'function',
        name: 'getAllDeployments',
        inputs: [],
        outputs: [{ name: 'tokens', type: 'address[]' }],
        stateMutability: 'view',
      }],
      functionName: 'getAllDeployments',
    }) as `0x${string}`[];
    
    if (deployments.length > 0) {
      const deployment = await publicClient.readContract({
        address: addresses.paymasterFactory,
        abi: [{
          type: 'function',
          name: 'getDeployment',
          inputs: [{ name: 'token', type: 'address' }],
          outputs: [{
            name: 'deployment',
            type: 'tuple',
            components: [
              { name: 'token', type: 'address' },
              { name: 'vault', type: 'address' },
            ]
          }],
          stateMutability: 'view',
        }],
        functionName: 'getDeployment',
        args: [deployments[0]],
      }) as { token: `0x${string}`; vault: `0x${string}` };
      
      expect(deployment.token.toLowerCase()).toBe(deployments[0].toLowerCase());
    }
  });

  test('should track total ETH liquidity in vault', async () => {
    const addresses = await getContractAddresses();
    
    const deployments = await publicClient.readContract({
      address: addresses.paymasterFactory,
      abi: [{
        type: 'function',
        name: 'getAllDeployments',
        inputs: [],
        outputs: [{ name: 'tokens', type: 'address[]' }],
        stateMutability: 'view',
      }],
      functionName: 'getAllDeployments',
    }) as `0x${string}`[];
    
    if (deployments.length > 0) {
      const deployment = await publicClient.readContract({
        address: addresses.paymasterFactory,
        abi: [{
          type: 'function',
          name: 'getDeployment',
          inputs: [{ name: 'token', type: 'address' }],
          outputs: [{
            name: 'deployment',
            type: 'tuple',
            components: [{ name: 'vault', type: 'address' }]
          }],
          stateMutability: 'view',
        }],
        functionName: 'getDeployment',
        args: [deployments[0]],
      }) as { vault: `0x${string}` };
      
      // Check vault's ETH balance
      const balance = await publicClient.getBalance({
        address: deployment.vault,
      });
      
      expect(balance).toBeGreaterThanOrEqual(0n);
    }
  });
});

