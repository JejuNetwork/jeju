/**
 * @fileoverview Programmatic NodeStakingManager contract tests
 * @module gateway/tests/contracts/node-staking
 */

import { expect, test, describe } from 'bun:test';
import { getPublicClient, getContractAddresses, TEST_WALLET } from '../fixtures/contracts';

describe('NodeStakingManager Contract', () => {
  const publicClient = getPublicClient();
  
  test('should read network stats', async () => {
    const addresses = await getContractAddresses();
    
    const stats = await publicClient.readContract({
      address: addresses.nodeStakingManager,
      abi: [{
        type: 'function',
        name: 'getNetworkStats',
        inputs: [],
        outputs: [
          { name: 'totalNodesActive', type: 'uint256' },
          { name: 'totalStakedUSD', type: 'uint256' },
          { name: 'totalRewardsClaimedUSD', type: 'uint256' }
        ],
        stateMutability: 'view',
      }],
      functionName: 'getNetworkStats',
    });
    
    expect(stats).toBeDefined();
    expect(Array.isArray(stats)).toBe(true);
    expect(stats.length).toBe(3);
    
    const [totalNodes, totalStaked, totalRewards] = stats as [bigint, bigint, bigint];
    expect(totalNodes).toBeGreaterThanOrEqual(0n);
    expect(totalStaked).toBeGreaterThanOrEqual(0n);
    expect(totalRewards).toBeGreaterThanOrEqual(0n);
  });

  test('should read operator stats', async () => {
    const addresses = await getContractAddresses();
    
    const stats = await publicClient.readContract({
      address: addresses.nodeStakingManager,
      abi: [{
        type: 'function',
        name: 'getOperatorStats',
        inputs: [{ name: 'operator', type: 'address' }],
        outputs: [{
          name: 'stats',
          type: 'tuple',
          components: [
            { name: 'totalNodesActive', type: 'uint256' },
            { name: 'totalStakedUSD', type: 'uint256' },
            { name: 'lifetimeRewardsUSD', type: 'uint256' }
          ]
        }],
        stateMutability: 'view',
      }],
      functionName: 'getOperatorStats',
      args: [TEST_WALLET.address as `0x${string}`],
    });
    
    expect(stats).toBeDefined();
    const operatorStats = stats as {
      totalNodesActive: bigint;
      totalStakedUSD: bigint;
      lifetimeRewardsUSD: bigint;
    };
    
    expect(operatorStats.totalNodesActive).toBeGreaterThanOrEqual(0n);
    expect(operatorStats.totalNodesActive).toBeLessThanOrEqual(5n); // Max 5 nodes per operator
  });

  test('should get operator nodes list', async () => {
    const addresses = await getContractAddresses();
    
    const nodeIds = await publicClient.readContract({
      address: addresses.nodeStakingManager,
      abi: [{
        type: 'function',
        name: 'getOperatorNodes',
        inputs: [{ name: 'operator', type: 'address' }],
        outputs: [{ name: 'nodeIds', type: 'bytes32[]' }],
        stateMutability: 'view',
      }],
      functionName: 'getOperatorNodes',
      args: [TEST_WALLET.address as `0x${string}`],
    });
    
    expect(Array.isArray(nodeIds)).toBe(true);
    
    const nodes = nodeIds as `0x${string}`[];
    expect(nodes.length).toBeLessThanOrEqual(5); // Max 5 per operator
  });

  test('should read node info if nodes exist', async () => {
    const addresses = await getContractAddresses();
    
    const nodeIds = await publicClient.readContract({
      address: addresses.nodeStakingManager,
      abi: [{
        type: 'function',
        name: 'getOperatorNodes',
        inputs: [{ name: 'operator', type: 'address' }],
        outputs: [{ name: 'nodeIds', type: 'bytes32[]' }],
        stateMutability: 'view',
      }],
      functionName: 'getOperatorNodes',
      args: [TEST_WALLET.address as `0x${string}`],
    }) as `0x${string}`[];
    
    if (nodeIds.length > 0) {
      const nodeInfo = await publicClient.readContract({
        address: addresses.nodeStakingManager,
        abi: [{
          type: 'function',
          name: 'getNodeInfo',
          inputs: [{ name: 'nodeId', type: 'bytes32' }],
          outputs: [
            {
              name: 'node',
              type: 'tuple',
              components: [
                { name: 'nodeId', type: 'bytes32' },
                { name: 'operator', type: 'address' },
                { name: 'stakedToken', type: 'address' },
                { name: 'stakedAmount', type: 'uint256' },
                { name: 'rewardToken', type: 'address' },
                { name: 'rpcUrl', type: 'string' },
                { name: 'geographicRegion', type: 'uint8' },
                { name: 'isActive', type: 'bool' },
              ]
            },
            {
              name: 'perf',
              type: 'tuple',
              components: [
                { name: 'uptimeScore', type: 'uint256' },
                { name: 'requestsServed', type: 'uint256' },
                { name: 'avgResponseTime', type: 'uint256' },
              ]
            },
            { name: 'pendingRewardsUSD', type: 'uint256' }
          ],
          stateMutability: 'view',
        }],
        functionName: 'getNodeInfo',
        args: [nodeIds[0]],
      });
      
      expect(nodeInfo).toBeDefined();
      const [node, perf] = nodeInfo as [
        { operator: `0x${string}`; isActive: boolean; rpcUrl: string },
        { uptimeScore: bigint },
        bigint
      ];
      
      expect(node.operator.toLowerCase()).toBe(TEST_WALLET.address.toLowerCase());
      expect(node.rpcUrl).toBeDefined();
      expect(perf.uptimeScore).toBeGreaterThanOrEqual(0n);
      expect(perf.uptimeScore).toBeLessThanOrEqual(10000n); // Max 100.00%
    }
  });

  test('should calculate pending rewards for active nodes', async () => {
    const addresses = await getContractAddresses();
    
    const nodeIds = await publicClient.readContract({
      address: addresses.nodeStakingManager,
      abi: [{
        type: 'function',
        name: 'getOperatorNodes',
        inputs: [{ name: 'operator', type: 'address' }],
        outputs: [{ name: 'nodeIds', type: 'bytes32[]' }],
        stateMutability: 'view',
      }],
      functionName: 'getOperatorNodes',
      args: [TEST_WALLET.address as `0x${string}`],
    }) as `0x${string}`[];
    
    if (nodeIds.length > 0) {
      const pendingRewards = await publicClient.readContract({
        address: addresses.nodeStakingManager,
        abi: [{
          type: 'function',
          name: 'calculatePendingRewards',
          inputs: [{ name: 'nodeId', type: 'bytes32' }],
          outputs: [{ name: 'rewardsUSD', type: 'uint256' }],
          stateMutability: 'view',
        }],
        functionName: 'calculatePendingRewards',
        args: [nodeIds[0]],
      });
      
      expect(pendingRewards).toBeDefined();
      expect(pendingRewards).toBeGreaterThanOrEqual(0n);
    }
  });

  test('should get token distribution stats', async () => {
    const addresses = await getContractAddresses();
    
    // Get elizaOS token address
    const elizaOSAddress = process.env.VITE_ELIZAOS_TOKEN_ADDRESS as `0x${string}`;
    
    if (elizaOSAddress && elizaOSAddress !== '0x0000000000000000000000000000000000000000') {
      const distribution = await publicClient.readContract({
        address: addresses.nodeStakingManager,
        abi: [{
          type: 'function',
          name: 'getTokenDistribution',
          inputs: [{ name: 'token', type: 'address' }],
          outputs: [{
            name: 'distribution',
            type: 'tuple',
            components: [
              { name: 'totalStaked', type: 'uint256' },
              { name: 'totalStakedUSD', type: 'uint256' },
              { name: 'nodeCount', type: 'uint256' },
              { name: 'rewardBudget', type: 'uint256' }
            ]
          }],
          stateMutability: 'view',
        }],
        functionName: 'getTokenDistribution',
        args: [elizaOSAddress],
      });
      
      expect(distribution).toBeDefined();
      const dist = distribution as {
        totalStaked: bigint;
        nodeCount: bigint;
        rewardBudget: bigint;
      };
      
      expect(dist.totalStaked).toBeGreaterThanOrEqual(0n);
      expect(dist.nodeCount).toBeGreaterThanOrEqual(0n);
    }
  });

  test('should get all network nodes', async () => {
    const addresses = await getContractAddresses();
    
    const allNodes = await publicClient.readContract({
      address: addresses.nodeStakingManager,
      abi: [{
        type: 'function',
        name: 'getAllNodes',
        inputs: [],
        outputs: [{ name: 'nodeIds', type: 'bytes32[]' }],
        stateMutability: 'view',
      }],
      functionName: 'getAllNodes',
    });
    
    expect(Array.isArray(allNodes)).toBe(true);
  });
});


