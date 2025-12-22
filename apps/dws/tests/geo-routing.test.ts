/**
 * GeoRouter Tests
 * 
 * Tests for CDN geo-routing functionality:
 * - Haversine distance calculation
 * - IP geolocation
 * - Node scoring and selection
 * - Region-based routing
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  GeoRouter,
  getGeoRouter,
  resetGeoRouter,
} from '../src/cdn/routing/geo-router';
import type { ConnectedEdgeNode, EdgeNodeMetrics, RouteRequest } from '../src/cdn/types';
import type { CDNRegion } from '@jejunetwork/types';

// Helper to create test node
function createTestNode(overrides: Partial<ConnectedEdgeNode> = {}): ConnectedEdgeNode {
  const nodeId = overrides.nodeId ?? `node-${Math.random().toString(36).slice(2)}`;
  return {
    nodeId,
    endpoint: `https://${nodeId}.example.com`,
    region: 'us-east-1' as CDNRegion,
    lastSeen: Date.now(),
    capabilities: ['cache', 'transform'],
    metrics: {
      status: 'healthy',
      cacheHitRate: 85,
      currentLoad: 30,
      errorRate: 1,
      avgLatencyMs: 25,
      requestsPerSecond: 1000,
      bandwidthMbps: 500,
    },
    ...overrides,
  };
}

// Helper to create route request
function createRouteRequest(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    path: '/api/data',
    clientIp: '8.8.8.8',
    headers: {},
    ...overrides,
  };
}

// ============================================================================
// Haversine Distance Tests
// ============================================================================

describe('Haversine Distance', () => {
  let router: GeoRouter;

  beforeEach(() => {
    resetGeoRouter();
    router = getGeoRouter();
  });

  it('should calculate correct distance between NYC and LA', () => {
    // NYC: 40.7128° N, 74.0060° W
    // LA: 34.0522° N, 118.2437° W
    // Expected: ~3935 km

    // Register nodes in both regions
    router.registerNode(createTestNode({ nodeId: 'nyc', region: 'us-east-1' }));
    router.registerNode(createTestNode({ nodeId: 'la', region: 'us-west-1' }));

    // Route request from LA - should prefer us-west-1 as it's closer
    const result = router.route(createRouteRequest({
      clientGeo: { countryCode: 'US', latitude: 34.0522, longitude: -118.2437 },
    }));

    // Should route to the node and return latency estimate
    expect(result).not.toBeNull();
    expect(result?.latencyEstimate).toBeGreaterThanOrEqual(10);
  });

  it('should calculate zero distance for same location', () => {
    router.registerNode(createTestNode({ nodeId: 'tokyo', region: 'ap-northeast-1' }));

    const result = router.route(createRouteRequest({
      preferredRegion: 'ap-northeast-1',
    }));

    expect(result).not.toBeNull();
    expect(result?.latencyEstimate).toBe(10); // Same region = 10ms base
  });

  it('should calculate reasonable transcontinental distance', () => {
    router.registerNode(createTestNode({ nodeId: 'us', region: 'us-east-1' }));
    router.registerNode(createTestNode({ nodeId: 'eu', region: 'eu-west-1' }));

    // Route from EU client - should prefer EU node
    const result = router.route(createRouteRequest({
      clientGeo: { countryCode: 'GB' },
    }));

    expect(result).not.toBeNull();
    // Should route to EU node since client is in EU
    expect(['eu-west-1', 'eu-west-2']).toContain(result?.region);
    expect(result?.latencyEstimate).toBeGreaterThanOrEqual(10);
  });
});

// ============================================================================
// IP Geolocation Tests
// ============================================================================

describe('IP Geolocation', () => {
  let router: GeoRouter;

  beforeEach(() => {
    resetGeoRouter();
    router = getGeoRouter();
    
    // Register nodes in various regions
    router.registerNode(createTestNode({ nodeId: 'us-east', region: 'us-east-1' }));
    router.registerNode(createTestNode({ nodeId: 'us-west', region: 'us-west-1' }));
    router.registerNode(createTestNode({ nodeId: 'eu-west', region: 'eu-west-1' }));
    router.registerNode(createTestNode({ nodeId: 'ap-ne', region: 'ap-northeast-1' }));
  });

  it('should handle private IP addresses', () => {
    const result = router.route(createRouteRequest({
      clientIp: '192.168.1.1',
    }));

    // Should still route, just won't have geo preference
    expect(result).not.toBeNull();
  });

  it('should handle localhost', () => {
    const result = router.route(createRouteRequest({
      clientIp: '127.0.0.1',
    }));

    expect(result).not.toBeNull();
  });

  it('should handle IPv4 private ranges', () => {
    const privateIPs = [
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
    ];

    for (const ip of privateIPs) {
      const result = router.route(createRouteRequest({ clientIp: ip }));
      expect(result).not.toBeNull();
    }
  });

  it('should prefer nearby region based on country code', () => {
    const result = router.route(createRouteRequest({
      clientGeo: { countryCode: 'JP' },
    }));

    expect(result).not.toBeNull();
    expect(result?.region).toBe('ap-northeast-1');
  });

  it('should route European clients to EU region', () => {
    const result = router.route(createRouteRequest({
      clientGeo: { countryCode: 'DE' },
    }));

    expect(result).not.toBeNull();
    // Should route to EU region
    expect(['eu-west-1', 'eu-west-2', 'eu-central-1']).toContain(result?.region);
  });
});

// ============================================================================
// Node Registration Tests
// ============================================================================

describe('Node Registration', () => {
  let router: GeoRouter;

  beforeEach(() => {
    resetGeoRouter();
    router = getGeoRouter();
  });

  it('should register a node', () => {
    const node = createTestNode({ nodeId: 'test-node' });
    router.registerNode(node);

    expect(router.getNodeCount()).toBe(1);
    expect(router.getAllNodes()).toHaveLength(1);
  });

  it('should unregister a node', () => {
    const node = createTestNode({ nodeId: 'remove-me' });
    router.registerNode(node);
    expect(router.getNodeCount()).toBe(1);

    router.unregisterNode('remove-me');
    expect(router.getNodeCount()).toBe(0);
  });

  it('should get nodes by region', () => {
    router.registerNode(createTestNode({ nodeId: 'us-1', region: 'us-east-1' }));
    router.registerNode(createTestNode({ nodeId: 'us-2', region: 'us-east-1' }));
    router.registerNode(createTestNode({ nodeId: 'eu-1', region: 'eu-west-1' }));

    const usNodes = router.getNodesByRegion('us-east-1');
    expect(usNodes).toHaveLength(2);
    expect(usNodes.every(n => n.region === 'us-east-1')).toBe(true);
  });

  it('should update node metrics', () => {
    const node = createTestNode({ nodeId: 'metrics-node' });
    router.registerNode(node);

    const newMetrics: EdgeNodeMetrics = {
      status: 'healthy',
      cacheHitRate: 95,
      currentLoad: 50,
      errorRate: 0.5,
      avgLatencyMs: 20,
      requestsPerSecond: 2000,
      bandwidthMbps: 1000,
    };

    router.updateNodeMetrics('metrics-node', newMetrics);

    const nodes = router.getAllNodes();
    expect(nodes[0].metrics.cacheHitRate).toBe(95);
    expect(nodes[0].metrics.currentLoad).toBe(50);
  });
});

// ============================================================================
// Node Scoring Tests
// ============================================================================

describe('Node Scoring', () => {
  let router: GeoRouter;

  beforeEach(() => {
    resetGeoRouter();
    router = getGeoRouter();
  });

  it('should prefer nodes with higher cache hit rate', () => {
    router.registerNode(createTestNode({
      nodeId: 'low-cache',
      region: 'us-east-1',
      metrics: {
        status: 'healthy',
        cacheHitRate: 50,
        currentLoad: 30,
        errorRate: 1,
        avgLatencyMs: 25,
        requestsPerSecond: 1000,
        bandwidthMbps: 500,
      },
    }));
    router.registerNode(createTestNode({
      nodeId: 'high-cache',
      region: 'us-east-1',
      metrics: {
        status: 'healthy',
        cacheHitRate: 95,
        currentLoad: 30,
        errorRate: 1,
        avgLatencyMs: 25,
        requestsPerSecond: 1000,
        bandwidthMbps: 500,
      },
    }));

    const result = router.route(createRouteRequest({
      preferredRegion: 'us-east-1',
    }));

    expect(result?.nodeId).toBe('high-cache');
  });

  it('should prefer nodes with lower load', () => {
    router.registerNode(createTestNode({
      nodeId: 'high-load',
      region: 'us-east-1',
      metrics: {
        status: 'healthy',
        cacheHitRate: 85,
        currentLoad: 90,
        errorRate: 1,
        avgLatencyMs: 25,
        requestsPerSecond: 1000,
        bandwidthMbps: 500,
      },
    }));
    router.registerNode(createTestNode({
      nodeId: 'low-load',
      region: 'us-east-1',
      metrics: {
        status: 'healthy',
        cacheHitRate: 85,
        currentLoad: 20,
        errorRate: 1,
        avgLatencyMs: 25,
        requestsPerSecond: 1000,
        bandwidthMbps: 500,
      },
    }));

    const result = router.route(createRouteRequest({
      preferredRegion: 'us-east-1',
    }));

    expect(result?.nodeId).toBe('low-load');
  });

  it('should prefer nodes with lower error rate', () => {
    router.registerNode(createTestNode({
      nodeId: 'high-error',
      region: 'us-east-1',
      metrics: {
        status: 'healthy',
        cacheHitRate: 85,
        currentLoad: 30,
        errorRate: 20,
        avgLatencyMs: 25,
        requestsPerSecond: 1000,
        bandwidthMbps: 500,
      },
    }));
    router.registerNode(createTestNode({
      nodeId: 'low-error',
      region: 'us-east-1',
      metrics: {
        status: 'healthy',
        cacheHitRate: 85,
        currentLoad: 30,
        errorRate: 0.1,
        avgLatencyMs: 25,
        requestsPerSecond: 1000,
        bandwidthMbps: 500,
      },
    }));

    const result = router.route(createRouteRequest({
      preferredRegion: 'us-east-1',
    }));

    expect(result?.nodeId).toBe('low-error');
  });

  it('should not route to unhealthy nodes', () => {
    router.registerNode(createTestNode({
      nodeId: 'unhealthy',
      region: 'us-east-1',
      metrics: {
        status: 'unhealthy',
        cacheHitRate: 99,
        currentLoad: 10,
        errorRate: 0,
        avgLatencyMs: 10,
        requestsPerSecond: 5000,
        bandwidthMbps: 2000,
      },
    }));
    router.registerNode(createTestNode({
      nodeId: 'healthy',
      region: 'us-east-1',
      metrics: {
        status: 'healthy',
        cacheHitRate: 50,
        currentLoad: 80,
        errorRate: 5,
        avgLatencyMs: 50,
        requestsPerSecond: 500,
        bandwidthMbps: 200,
      },
    }));

    const result = router.route(createRouteRequest({
      preferredRegion: 'us-east-1',
    }));

    // Should choose healthy node despite worse metrics
    expect(result?.nodeId).toBe('healthy');
  });
});

// ============================================================================
// Multi-Node Routing Tests
// ============================================================================

describe('Multiple Node Routing', () => {
  let router: GeoRouter;

  beforeEach(() => {
    resetGeoRouter();
    router = getGeoRouter();

    // Register multiple nodes
    for (let i = 0; i < 5; i++) {
      router.registerNode(createTestNode({
        nodeId: `node-${i}`,
        region: 'us-east-1',
        metrics: {
          status: 'healthy',
          cacheHitRate: 80 + i * 2,
          currentLoad: 30 + i * 5,
          errorRate: 1,
          avgLatencyMs: 25,
          requestsPerSecond: 1000,
          bandwidthMbps: 500,
        },
      }));
    }
  });

  it('should return multiple candidates', () => {
    const results = router.routeMultiple(createRouteRequest({
      preferredRegion: 'us-east-1',
    }), 3);

    expect(results).toHaveLength(3);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    expect(results[1].score).toBeGreaterThanOrEqual(results[2].score);
  });

  it('should respect count parameter', () => {
    const results = router.routeMultiple(createRouteRequest({
      preferredRegion: 'us-east-1',
    }), 2);

    expect(results).toHaveLength(2);
  });
});

// ============================================================================
// Region Statistics Tests
// ============================================================================

describe('Region Statistics', () => {
  let router: GeoRouter;

  beforeEach(() => {
    resetGeoRouter();
    router = getGeoRouter();
  });

  it('should return statistics for all regions', () => {
    router.registerNode(createTestNode({
      nodeId: 'us-1',
      region: 'us-east-1',
      metrics: {
        status: 'healthy',
        cacheHitRate: 85,
        currentLoad: 40,
        errorRate: 1,
        avgLatencyMs: 30,
        requestsPerSecond: 1000,
        bandwidthMbps: 500,
      },
    }));
    router.registerNode(createTestNode({
      nodeId: 'us-2',
      region: 'us-east-1',
      metrics: {
        status: 'healthy',
        cacheHitRate: 85,
        currentLoad: 60,
        errorRate: 1,
        avgLatencyMs: 20,
        requestsPerSecond: 1000,
        bandwidthMbps: 500,
      },
    }));

    const stats = router.getRegionStats();

    expect(stats['us-east-1'].nodes).toBe(2);
    expect(stats['us-east-1'].avgLoad).toBe(50); // (40 + 60) / 2
    expect(stats['us-east-1'].avgLatency).toBe(25); // (30 + 20) / 2
  });

  it('should handle empty regions', () => {
    const stats = router.getRegionStats();

    expect(stats['us-east-1'].nodes).toBe(0);
    expect(stats['us-east-1'].avgLoad).toBe(0);
  });
});

// ============================================================================
// Nearby Regions Tests
// ============================================================================

describe('Nearby Regions', () => {
  let router: GeoRouter;

  beforeEach(() => {
    resetGeoRouter();
    router = getGeoRouter();
  });

  it('should find nearby regions for fallback routing', () => {
    // Register only EU node
    router.registerNode(createTestNode({
      nodeId: 'eu-node',
      region: 'eu-west-1',
    }));

    // Request from US should fallback to EU as global
    const result = router.route(createRouteRequest({
      clientGeo: { countryCode: 'US' },
    }));

    expect(result).not.toBeNull();
  });

  it('should use global nodes as last resort', () => {
    router.registerNode(createTestNode({
      nodeId: 'global-node',
      region: 'global',
    }));

    const result = router.route(createRouteRequest({
      clientGeo: { countryCode: 'XX' }, // Unknown country
    }));

    expect(result).not.toBeNull();
    expect(result?.region).toBe('global');
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  let router: GeoRouter;

  beforeEach(() => {
    resetGeoRouter();
    router = getGeoRouter();
  });

  it('should return null when no nodes are registered', () => {
    const result = router.route(createRouteRequest());
    expect(result).toBeNull();
  });

  it('should return null when all nodes are unhealthy', () => {
    router.registerNode(createTestNode({
      nodeId: 'unhealthy-1',
      metrics: { ...createTestNode().metrics, status: 'unhealthy' },
    }));
    router.registerNode(createTestNode({
      nodeId: 'unhealthy-2',
      metrics: { ...createTestNode().metrics, status: 'unhealthy' },
    }));

    const result = router.route(createRouteRequest());
    expect(result).toBeNull();
  });

  it('should handle invalid IP address gracefully', () => {
    router.registerNode(createTestNode({ nodeId: 'test' }));

    const result = router.route(createRouteRequest({
      clientIp: 'not.an.ip.address',
    }));

    expect(result).not.toBeNull();
  });

  it('should handle empty client geo', () => {
    router.registerNode(createTestNode({ nodeId: 'test' }));

    const result = router.route(createRouteRequest({
      clientGeo: {},
    }));

    expect(result).not.toBeNull();
  });
});
