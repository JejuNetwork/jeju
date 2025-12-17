/**
 * Residential Proxy Service
 * 
 * Connects to the proxy coordinator and handles proxy requests.
 * Uses WebSocket for real-time coordination and HTTP CONNECT for proxy forwarding.
 */

import { type Address } from 'viem';
import { type NodeClient, getChain } from '../contracts';
import { PROXY_REGISTRY_ABI } from '../abis';
import net from 'net';
import tls from 'tls';
import http from 'http';
import https from 'https';

// ============================================================================
// Types
// ============================================================================

export interface ProxyConfig {
  coordinatorWsUrl: string;
  localPort: number;
  maxConcurrentRequests: number;
  bandwidthLimitMbps: number;
  allowedPorts: number[];
  blockedDomains: string[];
  stakeAmount: bigint;
}

export interface ProxyState {
  isRegistered: boolean;
  nodeId: `0x${string}`;
  status: 'online' | 'busy' | 'offline' | 'suspended';
  totalRequests: number;
  totalBytesTransferred: number;
  currentConnections: number;
  earnings: bigint;
}

export interface ProxyRequest {
  id: string;
  targetHost: string;
  targetPort: number;
  method: string;
  encrypted: boolean;
  timestamp: number;
}

interface ProxyMetrics {
  requestsTotal: number;
  requestsSuccessful: number;
  requestsFailed: number;
  bytesUpload: number;
  bytesDownload: number;
  avgLatencyMs: number;
  activeConnections: number;
}

// ============================================================================
// Residential Proxy Service
// ============================================================================

export class ResidentialProxyService {
  private client: NodeClient;
  private config: ProxyConfig;
  private ws: WebSocket | null = null;
  private server: http.Server | null = null;
  private nodeId: `0x${string}` | null = null;
  private running = false;
  private metrics: ProxyMetrics = {
    requestsTotal: 0,
    requestsSuccessful: 0,
    requestsFailed: 0,
    bytesUpload: 0,
    bytesDownload: 0,
    avgLatencyMs: 0,
    activeConnections: 0,
  };
  private activeConnections = new Map<string, net.Socket>();
  private metricsReportInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(client: NodeClient, config: Partial<ProxyConfig> = {}) {
    this.client = client;
    this.config = {
      coordinatorWsUrl: config.coordinatorWsUrl ?? 'wss://proxy.jejunetwork.org/ws',
      localPort: config.localPort ?? 4025,
      maxConcurrentRequests: config.maxConcurrentRequests ?? 10,
      bandwidthLimitMbps: config.bandwidthLimitMbps ?? 100,
      allowedPorts: config.allowedPorts ?? [80, 443, 8080, 8443],
      blockedDomains: config.blockedDomains ?? [],
      stakeAmount: config.stakeAmount ?? BigInt('100000000000000000'), // 0.1 ETH
    };
  }

  /**
   * Get current proxy state
   */
  async getState(address: Address): Promise<ProxyState | null> {
    const nodeIds = await this.client.publicClient.readContract({
      address: this.client.addresses.proxyRegistry,
      abi: PROXY_REGISTRY_ABI,
      functionName: 'getOperatorNodes',
      args: [address],
    }) as readonly `0x${string}`[];

    if (nodeIds.length === 0) {
      return null;
    }

    const nodeId = nodeIds[0];
    const node = await this.client.publicClient.readContract({
      address: this.client.addresses.proxyRegistry,
      abi: PROXY_REGISTRY_ABI,
      functionName: 'getProxyNode',
      args: [nodeId],
    }) as { status: number; requestsTotal: bigint; bytesTransferred: bigint; stake: bigint };

    const statusMap: ProxyState['status'][] = ['online', 'busy', 'offline', 'suspended'];

    return {
      isRegistered: true,
      nodeId,
      status: statusMap[node.status] ?? 'offline',
      totalRequests: Number(node.requestsTotal),
      totalBytesTransferred: Number(node.bytesTransferred),
      currentConnections: this.metrics.activeConnections,
      earnings: node.stake,
    };
  }

  /**
   * Register as proxy node
   */
  async register(): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.proxyRegistry,
      abi: PROXY_REGISTRY_ABI,
      functionName: 'registerProxyNode',
      args: [this.config.bandwidthLimitMbps, this.config.maxConcurrentRequests],
      value: this.config.stakeAmount,
    });

    return hash;
  }

  /**
   * Start the proxy service
   */
  async start(): Promise<void> {
    if (this.running) {
      console.warn('[Proxy] Already running');
      return;
    }

    this.running = true;

    // Get node ID from registration
    const address = this.client.walletClient?.account?.address;
    if (address) {
      const state = await this.getState(address);
      if (state) {
        this.nodeId = state.nodeId;
      }
    }

    // Start local proxy server
    await this.startProxyServer();

    // Connect to coordinator
    await this.connectToCoordinator();

    // Start metrics reporting
    this.metricsReportInterval = setInterval(() => {
      this.reportMetrics();
    }, 60000); // Every minute

    console.log(`[Proxy] Started on port ${this.config.localPort}`);
  }

  /**
   * Stop the proxy service
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    // Clear intervals
    if (this.metricsReportInterval) {
      clearInterval(this.metricsReportInterval);
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    // Close all connections
    for (const [id, socket] of this.activeConnections) {
      socket.destroy();
      this.activeConnections.delete(id);
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Close server
    if (this.server) {
      this.server.close();
      this.server = null;
    }

    // Final metrics report
    await this.reportMetrics();

    console.log('[Proxy] Stopped');
  }

  /**
   * Check if service is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get current metrics
   */
  getMetrics(): ProxyMetrics {
    return { ...this.metrics };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async startProxyServer(): Promise<void> {
    this.server = http.createServer((req, res) => {
      // Handle regular HTTP requests
      this.handleHttpRequest(req, res);
    });

    // Handle CONNECT method for HTTPS tunneling
    this.server.on('connect', (req, clientSocket, head) => {
      this.handleConnectRequest(req, clientSocket, head);
    });

    this.server.on('error', (err) => {
      console.error('[Proxy] Server error:', err.message);
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(this.config.localPort, () => {
        resolve();
      });
    });
  }

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    // Validate request
    if (!req.url) {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }

    // Parse target URL
    const targetUrl = new URL(req.url);
    const hostname = targetUrl.hostname;
    const port = parseInt(targetUrl.port) || (targetUrl.protocol === 'https:' ? 443 : 80);

    // Check blocked domains
    if (this.isBlocked(hostname)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Check allowed ports
    if (!this.config.allowedPorts.includes(port)) {
      res.writeHead(403);
      res.end('Port not allowed');
      return;
    }

    this.metrics.requestsTotal++;
    this.metrics.activeConnections++;

    // Forward request
    const options: http.RequestOptions = {
      hostname,
      port,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: req.headers,
    };

    const proxyReq = (targetUrl.protocol === 'https:' ? https : http).request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      
      let bytesReceived = 0;
      proxyRes.on('data', (chunk: Buffer) => {
        bytesReceived += chunk.length;
        this.metrics.bytesDownload += chunk.length;
      });

      proxyRes.pipe(res);

      proxyRes.on('end', () => {
        this.metrics.requestsSuccessful++;
        this.metrics.activeConnections--;
        this.updateLatency(Date.now() - startTime);
      });
    });

    proxyReq.on('error', (err) => {
      console.error(`[Proxy] Request ${requestId} failed:`, err.message);
      this.metrics.requestsFailed++;
      this.metrics.activeConnections--;
      res.writeHead(502);
      res.end('Bad Gateway');
    });

    let bytesSent = 0;
    req.on('data', (chunk: Buffer) => {
      bytesSent += chunk.length;
      this.metrics.bytesUpload += chunk.length;
    });

    req.pipe(proxyReq);
  }

  private handleConnectRequest(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer
  ): void {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    if (!req.url) {
      clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      clientSocket.end();
      return;
    }

    const [hostname, portStr] = req.url.split(':');
    const port = parseInt(portStr) || 443;

    // Validate
    if (this.isBlocked(hostname)) {
      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      clientSocket.end();
      return;
    }

    if (!this.config.allowedPorts.includes(port)) {
      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      clientSocket.end();
      return;
    }

    if (this.metrics.activeConnections >= this.config.maxConcurrentRequests) {
      clientSocket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      clientSocket.end();
      return;
    }

    this.metrics.requestsTotal++;
    this.metrics.activeConnections++;
    this.activeConnections.set(requestId, clientSocket);

    // Create tunnel to target
    const serverSocket = net.connect(port, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      
      if (head.length > 0) {
        serverSocket.write(head);
        this.metrics.bytesUpload += head.length;
      }

      // Pipe bidirectional
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);

      // Track bytes
      serverSocket.on('data', (chunk: Buffer) => {
        this.metrics.bytesDownload += chunk.length;
      });

      clientSocket.on('data', (chunk: Buffer) => {
        this.metrics.bytesUpload += chunk.length;
      });
    });

    const cleanup = () => {
      this.metrics.activeConnections--;
      this.activeConnections.delete(requestId);
      this.metrics.requestsSuccessful++;
      this.updateLatency(Date.now() - startTime);
      serverSocket.destroy();
      clientSocket.destroy();
    };

    serverSocket.on('error', (err) => {
      console.error(`[Proxy] CONNECT ${requestId} server error:`, err.message);
      this.metrics.requestsFailed++;
      cleanup();
    });

    clientSocket.on('error', (err) => {
      console.error(`[Proxy] CONNECT ${requestId} client error:`, err.message);
      cleanup();
    });

    serverSocket.on('close', cleanup);
    clientSocket.on('close', cleanup);
  }

  private async connectToCoordinator(): Promise<void> {
    if (!this.running) return;

    const ws = new WebSocket(this.config.coordinatorWsUrl);

    ws.onopen = () => {
      console.log('[Proxy] Connected to coordinator');
      
      // Register with coordinator
      ws.send(JSON.stringify({
        type: 'register',
        nodeId: this.nodeId,
        address: this.client.walletClient?.account?.address,
        capabilities: {
          maxConnections: this.config.maxConcurrentRequests,
          bandwidthMbps: this.config.bandwidthLimitMbps,
          allowedPorts: this.config.allowedPorts,
        },
      }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string);
      this.handleCoordinatorMessage(message);
    };

    ws.onerror = (error) => {
      console.error('[Proxy] WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('[Proxy] Disconnected from coordinator');
      this.ws = null;

      // Reconnect if still running
      if (this.running) {
        this.reconnectTimeout = setTimeout(() => {
          this.connectToCoordinator();
        }, 5000);
      }
    };

    this.ws = ws;
  }

  private handleCoordinatorMessage(message: { type: string; [key: string]: unknown }): void {
    switch (message.type) {
      case 'registered':
        console.log('[Proxy] Registered with coordinator');
        break;

      case 'request':
        // Handle incoming proxy request from coordinator
        // This is for pull-based model where coordinator assigns requests
        break;

      case 'block_domain':
        // Add domain to blocklist
        const domain = message.domain as string;
        if (!this.config.blockedDomains.includes(domain)) {
          this.config.blockedDomains.push(domain);
        }
        break;

      case 'status_request':
        // Respond with current status
        this.ws?.send(JSON.stringify({
          type: 'status',
          metrics: this.metrics,
          activeConnections: this.metrics.activeConnections,
          timestamp: Date.now(),
        }));
        break;
    }
  }

  private isBlocked(hostname: string): boolean {
    return this.config.blockedDomains.some(
      (blocked) => hostname === blocked || hostname.endsWith('.' + blocked)
    );
  }

  private updateLatency(latencyMs: number): void {
    const total = this.metrics.requestsSuccessful + this.metrics.requestsFailed;
    this.metrics.avgLatencyMs = 
      (this.metrics.avgLatencyMs * (total - 1) + latencyMs) / total;
  }

  private async reportMetrics(): Promise<void> {
    if (!this.nodeId || !this.client.walletClient?.account) return;

    // Report to coordinator via WebSocket
    this.ws?.send(JSON.stringify({
      type: 'metrics',
      nodeId: this.nodeId,
      metrics: {
        ...this.metrics,
        timestamp: Date.now(),
      },
    }));

    // Could also report on-chain periodically for rewards
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createResidentialProxyService(
  client: NodeClient,
  config?: Partial<ProxyConfig>
): ResidentialProxyService {
  return new ResidentialProxyService(client, config);
}

