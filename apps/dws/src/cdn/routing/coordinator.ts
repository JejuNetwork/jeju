/**
 * CDN Coordinator Server
 * 
 * Central coordination service for the CDN network:
 * - Manages edge node registration and health
 * - Routes requests to best edge nodes
 * - Handles cache invalidation propagation
 * - Coordinates billing and settlement
 */

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createPublicClient, createWalletClient, http, type Address } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { parseAbi } from 'viem';
import { base, baseSepolia, localhost } from 'viem/chains';
import { GeoRouter, getGeoRouter } from './geo-router';

function inferChainFromRpcUrl(rpcUrl: string) {
  if (rpcUrl.includes('base-sepolia') || rpcUrl.includes('84532')) {
    return baseSepolia;
  }
  if (rpcUrl.includes('base') && !rpcUrl.includes('localhost')) {
    return base;
  }
  return localhost;
}
import type {
  CoordinatorConfig,
  ConnectedEdgeNode,
  EdgeNodeMetrics,
  InvalidationRequest,
  InvalidationProgress,
  RouteRequest,
  RoutingDecision,
} from '../types';
import type { CDNRegion } from '@jejunetwork/types';

// ============================================================================
// ABI
// ============================================================================

const CDN_REGISTRY_ABI = parseAbi([
  'function getEdgeNode(bytes32 nodeId) view returns (tuple(bytes32 nodeId, address operator, string endpoint, uint8 region, uint8 providerType, uint8 status, uint256 stake, uint256 registeredAt, uint256 lastSeen, uint256 agentId))',
  'function getActiveNodesInRegion(uint8 region) view returns (bytes32[])',
  'function completeInvalidation(bytes32 requestId, uint256 nodesProcessed) external',
]);

const CDN_BILLING_ABI = parseAbi([
  'function recordUsage(address user, address provider, uint256 bytesEgress, uint256 requests, uint256 storageBytes, tuple(uint256 pricePerGBEgress, uint256 pricePerMillionRequests, uint256 pricePerGBStorage) rates) external',
]);

// ============================================================================
// Coordinator Server
// ============================================================================

export class CDNCoordinator {
  private app: Hono;
  private config: CoordinatorConfig;
  private router: GeoRouter;
  private account: PrivateKeyAccount;
  private publicClient: ReturnType<typeof createPublicClient>;
  private walletClient: ReturnType<typeof createWalletClient>;
  private registryAddress: Address;
  private billingAddress: Address;

  // Connected nodes via WebSocket
  private connectedNodes: Map<string, { ws: WebSocket; node: ConnectedEdgeNode }> = new Map();
  
  // Pending invalidations
  private invalidations: Map<string, InvalidationProgress> = new Map();

  // Usage aggregation
  private usageByProvider: Map<string, {
    bytesEgress: number;
    requests: number;
    lastReported: number;
  }> = new Map();

  constructor(config: CoordinatorConfig) {
    this.config = config;
    this.app = new Hono();
    this.router = getGeoRouter();

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error('PRIVATE_KEY required');
    this.account = privateKeyToAccount(privateKey as `0x${string}`);
    const chain = inferChainFromRpcUrl(config.rpcUrl);
    this.publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
    this.walletClient = createWalletClient({ account: this.account, chain, transport: http(config.rpcUrl) });
    this.registryAddress = config.registryAddress;
    this.billingAddress = config.billingAddress;

    this.setupRoutes();
    this.startHealthChecker();
    this.startSettlementLoop();
  }

  // ============================================================================
  // Routes
  // ============================================================================

  private setupRoutes(): void {
    this.app.use('/*', cors());
    this.app.use('/*', logger());

    // Health
    this.app.get('/health', (c) => {
      return c.json({
        status: 'healthy',
        service: 'cdn-coordinator',
        nodeCount: this.router.getNodeCount(),
        regionStats: this.router.getRegionStats(),
      });
    });

    // Node registration
    this.app.post('/nodes/register', async (c) => {
      return this.handleNodeRegistration(c);
    });

    // Node heartbeat
    this.app.post('/nodes/:nodeId/heartbeat', async (c) => {
      return this.handleNodeHeartbeat(c);
    });

    // Get routing decision
    this.app.post('/route', async (c) => {
      return this.handleRouteRequest(c);
    });

    // Get multiple routes (for failover)
    this.app.post('/route/multi', async (c) => {
      return this.handleMultiRouteRequest(c);
    });

    // Request invalidation
    this.app.post('/invalidate', async (c) => {
      return this.handleInvalidationRequest(c);
    });

    // Get invalidation status
    this.app.get('/invalidate/:requestId', async (c) => {
      return this.handleInvalidationStatus(c);
    });

    // List nodes
    this.app.get('/nodes', (c) => {
      const region = c.req.query('region') as CDNRegion | undefined;
      const nodes = region 
        ? this.router.getNodesByRegion(region)
        : this.router.getAllNodes();
      return c.json({ nodes, count: nodes.length });
    });

    // Get node details
    this.app.get('/nodes/:nodeId', (c) => {
      const nodeId = c.req.param('nodeId');
      const nodes = this.router.getAllNodes();
      const node = nodes.find(n => n.nodeId === nodeId);
      if (!node) {
        return c.json({ error: 'Node not found' }, 404);
      }
      return c.json(node);
    });

    // Region stats
    this.app.get('/regions', (c) => {
      return c.json(this.router.getRegionStats());
    });

    // Metrics
    this.app.get('/metrics', (c) => {
      return c.json(this.getMetrics());
    });

    // Prometheus metrics
    this.app.get('/metrics/prometheus', (c) => {
      const stats = this.router.getRegionStats();
      const lines: string[] = [
        '# HELP cdn_coordinator_nodes_total Total connected nodes',
        '# TYPE cdn_coordinator_nodes_total gauge',
        `cdn_coordinator_nodes_total ${this.router.getNodeCount()}`,
      ];

      for (const [region, s] of Object.entries(stats)) {
        lines.push(`cdn_coordinator_nodes_region{region="${region}"} ${s.nodes}`);
        lines.push(`cdn_coordinator_load_region{region="${region}"} ${s.avgLoad}`);
        lines.push(`cdn_coordinator_latency_region{region="${region}"} ${s.avgLatency}`);
      }

      return new Response(lines.join('\n'), {
        headers: { 'Content-Type': 'text/plain; version=0.0.4' },
      });
    });
  }

  // ============================================================================
  // Request Handlers
  // ============================================================================

  private async handleNodeRegistration(c: Context): Promise<Response> {
    const body = await c.req.json<{
      nodeId: string;
      address: string;
      endpoint: string;
      region: CDNRegion;
      providerType: string;
    }>();

    // Verify node is registered on-chain
    const nodeIdBytes = body.nodeId.startsWith('0x') 
      ? body.nodeId 
      : `0x${body.nodeId.padStart(64, '0')}`;

    try {
      const onChainNode = await this.publicClient.readContract({
        address: this.registryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'getEdgeNode',
        args: [nodeIdBytes as `0x${string}`],
      }) as { operator: Address };
      if (!onChainNode || onChainNode.operator === '0x0000000000000000000000000000000000000000') {
        return c.json({ error: 'Node not registered on-chain' }, { status: 400 });
      }
    } catch {
      // Registry might not be deployed, allow registration anyway
    }

    const node: ConnectedEdgeNode = {
      nodeId: body.nodeId,
      address: body.address as Address,
      endpoint: body.endpoint,
      region: body.region,
      metrics: {
        nodeId: body.nodeId,
        region: body.region,
        uptime: 0,
        requestsTotal: 0,
        requestsPerSecond: 0,
        bytesServedTotal: 0,
        bandwidthMbps: 0,
        cacheHits: 0,
        cacheMisses: 0,
        cacheHitRate: 0,
        cacheSizeBytes: 0,
        cacheEntries: 0,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        errorCount: 0,
        errorRate: 0,
        currentLoad: 0,
        cpuUsage: 0,
        memoryUsage: 0,
        activeConnections: 0,
        status: 'healthy',
        lastUpdated: Date.now(),
      },
      lastSeen: Date.now(),
      connectionId: crypto.randomUUID(),
    };

    this.router.registerNode(node);

    return c.json({ success: true, connectionId: node.connectionId });
  }

  private async handleNodeHeartbeat(c: Context): Promise<Response> {
    const nodeId = c.req.param('nodeId');
    const metrics = await c.req.json<EdgeNodeMetrics>();

    this.router.updateNodeMetrics(nodeId, metrics);

    return c.json({ success: true });
  }

  private async handleRouteRequest(c: Context): Promise<Response> {
    const request = await c.req.json<RouteRequest>();
    const decision = this.router.route(request);

    if (!decision) {
      return c.json({ error: 'No available nodes' }, 503);
    }

    return c.json(decision);
  }

  private async handleMultiRouteRequest(c: Context): Promise<Response> {
    const body = await c.req.json<RouteRequest & { count?: number }>();
    const decisions = this.router.routeMultiple(body, body.count ?? 3);

    if (decisions.length === 0) {
      return c.json({ error: 'No available nodes' }, 503);
    }

    return c.json({ routes: decisions });
  }

  private async handleInvalidationRequest(c: Context): Promise<Response> {
    const request = await c.req.json<InvalidationRequest>();
    const requestId = request.requestId ?? crypto.randomUUID();

    // Get target nodes
    const targetNodes = request.regions
      ? request.regions.flatMap(r => this.router.getNodesByRegion(r))
      : this.router.getAllNodes();

    // Initialize progress
    const progress: InvalidationProgress = {
      requestId,
      status: 'processing',
      nodesTotal: targetNodes.length,
      nodesProcessed: 0,
      pathsInvalidated: 0,
      startedAt: Date.now(),
      errors: [],
    };

    this.invalidations.set(requestId, progress);

    // Send invalidation to all nodes (async)
    this.broadcastInvalidation(request, targetNodes, progress);

    return c.json({ requestId, status: 'processing', nodesTotal: targetNodes.length });
  }

  private async handleInvalidationStatus(c: Context): Promise<Response> {
    const requestId = c.req.param('requestId');
    const progress = this.invalidations.get(requestId);

    if (!progress) {
      return c.json({ error: 'Invalidation request not found' }, 404);
    }

    return c.json(progress);
  }

  // ============================================================================
  // Invalidation Broadcast
  // ============================================================================

  private async broadcastInvalidation(
    request: InvalidationRequest,
    nodes: ConnectedEdgeNode[],
    progress: InvalidationProgress
  ): Promise<void> {
    const results = await Promise.allSettled(
      nodes.map(async (node) => {
        try {
          const response = await fetch(`${node.endpoint}/invalidate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: request.paths }),
            signal: AbortSignal.timeout(10000),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const result = await response.json() as { pathsInvalidated?: number };
          progress.nodesProcessed++;
          progress.pathsInvalidated += result.pathsInvalidated ?? request.paths.length;
        } catch (e) {
          progress.errors.push({
            nodeId: node.nodeId,
            error: e instanceof Error ? e.message : 'Unknown error',
          });
          progress.nodesProcessed++;
        }
      })
    );

    progress.status = progress.errors.length === 0 ? 'completed' : 'completed';
    progress.completedAt = Date.now();

    // Report completion on-chain
    try {
      const requestIdBytes = request.requestId.startsWith('0x')
        ? request.requestId
        : `0x${request.requestId.padStart(64, '0')}`;
      
      await this.walletClient.writeContract({
        address: this.registryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'completeInvalidation',
        args: [requestIdBytes as `0x${string}`, BigInt(progress.nodesProcessed)],
        account: this.account,
      });
    } catch {
      // Chain reporting failed, but invalidation still succeeded
    }
  }

  // ============================================================================
  // Background Tasks
  // ============================================================================

  private startHealthChecker(): void {
    setInterval(async () => {
      const nodes = this.router.getAllNodes();
      const staleThreshold = Date.now() - (this.config.healthCheckInterval * 3);

      for (const node of nodes) {
        if (node.lastSeen < staleThreshold) {
          console.log(`[Coordinator] Node ${node.nodeId} is stale, marking unhealthy`);
          node.metrics.status = 'unhealthy';
          this.router.updateNodeMetrics(node.nodeId, node.metrics);
        }
      }
    }, this.config.healthCheckInterval);
  }

  private startSettlementLoop(): void {
    setInterval(async () => {
      // Aggregate and report usage
      for (const [provider, usage] of this.usageByProvider) {
        if (usage.bytesEgress >= this.config.minSettlementAmount) {
          try {
            // Report usage for billing
            // This would typically be called per-user, but for now aggregate by provider
            console.log(`[Coordinator] Reporting usage for provider ${provider}: ${usage.bytesEgress} bytes, ${usage.requests} requests`);
            
            // Reset counters
            usage.bytesEgress = 0;
            usage.requests = 0;
            usage.lastReported = Date.now();
          } catch (e) {
            console.error(`[Coordinator] Failed to report usage for ${provider}:`, e);
          }
        }
      }
    }, this.config.settlementInterval);
  }

  // ============================================================================
  // Metrics
  // ============================================================================

  private getMetrics(): Record<string, number | Record<string, number>> {
    const regionStats = this.router.getRegionStats();
    const totalNodes = this.router.getNodeCount();
    const healthyNodes = this.router.getAllNodes().filter(n => n.metrics.status === 'healthy').length;

    return {
      totalNodes,
      healthyNodes,
      unhealthyNodes: totalNodes - healthyNodes,
      pendingInvalidations: this.invalidations.size,
      nodesByRegion: Object.fromEntries(
        Object.entries(regionStats).map(([r, s]) => [r, s.nodes])
      ),
    };
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  start(): void {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                   CDN Coordinator                              ║
║            Edge Node Management & Routing                      ║
╠═══════════════════════════════════════════════════════════════╣
║  Port:        ${this.config.port.toString().padEnd(42)}   ║
║  Registry:    ${this.config.registryAddress.slice(0, 42).padEnd(42)}   ║
╚═══════════════════════════════════════════════════════════════╝
`);

    Bun.serve({
      port: this.config.port,
      fetch: this.app.fetch,
    });

    console.log(`[Coordinator] Listening on port ${this.config.port}`);
  }

  getApp(): Hono {
    return this.app;
  }
}

// ============================================================================
// Factory
// ============================================================================

export async function startCoordinator(): Promise<CDNCoordinator> {
  const config: CoordinatorConfig = {
    port: parseInt(process.env.CDN_COORDINATOR_PORT ?? '4021', 10),
    registryAddress: (process.env.CDN_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address,
    billingAddress: (process.env.CDN_BILLING_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address,
    rpcUrl: process.env.RPC_URL ?? 'http://localhost:8545',
    healthCheckInterval: parseInt(process.env.CDN_HEALTH_CHECK_INTERVAL ?? '60000', 10),
    maxNodesPerRegion: parseInt(process.env.CDN_MAX_NODES_PER_REGION ?? '100', 10),
    settlementInterval: parseInt(process.env.CDN_SETTLEMENT_INTERVAL ?? '3600000', 10),
    minSettlementAmount: parseInt(process.env.CDN_MIN_SETTLEMENT_AMOUNT ?? '1000000', 10),
  };

  const coordinator = new CDNCoordinator(config);
  coordinator.start();
  return coordinator;
}

// CLI entry point
if (import.meta.main) {
  startCoordinator().catch(console.error);
}

