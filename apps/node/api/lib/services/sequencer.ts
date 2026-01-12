/**
 * Sequencer Service
 *
 * Enables node operators to run as L2 sequencers with:
 * - Transaction ordering
 * - Batch submission
 * - State root proposal
 * - Delegated staking integration
 *
 * Requirements:
 * - Minimum stake (self + delegated)
 * - TEE capability for sensitive operations
 * - High uptime SLA
 */

import { type Hex, keccak256, toBytes } from 'viem'
import type { SecureNodeClient } from '../contracts'

// Contract ABIs - minimal interfaces for sequencer operations
const SEQUENCER_REGISTRY_ABI = [
  {
    name: 'register',
    type: 'function',
    inputs: [
      { name: 'endpoint', type: 'string' },
      { name: 'stake', type: 'uint256' },
    ],
    outputs: [{ name: 'sequencerId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'deregister',
    type: 'function',
    inputs: [{ name: 'sequencerId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getSequencer',
    type: 'function',
    inputs: [{ name: 'sequencerId', type: 'bytes32' }],
    outputs: [
      { name: 'operator', type: 'address' },
      { name: 'stake', type: 'uint256' },
      { name: 'isActive', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'isSequencer',
    type: 'function',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const

const DELEGATED_STAKING_ABI = [
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
] as const

export interface SequencerConfig {
  enabled: boolean
  endpoint: string
  nodeId: Hex
  minStake: bigint
  teeRequired: boolean
  batchInterval: number // seconds
  proposalInterval: number // seconds
}

export interface SequencerState {
  isActive: boolean
  isSequencing: boolean
  sequencerId: Hex
  currentBatch: number
  lastBatchTime: number
  lastProposalTime: number
  pendingTransactions: number
  totalBatchesSubmitted: number
  totalProposalsSubmitted: number
  earnings: bigint
  stake: bigint
}

export interface SequencerService {
  readonly config: SequencerConfig
  readonly state: SequencerState

  // Lifecycle
  start(): Promise<void>
  stop(): Promise<void>
  isHealthy(): Promise<boolean>

  // Sequencing (these require external op-node integration)
  getSequencerStatus(): Promise<{ registered: boolean; stake: bigint }>

  // Staking
  getStake(): Promise<bigint>
  getRequiredStake(): Promise<bigint>
  registerAsSequencer(): Promise<Hex>
  deregisterSequencer(): Promise<Hex>

  // Metrics
  getMetrics(): Promise<SequencerMetrics>
}

export interface SequencerMetrics {
  registered: boolean
  stake: bigint
  isActive: boolean
  uptime: number
}

const DEFAULT_CONFIG: SequencerConfig = {
  enabled: false,
  endpoint: '',
  nodeId: '0x' as Hex,
  minStake: 100_000n * 10n ** 18n, // 100,000 tokens
  teeRequired: true,
  batchInterval: 12, // 12 seconds (1 L1 block)
  proposalInterval: 1800, // 30 minutes
}

export function createSequencerService(
  client: SecureNodeClient,
  config: Partial<SequencerConfig> = {},
): SequencerService {
  const fullConfig: SequencerConfig = { ...DEFAULT_CONFIG, ...config }

  const state: SequencerState = {
    isActive: false,
    isSequencing: false,
    sequencerId: '0x' as Hex,
    currentBatch: 0,
    lastBatchTime: 0,
    lastProposalTime: 0,
    pendingTransactions: 0,
    totalBatchesSubmitted: 0,
    totalProposalsSubmitted: 0,
    earnings: 0n,
    stake: 0n,
  }

  async function start(): Promise<void> {
    if (!fullConfig.enabled) {
      console.log('[Sequencer] Service disabled')
      return
    }

    console.log('[Sequencer] Starting sequencer service...')

    // Verify stake
    const stake = await getStake()
    state.stake = stake
    const required = await getRequiredStake()
    if (stake < required) {
      throw new Error(
        `Insufficient stake: ${stake} < ${required}. Need more delegations or self-stake.`,
      )
    }

    // Check if already registered
    const status = await getSequencerStatus()
    if (!status.registered) {
      console.log('[Sequencer] Registering as sequencer...')
      await registerAsSequencer()
    }

    state.isActive = true
    state.isSequencing = true

    console.log('[Sequencer] Sequencer service started')
    console.log(
      `[Sequencer] Batch submission and proposals are handled by op-node`,
    )
    console.log(`[Sequencer] This service manages registration and staking`)
  }

  async function stop(): Promise<void> {
    console.log('[Sequencer] Stopping sequencer service...')
    state.isSequencing = false
    state.isActive = false
    console.log('[Sequencer] Sequencer service stopped')
  }

  async function isHealthy(): Promise<boolean> {
    if (!state.isActive) return true

    // Check if still registered
    const status = await getSequencerStatus()
    return status.registered
  }

  async function getSequencerStatus(): Promise<{
    registered: boolean
    stake: bigint
  }> {
    const sequencerRegistry = client.addresses.sequencerRegistry
    if (sequencerRegistry === '0x0000000000000000000000000000000000000000') {
      return { registered: false, stake: 0n }
    }

    // Get address from KMS signer
    const address = await client.txExecutor.getAddress()

    const isRegistered = await client.publicClient.readContract({
      address: sequencerRegistry,
      abi: SEQUENCER_REGISTRY_ABI,
      functionName: 'isSequencer',
      args: [address],
    })

    const stake = await getStake()

    return { registered: isRegistered, stake }
  }

  async function getStake(): Promise<bigint> {
    if (!fullConfig.nodeId || fullConfig.nodeId === '0x') {
      return 0n
    }

    const delegatedStaking = client.addresses.delegatedNodeStaking
    if (delegatedStaking === '0x0000000000000000000000000000000000000000') {
      return 0n
    }

    const node = await client.publicClient.readContract({
      address: delegatedStaking,
      abi: DELEGATED_STAKING_ABI,
      functionName: 'getNode',
      args: [fullConfig.nodeId],
    })

    // Total stake = selfStake + totalDelegated
    return node.selfStake + node.totalDelegated
  }

  async function getRequiredStake(): Promise<bigint> {
    return fullConfig.minStake
  }

  async function registerAsSequencer(): Promise<Hex> {
    const sequencerRegistry = client.addresses.sequencerRegistry
    if (sequencerRegistry === '0x0000000000000000000000000000000000000000') {
      throw new Error('SequencerRegistry not deployed')
    }

    console.log('[Sequencer] Registering as sequencer via KMS...')

    const hash = await client.txExecutor.writeContract({
      address: sequencerRegistry,
      abi: SEQUENCER_REGISTRY_ABI,
      functionName: 'register',
      args: [fullConfig.endpoint, state.stake],
      value: state.stake,
    })

    const receipt = await client.publicClient.waitForTransactionReceipt({
      hash,
    })
    console.log(`[Sequencer] Registered in tx: ${receipt.transactionHash}`)

    // Derive sequencer ID from registration
    const address = await client.txExecutor.getAddress()
    state.sequencerId = keccak256(
      toBytes(`${address}${fullConfig.endpoint}${receipt.blockNumber}`),
    )

    return receipt.transactionHash
  }

  async function deregisterSequencer(): Promise<Hex> {
    const sequencerRegistry = client.addresses.sequencerRegistry
    if (sequencerRegistry === '0x0000000000000000000000000000000000000000') {
      throw new Error('SequencerRegistry not deployed')
    }

    console.log('[Sequencer] Deregistering sequencer via KMS...')

    await stop()

    const hash = await client.txExecutor.writeContract({
      address: sequencerRegistry,
      abi: SEQUENCER_REGISTRY_ABI,
      functionName: 'deregister',
      args: [state.sequencerId],
    })

    const receipt = await client.publicClient.waitForTransactionReceipt({
      hash,
    })
    console.log(`[Sequencer] Deregistered in tx: ${receipt.transactionHash}`)

    return receipt.transactionHash
  }

  async function getMetrics(): Promise<SequencerMetrics> {
    const status = await getSequencerStatus()

    return {
      registered: status.registered,
      stake: status.stake,
      isActive: state.isActive,
      uptime: state.isActive ? 1 : 0,
    }
  }

  return {
    get config() {
      return fullConfig
    },
    get state() {
      return state
    },
    start,
    stop,
    isHealthy,
    getSequencerStatus,
    getStake,
    getRequiredStake,
    registerAsSequencer,
    deregisterSequencer,
    getMetrics,
  }
}

export function getDefaultSequencerConfig(): Partial<SequencerConfig> {
  return {
    enabled: false,
    batchInterval: 12,
    proposalInterval: 1800,
    teeRequired: true,
    minStake: 100_000n * 10n ** 18n,
  }
}
