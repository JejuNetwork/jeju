/**
 * Node Stats Reporter
 * 
 * Collects and reports node statistics to:
 * - On-chain contracts (for incentive payments)
 * - Prometheus metrics endpoint
 * - Regional coordinator (for routing decisions)
 */

import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import type { EdgeCache } from '../cache/edge-cache';
import type { RegionalCacheCoordinator } from '../cache/regional-coordinator';
import type { CDNRegion } from '@jejunetwork/types';
import { Registry, Counter, Gauge, Histogram } from 'prom-client';
import http from 'http';

// ============================================================================
// Contract ABIs
// ============================================================================

const CDN_STATS_ABI = [
  'function reportStats(bytes32 nodeId, uint256 bytesServed, uint256 requestsServed, uint256 cacheHitRate, bytes signature) external',
  'function getNodeStats(bytes32 nodeId) view returns (uint256 bytesServed, uint256 requestsServed, uint256 cacheHitRate, uint256 lastReport, uint256 pendingRewards)',
  'function claimRewards() external',
  'function getRewardRate() view returns (uint256 perGBServed)',
];

const ORACLE_ENDPOINT = process.env.STATS_ORACLE_URL ?? 'https://oracle.jejunetwork.com/cdn-stats';

// ============================================================================
// Types
// ============================================================================

export interface NodeStatsConfig {
  nodeId: string;
  region: CDNRegion;
  rpcUrl: string;
  privateKey?: string;
  statsContractAddress?: string;
  reportIntervalMs: number;
  metricsPort?: number;
}

export interface BandwidthStats {
  bytesServed1h: number;
  bytesServed24h: number;
  bytesServed7d: number;
  requestsServed1h: number;
  requestsServed24h: number;
  requestsServed7d: number;
  peakBandwidthMbps: number;
  avgBandwidthMbps: number;
}

export interface NodeReport {
  nodeId: string;
  region: CDNRegion;
  timestamp: number;
  uptime: number;
  cache: {
    entries: number;
    sizeBytes: number;
    hitRate: number;
    evictions: number;
  };
  bandwidth: BandwidthStats;
  p2p: {
    torrentsSeeding: number;
    peersConnected: number;
    bytesShared: number;
  };
  health: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
  };
}

interface OracleAttestation {
  nodeId: string;
  bytesServed: number;
  requestsServed: number;
  cacheHitRate: number;
  timestamp: number;
  signature: string;
}

// ============================================================================
// Prometheus Metrics
// ============================================================================

const metricsRegistry = new Registry();

const cdnBytesServed = new Counter({
  name: 'cdn_bytes_served_total',
  help: 'Total bytes served by CDN',
  labelNames: ['region', 'content_type'],
  registers: [metricsRegistry],
});

const cdnRequestsServed = new Counter({
  name: 'cdn_requests_served_total',
  help: 'Total requests served by CDN',
  labelNames: ['region', 'cache_status'],
  registers: [metricsRegistry],
});

const cdnCacheHitRate = new Gauge({
  name: 'cdn_cache_hit_rate',
  help: 'Cache hit rate (0-1)',
  labelNames: ['region'],
  registers: [metricsRegistry],
});

const cdnCacheSize = new Gauge({
  name: 'cdn_cache_size_bytes',
  help: 'Current cache size in bytes',
  labelNames: ['region'],
  registers: [metricsRegistry],
});

const cdnCacheEntries = new Gauge({
  name: 'cdn_cache_entries',
  help: 'Number of cache entries',
  labelNames: ['region'],
  registers: [metricsRegistry],
});

const cdnPeersConnected = new Gauge({
  name: 'cdn_peers_connected',
  help: 'Number of P2P peers connected',
  labelNames: ['region'],
  registers: [metricsRegistry],
});

const cdnTorrentsSeeding = new Gauge({
  name: 'cdn_torrents_seeding',
  help: 'Number of torrents being seeded',
  labelNames: ['region'],
  registers: [metricsRegistry],
});

const cdnRequestLatency = new Histogram({
  name: 'cdn_request_latency_seconds',
  help: 'Request latency in seconds',
  labelNames: ['region', 'cache_status'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [metricsRegistry],
});

const cdnRewardsPending = new Gauge({
  name: 'cdn_rewards_pending_wei',
  help: 'Pending rewards in wei',
  labelNames: ['region'],
  registers: [metricsRegistry],
});

// ============================================================================
// Node Stats Reporter
// ============================================================================

export class NodeStatsReporter {
  private config: NodeStatsConfig;
  private cache: EdgeCache;
  private coordinator: RegionalCacheCoordinator | null;
  
  // Contract integration
  private provider: JsonRpcProvider | null = null;
  private wallet: Wallet | null = null;
  private statsContract: Contract | null = null;
  
  // Stats tracking
  private startTime: number = Date.now();
  private hourlyStats: Array<{ timestamp: number; bytes: number; requests: number }> = [];
  private reportInterval: ReturnType<typeof setInterval> | null = null;
  private metricsServer: http.Server | null = null;
  
  // Current period stats
  private currentBytes = 0;
  private currentRequests = 0;

  constructor(
    cache: EdgeCache,
    coordinator: RegionalCacheCoordinator | null,
    config: Partial<NodeStatsConfig>
  ) {
    this.cache = cache;
    this.coordinator = coordinator;
    this.config = {
      nodeId: config.nodeId ?? `node-${Math.random().toString(36).slice(2, 10)}`,
      region: config.region ?? 'us-east',
      rpcUrl: config.rpcUrl ?? process.env.RPC_URL ?? 'http://localhost:8545',
      privateKey: config.privateKey ?? process.env.NODE_PRIVATE_KEY,
      statsContractAddress: config.statsContractAddress ?? process.env.CDN_STATS_CONTRACT,
      reportIntervalMs: config.reportIntervalMs ?? 3600000, // 1 hour
      metricsPort: config.metricsPort,
    };

    // Initialize contract if configured
    if (this.config.rpcUrl && this.config.privateKey && this.config.statsContractAddress) {
      this.provider = new JsonRpcProvider(this.config.rpcUrl);
      this.wallet = new Wallet(this.config.privateKey, this.provider);
      this.statsContract = new Contract(
        this.config.statsContractAddress,
        CDN_STATS_ABI,
        this.wallet
      );
    }
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async start(): Promise<void> {
    if (this.reportInterval) return;

    this.startTime = Date.now();

    // Start metrics server
    if (this.config.metricsPort) {
      await this.startMetricsServer();
    }

    // Start reporting interval
    this.reportInterval = setInterval(() => {
      this.generateAndSubmitReport();
    }, this.config.reportIntervalMs);

    console.log(`[NodeStatsReporter] Started for ${this.config.nodeId} in ${this.config.region}`);
  }

  async stop(): Promise<void> {
    if (this.reportInterval) {
      clearInterval(this.reportInterval);
      this.reportInterval = null;
    }
    if (this.metricsServer) {
      this.metricsServer.close();
      this.metricsServer = null;
    }

    // Final report
    await this.generateAndSubmitReport();
  }

  private async startMetricsServer(): Promise<void> {
    this.metricsServer = http.createServer(async (req, res) => {
      if (req.url === '/metrics') {
        res.setHeader('Content-Type', metricsRegistry.contentType);
        res.end(await metricsRegistry.metrics());
      } else if (req.url === '/health') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'healthy', uptime: Date.now() - this.startTime }));
      } else if (req.url === '/stats') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(this.generateReport()));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    await new Promise<void>((resolve) => {
      this.metricsServer!.listen(this.config.metricsPort, resolve);
    });

    console.log(`[NodeStatsReporter] Metrics on port ${this.config.metricsPort}`);
  }

  // ============================================================================
  // Recording
  // ============================================================================

  /**
   * Record a served request
   */
  recordRequest(
    bytes: number,
    cacheStatus: 'HIT' | 'MISS' | 'STALE' | 'BYPASS',
    contentType: string,
    latencyMs: number
  ): void {
    this.currentBytes += bytes;
    this.currentRequests++;

    // Update Prometheus metrics
    cdnBytesServed.inc({ region: this.config.region, content_type: contentType }, bytes);
    cdnRequestsServed.inc({ region: this.config.region, cache_status: cacheStatus });
    cdnRequestLatency.observe(
      { region: this.config.region, cache_status: cacheStatus },
      latencyMs / 1000
    );
  }

  /**
   * Record P2P activity
   */
  recordP2PActivity(torrents: number, peers: number, bytesShared: number): void {
    cdnTorrentsSeeding.set({ region: this.config.region }, torrents);
    cdnPeersConnected.set({ region: this.config.region }, peers);
  }

  // ============================================================================
  // Reporting
  // ============================================================================

  /**
   * Generate node report
   */
  generateReport(): NodeReport {
    const cacheStats = this.cache.getStats();
    const bandwidthStats = this.calculateBandwidthStats();

    // Update metrics
    cdnCacheHitRate.set({ region: this.config.region }, cacheStats.hitRate);
    cdnCacheSize.set({ region: this.config.region }, cacheStats.sizeBytes);
    cdnCacheEntries.set({ region: this.config.region }, cacheStats.entries);

    return {
      nodeId: this.config.nodeId,
      region: this.config.region,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      cache: {
        entries: cacheStats.entries,
        sizeBytes: cacheStats.sizeBytes,
        hitRate: cacheStats.hitRate,
        evictions: cacheStats.evictionCount,
      },
      bandwidth: bandwidthStats,
      p2p: {
        torrentsSeeding: 0, // Filled by hybrid-torrent service
        peersConnected: 0,
        bytesShared: 0,
      },
      health: this.getSystemHealth(),
    };
  }

  /**
   * Calculate bandwidth stats from hourly data
   */
  private calculateBandwidthStats(): BandwidthStats {
    const now = Date.now();
    const hour = 3600000;
    const day = 24 * hour;
    const week = 7 * day;

    let bytes1h = 0, bytes24h = 0, bytes7d = 0;
    let requests1h = 0, requests24h = 0, requests7d = 0;
    let peakBandwidth = 0;

    for (const stat of this.hourlyStats) {
      const age = now - stat.timestamp;
      
      if (age < hour) {
        bytes1h += stat.bytes;
        requests1h += stat.requests;
      }
      if (age < day) {
        bytes24h += stat.bytes;
        requests24h += stat.requests;
      }
      if (age < week) {
        bytes7d += stat.bytes;
        requests7d += stat.requests;
      }

      // Calculate peak bandwidth (bytes per second in that hour)
      const bandwidthMbps = (stat.bytes / 3600) * 8 / 1000000;
      if (bandwidthMbps > peakBandwidth) {
        peakBandwidth = bandwidthMbps;
      }
    }

    // Add current period
    bytes1h += this.currentBytes;
    requests1h += this.currentRequests;

    const avgBandwidth = bytes24h > 0 ? (bytes24h / 86400) * 8 / 1000000 : 0;

    return {
      bytesServed1h: bytes1h,
      bytesServed24h: bytes24h,
      bytesServed7d: bytes7d,
      requestsServed1h: requests1h,
      requestsServed24h: requests24h,
      requestsServed7d: requests7d,
      peakBandwidthMbps: peakBandwidth,
      avgBandwidthMbps: avgBandwidth,
    };
  }

  /**
   * Get system health metrics
   */
  private getSystemHealth(): { cpuUsage: number; memoryUsage: number; diskUsage: number } {
    // Get process memory usage
    const memUsage = process.memoryUsage();
    const totalMem = memUsage.heapTotal;
    const usedMem = memUsage.heapUsed;

    return {
      cpuUsage: 0, // Would need os module for actual CPU
      memoryUsage: totalMem > 0 ? usedMem / totalMem : 0,
      diskUsage: 0, // Would need fs.statfs for actual disk
    };
  }

  /**
   * Generate and submit report to contract
   */
  private async generateAndSubmitReport(): Promise<void> {
    // Store hourly stats
    this.hourlyStats.push({
      timestamp: Date.now(),
      bytes: this.currentBytes,
      requests: this.currentRequests,
    });

    // Prune old stats (keep 7 days)
    const weekAgo = Date.now() - 7 * 24 * 3600000;
    this.hourlyStats = this.hourlyStats.filter(s => s.timestamp > weekAgo);

    const report = this.generateReport();

    // Submit to coordinator
    if (this.coordinator) {
      // Coordinator handles regional sync
    }

    // Submit to contract if configured
    if (this.statsContract && this.wallet) {
      await this.submitToContract(report);
    }

    // Reset current period
    this.currentBytes = 0;
    this.currentRequests = 0;

    console.log(`[NodeStatsReporter] Report submitted: ${report.bandwidth.bytesServed1h} bytes, ${report.bandwidth.requestsServed1h} requests`);
  }

  /**
   * Submit report to smart contract via oracle
   */
  private async submitToContract(report: NodeReport): Promise<void> {
    if (!this.statsContract || !this.wallet) return;

    // Get oracle attestation (no self-signing)
    const attestation = await this.getOracleAttestation(report);

    // Submit to contract
    const tx = await this.statsContract.reportStats(
      `0x${this.config.nodeId.padStart(64, '0')}`,
      BigInt(attestation.bytesServed),
      BigInt(attestation.requestsServed),
      BigInt(Math.floor(attestation.cacheHitRate * 10000)), // Basis points
      attestation.signature
    );

    await tx.wait();
    console.log(`[NodeStatsReporter] On-chain report submitted: ${tx.hash}`);
  }

  /**
   * Get oracle attestation for stats
   */
  private async getOracleAttestation(report: NodeReport): Promise<OracleAttestation> {
    const response = await fetch(`${ORACLE_ENDPOINT}/attest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: this.config.nodeId,
        region: this.config.region,
        bytesServed: report.bandwidth.bytesServed1h,
        requestsServed: report.bandwidth.requestsServed1h,
        cacheHitRate: report.cache.hitRate,
        timestamp: report.timestamp,
        proof: {
          cacheEntries: report.cache.entries,
          uptime: report.uptime,
          p2pPeers: report.p2p.peersConnected,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Oracle attestation failed: ${response.statusText}`);
    }

    return await response.json() as OracleAttestation;
  }

  // ============================================================================
  // Rewards
  // ============================================================================

  /**
   * Get pending rewards
   */
  async getPendingRewards(): Promise<bigint> {
    if (!this.statsContract) return 0n;

    const stats = await this.statsContract.getNodeStats(
      `0x${this.config.nodeId.padStart(64, '0')}`
    );
    return stats.pendingRewards as bigint;
  }

  /**
   * Claim rewards
   */
  async claimRewards(): Promise<string> {
    if (!this.statsContract) {
      throw new Error('Stats contract not configured');
    }

    const tx = await this.statsContract.claimRewards();
    await tx.wait();

    const pending = await this.getPendingRewards();
    cdnRewardsPending.set({ region: this.config.region }, Number(pending));

    return tx.hash;
  }

  /**
   * Get current reward rate
   */
  async getRewardRate(): Promise<bigint> {
    if (!this.statsContract) return 0n;
    return await this.statsContract.getRewardRate() as bigint;
  }

  // ============================================================================
  // Getters
  // ============================================================================

  getNodeId(): string {
    return this.config.nodeId;
  }

  getRegion(): CDNRegion {
    return this.config.region;
  }

  getUptime(): number {
    return Date.now() - this.startTime;
  }
}

// ============================================================================
// Factory
// ============================================================================

let reporterInstance: NodeStatsReporter | null = null;

export function getNodeStatsReporter(
  cache: EdgeCache,
  coordinator: RegionalCacheCoordinator | null,
  config?: Partial<NodeStatsConfig>
): NodeStatsReporter {
  if (!reporterInstance) {
    reporterInstance = new NodeStatsReporter(cache, coordinator, config ?? {});
  }
  return reporterInstance;
}

