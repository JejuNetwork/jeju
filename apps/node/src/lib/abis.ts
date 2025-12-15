/**
 * Contract ABIs for network Node services
 */

// Minimal ABIs with only the functions we need

export const IDENTITY_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'register',
    inputs: [{ name: 'tokenURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getAgent',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'tokenURI', type: 'string' },
      { name: 'registeredAt', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'agentOf',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

export const NODE_STAKING_MANAGER_ABI = [
  {
    type: 'function',
    name: 'registerNode',
    inputs: [
      { name: 'stakeToken', type: 'address' },
      { name: 'rewardToken', type: 'address' },
      { name: 'rpcUrl', type: 'string' },
      { name: 'region', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'getNodeInfo',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [
      { name: 'stakeToken', type: 'address' },
      { name: 'stakeAmount', type: 'uint256' },
      { name: 'rewardToken', type: 'address' },
      { name: 'rpcUrl', type: 'string' },
      { name: 'region', type: 'string' },
      { name: 'registeredAt', type: 'uint256' },
      { name: 'uptime', type: 'uint256' },
      { name: 'requestsServed', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'claimRewards',
    inputs: [],
    outputs: [{ name: 'amount', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'pendingRewards',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ name: 'amount', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

export const COMPUTE_STAKING_ABI = [
  {
    type: 'function',
    name: 'stakeAsProvider',
    inputs: [],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'getStake',
    inputs: [{ name: 'staker', type: 'address' }],
    outputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'stakeType', type: 'uint8' },
      { name: 'stakedAt', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'unstake',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export const INFERENCE_SERVING_ABI = [
  {
    type: 'function',
    name: 'registerService',
    inputs: [
      { name: 'modelId', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'pricePerInputToken', type: 'uint256' },
      { name: 'pricePerOutputToken', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getService',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      { name: 'modelId', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'pricePerInputToken', type: 'uint256' },
      { name: 'pricePerOutputToken', type: 'uint256' },
      { name: 'isActive', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pendingBalance',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export const TRIGGER_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getActiveTriggers',
    inputs: [],
    outputs: [
      {
        name: 'triggers',
        type: 'tuple[]',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'owner', type: 'address' },
          { name: 'triggerType', type: 'uint8' },
          { name: 'endpoint', type: 'string' },
          { name: 'schedule', type: 'string' },
          { name: 'pricePerExecution', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'recordExecution',
    inputs: [
      { name: 'triggerId', type: 'uint256' },
      { name: 'success', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export const ORACLE_STAKING_MANAGER_ABI = [
  {
    type: 'function',
    name: 'registerOracle',
    inputs: [
      { name: 'agentId', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'submitPrice',
    inputs: [
      { name: 'market', type: 'bytes32' },
      { name: 'price', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getOracleInfo',
    inputs: [{ name: 'oracle', type: 'address' }],
    outputs: [
      { name: 'stake', type: 'uint256' },
      { name: 'reputation', type: 'uint256' },
      { name: 'accuracy', type: 'uint256' },
      { name: 'submissionsCount', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const;

export const STORAGE_MARKET_ABI = [
  {
    type: 'function',
    name: 'registerProvider',
    inputs: [
      { name: 'endpoint', type: 'string' },
      { name: 'capacity', type: 'uint256' },
      { name: 'pricePerGBMonth', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'getProvider',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      { name: 'endpoint', type: 'string' },
      { name: 'capacity', type: 'uint256' },
      { name: 'used', type: 'uint256' },
      { name: 'pricePerGBMonth', type: 'uint256' },
      { name: 'isActive', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const;

export const SEQUENCER_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'register',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'stake', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getSequencer',
    inputs: [{ name: 'sequencer', type: 'address' }],
    outputs: [
      { name: 'stake', type: 'uint256' },
      { name: 'agentId', type: 'uint256' },
      { name: 'blocksProposed', type: 'uint256' },
      { name: 'reputationScore', type: 'uint256' },
      { name: 'isActive', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'recordBlockProposed',
    inputs: [{ name: 'blockHash', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export const BAN_MANAGER_ABI = [
  {
    type: 'function',
    name: 'isBanned',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'banned', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBanInfo',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'isBanned', type: 'bool' },
      { name: 'reason', type: 'string' },
      { name: 'bannedAt', type: 'uint256' },
      { name: 'appealDeadline', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'appeal',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export const CDN_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'registerEdgeNode',
    inputs: [
      { name: 'endpoint', type: 'string' },
      { name: 'region', type: 'uint8' },
      { name: 'providerType', type: 'uint8' },
    ],
    outputs: [{ name: 'nodeId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'getEdgeNode',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'operator', type: 'address' },
      { name: 'endpoint', type: 'string' },
      { name: 'region', type: 'uint8' },
      { name: 'providerType', type: 'uint8' },
      { name: 'status', type: 'uint8' },
      { name: 'stake', type: 'uint256' },
      { name: 'registeredAt', type: 'uint256' },
      { name: 'lastSeen', type: 'uint256' },
      { name: 'agentId', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getNodeMetrics',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      { name: 'currentLoad', type: 'uint256' },
      { name: 'bandwidthUsage', type: 'uint256' },
      { name: 'activeConnections', type: 'uint256' },
      { name: 'requestsPerSecond', type: 'uint256' },
      { name: 'bytesServedTotal', type: 'uint256' },
      { name: 'requestsTotal', type: 'uint256' },
      { name: 'cacheSize', type: 'uint256' },
      { name: 'cacheEntries', type: 'uint256' },
      { name: 'cacheHitRate', type: 'uint256' },
      { name: 'avgResponseTime', type: 'uint256' },
      { name: 'lastUpdated', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getOperatorNodes',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ name: 'nodeIds', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'updateNodeStatus',
    inputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'status', type: 'uint8' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'addNodeStake',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'reportNodeMetrics',
    inputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'currentLoad', type: 'uint256' },
      { name: 'bandwidthUsage', type: 'uint256' },
      { name: 'activeConnections', type: 'uint256' },
      { name: 'requestsPerSecond', type: 'uint256' },
      { name: 'bytesServedTotal', type: 'uint256' },
      { name: 'requestsTotal', type: 'uint256' },
      { name: 'cacheHitRate', type: 'uint256' },
      { name: 'avgResponseTime', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

