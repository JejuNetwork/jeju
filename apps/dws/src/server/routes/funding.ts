/**
 * DWS Funding Routes
 *
 * Provides decentralized funding API endpoints:
 * - DAO pool management
 * - Contributor registry
 * - Payment requests
 * - Dependency funding
 * - Epoch management
 *
 * All data is read from on-chain contracts, no centralized database.
 */

import { Hono } from 'hono'
import type { Address, Hex } from 'viem'
import { createPublicClient, http, parseAbi } from 'viem'

// ============ Contract ABIs ============

// Simple ABI for DAO Registry - returns raw data, parsed in handler
const DAO_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getDAO',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [
      { name: '', type: 'bytes32' },
      { name: '', type: 'address' },
      { name: '', type: 'string' },
      { name: '', type: 'uint8' },
      { name: '', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDAOsByAdmin',
    inputs: [{ name: 'admin', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAllDAOs',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCouncilMembers',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
] as const

const CONTRIBUTOR_REGISTRY_ABI = parseAbi([
  'function getContributor(bytes32 contributorId) external view returns (bytes32, address, uint256, uint8, string, uint256, uint256, uint256, bool)',
  'function getContributorByWallet(address wallet) external view returns (bytes32, address, uint256, uint8, string, uint256, uint256, uint256, bool)',
  'function getSocialLinks(bytes32 contributorId) external view returns (bytes32[], string[], bytes32[], uint8[], uint256[], uint256[])',
  'function getRepositoryClaims(bytes32 contributorId) external view returns (bytes32[], bytes32[], string[], string[], bytes32[], uint8[], uint256[], uint256[])',
  'function getDependencyClaims(bytes32 contributorId) external view returns (bytes32[], bytes32[], string[], string[], bytes32[], uint8[], uint256[], uint256[])',
  'function getAllContributors() external view returns (bytes32[])',
  'function getContributorCount() external view returns (uint256)',
  'function isVerifiedGitHub(bytes32 contributorId) external view returns (bool)',
  'function register(uint8 contributorType, string profileUri) external returns (bytes32)',
  'function addSocialLink(bytes32 contributorId, bytes32 platform, string handle) external',
  'function claimRepository(bytes32 contributorId, string owner, string repo) external returns (bytes32)',
  'function claimDependency(bytes32 contributorId, string packageName, string registryType) external returns (bytes32)',
])

const PAYMENT_REQUEST_REGISTRY_ABI = parseAbi([
  'function getRequest(bytes32 requestId) external view returns (bytes32, bytes32, address, bytes32, uint8, string, string, string, address, uint256, uint256, uint8, bool, uint256, uint256, uint256, uint256, uint256, string, bytes32)',
  'function getPendingRequests(bytes32 daoId) external view returns (bytes32[])',
  'function getCouncilVotes(bytes32 requestId) external view returns (address[], uint8[], string[], uint256[])',
  'function getCEODecision(bytes32 requestId) external view returns (bool, uint256, string, uint256)',
  'function submitRequest(bytes32 daoId, bytes32 contributorId, uint8 category, string title, string description, string evidenceUri, uint256 requestedAmount, bool isRetroactive, uint256 workStartDate, uint256 workEndDate) external returns (bytes32)',
  'function councilVote(bytes32 requestId, uint8 vote, string reason) external',
])

const DEEP_FUNDING_DISTRIBUTOR_ABI = [
  {
    type: 'function',
    name: 'getDAOPool',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'daoId', type: 'bytes32' },
          { name: 'token', type: 'address' },
          { name: 'totalAccumulated', type: 'uint256' },
          { name: 'contributorPool', type: 'uint256' },
          { name: 'dependencyPool', type: 'uint256' },
          { name: 'reservePool', type: 'uint256' },
          { name: 'lastDistributedEpoch', type: 'uint256' },
          { name: 'epochStartTime', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCurrentEpoch',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'epochId', type: 'uint256' },
          { name: 'daoId', type: 'bytes32' },
          { name: 'startTime', type: 'uint256' },
          { name: 'endTime', type: 'uint256' },
          { name: 'totalContributorRewards', type: 'uint256' },
          { name: 'totalDependencyRewards', type: 'uint256' },
          { name: 'totalDistributed', type: 'uint256' },
          { name: 'finalized', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getContributorShare',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'epochId', type: 'uint256' },
      { name: 'contributorId', type: 'bytes32' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'contributorId', type: 'bytes32' },
          { name: 'weight', type: 'uint256' },
          { name: 'pendingRewards', type: 'uint256' },
          { name: 'claimedRewards', type: 'uint256' },
          { name: 'lastClaimEpoch', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDependencyShare',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'depHash', type: 'bytes32' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'depHash', type: 'bytes32' },
          { name: 'contributorId', type: 'bytes32' },
          { name: 'weight', type: 'uint256' },
          { name: 'transitiveDepth', type: 'uint256' },
          { name: 'usageCount', type: 'uint256' },
          { name: 'pendingRewards', type: 'uint256' },
          { name: 'claimedRewards', type: 'uint256' },
          { name: 'isRegistered', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getEpochVotes',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'epochId', type: 'uint256' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'voter', type: 'address' },
          { name: 'targetId', type: 'bytes32' },
          { name: 'weightAdjustment', type: 'int256' },
          { name: 'reason', type: 'string' },
          { name: 'reputation', type: 'uint256' },
          { name: 'votedAt', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPendingContributorRewards',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'contributorId', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDAOConfig',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'treasuryBps', type: 'uint256' },
          { name: 'contributorPoolBps', type: 'uint256' },
          { name: 'dependencyPoolBps', type: 'uint256' },
          { name: 'jejuBps', type: 'uint256' },
          { name: 'burnBps', type: 'uint256' },
          { name: 'reserveBps', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'defaultConfig',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'treasuryBps', type: 'uint256' },
          { name: 'contributorPoolBps', type: 'uint256' },
          { name: 'dependencyPoolBps', type: 'uint256' },
          { name: 'jejuBps', type: 'uint256' },
          { name: 'burnBps', type: 'uint256' },
          { name: 'reserveBps', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'depositFees',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'source', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'voteOnWeight',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'targetId', type: 'bytes32' },
      { name: 'adjustment', type: 'int256' },
      { name: 'reason', type: 'string' },
      { name: 'reputation', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'finalizeEpoch',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claimContributorRewards',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'contributorId', type: 'bytes32' },
      { name: 'epochs', type: 'uint256[]' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

// ============ Configuration ============

interface FundingConfig {
  rpcUrl: string
  chainId: number
  contracts: {
    daoRegistry: Address
    contributorRegistry: Address
    paymentRequestRegistry: Address
    deepFundingDistributor: Address
  }
}

function getConfig(): FundingConfig {
  const network = process.env.NETWORK || 'localnet'

  // Load from deployment config or env
  const contracts = {
    daoRegistry: (process.env.DAO_REGISTRY_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as Address,
    contributorRegistry: (process.env.CONTRIBUTOR_REGISTRY_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as Address,
    paymentRequestRegistry: (process.env.PAYMENT_REQUEST_REGISTRY_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as Address,
    deepFundingDistributor: (process.env.DEEP_FUNDING_DISTRIBUTOR_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as Address,
  }

  return {
    rpcUrl: process.env.RPC_URL || 'http://localhost:6545',
    chainId:
      network === 'localnet' ? 31337 : network === 'testnet' ? 84532 : 8453,
    contracts,
  }
}

// ============ Router ============

export function createFundingRouter(): Hono {
  const router = new Hono()
  const config = getConfig()

  const publicClient = createPublicClient({
    transport: http(config.rpcUrl),
  })

  // ============ DAO Routes ============

  router.get('/daos', async (c) => {
    const daoIds = await publicClient.readContract({
      address: config.contracts.daoRegistry,
      abi: DAO_REGISTRY_ABI,
      functionName: 'getAllDAOs',
    })
    return c.json({ daoIds })
  })

  router.get('/daos/:daoId', async (c) => {
    const daoId = c.req.param('daoId') as Hex
    const dao = await publicClient.readContract({
      address: config.contracts.daoRegistry,
      abi: DAO_REGISTRY_ABI,
      functionName: 'getDAO',
      args: [daoId],
    })
    return c.json(dao)
  })

  router.get('/daos/:daoId/council', async (c) => {
    const daoId = c.req.param('daoId') as Hex
    const members = await publicClient.readContract({
      address: config.contracts.daoRegistry,
      abi: DAO_REGISTRY_ABI,
      functionName: 'getCouncilMembers',
      args: [daoId],
    })
    return c.json({ members })
  })

  // ============ Pool & Epoch Routes ============

  router.get('/daos/:daoId/pool', async (c) => {
    const daoId = c.req.param('daoId') as Hex
    const pool = await publicClient.readContract({
      address: config.contracts.deepFundingDistributor,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'getDAOPool',
      args: [daoId],
    })
    return c.json(pool)
  })

  router.get('/daos/:daoId/epoch', async (c) => {
    const daoId = c.req.param('daoId') as Hex
    const epoch = await publicClient.readContract({
      address: config.contracts.deepFundingDistributor,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'getCurrentEpoch',
      args: [daoId],
    })
    return c.json(epoch)
  })

  router.get('/daos/:daoId/epoch/:epochId/votes', async (c) => {
    const daoId = c.req.param('daoId') as Hex
    const epochId = BigInt(c.req.param('epochId'))
    const votes = await publicClient.readContract({
      address: config.contracts.deepFundingDistributor,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'getEpochVotes',
      args: [daoId, epochId],
    })
    return c.json({ votes })
  })

  router.get('/daos/:daoId/config', async (c) => {
    const daoId = c.req.param('daoId') as Hex
    const config_ = await publicClient.readContract({
      address: config.contracts.deepFundingDistributor,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'getDAOConfig',
      args: [daoId],
    })
    return c.json(config_)
  })

  router.get('/config/default', async (c) => {
    const defaultConfig = await publicClient.readContract({
      address: config.contracts.deepFundingDistributor,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'defaultConfig',
    })
    return c.json(defaultConfig)
  })

  // ============ Contributor Routes ============

  router.get('/contributors', async (c) => {
    const contributorIds = await publicClient.readContract({
      address: config.contracts.contributorRegistry,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getAllContributors',
    })
    return c.json({ contributorIds })
  })

  router.get('/contributors/count', async (c) => {
    const count = await publicClient.readContract({
      address: config.contracts.contributorRegistry,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getContributorCount',
    })
    return c.json({ count: count.toString() })
  })

  router.get('/contributors/:contributorId', async (c) => {
    const contributorId = c.req.param('contributorId') as Hex
    const contributor = await publicClient.readContract({
      address: config.contracts.contributorRegistry,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getContributor',
      args: [contributorId],
    })
    return c.json(contributor)
  })

  router.get('/contributors/wallet/:wallet', async (c) => {
    const wallet = c.req.param('wallet') as Address
    const contributor = await publicClient.readContract({
      address: config.contracts.contributorRegistry,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getContributorByWallet',
      args: [wallet],
    })
    return c.json(contributor)
  })

  router.get('/contributors/:contributorId/social', async (c) => {
    const contributorId = c.req.param('contributorId') as Hex
    const links = await publicClient.readContract({
      address: config.contracts.contributorRegistry,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getSocialLinks',
      args: [contributorId],
    })
    return c.json({ links })
  })

  router.get('/contributors/:contributorId/repos', async (c) => {
    const contributorId = c.req.param('contributorId') as Hex
    const claims = await publicClient.readContract({
      address: config.contracts.contributorRegistry,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getRepositoryClaims',
      args: [contributorId],
    })
    return c.json({ claims })
  })

  router.get('/contributors/:contributorId/deps', async (c) => {
    const contributorId = c.req.param('contributorId') as Hex
    const claims = await publicClient.readContract({
      address: config.contracts.contributorRegistry,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getDependencyClaims',
      args: [contributorId],
    })
    return c.json({ claims })
  })

  router.get('/contributors/:contributorId/github-verified', async (c) => {
    const contributorId = c.req.param('contributorId') as Hex
    const verified = await publicClient.readContract({
      address: config.contracts.contributorRegistry,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'isVerifiedGitHub',
      args: [contributorId],
    })
    return c.json({ verified })
  })

  router.get('/contributors/:contributorId/rewards/:daoId', async (c) => {
    const contributorId = c.req.param('contributorId') as Hex
    const daoId = c.req.param('daoId') as Hex
    const rewards = await publicClient.readContract({
      address: config.contracts.deepFundingDistributor,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'getPendingContributorRewards',
      args: [daoId, contributorId],
    })
    return c.json({ rewards: rewards.toString() })
  })

  // ============ Payment Request Routes ============

  router.get('/daos/:daoId/payment-requests', async (c) => {
    const daoId = c.req.param('daoId') as Hex
    const requests = await publicClient.readContract({
      address: config.contracts.paymentRequestRegistry,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'getPendingRequests',
      args: [daoId],
    })
    return c.json({ requests })
  })

  router.get('/payment-requests/:requestId', async (c) => {
    const requestId = c.req.param('requestId') as Hex
    const request = await publicClient.readContract({
      address: config.contracts.paymentRequestRegistry,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'getRequest',
      args: [requestId],
    })
    return c.json(request)
  })

  router.get('/payment-requests/:requestId/votes', async (c) => {
    const requestId = c.req.param('requestId') as Hex
    const votes = await publicClient.readContract({
      address: config.contracts.paymentRequestRegistry,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'getCouncilVotes',
      args: [requestId],
    })
    return c.json({ votes })
  })

  router.get('/payment-requests/:requestId/ceo-decision', async (c) => {
    const requestId = c.req.param('requestId') as Hex
    const decision = await publicClient.readContract({
      address: config.contracts.paymentRequestRegistry,
      abi: PAYMENT_REQUEST_REGISTRY_ABI,
      functionName: 'getCEODecision',
      args: [requestId],
    })
    return c.json(decision)
  })

  // ============ Dependency Routes ============

  router.get('/daos/:daoId/dependencies/:depHash', async (c) => {
    const daoId = c.req.param('daoId') as Hex
    const depHash = c.req.param('depHash') as Hex
    const share = await publicClient.readContract({
      address: config.contracts.deepFundingDistributor,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'getDependencyShare',
      args: [daoId, depHash],
    })
    return c.json(share)
  })

  // ============ Health ============

  router.get('/health', async (c) => {
    const blockNumber = await publicClient.getBlockNumber()
    return c.json({
      status: 'ok',
      network: process.env.NETWORK || 'localnet',
      rpcUrl: config.rpcUrl,
      blockNumber: blockNumber.toString(),
      contracts: config.contracts,
    })
  })

  return router
}
