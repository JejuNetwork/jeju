import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
} from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import { mainnet, optimism, optimismSepolia } from 'viem/chains'
import type { BandwidthStatus } from '../types'

const BANDWIDTH_REWARDS_ABI = [
  {
    type: 'function',
    name: 'registerNode',
    inputs: [
      { name: 'nodeType', type: 'uint8' },
      { name: 'region', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'payable',
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
    name: 'getNode',
    inputs: [{ name: 'node', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'operator', type: 'address' },
          { name: 'stake', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'agentId', type: 'uint256' },
          { name: 'nodeType', type: 'uint8' },
          { name: 'region', type: 'string' },
          { name: 'isActive', type: 'bool' },
          { name: 'isFrozen', type: 'bool' },
          { name: 'totalBytesShared', type: 'uint256' },
          { name: 'totalSessions', type: 'uint256' },
          { name: 'totalEarnings', type: 'uint256' },
          { name: 'lastClaimTime', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nodePerformance',
    inputs: [{ name: 'node', type: 'address' }],
    outputs: [
      { name: 'uptimeScore', type: 'uint256' },
      { name: 'successRate', type: 'uint256' },
      { name: 'avgLatencyMs', type: 'uint256' },
      { name: 'avgBandwidthMbps', type: 'uint256' },
      { name: 'lastUpdated', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPendingReward',
    inputs: [{ name: 'node', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'bytesContributed', type: 'uint256' },
          { name: 'sessionsHandled', type: 'uint256' },
          { name: 'periodStart', type: 'uint256' },
          { name: 'periodEnd', type: 'uint256' },
          { name: 'calculatedReward', type: 'uint256' },
          { name: 'claimed', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

const NODE_TYPES = { unknown: 0, datacenter: 1, residential: 2, mobile: 3 } as const
type NodeTypeKey = keyof typeof NODE_TYPES

interface NodeData {
  operator: Address
  stake: bigint
  registeredAt: bigint
  agentId: bigint
  nodeType: number
  region: string
  isActive: boolean
  isFrozen: boolean
  totalBytesShared: bigint
  totalSessions: bigint
  totalEarnings: bigint
  lastClaimTime: bigint
}

interface PerformanceData {
  uptimeScore: bigint
  successRate: bigint
  avgLatencyMs: bigint
  avgBandwidthMbps: bigint
  lastUpdated: bigint
}

interface PendingRewardData {
  bytesContributed: bigint
  sessionsHandled: bigint
  periodStart: bigint
  periodEnd: bigint
  calculatedReward: bigint
  claimed: boolean
}

export class BandwidthContractService {
  private contractAddress: Address
  private publicClient: ReturnType<typeof createPublicClient>
  private chain: Chain
  private rpcUrl: string

  constructor(contractAddress: Address, rpcUrl: string, chainId: number) {
    this.contractAddress = contractAddress
    this.rpcUrl = rpcUrl
    this.chain = chainId === 1 ? mainnet : chainId === 10 ? optimism : optimismSepolia
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(rpcUrl),
    })
  }

  async getNodeStatus(nodeAddress: Address): Promise<BandwidthStatus> {
    const [nodeData, performanceData, pendingReward] = await Promise.all([
      this.readNode(nodeAddress),
      this.readPerformance(nodeAddress),
      this.readPendingReward(nodeAddress),
    ])

    if (!nodeData || nodeData.registeredAt === 0n) {
      return {
        is_registered: false,
        is_active: false,
        stake_amount: '0',
        total_bytes_shared: '0',
        total_sessions: 0,
        total_earnings: '0',
        pending_rewards: '0',
        current_connections: 0,
        uptime_score: 0,
        success_rate: 0,
        coordinator_connected: false,
      }
    }

    return {
      is_registered: true,
      is_active: nodeData.isActive && !nodeData.isFrozen,
      node_address: nodeAddress,
      stake_amount: nodeData.stake.toString(),
      total_bytes_shared: nodeData.totalBytesShared.toString(),
      total_sessions: Number(nodeData.totalSessions),
      total_earnings: nodeData.totalEarnings.toString(),
      pending_rewards: pendingReward?.calculatedReward.toString() ?? '0',
      current_connections: 0,
      uptime_score: Number(performanceData?.uptimeScore ?? 0n),
      success_rate: Number(performanceData?.successRate ?? 0n),
      coordinator_connected: nodeData.isActive,
    }
  }

  async registerNode(
    account: PrivateKeyAccount,
    nodeType: string,
    region: string,
    stakeAmount: string,
  ): Promise<`0x${string}`> {
    const walletClient = createWalletClient({
      account,
      chain: this.chain,
      transport: http(this.rpcUrl),
    })

    return walletClient.writeContract({
      address: this.contractAddress,
      abi: BANDWIDTH_REWARDS_ABI,
      functionName: 'registerNode',
      args: [NODE_TYPES[nodeType as NodeTypeKey] ?? 1, region],
      value: parseEther(stakeAmount),
    })
  }

  async claimRewards(account: PrivateKeyAccount): Promise<`0x${string}`> {
    const walletClient = createWalletClient({
      account,
      chain: this.chain,
      transport: http(this.rpcUrl),
    })

    return walletClient.writeContract({
      address: this.contractAddress,
      abi: BANDWIDTH_REWARDS_ABI,
      functionName: 'claimRewards',
      args: [],
    })
  }

  private async readNode(nodeAddress: Address): Promise<NodeData> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BANDWIDTH_REWARDS_ABI,
      functionName: 'getNode',
      args: [nodeAddress],
    })
    return result as unknown as NodeData
  }

  private async readPerformance(nodeAddress: Address): Promise<PerformanceData> {
    const [uptimeScore, successRate, avgLatencyMs, avgBandwidthMbps, lastUpdated] =
      await this.publicClient.readContract({
        address: this.contractAddress,
        abi: BANDWIDTH_REWARDS_ABI,
        functionName: 'nodePerformance',
        args: [nodeAddress],
      })
    return { uptimeScore, successRate, avgLatencyMs, avgBandwidthMbps, lastUpdated }
  }

  private async readPendingReward(nodeAddress: Address): Promise<PendingRewardData> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: BANDWIDTH_REWARDS_ABI,
      functionName: 'getPendingReward',
      args: [nodeAddress],
    })
    return result as unknown as PendingRewardData
  }
}

export function createBandwidthContractService(): BandwidthContractService | null {
  const contractAddress = process.env.BANDWIDTH_REWARDS_CONTRACT as Address | undefined
  const rpcUrl = process.env.JEJU_RPC_URL ?? process.env.RPC_URL
  const chainId = parseInt(process.env.CHAIN_ID ?? '10', 10)

  if (!contractAddress || contractAddress === '0x0000000000000000000000000000000000000000') {
    console.warn('[BandwidthContract] No contract address configured')
    return null
  }

  if (!rpcUrl) {
    console.warn('[BandwidthContract] No RPC URL configured')
    return null
  }

  return new BandwidthContractService(contractAddress, rpcUrl, chainId)
}
