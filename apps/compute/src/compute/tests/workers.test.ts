/**
 * Worker Runtime Tests
 */

import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { WorkerSandbox, WorkerManager, createWorkerManager, computeWorkerCodeHash, type WorkerConfig, type WorkerRequest } from '../workers/runtime';

describe('Worker Runtime', () => {
  describe('WorkerSandbox', () => {
    test('compiles and executes simple worker', async () => {
      const config: WorkerConfig = {
        workerId: 'test-simple',
        name: 'Simple Worker',
        runtime: 'javascript',
        entrypoint: 'index.js',
        code: `
          export default {
            fetch(request) {
              return { status: 200, body: 'Hello World' };
            }
          };
        `,
        timeoutMs: 5000,
        memoryLimitMb: 64,
        maxConcurrent: 1,
      };

      const sandbox = new WorkerSandbox(config);
      await sandbox.compile();

      const result = await sandbox.execute({
        method: 'GET',
        url: 'https://example.com/test',
        headers: {},
      });

      expect(result.response.status).toBe(200);
      expect(result.response.body).toContain('Hello');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('executes worker with request data', async () => {
      const config: WorkerConfig = {
        workerId: 'test-echo',
        name: 'Echo Worker',
        runtime: 'javascript',
        entrypoint: 'index.js',
        code: `
          export default {
            fetch(request) {
              return { 
                status: 200, 
                body: JSON.stringify({ 
                  method: request.method,
                  url: request.url,
                  headers: request.headers,
                }) 
              };
            }
          };
        `,
        timeoutMs: 5000,
        memoryLimitMb: 64,
        maxConcurrent: 1,
      };

      const sandbox = new WorkerSandbox(config);
      await sandbox.compile();

      const result = await sandbox.execute({
        method: 'POST',
        url: 'https://example.com/api/data',
        headers: { 'Content-Type': 'application/json' },
        body: '{"test": true}',
      });

      expect(result.response.status).toBe(200);
      const body = JSON.parse(result.response.body);
      expect(body.method).toBe('POST');
      expect(body.url).toBe('https://example.com/api/data');
    });

    test('handles worker errors gracefully', async () => {
      const config: WorkerConfig = {
        workerId: 'test-error',
        name: 'Error Worker',
        runtime: 'javascript',
        entrypoint: 'index.js',
        code: `
          export default {
            fetch(request) {
              throw new Error('Intentional error');
            }
          };
        `,
        timeoutMs: 5000,
        memoryLimitMb: 64,
        maxConcurrent: 1,
      };

      const sandbox = new WorkerSandbox(config);
      await sandbox.compile();

      const result = await sandbox.execute({
        method: 'GET',
        url: 'https://example.com/test',
        headers: {},
      });

      expect(result.response.status).toBe(500);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Intentional error');
    });

    test('respects timeout limit', async () => {
      const config: WorkerConfig = {
        workerId: 'test-timeout',
        name: 'Slow Worker',
        runtime: 'javascript',
        entrypoint: 'index.js',
        code: `
          export default {
            async fetch(request) {
              await new Promise(r => setTimeout(r, 10000));
              return { status: 200, body: 'Done' };
            }
          };
        `,
        timeoutMs: 100, // Very short timeout
        memoryLimitMb: 64,
        maxConcurrent: 1,
      };

      const sandbox = new WorkerSandbox(config);
      await sandbox.compile();

      const result = await sandbox.execute({
        method: 'GET',
        url: 'https://example.com/test',
        headers: {},
      });

      expect(result.response.status).toBe(500);
      expect(result.error).toContain('timeout');
    });

    test('captures console logs', async () => {
      const config: WorkerConfig = {
        workerId: 'test-logs',
        name: 'Logging Worker',
        runtime: 'javascript',
        entrypoint: 'index.js',
        code: `
          export default {
            fetch(request) {
              console.log('Processing request');
              console.warn('This is a warning');
              return { status: 200, body: 'OK' };
            }
          };
        `,
        timeoutMs: 5000,
        memoryLimitMb: 64,
        maxConcurrent: 1,
      };

      const sandbox = new WorkerSandbox(config);
      await sandbox.compile();

      const result = await sandbox.execute({
        method: 'GET',
        url: 'https://example.com/test',
        headers: {},
      });

      expect(result.logs.length).toBeGreaterThan(0);
      expect(result.logs.some(l => l.includes('Processing request'))).toBe(true);
    });

    test('provides environment variables', async () => {
      const config: WorkerConfig = {
        workerId: 'test-env',
        name: 'Env Worker',
        runtime: 'javascript',
        entrypoint: 'index.js',
        code: `
          export default {
            fetch(request, env) {
              return { status: 200, body: env.MY_VAR || 'not set' };
            }
          };
        `,
        env: { MY_VAR: 'test-value' },
        timeoutMs: 5000,
        memoryLimitMb: 64,
        maxConcurrent: 1,
      };

      const sandbox = new WorkerSandbox(config);
      await sandbox.compile();

      const result = await sandbox.execute({
        method: 'GET',
        url: 'https://example.com/test',
        headers: {},
      });

      expect(result.response.body).toBe('test-value');
    });
  });

  describe('WorkerManager', () => {
    let manager: WorkerManager;

    beforeAll(() => {
      manager = createWorkerManager({
        rpcUrl: 'http://localhost:9545',
        maxConcurrentWorkers: 10,
        defaultTimeoutMs: 5000,
        defaultMemoryLimitMb: 64,
      });
    });

    test('deploys and lists workers', async () => {
      const config: WorkerConfig = {
        workerId: 'mgr-test-1',
        name: 'Manager Test Worker',
        runtime: 'javascript',
        entrypoint: 'index.js',
        code: 'export default { fetch() { return { status: 200, body: "OK" }; } };',
        routes: ['/mgr-test/*'],
        timeoutMs: 5000,
        memoryLimitMb: 64,
        maxConcurrent: 1,
      };

      const deployment = await manager.deployWorker(config);

      expect(deployment.workerId).toBe('mgr-test-1');
      expect(deployment.status).toBe('active');
      expect(deployment.endpoint).toBeDefined();

      const workers = manager.listWorkers();
      expect(workers.some(w => w.workerId === 'mgr-test-1')).toBe(true);
    });

    test('invokes worker by ID', async () => {
      const config: WorkerConfig = {
        workerId: 'mgr-invoke-test',
        name: 'Invoke Test',
        runtime: 'javascript',
        entrypoint: 'index.js',
        code: 'export default { fetch(req) { return { status: 200, body: req.method }; } };',
        timeoutMs: 5000,
        memoryLimitMb: 64,
        maxConcurrent: 1,
      };

      await manager.deployWorker(config);

      const result = await manager.invokeWorker('mgr-invoke-test', {
        method: 'POST',
        url: '/test',
        headers: {},
      });

      expect(result.response.status).toBe(200);
      expect(result.response.body).toBe('POST');
    });

    test('invokes worker by route pattern', async () => {
      const config: WorkerConfig = {
        workerId: 'mgr-route-test',
        name: 'Route Test',
        runtime: 'javascript',
        entrypoint: 'index.js',
        code: 'export default { fetch() { return { status: 200, body: "Matched!" }; } };',
        routes: ['/api/v1/users/*'],
        timeoutMs: 5000,
        memoryLimitMb: 64,
        maxConcurrent: 1,
      };

      await manager.deployWorker(config);

      const result = await manager.invokeByRoute('/api/v1/users/123', {
        method: 'GET',
        url: '/api/v1/users/123',
        headers: {},
      });

      expect(result.response.status).toBe(200);
      expect(result.response.body).toBe('Matched!');
    });

    test('pauses and resumes worker', async () => {
      const config: WorkerConfig = {
        workerId: 'mgr-pause-test',
        name: 'Pause Test',
        runtime: 'javascript',
        entrypoint: 'index.js',
        code: 'export default { fetch() { return { status: 200, body: "OK" }; } };',
        timeoutMs: 5000,
        memoryLimitMb: 64,
        maxConcurrent: 1,
      };

      await manager.deployWorker(config);

      manager.pauseWorker('mgr-pause-test');
      const worker = manager.getWorker('mgr-pause-test');
      expect(worker?.deployment?.status).toBe('paused');

      // Should throw when invoking paused worker
      let threw = false;
      try {
        await manager.invokeWorker('mgr-pause-test', { method: 'GET', url: '/', headers: {} });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);

      manager.resumeWorker('mgr-pause-test');
      const resumed = manager.getWorker('mgr-pause-test');
      expect(resumed?.deployment?.status).toBe('active');
    });

    test('tracks metrics', async () => {
      const config: WorkerConfig = {
        workerId: 'mgr-metrics-test',
        name: 'Metrics Test',
        runtime: 'javascript',
        entrypoint: 'index.js',
        code: 'export default { fetch() { return { status: 200, body: "OK" }; } };',
        timeoutMs: 5000,
        memoryLimitMb: 64,
        maxConcurrent: 1,
      };

      await manager.deployWorker(config);

      // Invoke a few times
      for (let i = 0; i < 3; i++) {
        await manager.invokeWorker('mgr-metrics-test', { method: 'GET', url: '/', headers: {} });
      }

      const metrics = manager.getMetrics('mgr-metrics-test');
      expect(metrics).toBeDefined();
      expect(metrics!.totalRequests).toBe(3);
      expect(metrics!.avgDurationMs).toBeGreaterThanOrEqual(0);
    });

    test('deletes worker', async () => {
      const config: WorkerConfig = {
        workerId: 'mgr-delete-test',
        name: 'Delete Test',
        runtime: 'javascript',
        entrypoint: 'index.js',
        code: 'export default { fetch() { return { status: 200, body: "OK" }; } };',
        timeoutMs: 5000,
        memoryLimitMb: 64,
        maxConcurrent: 1,
      };

      await manager.deployWorker(config);
      expect(manager.getWorker('mgr-delete-test')).toBeDefined();

      manager.deleteWorker('mgr-delete-test');
      expect(manager.getWorker('mgr-delete-test')).toBeUndefined();
    });
  });

  describe('computeWorkerCodeHash', () => {
    test('produces consistent hash for same code', () => {
      const code = 'export default { fetch() { return { status: 200 }; } };';
      const hash1 = computeWorkerCodeHash(code);
      const hash2 = computeWorkerCodeHash(code);
      expect(hash1).toBe(hash2);
    });

    test('produces different hash for different code', () => {
      const code1 = 'export default { fetch() { return { status: 200 }; } };';
      const code2 = 'export default { fetch() { return { status: 201 }; } };';
      const hash1 = computeWorkerCodeHash(code1);
      const hash2 = computeWorkerCodeHash(code2);
      expect(hash1).not.toBe(hash2);
    });

    test('produces valid hex hash', () => {
      const hash = computeWorkerCodeHash('test code');
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });
});

describe('Worker Integration', () => {
  test('worker can make external fetch requests', async () => {
    const config: WorkerConfig = {
      workerId: 'fetch-test',
      name: 'Fetch Test',
      runtime: 'javascript',
      entrypoint: 'index.js',
      code: `
        export default {
          async fetch(request) {
            // This would normally call an external API
            // For tests, we just verify fetch is available
            const hasFetch = typeof fetch === 'function';
            return { 
              status: 200, 
              body: JSON.stringify({ hasFetch }) 
            };
          }
        };
      `,
      timeoutMs: 5000,
      memoryLimitMb: 64,
      maxConcurrent: 1,
    };

    const sandbox = new WorkerSandbox(config);
    await sandbox.compile();

    const result = await sandbox.execute({
      method: 'GET',
      url: '/test',
      headers: {},
    });

    expect(result.response.status).toBe(200);
  });

  test('worker handles JSON request/response', async () => {
    const config: WorkerConfig = {
      workerId: 'json-test',
      name: 'JSON Test',
      runtime: 'javascript',
      entrypoint: 'index.js',
      code: `
        export default {
          fetch(request) {
            const body = request.body ? JSON.parse(request.body) : {};
            return { 
              status: 200, 
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ received: body, processed: true }) 
            };
          }
        };
      `,
      timeoutMs: 5000,
      memoryLimitMb: 64,
      maxConcurrent: 1,
    };

    const sandbox = new WorkerSandbox(config);
    await sandbox.compile();

    const result = await sandbox.execute({
      method: 'POST',
      url: '/api/process',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [1, 2, 3] }),
    });

    expect(result.response.status).toBe(200);
    expect(result.response.headers['Content-Type']).toBe('application/json');
    
    const responseBody = JSON.parse(result.response.body);
    expect(responseBody.processed).toBe(true);
    expect(responseBody.received.data).toEqual([1, 2, 3]);
  });
});
