/**
 * Content Router
 *
 * Intelligently routes content delivery based on:
 * - Content popularity (hot content → torrent swarm)
 * - File size (large files → torrent)
 * - Latency requirements (real-time → CDN edge)
 * - Availability (fallback chain)
 */

import type { Address } from 'viem';
import { TorrentBackend, getTorrentBackend } from '../backends/torrent';
import { BackendManager, createBackendManager } from '../backends';
import { getModerationService, type ContentModerationService } from '../moderation';
import type {
  DeliveryMethod,
  DeliveryRoute,
  ContentIdentifier,
  SwarmInfo,
} from '../../../../../packages/types/src';

// ============ Types ============

interface RouterConfig {
  torrentThreshold: number;        // Min seeders for torrent routing
  largeSizeThreshold: number;      // Bytes - above this prefer torrent
  hotContentThreshold: number;     // Access count for "hot" classification
  cdnEdgeEndpoint?: string;
  ipfsGatewayUrl?: string;
}

interface ClientInfo {
  ip: string;
  region?: string;
  preferTorrent?: boolean;
  requiresProxy?: boolean;
}

interface RouteDecision {
  primary: DeliveryRoute;
  fallbacks: DeliveryRoute[];
  contentHash: string;
  size: number;
  reason: string;
}

// ============ Default Config ============

const DEFAULT_CONFIG: RouterConfig = {
  torrentThreshold: 2,
  largeSizeThreshold: 10 * 1024 * 1024, // 10 MB
  hotContentThreshold: 100,
  ipfsGatewayUrl: 'https://ipfs.io',
};

// ============ Popularity Tracker ============

class PopularityTracker {
  private accessCounts: Map<string, { count: number; lastAccess: number }> = new Map();
  private decayInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Decay popularity over time
    this.decayInterval = setInterval(() => this.decay(), 3600000); // 1 hour
  }

  record(contentId: string): void {
    const existing = this.accessCounts.get(contentId);
    if (existing) {
      existing.count++;
      existing.lastAccess = Date.now();
    } else {
      this.accessCounts.set(contentId, { count: 1, lastAccess: Date.now() });
    }
  }

  getPopularity(contentId: string): number {
    return this.accessCounts.get(contentId)?.count ?? 0;
  }

  private decay(): void {
    const now = Date.now();
    const oneHour = 3600000;

    for (const [key, value] of this.accessCounts) {
      // Reduce count by 10% per hour of inactivity
      const hoursSinceAccess = (now - value.lastAccess) / oneHour;
      if (hoursSinceAccess > 1) {
        value.count = Math.floor(value.count * Math.pow(0.9, hoursSinceAccess));
        if (value.count === 0) {
          this.accessCounts.delete(key);
        }
      }
    }
  }

  destroy(): void {
    clearInterval(this.decayInterval);
  }
}

// ============ Content Router ============

export class ContentRouter {
  private config: RouterConfig;
  private torrentBackend: TorrentBackend;
  private backendManager: BackendManager;
  private moderationService: ContentModerationService;
  private popularityTracker: PopularityTracker;
  private swarmCache: Map<string, { info: SwarmInfo; timestamp: number }> = new Map();

  constructor(config: Partial<RouterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.torrentBackend = getTorrentBackend();
    this.backendManager = createBackendManager();
    this.moderationService = getModerationService();
    this.popularityTracker = new PopularityTracker();
  }

  /**
   * Route content request to best delivery method
   */
  async route(
    identifier: ContentIdentifier,
    clientInfo: ClientInfo,
    size?: number
  ): Promise<RouteDecision> {
    const contentHash = identifier.contentHash;

    // Check moderation
    const canServe = await this.moderationService.canServe(contentHash);
    if (!canServe) {
      throw new Error('Content blocked');
    }

    // Record access
    this.popularityTracker.record(contentHash);
    const popularity = this.popularityTracker.getPopularity(contentHash);

    // Build route options
    const routes: DeliveryRoute[] = [];
    let reason = '';

    // Check torrent availability
    let swarmInfo: SwarmInfo | null = null;
    if (identifier.infohash) {
      swarmInfo = await this.getSwarmInfo(identifier.infohash);
    }

    // Decision logic
    const isLargeFile = size && size > this.config.largeSizeThreshold;
    const isHotContent = popularity > this.config.hotContentThreshold;
    const hasTorrentSwarm = swarmInfo && swarmInfo.seeders >= this.config.torrentThreshold;

    // Route 1: Torrent (preferred for large/hot content with swarm)
    if (identifier.infohash && (isLargeFile || isHotContent || clientInfo.preferTorrent) && hasTorrentSwarm) {
      routes.push({
        method: 'torrent',
        endpoint: identifier.magnetUri ?? `magnet:?xt=urn:btih:${identifier.infohash}`,
        latencyEstimate: this.estimateTorrentLatency(swarmInfo!),
        cost: 0n,
        fallbacks: [],
      });
      reason = isLargeFile ? 'large-file' : isHotContent ? 'hot-content' : 'user-preference';
    }

    // Route 2: CDN Edge (low latency, cached content)
    if (this.config.cdnEdgeEndpoint) {
      routes.push({
        method: 'cdn',
        endpoint: `${this.config.cdnEdgeEndpoint}/content/${contentHash}`,
        latencyEstimate: 50,
        cost: 0n,
        fallbacks: [],
      });
      if (!reason) reason = 'cdn-edge';
    }

    // Route 3: IPFS Gateway
    if (identifier.cid) {
      routes.push({
        method: 'ipfs',
        endpoint: `${this.config.ipfsGatewayUrl}/ipfs/${identifier.cid}`,
        latencyEstimate: 200,
        cost: 0n,
        fallbacks: [],
      });
      if (!reason) reason = 'ipfs-fallback';
    }

    // Route 4: Proxy (for censorship resistance)
    if (clientInfo.requiresProxy) {
      routes.push({
        method: 'proxy',
        endpoint: '/proxy/request',
        latencyEstimate: 300,
        cost: 100000000000000n, // 0.0001 ETH per request
        fallbacks: [],
      });
    }

    // Sort by latency estimate
    routes.sort((a, b) => a.latencyEstimate - b.latencyEstimate);

    if (routes.length === 0) {
      throw new Error('No delivery routes available');
    }

    return {
      primary: routes[0],
      fallbacks: routes.slice(1),
      contentHash,
      size: size ?? 0,
      reason,
    };
  }

  /**
   * Get swarm info with caching
   */
  private async getSwarmInfo(infohash: string): Promise<SwarmInfo | null> {
    const cached = this.swarmCache.get(infohash);
    const now = Date.now();

    // Cache for 5 minutes
    if (cached && now - cached.timestamp < 300000) {
      return cached.info;
    }

    const info = await this.torrentBackend.getSwarmInfo(infohash);
    this.swarmCache.set(infohash, { info, timestamp: now });
    return info;
  }

  /**
   * Estimate torrent download latency based on swarm
   */
  private estimateTorrentLatency(swarm: SwarmInfo): number {
    // More seeders = faster
    if (swarm.seeders >= 10) return 100;
    if (swarm.seeders >= 5) return 150;
    if (swarm.seeders >= 2) return 250;
    return 500;
  }

  /**
   * Pre-warm content routing
   */
  async warmContent(identifier: ContentIdentifier): Promise<void> {
    // Add to torrent client to start seeding
    if (identifier.magnetUri) {
      await this.torrentBackend.addTorrentToSeed(identifier.magnetUri);
    }
  }

  /**
   * Get routing statistics
   */
  getStats(): {
    torrentRoutes: number;
    cdnRoutes: number;
    ipfsRoutes: number;
    proxyRoutes: number;
    avgLatency: number;
  } {
    // Would track actual routing decisions
    return {
      torrentRoutes: 0,
      cdnRoutes: 0,
      ipfsRoutes: 0,
      proxyRoutes: 0,
      avgLatency: 0,
    };
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.popularityTracker.destroy();
  }
}

// ============ Factory ============

let globalRouter: ContentRouter | null = null;

export function getContentRouter(config?: Partial<RouterConfig>): ContentRouter {
  if (!globalRouter) {
    globalRouter = new ContentRouter(config);
  }
  return globalRouter;
}

export function resetContentRouter(): void {
  if (globalRouter) {
    globalRouter.destroy();
    globalRouter = null;
  }
}
