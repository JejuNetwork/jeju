/**
 * Container Execution HTTP Routes
 * REST API for serverless and dedicated container execution
 */

import { Hono } from 'hono';
import type { Address } from 'viem';

import {
  runContainer,
  getExecution,
  getExecutionResult,
  listExecutions,
  cancelExecution,
  estimateCost,
  getSystemStats,
  getAllPoolStats,
  getCacheStats,
  analyzeDeduplication,
  getAllNodes,
  getSchedulerStats,
  registerNode,
  warmContainers,
  type ExecutionRequest,
  type ContainerResources,
  type ComputeNode,
} from '../../containers';

export function createContainerRouter(): Hono {
  const app = new Hono();

  // ============================================================================
  // Health & Status
  // ============================================================================

  app.get('/health', (c) => {
    const stats = getSystemStats();
    return c.json({
      status: 'healthy',
      service: 'container-execution',
      pendingExecutions: stats.executor.pendingExecutions,
      completedExecutions: stats.executor.completedExecutions,
      cacheUtilization: `${stats.cache.cacheUtilization}%`,
      coldStartRate: `${stats.executor.coldStartRate}%`,
    });
  });

  app.get('/stats', (c) => {
    return c.json(getSystemStats());
  });

  // ============================================================================
  // Container Execution
  // ============================================================================

  app.post('/execute', async (c) => {
    const userAddress = c.req.header('x-jeju-address') as Address;
    if (!userAddress) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const body = await c.req.json<{
      image: string;
      command?: string[];
      env?: Record<string, string>;
      resources?: Partial<ContainerResources>;
      mode?: 'serverless' | 'dedicated' | 'spot';
      timeout?: number;
      input?: unknown;
      webhook?: string;
    }>();

    if (!body.image) {
      return c.json({ error: 'Image reference is required' }, 400);
    }

    const request: ExecutionRequest = {
      imageRef: body.image,
      command: body.command,
      env: body.env,
      resources: {
        cpuCores: body.resources?.cpuCores ?? 1,
        memoryMb: body.resources?.memoryMb ?? 512,
        storageMb: body.resources?.storageMb ?? 1024,
        gpuType: body.resources?.gpuType,
        gpuCount: body.resources?.gpuCount,
      },
      mode: body.mode ?? 'serverless',
      timeout: body.timeout ?? 300000,
      input: body.input,
      webhook: body.webhook,
    };

    const result = await runContainer(request, userAddress);

    return c.json({
      executionId: result.executionId,
      instanceId: result.instanceId,
      status: result.status,
      output: result.output,
      exitCode: result.exitCode,
      metrics: {
        ...result.metrics,
        wasColdStart: result.metrics.wasColdStart,
      },
    });
  });

  app.get('/executions', (c) => {
    const userAddress = c.req.header('x-jeju-address') as Address;
    const executions = listExecutions(userAddress);

    return c.json({
      executions: executions.map((e) => ({
        executionId: e.executionId,
        image: e.request.imageRef,
        status: e.status,
        submittedAt: e.submittedAt,
        startedAt: e.startedAt,
      })),
      total: executions.length,
    });
  });

  app.get('/executions/:id', (c) => {
    const executionId = c.req.param('id');

    // Check pending first
    const pending = getExecution(executionId);
    if (pending) {
      return c.json({
        executionId: pending.executionId,
        image: pending.request.imageRef,
        status: pending.status,
        submittedAt: pending.submittedAt,
        startedAt: pending.startedAt,
        instanceId: pending.instanceId,
      });
    }

    // Check completed
    const result = getExecutionResult(executionId);
    if (result) {
      return c.json(result);
    }

    return c.json({ error: 'Execution not found' }, 404);
  });

  app.post('/executions/:id/cancel', (c) => {
    const executionId = c.req.param('id');
    const cancelled = cancelExecution(executionId);

    if (!cancelled) {
      return c.json({ error: 'Execution not found or cannot be cancelled' }, 400);
    }

    return c.json({ executionId, status: 'cancelled' });
  });

  // ============================================================================
  // Cost Estimation
  // ============================================================================

  app.post('/estimate', async (c) => {
    const body = await c.req.json<{
      resources: ContainerResources;
      durationMs: number;
      expectColdStart?: boolean;
    }>();

    const cost = estimateCost(
      body.resources,
      body.durationMs,
      body.expectColdStart ?? false
    );

    return c.json({
      estimatedCost: cost.toString(),
      estimatedCostEth: (Number(cost) / 1e18).toFixed(18),
      breakdown: {
        durationMs: body.durationMs,
        resources: body.resources,
        coldStartPenalty: body.expectColdStart,
      },
    });
  });

  // ============================================================================
  // Warm Pool Management
  // ============================================================================

  app.get('/pools', (c) => {
    const pools = getAllPoolStats();
    return c.json({ pools, total: pools.length });
  });

  app.post('/warm', async (c) => {
    const userAddress = c.req.header('x-jeju-address') as Address;
    if (!userAddress) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const body = await c.req.json<{
      image: string;
      count: number;
      resources?: Partial<ContainerResources>;
    }>();

    if (!body.image || !body.count) {
      return c.json({ error: 'Image and count are required' }, 400);
    }

    await warmContainers(
      body.image,
      body.count,
      {
        cpuCores: body.resources?.cpuCores ?? 1,
        memoryMb: body.resources?.memoryMb ?? 512,
        storageMb: body.resources?.storageMb ?? 1024,
      },
      userAddress
    );

    return c.json({
      message: 'Warming request queued',
      image: body.image,
      count: body.count,
    });
  });

  // ============================================================================
  // Cache Management
  // ============================================================================

  app.get('/cache', (c) => {
    const stats = getCacheStats();
    return c.json(stats);
  });

  app.get('/cache/deduplication', (c) => {
    const analysis = analyzeDeduplication();
    return c.json({
      ...analysis,
      savedBytes: analysis.savedBytes,
      savedMb: Math.round(analysis.savedBytes / (1024 * 1024)),
    });
  });

  // ============================================================================
  // Node Management
  // ============================================================================

  app.get('/nodes', (c) => {
    const nodes = getAllNodes();
    return c.json({
      nodes: nodes.map((n) => ({
        nodeId: n.nodeId,
        region: n.region,
        zone: n.zone,
        status: n.status,
        resources: {
          totalCpu: n.resources.totalCpu,
          availableCpu: n.resources.availableCpu,
          totalMemoryMb: n.resources.totalMemoryMb,
          availableMemoryMb: n.resources.availableMemoryMb,
        },
        containers: n.containers.size,
        cachedImages: n.cachedImages.size,
        lastHeartbeat: n.lastHeartbeat,
        reputation: n.reputation,
      })),
      total: nodes.length,
    });
  });

  app.post('/nodes', async (c) => {
    const body = await c.req.json<{
      nodeId: string;
      address: Address;
      endpoint: string;
      region: string;
      zone: string;
      totalCpu: number;
      totalMemoryMb: number;
      totalStorageMb: number;
      gpuTypes?: string[];
      capabilities?: string[];
    }>();

    const node: ComputeNode = {
      nodeId: body.nodeId,
      address: body.address,
      endpoint: body.endpoint,
      region: body.region,
      zone: body.zone,
      resources: {
        totalCpu: body.totalCpu,
        totalMemoryMb: body.totalMemoryMb,
        totalStorageMb: body.totalStorageMb,
        availableCpu: body.totalCpu,
        availableMemoryMb: body.totalMemoryMb,
        availableStorageMb: body.totalStorageMb,
        gpuTypes: body.gpuTypes ?? [],
      },
      capabilities: body.capabilities ?? [],
      containers: new Map(),
      cachedImages: new Set(),
      lastHeartbeat: Date.now(),
      status: 'online',
      reputation: 100,
    };

    registerNode(node);

    return c.json({ nodeId: node.nodeId, status: 'registered' }, 201);
  });

  app.get('/scheduler', (c) => {
    return c.json(getSchedulerStats());
  });

  return app;
}

