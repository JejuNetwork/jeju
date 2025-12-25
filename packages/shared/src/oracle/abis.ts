/**
 * Oracle Contract ABIs
 * Shared ABIs for oracle node implementations
 */

export const FEED_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getFeed',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'feedId', type: 'bytes32' },
          { name: 'symbol', type: 'string' },
          { name: 'baseToken', type: 'address' },
          { name: 'quoteToken', type: 'address' },
          { name: 'decimals', type: 'uint8' },
          { name: 'heartbeatSeconds', type: 'uint32' },
          { name: 'twapWindowSeconds', type: 'uint32' },
          { name: 'minLiquidityUSD', type: 'uint256' },
          { name: 'maxDeviationBps', type: 'uint16' },
          { name: 'minOracles', type: 'uint8' },
          { name: 'quorumThreshold', type: 'uint8' },
          { name: 'isActive', type: 'bool' },
          { name: 'requiresConfidence', type: 'bool' },
          { name: 'category', type: 'uint8' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAllFeeds',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getActiveFeeds',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'feedExists',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isFeedActive',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const

export const REPORT_VERIFIER_ABI = [
  {
    type: 'function',
    name: 'submitReport',
    inputs: [
      {
        name: 'submission',
        type: 'tuple',
        components: [
          {
            name: 'report',
            type: 'tuple',
            components: [
              { name: 'feedId', type: 'bytes32' },
              { name: 'price', type: 'uint256' },
              { name: 'confidence', type: 'uint256' },
              { name: 'timestamp', type: 'uint256' },
              { name: 'round', type: 'uint256' },
              { name: 'sourcesHash', type: 'bytes32' },
            ],
          },
          { name: 'signatures', type: 'bytes[]' },
        ],
      },
    ],
    outputs: [{ name: 'accepted', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getLatestPrice',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [
      { name: 'price', type: 'uint256' },
      { name: 'confidence', type: 'uint256' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'isValid', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCurrentRound',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isReportProcessed',
    inputs: [{ name: 'reportHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'ReportSubmitted',
    inputs: [
      { name: 'feedId', type: 'bytes32', indexed: true },
      { name: 'reportHash', type: 'bytes32', indexed: false },
      { name: 'price', type: 'uint256', indexed: false },
      { name: 'confidence', type: 'uint256', indexed: false },
      { name: 'round', type: 'uint256', indexed: false },
      { name: 'signatureCount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ReportRejected',
    inputs: [
      { name: 'feedId', type: 'bytes32', indexed: true },
      { name: 'reportHash', type: 'bytes32', indexed: false },
      { name: 'reason', type: 'string', indexed: false },
    ],
  },
] as const

export const COMMITTEE_MANAGER_ABI = [
  {
    type: 'function',
    name: 'getCommittee',
    inputs: [{ name: 'feedId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'feedId', type: 'bytes32' },
          { name: 'round', type: 'uint256' },
          { name: 'members', type: 'address[]' },
          { name: 'threshold', type: 'uint8' },
          { name: 'activeUntil', type: 'uint256' },
          { name: 'leader', type: 'address' },
          { name: 'isActive', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isCommitteeMember',
    inputs: [
      { name: 'feedId', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getOperatorFeeds',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
] as const

export const NETWORK_CONNECTOR_ABI = [
  {
    type: 'function',
    name: 'registerOperator',
    inputs: [
      { name: 'stakingOracleId', type: 'bytes32' },
      { name: 'agentId', type: 'uint256' },
      { name: 'workerKey', type: 'address' },
    ],
    outputs: [{ name: 'operatorId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'recordHeartbeat',
    inputs: [{ name: 'operatorId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getOperator',
    inputs: [{ name: 'operatorId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'operatorId', type: 'bytes32' },
          { name: 'stakingOracleId', type: 'bytes32' },
          { name: 'agentId', type: 'uint256' },
          { name: 'workerKey', type: 'address' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getOperatorByWorker',
    inputs: [{ name: 'workerKey', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'operatorId', type: 'bytes32' },
          { name: 'stakingOracleId', type: 'bytes32' },
          { name: 'agentId', type: 'uint256' },
          { name: 'workerKey', type: 'address' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'workerToOperator',
    inputs: [{ name: 'worker', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'currentEpoch',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export const UNISWAP_V3_POOL_ABI = [
  {
    type: 'function',
    name: 'slot0',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token0',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token1',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'liquidity',
    inputs: [],
    outputs: [{ name: '', type: 'uint128' }],
    stateMutability: 'view',
  },
] as const

export const CHAINLINK_AGGREGATOR_ABI = [
  {
    type: 'function',
    name: 'latestRoundData',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const
