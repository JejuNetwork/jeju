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

const REGISTRY_ABI = [
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

const JEJU_RPC_URL = RPC_URLS[JEJU_CHAIN_ID as keyof typeof RPC_URLS]
const CHAIN = JEJU_CHAIN_ID === 420691 ? jejuMainnet : jejuTestnet

interface QoSCheckResult {
  node: Address
  timestamp: number
  isReachable: boolean
  latencyMs?: number
  blockHeight?: number
  errorMessage?: string
  chainId?: number
}

interface ChainEndpoint {
  endpoint: string
  isActive: boolean
}

interface NodeStats {
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
  metricsPort?: number
}

interface Metrics {
  checksTotal: number
  checksFailed: number
  reportsSubmitted: number
  reportsFailed: number
  latencySamples: number[]
  nodeUptimeScores: Map<string, number>
  startTime: number
}

async function callRegistry<T>(
  registryAddress: Address,
  functionName:
    | 'getSupportedChains'
    | 'getProvidersForChain'
    | 'getChainEndpoint',
  args: readonly unknown[] = [],
): Promise<T | null> {
  const callData = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName,
    args: args as never,
  })

  const response = await fetch(JEJU_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: registryAddress, data: callData }, 'latest'],
      id: 1,
    }),
  })

  const result = (await response.json()) as {
    result?: string
    error?: { message: string }
  }
  if (result.error || !result.result || result.result === '0x') return null

  return decodeFunctionResult({
    abi: REGISTRY_ABI,
    functionName,
    data: result.result as `0x${string}`,
  }) as T
}

export class QoSMonitorService {
  private registryAddress: Address
  private walletClient: ReturnType<typeof createWalletClient> | null = null
  private walletAccount: Account | null = null
  private walletAddress: Address | null = null
  private config: MonitorConfig
  private running = false
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private reportInterval: ReturnType<typeof setInterval> | null = null
  private nodeStats = new Map<string, NodeStats>()
  private metricsServer: ReturnType<typeof Bun.serve> | null = null
  private metrics: Metrics = {
    checksTotal: 0,
    checksFailed: 0,
    reportsSubmitted: 0,
    reportsFailed: 0,
    latencySamples: [],
    nodeUptimeScores: new Map(),
    startTime: Date.now(),
  }

  constructor(
    registryAddress: Address,
    config?: Partial<MonitorConfig>,
    privateKey?: string,
  ) {
    this.registryAddress = registryAddress

    if (privateKey) {
      const account = privateKeyToAccount(privateKey as `0x${string}`)
      this.walletAccount = account
      this.walletAddress = account.address
      this.walletClient = createWalletClient({
        account,
        chain: CHAIN,
        transport: http(JEJU_RPC_URL),
      })
    }

    this.config = {
      checkIntervalMs: config?.checkIntervalMs ?? 60_000,
      reportIntervalMs: config?.reportIntervalMs ?? 300_000,
      checkTimeoutMs: config?.checkTimeoutMs ?? 10_000,
      minChecksForReport: config?.minChecksForReport ?? 3,
      metricsPort: config?.metricsPort,
    }
  }

  async start(): Promise<void> {
    if (this.running) return

    this.running = true
    this.metrics.startTime = Date.now()
    console.log(
      `[QoS] Starting (registry: ${this.registryAddress}, reporter: ${this.walletAddress ?? 'read-only'})`,
    )

    if (this.config.metricsPort) {
      this.startMetricsServer(this.config.metricsPort)
    }

    await this.runChecks()
    this.checkInterval = setInterval(
      () => this.runChecks(),
      this.config.checkIntervalMs,
    )
    this.reportInterval = setInterval(
      () => this.reportAll(),
      this.config.reportIntervalMs,
    )
  }

  stop(): void {
    this.running = false
    if (this.checkInterval) clearInterval(this.checkInterval)
    if (this.reportInterval) clearInterval(this.reportInterval)
    this.checkInterval = null
    this.reportInterval = null
    this.metricsServer?.stop()
    console.log('[QoS] Stopped')
  }

  private startMetricsServer(port: number): void {
    this.metricsServer = Bun.serve({
      port,
      fetch: (req) => {
        const { pathname } = new URL(req.url)
        if (pathname === '/metrics') {
          return new Response(this.formatPrometheusMetrics(), {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }
        if (pathname === '/health') {
          return new Response(
            JSON.stringify({
              status: 'healthy',
              uptime: Date.now() - this.metrics.startTime,
            }),
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return new Response('Not Found', { status: 404 })
      },
    })
    console.log(`[QoS] Metrics server on port ${port}`)
  }

  formatPrometheusMetrics(): string {
    const lines: string[] = []
    const nodesTracked = this.nodeStats.size

    lines.push('# HELP rpc_qos_checks_total Total QoS checks performed')
    lines.push('# TYPE rpc_qos_checks_total counter')
    lines.push(`rpc_qos_checks_total ${this.metrics.checksTotal}`)

    lines.push(
      '# HELP rpc_qos_checks_failed_total Total QoS checks that failed',
    )
    lines.push('# TYPE rpc_qos_checks_failed_total counter')
    lines.push(`rpc_qos_checks_failed_total ${this.metrics.checksFailed}`)

    lines.push(
      '# HELP rpc_reports_submitted_total Total performance reports submitted on-chain',
    )
    lines.push('# TYPE rpc_reports_submitted_total counter')
    lines.push(`rpc_reports_submitted_total ${this.metrics.reportsSubmitted}`)

    lines.push(
      '# HELP rpc_reports_failed_total Total performance reports that failed',
    )
    lines.push('# TYPE rpc_reports_failed_total counter')
    lines.push(`rpc_reports_failed_total ${this.metrics.reportsFailed}`)

    lines.push('# HELP rpc_registered_nodes Number of RPC nodes being tracked')
    lines.push('# TYPE rpc_registered_nodes gauge')
    lines.push(`rpc_registered_nodes ${nodesTracked}`)

    lines.push('# HELP rpc_monitor_uptime_seconds QoS monitor uptime')
    lines.push('# TYPE rpc_monitor_uptime_seconds gauge')
    lines.push(
      `rpc_monitor_uptime_seconds ${(Date.now() - this.metrics.startTime) / 1000}`,
    )

    // Per-node uptime scores
    lines.push('# HELP rpc_node_uptime_score Node uptime score (basis points)')
    lines.push('# TYPE rpc_node_uptime_score gauge')
    for (const [nodeKey, score] of this.metrics.nodeUptimeScores.entries()) {
      const [node, chainId] = nodeKey.split('-')
      lines.push(
        `rpc_node_uptime_score{node="${node}",chain_id="${chainId}"} ${score}`,
      )
    }

    // Latency histogram buckets
    const buckets = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
    const samples = this.metrics.latencySamples
    lines.push('# HELP rpc_node_latency_seconds RPC node response latency')
    lines.push('# TYPE rpc_node_latency_seconds histogram')
    let cumulative = 0
    for (const bucket of buckets) {
      cumulative +=
        samples.filter((s) => s <= bucket).length -
        (cumulative > 0 ? cumulative : 0)
      lines.push(
        `rpc_node_latency_seconds_bucket{le="${bucket / 1000}"} ${samples.filter((s) => s <= bucket).length}`,
      )
    }
    lines.push(`rpc_node_latency_seconds_bucket{le="+Inf"} ${samples.length}`)
    lines.push(
      `rpc_node_latency_seconds_sum ${samples.reduce((a, b) => a + b, 0) / 1000}`,
    )
    lines.push(`rpc_node_latency_seconds_count ${samples.length}`)

    return `${lines.join('\n')}\n`
  }

  async runChecks(): Promise<void> {
    if (!this.running) return

    const chains = await this.getSupportedChains()
    await Promise.all(
      chains.map((chainId) => this.checkChainNodes(Number(chainId))),
    )
    console.log(`[QoS] Checked ${chains.length} chains`)
  }

  private async getSupportedChains(): Promise<bigint[]> {
    const result = await callRegistry<bigint[]>(
      this.registryAddress,
      'getSupportedChains',
    )
    if (!result?.length) {
      console.warn('[QoS] No supported chains found')
      return []
    }
    return result
  }

  private async checkChainNodes(chainId: number): Promise<void> {
    const providers = await callRegistry<Address[]>(
      this.registryAddress,
      'getProvidersForChain',
      [BigInt(chainId)],
    )
    if (providers?.length) {
      await Promise.all(providers.map((node) => this.checkNode(node, chainId)))
    }
  }

  async checkNode(node: Address, chainId: number): Promise<QoSCheckResult> {
    this.metrics.checksTotal++
    const result: QoSCheckResult = {
      node,
      timestamp: Date.now(),
      isReachable: false,
      chainId,
    }

    const endpoint = await callRegistry<ChainEndpoint>(
      this.registryAddress,
      'getChainEndpoint',
      [node, BigInt(chainId)],
    )

    if (!endpoint?.isActive || !endpoint.endpoint) {
      result.errorMessage = 'Endpoint not active'
      this.metrics.checksFailed++
      this.recordCheck(node, chainId, result)
      return result
    }

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
        this.metrics.checksFailed++
        this.recordCheck(node, chainId, result)
        return result
      }

      const data = (await response.json()) as {
        result?: string
        error?: { message: string }
      }
      if (data.error) {
        result.errorMessage = data.error.message
        this.metrics.checksFailed++
        this.recordCheck(node, chainId, result)
        return result
      }

      result.isReachable = true
      result.latencyMs = Date.now() - startTime
      result.blockHeight = data.result ? parseInt(data.result, 16) : undefined

      // Record latency sample for histogram (keep last 1000)
      this.metrics.latencySamples.push(result.latencyMs)
      if (this.metrics.latencySamples.length > 1000) {
        this.metrics.latencySamples.shift()
      }
    } catch (error) {
      clearTimeout(timeoutId)
      result.errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      this.metrics.checksFailed++
    }

    this.recordCheck(node, chainId, result)
    return result
  }

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

    if (result.isReachable && result.latencyMs !== undefined) {
      stats.successfulChecks++
      stats.totalLatency += result.latencyMs
      stats.minLatency = Math.min(stats.minLatency, result.latencyMs)
      stats.maxLatency = Math.max(stats.maxLatency, result.latencyMs)
    }

    // Update uptime score metric
    const uptimeScore =
      stats.totalChecks > 0
        ? Math.round((stats.successfulChecks / stats.totalChecks) * 10000)
        : 0
    this.metrics.nodeUptimeScores.set(key, uptimeScore)

    if (stats.checks.length > 100) {
      const removed = stats.checks.shift()
      if (removed) {
        stats.totalChecks--
        if (removed.isReachable && removed.latencyMs !== undefined) {
          stats.successfulChecks--
          stats.totalLatency -= removed.latencyMs
        }
      }
    }
  }

  getAggregatedQoS(node: Address, chainId: number) {
    const stats = this.nodeStats.get(`${node.toLowerCase()}-${chainId}`)
    if (!stats || stats.totalChecks === 0) return null

    return {
      node,
      periodStart: stats.checks[0]?.timestamp ?? 0,
      periodEnd: stats.checks[stats.checks.length - 1]?.timestamp ?? 0,
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

  async reportAll(): Promise<void> {
    if (!this.walletClient || !this.walletAccount) {
      console.warn('[QoS] No wallet configured, skipping report')
      return
    }

    const nodeReports = new Map<Address, { uptime: number; latency: number }>()

    for (const [key, stats] of Array.from(this.nodeStats.entries())) {
      if (stats.totalChecks < this.config.minChecksForReport) continue

      const [node] = key.split('-')
      const uptimeScore = Math.round(
        (stats.successfulChecks / stats.totalChecks) * 10000,
      )
      const avgLatency = Math.round(
        stats.successfulChecks > 0
          ? stats.totalLatency / stats.successfulChecks
          : 9999,
      )

      const existing = nodeReports.get(node as Address)
      if (
        !existing ||
        uptimeScore > existing.uptime ||
        (uptimeScore === existing.uptime && avgLatency < existing.latency)
      ) {
        nodeReports.set(node as Address, {
          uptime: uptimeScore,
          latency: avgLatency,
        })
      }
    }

    for (const [node, metrics] of Array.from(nodeReports.entries())) {
      try {
        const hash = await this.walletClient.writeContract({
          account: this.walletAccount,
          chain: CHAIN,
          address: this.registryAddress,
          abi: REGISTRY_ABI,
          functionName: 'reportPerformance',
          args: [
            node,
            BigInt(metrics.uptime),
            BigInt(metrics.uptime),
            BigInt(metrics.latency),
          ],
        })
        this.metrics.reportsSubmitted++
        console.log(
          `[QoS] Reported ${node}: uptime=${metrics.uptime}, latency=${metrics.latency}, tx=${hash}`,
        )
      } catch (error) {
        this.metrics.reportsFailed++
        console.error(`[QoS] Failed to report ${node}:`, error)
      }
    }

    this.nodeStats.clear()
  }

  getStatsSummary() {
    let totalNodes = 0
    let totalChecks = 0
    let totalUptime = 0

    for (const stats of Array.from(this.nodeStats.values())) {
      totalNodes++
      totalChecks += stats.totalChecks
      if (stats.totalChecks > 0)
        totalUptime += stats.successfulChecks / stats.totalChecks
    }

    return {
      nodesTracked: totalNodes,
      totalChecks,
      avgUptime: totalNodes > 0 ? (totalUptime / totalNodes) * 100 : 0,
    }
  }

  getMetrics(): Metrics {
    return this.metrics
  }
}

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
