/**
 * Contract ABIs for Jeju Messaging
 */

export const KEY_REGISTRY_ABI = [
  {
    name: 'registerKeyBundle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'identityKey', type: 'bytes32' },
      { name: 'signedPreKey', type: 'bytes32' },
      { name: 'preKeySignature', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'rotateSignedPreKey',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'newSignedPreKey', type: 'bytes32' },
      { name: 'newPreKeySignature', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'uploadOneTimePreKeys',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'keys', type: 'bytes32[]' }],
    outputs: [],
  },
  {
    name: 'consumeOneTimePreKey',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'preKey', type: 'bytes32' },
      { name: 'keyIndex', type: 'uint256' },
    ],
  },
  {
    name: 'revokeKeyBundle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'getKeyBundle',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      {
        name: 'bundle',
        type: 'tuple',
        components: [
          { name: 'identityKey', type: 'bytes32' },
          { name: 'signedPreKey', type: 'bytes32' },
          { name: 'preKeySignature', type: 'bytes32' },
          { name: 'preKeyTimestamp', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastUpdated', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'hasActiveKeyBundle',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: 'hasKey', type: 'bool' }],
  },
  {
    name: 'getAvailablePreKeyCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: 'count', type: 'uint256' }],
  },
  {
    name: 'getKeyBundles',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'users', type: 'address[]' }],
    outputs: [
      {
        name: 'bundles',
        type: 'tuple[]',
        components: [
          { name: 'identityKey', type: 'bytes32' },
          { name: 'signedPreKey', type: 'bytes32' },
          { name: 'preKeySignature', type: 'bytes32' },
          { name: 'preKeyTimestamp', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastUpdated', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
        ],
      },
    ],
  },
  // Events
  {
    name: 'KeyBundleRegistered',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'identityKey', type: 'bytes32', indexed: false },
      { name: 'signedPreKey', type: 'bytes32', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'SignedPreKeyRotated',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'oldKey', type: 'bytes32', indexed: false },
      { name: 'newKey', type: 'bytes32', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const MESSAGE_NODE_REGISTRY_ABI = [
  {
    name: 'registerNode',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'endpoint', type: 'string' },
      { name: 'region', type: 'string' },
      { name: 'stakeAmount', type: 'uint256' },
    ],
    outputs: [{ name: 'nodeId', type: 'bytes32' }],
  },
  {
    name: 'deregisterNode',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'updateEndpoint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'newEndpoint', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'heartbeat',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'recordMessageRelay',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'messageCount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'claimFees',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getNode',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'nodeId', type: 'bytes32' },
          { name: 'operator', type: 'address' },
          { name: 'endpoint', type: 'string' },
          { name: 'region', type: 'string' },
          { name: 'stakedAmount', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastHeartbeat', type: 'uint256' },
          { name: 'messagesRelayed', type: 'uint256' },
          { name: 'feesEarned', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'isSlashed', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'getActiveNodes',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  {
    name: 'getNodesByRegion',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'region', type: 'string' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  {
    name: 'getOperatorNodes',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  {
    name: 'isNodeHealthy',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [{ name: 'healthy', type: 'bool' }],
  },
  {
    name: 'getRandomHealthyNode',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'region', type: 'string' }],
    outputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'endpoint', type: 'string' },
    ],
  },
  {
    name: 'getPerformance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'uptimeScore', type: 'uint256' },
          { name: 'deliveryRate', type: 'uint256' },
          { name: 'avgLatencyMs', type: 'uint256' },
          { name: 'lastUpdated', type: 'uint256' },
        ],
      },
    ],
  },
  // Events
  {
    name: 'NodeRegistered',
    type: 'event',
    inputs: [
      { name: 'nodeId', type: 'bytes32', indexed: true },
      { name: 'operator', type: 'address', indexed: true },
      { name: 'endpoint', type: 'string', indexed: false },
      { name: 'region', type: 'string', indexed: false },
      { name: 'stakedAmount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'NodeDeregistered',
    type: 'event',
    inputs: [
      { name: 'nodeId', type: 'bytes32', indexed: true },
      { name: 'operator', type: 'address', indexed: true },
    ],
  },
  {
    name: 'NodeHeartbeat',
    type: 'event',
    inputs: [
      { name: 'nodeId', type: 'bytes32', indexed: true },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'FeesAccrued',
    type: 'event',
    inputs: [
      { name: 'nodeId', type: 'bytes32', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'FeesClaimed',
    type: 'event',
    inputs: [
      { name: 'nodeId', type: 'bytes32', indexed: true },
      { name: 'operator', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;

// ERC20 ABI for staking token
export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

