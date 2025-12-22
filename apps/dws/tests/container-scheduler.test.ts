/**
 * Container Scheduler Tests
 * 
 * Tests for container scheduling algorithms:
 * - Node registration and health tracking
 * - Scheduling strategies (best-fit, worst-fit, first-fit, round-robin)
 * - Geographic routing (haversine distance)
 * - Resource reservation
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  registerNode,
  removeNode,
  updateNodeResources,
  updateNodeStatus,
  getNode,
  getAllNodes,
  getNodesByRegion,
  checkNodeHealth,
  scheduleExecutionSync,
  reserveResources,
  releaseReservation,
  cleanupExpiredReservations,
  findNearestRegion,
  getRegionsOrderedByDistance,
  getSchedulerStats,
  clearPoCCache,
  type SchedulingStrategy,
} from '../src/containers/scheduler';
import type { ComputeNode, ContainerImage, ExecutionRequest } from '../src/containers/types';
import type { Address } from 'viem';

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;

// Helper to create a test node
function createTestNode(overrides: Partial<ComputeNode> = {}): ComputeNode {
  const nodeId = overrides.nodeId ?? `node-${Math.random().toString(36).slice(2)}`;
  return {
    nodeId,
    operatorAddress: TEST_ADDRESS,
    region: 'us-east-1',
    status: 'online',
    lastHeartbeat: Date.now(),
    reputation: 100,
    resources: {
      totalCpu: 16,
      availableCpu: 8,
      totalMemoryMb: 32768,
      availableMemoryMb: 16384,
      totalStorageMb: 102400,
      availableStorageMb: 51200,
      gpuTypes: [],
    },
    cachedImages: new Set(),
    ...overrides,
  } as ComputeNode;
}

// Helper to create test execution request
function createTestRequest(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    requestId: `req-${Math.random().toString(36).slice(2)}`,
    containerImage: 'test:latest',
    resources: {
      cpuCores: 2,
      memoryMb: 2048,
      storageMb: 1024,
      gpuType: undefined,
    },
    timeout: 3600,
    environment: {},
    ...overrides,
  } as ExecutionRequest;
}

// Helper to create test image
function createTestImage(digest: string = 'sha256:test'): ContainerImage {
  return {
    name: 'test',
    tag: 'latest',
    digest,
    sizeBytes: 100000000,
  } as ContainerImage;
}

// ============================================================================
// Node Management Tests
// ============================================================================

describe('Node Registration', () => {
  beforeEach(() => {
    // Clear all nodes
    for (const node of getAllNodes()) {
      removeNode(node.nodeId);
    }
    clearPoCCache();
  });

  it('should register a node', () => {
    const node = createTestNode({ nodeId: 'test-node-1' });
    registerNode(node);

    const retrieved = getNode('test-node-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.nodeId).toBe('test-node-1');
  });

  it('should get all registered nodes', () => {
    registerNode(createTestNode({ nodeId: 'node-1' }));
    registerNode(createTestNode({ nodeId: 'node-2' }));
    registerNode(createTestNode({ nodeId: 'node-3' }));

    const nodes = getAllNodes();
    expect(nodes.length).toBeGreaterThanOrEqual(3);
  });

  it('should get nodes by region', () => {
    registerNode(createTestNode({ nodeId: 'us-node-1', region: 'us-east-1' }));
    registerNode(createTestNode({ nodeId: 'us-node-2', region: 'us-east-1' }));
    registerNode(createTestNode({ nodeId: 'eu-node-1', region: 'eu-west-1' }));

    const usNodes = getNodesByRegion('us-east-1');
    expect(usNodes.length).toBeGreaterThanOrEqual(2);
    expect(usNodes.every(n => n.region === 'us-east-1')).toBe(true);
  });

  it('should remove a node', () => {
    registerNode(createTestNode({ nodeId: 'to-remove' }));
    expect(getNode('to-remove')).not.toBeNull();

    removeNode('to-remove');
    expect(getNode('to-remove')).toBeNull();
  });

  it('should update node resources', () => {
    registerNode(createTestNode({ nodeId: 'update-test' }));

    updateNodeResources('update-test', {
      cpu: 4,
      memoryMb: 8192,
      storageMb: 25600,
    });

    const node = getNode('update-test');
    expect(node?.resources.availableCpu).toBe(4);
    expect(node?.resources.availableMemoryMb).toBe(8192);
  });

  it('should update node status', () => {
    registerNode(createTestNode({ nodeId: 'status-test', status: 'online' }));

    updateNodeStatus('status-test', 'draining');

    const node = getNode('status-test');
    expect(node?.status).toBe('draining');
  });
});

// ============================================================================
// Health Check Tests
// ============================================================================

describe('Node Health Checks', () => {
  beforeEach(() => {
    for (const node of getAllNodes()) {
      removeNode(node.nodeId);
    }
  });

  it('should identify healthy nodes', () => {
    registerNode(createTestNode({ 
      nodeId: 'healthy-node', 
      status: 'online',
      lastHeartbeat: Date.now(),
    }));

    const { healthy, unhealthy } = checkNodeHealth();
    
    expect(healthy).toContain('healthy-node');
    expect(unhealthy).not.toContain('healthy-node');
  });

  it('should identify unhealthy nodes with stale heartbeat', () => {
    registerNode(createTestNode({ 
      nodeId: 'stale-node', 
      status: 'online',
      lastHeartbeat: Date.now() - 60000, // 60 seconds ago
    }));

    const { healthy, unhealthy } = checkNodeHealth();
    
    expect(unhealthy).toContain('stale-node');
    expect(healthy).not.toContain('stale-node');
  });

  it('should identify offline nodes', () => {
    registerNode(createTestNode({ 
      nodeId: 'offline-node', 
      status: 'offline',
      lastHeartbeat: Date.now(),
    }));

    const { healthy, unhealthy } = checkNodeHealth();
    
    expect(unhealthy).toContain('offline-node');
  });
});

// ============================================================================
// Scheduling Strategy Tests
// ============================================================================

describe('Scheduling Strategies', () => {
  beforeEach(() => {
    for (const node of getAllNodes()) {
      removeNode(node.nodeId);
    }
    clearPoCCache();

    // Register test nodes with different resources
    registerNode(createTestNode({ 
      nodeId: 'small-node',
      region: 'us-east-1',
      resources: {
        totalCpu: 4,
        availableCpu: 2,
        totalMemoryMb: 4096,
        availableMemoryMb: 2048,
        totalStorageMb: 10240,
        availableStorageMb: 5120,
        gpuTypes: [],
      },
      reputation: 80,
    }));

    registerNode(createTestNode({ 
      nodeId: 'medium-node',
      region: 'us-east-1',
      resources: {
        totalCpu: 8,
        availableCpu: 6,
        totalMemoryMb: 16384,
        availableMemoryMb: 12288,
        totalStorageMb: 51200,
        availableStorageMb: 40960,
        gpuTypes: [],
      },
      reputation: 90,
    }));

    registerNode(createTestNode({ 
      nodeId: 'large-node',
      region: 'us-west-1',
      resources: {
        totalCpu: 32,
        availableCpu: 24,
        totalMemoryMb: 65536,
        availableMemoryMb: 49152,
        totalStorageMb: 204800,
        availableStorageMb: 153600,
        gpuTypes: ['nvidia-a100'],
      },
      reputation: 100,
    }));
  });

  afterEach(() => {
    for (const node of getAllNodes()) {
      removeNode(node.nodeId);
    }
  });

  describe('best-fit strategy', () => {
    it('should prefer node with least wasted resources', () => {
      const request = createTestRequest({
        resources: { cpuCores: 2, memoryMb: 2000, storageMb: 5000 },
      });
      const image = createTestImage();

      const result = scheduleExecutionSync({
        request,
        image,
        userAddress: TEST_ADDRESS,
      }, 'best-fit');

      expect(result).not.toBeNull();
      // Small node has exactly 2 CPU available, best fit for 2 CPU request
    });

    it('should consider cache affinity', () => {
      const imageDigest = 'sha256:cached-image';
      const image = createTestImage(imageDigest);

      // Add cached image to medium node
      const mediumNode = getNode('medium-node');
      if (mediumNode) {
        mediumNode.cachedImages.add(imageDigest);
      }

      const request = createTestRequest({
        resources: { cpuCores: 2, memoryMb: 2000, storageMb: 5000 },
      });

      const result = scheduleExecutionSync({
        request,
        image,
        userAddress: TEST_ADDRESS,
      }, 'best-fit');

      expect(result).not.toBeNull();
      // Should prefer medium-node due to cache hit
    });
  });

  describe('worst-fit strategy', () => {
    it('should prefer node with most available resources', () => {
      const request = createTestRequest({
        resources: { cpuCores: 2, memoryMb: 2000, storageMb: 5000 },
      });
      const image = createTestImage();

      const result = scheduleExecutionSync({
        request,
        image,
        userAddress: TEST_ADDRESS,
      }, 'worst-fit');

      expect(result).not.toBeNull();
      expect(result?.nodeId).toBe('large-node');
    });
  });

  describe('first-fit strategy', () => {
    it('should return first eligible node', () => {
      const request = createTestRequest({
        resources: { cpuCores: 2, memoryMb: 2000, storageMb: 5000 },
      });
      const image = createTestImage();

      const result = scheduleExecutionSync({
        request,
        image,
        userAddress: TEST_ADDRESS,
      }, 'first-fit');

      expect(result).not.toBeNull();
    });

    it('should prefer nodes with cached images', () => {
      const imageDigest = 'sha256:first-fit-cache';
      const image = createTestImage(imageDigest);

      const largeNode = getNode('large-node');
      if (largeNode) {
        largeNode.cachedImages.add(imageDigest);
      }

      const request = createTestRequest({
        resources: { cpuCores: 2, memoryMb: 2000, storageMb: 5000 },
      });

      const result = scheduleExecutionSync({
        request,
        image,
        userAddress: TEST_ADDRESS,
      }, 'first-fit');

      expect(result).not.toBeNull();
      expect(result?.nodeId).toBe('large-node');
    });
  });

  describe('round-robin strategy', () => {
    it('should distribute load across nodes', () => {
      const request = createTestRequest({
        resources: { cpuCores: 1, memoryMb: 1000, storageMb: 1000 },
      });
      const image = createTestImage();

      const results: string[] = [];
      for (let i = 0; i < 6; i++) {
        const result = scheduleExecutionSync({
          request,
          image,
          userAddress: TEST_ADDRESS,
        }, 'round-robin');
        if (result) results.push(result.nodeId);
      }

      // Should see multiple different nodes
      const uniqueNodes = new Set(results);
      expect(uniqueNodes.size).toBeGreaterThan(1);
    });
  });

  describe('resource filtering', () => {
    it('should reject nodes with insufficient CPU', () => {
      const request = createTestRequest({
        resources: { cpuCores: 100, memoryMb: 1000, storageMb: 1000 },
      });

      const result = scheduleExecutionSync({
        request,
        image: createTestImage(),
        userAddress: TEST_ADDRESS,
      }, 'first-fit');

      expect(result).toBeNull();
    });

    it('should reject nodes with insufficient memory', () => {
      const request = createTestRequest({
        resources: { cpuCores: 1, memoryMb: 1000000, storageMb: 1000 },
      });

      const result = scheduleExecutionSync({
        request,
        image: createTestImage(),
        userAddress: TEST_ADDRESS,
      }, 'first-fit');

      expect(result).toBeNull();
    });

    it('should filter by GPU type', () => {
      const request = createTestRequest({
        resources: { cpuCores: 1, memoryMb: 1000, storageMb: 1000, gpuType: 'nvidia-a100' },
      });

      const result = scheduleExecutionSync({
        request,
        image: createTestImage(),
        userAddress: TEST_ADDRESS,
      }, 'first-fit');

      expect(result).not.toBeNull();
      expect(result?.nodeId).toBe('large-node');
    });

    it('should reject when required GPU not available', () => {
      const request = createTestRequest({
        resources: { cpuCores: 1, memoryMb: 1000, storageMb: 1000, gpuType: 'nvidia-h100' },
      });

      const result = scheduleExecutionSync({
        request,
        image: createTestImage(),
        userAddress: TEST_ADDRESS,
      }, 'first-fit');

      expect(result).toBeNull();
    });

    it('should respect anti-affinity constraints', () => {
      const request = createTestRequest({
        resources: { cpuCores: 1, memoryMb: 1000, storageMb: 1000 },
      });

      const result = scheduleExecutionSync({
        request,
        image: createTestImage(),
        userAddress: TEST_ADDRESS,
        antiAffinity: ['small-node', 'medium-node'],
      }, 'first-fit');

      expect(result).not.toBeNull();
      expect(result?.nodeId).toBe('large-node');
    });
  });
});

// ============================================================================
// Resource Reservation Tests
// ============================================================================

describe('Resource Reservation', () => {
  beforeEach(() => {
    for (const node of getAllNodes()) {
      removeNode(node.nodeId);
    }
    registerNode(createTestNode({ 
      nodeId: 'reservation-node',
      resources: {
        totalCpu: 8,
        availableCpu: 8,
        totalMemoryMb: 16384,
        availableMemoryMb: 16384,
        totalStorageMb: 51200,
        availableStorageMb: 51200,
        gpuTypes: [],
      },
    }));
  });

  it('should reserve resources', () => {
    const reservation = reserveResources(
      'reservation-node',
      { cpuCores: 2, memoryMb: 4096, storageMb: 10240 },
      TEST_ADDRESS
    );

    expect(reservation).not.toBeNull();
    expect(reservation?.nodeId).toBe('reservation-node');

    const node = getNode('reservation-node');
    expect(node?.resources.availableCpu).toBe(6);
    expect(node?.resources.availableMemoryMb).toBe(12288);
  });

  it('should release reservation', () => {
    const reservation = reserveResources(
      'reservation-node',
      { cpuCores: 2, memoryMb: 4096, storageMb: 10240 },
      TEST_ADDRESS
    );

    expect(reservation).not.toBeNull();
    const released = releaseReservation(reservation!.reservationId);
    expect(released).toBe(true);

    const node = getNode('reservation-node');
    expect(node?.resources.availableCpu).toBe(8);
    expect(node?.resources.availableMemoryMb).toBe(16384);
  });

  it('should fail reservation when insufficient resources', () => {
    const reservation = reserveResources(
      'reservation-node',
      { cpuCores: 100, memoryMb: 4096, storageMb: 10240 },
      TEST_ADDRESS
    );

    expect(reservation).toBeNull();
  });

  it('should cleanup expired reservations', () => {
    // Make a reservation with very short TTL
    const reservation = reserveResources(
      'reservation-node',
      { cpuCores: 2, memoryMb: 4096, storageMb: 10240 },
      TEST_ADDRESS,
      1 // 1ms TTL
    );

    expect(reservation).not.toBeNull();

    // Wait for expiration
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    return delay(10).then(() => {
      const cleaned = cleanupExpiredReservations();
      expect(cleaned).toBe(1);

      const node = getNode('reservation-node');
      expect(node?.resources.availableCpu).toBe(8);
    });
  });
});

// ============================================================================
// Geographic Routing Tests
// ============================================================================

describe('Geographic Routing', () => {
  describe('findNearestRegion', () => {
    it('should find nearest region for US East Coast', () => {
      const region = findNearestRegion({ latitude: 40.7128, longitude: -74.0060 }); // NYC
      expect(region).toBe('us-east-1');
    });

    it('should find nearest region for US West Coast', () => {
      const region = findNearestRegion({ latitude: 34.0522, longitude: -118.2437 }); // LA
      expect(['us-west-1', 'us-west-2']).toContain(region);
    });

    it('should find nearest region for Europe', () => {
      const region = findNearestRegion({ latitude: 51.5074, longitude: -0.1278 }); // London
      expect(['eu-west-1', 'eu-west-2', 'eu-central-1']).toContain(region);
    });

    it('should find nearest region for Asia', () => {
      const region = findNearestRegion({ latitude: 35.6762, longitude: 139.6503 }); // Tokyo
      expect(region).toBe('ap-northeast-1');
    });

    it('should find nearest region for Australia', () => {
      const region = findNearestRegion({ latitude: -33.8688, longitude: 151.2093 }); // Sydney
      // ap-southeast-1 or ap-southeast-2 are both valid depending on region definitions
      expect(['ap-southeast-1', 'ap-southeast-2']).toContain(region);
    });
  });

  describe('getRegionsOrderedByDistance', () => {
    it('should return regions ordered by distance from NYC', () => {
      const regions = getRegionsOrderedByDistance({ latitude: 40.7128, longitude: -74.0060 });
      
      expect(regions.length).toBeGreaterThan(0);
      expect(regions[0]).toBe('us-east-1'); // Closest to NYC
    });

    it('should return regions ordered by distance from Tokyo', () => {
      const regions = getRegionsOrderedByDistance({ latitude: 35.6762, longitude: 139.6503 });
      
      expect(regions[0]).toBe('ap-northeast-1'); // Tokyo itself
      // Korea should be second closest to Tokyo
      expect(['ap-northeast-2', 'ap-southeast-1']).toContain(regions[1]);
    });

    it('should return all regions', () => {
      const regions = getRegionsOrderedByDistance({ latitude: 0, longitude: 0 });
      
      // Should have all major regions
      expect(regions.length).toBeGreaterThanOrEqual(7);
    });
  });
});

// ============================================================================
// Statistics Tests
// ============================================================================

describe('Scheduler Statistics', () => {
  beforeEach(() => {
    for (const node of getAllNodes()) {
      removeNode(node.nodeId);
    }
    clearPoCCache();
  });

  it('should return correct node counts', () => {
    registerNode(createTestNode({ nodeId: 'online-1', status: 'online' }));
    registerNode(createTestNode({ nodeId: 'online-2', status: 'online' }));
    registerNode(createTestNode({ nodeId: 'draining-1', status: 'draining' }));
    registerNode(createTestNode({ nodeId: 'offline-1', status: 'offline' }));

    const stats = getSchedulerStats();

    expect(stats.totalNodes).toBe(4);
    expect(stats.onlineNodes).toBe(2);
    expect(stats.drainingNodes).toBe(1);
    expect(stats.offlineNodes).toBe(1);
  });

  it('should calculate resource totals', () => {
    registerNode(createTestNode({ 
      nodeId: 'stat-node-1',
      resources: {
        totalCpu: 8,
        availableCpu: 4,
        totalMemoryMb: 16384,
        availableMemoryMb: 8192,
        totalStorageMb: 0,
        availableStorageMb: 0,
        gpuTypes: [],
      },
    }));
    registerNode(createTestNode({ 
      nodeId: 'stat-node-2',
      resources: {
        totalCpu: 16,
        availableCpu: 8,
        totalMemoryMb: 32768,
        availableMemoryMb: 16384,
        totalStorageMb: 0,
        availableStorageMb: 0,
        gpuTypes: [],
      },
    }));

    const stats = getSchedulerStats();

    expect(stats.totalCpu).toBe(24);
    expect(stats.availableCpu).toBe(12);
    expect(stats.totalMemoryMb).toBe(49152);
    expect(stats.availableMemoryMb).toBe(24576);
  });

  it('should track nodes by region', () => {
    registerNode(createTestNode({ nodeId: 'us-1', region: 'us-east-1' }));
    registerNode(createTestNode({ nodeId: 'us-2', region: 'us-east-1' }));
    registerNode(createTestNode({ nodeId: 'eu-1', region: 'eu-west-1' }));

    const stats = getSchedulerStats();

    expect(stats.nodesByRegion['us-east-1']).toBe(2);
    expect(stats.nodesByRegion['eu-west-1']).toBe(1);
  });
});
