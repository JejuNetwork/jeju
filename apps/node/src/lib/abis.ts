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

export const CONTENT_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'registerContent',
    inputs: [
      { name: 'contentHash', type: 'bytes32' },
      { name: 'infohash', type: 'bytes32' },
      { name: 'size', type: 'uint64' },
      { name: 'tier', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'flagContent',
    inputs: [
      { name: 'contentHash', type: 'bytes32' },
      { name: 'violationType', type: 'uint8' },
      { name: 'evidenceHash', type: 'bytes32' },
    ],
    outputs: [{ name: 'caseId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'canServe',
    inputs: [{ name: 'contentHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isBlocked',
    inputs: [{ name: 'contentHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getContent',
    inputs: [{ name: 'contentHash', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'contentHash', type: 'bytes32' },
          { name: 'status', type: 'uint8' },
          { name: 'violationType', type: 'uint8' },
          { name: 'tier', type: 'uint8' },
          { name: 'uploader', type: 'address' },
          { name: 'uploadedAt', type: 'uint64' },
          { name: 'size', type: 'uint64' },
          { name: 'seedCount', type: 'uint64' },
          { name: 'rewardPool', type: 'uint128' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'startSeeding',
    inputs: [{ name: 'infohash', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'stopSeeding',
    inputs: [{ name: 'infohash', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'reportSeeding',
    inputs: [
      { name: 'infohash', type: 'bytes32' },
      { name: 'bytesServed', type: 'uint128' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claimRewards',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getSeederStats',
    inputs: [{ name: 'seeder', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'totalBytesServed', type: 'uint128' },
          { name: 'pendingRewards', type: 'uint128' },
          { name: 'activeTorrents', type: 'uint64' },
          { name: 'lastReportTime', type: 'uint64' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRewardRate',
    inputs: [{ name: 'tier', type: 'uint8' }],
    outputs: [{ name: '', type: 'uint128' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBlocklistLength',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBlocklistBatch',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'topUpRewardPool',
    inputs: [{ name: 'contentHash', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'isSeeding',
    inputs: [
      { name: 'infohash', type: 'bytes32' },
      { name: 'seeder', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
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

export const PROXY_REGISTRY_ABI = [
  // Registration
  {
    type: 'function',
    name: 'register',
    inputs: [
      { name: 'regionCode', type: 'bytes32' },
      { name: 'endpoint', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'updateNode',
    inputs: [
      { name: 'regionCode', type: 'bytes32' },
      { name: 'endpoint', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'deactivate',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'reactivate',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // Staking
  {
    type: 'function',
    name: 'addStake',
    inputs: [],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'withdrawStake',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // View functions
  {
    type: 'function',
    name: 'getNode',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'regionCode', type: 'bytes32' },
          { name: 'endpoint', type: 'string' },
          { name: 'stake', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'totalBytesServed', type: 'uint256' },
          { name: 'totalSessions', type: 'uint256' },
          { name: 'successfulSessions', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isActive',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getActiveNodes',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getNodesByRegion',
    inputs: [{ name: 'regionCode', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getNodeStake',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getNodeCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'minNodeStake',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  // Session recording (coordinator only)
  {
    type: 'function',
    name: 'recordSession',
    inputs: [
      { name: 'node', type: 'address' },
      { name: 'bytesServed', type: 'uint256' },
      { name: 'successful', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // Events
  {
    type: 'event',
    name: 'NodeRegistered',
    inputs: [
      { name: 'node', type: 'address', indexed: true },
      { name: 'regionCode', type: 'bytes32', indexed: true },
      { name: 'stake', type: 'uint256', indexed: false },
      { name: 'endpoint', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SessionRecorded',
    inputs: [
      { name: 'node', type: 'address', indexed: true },
      { name: 'bytesServed', type: 'uint256', indexed: false },
      { name: 'successful', type: 'bool', indexed: false },
    ],
  },
] as const;

export const VPN_REGISTRY_ABI = [
  // Registration
  {
    type: 'function',
    name: 'register',
    inputs: [
      { name: 'countryCode', type: 'bytes2' },
      { name: 'regionHash', type: 'bytes32' },
      { name: 'endpoint', type: 'string' },
      { name: 'wireguardPubKey', type: 'string' },
      {
        name: 'capabilities',
        type: 'tuple',
        components: [
          { name: 'supportsWireGuard', type: 'bool' },
          { name: 'supportsSOCKS5', type: 'bool' },
          { name: 'supportsHTTPConnect', type: 'bool' },
          { name: 'servesCDN', type: 'bool' },
          { name: 'isVPNExit', type: 'bool' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  // Get node info
  {
    type: 'function',
    name: 'getNode',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'operator', type: 'address' },
          { name: 'countryCode', type: 'bytes2' },
          { name: 'regionHash', type: 'bytes32' },
          { name: 'endpoint', type: 'string' },
          { name: 'wireguardPubKey', type: 'string' },
          { name: 'stake', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastSeen', type: 'uint256' },
          {
            name: 'capabilities',
            type: 'tuple',
            components: [
              { name: 'supportsWireGuard', type: 'bool' },
              { name: 'supportsSOCKS5', type: 'bool' },
              { name: 'supportsHTTPConnect', type: 'bool' },
              { name: 'servesCDN', type: 'bool' },
              { name: 'isVPNExit', type: 'bool' },
            ],
          },
          { name: 'active', type: 'bool' },
          { name: 'totalBytesServed', type: 'uint256' },
          { name: 'totalSessions', type: 'uint256' },
          { name: 'successfulSessions', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  // Heartbeat
  {
    type: 'function',
    name: 'heartbeat',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // Record session
  {
    type: 'function',
    name: 'recordSession',
    inputs: [
      { name: 'nodeAddr', type: 'address' },
      { name: 'client', type: 'address' },
      { name: 'bytesServed', type: 'uint256' },
      { name: 'successful', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // View functions
  {
    type: 'function',
    name: 'isActive',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allowedCountries',
    inputs: [{ name: 'countryCode', type: 'bytes2' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'blockedCountries',
    inputs: [{ name: 'countryCode', type: 'bytes2' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  // Events
  {
    type: 'event',
    name: 'NodeRegistered',
    inputs: [
      { name: 'operator', type: 'address', indexed: true },
      { name: 'countryCode', type: 'bytes2', indexed: true },
      { name: 'stake', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'VPNSessionRecorded',
    inputs: [
      { name: 'node', type: 'address', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'bytesServed', type: 'uint256', indexed: false },
      { name: 'successful', type: 'bool', indexed: false },
    ],
  },
] as const;

