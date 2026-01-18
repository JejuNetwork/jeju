/**
 * Sequencer Module - L2 Sequencer Management
 *
 * Provides access to:
 * - Sequencer registration
 * - Block production
 * - Forced inclusion
 * - Sequencer rotation
 */

import type { NetworkType } from '@jejunetwork/types'
import { type Address, encodeFunctionData, type Hex, parseEther } from 'viem'
import { safeGetContract } from '../config'
import { parseIdFromLogs } from '../shared/api'
import type { BaseWallet } from '../wallet'

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const SequencerStatus = {
  INACTIVE: 0,
  ACTIVE: 1,
  JAILED: 2,
  EXITING: 3,
} as const
export type SequencerStatus =
  (typeof SequencerStatus)[keyof typeof SequencerStatus]

export interface Sequencer {
  sequencerAddress: Address
  operator: Address
  stake: bigint
  status: SequencerStatus
  blocksProduced: bigint
  lastBlockTime: bigint
  registeredAt: bigint
  jailedUntil: bigint
  slashCount: number
}

export interface SequencerMetrics {
  totalBlocks: bigint
  missedBlocks: bigint
  uptime: number
  averageBlockTime: bigint
  latestBlock: bigint
}

export interface ForcedInclusionRequest {
  requestId: Hex
  sender: Address
  target: Address
  data: Hex
  value: bigint
  gasLimit: bigint
  createdAt: bigint
  deadline: bigint
  executed: boolean
}

export interface RegisterSequencerParams {
  stake: bigint
  endpoint?: string
  metadata?: string
}

export interface ForcedInclusionParams {
  target: Address
  data: Hex
  value?: bigint
  gasLimit?: bigint
}

/** Raw sequencer data from contract read */
interface RawSequencerData {
  sequencerAddress: Address
  operator: Address
  stake: bigint
  status: number
  blocksProduced: bigint
  lastBlockTime: bigint
  registeredAt: bigint
  jailedUntil: bigint
  slashCount: bigint
}

/** Parse raw contract data into typed Sequencer */
function parseSequencerData(raw: RawSequencerData): Sequencer | null {
  if (raw.sequencerAddress === '0x0000000000000000000000000000000000000000') {
    return null
  }
  return {
    sequencerAddress: raw.sequencerAddress,
    operator: raw.operator,
    stake: raw.stake,
    status: raw.status as SequencerStatus,
    blocksProduced: raw.blocksProduced,
    lastBlockTime: raw.lastBlockTime,
    registeredAt: raw.registeredAt,
    jailedUntil: raw.jailedUntil,
    slashCount: Number(raw.slashCount),
  }
}

export interface SequencerModule {
  // Sequencer Registration
  registerSequencer(params: RegisterSequencerParams): Promise<Hex>
  exitSequencer(): Promise<Hex>
  addStake(amount: bigint): Promise<Hex>
  withdrawStake(amount: bigint): Promise<Hex>

  // Sequencer Info
  getSequencer(address?: Address): Promise<Sequencer | null>
  getActiveSequencers(): Promise<Sequencer[]>
  getAllSequencers(): Promise<Sequencer[]>
  getCurrentSequencer(): Promise<Address>
  getNextSequencer(): Promise<Address>

  // Metrics
  getSequencerMetrics(address?: Address): Promise<SequencerMetrics>
  getNetworkMetrics(): Promise<{
    totalSequencers: number
    activeSequencers: number
    totalStaked: bigint
    blocksPerDay: bigint
  }>

  // Forced Inclusion
  requestForcedInclusion(
    params: ForcedInclusionParams,
  ): Promise<{ txHash: Hex; requestId: Hex }>
  getForcedInclusionRequest(
    requestId: Hex,
  ): Promise<ForcedInclusionRequest | null>
  getMyForcedInclusionRequests(): Promise<ForcedInclusionRequest[]>
  executeForcedInclusion(requestId: Hex): Promise<Hex>

  // Rotation
  getRotationSchedule(): Promise<
    { sequencer: Address; startBlock: bigint; endBlock: bigint }[]
  >
  getSlotDuration(): Promise<bigint>

  // Slashing
  reportMissedBlock(sequencer: Address, blockNumber: bigint): Promise<Hex>
  getSlashingHistory(
    sequencer: Address,
  ): Promise<{ blockNumber: bigint; amount: bigint; reason: string }[]>

  // Constants
  readonly MIN_SEQUENCER_STAKE: bigint
  readonly SLOT_DURATION: bigint
  readonly FORCED_INCLUSION_DELAY: bigint
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const SEQUENCER_REGISTRY_ABI = [
  {
    name: 'registerSequencer',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'endpoint', type: 'string' },
      { name: 'metadata', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'exitSequencer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'addStake',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'withdrawStake',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getSequencer',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'sequencerAddress', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'sequencerAddress', type: 'address' },
          { name: 'operator', type: 'address' },
          { name: 'stake', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'blocksProduced', type: 'uint256' },
          { name: 'lastBlockTime', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'jailedUntil', type: 'uint256' },
          { name: 'slashCount', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getActiveSequencers',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'getAllSequencers',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'getCurrentSequencer',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'getNextSequencer',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'minStake',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'slotDuration',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

const FORCED_INCLUSION_ABI = [
  {
    name: 'requestForcedInclusion',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'gasLimit', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'executeForcedInclusion',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'requestId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getRequest',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'requestId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'requestId', type: 'bytes32' },
          { name: 'sender', type: 'address' },
          { name: 'target', type: 'address' },
          { name: 'data', type: 'bytes' },
          { name: 'value', type: 'uint256' },
          { name: 'gasLimit', type: 'uint256' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'executed', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'getRequestsBySender',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'sender', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'forcedInclusionDelay',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

const SLASHING_ABI = [
  {
    name: 'reportMissedBlock',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'sequencer', type: 'address' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'proof', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'getSlashingHistory',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'sequencer', type: 'address' }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'blockNumber', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
          { name: 'reason', type: 'string' },
          { name: 'timestamp', type: 'uint256' },
        ],
      },
    ],
  },
] as const

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createSequencerModule(
  wallet: BaseWallet,
  network: NetworkType,
): SequencerModule {
  // Use safe getters - contracts may not be deployed on all networks
  const sequencerRegistryAddressOpt = safeGetContract(
    'sequencer',
    'SequencerRegistry',
    network,
  )
  const forcedInclusionAddressOpt = safeGetContract(
    'sequencer',
    'ForcedInclusion',
    network,
  )
  const slashingAddressOpt = safeGetContract(
    'sequencer',
    'SlashingContract',
    network,
  )

  // Lazy-load contract addresses - throw on method call if not deployed
  const getSequencerRegistryAddress = () => {
    if (!sequencerRegistryAddressOpt) {
      throw new Error(
        'Sequencer SequencerRegistry contract not deployed on this network',
      )
    }
    return sequencerRegistryAddressOpt
  }

  const getForcedInclusionAddress = () => {
    if (!forcedInclusionAddressOpt) {
      throw new Error(
        'Sequencer ForcedInclusion contract not deployed on this network',
      )
    }
    return forcedInclusionAddressOpt
  }

  const getSlashingAddress = () => {
    if (!slashingAddressOpt) {
      throw new Error('Sequencer SlashingContract not deployed on this network')
    }
    return slashingAddressOpt
  }

  const MIN_SEQUENCER_STAKE = parseEther('1')
  const SLOT_DURATION = 12n // 12 seconds
  const FORCED_INCLUSION_DELAY = 86400n // 24 hours

  return {
    MIN_SEQUENCER_STAKE,
    SLOT_DURATION,
    FORCED_INCLUSION_DELAY,

    async registerSequencer(params) {
      const data = encodeFunctionData({
        abi: SEQUENCER_REGISTRY_ABI,
        functionName: 'registerSequencer',
        args: [params.endpoint ?? '', params.metadata ?? ''],
      })

      return wallet.sendTransaction({
        to: getSequencerRegistryAddress(),
        data,
        value: params.stake,
      })
    },

    async exitSequencer() {
      const data = encodeFunctionData({
        abi: SEQUENCER_REGISTRY_ABI,
        functionName: 'exitSequencer',
      })

      return wallet.sendTransaction({
        to: getSequencerRegistryAddress(),
        data,
      })
    },

    async addStake(amount) {
      const data = encodeFunctionData({
        abi: SEQUENCER_REGISTRY_ABI,
        functionName: 'addStake',
      })

      return wallet.sendTransaction({
        to: getSequencerRegistryAddress(),
        data,
        value: amount,
      })
    },

    async withdrawStake(amount) {
      const data = encodeFunctionData({
        abi: SEQUENCER_REGISTRY_ABI,
        functionName: 'withdrawStake',
        args: [amount],
      })

      return wallet.sendTransaction({
        to: getSequencerRegistryAddress(),
        data,
      })
    },

    async getSequencer(address) {
      const addr = address ?? wallet.address

      const result = await wallet.publicClient.readContract({
        address: getSequencerRegistryAddress(),
        abi: SEQUENCER_REGISTRY_ABI,
        functionName: 'getSequencer',
        args: [addr],
      })

      return parseSequencerData(result as RawSequencerData)
    },

    async getActiveSequencers() {
      const addresses = await wallet.publicClient.readContract({
        address: getSequencerRegistryAddress(),
        abi: SEQUENCER_REGISTRY_ABI,
        functionName: 'getActiveSequencers',
      })

      const sequencers: Sequencer[] = []
      for (const addr of addresses) {
        const seq = await this.getSequencer(addr)
        if (seq) sequencers.push(seq)
      }
      return sequencers
    },

    async getAllSequencers() {
      const addresses = await wallet.publicClient.readContract({
        address: getSequencerRegistryAddress(),
        abi: SEQUENCER_REGISTRY_ABI,
        functionName: 'getAllSequencers',
      })

      const sequencers: Sequencer[] = []
      for (const addr of addresses) {
        const seq = await this.getSequencer(addr)
        if (seq) sequencers.push(seq)
      }
      return sequencers
    },

    async getCurrentSequencer() {
      return (await wallet.publicClient.readContract({
        address: getSequencerRegistryAddress(),
        abi: SEQUENCER_REGISTRY_ABI,
        functionName: 'getCurrentSequencer',
      })) as Address
    },

    async getNextSequencer() {
      return (await wallet.publicClient.readContract({
        address: getSequencerRegistryAddress(),
        abi: SEQUENCER_REGISTRY_ABI,
        functionName: 'getNextSequencer',
      })) as Address
    },

    async getSequencerMetrics(address) {
      const seq = await this.getSequencer(address ?? wallet.address)
      if (!seq) {
        return {
          totalBlocks: 0n,
          missedBlocks: 0n,
          uptime: 0,
          averageBlockTime: 0n,
          latestBlock: 0n,
        }
      }

      // Get slashing history to count missed blocks
      const slashingHistory = await this.getSlashingHistory(
        seq.sequencerAddress,
      )
      const missedBlocks = BigInt(
        slashingHistory.filter((s) => s.reason.includes('missed')).length,
      )

      // Calculate uptime based on blocks produced vs expected
      const now = BigInt(Math.floor(Date.now() / 1000))
      const activeDuration = now - seq.registeredAt
      const expectedBlocks = activeDuration / SLOT_DURATION
      const uptime =
        expectedBlocks > 0n
          ? Math.min(100, Number((seq.blocksProduced * 100n) / expectedBlocks))
          : 100

      return {
        totalBlocks: seq.blocksProduced,
        missedBlocks,
        uptime,
        averageBlockTime: SLOT_DURATION,
        latestBlock: seq.lastBlockTime,
      }
    },

    async getNetworkMetrics() {
      const all = await this.getAllSequencers()
      const active = all.filter((s) => s.status === SequencerStatus.ACTIVE)
      const totalStaked = all.reduce((sum, s) => sum + s.stake, 0n)

      return {
        totalSequencers: all.length,
        activeSequencers: active.length,
        totalStaked,
        blocksPerDay: (86400n / SLOT_DURATION) * BigInt(active.length),
      }
    },

    async requestForcedInclusion(params) {
      const data = encodeFunctionData({
        abi: FORCED_INCLUSION_ABI,
        functionName: 'requestForcedInclusion',
        args: [params.target, params.data, params.gasLimit ?? 100000n],
      })

      const txHash = await wallet.sendTransaction({
        to: getForcedInclusionAddress(),
        data,
        value: params.value ?? 0n,
      })

      // Parse requestId from ForcedInclusionRequested event
      const requestId = await parseIdFromLogs(
        wallet.publicClient,
        txHash,
        'ForcedInclusionRequested(bytes32,address,address,uint256)',
        'requestId',
      )

      return { txHash, requestId }
    },

    async getForcedInclusionRequest(requestId) {
      const result = await wallet.publicClient.readContract({
        address: getForcedInclusionAddress(),
        abi: FORCED_INCLUSION_ABI,
        functionName: 'getRequest',
        args: [requestId],
      })

      const req = result as ForcedInclusionRequest
      if (req.sender === '0x0000000000000000000000000000000000000000') {
        return null
      }
      return req
    },

    async getMyForcedInclusionRequests() {
      const requestIds = await wallet.publicClient.readContract({
        address: getForcedInclusionAddress(),
        abi: FORCED_INCLUSION_ABI,
        functionName: 'getRequestsBySender',
        args: [wallet.address],
      })

      const requests: ForcedInclusionRequest[] = []
      for (const id of requestIds) {
        const req = await this.getForcedInclusionRequest(id)
        if (req) requests.push(req)
      }
      return requests
    },

    async executeForcedInclusion(requestId) {
      const data = encodeFunctionData({
        abi: FORCED_INCLUSION_ABI,
        functionName: 'executeForcedInclusion',
        args: [requestId],
      })

      return wallet.sendTransaction({
        to: getForcedInclusionAddress(),
        data,
      })
    },

    async getRotationSchedule() {
      const active = await this.getActiveSequencers()
      const currentBlock = await wallet.publicClient.getBlockNumber()
      const slotsPerSequencer = 100n // Example

      return active.map((seq, i) => ({
        sequencer: seq.sequencerAddress,
        startBlock: currentBlock + BigInt(i) * slotsPerSequencer,
        endBlock: currentBlock + BigInt(i + 1) * slotsPerSequencer - 1n,
      }))
    },

    async getSlotDuration() {
      return wallet.publicClient.readContract({
        address: getSequencerRegistryAddress(),
        abi: SEQUENCER_REGISTRY_ABI,
        functionName: 'slotDuration',
      })
    },

    async reportMissedBlock(sequencer, blockNumber) {
      // This requires the caller to be an authorized reporter
      // Proof would be generated from the L1 chain to prove the block was missed
      const data = encodeFunctionData({
        abi: SLASHING_ABI,
        functionName: 'reportMissedBlock',
        args: [sequencer, blockNumber, '0x' as Hex], // Proof would be required in production
      })

      return wallet.sendTransaction({
        to: getSlashingAddress(),
        data,
      })
    },

    async getSlashingHistory(sequencer) {
      const result = await wallet.publicClient.readContract({
        address: getSlashingAddress(),
        abi: SLASHING_ABI,
        functionName: 'getSlashingHistory',
        args: [sequencer],
      })

      return result.map((entry) => ({
        blockNumber: entry.blockNumber,
        amount: entry.amount,
        reason: entry.reason,
      }))
    },
  }
}
