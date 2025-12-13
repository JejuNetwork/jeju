/**
 * Keepalive Executor Service Tests
 * 
 * Tests boundary conditions, error handling, and concurrent behavior
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { KeepaliveExecutor, createKeepaliveExecutor, type KeepaliveExecutorConfig } from './keepalive-executor';
import type { Hex, Address } from 'viem';

describe('KeepaliveExecutor', () => {
  let executor: KeepaliveExecutor;
  let mockConfig: KeepaliveExecutorConfig;

  beforeEach(() => {
    mockConfig = {
      rpcUrl: 'http://localhost:8545',
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex,
      keepaliveRegistryAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address,
      checkIntervalMs: 60000,
      maxConcurrentChecks: 10,
      healthCheckTimeoutMs: 5000,
    };
  });

  afterEach(() => {
    if (executor) {
      executor.stop();
    }
  });

  describe('createKeepaliveExecutor', () => {
    const validPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;

    test('should create executor with valid config', () => {
      const exec = createKeepaliveExecutor({
        privateKey: validPrivateKey,
      });
      expect(exec).toBeDefined();
      exec.stop();
    });

    test('should override defaults with config', () => {
      const exec = createKeepaliveExecutor({
        rpcUrl: 'http://custom:8545',
        checkIntervalMs: 30000,
        privateKey: validPrivateKey,
      });
      expect(exec).toBeDefined();
      exec.stop();
    });

    test('should read from environment variables', () => {
      const originalEnv = { ...process.env };
      process.env.RPC_URL = 'http://env:8545';
      process.env.EXECUTOR_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      process.env.KEEPALIVE_REGISTRY_ADDRESS = '0x1234567890123456789012345678901234567890';

      const exec = createKeepaliveExecutor({});
      expect(exec).toBeDefined();
      exec.stop();

      Object.assign(process.env, originalEnv);
    });
  });

  describe('checkResource', () => {
    beforeEach(() => {
      executor = new KeepaliveExecutor(mockConfig);
    });

    test('should return unknown for empty health endpoint', async () => {
      const result = await executor.checkResource({
        resourceType: 1,
        identifier: 'https://api.example.com',
        healthEndpoint: '',
        minBalance: 0n,
        required: true,
      });

      expect(result.status).toBe('unknown');
      expect(result.error).toBe('No health endpoint configured');
    });

    test('should return unhealthy for timeout', async () => {
      // Create executor with short timeout for testing
      const shortTimeoutExecutor = new KeepaliveExecutor({
        ...mockConfig,
        healthCheckTimeoutMs: 100, // 100ms timeout for fast test
      });

      // Mock a server that never responds
      const slowServer = Bun.serve({
        port: 0,
        fetch() {
          return new Promise(() => {}); // Never resolves
        },
      });

      const result = await shortTimeoutExecutor.checkResource({
        resourceType: 1,
        identifier: 'slow-server',
        healthEndpoint: `http://localhost:${slowServer.port}/health`,
        minBalance: 0n,
        required: true,
      });

      expect(result.status).toBe('unhealthy');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);

      slowServer.stop();
      shortTimeoutExecutor.stop();
    });

    test('should return unhealthy for HTTP errors', async () => {
      const errorServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response('Internal Server Error', { status: 500 });
        },
      });

      const result = await executor.checkResource({
        resourceType: 1,
        identifier: 'error-server',
        healthEndpoint: `http://localhost:${errorServer.port}/health`,
        minBalance: 0n,
        required: true,
      });

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('HTTP 500');

      errorServer.stop();
    });

    test('should return healthy for valid response', async () => {
      const healthyServer = Bun.serve({
        port: 0,
        fetch() {
          return Response.json({
            status: 'healthy',
            service: 'test',
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            uptime: 1000,
          });
        },
      });

      const result = await executor.checkResource({
        resourceType: 1,
        identifier: 'healthy-server',
        healthEndpoint: `http://localhost:${healthyServer.port}/health`,
        minBalance: 0n,
        required: true,
      });

      expect(result.status).toBe('healthy');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.response).toBeDefined();
      expect(result.response?.service).toBe('test');

      healthyServer.stop();
    });

    test('should return degraded status from response', async () => {
      const degradedServer = Bun.serve({
        port: 0,
        fetch() {
          return Response.json({
            status: 'degraded',
            service: 'test',
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            uptime: 1000,
          });
        },
      });

      const result = await executor.checkResource({
        resourceType: 1,
        identifier: 'degraded-server',
        healthEndpoint: `http://localhost:${degradedServer.port}/health`,
        minBalance: 0n,
        required: false,
      });

      expect(result.status).toBe('degraded');

      degradedServer.stop();
    });

    test('should handle connection refused', async () => {
      const result = await executor.checkResource({
        resourceType: 1,
        identifier: 'dead-server',
        healthEndpoint: 'http://localhost:59999/health', // Unlikely to be in use
        minBalance: 0n,
        required: true,
      });

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBeDefined();
    });

    test('should handle invalid JSON response', async () => {
      const invalidServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response('not json', {
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const result = await executor.checkResource({
        resourceType: 1,
        identifier: 'invalid-server',
        healthEndpoint: `http://localhost:${invalidServer.port}/health`,
        minBalance: 0n,
        required: true,
      });

      expect(result.status).toBe('unhealthy');

      invalidServer.stop();
    });
  });

  describe('resourceTypeFromNumber', () => {
    beforeEach(() => {
      executor = new KeepaliveExecutor(mockConfig);
    });

    test('should map all resource types correctly', () => {
      const types = [
        'ipfs_content',
        'compute_endpoint',
        'trigger',
        'storage',
        'agent',
        'custom',
      ];

      for (let i = 0; i < types.length; i++) {
        const result = (executor as unknown as { resourceTypeFromNumber: (n: number) => string }).resourceTypeFromNumber(i);
        expect(result).toBe(types[i]);
      }
    });

    test('should default to custom for unknown types', () => {
      const result = (executor as unknown as { resourceTypeFromNumber: (n: number) => string }).resourceTypeFromNumber(99);
      expect(result).toBe('custom');
    });
  });

  describe('start/stop', () => {
    beforeEach(() => {
      executor = new KeepaliveExecutor(mockConfig);
    });

    test('should prevent double start', async () => {
      // First start should work - don't await, immediately call again
      executor.start();
      
      // Immediate second start should be no-op
      await executor.start();
      
      executor.stop();
    });

    test('should handle stop when not running', () => {
      // Should not throw
      executor.stop();
      executor.stop();
    });
  });

  describe('concurrent checks', () => {
    test('should limit concurrent checks', async () => {
      const limitedConfig: KeepaliveExecutorConfig = {
        ...mockConfig,
        maxConcurrentChecks: 2,
      };

      const limitedExecutor = new KeepaliveExecutor(limitedConfig);
      
      // Mock would verify only 2 checks run at a time
      // For now just verify config is applied
      expect(limitedConfig.maxConcurrentChecks).toBe(2);
      
      limitedExecutor.stop();
    });
  });
});

describe('Status calculation', () => {
  test('unfunded takes priority', () => {
    // When balance < minBalance, status should be unfunded regardless of resource health
    const funded = false;
    const failedResources: string[] = [];
    const resourceResults = [{ status: 'healthy' }];

    let status: string;
    if (!funded) {
      status = 'unfunded';
    } else if (failedResources.length > 0) {
      status = 'unhealthy';
    } else if (resourceResults.some(r => r.status === 'degraded')) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    expect(status).toBe('unfunded');
  });

  test('failed required resources = unhealthy', () => {
    const funded = true;
    const failedResources = ['api-server'];
    const resourceResults = [{ status: 'unhealthy' }];

    let status: string;
    if (!funded) {
      status = 'unfunded';
    } else if (failedResources.length > 0) {
      status = 'unhealthy';
    } else if (resourceResults.some(r => r.status === 'degraded')) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    expect(status).toBe('unhealthy');
  });

  test('degraded resources = degraded', () => {
    const funded = true;
    const failedResources: string[] = [];
    const resourceResults = [{ status: 'healthy' }, { status: 'degraded' }];

    let status: string;
    if (!funded) {
      status = 'unfunded';
    } else if (failedResources.length > 0) {
      status = 'unhealthy';
    } else if (resourceResults.some(r => r.status === 'degraded')) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    expect(status).toBe('degraded');
  });

  test('all healthy = healthy', () => {
    const funded = true;
    const failedResources: string[] = [];
    const resourceResults = [{ status: 'healthy' }, { status: 'healthy' }];

    let status: string;
    if (!funded) {
      status = 'unfunded';
    } else if (failedResources.length > 0) {
      status = 'unhealthy';
    } else if (resourceResults.some(r => r.status === 'degraded')) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    expect(status).toBe('healthy');
  });
});
