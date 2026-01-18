/**
 * Training Module - Decentralized AI model training
 *
 * Provides access to:
 * - Training run creation and coordination
 * - Client participation in training
 * - Witnessing and health checks
 * - Rewards claiming
 */

import type { NetworkType } from '@jejunetwork/types'
import { type Address, encodeFunctionData, type Hex, parseAbiItem } from 'viem'
import { safeGetContract } from '../config'
import type { BaseWallet } from '../wallet'

// Event signatures for querying logs
const RUN_CREATED_EVENT = parseAbiItem(
  'event RunCreated(bytes32 indexed runId, address indexed creator, uint8 privacyMode)',
)
const CLIENT_JOINED_EVENT = parseAbiItem(
  'event ClientJoined(bytes32 indexed runId, address indexed client, bytes32 nodeId)',
)
const CLIENT_LEFT_EVENT = parseAbiItem(
  'event ClientLeft(bytes32 indexed runId, address indexed client)',
)

// ═══════════════════════════════════════════════════════════════════════════
//                         TYPE GUARDS & HELPERS
// ═══════════════════════════════════════════════════════════════════════════

type RunCreatedEventArgs = {
  runId?: Hex
  creator?: Address
}

type ClientJoinedEventArgs = {
  runId?: Hex
  client?: Address
  nodeId?: Hex
}

type ClientLeftEventArgs = {
  runId?: Hex
  client?: Address
}

function hasRunCreatedArgs(
  args: RunCreatedEventArgs,
): args is { runId: Hex; creator: Address } {
  return args.runId !== undefined && args.creator !== undefined
}

function hasClientJoinedArgs(
  args: ClientJoinedEventArgs,
): args is { runId: Hex; client: Address; nodeId?: Hex } {
  return args.runId !== undefined && args.client !== undefined
}

function hasClientLeftArgs(
  args: ClientLeftEventArgs,
): args is { runId: Hex; client: Address } {
  return args.runId !== undefined && args.client !== undefined
}

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const RunState = {
  UNINITIALIZED: 0,
  WAITING_FOR_MEMBERS: 1,
  WARMUP: 2,
  ROUND_TRAIN: 3,
  ROUND_WITNESS: 4,
  COOLDOWN: 5,
  FINISHED: 6,
  PAUSED: 7,
} as const
export type RunState = (typeof RunState)[keyof typeof RunState]

export const PrivacyMode = {
  PUBLIC: 0,
  PRIVATE: 1, // TEE + MPC encrypted
} as const
export type PrivacyMode = (typeof PrivacyMode)[keyof typeof PrivacyMode]

export interface TrainingRun {
  runId: Hex
  creator: Address
  state: RunState
  config: CoordinatorConfig
  model: ModelConfig
  progress: Progress
  privacyMode: PrivacyMode
  mpcKeyId: Hex
  clientCount: number
  stateStartTimestamp: bigint
}

export interface CoordinatorConfig {
  minClients: number
  maxClients: number
  minTrainEpoch: number
  maxTrainEpoch: number
  witnessQuorum: number
  epochDuration: bigint
  roundDuration: bigint
}

export interface ModelConfig {
  modelHash: Hex
  datasetHash: Hex
  hyperparameters: string
  targetEpochs: number
}

export interface Progress {
  epoch: number
  step: number
  epochStartDataIndex: bigint
}

export interface Client {
  clientAddress: Address
  nodeId: Hex
  joinedAt: bigint
  lastActive: bigint
  isActive: boolean
  contribution: bigint
}

export interface CreateRunParams {
  minClients?: number
  maxClients?: number
  targetEpochs: number
  epochDuration?: bigint
  roundDuration?: bigint
  modelHash: Hex
  datasetHash: Hex
  hyperparameters?: string
  privacyMode?: PrivacyMode
  mpcKeyId?: Hex
}

export interface TrainingModule {
  // Run Management
  createRun(params: CreateRunParams): Promise<{ runId: Hex; txHash: Hex }>
  getRun(runId: Hex): Promise<TrainingRun | null>
  listActiveRuns(): Promise<TrainingRun[]>
  listMyRuns(): Promise<TrainingRun[]>
  pauseRun(runId: Hex): Promise<Hex>
  resumeRun(runId: Hex): Promise<Hex>
  cancelRun(runId: Hex): Promise<Hex>

  // Client Participation
  joinRun(runId: Hex, nodeId: Hex): Promise<Hex>
  leaveRun(runId: Hex): Promise<Hex>
  getClients(runId: Hex): Promise<Client[]>
  getMyClientStatus(runId: Hex): Promise<Client | null>
  isClientActive(runId: Hex, client?: Address): Promise<boolean>

  // Training Steps
  submitTrainingStep(runId: Hex, stepData: Hex): Promise<Hex>
  submitWitnessReport(runId: Hex, report: Hex): Promise<Hex>
  submitHealthCheck(runId: Hex, checkData: Hex): Promise<Hex>

  // Rewards
  claimRewards(runId: Hex): Promise<Hex>
  getPendingRewards(runId: Hex, client?: Address): Promise<bigint>
  getTotalRewards(runId: Hex): Promise<bigint>

  // Metrics
  getRunProgress(runId: Hex): Promise<Progress>
  getRunMetrics(runId: Hex): Promise<{
    totalEpochs: number
    currentEpoch: number
    participantCount: number
    witnessCount: number
    averageContribution: bigint
  }>
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const TRAINING_COORDINATOR_ABI = [
  {
    name: 'createRun',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'minClients', type: 'uint16' },
      { name: 'maxClients', type: 'uint16' },
      { name: 'targetEpochs', type: 'uint16' },
      { name: 'epochDuration', type: 'uint64' },
      { name: 'roundDuration', type: 'uint64' },
      { name: 'modelHash', type: 'bytes32' },
      { name: 'datasetHash', type: 'bytes32' },
      { name: 'hyperparameters', type: 'string' },
      { name: 'privacyMode', type: 'uint8' },
      { name: 'mpcKeyId', type: 'bytes32' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'runs',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'creator', type: 'address' },
      { name: 'state', type: 'uint8' },
      { name: 'stateStartTimestamp', type: 'uint64' },
      { name: 'privacyMode', type: 'uint8' },
      { name: 'mpcKeyId', type: 'bytes32' },
    ],
  },
  {
    name: 'joinRun',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'nodeId', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'leaveRun',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'pauseRun',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'resumeRun',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'cancelRun',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'submitTrainingStep',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'stepData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'submitWitnessReport',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'report', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'getClientCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'isClient',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'client', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'getProgress',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [
      { name: 'epoch', type: 'uint16' },
      { name: 'step', type: 'uint32' },
      { name: 'epochStartDataIndex', type: 'uint64' },
    ],
  },
  {
    name: 'submitHealthCheck',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'checkData', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

const TRAINING_REWARDS_ABI = [
  {
    name: 'claimRewards',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'pendingRewards',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'client', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'totalRewards',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createTrainingModule(
  wallet: BaseWallet,
  network: NetworkType,
): TrainingModule {
  // Use safe getters - contracts may not be deployed on all networks
  const coordinatorAddressOpt = safeGetContract(
    'training',
    'TrainingCoordinator',
    network,
  )
  const rewardsAddressOpt = safeGetContract(
    'training',
    'TrainingRewards',
    network,
  )

  // Lazy-load contract addresses - throw on method call if not deployed
  const getCoordinatorAddress = () => {
    if (!coordinatorAddressOpt) {
      throw new Error(
        'Training TrainingCoordinator contract not deployed on this network',
      )
    }
    return coordinatorAddressOpt
  }

  const getRewardsAddress = () => {
    if (!rewardsAddressOpt) {
      throw new Error(
        'Training TrainingRewards contract not deployed on this network',
      )
    }
    return rewardsAddressOpt
  }

  return {
    async createRun(params) {
      const data = encodeFunctionData({
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'createRun',
        args: [
          params.minClients ?? 2,
          params.maxClients ?? 256,
          params.targetEpochs,
          params.epochDuration ?? 3600n, // 1 hour
          params.roundDuration ?? 300n, // 5 minutes
          params.modelHash,
          params.datasetHash,
          params.hyperparameters ?? '',
          params.privacyMode ?? PrivacyMode.PUBLIC,
          params.mpcKeyId ?? (`0x${'0'.repeat(64)}` as Hex),
        ],
      })

      const txHash = await wallet.sendTransaction({
        to: getCoordinatorAddress(),
        data,
      })

      return { runId: params.modelHash, txHash }
    },

    async getRun(runId) {
      const result = await wallet.publicClient.readContract({
        address: getCoordinatorAddress(),
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'runs',
        args: [runId],
      })

      if (result[1] === '0x0000000000000000000000000000000000000000')
        return null

      const clientCount = await wallet.publicClient.readContract({
        address: getCoordinatorAddress(),
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'getClientCount',
        args: [runId],
      })

      return {
        runId: result[0],
        creator: result[1],
        state: result[2] as RunState,
        config: {
          minClients: 2,
          maxClients: 256,
          minTrainEpoch: 1,
          maxTrainEpoch: 100,
          witnessQuorum: 67,
          epochDuration: 3600n,
          roundDuration: 300n,
        },
        model: {
          modelHash: `0x${'0'.repeat(64)}` as Hex,
          datasetHash: `0x${'0'.repeat(64)}` as Hex,
          hyperparameters: '',
          targetEpochs: 0,
        },
        progress: { epoch: 0, step: 0, epochStartDataIndex: 0n },
        privacyMode: result[4] as PrivacyMode,
        mpcKeyId: result[5],
        clientCount: Number(clientCount),
        stateStartTimestamp: result[3],
      }
    },

    async listActiveRuns() {
      const runs: TrainingRun[] = []

      // Query RunCreated events
      const logs = await wallet.publicClient.getLogs({
        address: getCoordinatorAddress(),
        event: RUN_CREATED_EVENT,
        fromBlock: 'earliest',
        toBlock: 'latest',
      })

      // Get run details for each and filter to active states
      for (const log of logs.slice(-100)) {
        // Limit to last 100 runs
        if (!hasRunCreatedArgs(log.args)) continue
        const run = await this.getRun(log.args.runId)
        if (
          run &&
          run.state !== RunState.FINISHED &&
          run.state !== RunState.UNINITIALIZED
        ) {
          runs.push(run)
        }
      }

      return runs
    },

    async listMyRuns() {
      const runs: TrainingRun[] = []

      // Query RunCreated events filtered by creator
      const logs = await wallet.publicClient.getLogs({
        address: getCoordinatorAddress(),
        event: RUN_CREATED_EVENT,
        args: { creator: wallet.address },
        fromBlock: 'earliest',
        toBlock: 'latest',
      })

      // Get full run details for each
      for (const log of logs) {
        if (!hasRunCreatedArgs(log.args)) continue
        const run = await this.getRun(log.args.runId)
        if (run) {
          runs.push(run)
        }
      }

      return runs
    },

    async pauseRun(runId) {
      const data = encodeFunctionData({
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'pauseRun',
        args: [runId],
      })
      return wallet.sendTransaction({ to: getCoordinatorAddress(), data })
    },

    async resumeRun(runId) {
      const data = encodeFunctionData({
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'resumeRun',
        args: [runId],
      })
      return wallet.sendTransaction({ to: getCoordinatorAddress(), data })
    },

    async cancelRun(runId) {
      const data = encodeFunctionData({
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'cancelRun',
        args: [runId],
      })
      return wallet.sendTransaction({ to: getCoordinatorAddress(), data })
    },

    async joinRun(runId, nodeId) {
      const data = encodeFunctionData({
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'joinRun',
        args: [runId, nodeId],
      })
      return wallet.sendTransaction({ to: getCoordinatorAddress(), data })
    },

    async leaveRun(runId) {
      const data = encodeFunctionData({
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'leaveRun',
        args: [runId],
      })
      return wallet.sendTransaction({ to: getCoordinatorAddress(), data })
    },

    async getClients(runId) {
      const clients: Client[] = []
      const activeClients = new Set<string>()

      // Query ClientJoined events for this run
      const joinLogs = await wallet.publicClient.getLogs({
        address: getCoordinatorAddress(),
        event: CLIENT_JOINED_EVENT,
        args: { runId },
        fromBlock: 'earliest',
        toBlock: 'latest',
      })

      // Query ClientLeft events to track who has left
      const leftLogs = await wallet.publicClient.getLogs({
        address: getCoordinatorAddress(),
        event: CLIENT_LEFT_EVENT,
        args: { runId },
        fromBlock: 'earliest',
        toBlock: 'latest',
      })

      const leftAddresses = new Set<string>()
      for (const log of leftLogs) {
        if (!hasClientLeftArgs(log.args)) continue
        leftAddresses.add(log.args.client.toLowerCase())
      }

      // Build client list from join events
      for (const log of joinLogs) {
        if (!hasClientJoinedArgs(log.args)) continue
        const address = log.args.client.toLowerCase()
        if (leftAddresses.has(address)) {
          continue // Skip clients who have left
        }

        // Check if still active via contract
        const isActive = await wallet.publicClient.readContract({
          address: getCoordinatorAddress(),
          abi: TRAINING_COORDINATOR_ABI,
          functionName: 'isClient',
          args: [runId, log.args.client],
        })

        if (isActive && !activeClients.has(address)) {
          activeClients.add(address)

          const block = await wallet.publicClient.getBlock({
            blockHash: log.blockHash,
          })

          clients.push({
            clientAddress: log.args.client,
            nodeId: log.args.nodeId ?? ('0x' as `0x${string}`),
            joinedAt: block.timestamp,
            lastActive: block.timestamp, // Would need separate tracking
            isActive: true,
            contribution: 0n, // Would need separate tracking
          })
        }
      }

      return clients
    },

    async getMyClientStatus(runId) {
      // Check if wallet is a client
      const isActive = await wallet.publicClient.readContract({
        address: getCoordinatorAddress(),
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'isClient',
        args: [runId, wallet.address],
      })

      if (!isActive) {
        return null
      }

      // Query when we joined
      const joinLogs = await wallet.publicClient.getLogs({
        address: getCoordinatorAddress(),
        event: CLIENT_JOINED_EVENT,
        args: { runId, client: wallet.address },
        fromBlock: 'earliest',
        toBlock: 'latest',
      })

      if (joinLogs.length === 0) {
        return null
      }

      const joinLog = joinLogs[joinLogs.length - 1] // Most recent join
      if (!hasClientJoinedArgs(joinLog.args)) {
        return null
      }

      const block = await wallet.publicClient.getBlock({
        blockHash: joinLog.blockHash,
      })

      return {
        clientAddress: wallet.address,
        nodeId: joinLog.args.nodeId ?? ('0x' as `0x${string}`),
        joinedAt: block.timestamp,
        lastActive: block.timestamp,
        isActive: true,
        contribution: 0n,
      }
    },

    async isClientActive(runId, client) {
      return wallet.publicClient.readContract({
        address: getCoordinatorAddress(),
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'isClient',
        args: [runId, client ?? wallet.address],
      })
    },

    async submitTrainingStep(runId, stepData) {
      const data = encodeFunctionData({
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'submitTrainingStep',
        args: [runId, stepData],
      })
      return wallet.sendTransaction({ to: getCoordinatorAddress(), data })
    },

    async submitWitnessReport(runId, report) {
      const data = encodeFunctionData({
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'submitWitnessReport',
        args: [runId, report],
      })
      return wallet.sendTransaction({ to: getCoordinatorAddress(), data })
    },

    async submitHealthCheck(runId, checkData) {
      const data = encodeFunctionData({
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'submitHealthCheck',
        args: [runId, checkData],
      })
      return wallet.sendTransaction({ to: getCoordinatorAddress(), data })
    },

    async claimRewards(runId) {
      const data = encodeFunctionData({
        abi: TRAINING_REWARDS_ABI,
        functionName: 'claimRewards',
        args: [runId],
      })
      return wallet.sendTransaction({ to: getRewardsAddress(), data })
    },

    async getPendingRewards(runId, client) {
      return wallet.publicClient.readContract({
        address: getRewardsAddress(),
        abi: TRAINING_REWARDS_ABI,
        functionName: 'pendingRewards',
        args: [runId, client ?? wallet.address],
      })
    },

    async getTotalRewards(runId) {
      return wallet.publicClient.readContract({
        address: getRewardsAddress(),
        abi: TRAINING_REWARDS_ABI,
        functionName: 'totalRewards',
        args: [runId],
      })
    },

    async getRunProgress(runId) {
      const result = await wallet.publicClient.readContract({
        address: getCoordinatorAddress(),
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'getProgress',
        args: [runId],
      })

      return {
        epoch: Number(result[0]),
        step: Number(result[1]),
        epochStartDataIndex: result[2],
      }
    },

    async getRunMetrics(runId) {
      const clientCount = await wallet.publicClient.readContract({
        address: getCoordinatorAddress(),
        abi: TRAINING_COORDINATOR_ABI,
        functionName: 'getClientCount',
        args: [runId],
      })

      const progress = await this.getRunProgress(runId)

      return {
        totalEpochs: 0,
        currentEpoch: progress.epoch,
        participantCount: Number(clientCount),
        witnessCount: 0,
        averageContribution: 0n,
      }
    },
  }
}
