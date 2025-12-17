/**
 * Edge Node Coordinator
 *
 * Coordinates edge nodes for:
 * - CDN content distribution
 * - P2P content routing
 * - Load balancing
 * - Cache coherence
 *
 * Uses HTTP-based gossip protocol for decentralized coordination.
 */

import { randomBytes } from 'crypto';
import type { Address } from 'viem';

// ============================================================================
// Types
// ============================================================================

export interface EdgeNodeInfo {
  nodeId: string;
  operator: Address;
  endpoint: string;
  region: string;
  capabilities: EdgeCapabilities;
  metrics: EdgeMetrics;
  lastSeen: number;
  version: string;
}

export interface EdgeCapabilities {
  maxCacheSizeMb: number;
  maxBandwidthMbps: number;
  supportsWebRTC: boolean;
  supportsTCP: boolean;
  supportsIPFS: boolean;
  supportsTorrent: boolean;
}

export interface EdgeMetrics {
  cacheHitRate: number;
  avgLatencyMs: number;
  bytesServed: number;
  activeConnections: number;
  cacheUtilization: number;
}

export interface ContentLocation {
  contentHash: string;
  nodeIds: string[];
  lastUpdated: number;
  popularity: number;
}

export interface GossipMessage {
  type: 'announce' | 'query' | 'response' | 'ping' | 'pong' | 'cache_update' | 'peer_list';
  id: string;
  sender: string;
  timestamp: number;
  ttl: number;
  payload: Record<string, unknown>;
}

export interface EdgeCoordinatorConfig {
  nodeId: string;
  operator: Address;
  listenPort: number;
  gossipInterval: number;
  maxPeers: number;
  bootstrapNodes: string[];
  region: string;
}

// ============================================================================
// Edge Coordinator
// ============================================================================

export class EdgeCoordinator {
  private config: EdgeCoordinatorConfig;
  private peers: Map<string, EdgeNodeInfo> = new Map();
  private contentIndex: Map<string, ContentLocation> = new Map();
  private gossipInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private seenMessages: Set<string> = new Set();
  private pendingQueries: Map<string, { resolve: (nodes: string[]) => void; results: string[] }> = new Map();
  private running = false;
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(config: EdgeCoordinatorConfig) {
    this.config = config;
  }

  /**
   * Start the coordinator
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`[EdgeCoordinator] Starting node ${this.config.nodeId}`);

    // Start HTTP server for receiving gossip messages
    this.server = Bun.serve({
      port: this.config.listenPort,
      fetch: (req) => this.handleRequest(req),
    });

    // Connect to bootstrap nodes
    await this.connectToBootstrapNodes();

    // Start gossip protocol
    this.gossipInterval = setInterval(() => this.gossip(), this.config.gossipInterval);

    // Cleanup stale peers
    this.cleanupInterval = setInterval(() => this.cleanupStalePeers(), 60000);

    console.log(`[EdgeCoordinator] Started on port ${this.config.listenPort}`);
  }

  /**
   * Stop the coordinator
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.gossipInterval) clearInterval(this.gossipInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);

    // Announce departure
    await this.broadcast({
      type: 'announce',
      id: this.generateMessageId(),
      sender: this.config.nodeId,
      timestamp: Date.now(),
      ttl: 3,
      payload: { action: 'leave', nodeId: this.config.nodeId },
    });

    if (this.server) {
      this.server.stop();
      this.server = null;
    }

    console.log('[EdgeCoordinator] Stopped');
  }

  /**
   * Get known peers
   */
  getPeers(): EdgeNodeInfo[] {
    return Array.from(this.peers.values());
  }

  /**
   * Get content locations
   */
  getContentLocations(contentHash: string): ContentLocation | null {
    return this.contentIndex.get(contentHash) ?? null;
  }

  /**
   * Announce content availability
   */
  async announceContent(contentHash: string, size: number): Promise<void> {
    const existing = this.contentIndex.get(contentHash);
    if (existing) {
      if (!existing.nodeIds.includes(this.config.nodeId)) {
        existing.nodeIds.push(this.config.nodeId);
      }
      existing.lastUpdated = Date.now();
    } else {
      this.contentIndex.set(contentHash, {
        contentHash,
        nodeIds: [this.config.nodeId],
        lastUpdated: Date.now(),
        popularity: 1,
      });
    }

    await this.broadcast({
      type: 'cache_update',
      id: this.generateMessageId(),
      sender: this.config.nodeId,
      timestamp: Date.now(),
      ttl: 5,
      payload: { action: 'add', contentHash, size, nodeId: this.config.nodeId },
    });
  }

  /**
   * Query for content across the network
   */
  async queryContent(contentHash: string): Promise<string[]> {
    // Check local index first
    const local = this.contentIndex.get(contentHash);
    if (local && local.nodeIds.length > 0) {
      return local.nodeIds;
    }

    // Query the network
    const queryId = this.generateMessageId();
    
    return new Promise((resolve) => {
      this.pendingQueries.set(queryId, { resolve, results: [] });

      setTimeout(() => {
        const pending = this.pendingQueries.get(queryId);
        this.pendingQueries.delete(queryId);
        resolve(pending?.results ?? []);
      }, 5000);

      this.broadcast({
        type: 'query',
        id: queryId,
        sender: this.config.nodeId,
        timestamp: Date.now(),
        ttl: 3,
        payload: { contentHash },
      });
    });
  }

  /**
   * Get best node for content based on latency and load
   */
  async getBestNode(contentHash: string): Promise<EdgeNodeInfo | null> {
    const nodeIds = await this.queryContent(contentHash);
    if (nodeIds.length === 0) return null;

    let bestNode: EdgeNodeInfo | null = null;
    let bestScore = Infinity;

    for (const nodeId of nodeIds) {
      const node = this.peers.get(nodeId);
      if (!node) continue;

      const score = node.metrics.avgLatencyMs + node.metrics.cacheUtilization * 100;
      if (score < bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }

    return bestNode;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/gossip' && req.method === 'POST') {
      const msg = (await req.json()) as GossipMessage;
      const response = await this.handleGossipMessage(msg);
      return Response.json(response ?? { ok: true });
    }

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', nodeId: this.config.nodeId, peers: this.peers.size });
    }

    return new Response('Not Found', { status: 404 });
  }

  private async handleGossipMessage(msg: GossipMessage): Promise<GossipMessage | null> {
    // Deduplicate
    if (this.seenMessages.has(msg.id)) return null;
    this.seenMessages.add(msg.id);

    // Prune old messages
    if (this.seenMessages.size > 10000) {
      const toDelete = Array.from(this.seenMessages).slice(0, 5000);
      toDelete.forEach((id) => this.seenMessages.delete(id));
    }

    let response: GossipMessage | null = null;

    switch (msg.type) {
      case 'announce':
        this.handleAnnounce(msg);
        break;

      case 'query':
        response = this.handleQuery(msg);
        break;

      case 'response':
        this.handleResponse(msg);
        break;

      case 'cache_update':
        this.handleCacheUpdate(msg);
        break;

      case 'ping':
        response = this.handlePing(msg);
        break;

      case 'peer_list':
        this.handlePeerList(msg);
        break;
    }

    // Propagate if TTL > 1
    if (msg.ttl > 1) {
      this.broadcast({ ...msg, ttl: msg.ttl - 1 });
    }

    return response;
  }

  private handleAnnounce(msg: GossipMessage): void {
    const action = msg.payload.action as string;

    if (action === 'join') {
      const nodeInfo = msg.payload.nodeInfo as EdgeNodeInfo;
      this.peers.set(nodeInfo.nodeId, { ...nodeInfo, lastSeen: Date.now() });
      console.log(`[EdgeCoordinator] Peer joined: ${nodeInfo.nodeId}`);
    } else if (action === 'leave') {
      const nodeId = msg.payload.nodeId as string;
      this.peers.delete(nodeId);
      console.log(`[EdgeCoordinator] Peer left: ${nodeId}`);
    }
  }

  private handleQuery(msg: GossipMessage): GossipMessage | null {
    const contentHash = msg.payload.contentHash as string;
    const location = this.contentIndex.get(contentHash);

    if (location && location.nodeIds.includes(this.config.nodeId)) {
      return {
        type: 'response',
        id: msg.id,
        sender: this.config.nodeId,
        timestamp: Date.now(),
        ttl: 1,
        payload: { contentHash, nodeId: this.config.nodeId, endpoint: this.getLocalEndpoint() },
      };
    }

    return null;
  }

  private handleResponse(msg: GossipMessage): void {
    const pending = this.pendingQueries.get(msg.id);
    if (pending) {
      const nodeId = msg.payload.nodeId as string;
      if (!pending.results.includes(nodeId)) {
        pending.results.push(nodeId);
      }
    }
  }

  private handleCacheUpdate(msg: GossipMessage): void {
    const action = msg.payload.action as string;
    const contentHash = msg.payload.contentHash as string;
    const nodeId = msg.payload.nodeId as string;

    if (action === 'add') {
      const existing = this.contentIndex.get(contentHash);
      if (existing) {
        if (!existing.nodeIds.includes(nodeId)) existing.nodeIds.push(nodeId);
        existing.lastUpdated = Date.now();
        existing.popularity++;
      } else {
        this.contentIndex.set(contentHash, {
          contentHash,
          nodeIds: [nodeId],
          lastUpdated: Date.now(),
          popularity: 1,
        });
      }
    } else if (action === 'remove') {
      const existing = this.contentIndex.get(contentHash);
      if (existing) {
        existing.nodeIds = existing.nodeIds.filter((id) => id !== nodeId);
        if (existing.nodeIds.length === 0) this.contentIndex.delete(contentHash);
      }
    }
  }

  private handlePing(msg: GossipMessage): GossipMessage {
    return {
      type: 'pong',
      id: msg.id,
      sender: this.config.nodeId,
      timestamp: Date.now(),
      ttl: 1,
      payload: { metrics: this.getLocalMetrics() },
    };
  }

  private handlePeerList(msg: GossipMessage): void {
    const peers = msg.payload.peers as EdgeNodeInfo[];
    for (const peer of peers) {
      if (!this.peers.has(peer.nodeId) && peer.nodeId !== this.config.nodeId) {
        // Add to known peers
        this.peers.set(peer.nodeId, { ...peer, lastSeen: Date.now() });
      }
    }
  }

  private async connectToBootstrapNodes(): Promise<void> {
    for (const endpoint of this.config.bootstrapNodes) {
      await this.sendToPeer(endpoint, {
        type: 'announce',
        id: this.generateMessageId(),
        sender: this.config.nodeId,
        timestamp: Date.now(),
        ttl: 1,
        payload: { action: 'join', nodeInfo: this.getLocalNodeInfo() },
      });
    }
  }

  private async broadcast(msg: GossipMessage): Promise<void> {
    const promises = Array.from(this.peers.values()).map((peer) =>
      this.sendToPeer(peer.endpoint, msg).catch(() => {})
    );
    await Promise.allSettled(promises);
  }

  private async sendToPeer(endpoint: string, msg: GossipMessage): Promise<void> {
    await fetch(`${endpoint}/gossip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }

  private gossip(): void {
    const peerList = Array.from(this.peers.values()).slice(0, 10);
    const randomPeers = this.getRandomPeers(3);

    for (const peer of randomPeers) {
      // Share peer list
      this.sendToPeer(peer.endpoint, {
        type: 'peer_list',
        id: this.generateMessageId(),
        sender: this.config.nodeId,
        timestamp: Date.now(),
        ttl: 1,
        payload: { peers: peerList },
      });

      // Ping
      this.sendToPeer(peer.endpoint, {
        type: 'ping',
        id: this.generateMessageId(),
        sender: this.config.nodeId,
        timestamp: Date.now(),
        ttl: 1,
        payload: {},
      });
    }
  }

  private cleanupStalePeers(): void {
    const staleThreshold = 5 * 60 * 1000;
    const now = Date.now();

    for (const [nodeId, peer] of this.peers) {
      if (now - peer.lastSeen > staleThreshold) {
        this.peers.delete(nodeId);
        console.log(`[EdgeCoordinator] Removed stale peer: ${nodeId}`);
      }
    }
  }

  private getRandomPeers(count: number): EdgeNodeInfo[] {
    const peers = Array.from(this.peers.values());
    const result: EdgeNodeInfo[] = [];

    while (result.length < count && peers.length > 0) {
      const index = Math.floor(Math.random() * peers.length);
      result.push(peers.splice(index, 1)[0]);
    }

    return result;
  }

  private getLocalNodeInfo(): EdgeNodeInfo {
    return {
      nodeId: this.config.nodeId,
      operator: this.config.operator,
      endpoint: this.getLocalEndpoint(),
      region: this.config.region,
      capabilities: {
        maxCacheSizeMb: 512,
        maxBandwidthMbps: 100,
        supportsWebRTC: true,
        supportsTCP: true,
        supportsIPFS: true,
        supportsTorrent: true,
      },
      metrics: this.getLocalMetrics(),
      lastSeen: Date.now(),
      version: '1.0.0',
    };
  }

  private getLocalEndpoint(): string {
    return `http://localhost:${this.config.listenPort}`;
  }

  private getLocalMetrics(): EdgeMetrics {
    return {
      cacheHitRate: 0.85,
      avgLatencyMs: 50,
      bytesServed: 0,
      activeConnections: 0,
      cacheUtilization: 0.5,
    };
  }

  private generateMessageId(): string {
    return randomBytes(16).toString('hex');
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createEdgeCoordinator(config: EdgeCoordinatorConfig): EdgeCoordinator {
  return new EdgeCoordinator(config);
}
