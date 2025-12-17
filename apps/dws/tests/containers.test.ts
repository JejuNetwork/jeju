/**
 * Container Execution Tests
 * Tests for serverless container execution with warmth management
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import type { Address } from 'viem';

import {
  // Types
  type ContainerResources,
  type ExecutionRequest,
  type WarmthConfig,
  type ComputeNode,
  
  // Image Cache
  getCachedLayer,
  cacheLayer,
  invalidateLayer,
  getCacheStats,
  recordCacheHit,
  recordCacheMiss,
  analyzeDeduplication,
  clearCache,
  
  // Warm Pool
  getOrCreatePool,
  getPool,
  addInstance,
  getInstance,
  updateInstanceState,
  removeInstance,
  acquireWarmInstance,
  releaseInstance,
  getPoolStats,
  getAllPoolStats,
  prewarmInstances,
  cleanupPool,
  cleanupAllPools,
  onContainerEvent,
  
  // Executor
  executeContainer,
  executeBatch,
  getExecution,
  getExecutionResult,
  listExecutions,
  cancelExecution,
  calculateCost,
  estimateCost,
  getExecutorStats,
  cleanupExecutor,
  
  // Scheduler
  registerNode,
  updateNodeResources,
  updateNodeStatus,
  removeNode,
  getNode,
  getAllNodes,
  getNodesByRegion,
  scheduleExecution,
  reserveResources,
  releaseReservation,
  findNearestRegion,
  getSchedulerStats,
} from '../src/containers';

const TEST_USER: Address = '0x1234567890123456789012345678901234567890';
const TEST_IMAGE_DIGEST = 'sha256:abc123def456789';

// ============================================================================
// Image Cache Tests
// ============================================================================

describe('Image Cache', () => {
  beforeEach(() => {
    clearCache();
  });

  test('should cache and retrieve layers', () => {
    const digest = 'sha256:layer1';
    const cid = 'QmTestCid123';
    const size = 50 * 1024 * 1024; // 50MB
    const path = '/var/cache/layers/layer1';

    const cached = cacheLayer(digest, cid, size, path);

    expect(cached.digest).toBe(digest);
    expect(cached.cid).toBe(cid);
    expect(cached.size).toBe(size);
    expect(cached.hitCount).toBe(0);

    // Retrieve
    const retrieved = getCachedLayer(digest);
    expect(retrieved).toBeDefined();
    expect(retrieved?.hitCount).toBe(1);
  });

  test('should track cache hits and misses', () => {
    recordCacheHit();
    recordCacheHit();
    recordCacheMiss();

    const stats = getCacheStats();
    expect(stats.totalHits).toBe(2);
    expect(stats.totalMisses).toBe(1);
    expect(stats.hitRate).toBe(66.67);
  });

  test('should invalidate layers', () => {
    const digest = 'sha256:todelete';
    cacheLayer(digest, 'QmTest', 1024, '/path');

    expect(getCachedLayer(digest)).toBeDefined();

    const removed = invalidateLayer(digest);
    expect(removed).toBe(true);
    expect(getCachedLayer(digest)).toBeNull();
  });

  test('should analyze deduplication', () => {
    // Cache some layers
    cacheLayer('sha256:base', 'QmBase', 100 * 1024 * 1024, '/base');
    cacheLayer('sha256:app', 'QmApp', 50 * 1024 * 1024, '/app');

    const analysis = analyzeDeduplication();
    expect(analysis).toBeDefined();
    expect(analysis.deduplicationRatio).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// Warm Pool Tests
// ============================================================================

describe('Warm Pool', () => {
  const testDigest = `sha256:pool-test-${Date.now()}`;

  afterEach(() => {
    cleanupPool(testDigest);
  });

  test('should create pool with default config', () => {
    const pool = getOrCreatePool(testDigest);

    expect(pool.imageDigest).toBe(testDigest);
    expect(pool.config.keepWarmMs).toBe(60000);
    expect(pool.config.minWarmInstances).toBe(0);
    expect(pool.config.maxWarmInstances).toBe(10);
    expect(pool.instances.size).toBe(0);
  });

  test('should add and retrieve instances', () => {
    const resources: ContainerResources = {
      cpuCores: 2,
      memoryMb: 1024,
      storageMb: 2048,
    };

    const instance = addInstance(testDigest, 'inst-1', resources, TEST_USER, 'node-1');

    expect(instance.instanceId).toBe('inst-1');
    expect(instance.state).toBe('creating');
    expect(instance.resources.cpuCores).toBe(2);

    const retrieved = getInstance(testDigest, 'inst-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.instanceId).toBe('inst-1');
  });

  test('should update instance state', () => {
    const resources: ContainerResources = { cpuCores: 1, memoryMb: 512, storageMb: 1024 };
    addInstance(testDigest, 'inst-state', resources, TEST_USER, 'node-1');

    const updated = updateInstanceState(testDigest, 'inst-state', 'running', {
      startedAt: Date.now(),
      endpoint: 'http://localhost:8080',
      port: 8080,
    });

    expect(updated?.state).toBe('running');
    expect(updated?.endpoint).toBe('http://localhost:8080');
  });

  test('should acquire and release warm instances', async () => {
    const resources: ContainerResources = { cpuCores: 1, memoryMb: 512, storageMb: 1024 };
    const instance = addInstance(testDigest, 'inst-warm', resources, TEST_USER, 'node-1');

    // Make it warm
    updateInstanceState(testDigest, 'inst-warm', 'warm', {
      warmUntil: Date.now() + 60000,
    });

    // Acquire
    const acquired = await acquireWarmInstance(testDigest, 1000);
    expect(acquired).toBeDefined();
    expect(acquired?.instanceId).toBe('inst-warm');
    expect(acquired?.state).toBe('running');

    // Release
    releaseInstance(testDigest, 'inst-warm', true);
    const released = getInstance(testDigest, 'inst-warm');
    expect(released?.state).toBe('warm');
  });

  test('should return null when no warm instance available', async () => {
    const emptyDigest = `sha256:empty-${Date.now()}`;
    const result = await acquireWarmInstance(emptyDigest, 100);
    expect(result).toBeNull();
    cleanupPool(emptyDigest);
  });

  test('should track pool statistics', () => {
    const resources: ContainerResources = { cpuCores: 1, memoryMb: 512, storageMb: 1024 };
    addInstance(testDigest, 'inst-stats-1', resources, TEST_USER, 'node-1');
    addInstance(testDigest, 'inst-stats-2', resources, TEST_USER, 'node-1');

    updateInstanceState(testDigest, 'inst-stats-1', 'warm', { warmUntil: Date.now() + 60000 });
    updateInstanceState(testDigest, 'inst-stats-2', 'cooling');

    const stats = getPoolStats(testDigest);
    expect(stats).toBeDefined();
    expect(stats?.warmCount).toBe(1);
    expect(stats?.coolingCount).toBe(1);
  });

  test('should emit events', () => {
    const events: string[] = [];
    const unsubscribe = onContainerEvent((event) => {
      events.push(event.type);
    });

    const resources: ContainerResources = { cpuCores: 1, memoryMb: 512, storageMb: 1024 };
    addInstance(testDigest, 'inst-events', resources, TEST_USER, 'node-1');

    expect(events).toContain('instance_created');

    unsubscribe();
  });
});

// ============================================================================
// Executor Tests
// ============================================================================

describe('Executor', () => {
  afterEach(() => {
    cleanupExecutor();
  });

  test('should execute container', async () => {
    const request: ExecutionRequest = {
      imageRef: 'jeju/test:latest',
      command: ['/bin/echo', 'hello'],
      env: { TEST: 'true' },
      resources: { cpuCores: 1, memoryMb: 256, storageMb: 512 },
      mode: 'serverless',
      timeout: 30000,
      input: { data: 'test' },
    };

    const result = await executeContainer(request, TEST_USER);

    expect(result.executionId).toBeDefined();
    expect(result.status).toBe('success');
    expect(result.exitCode).toBe(0);
    expect(result.metrics).toBeDefined();
    expect(result.metrics.totalTimeMs).toBeGreaterThan(0);
  });

  test('should track cold starts', async () => {
    const request: ExecutionRequest = {
      imageRef: `jeju/cold-test-${Date.now()}:v1`,
      resources: { cpuCores: 1, memoryMb: 256, storageMb: 512 },
      mode: 'serverless',
      timeout: 30000,
    };

    const result = await executeContainer(request, TEST_USER);

    // First execution should be cold start
    expect(result.metrics.wasColdStart).toBe(true);
  });

  test('should execute batch', async () => {
    const requests: ExecutionRequest[] = Array(3)
      .fill(null)
      .map((_, i) => ({
        imageRef: `jeju/batch-test:v${i}`,
        resources: { cpuCores: 1, memoryMb: 256, storageMb: 512 },
        mode: 'serverless' as const,
        timeout: 30000,
      }));

    const results = await executeBatch(requests, TEST_USER, 2);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'success')).toBe(true);
  });

  test('should calculate cost', () => {
    const resources: ContainerResources = {
      cpuCores: 2,
      memoryMb: 1024,
      storageMb: 2048,
    };

    const metrics = {
      queueTimeMs: 100,
      pullTimeMs: 500,
      coldStartMs: 1000,
      executionTimeMs: 5000,
      totalTimeMs: 6600,
      cpuUsagePercent: 50,
      memoryUsedMb: 512,
      networkInBytes: 1024 * 1024,
      networkOutBytes: 1024 * 1024,
      wasColdStart: true,
    };

    const cost = calculateCost(resources, metrics);
    expect(cost).toBeGreaterThan(0n);
  });

  test('should estimate cost', () => {
    const resources: ContainerResources = {
      cpuCores: 1,
      memoryMb: 512,
      storageMb: 1024,
    };

    const costWithCold = estimateCost(resources, 10000, true);
    const costWarm = estimateCost(resources, 10000, false);

    expect(costWithCold).toBeGreaterThan(costWarm);
  });

  test('should get executor stats', () => {
    const stats = getExecutorStats();

    expect(stats).toBeDefined();
    expect(stats.pendingExecutions).toBeGreaterThanOrEqual(0);
    expect(stats.cacheStats).toBeDefined();
    expect(stats.poolStats).toBeDefined();
  });
});

// ============================================================================
// Scheduler Tests
// ============================================================================

describe('Scheduler', () => {
  const testNode1: ComputeNode = {
    nodeId: 'test-node-1',
    address: '0x1111111111111111111111111111111111111111' as Address,
    endpoint: 'http://node1.example.com:8080',
    region: 'us-east-1',
    zone: 'us-east-1a',
    resources: {
      totalCpu: 8,
      totalMemoryMb: 16384,
      totalStorageMb: 102400,
      availableCpu: 6,
      availableMemoryMb: 12288,
      availableStorageMb: 81920,
      gpuTypes: ['nvidia-a100'],
    },
    capabilities: ['gpu', 'high-memory'],
    containers: new Map(),
    cachedImages: new Set([TEST_IMAGE_DIGEST]),
    lastHeartbeat: Date.now(),
    status: 'online',
    reputation: 95,
  };

  const testNode2: ComputeNode = {
    nodeId: 'test-node-2',
    address: '0x2222222222222222222222222222222222222222' as Address,
    endpoint: 'http://node2.example.com:8080',
    region: 'eu-west-1',
    zone: 'eu-west-1a',
    resources: {
      totalCpu: 4,
      totalMemoryMb: 8192,
      totalStorageMb: 51200,
      availableCpu: 4,
      availableMemoryMb: 8192,
      availableStorageMb: 51200,
      gpuTypes: [],
    },
    capabilities: ['standard'],
    containers: new Map(),
    cachedImages: new Set(),
    lastHeartbeat: Date.now(),
    status: 'online',
    reputation: 90,
  };

  beforeEach(() => {
    registerNode(testNode1);
    registerNode(testNode2);
  });

  afterEach(() => {
    removeNode('test-node-1');
    removeNode('test-node-2');
  });

  test('should register and retrieve nodes', () => {
    const node = getNode('test-node-1');
    expect(node).toBeDefined();
    expect(node?.region).toBe('us-east-1');
  });

  test('should get nodes by region', () => {
    const usNodes = getNodesByRegion('us-east-1');
    const euNodes = getNodesByRegion('eu-west-1');

    expect(usNodes).toHaveLength(1);
    expect(euNodes).toHaveLength(1);
    expect(usNodes[0]?.nodeId).toBe('test-node-1');
  });

  test('should update node resources', () => {
    updateNodeResources('test-node-1', {
      cpu: 4,
      memoryMb: 8192,
      storageMb: 40960,
    });

    const node = getNode('test-node-1');
    expect(node?.resources.availableCpu).toBe(4);
  });

  test('should schedule with best-fit strategy', () => {
    const request: ExecutionRequest = {
      imageRef: 'test/app:latest',
      resources: { cpuCores: 2, memoryMb: 2048, storageMb: 4096 },
      mode: 'serverless',
      timeout: 30000,
    };

    const result = scheduleExecution(
      {
        request,
        image: {
          repoId: 'repo1',
          namespace: 'test',
          name: 'app',
          tag: 'latest',
          digest: TEST_IMAGE_DIGEST,
          manifestCid: 'QmTest',
          layerCids: [],
          size: 100 * 1024 * 1024,
          architectures: ['amd64'],
          publishedAt: Date.now(),
        },
        userAddress: TEST_USER,
      },
      'best-fit'
    );

    expect(result).toBeDefined();
    expect(result?.nodeId).toBe('test-node-1'); // Should prefer node with cached image
  });

  test('should reserve and release resources', () => {
    // Get current available resources first
    const nodeBefore = getNode('test-node-1');
    const initialCpu = nodeBefore?.resources.availableCpu ?? 0;
    
    const resources: ContainerResources = {
      cpuCores: 2,
      memoryMb: 2048,
      storageMb: 4096,
    };

    const reservation = reserveResources('test-node-1', resources, TEST_USER, 60000);
    expect(reservation).toBeDefined();
    expect(reservation?.nodeId).toBe('test-node-1');

    // Check resources were deducted
    const node = getNode('test-node-1');
    expect(node?.resources.availableCpu).toBe(initialCpu - 2);

    // Release
    const released = releaseReservation(reservation!.reservationId);
    expect(released).toBe(true);

    // Check resources restored
    const nodeAfter = getNode('test-node-1');
    expect(nodeAfter?.resources.availableCpu).toBe(initialCpu);
  });

  test('should find nearest region', () => {
    // New York coordinates
    const nyLocation = { latitude: 40.7128, longitude: -74.006 };
    const nearest = findNearestRegion(nyLocation);
    expect(nearest).toBe('us-east-1');

    // London coordinates
    const londonLocation = { latitude: 51.5074, longitude: -0.1278 };
    const nearestLondon = findNearestRegion(londonLocation);
    expect(nearestLondon).toBe('eu-west-1');
  });

  test('should get scheduler stats', () => {
    const stats = getSchedulerStats();

    expect(stats.totalNodes).toBeGreaterThanOrEqual(2);
    expect(stats.onlineNodes).toBeGreaterThanOrEqual(2);
    expect(stats.totalCpu).toBeGreaterThan(0);
    expect(stats.nodesByRegion['us-east-1']).toBe(1);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  afterEach(() => {
    cleanupExecutor();
    cleanupAllPools();
    clearCache();
  });

  test('should execute multiple containers with warmth reuse', async () => {
    const imageRef = `jeju/warmth-test-${Date.now()}:latest`;
    const request: ExecutionRequest = {
      imageRef,
      resources: { cpuCores: 1, memoryMb: 256, storageMb: 512 },
      mode: 'serverless',
      timeout: 30000,
    };

    // First execution (cold)
    const result1 = await executeContainer(request, TEST_USER);
    expect(result1.metrics.wasColdStart).toBe(true);

    // Second execution (should reuse warm instance or cache)
    const result2 = await executeContainer(request, TEST_USER);
    // May or may not be warm depending on timing
    expect(result2.status).toBe('success');

    // Stats should show executions
    const stats = getExecutorStats();
    expect(stats.completedExecutions).toBeGreaterThanOrEqual(2);
  });

  test('should handle concurrent executions', async () => {
    const requests = Array(5)
      .fill(null)
      .map((_, i) => ({
        imageRef: `jeju/concurrent-${i}:latest`,
        resources: { cpuCores: 1, memoryMb: 256, storageMb: 512 },
        mode: 'serverless' as const,
        timeout: 30000,
      }));

    const results = await Promise.all(
      requests.map((req) => executeContainer(req, TEST_USER))
    );

    expect(results).toHaveLength(5);
    expect(results.every((r) => r.status === 'success')).toBe(true);
  });

  test('full e2e flow with scheduling and execution', async () => {
    // Register a node
    const nodeId = `e2e-node-${Date.now()}`;
    registerNode({
      nodeId,
      address: TEST_USER,
      endpoint: 'http://localhost:9999',
      region: 'us-east-1',
      zone: 'us-east-1a',
      resources: {
        totalCpu: 4,
        totalMemoryMb: 8192,
        totalStorageMb: 51200,
        availableCpu: 4,
        availableMemoryMb: 8192,
        availableStorageMb: 51200,
        gpuTypes: [],
      },
      capabilities: ['standard'],
      containers: new Map(),
      cachedImages: new Set(),
      lastHeartbeat: Date.now(),
      status: 'online',
      reputation: 100,
    });

    // Execute container
    const request: ExecutionRequest = {
      imageRef: 'jeju/e2e-test:v1',
      command: ['/process', '--input', 'test'],
      env: { MODE: 'test' },
      resources: { cpuCores: 1, memoryMb: 512, storageMb: 1024 },
      mode: 'serverless',
      timeout: 60000,
      input: { payload: 'test-data' },
    };

    const result = await executeContainer(request, TEST_USER);

    expect(result.status).toBe('success');
    expect(result.output).toBeDefined();
    expect(result.metrics.executionTimeMs).toBeGreaterThan(0);

    // Check cost was calculated
    const cost = calculateCost(request.resources, result.metrics);
    expect(cost).toBeGreaterThan(0n);

    // Cleanup
    removeNode(nodeId);
  });
});

