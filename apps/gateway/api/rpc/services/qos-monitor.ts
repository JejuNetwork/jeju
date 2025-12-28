/**
 * QoS Monitoring Service
 *
 * Continuously monitors RPC node health and reports metrics to the blockchain.
 * This service validates node claims and provides the data for reputation calculation.
 *
 * Monitoring approach:
 * - Periodic health checks to all registered nodes
 * - Block height verification across nodes
 * - Latency measurement
 * - Error rate tracking
 * - Aggregate and report to MultiChainRPCRegistry
 */

import {
  type Account,
  type Address,
  createWalletClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { jejuMainnet, jejuTestnet } from '../../../lib/chains'
import { JEJU_CHAIN_ID, RPC_URLS } from '../../../lib/config/networks'

// Contract ABI fragments for MultiChainRPCRegistry
const MULTI_CHAIN_RPC_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getSupportedChains',
    inputs: [],
    outputs: [{ name: '', type: 'uint64[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getProvidersForChain',
    inputs: [{ name: 'chainId', type: 'uint64' }],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getChainEndpoint',
    inputs: [
      { name: 'node', type: 'address' },
      { name: 'chainId', type: 'uint64' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'chainId', type: 'uint64' },
          { name: 'endpoint', type: 'string' },
          { name: 'isActive', type: 'bool' },
          { name: 'isArchive', type: 'bool' },
          { name: 'isWebSocket', type: 'bool' },
          { name: 'blockHeight', type: 'uint64' },
          { name: 'lastUpdated', type: 'uint64' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'reportPerformance',
    inputs: [
      { name: 'node', type: 'address' },
      { name: 'uptimeScore', type: 'uint256' },
      { name: 'successRate', type: 'uint256' },
      { name: 'avgLatencyMs', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

// Get Jeju RPC URL
const JEJU_RPC_URL = RPC_URLS[JEJU_CHAIN_ID as keyof typeof RPC_URLS]
const CHAIN = JEJU_CHAIN_ID === 420691 ? jejuMainnet : jejuTestnet

// Types for QoS monitoring
interface QoSCheckResult {
  node: Address
  timestamp: number
  isReachable: boolean
  latencyMs?: number
  blockHeight?: number
  errorMessage?: string
  chainId?: number
}

interface AggregatedQoS {
  node: Address
  periodStart: number
  periodEnd: number
  checksPerformed: number
  checksSuccessful: number
  avgLatencyMs: number
  minLatencyMs: number
  maxLatencyMs: number
  uptimePercentage: number
}

interface ChainEndpoint {
  chainId: bigint
  endpoint: string
  isActive: boolean
  isArchive: boolean
  isWebSocket: boolean
  blockHeight: bigint
  lastUpdated: bigint
}

interface NodeCheckStats {
  checks: QoSCheckResult[]
  totalChecks: number
  successfulChecks: number
  totalLatency: number
  minLatency: number
  maxLatency: number
}

interface MonitorConfig {
  checkIntervalMs: number
  reportIntervalMs: number
  checkTimeoutMs: number
  minChecksForReport: number
}

export class QoSMonitorService {
  private registryAddress: Address
  private walletClient: ReturnType<typeof createWalletClient> | null
  private walletAccount: Account | null
  private walletAddress: Address | null
  private config: MonitorConfig
  private running = false
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private reportInterval: ReturnType<typeof setInterval> | null = null

  // Stats per node per chain
  private nodeStats = new Map<string, NodeCheckStats>()

  constructor(
    registryAddress: Address,
    config?: Partial<MonitorConfig>,
    privateKey?: string,
  ) {
    this.registryAddress = registryAddress

    // Initialize wallet client for reporting if private key provided
    if (privateKey) {
      const account = privateKeyToAccount(privateKey as `0x${string}`)
      this.walletAccount = account
      this.walletAddress = account.address
      this.walletClient = createWalletClient({
        account,
        chain: CHAIN,
        transport: http(JEJU_RPC_URL),
      })
    } else {
      this.walletClient = null
      this.walletAccount = null
      this.walletAddress = null
    }

    this.config = {
      checkIntervalMs: config?.checkIntervalMs ?? 60_000, // Check every minute
      reportIntervalMs: config?.reportIntervalMs ?? 300_000, // Report every 5 minutes
      checkTimeoutMs: config?.checkTimeoutMs ?? 10_000, // 10 second timeout
      minChecksForReport: config?.minChecksForReport ?? 3,
    }
  }

  /**
   * Start the monitoring service
   */
  async start(): Promise<void> {
    if (this.running) {
      console.warn('[QoS] Already running')
      return
    }

    this.running = true
    console.log('[QoS] Starting monitoring service')
    console.log(`[QoS] Registry: ${this.registryAddress}`)
    console.log(`[QoS] Reporter: ${this.walletAddress ?? 'read-only mode'}`)

    // Initial check
    await this.runChecks()

    // Schedule periodic checks
    this.checkInterval = setInterval(
      () => this.runChecks(),
      this.config.checkIntervalMs,
    )

    // Schedule periodic reports
    this.reportInterval = setInterval(
      () => this.reportAll(),
      this.config.reportIntervalMs,
    )
  }

  /**
   * Stop the monitoring service
   */
  stop(): void {
    this.running = false
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
    if (this.reportInterval) {
      clearInterval(this.reportInterval)
      this.reportInterval = null
    }
    console.log('[QoS] Stopped monitoring service')
  }

  /**
   * Run health checks on all nodes
   */
  async runChecks(): Promise<void> {
    if (!this.running) return

    console.log('[QoS] Running health checks...')

    // Get all supported chains
    const chains = await this.getSupportedChains()

    // Check nodes for each chain in parallel
    await Promise.all(
      chains.map((chainId) => this.checkChainNodes(Number(chainId))),
    )

    console.log(`[QoS] Completed checks for ${chains.length} chains`)
  }

  /**
   * Get supported chains from contract with proper decoding
   */
  private async getSupportedChains(): Promise<bigint[]> {
    const callData = encodeFunctionData({
      abi: MULTI_CHAIN_RPC_REGISTRY_ABI,
      functionName: 'getSupportedChains',
    })

    const response = await fetch(JEJU_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: this.registryAddress, data: callData }, 'latest'],
        id: 1,
      }),
    })

    const result = (await response.json()) as {
      result?: string
      error?: { message: string }
    }

    if (result.error || !result.result || result.result === '0x') {
      console.warn('[QoS] Failed to get supported chains, using defaults')
      // Return default chains if contract call fails
      return [BigInt(1), BigInt(10), BigInt(137), BigInt(42161), BigInt(8453)]
    }

    const decoded = decodeFunctionResult({
      abi: MULTI_CHAIN_RPC_REGISTRY_ABI,
      functionName: 'getSupportedChains',
      data: result.result as `0x${string}`,
    }) as bigint[]

    return decoded.length > 0
      ? decoded
      : [BigInt(1), BigInt(10), BigInt(137), BigInt(42161), BigInt(8453)]
  }

  /**
   * Check all nodes for a specific chain
   */
  private async checkChainNodes(chainId: number): Promise<void> {
    const providers = await this.getProvidersForChain(chainId)
    await Promise.all(providers.map((node) => this.checkNode(node, chainId)))
  }

  /**
   * Get providers for a chain with proper decoding
   */
  private async getProvidersForChain(chainId: number): Promise<Address[]> {
    const callData = encodeFunctionData({
      abi: MULTI_CHAIN_RPC_REGISTRY_ABI,
      functionName: 'getProvidersForChain',
      args: [BigInt(chainId)],
    })

    const response = await fetch(JEJU_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: this.registryAddress, data: callData }, 'latest'],
        id: 1,
      }),
    })

    const result = (await response.json()) as {
      result?: string
      error?: { message: string }
    }

    if (result.error || !result.result || result.result === '0x') {
      return []
    }

    const decoded = decodeFunctionResult({
      abi: MULTI_CHAIN_RPC_REGISTRY_ABI,
      functionName: 'getProvidersForChain',
      data: result.result as `0x${string}`,
    }) as Address[]

    return decoded
  }

  /**
   * Check a single node's health
   */
  async checkNode(node: Address, chainId: number): Promise<QoSCheckResult> {
    const result: QoSCheckResult = {
      node,
      timestamp: Date.now(),
      isReachable: false,
      chainId,
    }

    // Get endpoint from contract
    const endpoint = await this.getChainEndpoint(node, chainId)

    if (!endpoint || !endpoint.isActive || !endpoint.endpoint) {
      result.errorMessage = 'Endpoint not active'
      this.recordCheck(node, chainId, result)
      return result
    }

    // Health check: call eth_blockNumber
    const startTime = Date.now()

    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.checkTimeoutMs,
    )

    try {
      const response = await fetch(endpoint.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        result.errorMessage = `HTTP ${response.status}`
        this.recordCheck(node, chainId, result)
        return result
      }

      const data = (await response.json()) as {
        result?: string
        error?: { message: string }
      }

      if (data.error) {
        result.errorMessage = data.error.message
        this.recordCheck(node, chainId, result)
        return result
      }

      result.isReachable = true
      result.latencyMs = Date.now() - startTime
      result.blockHeight = data.result ? parseInt(data.result, 16) : undefined
    } catch (error) {
      clearTimeout(timeoutId)
      result.errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
    }

    this.recordCheck(node, chainId, result)
    return result
  }

  /**
   * Get chain endpoint for a node with proper decoding
   */
  private async getChainEndpoint(
    node: Address,
    chainId: number,
  ): Promise<ChainEndpoint | null> {
    const callData = encodeFunctionData({
      abi: MULTI_CHAIN_RPC_REGISTRY_ABI,
      functionName: 'getChainEndpoint',
      args: [node, BigInt(chainId)],
    })

    const response = await fetch(JEJU_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: this.registryAddress, data: callData }, 'latest'],
        id: 1,
      }),
    })

    const result = (await response.json()) as {
      result?: string
      error?: { message: string }
    }

    if (result.error || !result.result || result.result === '0x') {
      return null
    }

    const decoded = decodeFunctionResult({
      abi: MULTI_CHAIN_RPC_REGISTRY_ABI,
      functionName: 'getChainEndpoint',
      data: result.result as `0x${string}`,
    }) as ChainEndpoint

    return decoded
  }

  /**
   * Record a check result
   */
  private recordCheck(
    node: Address,
    chainId: number,
    result: QoSCheckResult,
  ): void {
    const key = `${node.toLowerCase()}-${chainId}`
    let stats = this.nodeStats.get(key)

    if (!stats) {
      stats = {
        checks: [],
        totalChecks: 0,
        successfulChecks: 0,
        totalLatency: 0,
        minLatency: Infinity,
        maxLatency: 0,
      }
      this.nodeStats.set(key, stats)
    }

    stats.checks.push(result)
    stats.totalChecks++

    if (result.isReachable) {
      stats.successfulChecks++
      if (result.latencyMs !== undefined) {
        stats.totalLatency += result.latencyMs
        stats.minLatency = Math.min(stats.minLatency, result.latencyMs)
        stats.maxLatency = Math.max(stats.maxLatency, result.latencyMs)
      }
    }

    // Keep only last 100 checks
    if (stats.checks.length > 100) {
      const removed = stats.checks.shift()
      if (removed) {
        stats.totalChecks--
        if (removed.isReachable) {
          stats.successfulChecks--
          if (removed.latencyMs !== undefined) {
            stats.totalLatency -= removed.latencyMs
          }
        }
      }
    }
  }

  /**
   * Get aggregated QoS for a node
   */
  getAggregatedQoS(node: Address, chainId: number): AggregatedQoS | null {
    const key = `${node.toLowerCase()}-${chainId}`
    const stats = this.nodeStats.get(key)

    if (!stats || stats.totalChecks === 0) return null

    const firstCheck = stats.checks[0]
    const lastCheck = stats.checks[stats.checks.length - 1]

    return {
      node,
      periodStart: firstCheck?.timestamp ?? 0,
      periodEnd: lastCheck?.timestamp ?? 0,
      checksPerformed: stats.totalChecks,
      checksSuccessful: stats.successfulChecks,
      avgLatencyMs:
        stats.successfulChecks > 0
          ? stats.totalLatency / stats.successfulChecks
          : 0,
      minLatencyMs: stats.minLatency === Infinity ? 0 : stats.minLatency,
      maxLatencyMs: stats.maxLatency,
      uptimePercentage: (stats.successfulChecks / stats.totalChecks) * 100,
    }
  }

  /**
   * Report all aggregated metrics to the contract
   */
  async reportAll(): Promise<void> {
    if (!this.walletClient || !this.walletAddress || !this.walletAccount) {
      console.warn('[QoS] No wallet configured, skipping report')
      return
    }
    const walletAccount = this.walletAccount

    console.log('[QoS] Reporting metrics to contract...')

    const reports: Array<{
      node: Address
      chainId: number
      uptime: number
      successRate: number
      latency: number
    }> = []

    // Collect all reports
    for (const [key, stats] of Array.from(this.nodeStats.entries())) {
      if (stats.totalChecks < this.config.minChecksForReport) continue

      const [node, chainIdStr] = key.split('-')
      const chainId = parseInt(chainIdStr, 10)

      const uptimeScore = Math.round(
        (stats.successfulChecks / stats.totalChecks) * 10000,
      )
      const successRate = uptimeScore
      const avgLatency = Math.round(
        stats.successfulChecks > 0
          ? stats.totalLatency / stats.successfulChecks
          : 9999,
      )

      reports.push({
        node: node as Address,
        chainId,
        uptime: uptimeScore,
        successRate,
        latency: avgLatency,
      })
    }

    // Group by node (report best performance across chains)
    const nodeReports = new Map<
      Address,
      { uptime: number; successRate: number; latency: number }
    >()

    for (const report of reports) {
      const existing = nodeReports.get(report.node)
      if (
        !existing ||
        report.uptime > existing.uptime ||
        (report.uptime === existing.uptime && report.latency < existing.latency)
      ) {
        nodeReports.set(report.node, {
          uptime: report.uptime,
          successRate: report.successRate,
          latency: report.latency,
        })
      }
    }

    // Submit reports via transactions
    for (const [node, metrics] of Array.from(nodeReports.entries())) {
      try {
        const callData = encodeFunctionData({
          abi: MULTI_CHAIN_RPC_REGISTRY_ABI,
          functionName: 'reportPerformance',
          args: [
            node,
            BigInt(metrics.uptime),
            BigInt(metrics.successRate),
            BigInt(metrics.latency),
          ],
        })

        const hash = await this.walletClient.sendTransaction({
          account: walletAccount,
          chain: CHAIN,
          to: this.registryAddress,
          data: callData,
        })

        console.log(
          `[QoS] Reported ${node}: uptime=${metrics.uptime}, latency=${metrics.latency}, tx=${hash}`,
        )
      } catch (error) {
        console.error(`[QoS] Failed to report ${node}:`, error)
      }
    }

    // Clear old stats after reporting
    this.nodeStats.clear()
  }

  /**
   * Get current stats summary
   */
  getStatsSummary(): {
    nodesTracked: number
    totalChecks: number
    avgUptime: number
  } {
    let totalNodes = 0
    let totalChecks = 0
    let totalUptime = 0

    for (const stats of Array.from(this.nodeStats.values())) {
      totalNodes++
      totalChecks += stats.totalChecks
      if (stats.totalChecks > 0) {
        totalUptime += stats.successfulChecks / stats.totalChecks
      }
    }

    return {
      nodesTracked: totalNodes,
      totalChecks,
      avgUptime: totalNodes > 0 ? (totalUptime / totalNodes) * 100 : 0,
    }
  }
}

// Singleton
let monitorInstance: QoSMonitorService | null = null

export function getQoSMonitor(): QoSMonitorService | null {
  return monitorInstance
}

export function initQoSMonitor(
  registryAddress: Address,
  config?: Partial<MonitorConfig>,
  privateKey?: string,
): QoSMonitorService {
  monitorInstance = new QoSMonitorService(registryAddress, config, privateKey)
  return monitorInstance
}
