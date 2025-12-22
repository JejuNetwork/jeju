/**
 * VPN Module - Adapter for VPN SDK integration
 *
 * Provides standardized interface for VPN node management
 * compatible with the JejuClient module pattern.
 */

import type { NetworkType } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { encodeFunctionData } from 'viem'
import { getContractAddresses } from './config'
import type { JejuWallet } from './wallet'

// ============================================================================
// Types
// ============================================================================

export enum VPNNodeStatus {
  INACTIVE = 0,
  ACTIVE = 1,
  SUSPENDED = 2,
}

export interface VPNNodeInfo {
  operator: Address
  countryCode: string
  endpoint: string
  stake: bigint
  status: VPNNodeStatus
  registeredAt: number
  lastSeen: number
  totalBytesServed: bigint
  totalSessions: bigint
  successRate: number
}

export interface VPNSession {
  sessionId: Hex
  user: Address
  node: Address
  startedAt: number
  endedAt?: number
  bytesTransferred: bigint
  status: 'active' | 'completed' | 'terminated'
}

export interface VPNStats {
  totalNodes: number
  activeNodes: number
  totalBytesServed: bigint
  totalSessions: number
  availableRegions: string[]
}

export interface VPNPerformance {
  avgLatencyMs: number
  successRate: number
  uptimePercent: number
  totalConnections: number
  avgBandwidthMbps: number
}

export interface RegisterVPNNodeParams {
  countryCode: string
  endpoint: string
  stake: bigint
  capabilities?: string[]
}

// ============================================================================
// VPN Module Interface
// ============================================================================

export interface VPNModule {
  // Node Queries
  getAllNodes(): Promise<VPNNodeInfo[]>
  getActiveNodes(): Promise<VPNNodeInfo[]>
  getNodeInfo(operator: Address): Promise<VPNNodeInfo | null>
  getNodesByRegion(region: string): Promise<VPNNodeInfo[]>
  getAvailableRegions(): Promise<string[]>

  // Session Management
  getActiveSessions(): Promise<VPNSession[]>
  getSessionHistory(): Promise<VPNSession[]>

  // Statistics
  getVPNStats(): Promise<VPNStats>
  getNodePerformance(operator: Address): Promise<VPNPerformance | null>

  // Write Operations
  registerNode(params: RegisterVPNNodeParams): Promise<{ txHash: Hex }>
  updateNode(endpoint: string): Promise<{ txHash: Hex }>
  deactivateNode(): Promise<{ txHash: Hex }>
  withdrawStake(): Promise<{ txHash: Hex }>
}

// ============================================================================
// Contract ABIs
// ============================================================================

const VPN_REGISTRY_ABI = [
  'function getNode(address operator) external view returns (tuple(address operator, bytes2 countryCode, bytes32 regionHash, string endpoint, string wireguardPubKey, uint256 stake, uint256 registeredAt, uint256 lastSeen, bool active, uint256 totalBytesServed, uint256 totalSessions, uint256 successfulSessions))',
  'function getActiveExitNodes() external view returns (address[])',
  'function getNodesByCountry(bytes2 countryCode) external view returns (address[])',
  'function registerNode(bytes2 countryCode, string endpoint, bytes32 wireguardKey) external payable',
  'function updateEndpoint(string endpoint) external',
  'function deactivate() external',
  'function withdraw() external',
  'function totalNodes() external view returns (uint256)',
  'function activeNodeCount() external view returns (uint256)',
] as const

// ============================================================================
// Implementation
// ============================================================================

export function createVPNModule(
  wallet: JejuWallet,
  network: NetworkType,
): VPNModule {
  const contracts = getContractAddresses(network)
  if (!contracts.vpnRegistry) {
    throw new Error(`VPNRegistry contract not deployed on ${network}`)
  }
  const vpnRegistryAddress = contracts.vpnRegistry

  // Node caching
  let nodesCache: VPNNodeInfo[] = []
  let lastFetch = 0
  const CACHE_TTL = 60000 // 1 minute

  async function fetchNodeDetails(
    operator: Address,
  ): Promise<VPNNodeInfo | null> {
    const nodeData = (await wallet.publicClient.readContract({
      address: vpnRegistryAddress,
      abi: VPN_REGISTRY_ABI,
      functionName: 'getNode',
      args: [operator],
    })) as {
      operator: Address
      countryCode: Hex
      regionHash: Hex
      endpoint: string
      wireguardPubKey: string
      stake: bigint
      registeredAt: bigint
      lastSeen: bigint
      active: boolean
      totalBytesServed: bigint
      totalSessions: bigint
      successfulSessions: bigint
    }

    if (!nodeData || nodeData.registeredAt === 0n) return null

    const countryCode = Buffer.from(
      nodeData.countryCode.slice(2),
      'hex',
    ).toString()

    return {
      operator: nodeData.operator,
      countryCode,
      endpoint: nodeData.endpoint,
      stake: nodeData.stake,
      status: nodeData.active ? VPNNodeStatus.ACTIVE : VPNNodeStatus.INACTIVE,
      registeredAt: Number(nodeData.registeredAt),
      lastSeen: Number(nodeData.lastSeen),
      totalBytesServed: nodeData.totalBytesServed,
      totalSessions: nodeData.totalSessions,
      successRate:
        nodeData.totalSessions > 0n
          ? Number(
              (nodeData.successfulSessions * 100n) / nodeData.totalSessions,
            )
          : 100,
    }
  }

  async function refreshNodesCache(): Promise<void> {
    if (Date.now() - lastFetch < CACHE_TTL && nodesCache.length > 0) return

    const activeAddresses = (await wallet.publicClient.readContract({
      address: vpnRegistryAddress,
      abi: VPN_REGISTRY_ABI,
      functionName: 'getActiveExitNodes',
      args: [],
    })) as Address[]

    const nodes: VPNNodeInfo[] = []
    for (const addr of activeAddresses) {
      const node = await fetchNodeDetails(addr)
      if (node) nodes.push(node)
    }

    nodesCache = nodes
    lastFetch = Date.now()
  }

  return {
    async getAllNodes(): Promise<VPNNodeInfo[]> {
      await refreshNodesCache()
      return nodesCache
    },

    async getActiveNodes(): Promise<VPNNodeInfo[]> {
      await refreshNodesCache()
      return nodesCache.filter((n) => n.status === VPNNodeStatus.ACTIVE)
    },

    async getNodeInfo(operator: Address): Promise<VPNNodeInfo | null> {
      return fetchNodeDetails(operator)
    },

    async getNodesByRegion(region: string): Promise<VPNNodeInfo[]> {
      await refreshNodesCache()
      // Region filtering based on country code prefix
      const regionPrefix = region.split('-')[0].toUpperCase()
      return nodesCache.filter((n) => n.countryCode.startsWith(regionPrefix))
    },

    async getAvailableRegions(): Promise<string[]> {
      await refreshNodesCache()
      const regions = new Set(nodesCache.map((n) => n.countryCode))
      return Array.from(regions).sort()
    },

    async getActiveSessions(): Promise<VPNSession[]> {
      // Would need additional contract method or indexer
      return []
    },

    async getSessionHistory(): Promise<VPNSession[]> {
      // Would need indexer integration
      return []
    },

    async getVPNStats(): Promise<VPNStats> {
      await refreshNodesCache()

      const [totalNodes, activeCount] = await Promise.all([
        wallet.publicClient.readContract({
          address: vpnRegistryAddress,
          abi: VPN_REGISTRY_ABI,
          functionName: 'totalNodes',
          args: [],
        }) as Promise<bigint>,
        wallet.publicClient.readContract({
          address: vpnRegistryAddress,
          abi: VPN_REGISTRY_ABI,
          functionName: 'activeNodeCount',
          args: [],
        }) as Promise<bigint>,
      ])

      const totalBytesServed = nodesCache.reduce(
        (sum, n) => sum + n.totalBytesServed,
        0n,
      )
      const totalSessions = nodesCache.reduce(
        (sum, n) => sum + Number(n.totalSessions),
        0,
      )
      const regions = new Set(nodesCache.map((n) => n.countryCode))

      return {
        totalNodes: Number(totalNodes),
        activeNodes: Number(activeCount),
        totalBytesServed,
        totalSessions,
        availableRegions: Array.from(regions).sort(),
      }
    },

    async getNodePerformance(
      operator: Address,
    ): Promise<VPNPerformance | null> {
      const node = await fetchNodeDetails(operator)
      if (!node) return null

      return {
        avgLatencyMs: 0, // Would need ping testing
        successRate: node.successRate,
        uptimePercent: node.status === VPNNodeStatus.ACTIVE ? 99 : 0,
        totalConnections: Number(node.totalSessions),
        avgBandwidthMbps: 100, // Would need additional metrics
      }
    },

    async registerNode(
      params: RegisterVPNNodeParams,
    ): Promise<{ txHash: Hex }> {
      const countryBytes =
        `0x${Buffer.from(params.countryCode).toString('hex').padEnd(4, '0')}` as Hex
      const wireguardKey = `0x${'00'.repeat(32)}` as Hex // Placeholder

      const txHash = await wallet.sendTransaction({
        to: vpnRegistryAddress,
        data: encodeFunctionData({
          abi: VPN_REGISTRY_ABI,
          functionName: 'registerNode',
          args: [countryBytes, params.endpoint, wireguardKey],
        }),
        value: params.stake,
      })

      return { txHash }
    },

    async updateNode(endpoint: string): Promise<{ txHash: Hex }> {
      const txHash = await wallet.sendTransaction({
        to: vpnRegistryAddress,
        data: encodeFunctionData({
          abi: VPN_REGISTRY_ABI,
          functionName: 'updateEndpoint',
          args: [endpoint],
        }),
      })

      return { txHash }
    },

    async deactivateNode(): Promise<{ txHash: Hex }> {
      const txHash = await wallet.sendTransaction({
        to: vpnRegistryAddress,
        data: encodeFunctionData({
          abi: VPN_REGISTRY_ABI,
          functionName: 'deactivate',
          args: [],
        }),
      })

      return { txHash }
    },

    async withdrawStake(): Promise<{ txHash: Hex }> {
      const txHash = await wallet.sendTransaction({
        to: vpnRegistryAddress,
        data: encodeFunctionData({
          abi: VPN_REGISTRY_ABI,
          functionName: 'withdraw',
          args: [],
        }),
      })

      return { txHash }
    },
  }
}
