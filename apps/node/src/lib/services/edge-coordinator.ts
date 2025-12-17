/**
 * Edge Node Coordinator
 * 
 * Coordinates edge nodes for:
 * - CDN content distribution
 * - P2P content routing
 * - Load balancing
 * - Cache coherence
 * 
 * Uses gossip protocol for decentralized coordination.
 */

import { createHash, randomBytes } from 'crypto';
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
  private localCache: Map<string, Buffer> = new Map();
  private ws: WebSocket | null = null;
  private gossipInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private seenMessages: Set<string> = new Set();
  private messageHandlers: Map<string, (msg: GossipMessage) => void> = new Map();
  private running = false;

  constructor(config: EdgeCoordinatorConfig) {
    this.config = config;
    this.setupMessageHandlers();
  }

  /**
   * Start the coordinator
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`[EdgeCoordinator] Starting node ${this.config.nodeId}`);

    // Connect to bootstrap nodes
    await this.connectToBootstrapNodes();

    // Start gossip protocol
    this.gossipInterval = setInterval(() => {
      this.gossip();
    }, this.config.gossipInterval);

    // Cleanup stale peers
    this.cleanupInterval = setInterval(() => {
      this.cleanupStalePeers();
    }, 60000);

    console.log('[EdgeCoordinator] Started');
  }

  /**
   * Stop the coordinator
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.gossipInterval) {
      clearInterval(this.gossipInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Announce departure
    await this.broadcast({
      type: 'announce',
      id: this.generateMessageId(),
      sender: this.config.nodeId,
      timestamp: Date.now(),
      ttl: 3,
      payload: {
        action: 'leave',
        nodeId: this.config.nodeId,
      },
    });

    // Close connections
    for (const [peerId] of this.peers) {
      await this.disconnectPeer(peerId);
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
    // Update local index
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

    // Broadcast to network
    await this.broadcast({
      type: 'cache_update',
      id: this.generateMessageId(),
      sender: this.config.nodeId,
      timestamp: Date.now(),
      ttl: 5,
      payload: {
        action: 'add',
        contentHash,
        size,
        nodeId: this.config.nodeId,
      },
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
    return new Promise((resolve) => {
      const queryId = this.generateMessageId();
      const results: string[] = [];
      const timeout = setTimeout(() => {
        this.messageHandlers.delete(queryId);
        resolve(results);
      }, 5000);

      // Register handler for responses
      this.messageHandlers.set(queryId, (msg: GossipMessage) => {
        if (msg.type === 'response') {
          const nodeId = msg.payload.nodeId as string;
          if (nodeId && !results.includes(nodeId)) {
            results.push(nodeId);
          }
        }
      });

      // Broadcast query
      this.broadcast({
        type: 'query',
        id: queryId,
        sender: this.config.nodeId,
        timestamp: Date.now(),
        ttl: 3,
        payload: {
          contentHash,
        },
      });
    });
  }

  /**
   * Get best node for content based on latency and load
   */
  async getBestNode(contentHash: string): Promise<EdgeNodeInfo | null> {
    const nodeIds = await this.queryContent(contentHash);
    if (nodeIds.length === 0) return null;

    // Score nodes by latency and load
    let bestNode: EdgeNodeInfo | null = null;
    let bestScore = Infinity;

    for (const nodeId of nodeIds) {
      const node = this.peers.get(nodeId);
      if (!node) continue;

      // Score = latency + (utilization * 100)
      const score = node.metrics.avgLatencyMs + (node.metrics.cacheUtilization * 100);
      if (score < bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }

    return bestNode;
  }

  /**
   * Warm content to nearby nodes
   */
  async warmContent(contentHash: string, data: Buffer, targetRegions?: string[]): Promise<void> {
    const candidates = Array.from(this.peers.values())
      .filter((peer) => {
        if (targetRegions && !targetRegions.includes(peer.region)) return false;
        if (peer.metrics.cacheUtilization > 0.9) return false;
        return true;
      })
      .sort((a, b) => a.metrics.avgLatencyMs - b.metrics.avgLatencyMs)
      .slice(0, 5);

    for (const peer of candidates) {
      // Send warm request
      await this.sendToPeer(peer.nodeId, {
        type: 'cache_update',
        id: this.generateMessageId(),
        sender: this.config.nodeId,
        timestamp: Date.now(),
        ttl: 1,
        payload: {
          action: 'warm',
          contentHash,
          size: data.length,
          // In production, send actual content or CID
        },
      });
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupMessageHandlers(): void {
    // Built-in handlers are set up in handleMessage
  }

  private async connectToBootstrapNodes(): Promise<void> {
    for (const node of this.config.bootstrapNodes) {
      await this.connectToPeer(node);
    }
  }

  private async connectToPeer(endpoint: string): Promise<void> {
    const wsUrl = endpoint.replace(/^https?/, 'wss');
    const ws = new WebSocket(`${wsUrl}/gossip`);

    ws.onopen = () => {
      // Send hello
      ws.send(JSON.stringify({
        type: 'announce',
        id: this.generateMessageId(),
        sender: this.config.nodeId,
        timestamp: Date.now(),
        ttl: 1,
        payload: {
          action: 'join',
          nodeInfo: this.getLocalNodeInfo(),
        },
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as GossipMessage;
      this.handleMessage(msg, ws);
    };

    ws.onerror = (error) => {
      console.error(`[EdgeCoordinator] Peer connection error:`, error);
    };

    ws.onclose = () => {
      // Remove from peers if tracked
    };
  }

  private async disconnectPeer(peerId: string): Promise<void> {
    this.peers.delete(peerId);
  }

  private handleMessage(msg: GossipMessage, source: WebSocket): void {
    // Deduplicate
    if (this.seenMessages.has(msg.id)) return;
    this.seenMessages.add(msg.id);

    // Prune old messages
    if (this.seenMessages.size > 10000) {
      const oldest = Array.from(this.seenMessages).slice(0, 5000);
      oldest.forEach((id) => this.seenMessages.delete(id));
    }

    // Check if there's a registered handler
    const handler = this.messageHandlers.get(msg.id);
    if (handler) {
      handler(msg);
    }

    switch (msg.type) {
      case 'announce':
        this.handleAnnounce(msg);
        break;

      case 'query':
        this.handleQuery(msg, source);
        break;

      case 'cache_update':
        this.handleCacheUpdate(msg);
        break;

      case 'ping':
        this.handlePing(msg, source);
        break;

      case 'peer_list':
        this.handlePeerList(msg);
        break;
    }

    // Propagate if TTL > 0
    if (msg.ttl > 1) {
      this.broadcast({
        ...msg,
        ttl: msg.ttl - 1,
      });
    }
  }

  private handleAnnounce(msg: GossipMessage): void {
    const action = msg.payload.action as string;
    const nodeId = msg.payload.nodeId as string;

    if (action === 'join') {
      const nodeInfo = msg.payload.nodeInfo as EdgeNodeInfo;
      this.peers.set(nodeInfo.nodeId, {
        ...nodeInfo,
        lastSeen: Date.now(),
      });
      console.log(`[EdgeCoordinator] Peer joined: ${nodeInfo.nodeId}`);
    } else if (action === 'leave') {
      this.peers.delete(nodeId);
      console.log(`[EdgeCoordinator] Peer left: ${nodeId}`);
    }
  }

  private handleQuery(msg: GossipMessage, source: WebSocket): void {
    const contentHash = msg.payload.contentHash as string;
    const location = this.contentIndex.get(contentHash);

    if (location && location.nodeIds.includes(this.config.nodeId)) {
      // We have this content, respond
      source.send(JSON.stringify({
        type: 'response',
        id: msg.id,
        sender: this.config.nodeId,
        timestamp: Date.now(),
        ttl: 1,
        payload: {
          contentHash,
          nodeId: this.config.nodeId,
          endpoint: `https://${this.config.nodeId}`, // Replace with actual endpoint
        },
      }));
    }
  }

  private handleCacheUpdate(msg: GossipMessage): void {
    const action = msg.payload.action as string;
    const contentHash = msg.payload.contentHash as string;
    const nodeId = msg.payload.nodeId as string;

    if (action === 'add') {
      const existing = this.contentIndex.get(contentHash);
      if (existing) {
        if (!existing.nodeIds.includes(nodeId)) {
          existing.nodeIds.push(nodeId);
        }
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
        if (existing.nodeIds.length === 0) {
          this.contentIndex.delete(contentHash);
        }
      }
    }
  }

  private handlePing(msg: GossipMessage, source: WebSocket): void {
    source.send(JSON.stringify({
      type: 'pong',
      id: msg.id,
      sender: this.config.nodeId,
      timestamp: Date.now(),
      ttl: 1,
      payload: {
        metrics: this.getLocalMetrics(),
      },
    }));
  }

  private handlePeerList(msg: GossipMessage): void {
    const peers = msg.payload.peers as EdgeNodeInfo[];
    for (const peer of peers) {
      if (!this.peers.has(peer.nodeId) && peer.nodeId !== this.config.nodeId) {
        // Connect to new peer
        this.connectToPeer(peer.endpoint);
      }
    }
  }

  private async broadcast(msg: GossipMessage): Promise<void> {
    // For now, we'd need WebSocket connections to all peers
    // In production, use actual P2P connections
    for (const peer of this.peers.values()) {
      await this.sendToPeer(peer.nodeId, msg);
    }
  }

  private async sendToPeer(peerId: string, msg: GossipMessage): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    // Send via HTTP/WebSocket
    await fetch(`${peer.endpoint}/gossip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    }).catch(() => {
      // Peer might be unreachable
    });
  }

  private gossip(): void {
    // Send peer list to random peers
    const peerList = Array.from(this.peers.values()).slice(0, 10);
    const randomPeers = this.getRandomPeers(3);

    for (const peer of randomPeers) {
      this.sendToPeer(peer.nodeId, {
        type: 'peer_list',
        id: this.generateMessageId(),
        sender: this.config.nodeId,
        timestamp: Date.now(),
        ttl: 1,
        payload: {
          peers: peerList,
        },
      });
    }

    // Ping random peers
    for (const peer of randomPeers) {
      this.sendToPeer(peer.nodeId, {
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
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes

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
      endpoint: `https://localhost:${this.config.listenPort}`,
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

