import {
  COMMITTEE_MANAGER_ABI,
  FEED_REGISTRY_ABI,
  REPORT_VERIFIER_ABI,
} from '@jejunetwork/shared'
import type { NodeMetrics, OracleNodeConfig } from '@jejunetwork/types'
import { createPublicClient, defineChain, http } from 'viem'
import { base, baseSepolia, foundry } from 'viem/chains'

interface PrometheusMetric {
  name: string
  help: string
  type: 'gauge' | 'counter'
  labels: Record<string, string>
  value: number
}

/** Minimal config required for metrics exporter */
type MetricsConfig = Pick<
  OracleNodeConfig,
  | 'rpcUrl'
  | 'chainId'
  | 'metricsPort'
  | 'feedRegistry'
  | 'reportVerifier'
  | 'committeeManager'
>

export class MetricsExporter {
  private config: MetricsConfig
  private client: ReturnType<typeof createPublicClient>
  private nodeMetrics: NodeMetrics | null = null
  private server: ReturnType<typeof Bun.serve> | null = null

  constructor(config: MetricsConfig) {
    this.config = config
    const chain = this.getChain(config.chainId)
    this.client = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    })
  }

  private getChain(chainId: number) {
    if (chainId === 8453) return base
    if (chainId === 84532) return baseSepolia
    if (chainId === 31337) return foundry
    return defineChain({
      id: chainId,
      name: 'custom',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [this.config.rpcUrl] } },
    })
  }

  setNodeMetrics(metrics: NodeMetrics): void {
    this.nodeMetrics = metrics
  }

  async start(): Promise<void> {
    const networkName =
      this.config.chainId === 8453
        ? 'mainnet'
        : this.config.chainId === 84532
          ? 'testnet'
          : 'localnet'

    this.server = Bun.serve({
      port: this.config.metricsPort,
      fetch: async (req) => {
        const { pathname } = new URL(req.url)
        if (pathname === '/metrics') {
          const metrics = await this.collectMetrics()
          return new Response(this.formatPrometheus(metrics), {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }
        if (pathname === '/health') {
          return new Response(
            JSON.stringify({
              status: 'healthy',
              network: networkName,
              chainId: this.config.chainId,
              timestamp: Date.now(),
            }),
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return new Response('Not Found', { status: 404 })
      },
    })
    console.log(`[Metrics] Exporter on port ${this.config.metricsPort}`)
  }

  stop(): void {
    this.server?.stop()
  }

  private async collectMetrics(): Promise<PrometheusMetric[]> {
    const metrics: PrometheusMetric[] = []

    if (this.nodeMetrics) {
      const m = this.nodeMetrics
      this.addMetric(
        metrics,
        'oracle_reports_submitted',
        'Reports submitted',
        'counter',
        {},
        m.reportsSubmitted,
      )
      this.addMetric(
        metrics,
        'oracle_reports_accepted',
        'Reports accepted',
        'counter',
        {},
        m.reportsAccepted,
      )
      this.addMetric(
        metrics,
        'oracle_reports_rejected',
        'Reports rejected',
        'counter',
        {},
        m.reportsRejected,
      )
      this.addMetric(
        metrics,
        'oracle_last_report_timestamp',
        'Last report time',
        'gauge',
        {},
        m.lastReportTime / 1000,
      )
      this.addMetric(
        metrics,
        'oracle_last_heartbeat_timestamp',
        'Last heartbeat',
        'gauge',
        {},
        m.lastHeartbeat / 1000,
      )
      this.addMetric(
        metrics,
        'oracle_uptime_seconds',
        'Uptime (seconds)',
        'gauge',
        {},
        m.uptime / 1000,
      )
    } else {
      // Default zero values
      this.addMetric(
        metrics,
        'oracle_reports_submitted',
        'Reports submitted',
        'counter',
        {},
        0,
      )
      this.addMetric(
        metrics,
        'oracle_reports_accepted',
        'Reports accepted',
        'counter',
        {},
        0,
      )
      this.addMetric(
        metrics,
        'oracle_reports_rejected',
        'Reports rejected',
        'counter',
        {},
        0,
      )
      this.addMetric(
        metrics,
        'oracle_uptime_seconds',
        'Uptime (seconds)',
        'gauge',
        {},
        0,
      )
    }

    const isZeroAddress = (addr: string) =>
      addr === '0x0000000000000000000000000000000000000000'
    const hasContracts =
      !isZeroAddress(this.config.feedRegistry) &&
      !isZeroAddress(this.config.reportVerifier) &&
      !isZeroAddress(this.config.committeeManager)

    if (!hasContracts) {
      this.addMetric(
        metrics,
        'oracle_feeds_active_total',
        'Total active oracle feeds',
        'gauge',
        {},
        0,
      )
      this.addMetric(
        metrics,
        'oracle_operators_active_total',
        'Total active operators',
        'gauge',
        {},
        0,
      )
      return metrics
    }

    const feedIds = await this.client.readContract({
      address: this.config.feedRegistry,
      abi: FEED_REGISTRY_ABI,
      functionName: 'getActiveFeeds',
    })

    this.addMetric(
      metrics,
      'oracle_feeds_active_total',
      'Total active oracle feeds',
      'gauge',
      {},
      feedIds.length,
    )

    let totalActiveMembers = 0

    for (const feedId of feedIds) {
      const [feed, priceData, currentRound, committee] = await Promise.all([
        this.client.readContract({
          address: this.config.feedRegistry,
          abi: FEED_REGISTRY_ABI,
          functionName: 'getFeed',
          args: [feedId],
        }),
        this.client.readContract({
          address: this.config.reportVerifier,
          abi: REPORT_VERIFIER_ABI,
          functionName: 'getLatestPrice',
          args: [feedId],
        }),
        this.client.readContract({
          address: this.config.reportVerifier,
          abi: REPORT_VERIFIER_ABI,
          functionName: 'getCurrentRound',
          args: [feedId],
        }),
        this.client.readContract({
          address: this.config.committeeManager,
          abi: COMMITTEE_MANAGER_ABI,
          functionName: 'getCommittee',
          args: [feedId],
        }),
      ])

      const [price, confidence, timestamp, isValid] = priceData
      const labels = { feed_id: feedId, feed_symbol: feed.symbol }
      const activeMembers = committee.isActive ? committee.members.length : 0
      totalActiveMembers += activeMembers

      // Feed metrics
      this.addMetric(
        metrics,
        'oracle_feed_latest_price',
        'Latest price',
        'gauge',
        labels,
        Number(price),
      )
      this.addMetric(
        metrics,
        'oracle_feed_confidence',
        'Confidence (bps)',
        'gauge',
        labels,
        Number(confidence),
      )
      this.addMetric(
        metrics,
        'oracle_feed_last_update_timestamp',
        'Last update timestamp',
        'gauge',
        labels,
        Number(timestamp),
      )
      this.addMetric(
        metrics,
        'oracle_feed_is_valid',
        'Price valid (1/0)',
        'gauge',
        labels,
        isValid ? 1 : 0,
      )
      this.addMetric(
        metrics,
        'oracle_feed_current_round',
        'Current round',
        'gauge',
        labels,
        Number(currentRound),
      )
      this.addMetric(
        metrics,
        'oracle_feed_heartbeat_seconds',
        'Heartbeat interval',
        'gauge',
        labels,
        Number(feed.heartbeatSeconds),
      )
      this.addMetric(
        metrics,
        'oracle_feed_min_oracles',
        'Min oracles required',
        'gauge',
        labels,
        Number(feed.minOracles),
      )

      // Committee metrics
      this.addMetric(
        metrics,
        'oracle_committee_active_members',
        'Active committee members',
        'gauge',
        { feed_id: feedId },
        activeMembers,
      )
      this.addMetric(
        metrics,
        'oracle_committee_threshold',
        'Quorum threshold',
        'gauge',
        { feed_id: feedId },
        Number(committee.threshold),
      )
      this.addMetric(
        metrics,
        'oracle_committee_round',
        'Committee round',
        'gauge',
        { feed_id: feedId },
        Number(committee.round),
      )
    }

    this.addMetric(
      metrics,
      'oracle_operators_active_total',
      'Total active operators',
      'gauge',
      {},
      totalActiveMembers,
    )

    return metrics
  }

  private addMetric(
    metrics: PrometheusMetric[],
    name: string,
    help: string,
    type: 'gauge' | 'counter',
    labels: Record<string, string>,
    value: number,
  ): void {
    metrics.push({ name, help, type, labels, value })
  }

  private formatPrometheus(metrics: PrometheusMetric[]): string {
    const lines: string[] = []
    const seen = new Set<string>()

    for (const { name, help, type, labels, value } of metrics) {
      if (!seen.has(name)) {
        lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`)
        seen.add(name)
      }
      const labelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',')
      lines.push(`${name}${labelStr ? `{${labelStr}}` : ''} ${value}`)
    }

    return `${lines.join('\n')}\n`
  }
}
