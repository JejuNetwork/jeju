import { createPublicClient, http, type PublicClient } from 'viem';
import { FEED_REGISTRY_ABI, REPORT_VERIFIER_ABI, COMMITTEE_MANAGER_ABI } from './abis';
import type { OracleNodeConfig, NodeMetrics } from './types';

interface PrometheusMetric {
  name: string;
  help: string;
  type: 'gauge' | 'counter';
  labels: Record<string, string>;
  value: number;
}

export class MetricsExporter {
  private config: OracleNodeConfig;
  private client: PublicClient;
  private nodeMetrics: NodeMetrics | null = null;
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(config: OracleNodeConfig) {
    this.config = config;
    this.client = createPublicClient({ transport: http(config.rpcUrl) });
  }

  setNodeMetrics(metrics: NodeMetrics): void {
    this.nodeMetrics = metrics;
  }

  async start(): Promise<void> {
    this.server = Bun.serve({
      port: this.config.metricsPort,
      fetch: async (req) => {
        const { pathname } = new URL(req.url);
        if (pathname === '/metrics') {
          const metrics = await this.collectMetrics();
          return new Response(this.formatPrometheus(metrics), {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
        if (pathname === '/health') return new Response('OK');
        return new Response('Not Found', { status: 404 });
      },
    });
    console.log(`[Metrics] Exporter on port ${this.config.metricsPort}`);
  }

  stop(): void {
    this.server?.stop();
  }

  private async collectMetrics(): Promise<PrometheusMetric[]> {
    const metrics: PrometheusMetric[] = [];

    const feedIds = await this.client.readContract({
      address: this.config.feedRegistry,
      abi: FEED_REGISTRY_ABI,
      functionName: 'getActiveFeeds',
    });

    this.addMetric(metrics, 'jon_feeds_active_total', 'Total active oracle feeds', 'gauge', {}, feedIds.length);

    let totalActiveMembers = 0;

    for (const feedId of feedIds) {
      const [feed, priceData, currentRound, committee] = await Promise.all([
        this.client.readContract({ address: this.config.feedRegistry, abi: FEED_REGISTRY_ABI, functionName: 'getFeed', args: [feedId] }),
        this.client.readContract({ address: this.config.reportVerifier, abi: REPORT_VERIFIER_ABI, functionName: 'getLatestPrice', args: [feedId] }),
        this.client.readContract({ address: this.config.reportVerifier, abi: REPORT_VERIFIER_ABI, functionName: 'getCurrentRound', args: [feedId] }),
        this.client.readContract({ address: this.config.committeeManager, abi: COMMITTEE_MANAGER_ABI, functionName: 'getCommittee', args: [feedId] }),
      ]);

      const [price, confidence, timestamp, isValid] = priceData;
      const labels = { feed_id: feedId as string, feed_symbol: feed.symbol };
      const activeMembers = committee.isActive ? committee.members.length : 0;
      totalActiveMembers += activeMembers;

      // Feed metrics
      this.addMetric(metrics, 'jon_feed_latest_price', 'Latest price', 'gauge', labels, Number(price));
      this.addMetric(metrics, 'jon_feed_confidence', 'Confidence (bps)', 'gauge', labels, Number(confidence));
      this.addMetric(metrics, 'jon_feed_last_update_timestamp', 'Last update timestamp', 'gauge', labels, Number(timestamp));
      this.addMetric(metrics, 'jon_feed_is_valid', 'Price valid (1/0)', 'gauge', labels, isValid ? 1 : 0);
      this.addMetric(metrics, 'jon_feed_current_round', 'Current round', 'gauge', labels, Number(currentRound));
      this.addMetric(metrics, 'jon_feed_heartbeat_seconds', 'Heartbeat interval', 'gauge', labels, Number(feed.heartbeatSeconds));
      this.addMetric(metrics, 'jon_feed_min_oracles', 'Min oracles required', 'gauge', labels, Number(feed.minOracles));

      // Committee metrics
      this.addMetric(metrics, 'jon_committee_active_members', 'Active committee members', 'gauge', { feed_id: feedId as string }, activeMembers);
      this.addMetric(metrics, 'jon_committee_threshold', 'Quorum threshold', 'gauge', { feed_id: feedId as string }, Number(committee.threshold));
      this.addMetric(metrics, 'jon_committee_round', 'Committee round', 'gauge', { feed_id: feedId as string }, Number(committee.round));
    }

    this.addMetric(metrics, 'jon_operators_active_total', 'Total active operators', 'gauge', {}, totalActiveMembers);

    // Node metrics
    if (this.nodeMetrics) {
      const m = this.nodeMetrics;
      this.addMetric(metrics, 'jon_reports_submitted_total', 'Reports submitted', 'counter', {}, m.reportsSubmitted);
      this.addMetric(metrics, 'jon_reports_accepted_total', 'Reports accepted', 'counter', {}, m.reportsAccepted);
      this.addMetric(metrics, 'jon_reports_rejected_total', 'Reports rejected', 'counter', {}, m.reportsRejected);
      this.addMetric(metrics, 'jon_node_last_report_timestamp', 'Last report time', 'gauge', {}, m.lastReportTime / 1000);
      this.addMetric(metrics, 'jon_node_last_heartbeat_timestamp', 'Last heartbeat', 'gauge', {}, m.lastHeartbeat / 1000);
      this.addMetric(metrics, 'jon_node_uptime_seconds', 'Uptime (seconds)', 'gauge', {}, m.uptime / 1000);
    }

    return metrics;
  }

  private addMetric(
    metrics: PrometheusMetric[],
    name: string,
    help: string,
    type: 'gauge' | 'counter',
    labels: Record<string, string>,
    value: number
  ): void {
    metrics.push({ name, help, type, labels, value });
  }

  private formatPrometheus(metrics: PrometheusMetric[]): string {
    const lines: string[] = [];
    const seen = new Set<string>();

    for (const { name, help, type, labels, value } of metrics) {
      if (!seen.has(name)) {
        lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
        seen.add(name);
      }
      const labelStr = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',');
      lines.push(`${name}${labelStr ? `{${labelStr}}` : ''} ${value}`);
    }

    return lines.join('\n') + '\n';
  }
}

