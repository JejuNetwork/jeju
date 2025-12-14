export const NETWORK_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'registerNetwork',
    inputs: [
      { name: 'chainId', type: 'uint256' },
      { name: 'name', type: 'string' },
      { name: 'rpcUrl', type: 'string' },
      { name: 'explorerUrl', type: 'string' },
      { name: 'wsUrl', type: 'string' },
      {
        name: 'contracts',
        type: 'tuple',
        components: [
          { name: 'identityRegistry', type: 'address' },
          { name: 'solverRegistry', type: 'address' },
          { name: 'inputSettler', type: 'address' },
          { name: 'outputSettler', type: 'address' },
          { name: 'liquidityVault', type: 'address' },
          { name: 'governance', type: 'address' },
          { name: 'oracle', type: 'address' },
        ],
      },
      { name: 'genesisHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'updateNetwork',
    inputs: [
      { name: 'chainId', type: 'uint256' },
      { name: 'name', type: 'string' },
      { name: 'rpcUrl', type: 'string' },
      { name: 'explorerUrl', type: 'string' },
      { name: 'wsUrl', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'updateContracts',
    inputs: [
      { name: 'chainId', type: 'uint256' },
      {
        name: 'contracts',
        type: 'tuple',
        components: [
          { name: 'identityRegistry', type: 'address' },
          { name: 'solverRegistry', type: 'address' },
          { name: 'inputSettler', type: 'address' },
          { name: 'outputSettler', type: 'address' },
          { name: 'liquidityVault', type: 'address' },
          { name: 'governance', type: 'address' },
          { name: 'oracle', type: 'address' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'establishTrust',
    inputs: [
      { name: 'sourceChainId', type: 'uint256' },
      { name: 'targetChainId', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'revokeTrust',
    inputs: [
      { name: 'sourceChainId', type: 'uint256' },
      { name: 'targetChainId', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getNetwork',
    inputs: [{ name: 'chainId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'chainId', type: 'uint256' },
          { name: 'name', type: 'string' },
          { name: 'rpcUrl', type: 'string' },
          { name: 'explorerUrl', type: 'string' },
          { name: 'wsUrl', type: 'string' },
          { name: 'operator', type: 'address' },
          {
            name: 'contracts',
            type: 'tuple',
            components: [
              { name: 'identityRegistry', type: 'address' },
              { name: 'solverRegistry', type: 'address' },
              { name: 'inputSettler', type: 'address' },
              { name: 'outputSettler', type: 'address' },
              { name: 'liquidityVault', type: 'address' },
              { name: 'governance', type: 'address' },
              { name: 'oracle', type: 'address' },
            ],
          },
          { name: 'genesisHash', type: 'bytes32' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'stake', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'isVerified', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getActiveNetworks',
    inputs: [],
    outputs: [{ name: '', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getVerifiedNetworks',
    inputs: [],
    outputs: [{ name: '', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTrustedPeers',
    inputs: [{ name: 'chainId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isTrusted',
    inputs: [
      { name: 'sourceChainId', type: 'uint256' },
      { name: 'targetChainId', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isMutuallyTrusted',
    inputs: [
      { name: 'chainA', type: 'uint256' },
      { name: 'chainB', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

export const FEDERATED_IDENTITY_ABI = [
  {
    type: 'function',
    name: 'federateLocalAgent',
    inputs: [
      { name: 'localAgentId', type: 'uint256' },
      { name: 'ownershipProof', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registerRemoteAgent',
    inputs: [
      { name: 'originChainId', type: 'uint256' },
      { name: 'originAgentId', type: 'uint256' },
      { name: 'originOwner', type: 'address' },
      { name: 'originRegistryHash', type: 'bytes32' },
      { name: 'oracleAttestation', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'verifyIdentity',
    inputs: [
      { name: 'originChainId', type: 'uint256' },
      { name: 'originAgentId', type: 'uint256' },
    ],
    outputs: [
      { name: 'isValid', type: 'bool' },
      { name: 'federatedId', type: 'bytes32' },
      { name: 'reputation', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAttestations',
    inputs: [{ name: 'federatedId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'targetChainId', type: 'uint256' },
          { name: 'attestedAt', type: 'uint256' },
          { name: 'attester', type: 'address' },
          { name: 'attestationHash', type: 'bytes32' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getFederatedAgent',
    inputs: [{ name: 'federatedId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'originChainId', type: 'uint256' },
          { name: 'originAgentId', type: 'uint256' },
          { name: 'originOwner', type: 'address' },
          { name: 'originRegistryHash', type: 'bytes32' },
          { name: 'federatedAt', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'reputationScore', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;

export const FEDERATED_SOLVER_ABI = [
  {
    type: 'function',
    name: 'federateLocalSolver',
    inputs: [{ name: 'supportedChains', type: 'uint256[]' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getSolversForRoute',
    inputs: [
      { name: 'sourceChainId', type: 'uint256' },
      { name: 'destChainId', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBestSolverForRoute',
    inputs: [
      { name: 'sourceChainId', type: 'uint256' },
      { name: 'destChainId', type: 'uint256' },
    ],
    outputs: [
      { name: 'bestSolverId', type: 'bytes32' },
      { name: 'stake', type: 'uint256' },
      { name: 'successRate', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getSolver',
    inputs: [{ name: 'federatedId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'solverAddress', type: 'address' },
          { name: 'homeChainId', type: 'uint256' },
          { name: 'supportedChains', type: 'uint256[]' },
          { name: 'totalStake', type: 'uint256' },
          { name: 'totalFills', type: 'uint256' },
          { name: 'successfulFills', type: 'uint256' },
          { name: 'federatedAt', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getActiveSolvers',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
] as const;

export const FEDERATED_LIQUIDITY_ABI = [
  {
    type: 'function',
    name: 'registerXLP',
    inputs: [{ name: 'supportedChains', type: 'uint256[]' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createRequest',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'targetChainId', type: 'uint256' },
    ],
    outputs: [{ name: 'requestId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'fulfillRequest',
    inputs: [
      { name: 'requestId', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getTotalFederatedLiquidity',
    inputs: [],
    outputs: [
      { name: 'totalEth', type: 'uint256' },
      { name: 'totalToken', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBestNetworkForLiquidity',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [
      { name: 'bestChainId', type: 'uint256' },
      { name: 'available', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getXLPsForRoute',
    inputs: [
      { name: 'sourceChain', type: 'uint256' },
      { name: 'destChain', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getXLP',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'provider', type: 'address' },
          { name: 'supportedChains', type: 'uint256[]' },
          { name: 'totalProvided', type: 'uint256' },
          { name: 'totalEarned', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getActiveXLPs',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
] as const;

