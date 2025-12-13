/**
 * ComputeNodeManager Tests
 *
 * Tests for on-demand compute provisioning with cold start support.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { serve } from 'bun';
import {
  ComputeNodeManager,
  createComputeNodeManager,
  type ComputeNodeConfig,
} from '../sdk/cloud-integration';

type BunServer = ReturnType<typeof serve>;

// Mock provisioner server
let provisionerServer: BunServer | null = null;
let provisionerPort = 9878;
let provisionRequests: Array<{ action: string; params: Record<string, unknown> }> = [];
let provisionDelay = 100; // ms to simulate provisioning

describe('ComputeNodeManager', () => {
  let manager: ComputeNodeManager;

  beforeEach(async () => {
    provisionRequests = [];
    provisionDelay = 100;

    // Create mock provisioner
    const app = new Hono();

    app.post('/api/v1/compute/provision', async (c) => {
      const body = await c.req.json();
      provisionRequests.push({ action: 'provision', params: body as Record<string, unknown> });

      // Simulate provisioning delay
      await new Promise((r) => setTimeout(r, provisionDelay));

      return c.json({
        endpoint: `http://localhost:${provisionerPort}/compute/${body.nodeId}`,
        internalEndpoint: `http://internal:8080`,
        providerMeta: { provider: 'test', containerId: 'abc123' },
      });
    });

    app.post('/api/v1/compute/terminate', async (c) => {
      const body = await c.req.json();
      provisionRequests.push({ action: 'terminate', params: body as Record<string, unknown> });
      return c.json({ success: true });
    });

    app.post('/api/v1/compute/status', async (c) => {
      const body = await c.req.json();
      provisionRequests.push({ action: 'status', params: body as Record<string, unknown> });
      return c.json({ status: 'ready' });
    });

    provisionerServer = serve({
      port: provisionerPort,
      fetch: app.fetch,
    });

    // Create manager
    manager = createComputeNodeManager({
      provisionerEndpoint: `http://localhost:${provisionerPort}`,
      rpcUrl: 'http://localhost:9545',
      defaultIdleTimeoutMs: 60000,
      maxQueueTimeMs: 30000,
      statusPollIntervalMs: 1000,
    });
  });

  afterEach(async () => {
    await manager.shutdown();
    if (provisionerServer) provisionerServer.stop();
  });

  describe('Node Registration', () => {
    test('registers a CPU node in cold state', () => {
      const config: ComputeNodeConfig = {
        nodeId: 'cpu-node-1',
        name: 'CPU Compute Node',
        hardwareType: 'cpu',
        teeType: 'none',
        gpuType: 'none',
        cpuCores: 4,
        memoryGb: 16,
        containerImage: 'compute-worker:latest',
        idleTimeoutMs: 60000,
        coldStartTimeMs: 5000,
        pricePerHourWei: 1000000000000000n,
        regions: ['us-east-1', 'eu-west-1'],
      };

      const node = manager.registerNode(config);

      expect(node.status).toBe('cold');
      expect(node.endpoint).toBeUndefined();
      expect(node.activeRequests).toBe(0);
    });

    test('registers a GPU node with TEE', () => {
      const config: ComputeNodeConfig = {
        nodeId: 'gpu-tee-node-1',
        name: 'GPU TEE Node',
        hardwareType: 'gpu',
        teeType: 'phala',
        gpuType: 'H100',
        gpuMemoryGb: 80,
        cpuCores: 32,
        memoryGb: 256,
        containerImage: 'tee-worker:latest',
        idleTimeoutMs: 300000,
        coldStartTimeMs: 30000,
        pricePerHourWei: 50000000000000000n,
        regions: ['us-west-2'],
      };

      const node = manager.registerNode(config);

      expect(node.config.teeType).toBe('phala');
      expect(node.config.gpuType).toBe('H100');
      expect(node.config.coldStartTimeMs).toBe(30000);
    });

    test('getAllNodes returns all registered nodes', () => {
      manager.registerNode({
        nodeId: 'node-1',
        name: 'Node 1',
        hardwareType: 'cpu',
        teeType: 'none',
        gpuType: 'none',
        cpuCores: 2,
        memoryGb: 8,
        containerImage: 'worker:latest',
        idleTimeoutMs: 60000,
        coldStartTimeMs: 5000,
        pricePerHourWei: 1000000000000000n,
        regions: ['us-east-1'],
      });

      manager.registerNode({
        nodeId: 'node-2',
        name: 'Node 2',
        hardwareType: 'gpu',
        teeType: 'phala',
        gpuType: 'A100_80',
        cpuCores: 16,
        memoryGb: 128,
        containerImage: 'gpu-worker:latest',
        idleTimeoutMs: 120000,
        coldStartTimeMs: 15000,
        pricePerHourWei: 10000000000000000n,
        regions: ['us-west-2'],
      });

      const nodes = manager.getAllNodes();
      expect(nodes.length).toBe(2);
    });
  });

  describe('Node Metadata', () => {
    test('returns metadata with cold start info', () => {
      manager.registerNode({
        nodeId: 'meta-node',
        name: 'Metadata Test Node',
        hardwareType: 'cpu',
        teeType: 'sgx',
        gpuType: 'none',
        cpuCores: 4,
        memoryGb: 16,
        containerImage: 'worker:latest',
        idleTimeoutMs: 60000,
        coldStartTimeMs: 8000,
        pricePerHourWei: 2000000000000000n,
        regions: ['eu-central-1'],
      });

      const metadata = manager.getNodeMetadata('meta-node');

      expect(metadata).toBeDefined();
      expect(metadata!.status).toBe('cold');
      expect(metadata!.endpointAvailable).toBe(false);
      expect(metadata!.coldStartTimeMs).toBe(8000);
      expect(metadata!.estimatedReadyInMs).toBe(8000);
      expect(metadata!.pricePerHourWei).toBe('2000000000000000');
    });

    test('getAllNodeMetadata returns all metadata', () => {
      manager.registerNode({
        nodeId: 'node-a',
        name: 'Node A',
        hardwareType: 'cpu',
        teeType: 'none',
        gpuType: 'none',
        cpuCores: 2,
        memoryGb: 8,
        containerImage: 'worker:latest',
        idleTimeoutMs: 60000,
        coldStartTimeMs: 5000,
        pricePerHourWei: 1000000000000000n,
        regions: ['us-east-1'],
      });

      manager.registerNode({
        nodeId: 'node-b',
        name: 'Node B',
        hardwareType: 'gpu',
        teeType: 'none',
        gpuType: 'RTX4090',
        cpuCores: 8,
        memoryGb: 32,
        containerImage: 'gpu-worker:latest',
        idleTimeoutMs: 120000,
        coldStartTimeMs: 10000,
        pricePerHourWei: 5000000000000000n,
        regions: ['us-west-2'],
      });

      const allMetadata = manager.getAllNodeMetadata();
      expect(allMetadata.length).toBe(2);
      expect(allMetadata.some((m) => m.nodeId === 'node-a')).toBe(true);
      expect(allMetadata.some((m) => m.nodeId === 'node-b')).toBe(true);
    });
  });

  describe('Provisioning', () => {
    test('provisions a cold node', async () => {
      manager.registerNode({
        nodeId: 'provision-test',
        name: 'Provision Test',
        hardwareType: 'cpu',
        teeType: 'none',
        gpuType: 'none',
        cpuCores: 4,
        memoryGb: 16,
        containerImage: 'worker:latest',
        idleTimeoutMs: 60000,
        coldStartTimeMs: 1000,
        pricePerHourWei: 1000000000000000n,
        regions: ['us-east-1'],
      });

      const result = await manager.provisionNode({ nodeId: 'provision-test' });

      expect(result.status).toBe('ready');
      expect(result.endpoint).toBeDefined();
      expect(result.provisionTimeMs).toBeGreaterThan(0);

      const node = manager.getNode('provision-test');
      expect(node!.status).toBe('ready');
      expect(node!.endpoint).toBeDefined();
    });

    test('returns existing endpoint for ready node', async () => {
      manager.registerNode({
        nodeId: 'ready-test',
        name: 'Ready Test',
        hardwareType: 'cpu',
        teeType: 'none',
        gpuType: 'none',
        cpuCores: 2,
        memoryGb: 8,
        containerImage: 'worker:latest',
        idleTimeoutMs: 60000,
        coldStartTimeMs: 1000,
        pricePerHourWei: 1000000000000000n,
        regions: ['us-east-1'],
      });

      // First provision
      const result1 = await manager.provisionNode({ nodeId: 'ready-test' });
      expect(result1.status).toBe('ready');

      // Second provision should return immediately
      const result2 = await manager.provisionNode({ nodeId: 'ready-test' });
      expect(result2.status).toBe('ready');
      expect(result2.endpoint).toBe(result1.endpoint);

      // Should only have one provision request
      expect(provisionRequests.filter((r) => r.action === 'provision').length).toBe(1);
    });

    test('sends correct parameters to provisioner', async () => {
      manager.registerNode({
        nodeId: 'params-test',
        name: 'Params Test',
        hardwareType: 'gpu',
        teeType: 'phala',
        gpuType: 'H100',
        gpuMemoryGb: 80,
        cpuCores: 32,
        memoryGb: 256,
        containerImage: 'tee-gpu:latest',
        startupCommand: '/start.sh',
        env: { MODEL_PATH: '/models' },
        idleTimeoutMs: 60000,
        coldStartTimeMs: 1000,
        pricePerHourWei: 1000000000000000n,
        regions: ['us-west-2'],
      });

      await manager.provisionNode({ nodeId: 'params-test', priority: 'high' });

      const provisionReq = provisionRequests.find((r) => r.action === 'provision');
      expect(provisionReq).toBeDefined();
      expect(provisionReq!.params.nodeId).toBe('params-test');
      expect(provisionReq!.params.hardwareType).toBe('gpu');
      expect(provisionReq!.params.teeType).toBe('phala');
      expect(provisionReq!.params.gpuType).toBe('H100');
      expect(provisionReq!.params.gpuMemoryGb).toBe(80);
      expect(provisionReq!.params.containerImage).toBe('tee-gpu:latest');
      expect(provisionReq!.params.priority).toBe('high');
    });
  });

  describe('Request Execution', () => {
    test('executes request on ready node', async () => {
      manager.registerNode({
        nodeId: 'exec-test',
        name: 'Exec Test',
        hardwareType: 'cpu',
        teeType: 'none',
        gpuType: 'none',
        cpuCores: 2,
        memoryGb: 8,
        containerImage: 'worker:latest',
        idleTimeoutMs: 60000,
        coldStartTimeMs: 1000,
        pricePerHourWei: 1000000000000000n,
        regions: ['us-east-1'],
      });

      // Provision first
      await manager.provisionNode({ nodeId: 'exec-test' });

      // Execute request
      const result = await manager.executeRequest(
        'exec-test',
        { prompt: 'Hello' },
        async (endpoint, request) => {
          return { endpoint, request, result: 'success' };
        }
      );

      expect(result.result).toBe('success');
      expect(result.endpoint).toBeDefined();

      const node = manager.getNode('exec-test');
      expect(node!.totalRequests).toBe(1);
    });

    test('provisions node on first request if cold', async () => {
      manager.registerNode({
        nodeId: 'cold-exec-test',
        name: 'Cold Exec Test',
        hardwareType: 'cpu',
        teeType: 'none',
        gpuType: 'none',
        cpuCores: 2,
        memoryGb: 8,
        containerImage: 'worker:latest',
        idleTimeoutMs: 60000,
        coldStartTimeMs: 1000,
        pricePerHourWei: 1000000000000000n,
        regions: ['us-east-1'],
      });

      // Execute request on cold node - will queue and provision
      const resultPromise = manager.executeRequest(
        'cold-exec-test',
        { prompt: 'Hello' },
        async (endpoint, request) => {
          return { endpoint, request, result: 'queued-then-executed' };
        }
      );

      // Wait for result
      const result = await resultPromise;
      expect(result.endpoint).toBeDefined();

      // Node should now be ready
      const node = manager.getNode('cold-exec-test');
      expect(node!.status === 'ready' || node!.status === 'active').toBe(true);
    });
  });

  describe('Termination', () => {
    test('terminates node and resets to cold', async () => {
      manager.registerNode({
        nodeId: 'term-test',
        name: 'Term Test',
        hardwareType: 'cpu',
        teeType: 'none',
        gpuType: 'none',
        cpuCores: 2,
        memoryGb: 8,
        containerImage: 'worker:latest',
        idleTimeoutMs: 60000,
        coldStartTimeMs: 1000,
        pricePerHourWei: 1000000000000000n,
        regions: ['us-east-1'],
      });

      // Provision
      await manager.provisionNode({ nodeId: 'term-test' });
      const nodeAfterProvision = manager.getNode('term-test');
      expect(nodeAfterProvision!.status).toBe('ready');
      expect(nodeAfterProvision!.endpoint).toBeDefined();

      // Terminate
      await manager.terminateNode('term-test');

      const nodeAfterTerminate = manager.getNode('term-test');
      expect(nodeAfterTerminate!.status).toBe('cold');
      expect(nodeAfterTerminate!.endpoint).toBeUndefined();

      // Should have terminate request
      expect(provisionRequests.some((r) => r.action === 'terminate')).toBe(true);
    });

    test('can re-provision after termination', async () => {
      manager.registerNode({
        nodeId: 'reprovision-test',
        name: 'Reprovision Test',
        hardwareType: 'cpu',
        teeType: 'none',
        gpuType: 'none',
        cpuCores: 2,
        memoryGb: 8,
        containerImage: 'worker:latest',
        idleTimeoutMs: 60000,
        coldStartTimeMs: 1000,
        pricePerHourWei: 1000000000000000n,
        regions: ['us-east-1'],
      });

      // Provision, terminate, provision again
      await manager.provisionNode({ nodeId: 'reprovision-test' });
      await manager.terminateNode('reprovision-test');
      const result = await manager.provisionNode({ nodeId: 'reprovision-test' });

      expect(result.status).toBe('ready');
      expect(result.endpoint).toBeDefined();

      // Should have 2 provision requests
      expect(provisionRequests.filter((r) => r.action === 'provision').length).toBe(2);
    });
  });

  describe('Metadata Updates', () => {
    test('metadata shows provisioning status', async () => {
      provisionDelay = 500; // Slow down provisioning

      manager.registerNode({
        nodeId: 'meta-prov-test',
        name: 'Meta Provisioning Test',
        hardwareType: 'cpu',
        teeType: 'none',
        gpuType: 'none',
        cpuCores: 2,
        memoryGb: 8,
        containerImage: 'worker:latest',
        idleTimeoutMs: 60000,
        coldStartTimeMs: 5000,
        pricePerHourWei: 1000000000000000n,
        regions: ['us-east-1'],
      });

      // Start provisioning (don't await)
      const provisionPromise = manager.provisionNode({ nodeId: 'meta-prov-test' });

      // Check metadata while provisioning
      await new Promise((r) => setTimeout(r, 50));
      const metaDuring = manager.getNodeMetadata('meta-prov-test');
      expect(metaDuring!.status).toBe('provisioning');
      expect(metaDuring!.endpointAvailable).toBe(false);
      expect(metaDuring!.estimatedReadyInMs).toBeLessThan(5000);

      // Wait for completion
      await provisionPromise;

      const metaAfter = manager.getNodeMetadata('meta-prov-test');
      expect(metaAfter!.status).toBe('ready');
      expect(metaAfter!.endpointAvailable).toBe(true);
      expect(metaAfter!.estimatedReadyInMs).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('returns error for non-existent node', async () => {
      const result = await manager.provisionNode({ nodeId: 'non-existent' });
      expect(result.status).toBe('error');
      expect(result.error).toBe('Node not found');
    });

    test('throws for executeRequest on non-existent node', async () => {
      await expect(
        manager.executeRequest('non-existent', {}, async () => ({}))
      ).rejects.toThrow('not found');
    });
  });

  describe('Hardware Types', () => {
    test('registers CPU-only node', () => {
      const node = manager.registerNode({
        nodeId: 'cpu-only',
        name: 'CPU Only',
        hardwareType: 'cpu',
        teeType: 'none',
        gpuType: 'none',
        cpuCores: 8,
        memoryGb: 32,
        containerImage: 'cpu-worker:latest',
        idleTimeoutMs: 60000,
        coldStartTimeMs: 3000,
        pricePerHourWei: 500000000000000n,
        regions: ['us-east-1'],
      });

      expect(node.config.hardwareType).toBe('cpu');
      expect(node.config.gpuType).toBe('none');
    });

    test('registers GPU node with various GPU types', () => {
      const gpuTypes = ['H200', 'H100', 'A100_80', 'A100_40', 'RTX4090', 'L40S'] as const;

      for (const gpuType of gpuTypes) {
        const node = manager.registerNode({
          nodeId: `gpu-${gpuType}`,
          name: `GPU ${gpuType}`,
          hardwareType: 'gpu',
          teeType: 'none',
          gpuType,
          gpuMemoryGb: 80,
          cpuCores: 16,
          memoryGb: 128,
          containerImage: 'gpu-worker:latest',
          idleTimeoutMs: 120000,
          coldStartTimeMs: 15000,
          pricePerHourWei: 10000000000000000n,
          regions: ['us-west-2'],
        });

        expect(node.config.gpuType).toBe(gpuType);
      }
    });

    test('registers TEE nodes with various TEE types', () => {
      const teeTypes = ['phala', 'sgx', 'nitro', 'sev'] as const;

      for (const teeType of teeTypes) {
        const node = manager.registerNode({
          nodeId: `tee-${teeType}`,
          name: `TEE ${teeType}`,
          hardwareType: 'cpu',
          teeType,
          gpuType: 'none',
          cpuCores: 4,
          memoryGb: 16,
          containerImage: 'tee-worker:latest',
          idleTimeoutMs: 60000,
          coldStartTimeMs: 10000,
          pricePerHourWei: 2000000000000000n,
          regions: ['us-east-1'],
        });

        expect(node.config.teeType).toBe(teeType);
      }
    });

    test('registers GPU+TEE combo node', () => {
      const node = manager.registerNode({
        nodeId: 'gpu-tee-combo',
        name: 'GPU TEE Combo',
        hardwareType: 'gpu',
        teeType: 'phala',
        gpuType: 'H100',
        gpuMemoryGb: 80,
        cpuCores: 32,
        memoryGb: 256,
        containerImage: 'confidential-ai:latest',
        idleTimeoutMs: 300000,
        coldStartTimeMs: 45000,
        pricePerHourWei: 100000000000000000n,
        regions: ['us-west-2'],
      });

      expect(node.config.hardwareType).toBe('gpu');
      expect(node.config.teeType).toBe('phala');
      expect(node.config.gpuType).toBe('H100');
    });
  });
});
