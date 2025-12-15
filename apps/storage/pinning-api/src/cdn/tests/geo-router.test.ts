/**
 * Geo Router Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GeoRouter, resetGeoRouter } from '../routing/geo-router';
import type { ConnectedEdgeNode, EdgeNodeMetrics } from '../types';
import type { CDNRegion } from '@jejunetwork/types';

function createMockNode(
  nodeId: string,
  region: CDNRegion,
  overrides: Partial<ConnectedEdgeNode> = {}
): ConnectedEdgeNode {
  const defaultMetrics: EdgeNodeMetrics = {
    nodeId,
    region,
    uptime: 86400,
    requestsTotal: 1000,
    requestsPerSecond: 10,
    bytesServedTotal: 1000000,
    bandwidthMbps: 100,
    cacheHits: 800,
    cacheMisses: 200,
    cacheHitRate: 80,
    cacheSizeBytes: 500000000,
    cacheEntries: 1000,
    avgLatencyMs: 20,
    p50LatencyMs: 15,
    p95LatencyMs: 50,
    p99LatencyMs: 100,
    errorCount: 10,
    errorRate: 1,
    currentLoad: 50,
    cpuUsage: 50,
    memoryUsage: 60,
    activeConnections: 100,
    status: 'healthy',
    lastUpdated: Date.now(),
  };

  return {
    nodeId,
    address: '0x1234567890123456789012345678901234567890',
    endpoint: `https://${nodeId}.cdn.example.com`,
    region,
    metrics: { ...defaultMetrics, ...overrides.metrics },
    lastSeen: Date.now(),
    connectionId: crypto.randomUUID(),
    ...overrides,
  };
}

describe('GeoRouter', () => {
  let router: GeoRouter;

  beforeEach(() => {
    resetGeoRouter();
    router = new GeoRouter();
  });

  afterEach(() => {
    resetGeoRouter();
  });

  describe('Node Registration', () => {
    it('should register nodes', () => {
      const node = createMockNode('node-1', 'us-east-1');
      router.registerNode(node);
      expect(router.getNodeCount()).toBe(1);
    });

    it('should register nodes in correct regions', () => {
      router.registerNode(createMockNode('node-us-1', 'us-east-1'));
      router.registerNode(createMockNode('node-us-2', 'us-west-1'));
      router.registerNode(createMockNode('node-eu-1', 'eu-west-1'));

      const usEastNodes = router.getNodesByRegion('us-east-1');
      const usWestNodes = router.getNodesByRegion('us-west-1');
      const euWestNodes = router.getNodesByRegion('eu-west-1');

      expect(usEastNodes.length).toBe(1);
      expect(usWestNodes.length).toBe(1);
      expect(euWestNodes.length).toBe(1);
    });

    it('should unregister nodes', () => {
      const node = createMockNode('node-1', 'us-east-1');
      router.registerNode(node);
      expect(router.getNodeCount()).toBe(1);

      router.unregisterNode('node-1');
      expect(router.getNodeCount()).toBe(0);
    });
  });

  describe('Routing', () => {
    beforeEach(() => {
      // Set up nodes in various regions
      router.registerNode(createMockNode('node-us-east-1', 'us-east-1'));
      router.registerNode(createMockNode('node-us-west-1', 'us-west-1'));
      router.registerNode(createMockNode('node-eu-west-1', 'eu-west-1'));
      router.registerNode(createMockNode('node-ap-1', 'ap-northeast-1'));
    });

    it('should route to same region when available', () => {
      const decision = router.route({
        clientIp: '1.2.3.4',
        path: '/index.html',
        preferredRegion: 'us-east-1',
      });

      expect(decision).not.toBeNull();
      expect(decision!.region).toBe('us-east-1');
    });

    it('should route to nearest region when preferred not available', () => {
      const decision = router.route({
        clientIp: '1.2.3.4',
        path: '/index.html',
        preferredRegion: 'us-east-2', // No nodes in this region
      });

      expect(decision).not.toBeNull();
      // Should fallback to us-east-1 (same geography)
      expect(['us-east-1', 'us-west-1']).toContain(decision!.region);
    });

    it('should return null when no nodes available', () => {
      resetGeoRouter();
      router = new GeoRouter();

      const decision = router.route({
        clientIp: '1.2.3.4',
        path: '/index.html',
      });

      expect(decision).toBeNull();
    });

    it('should return multiple routes for load balancing', () => {
      const routes = router.routeMultiple(
        { clientIp: '1.2.3.4', path: '/index.html' },
        3
      );

      expect(routes.length).toBeLessThanOrEqual(3);
      expect(routes.length).toBeGreaterThan(0);
    });
  });

  describe('Scoring', () => {
    it('should prefer healthy nodes over unhealthy', () => {
      const healthyNode = createMockNode('healthy', 'us-east-1');
      const unhealthyNode = createMockNode('unhealthy', 'us-east-1', {
        metrics: {
          ...createMockNode('unhealthy', 'us-east-1').metrics,
          status: 'unhealthy',
        },
      });

      router.registerNode(healthyNode);
      router.registerNode(unhealthyNode);

      const decision = router.route({
        clientIp: '1.2.3.4',
        path: '/index.html',
        preferredRegion: 'us-east-1',
      });

      expect(decision).not.toBeNull();
      expect(decision!.nodeId).toBe('healthy');
    });

    it('should prefer nodes with higher cache hit rate', () => {
      const highCacheNode = createMockNode('high-cache', 'us-east-1', {
        metrics: {
          ...createMockNode('high-cache', 'us-east-1').metrics,
          cacheHitRate: 95,
          currentLoad: 50,
        },
      });

      const lowCacheNode = createMockNode('low-cache', 'us-east-1', {
        metrics: {
          ...createMockNode('low-cache', 'us-east-1').metrics,
          cacheHitRate: 20,
          currentLoad: 50,
        },
      });

      router.registerNode(highCacheNode);
      router.registerNode(lowCacheNode);

      const decision = router.route({
        clientIp: '1.2.3.4',
        path: '/index.html',
        preferredRegion: 'us-east-1',
      });

      expect(decision).not.toBeNull();
      expect(decision!.nodeId).toBe('high-cache');
    });

    it('should prefer nodes with lower load', () => {
      const lowLoadNode = createMockNode('low-load', 'us-east-1', {
        metrics: {
          ...createMockNode('low-load', 'us-east-1').metrics,
          currentLoad: 20,
          cacheHitRate: 80,
        },
      });

      const highLoadNode = createMockNode('high-load', 'us-east-1', {
        metrics: {
          ...createMockNode('high-load', 'us-east-1').metrics,
          currentLoad: 95,
          cacheHitRate: 80,
        },
      });

      router.registerNode(lowLoadNode);
      router.registerNode(highLoadNode);

      const decision = router.route({
        clientIp: '1.2.3.4',
        path: '/index.html',
        preferredRegion: 'us-east-1',
      });

      expect(decision).not.toBeNull();
      expect(decision!.nodeId).toBe('low-load');
    });
  });

  describe('Region Stats', () => {
    beforeEach(() => {
      router.registerNode(createMockNode('node-1', 'us-east-1', {
        metrics: {
          ...createMockNode('node-1', 'us-east-1').metrics,
          currentLoad: 30,
          avgLatencyMs: 20,
        },
      }));
      router.registerNode(createMockNode('node-2', 'us-east-1', {
        metrics: {
          ...createMockNode('node-2', 'us-east-1').metrics,
          currentLoad: 50,
          avgLatencyMs: 30,
        },
      }));
      router.registerNode(createMockNode('node-3', 'eu-west-1', {
        metrics: {
          ...createMockNode('node-3', 'eu-west-1').metrics,
          currentLoad: 40,
          avgLatencyMs: 25,
        },
      }));
    });

    it('should calculate region stats', () => {
      const stats = router.getRegionStats();

      expect(stats['us-east-1']).toBeDefined();
      expect(stats['us-east-1'].nodes).toBe(2);
      expect(stats['us-east-1'].avgLoad).toBe(40); // (30+50)/2
      expect(stats['us-east-1'].avgLatency).toBe(25); // (20+30)/2

      expect(stats['eu-west-1']).toBeDefined();
      expect(stats['eu-west-1'].nodes).toBe(1);
      expect(stats['eu-west-1'].avgLoad).toBe(40);
      expect(stats['eu-west-1'].avgLatency).toBe(25);
    });

    it('should return empty stats for regions without nodes', () => {
      const stats = router.getRegionStats();
      
      expect(stats['ap-northeast-1']).toBeDefined();
      expect(stats['ap-northeast-1'].nodes).toBe(0);
    });
  });

  describe('Metrics Updates', () => {
    it('should update node metrics', () => {
      const node = createMockNode('node-1', 'us-east-1');
      router.registerNode(node);

      const newMetrics: EdgeNodeMetrics = {
        ...node.metrics,
        currentLoad: 80,
        cacheHitRate: 95,
        avgLatencyMs: 10,
      };

      router.updateNodeMetrics('node-1', newMetrics);

      const nodes = router.getAllNodes();
      const updatedNode = nodes.find(n => n.nodeId === 'node-1');

      expect(updatedNode).toBeDefined();
      expect(updatedNode!.metrics.currentLoad).toBe(80);
      expect(updatedNode!.metrics.cacheHitRate).toBe(95);
      expect(updatedNode!.metrics.avgLatencyMs).toBe(10);
    });
  });
});

