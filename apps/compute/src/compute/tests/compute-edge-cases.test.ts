/**
 * ComputeNodeManager Edge Cases & Boundary Tests
 *
 * Tests error handling, concurrent provisioning, timeouts,
 * and verifies actual state transitions.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { serve } from 'bun';
import type { Server } from 'bun';
import {
  ComputeNodeManager,
  createComputeNodeManager,
  type ComputeNodeConfig,
} from '../sdk/cloud-integration';

// ============================================================================
// Provisioner Failure Scenarios
// ============================================================================

describe('Provisioner Failure Scenarios', () => {
  let manager: ComputeNodeManager;
  let server: Server;
  let port = 9890;
  let shouldFail = false;
  let failureMessage = 'Provisioning failed';
  let provisionDelay = 50;

  beforeEach(async () => {
    shouldFail = false;
    failureMessage = 'Provisioning failed';
    provisionDelay = 50;

    const app = new Hono();
    app.post('/api/v1/compute/provision', async (c) => {
      await new Promise(r => setTimeout(r, provisionDelay));
      if (shouldFail) return c.text(failureMessage, 500);
      const body = await c.req.json() as { nodeId: string };
      return c.json({ endpoint: `http://localhost:${port}/compute/${body.nodeId}`, providerMeta: {} });
    });
    app.post('/api/v1/compute/terminate', async (c) => c.json({ success: true }));

    server = serve({ port, fetch: app.fetch });
    manager = createComputeNodeManager({
      provisionerEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
      defaultIdleTimeoutMs: 60000,
      maxQueueTimeMs: 5000,
      statusPollIntervalMs: 100,
    });
  });

  afterEach(async () => {
    await manager.shutdown();
    server.stop();
  });

  test('handles provisioner returning 500 error', async () => {
    shouldFail = true;
    failureMessage = 'Internal Server Error';

    manager.registerNode({
      nodeId: 'fail-500', name: 'Fail 500', hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
      cpuCores: 2, memoryGb: 8, containerImage: 'test:latest',
      idleTimeoutMs: 60000, coldStartTimeMs: 1000, pricePerHourWei: 1000000000000000n, regions: ['us-east-1'],
    });

    const result = await manager.provisionNode({ nodeId: 'fail-500' });
    
    expect(result.status).toBe('error');
    expect(result.error).toContain('500');

    const node = manager.getNode('fail-500');
    expect(node!.status).toBe('error');
    expect(node!.error).toBeDefined();
  });

  test('handles provisioner returning custom error message', async () => {
    shouldFail = true;
    failureMessage = 'GPU quota exceeded';

    manager.registerNode({
      nodeId: 'fail-quota', name: 'Fail Quota', hardwareType: 'gpu', teeType: 'none', gpuType: 'H100',
      cpuCores: 16, memoryGb: 128, containerImage: 'gpu:latest',
      idleTimeoutMs: 60000, coldStartTimeMs: 5000, pricePerHourWei: 50000000000000000n, regions: ['us-west-2'],
    });

    const result = await manager.provisionNode({ nodeId: 'fail-quota' });
    
    expect(result.status).toBe('error');
    expect(result.error).toContain('GPU quota exceeded');
  });

  test('node can recover from error state', async () => {
    shouldFail = true;
    manager.registerNode({
      nodeId: 'recover', name: 'Recover', hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
      cpuCores: 2, memoryGb: 8, containerImage: 'test:latest',
      idleTimeoutMs: 60000, coldStartTimeMs: 1000, pricePerHourWei: 1000000000000000n, regions: ['us-east-1'],
    });

    // First attempt fails
    const result1 = await manager.provisionNode({ nodeId: 'recover' });
    expect(result1.status).toBe('error');

    // Fix the provisioner
    shouldFail = false;

    // Second attempt should succeed
    const result2 = await manager.provisionNode({ nodeId: 'recover' });
    expect(result2.status).toBe('ready');
    expect(result2.endpoint).toBeDefined();
  });
});

// ============================================================================
// Concurrent Provisioning
// ============================================================================

describe('Concurrent Provisioning', () => {
  let manager: ComputeNodeManager;
  let server: Server;
  let port = 9891;
  let provisionCount = 0;
  let currentlyProvisioning = 0;
  let maxConcurrentProvision = 0;

  beforeEach(async () => {
    provisionCount = 0;
    currentlyProvisioning = 0;
    maxConcurrentProvision = 0;

    const app = new Hono();
    app.post('/api/v1/compute/provision', async (c) => {
      currentlyProvisioning++;
      if (currentlyProvisioning > maxConcurrentProvision) maxConcurrentProvision = currentlyProvisioning;
      provisionCount++;
      
      await new Promise(r => setTimeout(r, 100));
      currentlyProvisioning--;
      
      const body = await c.req.json() as { nodeId: string };
      return c.json({ endpoint: `http://localhost:${port}/compute/${body.nodeId}`, providerMeta: {} });
    });
    app.post('/api/v1/compute/terminate', async (c) => c.json({ success: true }));

    server = serve({ port, fetch: app.fetch });
    manager = createComputeNodeManager({
      provisionerEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
      defaultIdleTimeoutMs: 60000,
      maxQueueTimeMs: 30000,
      statusPollIntervalMs: 50,
    });
  });

  afterEach(async () => {
    await manager.shutdown();
    server.stop();
  });

  test('multiple nodes can provision concurrently', async () => {
    for (let i = 0; i < 5; i++) {
      manager.registerNode({
        nodeId: `concurrent-${i}`, name: `Concurrent ${i}`, hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
        cpuCores: 2, memoryGb: 8, containerImage: 'test:latest',
        idleTimeoutMs: 60000, coldStartTimeMs: 1000, pricePerHourWei: 1000000000000000n, regions: ['us-east-1'],
      });
    }

    const promises = Array.from({ length: 5 }, (_, i) => 
      manager.provisionNode({ nodeId: `concurrent-${i}` })
    );

    const results = await Promise.all(promises);
    
    expect(results.length).toBe(5);
    expect(results.every(r => r.status === 'ready')).toBe(true);
    expect(provisionCount).toBe(5);
    expect(maxConcurrentProvision).toBeGreaterThan(1);
  });

  test('same node only provisions once with concurrent requests', async () => {
    manager.registerNode({
      nodeId: 'single', name: 'Single', hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
      cpuCores: 2, memoryGb: 8, containerImage: 'test:latest',
      idleTimeoutMs: 60000, coldStartTimeMs: 1000, pricePerHourWei: 1000000000000000n, regions: ['us-east-1'],
    });

    // Fire 10 concurrent provision requests for same node
    const promises = Array.from({ length: 10 }, () => 
      manager.provisionNode({ nodeId: 'single' })
    );

    const results = await Promise.all(promises);
    
    expect(results.length).toBe(10);
    expect(results.every(r => r.status === 'ready')).toBe(true);
    // All should get the same endpoint
    expect(new Set(results.map(r => r.endpoint)).size).toBe(1);
    // Only one actual provision call
    expect(provisionCount).toBe(1);
  });

  test('executeRequest queues during provisioning', async () => {
    manager.registerNode({
      nodeId: 'queue-test', name: 'Queue Test', hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
      cpuCores: 2, memoryGb: 8, containerImage: 'test:latest',
      idleTimeoutMs: 60000, coldStartTimeMs: 1000, pricePerHourWei: 1000000000000000n, regions: ['us-east-1'],
    });

    // Start multiple requests before node is ready
    const promises = Array.from({ length: 5 }, (_, i) => 
      manager.executeRequest(`queue-test`, { seq: i }, async (endpoint) => ({ endpoint, seq: i }))
    );

    // All should eventually resolve
    const results = await Promise.all(promises);
    expect(results.length).toBe(5);
    expect(results.every(r => (r as { endpoint: string }).endpoint !== undefined)).toBe(true);
  });
});

// ============================================================================
// Request Queue Behavior
// ============================================================================

describe('Request Queue Behavior', () => {
  let manager: ComputeNodeManager;
  let server: Server;
  let port = 9892;
  let provisionDelay = 500;

  beforeEach(async () => {
    provisionDelay = 500;

    const app = new Hono();
    app.post('/api/v1/compute/provision', async (c) => {
      await new Promise(r => setTimeout(r, provisionDelay));
      const body = await c.req.json() as { nodeId: string };
      return c.json({ endpoint: `http://localhost:${port}/compute/${body.nodeId}`, providerMeta: {} });
    });
    app.post('/api/v1/compute/terminate', async (c) => c.json({ success: true }));

    server = serve({ port, fetch: app.fetch });
    manager = createComputeNodeManager({
      provisionerEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
      defaultIdleTimeoutMs: 60000,
      maxQueueTimeMs: 200, // Short queue timeout for testing
      statusPollIntervalMs: 50,
    });
  });

  afterEach(async () => {
    await manager.shutdown();
    server.stop();
  });

  test('request times out if provisioning takes too long', async () => {
    provisionDelay = 1000; // Longer than maxQueueTimeMs

    manager.registerNode({
      nodeId: 'timeout', name: 'Timeout', hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
      cpuCores: 2, memoryGb: 8, containerImage: 'test:latest',
      idleTimeoutMs: 60000, coldStartTimeMs: 1000, pricePerHourWei: 1000000000000000n, regions: ['us-east-1'],
    });

    await expect(
      manager.executeRequest('timeout', {}, async () => ({}))
    ).rejects.toThrow('timeout');
  });

  test('multiple queued requests all timeout together', async () => {
    provisionDelay = 1000;

    manager.registerNode({
      nodeId: 'multi-timeout', name: 'Multi Timeout', hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
      cpuCores: 2, memoryGb: 8, containerImage: 'test:latest',
      idleTimeoutMs: 60000, coldStartTimeMs: 1000, pricePerHourWei: 1000000000000000n, regions: ['us-east-1'],
    });

    const promises = Array.from({ length: 3 }, () => 
      manager.executeRequest('multi-timeout', {}, async () => ({})).catch(e => ({ error: e.message }))
    );

    const results = await Promise.all(promises);
    expect(results.every(r => (r as { error: string }).error?.includes('timeout'))).toBe(true);
  });
});

// ============================================================================
// State Transitions
// ============================================================================

describe('State Transitions', () => {
  let manager: ComputeNodeManager;
  let server: Server;
  let port = 9893;
  let provisionDelay = 100;

  beforeEach(async () => {
    provisionDelay = 100;

    const app = new Hono();
    app.post('/api/v1/compute/provision', async (c) => {
      await new Promise(r => setTimeout(r, provisionDelay));
      const body = await c.req.json() as { nodeId: string };
      return c.json({ endpoint: `http://localhost:${port}/compute/${body.nodeId}`, providerMeta: {} });
    });
    app.post('/api/v1/compute/terminate', async (c) => c.json({ success: true }));

    server = serve({ port, fetch: app.fetch });
    manager = createComputeNodeManager({
      provisionerEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
      defaultIdleTimeoutMs: 60000,
      maxQueueTimeMs: 30000,
      statusPollIntervalMs: 50,
    });
  });

  afterEach(async () => {
    await manager.shutdown();
    server.stop();
  });

  test('cold -> provisioning -> ready transition', async () => {
    provisionDelay = 200;

    manager.registerNode({
      nodeId: 'transition', name: 'Transition', hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
      cpuCores: 2, memoryGb: 8, containerImage: 'test:latest',
      idleTimeoutMs: 60000, coldStartTimeMs: 1000, pricePerHourWei: 1000000000000000n, regions: ['us-east-1'],
    });

    expect(manager.getNode('transition')!.status).toBe('cold');

    const provisionPromise = manager.provisionNode({ nodeId: 'transition' });
    await new Promise(r => setTimeout(r, 50));
    
    expect(manager.getNode('transition')!.status).toBe('provisioning');

    await provisionPromise;
    expect(manager.getNode('transition')!.status).toBe('ready');
  });

  test('ready -> active -> ready during request execution', async () => {
    manager.registerNode({
      nodeId: 'active', name: 'Active', hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
      cpuCores: 2, memoryGb: 8, containerImage: 'test:latest',
      idleTimeoutMs: 60000, coldStartTimeMs: 1000, pricePerHourWei: 1000000000000000n, regions: ['us-east-1'],
    });

    await manager.provisionNode({ nodeId: 'active' });
    expect(manager.getNode('active')!.status).toBe('ready');

    const requestPromise = manager.executeRequest('active', {}, async () => {
      await new Promise(r => setTimeout(r, 100));
      return { done: true };
    });

    await new Promise(r => setTimeout(r, 20));
    expect(manager.getNode('active')!.status).toBe('active');
    expect(manager.getNode('active')!.activeRequests).toBe(1);

    await requestPromise;
    expect(manager.getNode('active')!.status).toBe('ready');
    expect(manager.getNode('active')!.activeRequests).toBe(0);
  });

  test('terminated node resets all state', async () => {
    manager.registerNode({
      nodeId: 'reset', name: 'Reset', hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
      cpuCores: 2, memoryGb: 8, containerImage: 'test:latest',
      idleTimeoutMs: 60000, coldStartTimeMs: 1000, pricePerHourWei: 1000000000000000n, regions: ['us-east-1'],
    });

    await manager.provisionNode({ nodeId: 'reset' });
    
    const nodeBefore = manager.getNode('reset')!;
    expect(nodeBefore.status).toBe('ready');
    expect(nodeBefore.endpoint).toBeDefined();
    expect(nodeBefore.readySince).toBeDefined();

    await manager.terminateNode('reset');

    const nodeAfter = manager.getNode('reset')!;
    expect(nodeAfter.status).toBe('cold');
    expect(nodeAfter.endpoint).toBeUndefined();
    expect(nodeAfter.internalEndpoint).toBeUndefined();
    expect(nodeAfter.provisioningStartedAt).toBeUndefined();
    expect(nodeAfter.readySince).toBeUndefined();
    expect(nodeAfter.lastRequestAt).toBeUndefined();
    expect(nodeAfter.activeRequests).toBe(0);
    expect(nodeAfter.error).toBeUndefined();
    expect(nodeAfter.providerMeta).toBeUndefined();
  });
});

// ============================================================================
// Metadata Accuracy
// ============================================================================

describe('Metadata Accuracy', () => {
  let manager: ComputeNodeManager;
  let server: Server;
  let port = 9894;

  beforeEach(async () => {
    const app = new Hono();
    app.post('/api/v1/compute/provision', async (c) => {
      await new Promise(r => setTimeout(r, 50));
      const body = await c.req.json() as { nodeId: string };
      return c.json({ endpoint: `http://localhost:${port}/compute/${body.nodeId}`, providerMeta: { test: true } });
    });
    app.post('/api/v1/compute/terminate', async (c) => c.json({ success: true }));

    server = serve({ port, fetch: app.fetch });
    manager = createComputeNodeManager({
      provisionerEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
      defaultIdleTimeoutMs: 60000,
      maxQueueTimeMs: 30000,
      statusPollIntervalMs: 50,
    });
  });

  afterEach(async () => {
    await manager.shutdown();
    server.stop();
  });

  test('metadata reflects actual node configuration', () => {
    manager.registerNode({
      nodeId: 'config-test', name: 'Config Test', hardwareType: 'gpu', teeType: 'phala', gpuType: 'H100',
      gpuMemoryGb: 80, cpuCores: 32, memoryGb: 256, containerImage: 'tee:latest',
      idleTimeoutMs: 300000, coldStartTimeMs: 45000, pricePerHourWei: 100000000000000000n, regions: ['us-west-2', 'eu-west-1'],
    });

    const meta = manager.getNodeMetadata('config-test')!;
    
    expect(meta.nodeId).toBe('config-test');
    expect(meta.name).toBe('Config Test');
    expect(meta.hardwareType).toBe('gpu');
    expect(meta.teeType).toBe('phala');
    expect(meta.gpuType).toBe('H100');
    expect(meta.coldStartTimeMs).toBe(45000);
    expect(meta.pricePerHourWei).toBe('100000000000000000');
    expect(meta.regions).toEqual(['us-west-2', 'eu-west-1']);
  });

  test('estimatedReadyInMs decreases during provisioning', async () => {
    manager.registerNode({
      nodeId: 'estimate', name: 'Estimate', hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
      cpuCores: 2, memoryGb: 8, containerImage: 'test:latest',
      idleTimeoutMs: 60000, coldStartTimeMs: 5000, pricePerHourWei: 1000000000000000n, regions: ['us-east-1'],
    });

    const metaCold = manager.getNodeMetadata('estimate')!;
    expect(metaCold.estimatedReadyInMs).toBe(5000);

    const provisionPromise = manager.provisionNode({ nodeId: 'estimate' });
    await new Promise(r => setTimeout(r, 20));

    const metaProvisioning = manager.getNodeMetadata('estimate')!;
    expect(metaProvisioning.estimatedReadyInMs).toBeLessThan(5000);

    await provisionPromise;

    const metaReady = manager.getNodeMetadata('estimate')!;
    expect(metaReady.estimatedReadyInMs).toBe(0);
  });

  test('activeRequests count is accurate', async () => {
    manager.registerNode({
      nodeId: 'count', name: 'Count', hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
      cpuCores: 2, memoryGb: 8, containerImage: 'test:latest',
      idleTimeoutMs: 60000, coldStartTimeMs: 1000, pricePerHourWei: 1000000000000000n, regions: ['us-east-1'],
    });

    await manager.provisionNode({ nodeId: 'count' });

    expect(manager.getNodeMetadata('count')!.activeRequests).toBe(0);

    const p1 = manager.executeRequest('count', {}, async () => {
      await new Promise(r => setTimeout(r, 100));
      return {};
    });
    const p2 = manager.executeRequest('count', {}, async () => {
      await new Promise(r => setTimeout(r, 100));
      return {};
    });

    await new Promise(r => setTimeout(r, 20));
    expect(manager.getNodeMetadata('count')!.activeRequests).toBe(2);

    await Promise.all([p1, p2]);
    expect(manager.getNodeMetadata('count')!.activeRequests).toBe(0);
  });

  test('totalRequests increments correctly', async () => {
    manager.registerNode({
      nodeId: 'total', name: 'Total', hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
      cpuCores: 2, memoryGb: 8, containerImage: 'test:latest',
      idleTimeoutMs: 60000, coldStartTimeMs: 1000, pricePerHourWei: 1000000000000000n, regions: ['us-east-1'],
    });

    await manager.provisionNode({ nodeId: 'total' });

    expect(manager.getNode('total')!.totalRequests).toBe(0);

    await manager.executeRequest('total', {}, async () => ({}));
    expect(manager.getNode('total')!.totalRequests).toBe(1);

    await manager.executeRequest('total', {}, async () => ({}));
    await manager.executeRequest('total', {}, async () => ({}));
    expect(manager.getNode('total')!.totalRequests).toBe(3);
  });
});

// ============================================================================
// Edge Cases for Node Configuration
// ============================================================================

describe('Node Configuration Edge Cases', () => {
  let manager: ComputeNodeManager;
  let server: Server;
  let port = 9895;

  beforeEach(async () => {
    const app = new Hono();
    app.post('/api/v1/compute/provision', async (c) => {
      const body = await c.req.json() as { nodeId: string };
      return c.json({ endpoint: `http://localhost:${port}/${body.nodeId}`, providerMeta: {} });
    });
    app.post('/api/v1/compute/terminate', async (c) => c.json({ success: true }));

    server = serve({ port, fetch: app.fetch });
    manager = createComputeNodeManager({
      provisionerEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
      defaultIdleTimeoutMs: 60000,
      maxQueueTimeMs: 30000,
      statusPollIntervalMs: 50,
    });
  });

  afterEach(async () => {
    await manager.shutdown();
    server.stop();
  });

  test('handles minimum resource configuration', () => {
    const node = manager.registerNode({
      nodeId: 'minimal', name: 'Minimal', hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
      cpuCores: 1, memoryGb: 1, containerImage: 'minimal:latest',
      idleTimeoutMs: 1000, coldStartTimeMs: 100, pricePerHourWei: 0n, regions: [],
    });

    expect(node.config.cpuCores).toBe(1);
    expect(node.config.memoryGb).toBe(1);
    expect(node.config.pricePerHourWei).toBe(0n);
    expect(node.config.regions).toEqual([]);
  });

  test('handles maximum resource configuration', () => {
    const node = manager.registerNode({
      nodeId: 'maximal', name: 'Maximal', hardwareType: 'gpu', teeType: 'phala', gpuType: 'H200',
      gpuMemoryGb: 141, cpuCores: 256, memoryGb: 2048, containerImage: 'massive:latest',
      idleTimeoutMs: 86400000, coldStartTimeMs: 600000,
      pricePerHourWei: 1000000000000000000000n, // Very large price
      regions: ['us-east-1', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-northeast-1'],
    });

    expect(node.config.cpuCores).toBe(256);
    expect(node.config.memoryGb).toBe(2048);
    expect(node.config.pricePerHourWei).toBe(1000000000000000000000n);
    expect(node.config.regions.length).toBe(6);
  });

  test('handles special characters in nodeId and name', () => {
    const node = manager.registerNode({
      nodeId: 'node-with-special_chars.123', name: 'Node With Special "Chars" & <Symbols>',
      hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
      cpuCores: 2, memoryGb: 8, containerImage: 'test:latest',
      idleTimeoutMs: 60000, coldStartTimeMs: 1000, pricePerHourWei: 1000000000000000n, regions: ['us-east-1'],
    });

    expect(node.config.nodeId).toBe('node-with-special_chars.123');
    expect(node.config.name).toBe('Node With Special "Chars" & <Symbols>');
    expect(manager.getNode('node-with-special_chars.123')).toBeDefined();
  });

  test('handles empty env object', () => {
    const node = manager.registerNode({
      nodeId: 'empty-env', name: 'Empty Env', hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
      cpuCores: 2, memoryGb: 8, containerImage: 'test:latest', env: {},
      idleTimeoutMs: 60000, coldStartTimeMs: 1000, pricePerHourWei: 1000000000000000n, regions: ['us-east-1'],
    });

    expect(node.config.env).toEqual({});
  });

  test('handles large env object', () => {
    const largeEnv: Record<string, string> = {};
    for (let i = 0; i < 100; i++) largeEnv[`VAR_${i}`] = `value_${i}`;

    const node = manager.registerNode({
      nodeId: 'large-env', name: 'Large Env', hardwareType: 'cpu', teeType: 'none', gpuType: 'none',
      cpuCores: 2, memoryGb: 8, containerImage: 'test:latest', env: largeEnv,
      idleTimeoutMs: 60000, coldStartTimeMs: 1000, pricePerHourWei: 1000000000000000n, regions: ['us-east-1'],
    });

    expect(Object.keys(node.config.env!).length).toBe(100);
  });
});
