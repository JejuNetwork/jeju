/**
 * Worker API Server - REST API for deploying and invoking Workers
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Address } from 'viem';
import { createWorkerManager, computeWorkerCodeHash, type WorkerConfig, type WorkerManager, type WorkerRequest } from './runtime';

export interface WorkerServerConfig {
  rpcUrl: string;
  registryAddress?: Address;
  port: number;
  corsOrigins?: string[];
}

export function createWorkerApi(manager: WorkerManager): Hono {
  const app = new Hono();

  app.use('/*', cors());

  app.get('/health', (c) => c.json({ status: 'ok', workers: manager.listWorkers().length }));

  // List all workers
  app.get('/api/v1/workers', (c) => {
    const workers = manager.listWorkers();
    return c.json({ workers });
  });

  // Get worker details
  app.get('/api/v1/workers/:workerId', (c) => {
    const workerId = c.req.param('workerId');
    const worker = manager.getWorker(workerId);
    if (!worker) return c.json({ error: 'Worker not found' }, 404);
    
    const metrics = manager.getMetrics(workerId);
    return c.json({ worker, metrics });
  });

  // Deploy a new worker
  app.post('/api/v1/workers', async (c) => {
    const body = await c.req.json<{
      name: string;
      code: string;
      runtime?: 'javascript' | 'typescript' | 'wasm';
      entrypoint?: string;
      env?: Record<string, string>;
      routes?: string[];
      cronSchedule?: string;
      timeoutMs?: number;
      memoryLimitMb?: number;
      maxConcurrent?: number;
    }>();

    if (!body.name || !body.code) {
      return c.json({ error: 'name and code are required' }, 400);
    }

    const codeHash = computeWorkerCodeHash(body.code);
    const workerId = `worker-${body.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${codeHash.slice(2, 10)}`;

    const config: WorkerConfig = {
      workerId,
      name: body.name,
      runtime: body.runtime ?? 'javascript',
      entrypoint: body.entrypoint ?? 'index.js',
      code: body.code,
      env: body.env,
      routes: body.routes,
      cronSchedule: body.cronSchedule,
      timeoutMs: body.timeoutMs ?? 30000,
      memoryLimitMb: body.memoryLimitMb ?? 128,
      maxConcurrent: body.maxConcurrent ?? 10,
    };

    const deployment = await manager.deployWorker(config);
    return c.json({ deployment }, 201);
  });

  // Update worker code
  app.put('/api/v1/workers/:workerId', async (c) => {
    const workerId = c.req.param('workerId');
    const existing = manager.getWorker(workerId);
    if (!existing) return c.json({ error: 'Worker not found' }, 404);

    const body = await c.req.json<{ code?: string; env?: Record<string, string>; routes?: string[] }>();

    // Re-deploy with updated config
    const config: WorkerConfig = {
      ...existing.config,
      code: body.code ?? existing.config.code,
      env: body.env ?? existing.config.env,
      routes: body.routes ?? existing.config.routes,
    };

    manager.deleteWorker(workerId);
    const deployment = await manager.deployWorker(config);
    return c.json({ deployment });
  });

  // Delete worker
  app.delete('/api/v1/workers/:workerId', (c) => {
    const workerId = c.req.param('workerId');
    manager.deleteWorker(workerId);
    return c.json({ success: true });
  });

  // Pause worker
  app.post('/api/v1/workers/:workerId/pause', (c) => {
    const workerId = c.req.param('workerId');
    manager.pauseWorker(workerId);
    return c.json({ success: true });
  });

  // Resume worker
  app.post('/api/v1/workers/:workerId/resume', (c) => {
    const workerId = c.req.param('workerId');
    manager.resumeWorker(workerId);
    return c.json({ success: true });
  });

  // Invoke worker directly
  app.post('/api/v1/workers/:workerId/invoke', async (c) => {
    const workerId = c.req.param('workerId');
    
    let body: string | undefined;
    try {
      body = await c.req.text();
    } catch {
      body = undefined;
    }

    const request: WorkerRequest = {
      method: c.req.method,
      url: c.req.url,
      headers: Object.fromEntries(c.req.raw.headers),
      body,
    };

    const result = await manager.invokeWorker(workerId, request);
    
    // Return the worker's response
    return c.json({
      ...result.response,
      _execution: {
        executionId: result.executionId,
        durationMs: result.durationMs,
        memoryUsedMb: result.memoryUsedMb,
        logs: result.logs,
        error: result.error,
      },
    }, result.response.status as 200);
  });

  // Get worker metrics
  app.get('/api/v1/workers/:workerId/metrics', (c) => {
    const workerId = c.req.param('workerId');
    const metrics = manager.getMetrics(workerId);
    if (!metrics) return c.json({ error: 'Worker not found' }, 404);
    return c.json({ metrics });
  });

  // Catch-all for worker routes (invoke by route pattern)
  app.all('/w/*', async (c) => {
    const route = c.req.path.replace(/^\/w/, '');
    
    let body: string | undefined;
    try {
      body = await c.req.text();
    } catch {
      body = undefined;
    }

    const request: WorkerRequest = {
      method: c.req.method,
      url: c.req.url,
      headers: Object.fromEntries(c.req.raw.headers),
      body,
      cf: {
        country: c.req.header('cf-ipcountry'),
        city: c.req.header('cf-ipcity'),
      },
    };

    try {
      const result = await manager.invokeByRoute(route, request);
      
      const response = new Response(result.response.body, {
        status: result.response.status,
        statusText: result.response.statusText,
        headers: new Headers(result.response.headers),
      });
      
      return response;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ error: message }, 404);
    }
  });

  return app;
}

export async function startWorkerServer(config: Partial<WorkerServerConfig> = {}): Promise<void> {
  const port = config.port ?? parseInt(process.env.WORKER_SERVER_PORT ?? '4020', 10);
  const rpcUrl = config.rpcUrl ?? process.env.RPC_URL ?? 'http://localhost:9545';

  const manager = createWorkerManager({ rpcUrl, registryAddress: config.registryAddress });
  const app = createWorkerApi(manager);

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    Worker Runtime                          ║
║           Serverless Execution Environment                 ║
╠═══════════════════════════════════════════════════════════╣
║  Port:     ${port.toString().padEnd(44)}║
║  RPC:      ${rpcUrl.slice(0, 44).padEnd(44)}║
╚═══════════════════════════════════════════════════════════╝
`);

  Bun.serve({
    port,
    fetch: app.fetch,
  });

  console.log(`Worker Runtime listening on port ${port}`);
}

if (import.meta.main) {
  startWorkerServer();
}
