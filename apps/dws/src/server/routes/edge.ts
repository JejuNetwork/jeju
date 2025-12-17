/**
 * Edge Coordination Routes
 * 
 * Coordinates wallet edge nodes for distributed CDN/caching/proxy services.
 */

import { Hono } from 'hono';
import type { Address } from 'viem';

// ============================================================================
// Types
// ============================================================================

interface EdgeNode {
  id: string;
  nodeType: 'wallet-edge' | 'full-node' | 'cdn-node';
  platform: string;
  operator?: Address;
  capabilities: {
    proxy: boolean;
    torrent: boolean;
    cdn: boolean;
    rpc: boolean;
    storage: boolean;
    maxCacheBytes: number;
    maxBandwidthMbps: number;
  };
  region: string;
  status: 'online' | 'offline' | 'busy';
  lastSeen: number;
  stats: {
    uptime: number;
    bytesServed: number;
    requestsServed: number;
    peersConnected: number;
    torrentsSeeding: number;
  };
}

interface CacheRequest {
  cid: string;
  priority: 'high' | 'normal' | 'low';
  regions?: string[];
  minReplicas?: number;
}

// ============================================================================
// State
// ============================================================================

const edgeNodes = new Map<string, EdgeNode>();
const websockets = new Map<string, WebSocket>();
const cacheRequests = new Map<string, CacheRequest>();

// Regions for geo-routing
const REGIONS = [
  'us-east', 'us-west', 'eu-west', 'eu-central',
  'asia-east', 'asia-south', 'oceania', 'global'
];

// ============================================================================
// Router
// ============================================================================

export function createEdgeRouter(): Hono {
  const router = new Hono();

  // ============================================================================
  // Health & Stats
  // ============================================================================

  router.get('/health', (c) => {
    const onlineNodes = Array.from(edgeNodes.values())
      .filter(n => n.status === 'online');
    
    const byType = new Map<string, number>();
    const byRegion = new Map<string, number>();
    let totalBandwidth = 0;
    let totalCache = 0;

    for (const node of onlineNodes) {
      byType.set(node.nodeType, (byType.get(node.nodeType) ?? 0) + 1);
      byRegion.set(node.region, (byRegion.get(node.region) ?? 0) + 1);
      totalBandwidth += node.capabilities.maxBandwidthMbps;
      totalCache += node.capabilities.maxCacheBytes;
    }

    return c.json({
      status: 'healthy',
      service: 'dws-edge-coordinator',
      nodes: {
        total: edgeNodes.size,
        online: onlineNodes.length,
        byType: Object.fromEntries(byType),
        byRegion: Object.fromEntries(byRegion),
      },
      capacity: {
        totalBandwidthMbps: totalBandwidth,
        totalCacheBytes: totalCache,
      },
      regions: REGIONS,
    });
  });

  // ============================================================================
  // Node Registration (HTTP fallback)
  // ============================================================================

  router.post('/register', async (c) => {
    const body = await c.req.json<{
      nodeType: EdgeNode['nodeType'];
      platform: string;
      operator?: Address;
      capabilities: EdgeNode['capabilities'];
      region?: string;
    }>();

    const nodeId = crypto.randomUUID();
    const node: EdgeNode = {
      id: nodeId,
      nodeType: body.nodeType,
      platform: body.platform,
      operator: body.operator,
      capabilities: body.capabilities,
      region: body.region ?? 'global',
      status: 'online',
      lastSeen: Date.now(),
      stats: {
        uptime: 0,
        bytesServed: 0,
        requestsServed: 0,
        peersConnected: 0,
        torrentsSeeding: 0,
      },
    };

    edgeNodes.set(nodeId, node);
    console.log(`[EdgeCoordinator] Node registered: ${nodeId} (${body.nodeType})`);

    return c.json({
      nodeId,
      status: 'registered',
      coordinator: '/edge/coordinate',
    }, 201);
  });

  // ============================================================================
  // Node Management
  // ============================================================================

  router.get('/nodes', (c) => {
    const region = c.req.query('region');
    const nodeType = c.req.query('type');
    const status = c.req.query('status') ?? 'online';

    let nodes = Array.from(edgeNodes.values());

    if (region) nodes = nodes.filter(n => n.region === region);
    if (nodeType) nodes = nodes.filter(n => n.nodeType === nodeType);
    if (status) nodes = nodes.filter(n => n.status === status);

    return c.json({
      nodes: nodes.map(n => ({
        id: n.id,
        nodeType: n.nodeType,
        platform: n.platform,
        region: n.region,
        status: n.status,
        capabilities: n.capabilities,
        stats: n.stats,
        lastSeen: n.lastSeen,
      })),
    });
  });

  router.get('/nodes/:nodeId', (c) => {
    const node = edgeNodes.get(c.req.param('nodeId'));
    if (!node) {
      return c.json({ error: 'Node not found' }, 404);
    }

    return c.json(node);
  });

  router.delete('/nodes/:nodeId', (c) => {
    const nodeId = c.req.param('nodeId');
    
    if (!edgeNodes.has(nodeId)) {
      return c.json({ error: 'Node not found' }, 404);
    }

    edgeNodes.delete(nodeId);
    websockets.get(nodeId)?.close();
    websockets.delete(nodeId);

    console.log(`[EdgeCoordinator] Node unregistered: ${nodeId}`);
    return c.json({ success: true });
  });

  // ============================================================================
  // Cache Management
  // ============================================================================

  router.post('/cache', async (c) => {
    const body = await c.req.json<CacheRequest>();

    if (!body.cid) {
      return c.json({ error: 'CID required' }, 400);
    }

    cacheRequests.set(body.cid, body);

    // Find nodes to cache
    const targetRegions = body.regions ?? ['global'];
    const minReplicas = body.minReplicas ?? 3;

    const targetNodes = findCacheNodes(targetRegions, minReplicas, body.priority);

    // Send cache requests
    for (const node of targetNodes) {
      const ws = websockets.get(node.id);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'cache_request',
          cid: body.cid,
          priority: body.priority,
        }));
      }
    }

    return c.json({
      cid: body.cid,
      targetNodes: targetNodes.length,
      regions: targetRegions,
    }, 202);
  });

  router.get('/cache/:cid', (c) => {
    const cid = c.req.param('cid');
    
    // Find nodes caching this content
    const cachingNodes = Array.from(edgeNodes.values()).filter(n => {
      // Would check node's cache in real implementation
      return n.status === 'online' && n.capabilities.cdn;
    });

    return c.json({
      cid,
      nodes: cachingNodes.length,
      regions: [...new Set(cachingNodes.map(n => n.region))],
    });
  });

  // ============================================================================
  // Content Routing
  // ============================================================================

  router.get('/route/:cid', (c) => {
    const cid = c.req.param('cid');
    const clientRegion = c.req.header('x-jeju-region') ?? 'global';
    
    // Find best node for this content
    const candidates = Array.from(edgeNodes.values())
      .filter(n => n.status === 'online' && n.capabilities.cdn)
      .sort((a, b) => {
        // Prefer same region
        const aRegion = a.region === clientRegion ? 0 : 1;
        const bRegion = b.region === clientRegion ? 0 : 1;
        if (aRegion !== bRegion) return aRegion - bRegion;

        // Then by availability
        return a.stats.requestsServed - b.stats.requestsServed;
      });

    if (candidates.length === 0) {
      return c.json({ error: 'No available nodes' }, 503);
    }

    const selected = candidates[0];
    
    return c.json({
      cid,
      nodeId: selected.id,
      region: selected.region,
      // In production, would return actual endpoint
      endpoint: `/storage/download/${cid}`,
    });
  });

  // ============================================================================
  // Earnings
  // ============================================================================

  router.get('/earnings/:nodeId', (c) => {
    const node = edgeNodes.get(c.req.param('nodeId'));
    if (!node) {
      return c.json({ error: 'Node not found' }, 404);
    }

    // Calculate earnings based on stats
    // In production, this would query on-chain rewards
    const bytesServedGB = node.stats.bytesServed / (1024 * 1024 * 1024);
    const estimatedEarnings = BigInt(Math.floor(bytesServedGB * 100)) * BigInt(10 ** 15); // 0.0001 ETH per GB

    return c.json({
      nodeId: node.id,
      bytesServed: node.stats.bytesServed,
      requestsServed: node.stats.requestsServed,
      uptime: node.stats.uptime,
      estimatedEarnings: estimatedEarnings.toString(),
      pendingClaim: '0', // Would check on-chain
    });
  });

  return router;
}

// ============================================================================
// WebSocket Handler
// ============================================================================

export function handleEdgeWebSocket(ws: WebSocket, nodeId?: string): void {
  let currentNodeId = nodeId;

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data as string);

    switch (message.type) {
      case 'register': {
        currentNodeId = crypto.randomUUID();
        const node: EdgeNode = {
          id: currentNodeId,
          nodeType: message.nodeType ?? 'wallet-edge',
          platform: message.platform ?? 'unknown',
          operator: message.operator,
          capabilities: message.capabilities ?? {
            proxy: false,
            torrent: false,
            cdn: true,
            rpc: false,
            storage: false,
            maxCacheBytes: 0,
            maxBandwidthMbps: 0,
          },
          region: message.region ?? 'global',
          status: 'online',
          lastSeen: Date.now(),
          stats: {
            uptime: 0,
            bytesServed: 0,
            requestsServed: 0,
            peersConnected: 0,
            torrentsSeeding: 0,
          },
        };

        edgeNodes.set(currentNodeId, node);
        websockets.set(currentNodeId, ws);

        ws.send(JSON.stringify({
          type: 'registered',
          nodeId: currentNodeId,
        }));

        console.log(`[EdgeCoordinator] WS node registered: ${currentNodeId}`);
        break;
      }

      case 'stats': {
        if (!currentNodeId) break;
        const node = edgeNodes.get(currentNodeId);
        if (node) {
          node.lastSeen = Date.now();
          node.status = 'online';
          if (message.stats) {
            Object.assign(node.stats, message.stats);
          }
        }
        break;
      }

      case 'heartbeat': {
        if (!currentNodeId) break;
        const node = edgeNodes.get(currentNodeId);
        if (node) {
          node.lastSeen = Date.now();
          node.status = 'online';
        }
        ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
        break;
      }

      case 'cache_complete': {
        // Node finished caching content
        console.log(`[EdgeCoordinator] Node ${currentNodeId} cached ${message.cid}`);
        break;
      }
    }
  };

  ws.onclose = () => {
    if (currentNodeId) {
      const node = edgeNodes.get(currentNodeId);
      if (node) {
        node.status = 'offline';
      }
      websockets.delete(currentNodeId);
      console.log(`[EdgeCoordinator] WS node disconnected: ${currentNodeId}`);
    }
  };

  ws.onerror = (error) => {
    console.error(`[EdgeCoordinator] WS error for ${currentNodeId}:`, error);
  };
}

// ============================================================================
// Helpers
// ============================================================================

function findCacheNodes(
  regions: string[],
  minReplicas: number,
  priority: 'high' | 'normal' | 'low'
): EdgeNode[] {
  const result: EdgeNode[] = [];

  for (const region of regions) {
    const regionNodes = Array.from(edgeNodes.values())
      .filter(n => 
        n.status === 'online' &&
        n.capabilities.cdn &&
        (region === 'global' || n.region === region)
      )
      .sort((a, b) => {
        // Prefer nodes with more capacity
        return b.capabilities.maxCacheBytes - a.capabilities.maxCacheBytes;
      });

    result.push(...regionNodes.slice(0, minReplicas));
  }

  // Deduplicate
  const seen = new Set<string>();
  return result.filter(n => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });
}

// ============================================================================
// Cleanup
// ============================================================================

// Mark stale nodes as offline
setInterval(() => {
  const now = Date.now();
  const staleThreshold = 120000; // 2 minutes

  for (const [id, node] of edgeNodes) {
    if (node.status === 'online' && now - node.lastSeen > staleThreshold) {
      node.status = 'offline';
      console.log(`[EdgeCoordinator] Node ${id} marked offline (stale)`);
    }
  }
}, 30000);

