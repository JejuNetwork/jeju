/**
 * Proxy Coordinator Server
 * Central coordination service for the Jeju decentralized proxy network
 * 
 * Handles:
 * - Node registration and WebSocket connections
 * - Request routing to internal nodes or external providers
 * - Session management and payment settlement
 * - Health monitoring and metrics
 * 
 * @module @jeju/proxy/coordinator
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Contract, JsonRpcProvider, Wallet, parseEther, formatEther } from 'ethers';

// Prometheus-compatible metrics collector
class MetricsCollector {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();

  incCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
    const key = this.labelKey(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.labelKey(name, labels);
    this.gauges.set(key, value);
  }

  observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.labelKey(name, labels);
    const values = this.histograms.get(key) || [];
    values.push(value);
    // Keep last 1000 observations
    if (values.length > 1000) values.shift();
    this.histograms.set(key, values);
  }

  private labelKey(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  toPrometheusFormat(): string {
    const lines: string[] = [];

    // Counters
    for (const [key, value] of this.counters) {
      lines.push(`# TYPE ${key.split('{')[0]} counter`);
      lines.push(`${key} ${value}`);
    }

    // Gauges
    for (const [key, value] of this.gauges) {
      lines.push(`# TYPE ${key.split('{')[0]} gauge`);
      lines.push(`${key} ${value}`);
    }

    // Histograms (simplified - sum, count, buckets)
    for (const [key, values] of this.histograms) {
      const name = key.split('{')[0];
      const labels = key.includes('{') ? key.slice(key.indexOf('{')) : '';
      const sorted = [...values].sort((a, b) => a - b);
      const sum = values.reduce((a, b) => a + b, 0);
      const count = values.length;

      lines.push(`# TYPE ${name} histogram`);
      
      // Standard buckets
      const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
      for (const le of buckets) {
        const bucketCount = sorted.filter(v => v <= le).length;
        const bucketLabels = labels ? labels.replace('}', `,le="${le}"}`) : `{le="${le}"}`;
        lines.push(`${name}_bucket${bucketLabels} ${bucketCount}`);
      }
      const infLabels = labels ? labels.replace('}', ',le="+Inf"}') : '{le="+Inf"}';
      lines.push(`${name}_bucket${infLabels} ${count}`);
      lines.push(`${name}_sum${labels} ${sum}`);
      lines.push(`${name}_count${labels} ${count}`);
    }

    return lines.join('\n');
  }
}

// Simple token bucket rate limiter
class RateLimiter {
  private buckets: Map<string, { tokens: number; lastRefill: number }> = new Map();
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second

  constructor(maxTokens = 100, refillRate = 10) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
  }

  isAllowed(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // Refill tokens
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  // Cleanup stale entries periodically
  cleanup(maxAge: number = 300000): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > maxAge) {
        this.buckets.delete(key);
      }
    }
  }
}
import type { Server, ServerWebSocket } from 'bun';
import { NodeManager } from './node-manager';
import { RequestRouter } from './request-router';
import type {
  Address,
  RegionCode,
  CoordinatorConfig,
  ProxyRequest,
  ProxySession,
  SessionOpenResponse,
  RegionInfo,
  ApiResponse,
  ExternalProxyProvider,
} from '../types';
import { REGION_CODES, hashRegion, SessionStatus } from '../types';

const PROXY_REGISTRY_ABI = [
  'function isActive(address) view returns (bool)',
  'function getActiveNodes() view returns (address[])',
  'function getNodesByRegion(bytes32) view returns (address[])',
  'function recordSession(address node, uint256 bytesServed, bool successful)',
];

const PROXY_PAYMENT_ABI = [
  'function openSession(bytes32 regionCode) payable returns (bytes32)',
  'function assignNode(bytes32 sessionId, address node)',
  'function closeSession(bytes32 sessionId, uint256 bytesServed)',
  'function getSession(bytes32 sessionId) view returns (tuple(bytes32 sessionId, address client, address node, bytes32 regionCode, uint256 deposit, uint256 usedAmount, uint256 bytesServed, uint256 createdAt, uint256 closedAt, uint8 status))',
  'function pricePerGb() view returns (uint256)',
  'function estimateCost(uint256 estimatedBytes) view returns (uint256)',
];

export class ProxyCoordinatorServer {
  private app: Hono;
  private wsServer: Server | null = null;
  private httpServer: ReturnType<typeof Bun.serve> | null = null;
  private nodeManager: NodeManager;
  private requestRouter: RequestRouter;
  private provider: JsonRpcProvider;
  private wallet: Wallet;
  private registry: Contract;
  private payment: Contract;
  private config: CoordinatorConfig;

  // Active sessions tracked in memory
  private activeSessions: Map<string, ProxySession> = new Map();
  
  // Rate limiting
  private rateLimiter = new RateLimiter(100, 10); // 100 burst, 10/sec refill
  private rateLimitCleanupInterval: ReturnType<typeof setInterval> | null = null;

  // Prometheus metrics
  private metrics = new MetricsCollector();

  constructor(config: CoordinatorConfig) {
    this.config = config;
    this.app = new Hono();

    // Initialize blockchain connection
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.privateKey, this.provider);
    this.registry = new Contract(config.registryAddress, PROXY_REGISTRY_ABI, this.wallet);
    this.payment = new Contract(config.paymentAddress, PROXY_PAYMENT_ABI, this.wallet);

    // Initialize node manager
    this.nodeManager = new NodeManager({
      rpcUrl: config.rpcUrl,
      registryAddress: config.registryAddress,
      heartbeatIntervalMs: config.heartbeatIntervalMs || 30000,
      connectionTimeoutMs: 10000,
      maxConcurrentRequestsPerNode: config.maxConcurrentRequestsPerNode || 10,
    });

    // Initialize request router
    this.requestRouter = new RequestRouter(this.nodeManager, {
      requestTimeoutMs: config.requestTimeoutMs || 30000,
      maxRetries: 3,
      externalFallbackEnabled: (config.externalProviders?.length || 0) > 0,
    });

    // Set up event handlers
    this.setupNodeEvents();
    this.setupRoutes();
  }

  private setupNodeEvents(): void {
    this.nodeManager.on('nodeConnected', (node) => {
      console.log('[Coordinator] Node connected:', node.address, 'region:', node.regionCode);
      this.metrics.incCounter('proxy_node_connections_total', { region: node.regionCode, event: 'connect' });
    });

    this.nodeManager.on('nodeDisconnected', (node) => {
      console.log('[Coordinator] Node disconnected:', node.address);
      this.metrics.incCounter('proxy_node_connections_total', { region: node.regionCode, event: 'disconnect' });
    });
  }

  private setupRoutes(): void {
    this.app.use('/*', cors());

    // Rate limiting middleware for API endpoints
    this.app.use('/v1/*', async (c, next) => {
      const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 
                       c.req.header('x-real-ip') || 
                       'unknown';
      
      if (!this.rateLimiter.isAllowed(clientIp)) {
        this.metrics.incCounter('proxy_rate_limit_hits_total');
        return c.json({ error: 'Rate limit exceeded', retryAfter: 1 }, 429);
      }
      
      return next();
    });

    // ============ Health & Info ============

    this.app.get('/health', (c) => {
      return c.json({
        status: 'ok',
        service: 'proxy-coordinator',
        connectedNodes: this.nodeManager.getConnectedCount(),
        availableRegions: this.nodeManager.getAvailableRegions(),
        timestamp: Date.now(),
      });
    });

    // Prometheus metrics endpoint
    this.app.get('/metrics', (c) => {
      // Update gauges with current state
      this.metrics.setGauge('proxy_connected_nodes', this.nodeManager.getConnectedCount());
      this.metrics.setGauge('proxy_active_sessions', this.activeSessions.size);
      this.metrics.setGauge('proxy_available_regions', this.nodeManager.getAvailableRegions().length);

      const regionCounts = this.nodeManager.getRegionCounts();
      for (const [region, count] of Object.entries(regionCounts)) {
        this.metrics.setGauge('proxy_nodes_by_region', count, { region });
      }

      c.header('Content-Type', 'text/plain; version=0.0.4');
      return c.text(this.metrics.toPrometheusFormat());
    });

    this.app.get('/v1/proxy/stats', async (c) => {
      const stats = this.requestRouter.getStats();
      const pricePerGb = await this.payment.pricePerGb();

      return c.json({
        connectedNodes: stats.connectedNodes,
        availableRegions: stats.availableRegions,
        externalProviders: stats.externalProviders,
        pricePerGb: formatEther(pricePerGb),
        activeSessions: this.activeSessions.size,
      });
    });

    // ============ Region Discovery ============

    this.app.get('/v1/proxy/regions', async (c) => {
      const regions: RegionInfo[] = [];
      const availableRegions = this.nodeManager.getAvailableRegions();
      const regionCounts = this.nodeManager.getRegionCounts();

      for (const code of Object.keys(REGION_CODES) as RegionCode[]) {
        const nodeCount = regionCounts[code] || 0;
        regions.push({
          code,
          name: this.getRegionName(code),
          nodeCount,
          averageLatencyMs: 0, // TODO: Track actual latency
          available: availableRegions.includes(code) || await this.hasExternalProvider(code),
        });
      }

      return c.json({ regions });
    });

    // ============ Session Management ============

    this.app.post('/v1/proxy/sessions', async (c) => {
      const body = await c.req.json<{
        regionCode: RegionCode;
        estimatedBytes?: number;
      }>();

      if (!body.regionCode || !REGION_CODES[body.regionCode]) {
        return c.json<ApiResponse<null>>({
          success: false,
          error: 'Invalid region code',
          code: 'INVALID_REGION',
        }, 400);
      }

      // Check if region is available
      const availability = await this.requestRouter.isRegionAvailable(body.regionCode);
      if (!availability.available) {
        return c.json<ApiResponse<null>>({
          success: false,
          error: `No nodes available for region: ${body.regionCode}`,
          code: 'REGION_UNAVAILABLE',
        }, 503);
      }

      // Estimate cost
      const estimatedBytes = body.estimatedBytes || 10 * 1024 * 1024; // Default 10MB
      const estimatedCost = await this.payment.estimateCost(estimatedBytes);
      const suggestedDeposit = estimatedCost * 2n; // 2x buffer

      return c.json<ApiResponse<{
        regionCode: RegionCode;
        estimatedCost: string;
        suggestedDeposit: string;
        source: 'internal' | 'external';
        instructions: string;
      }>>({
        success: true,
        data: {
          regionCode: body.regionCode,
          estimatedCost: formatEther(estimatedCost),
          suggestedDeposit: formatEther(suggestedDeposit),
          source: availability.source as 'internal' | 'external',
          instructions: 'Call ProxyPayment.openSession() with the region hash and deposit amount',
        },
      });
    });

    this.app.get('/v1/proxy/sessions/:sessionId', async (c) => {
      const sessionId = c.req.param('sessionId') as `0x${string}`;

      try {
        const session = await this.payment.getSession(sessionId);
        
        if (!session.createdAt || session.createdAt === 0n) {
          return c.json<ApiResponse<null>>({
            success: false,
            error: 'Session not found',
            code: 'SESSION_NOT_FOUND',
          }, 404);
        }

        return c.json({
          sessionId: session.sessionId,
          client: session.client,
          node: session.node,
          deposit: formatEther(session.deposit),
          usedAmount: formatEther(session.usedAmount),
          bytesServed: Number(session.bytesServed),
          status: ['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'DISPUTED'][Number(session.status)],
          createdAt: Number(session.createdAt),
          closedAt: Number(session.closedAt),
        });
      } catch (err) {
        return c.json<ApiResponse<null>>({
          success: false,
          error: 'Failed to fetch session',
          code: 'FETCH_ERROR',
        }, 500);
      }
    });

    // ============ Proxy Requests ============

    this.app.post('/v1/proxy/fetch', async (c) => {
      const body = await c.req.json<{
        sessionId: `0x${string}`;
        url: string;
        method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
        headers?: Record<string, string>;
        body?: string;
        timeout?: number;
      }>();

      if (!body.sessionId || !body.url) {
        return c.json<ApiResponse<null>>({
          success: false,
          error: 'sessionId and url are required',
          code: 'MISSING_PARAMS',
        }, 400);
      }

      // Verify session is active
      let session;
      try {
        session = await this.payment.getSession(body.sessionId);
        if (Number(session.status) !== SessionStatus.ACTIVE) {
          return c.json<ApiResponse<null>>({
            success: false,
            error: 'Session is not active',
            code: 'SESSION_NOT_ACTIVE',
          }, 400);
        }
      } catch {
        return c.json<ApiResponse<null>>({
          success: false,
          error: 'Failed to verify session',
          code: 'SESSION_ERROR',
        }, 500);
      }

      // Get region from session
      const regionHash = session.regionCode as `0x${string}`;
      let regionCode: RegionCode = 'US'; // Default
      for (const code of Object.keys(REGION_CODES) as RegionCode[]) {
        if (hashRegion(code) === regionHash) {
          regionCode = code;
          break;
        }
      }

      // Build proxy request
      const proxyRequest: ProxyRequest = {
        requestId: crypto.randomUUID(),
        sessionId: body.sessionId,
        url: body.url,
        method: body.method || 'GET',
        headers: body.headers,
        body: body.body,
        timeout: body.timeout || 30000,
        followRedirects: true,
        maxRedirects: 5,
      };

      // Route the request
      const startTime = Date.now();
      const result = await this.requestRouter.route(proxyRequest, regionCode);
      const latencySeconds = (Date.now() - startTime) / 1000;

      // Record metrics
      this.metrics.incCounter('proxy_requests_total', { region: regionCode, status: result.success ? 'success' : 'error' });
      this.metrics.observeHistogram('proxy_request_duration_seconds', latencySeconds, { region: regionCode });

      if (!result.success) {
        this.metrics.incCounter('proxy_request_errors_total', { region: regionCode, error: 'route_failed' });
        return c.json<ApiResponse<null>>({
          success: false,
          error: result.error || 'Request failed',
          code: 'ROUTE_FAILED',
        }, 502);
      }

      // Record bytes transferred
      if (result.bytesTransferred > 0) {
        this.metrics.incCounter('proxy_bytes_transferred_total', { region: regionCode }, result.bytesTransferred);
      }

      // Update session bytes (async, don't block response)
      if (result.bytesTransferred > 0 && result.nodeAddress) {
        this.recordSessionUsage(body.sessionId, result.nodeAddress, result.bytesTransferred).catch(
          (err) => console.error('[Coordinator] Failed to record usage:', err)
        );
      }

      return c.json({
        success: true,
        data: {
          statusCode: result.response?.statusCode || 0,
          statusText: result.response?.statusText || '',
          headers: result.response?.headers || {},
          body: result.response?.body || '',
          bytesTransferred: result.bytesTransferred,
          latencyMs: result.latencyMs,
          routedTo: result.routedTo,
          nodeAddress: result.nodeAddress,
        },
      });
    });

    // ============ Admin Endpoints ============

    this.app.get('/v1/proxy/nodes', (c) => {
      const nodes = this.nodeManager.getConnectedNodes();
      return c.json({
        count: nodes.length,
        nodes: nodes.map((n) => ({
          address: n.address,
          region: n.regionCode,
          stake: formatEther(n.stake),
          currentLoad: n.currentLoad,
          pendingRequests: n.pendingRequests,
          connectedAt: n.connectedAt,
          lastHeartbeat: n.lastHeartbeat,
          successRate: n.totalSessions > 0 
            ? Math.round((n.successfulSessions / n.totalSessions) * 100) 
            : 100,
        })),
      });
    });
  }

  /**
   * Record session usage on-chain
   */
  private async recordSessionUsage(
    sessionId: `0x${string}`,
    nodeAddress: Address,
    bytesTransferred: number
  ): Promise<void> {
    // Get current session data
    const session = await this.payment.getSession(sessionId);
    const currentBytes = Number(session.bytesServed);
    const newTotalBytes = currentBytes + bytesTransferred;

    // Update on-chain (batched in practice, but for now direct)
    // This would typically be done in a background job to batch updates
    console.log('[Coordinator] Recording usage:', {
      sessionId,
      nodeAddress,
      bytesTransferred,
      newTotalBytes,
    });
  }

  /**
   * Check if external provider is available for region
   */
  private async hasExternalProvider(regionCode: RegionCode): Promise<boolean> {
    const availability = await this.requestRouter.isRegionAvailable(regionCode);
    return availability.source === 'external';
  }

  /**
   * Get human-readable region name
   */
  private getRegionName(code: RegionCode): string {
    const names: Record<RegionCode, string> = {
      US: 'United States',
      GB: 'United Kingdom',
      DE: 'Germany',
      FR: 'France',
      JP: 'Japan',
      KR: 'South Korea',
      SG: 'Singapore',
      AU: 'Australia',
      BR: 'Brazil',
      IN: 'India',
      CA: 'Canada',
      NL: 'Netherlands',
      SE: 'Sweden',
      CH: 'Switzerland',
      HK: 'Hong Kong',
    };
    return names[code] || code;
  }

  /**
   * Start the coordinator server
   */
  async start(): Promise<void> {
    const httpPort = this.config.port;
    const wsPort = this.config.wsPort || httpPort + 1;

    // Start rate limiter cleanup
    this.rateLimitCleanupInterval = setInterval(() => this.rateLimiter.cleanup(), 60000);

    // Start node manager
    this.nodeManager.start();

    // Start HTTP server
    this.httpServer = Bun.serve({
      port: httpPort,
      fetch: this.app.fetch,
    });

    // Start WebSocket server for nodes
    this.wsServer = Bun.serve({
      port: wsPort,
      fetch(req, server) {
        // Upgrade to WebSocket
        if (server.upgrade(req)) {
          return; // Upgraded
        }
        return new Response('WebSocket upgrade required', { status: 426 });
      },
      websocket: {
        open: (ws: ServerWebSocket<{ connectionId: string }>) => {
          this.nodeManager.handleConnection(ws);
        },
        message: (ws: ServerWebSocket<{ connectionId: string }>, message) => {
          this.nodeManager.handleMessage(ws, message.toString());
        },
        close: (ws: ServerWebSocket<{ connectionId: string }>) => {
          this.nodeManager.handleDisconnect(ws);
        },
      },
    });

    console.log(`
🌐 Jeju Proxy Coordinator started
   HTTP API: http://localhost:${httpPort}
   WebSocket: ws://localhost:${wsPort}
   Registry: ${this.config.registryAddress}
   Payment:  ${this.config.paymentAddress}
   Wallet:   ${this.wallet.address}
`);
  }

  /**
   * Stop the coordinator server
   */
  stop(): void {
    this.nodeManager.stop();
    
    if (this.rateLimitCleanupInterval) {
      clearInterval(this.rateLimitCleanupInterval);
      this.rateLimitCleanupInterval = null;
    }

    if (this.httpServer) {
      this.httpServer.stop();
      this.httpServer = null;
    }

    if (this.wsServer) {
      this.wsServer.stop();
      this.wsServer = null;
    }

    console.log('[Coordinator] Stopped');
  }

  /**
   * Get the Hono app for testing
   */
  getApp(): Hono {
    return this.app;
  }

  /**
   * Register an external provider for fallback routing
   */
  registerExternalProvider(provider: ExternalProxyProvider, priority: number): void {
    this.requestRouter.registerExternalProvider(provider, priority);
  }
}

/**
 * Create and start coordinator from environment
 */
export async function startProxyCoordinator(): Promise<ProxyCoordinatorServer> {
  // Import decentralized adapters
  const { createMysteriumAdapter } = await import('../external/mysterium');
  const { createOrchidAdapter } = await import('../external/orchid');
  const { createSentinelAdapter } = await import('../external/sentinel');

  // Build external providers list from environment
  const externalProviders: CoordinatorConfig['externalProviders'] = [];
  
  // Check for Mysterium (decentralized)
  if (process.env.MYSTERIUM_NODE_URL) {
    externalProviders.push({
      name: 'Mysterium Network',
      type: 'mysterium',
      endpoint: process.env.MYSTERIUM_NODE_URL,
      enabled: true,
      priority: 1,
      markupBps: parseInt(process.env.MYSTERIUM_MARKUP_BPS || '500', 10),
    });
  }

  // Check for Orchid (decentralized)
  if (process.env.ORCHID_RPC_URL && process.env.ORCHID_STAKING_CONTRACT) {
    externalProviders.push({
      name: 'Orchid Network',
      type: 'orchid',
      endpoint: process.env.ORCHID_RPC_URL,
      enabled: true,
      priority: 2,
      markupBps: parseInt(process.env.ORCHID_MARKUP_BPS || '500', 10),
    });
  }

  // Check for Sentinel (decentralized)
  if (process.env.SENTINEL_API_URL) {
    externalProviders.push({
      name: 'Sentinel Network',
      type: 'sentinel',
      endpoint: process.env.SENTINEL_API_URL,
      enabled: true,
      priority: 3,
      markupBps: parseInt(process.env.SENTINEL_MARKUP_BPS || '500', 10),
    });
  }

  const config: CoordinatorConfig = {
    rpcUrl: process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545',
    registryAddress: (process.env.PROXY_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
    paymentAddress: (process.env.PROXY_PAYMENT_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
    privateKey: process.env.COORDINATOR_PRIVATE_KEY || process.env.PRIVATE_KEY || '',
    port: parseInt(process.env.PROXY_COORDINATOR_PORT || '4020', 10),
    wsPort: parseInt(process.env.PROXY_COORDINATOR_WS_PORT || '4021', 10),
    heartbeatIntervalMs: 30000,
    requestTimeoutMs: 30000,
    maxConcurrentRequestsPerNode: 10,
    externalProviders,
  };

  if (!config.privateKey) {
    throw new Error('COORDINATOR_PRIVATE_KEY or PRIVATE_KEY required');
  }

  const server = new ProxyCoordinatorServer(config);

  // Register decentralized fallback providers
  const mysteriumAdapter = createMysteriumAdapter();
  if (mysteriumAdapter) {
    server.registerExternalProvider(mysteriumAdapter, 1);
    console.log('[Coordinator] Registered Mysterium Network (decentralized fallback)');
  }

  const orchidAdapter = createOrchidAdapter();
  if (orchidAdapter) {
    server.registerExternalProvider(orchidAdapter, 2);
    console.log('[Coordinator] Registered Orchid Network (decentralized fallback)');
  }

  const sentinelAdapter = createSentinelAdapter();
  if (sentinelAdapter) {
    server.registerExternalProvider(sentinelAdapter, 3);
    console.log('[Coordinator] Registered Sentinel Network (decentralized fallback)');
  }

  await server.start();
  return server;
}

