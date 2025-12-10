import { Address } from 'viem';

export const NODE_STAKING_MANAGER_ABI = [
  {
    type: 'function',
    name: 'Region',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'registerNode',
    inputs: [
      { name: 'stakingToken', type: 'address' },
      { name: 'stakeAmount', type: 'uint256' },
      { name: 'rewardToken', type: 'address' },
      { name: 'rpcUrl', type: 'string' },
      { name: 'region', type: 'uint8' }
    ],
    outputs: [{ name: 'nodeId', type: 'bytes32' }],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'claimRewards',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'deregisterNode',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'updatePerformance',
    inputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'uptimeScore', type: 'uint256' },
      { name: 'requestsServed', type: 'uint256' },
      { name: 'avgResponseTime', type: 'uint256' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
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
          { name: 'stakedValueUSD', type: 'uint256' },
          { name: 'rewardToken', type: 'address' },
          { name: 'rpcUrl', type: 'string' },
          { name: 'geographicRegion', type: 'uint8' },
          { name: 'registrationTime', type: 'uint256' },
          { name: 'lastClaimTime', type: 'uint256' },
          { name: 'totalRewardsClaimed', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'isSlashed', type: 'bool' }
        ]
      },
      {
        name: 'perf',
        type: 'tuple',
        components: [
          { name: 'uptimeScore', type: 'uint256' },
          { name: 'requestsServed', type: 'uint256' },
          { name: 'avgResponseTime', type: 'uint256' },
          { name: 'lastUpdateTime', type: 'uint256' }
        ]
      },
      { name: 'pendingRewardsUSD', type: 'uint256' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getOperatorNodes',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ name: 'nodeIds', type: 'bytes32[]' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'calculatePendingRewards',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [{ name: 'rewardsUSD', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getNetworkStats',
    inputs: [],
    outputs: [
      { name: 'totalNodesActive', type: 'uint256' },
      { name: 'totalStakedUSD', type: 'uint256' },
      { name: 'totalRewardsClaimedUSD', type: 'uint256' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getOperatorStats',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [
      {
        name: 'stats',
        type: 'tuple',
        components: [
          { name: 'totalNodesActive', type: 'uint256' },
          { name: 'totalStakedUSD', type: 'uint256' },
          { name: 'lifetimeRewardsUSD', type: 'uint256' }
        ]
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getTokenDistribution',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      {
        name: 'distribution',
        type: 'tuple',
        components: [
          { name: 'totalStaked', type: 'uint256' },
          { name: 'totalStakedUSD', type: 'uint256' },
          { name: 'nodeCount', type: 'uint256' },
          { name: 'rewardBudget', type: 'uint256' }
        ]
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getAllNodes',
    inputs: [],
    outputs: [{ name: 'nodeIds', type: 'bytes32[]' }],
    stateMutability: 'view'
  },
  {
    type: 'event',
    name: 'NodeRegistered',
    inputs: [
      { name: 'nodeId', type: 'bytes32', indexed: true },
      { name: 'operator', type: 'address', indexed: true },
      { name: 'stakedToken', type: 'address', indexed: true },
      { name: 'rewardToken', type: 'address', indexed: false },
      { name: 'stakedAmount', type: 'uint256', indexed: false },
      { name: 'stakedValueUSD', type: 'uint256', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'RewardsClaimed',
    inputs: [
      { name: 'nodeId', type: 'bytes32', indexed: true },
      { name: 'operator', type: 'address', indexed: true },
      { name: 'rewardToken', type: 'address', indexed: true },
      { name: 'rewardAmount', type: 'uint256', indexed: false },
      { name: 'paymasterFeesETH', type: 'uint256', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'NodeDeregistered',
    inputs: [
      { name: 'nodeId', type: 'bytes32', indexed: true },
      { name: 'operator', type: 'address', indexed: true }
    ]
  },
  {
    type: 'event',
    name: 'PaymasterFeeDistributed',
    inputs: [
      { name: 'paymaster', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'reason', type: 'string', indexed: false }
    ]
  }
] as const;

export interface NodeStake {
  nodeId: string;
  operator: Address;
  stakedToken: Address;
  stakedAmount: bigint;
  stakedValueUSD: bigint;
  rewardToken: Address;
  rpcUrl: string;
  geographicRegion: number;
  registrationTime: bigint;
  lastClaimTime: bigint;
  totalRewardsClaimed: bigint;
  isActive: boolean;
  isSlashed: boolean;
}

export interface PerformanceMetrics {
  uptimeScore: bigint;
  requestsServed: bigint;
  avgResponseTime: bigint;
  lastUpdateTime: bigint;
}

export interface OperatorStats {
  totalNodesActive: bigint;
  totalStakedUSD: bigint;
  lifetimeRewardsUSD: bigint;
}

export interface TokenDistribution {
  totalStaked: bigint;
  totalStakedUSD: bigint;
  nodeCount: bigint;
  rewardBudget: bigint;
}

export enum Region {
  NorthAmerica = 0,
  SouthAmerica = 1,
  Europe = 2,
  Asia = 3,
  Africa = 4,
  Oceania = 5
}

export const REGION_NAMES = {
  [Region.NorthAmerica]: 'North America',
  [Region.SouthAmerica]: 'South America',
  [Region.Europe]: 'Europe',
  [Region.Asia]: 'Asia',
  [Region.Africa]: 'Africa',
  [Region.Oceania]: 'Oceania'
};

import { CONTRACTS } from '../config';

export function getNodeStakingAddress(): Address {
  return CONTRACTS.nodeStakingManager;
}

export function formatUptimeScore(score: bigint): string {
  return (Number(score) / 100).toFixed(2) + '%';
}

export function calculateMonthlyRewardEstimate(
  baseRewardUSD: bigint,
  uptimeScore: bigint,
  _region: Region,
  isUnderserved: boolean
): bigint {
  // Simplified calculation for UI preview
  let reward = baseRewardUSD;
  
  // Uptime multiplier
  const uptimeNum = Number(uptimeScore);
  if (uptimeNum >= 9900) {
    reward = (reward * 15n) / 10n; // 1.5x for good uptime
  }
  
  // Geographic bonus
  if (isUnderserved) {
    reward = (reward * 15n) / 10n; // +50%
  }
  
  return reward;
}

