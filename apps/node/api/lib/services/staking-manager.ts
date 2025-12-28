/**
 * Staking Manager Service
 *
 * Manages delegated staking for node operators with:
 * - Self-stake management
 * - Delegator tracking (via contract events)
 * - Reward distribution
 * - Commission management
 *
 * Profit Split Model:
 * - Compute Provider: 20-40% (commission for hardware/operations)
 * - Capital Stakers: 60-80% (proportional to delegation)
 * - Protocol Fee: 5% (to treasury)
 *
 * SECURITY: Uses KMS-backed signing via SecureSigner. No private keys in memory.
 */

import { type Address, encodeFunctionData, formatEther, type Hex } from 'viem'
import type { NodeClient, SecureNodeClient } from '../contracts'
import { createSecureSigner, type SecureSigner } from '../secure-signer'

// Contract ABI for DelegatedNodeStaking
const DELEGATED_NODE_STAKING_ABI = [
  {
    name: 'registerOperator',
    type: 'function',
    inputs: [
      { name: 'endpoint', type: 'string' },
      { name: 'commissionBps', type: 'uint256' },
      { name: 'services', type: 'uint8[]' },
      {
        name: 'hardware',
        type: 'tuple',
        components: [
          { name: 'cpuCores', type: 'uint256' },
          { name: 'memoryGb', type: 'uint256' },
          { name: 'storageGb', type: 'uint256' },
          { name: 'gpuCount', type: 'uint256' },
          { name: 'gpuModel', type: 'string' },
          { name: 'teeCapable', type: 'bool' },
          { name: 'teeType', type: 'string' },
          { name: 'region', type: 'string' },
        ],
      },
    ],
    outputs: [{ name: 'nodeId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'addSelfStake',
    type: 'function',
    inputs: [],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'initiateCommissionChange',
    type: 'function',
    inputs: [{ name: 'newBps', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'executeCommissionChange',
    type: 'function',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'claimRewards',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getNode',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'operator', type: 'address' },
          { name: 'nodeId', type: 'bytes32' },
          { name: 'endpoint', type: 'string' },
          { name: 'selfStake', type: 'uint256' },
          { name: 'totalDelegated', type: 'uint256' },
          { name: 'commissionBps', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastRewardTime', type: 'uint256' },
          { name: 'totalRewardsEarned', type: 'uint256' },
          { name: 'totalRewardsDistributed', type: 'uint256' },
          { name: 'active', type: 'bool' },
          { name: 'slashed', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getNodeRewards',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'totalEarned', type: 'uint256' },
          { name: 'operatorShare', type: 'uint256' },
          { name: 'delegatorPool', type: 'uint256' },
          { name: 'protocolFee', type: 'uint256' },
          { name: 'lastDistribution', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getDelegation',
    type: 'function',
    inputs: [
      { name: 'delegator', type: 'address' },
      { name: 'nodeId', type: 'bytes32' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'delegator', type: 'address' },
          { name: 'nodeId', type: 'bytes32' },
          { name: 'amount', type: 'uint256' },
          { name: 'delegatedAt', type: 'uint256' },
          { name: 'unstakedAt', type: 'uint256' },
          { name: 'pendingRewards', type: 'uint256' },
          { name: 'claimedRewards', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'operatorNode',
    type: 'function',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ name: 'nodeId', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    name: 'getOperatorAPY',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getDelegatorAPY',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export interface StakingConfig {
  nodeId: Hex
  operatorAddress: Address
  commissionBps: number // 500-5000 (5%-50%)
  minDelegation: bigint
  endpoint: string
  region: string
  /** KMS key ID for secure signing (no raw private keys) */
  keyId?: string
}

export interface StakingState {
  selfStake: bigint
  totalDelegated: bigint
  totalStake: bigint
  delegatorCount: number
  pendingRewards: bigint
  claimedRewards: bigint
  lastRewardTime: number
  apr: number // Annual percentage rate
  registered: boolean
}

export interface Delegator {
  address: Address
  amount: bigint
  delegatedAt: number
  pendingRewards: bigint
  claimedRewards: bigint
}

export interface StakingManagerService {
  readonly config: StakingConfig
  readonly state: StakingState

  // Operator functions
  registerNode(selfStake: bigint): Promise<Hex>
  setCommission(bps: number): Promise<Hex>
  addSelfStake(amount: bigint): Promise<Hex>
  claimRewards(): Promise<Hex>

  // Read functions
  getNodeInfo(): Promise<NodeInfo | null>
  getRewardsInfo(): Promise<RewardsInfo | null>
  getDelegation(delegator: Address): Promise<Delegator | null>
  getTotalDelegated(): Promise<bigint>
  getEstimatedAPR(): Promise<number>

  // Metrics
  getStakingMetrics(): Promise<StakingMetrics>

  // Sync state from chain
  syncState(): Promise<void>
}

export interface NodeInfo {
  operator: Address
  nodeId: Hex
  endpoint: string
  selfStake: bigint
  totalDelegated: bigint
  commissionBps: number
  registeredAt: number
  active: boolean
  slashed: boolean
}

export interface RewardsInfo {
  totalEarned: bigint
  operatorShare: bigint
  delegatorPool: bigint
  protocolFee: bigint
  lastDistribution: number
}

export interface StakingMetrics {
  totalStake: bigint
  selfStakeRatio: number // Self-stake as % of total
  delegatorAPY: number
  operatorAPY: number
  commission: number
  pendingRewards: bigint
}

const DEFAULT_CONFIG: StakingConfig = {
  nodeId: '0x' as Hex,
  operatorAddress: '0x0000000000000000000000000000000000000000' as Address,
  commissionBps: 2000, // 20% default commission
  minDelegation: 100n * 10n ** 18n, // 100 tokens minimum
  endpoint: '',
  region: 'us-east-1',
}

export function createStakingManagerService(
  client: NodeClient | SecureNodeClient,
  config: Partial<StakingConfig> = {},
): StakingManagerService {
  const fullConfig: StakingConfig = { ...DEFAULT_CONFIG, ...config }

  // Get keyId from config or SecureNodeClient
  const keyId = config.keyId ?? ('keyId' in client ? client.keyId : undefined)
  let signer: SecureSigner | null = null
  if (keyId) {
    signer = createSecureSigner(keyId)
  }

  const state: StakingState = {
    selfStake: 0n,
    totalDelegated: 0n,
    totalStake: 0n,
    delegatorCount: 0,
    pendingRewards: 0n,
    claimedRewards: 0n,
    lastRewardTime: 0,
    apr: 0,
    registered: false,
  }

  function getContractAddress(): Address {
    const addr = client.addresses.delegatedNodeStaking
    if (addr === '0x0000000000000000000000000000000000000000') {
      throw new Error('DelegatedNodeStaking contract not deployed')
    }
    return addr
  }

  async function registerNode(selfStake: bigint): Promise<Hex> {
    if (!signer) {
      throw new Error('Signer not configured - provide keyId in config')
    }

    const contractAddr = getContractAddress()

    console.log(
      `[Staking] Registering node with ${formatEther(selfStake)} ETH stake...`,
    )

    // Encode contract call
    const data = encodeFunctionData({
      abi: DELEGATED_NODE_STAKING_ABI,
      functionName: 'registerOperator',
      args: [
        fullConfig.endpoint,
        BigInt(fullConfig.commissionBps),
        [0, 1, 2], // Compute, Storage, CDN
        {
          cpuCores: 8n,
          memoryGb: 32n,
          storageGb: 1000n,
          gpuCount: 0n,
          gpuModel: '',
          teeCapable: false,
          teeType: '',
          region: fullConfig.region,
        },
      ],
    })

    // Sign via KMS and broadcast
    const { signedTransaction, hash } = await signer.signTransaction({
      to: contractAddr,
      data,
      value: selfStake,
      chainId: client.chainId,
    })

    await client.publicClient.sendRawTransaction({
      serializedTransaction: signedTransaction,
    })

    const receipt = await client.publicClient.waitForTransactionReceipt({
      hash,
    })
    console.log(`[Staking] Node registered in tx: ${receipt.transactionHash}`)

    // Get the node ID from contract
    const signerAddress = await signer.getAddress()
    const nodeId = await client.publicClient.readContract({
      address: contractAddr,
      abi: DELEGATED_NODE_STAKING_ABI,
      functionName: 'operatorNode',
      args: [signerAddress],
    })

    fullConfig.nodeId = nodeId
    state.registered = true
    state.selfStake = selfStake
    state.totalStake = selfStake

    return receipt.transactionHash
  }

  async function setCommission(bps: number): Promise<Hex> {
    if (!signer) {
      throw new Error('Signer not configured - provide keyId in config')
    }

    if (bps < 500 || bps > 5000) {
      throw new Error(
        'Commission must be between 5% (500) and 50% (5000) basis points',
      )
    }

    const contractAddr = getContractAddress()

    console.log(`[Staking] Initiating commission change to ${bps / 100}%...`)
    console.log(`[Staking] Note: 7-day delay before commission takes effect`)

    const data = encodeFunctionData({
      abi: DELEGATED_NODE_STAKING_ABI,
      functionName: 'initiateCommissionChange',
      args: [BigInt(bps)],
    })

    const { signedTransaction, hash } = await signer.signTransaction({
      to: contractAddr,
      data,
      chainId: client.chainId,
    })

    await client.publicClient.sendRawTransaction({
      serializedTransaction: signedTransaction,
    })

    const receipt = await client.publicClient.waitForTransactionReceipt({
      hash,
    })
    console.log(
      `[Staking] Commission change initiated in tx: ${receipt.transactionHash}`,
    )

    return receipt.transactionHash
  }

  async function addSelfStake(amount: bigint): Promise<Hex> {
    if (!signer) {
      throw new Error('Signer not configured - provide keyId in config')
    }

    const contractAddr = getContractAddress()

    console.log(`[Staking] Adding ${formatEther(amount)} ETH self-stake...`)

    const data = encodeFunctionData({
      abi: DELEGATED_NODE_STAKING_ABI,
      functionName: 'addSelfStake',
      args: [],
    })

    const { signedTransaction, hash } = await signer.signTransaction({
      to: contractAddr,
      data,
      value: amount,
      chainId: client.chainId,
    })

    await client.publicClient.sendRawTransaction({
      serializedTransaction: signedTransaction,
    })

    const receipt = await client.publicClient.waitForTransactionReceipt({
      hash,
    })
    console.log(`[Staking] Self-stake added in tx: ${receipt.transactionHash}`)

    state.selfStake += amount
    state.totalStake = state.selfStake + state.totalDelegated

    return receipt.transactionHash
  }

  async function claimRewards(): Promise<Hex> {
    if (!signer) {
      throw new Error('Signer not configured - provide keyId in config')
    }

    if (!fullConfig.nodeId || fullConfig.nodeId === '0x') {
      throw new Error('Node not registered')
    }

    const contractAddr = getContractAddress()

    console.log('[Staking] Claiming rewards...')

    const data = encodeFunctionData({
      abi: DELEGATED_NODE_STAKING_ABI,
      functionName: 'claimRewards',
      args: [fullConfig.nodeId],
    })

    const { signedTransaction, hash } = await signer.signTransaction({
      to: contractAddr,
      data,
      chainId: client.chainId,
    })

    await client.publicClient.sendRawTransaction({
      serializedTransaction: signedTransaction,
    })

    const receipt = await client.publicClient.waitForTransactionReceipt({
      hash,
    })
    console.log(`[Staking] Rewards claimed in tx: ${receipt.transactionHash}`)

    state.claimedRewards += state.pendingRewards
    state.pendingRewards = 0n

    return receipt.transactionHash
  }

  async function getNodeInfo(): Promise<NodeInfo | null> {
    if (!fullConfig.nodeId || fullConfig.nodeId === '0x') {
      return null
    }

    const contractAddr = getContractAddress()

    const node = await client.publicClient.readContract({
      address: contractAddr,
      abi: DELEGATED_NODE_STAKING_ABI,
      functionName: 'getNode',
      args: [fullConfig.nodeId],
    })

    return {
      operator: node.operator,
      nodeId: node.nodeId,
      endpoint: node.endpoint,
      selfStake: node.selfStake,
      totalDelegated: node.totalDelegated,
      commissionBps: Number(node.commissionBps),
      registeredAt: Number(node.registeredAt) * 1000,
      active: node.active,
      slashed: node.slashed,
    }
  }

  async function getRewardsInfo(): Promise<RewardsInfo | null> {
    if (!fullConfig.nodeId || fullConfig.nodeId === '0x') {
      return null
    }

    const contractAddr = getContractAddress()

    const rewards = await client.publicClient.readContract({
      address: contractAddr,
      abi: DELEGATED_NODE_STAKING_ABI,
      functionName: 'getNodeRewards',
      args: [fullConfig.nodeId],
    })

    return {
      totalEarned: rewards.totalEarned,
      operatorShare: rewards.operatorShare,
      delegatorPool: rewards.delegatorPool,
      protocolFee: rewards.protocolFee,
      lastDistribution: Number(rewards.lastDistribution) * 1000,
    }
  }

  async function getDelegation(delegator: Address): Promise<Delegator | null> {
    if (!fullConfig.nodeId || fullConfig.nodeId === '0x') {
      return null
    }

    const contractAddr = getContractAddress()

    const delegation = await client.publicClient.readContract({
      address: contractAddr,
      abi: DELEGATED_NODE_STAKING_ABI,
      functionName: 'getDelegation',
      args: [delegator, fullConfig.nodeId],
    })

    if (delegation.amount === 0n) {
      return null
    }

    return {
      address: delegation.delegator,
      amount: delegation.amount,
      delegatedAt: Number(delegation.delegatedAt) * 1000,
      pendingRewards: delegation.pendingRewards,
      claimedRewards: delegation.claimedRewards,
    }
  }

  async function getTotalDelegated(): Promise<bigint> {
    const info = await getNodeInfo()
    return info?.totalDelegated ?? 0n
  }

  async function getEstimatedAPR(): Promise<number> {
    if (!fullConfig.nodeId || fullConfig.nodeId === '0x') {
      return 0
    }

    const contractAddr = getContractAddress()

    const apyBps = await client.publicClient.readContract({
      address: contractAddr,
      abi: DELEGATED_NODE_STAKING_ABI,
      functionName: 'getDelegatorAPY',
      args: [fullConfig.nodeId],
    })

    return Number(apyBps) / 100
  }

  async function syncState(): Promise<void> {
    const info = await getNodeInfo()
    if (!info) {
      state.registered = false
      return
    }

    state.registered = info.active
    state.selfStake = info.selfStake
    state.totalDelegated = info.totalDelegated
    state.totalStake = info.selfStake + info.totalDelegated

    const rewards = await getRewardsInfo()
    if (rewards) {
      state.pendingRewards = rewards.operatorShare
      state.lastRewardTime = rewards.lastDistribution
    }

    state.apr = await getEstimatedAPR()
  }

  async function getStakingMetrics(): Promise<StakingMetrics> {
    await syncState()

    const contractAddr = getContractAddress()

    let operatorAPY = 0
    let delegatorAPY = 0

    if (fullConfig.nodeId && fullConfig.nodeId !== '0x') {
      const [opApy, delApy] = await Promise.all([
        client.publicClient.readContract({
          address: contractAddr,
          abi: DELEGATED_NODE_STAKING_ABI,
          functionName: 'getOperatorAPY',
          args: [fullConfig.nodeId],
        }),
        client.publicClient.readContract({
          address: contractAddr,
          abi: DELEGATED_NODE_STAKING_ABI,
          functionName: 'getDelegatorAPY',
          args: [fullConfig.nodeId],
        }),
      ])
      operatorAPY = Number(opApy) / 100
      delegatorAPY = Number(delApy) / 100
    }

    return {
      totalStake: state.totalStake,
      selfStakeRatio:
        state.totalStake > 0n
          ? Number((state.selfStake * 10000n) / state.totalStake) / 100
          : 0,
      delegatorAPY,
      operatorAPY,
      commission: fullConfig.commissionBps / 100,
      pendingRewards: state.pendingRewards,
    }
  }

  return {
    get config() {
      return fullConfig
    },
    get state() {
      return state
    },
    registerNode,
    setCommission,
    addSelfStake,
    claimRewards,
    getNodeInfo,
    getRewardsInfo,
    getDelegation,
    getTotalDelegated,
    getEstimatedAPR,
    getStakingMetrics,
    syncState,
  }
}

export function getDefaultStakingConfig(): Partial<StakingConfig> {
  return {
    commissionBps: 2000, // 20%
    minDelegation: 100n * 10n ** 18n,
    endpoint: '',
    region: 'us-east-1',
  }
}
