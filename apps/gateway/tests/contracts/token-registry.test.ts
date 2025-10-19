/**
 * @fileoverview Programmatic TokenRegistry contract tests
 * @module gateway/tests/contracts/token-registry
 */

import { expect, test, describe } from 'bun:test';
import { getPublicClient, getWalletClient, getContractAddresses } from '../fixtures/contracts';
import { parseEther, encodeFunctionData } from 'viem';

describe('TokenRegistry Contract', () => {
  const publicClient = getPublicClient();
  const walletClient = getWalletClient();
  
  test('should read registration fee', async () => {
    const addresses = await getContractAddresses();
    
    const fee = await publicClient.readContract({
      address: addresses.tokenRegistry,
      abi: [{
        type: 'function',
        name: 'registrationFee',
        inputs: [],
        outputs: [{ type: 'uint256' }],
        stateMutability: 'view',
      }],
      functionName: 'registrationFee',
    });
    
    expect(fee).toBeDefined();
    expect(fee).toBeGreaterThan(0n);
  });

  test('should get all registered tokens', async () => {
    const addresses = await getContractAddresses();
    
    const tokens = await publicClient.readContract({
      address: addresses.tokenRegistry,
      abi: [{
        type: 'function',
        name: 'getAllTokens',
        inputs: [],
        outputs: [{ name: 'addresses', type: 'address[]' }],
        stateMutability: 'view',
      }],
      functionName: 'getAllTokens',
    });
    
    expect(Array.isArray(tokens)).toBe(true);
  });

  test('should read token config for registered token', async () => {
    const addresses = await getContractAddresses();
    
    // Get first registered token
    const tokens = await publicClient.readContract({
      address: addresses.tokenRegistry,
      abi: [{
        type: 'function',
        name: 'getAllTokens',
        inputs: [],
        outputs: [{ name: 'addresses', type: 'address[]' }],
        stateMutability: 'view',
      }],
      functionName: 'getAllTokens',
    }) as `0x${string}`[];
    
    if (tokens.length > 0) {
      const config = await publicClient.readContract({
        address: addresses.tokenRegistry,
        abi: [{
          type: 'function',
          name: 'getTokenConfig',
          inputs: [{ name: 'tokenAddress', type: 'address' }],
          outputs: [{
            name: 'config',
            type: 'tuple',
            components: [
              { name: 'tokenAddress', type: 'address' },
              { name: 'name', type: 'string' },
              { name: 'symbol', type: 'string' },
              { name: 'decimals', type: 'uint8' },
              { name: 'oracleAddress', type: 'address' },
              { name: 'minFeeMargin', type: 'uint256' },
              { name: 'maxFeeMargin', type: 'uint256' },
              { name: 'isActive', type: 'bool' },
              { name: 'registrant', type: 'address' },
              { name: 'registrationTime', type: 'uint256' },
              { name: 'totalVolume', type: 'uint256' },
              { name: 'totalTransactions', type: 'uint256' },
              { name: 'metadataHash', type: 'bytes32' }
            ]
          }],
          stateMutability: 'view',
        }],
        functionName: 'getTokenConfig',
        args: [tokens[0]],
      });
      
      expect(config).toBeDefined();
      const tokenConfig = config as {
        symbol: string;
        name: string;
        decimals: number;
        isActive: boolean;
      };
      expect(tokenConfig.symbol).toBeDefined();
      expect(tokenConfig.name).toBeDefined();
      expect(tokenConfig.decimals).toBeGreaterThan(0);
    }
  });

  test('should validate fee margin bounds', async () => {
    const addresses = await getContractAddresses();
    
    // Get registered token config to check fee margins
    const tokens = await publicClient.readContract({
      address: addresses.tokenRegistry,
      abi: [{
        type: 'function',
        name: 'getAllTokens',
        inputs: [],
        outputs: [{ name: 'addresses', type: 'address[]' }],
        stateMutability: 'view',
      }],
      functionName: 'getAllTokens',
    }) as `0x${string}`[];
    
    if (tokens.length > 0) {
      const config = await publicClient.readContract({
        address: addresses.tokenRegistry,
        abi: [{
          type: 'function',
          name: 'getTokenConfig',
          inputs: [{ name: 'tokenAddress', type: 'address' }],
          outputs: [{
            name: 'config',
            type: 'tuple',
            components: [
              { name: 'minFeeMargin', type: 'uint256' },
              { name: 'maxFeeMargin', type: 'uint256' },
            ]
          }],
          stateMutability: 'view',
        }],
        functionName: 'getTokenConfig',
        args: [tokens[0]],
      }) as { minFeeMargin: bigint; maxFeeMargin: bigint };
      
      // Min should be <= Max
      expect(config.minFeeMargin).toBeLessThanOrEqual(config.maxFeeMargin);
      
      // Max should not exceed 500 basis points (5%)
      expect(config.maxFeeMargin).toBeLessThanOrEqual(500n);
    }
  });
});

