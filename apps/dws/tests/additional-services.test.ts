/**
 * Additional DWS Services Tests
 * Tests for A2A, MCP, OAuth3, Load Balancer, and Triggers
 */

import { describe, test, expect, afterAll, beforeEach } from 'bun:test';
import { app } from '../src/server';
import { LoadBalancer } from '../src/load-balancer';
import { CircuitBreaker, CircuitOpenError } from '../src/load-balancer/circuit-breaker';
import type { ServiceDefinition } from '../src/load-balancer/types';

describe('A2A Routes', () => {
  test('GET /a2a/capabilities returns available capabilities', async () => {
    const res = await app.fetch(new Request('http://localhost/a2a/capabilities'));
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.capabilities).toBeDefined();
    expect(Array.isArray(data.capabilities)).toBe(true);
    expect(data.capabilities).toContain('storage');
    expect(data.capabilities).toContain('compute');
    expect(data.capabilities).toContain('cdn');
  });
});

describe('MCP Routes', () => {
  test('POST /mcp/initialize returns protocol info', async () => {
    const res = await app.fetch(new Request('http://localhost/mcp/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.protocolVersion).toBe('2024-11-05');
    expect(data.capabilities).toBeDefined();
    expect(data.serverInfo.name).toBe('dws-mcp');
  });

  test('POST /mcp/resources/list returns available resources', async () => {
    const res = await app.fetch(new Request('http://localhost/mcp/resources/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.resources).toBeDefined();
    expect(Array.isArray(data.resources)).toBe(true);
    expect(data.resources.length).toBeGreaterThan(0);
    
    const uris = data.resources.map((r: { uri: string }) => r.uri);
    expect(uris).toContain('dws://storage/stats');
    expect(uris).toContain('dws://compute/status');
    expect(uris).toContain('dws://cdn/stats');
  });

  test('POST /mcp/tools/list returns available tools', async () => {
    const res = await app.fetch(new Request('http://localhost/mcp/tools/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.tools).toBeDefined();
    expect(Array.isArray(data.tools)).toBe(true);
    
    const toolNames = data.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain('dws_upload');
    expect(toolNames).toContain('dws_download');
    expect(toolNames).toContain('dws_create_repo');
    expect(toolNames).toContain('dws_run_compute');
    expect(toolNames).toContain('dws_chat');
  });

  test('POST /mcp/resources/read returns resource data', async () => {
    const res = await app.fetch(new Request('http://localhost/mcp/resources/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: 'dws://ci/runs' }),
    }));
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.contents).toBeDefined();
    expect(Array.isArray(data.contents)).toBe(true);
    expect(data.contents[0].uri).toBe('dws://ci/runs');
  });

  test('POST /mcp/resources/read returns error for unknown resource', async () => {
    const res = await app.fetch(new Request('http://localhost/mcp/resources/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: 'dws://unknown/resource' }),
    }));
    expect(res.status).toBe(400);
    
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  test('POST /mcp/tools/call returns error for unknown tool', async () => {
    const res = await app.fetch(new Request('http://localhost/mcp/tools/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'unknown_tool', arguments: {} }),
    }));
    expect(res.status).toBe(400);
    
    const data = await res.json();
    expect(data.error).toBeDefined();
  });
});

describe('OAuth3 Routes', () => {
  test('GET /oauth3/health returns health status', async () => {
    const res = await app.fetch(new Request('http://localhost/oauth3/health'));
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.status).toBe('healthy');
    expect(data.service).toBe('dws-auth');
    expect(data.mode).toBeDefined(); // 'integrated' or 'hybrid'
  });

  test('POST /oauth3/auth/challenge generates challenge', async () => {
    const res = await app.fetch(new Request('http://localhost/oauth3/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '0x1234567890123456789012345678901234567890' }),
    }));
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.challenge).toBeDefined();
    expect(data.expiresAt).toBeDefined();
  });

  test('GET /oauth3/vault/secrets lists secrets', async () => {
    const res = await app.fetch(new Request('http://localhost/oauth3/vault/secrets', {
      headers: { 'x-jeju-address': '0x1234567890123456789012345678901234567890' },
    }));
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.secrets).toBeDefined();
    expect(Array.isArray(data.secrets)).toBe(true);
  });

  test('POST /oauth3/vault/secrets stores secret', async () => {
    const res = await app.fetch(new Request('http://localhost/oauth3/vault/secrets', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-jeju-address': '0xabcdef1234567890123456789012345678901234',
      },
      body: JSON.stringify({ name: 'test-secret', value: 'secret-value' }),
    }));
    expect(res.status).toBe(201);
    
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.name).toBe('test-secret');
  });
});

describe('Load Balancer', () => {
  let lb: LoadBalancer;

  beforeEach(() => {
    lb = new LoadBalancer({
      minInstances: 0,
      maxInstances: 5,
      targetConcurrency: 10,
    });
  });

  afterAll(() => {
    lb?.stop();
  });

  test('registers and unregisters services', () => {
    const service: ServiceDefinition = {
      id: 'test-service',
      name: 'Test Service',
      type: 'worker',
      env: {},
      ports: [8080],
      resources: {
        cpuCores: 1,
        memoryMb: 256,
      },
      healthCheck: {
        path: '/health',
        port: 8080,
        interval: 10000,
        timeout: 5000,
        healthyThreshold: 2,
        unhealthyThreshold: 3,
      },
      scaling: {
        minInstances: 0,
        maxInstances: 3,
        targetConcurrency: 10,
        scaleUpThreshold: 5,
        scaleDownDelay: 60000,
      },
    };

    lb.registerService(service);
    const stats = lb.getStats();
    expect(stats.totalInstances).toBeGreaterThanOrEqual(0);

    lb.unregisterService(service.id);
  });

  test('returns stats', () => {
    const stats = lb.getStats();
    expect(stats.activeInstances).toBeDefined();
    expect(stats.totalInstances).toBeDefined();
    expect(stats.queuedRequests).toBeDefined();
    expect(stats.totalRequestsServed).toBeDefined();
    expect(stats.avgLatencyMs).toBeDefined();
  });

  test('handles route for unregistered service', async () => {
    const request = new Request('http://localhost/test');
    const response = await lb.route('nonexistent', request);
    expect(response.status).toBe(404);
    
    const data = await response.json();
    expect(data.error).toBe('Service not found');
  });

  test('start and stop lifecycle', () => {
    lb.start();
    // Should not throw
    lb.stop();
  });
});

describe('Circuit Breaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 1000,
    });
  });

  test('executes successful operations', async () => {
    const result = await cb.execute('test', async () => 'success');
    expect(result).toBe('success');
  });

  test('opens circuit after failures', async () => {
    const failingFn = async () => {
      throw new Error('failure');
    };

    // Trigger failures
    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute('test-fail', failingFn);
      } catch {
        // Expected
      }
    }

    // Circuit should be open now
    try {
      await cb.execute('test-fail', failingFn);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(CircuitOpenError);
    }
  });

  test('returns stats', () => {
    const stats = cb.getStats();
    expect(typeof stats).toBe('object');
  });
});

describe('CI Service', () => {
  test('GET /ci/health returns health status', async () => {
    const res = await app.fetch(new Request('http://localhost/ci/health'));
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.service).toBe('dws-ci');
    expect(data.status).toBe('healthy');
  });
});

describe('Agent Discovery', () => {
  test('GET /.well-known/agent-card.json returns agent card', async () => {
    const res = await app.fetch(new Request('http://localhost/.well-known/agent-card.json'));
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.name).toBe('DWS');
    expect(data.version).toBeDefined();
    expect(data.capabilities).toBeDefined();
    expect(Array.isArray(data.capabilities)).toBe(true);
    expect(data.a2aEndpoint).toBeDefined();
    expect(data.mcpEndpoint).toBeDefined();
  });
});

describe('Internal Endpoints', () => {
  test('GET /_internal/ratelimit/:clientKey returns rate limit count', async () => {
    const res = await app.fetch(new Request('http://localhost/_internal/ratelimit/test-client'));
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.count).toBeDefined();
    expect(typeof data.count).toBe('number');
  });

  test('GET /_internal/peers returns peers list', async () => {
    const res = await app.fetch(new Request('http://localhost/_internal/peers'));
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.peers).toBeDefined();
    expect(Array.isArray(data.peers)).toBe(true);
  });
});

