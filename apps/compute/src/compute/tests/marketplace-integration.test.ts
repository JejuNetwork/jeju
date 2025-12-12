/**
 * Marketplace Integration Tests
 * 
 * Tests integration points with real HTTP servers:
 * - Model discovery with actual endpoints
 * - Payment flow through complete cycle
 * - Error handling for network failures
 * - Concurrent requests and race conditions
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Wallet } from 'ethers';
import { Hono } from 'hono';
import { serve } from 'bun';
import type { Address } from 'viem';
import {
  CloudProviderBridge,
  createCloudBridge,
  ComputeNodeManager,
  createComputeNodeManager,
  createModelDiscovery,
  type CloudModelInfo,
} from '../sdk/cloud-integration';
import { X402Client, parseX402Header } from '../sdk/x402';

type BunServer = ReturnType<typeof serve>;

const createWallet = (): Wallet => Wallet.createRandom() as unknown as Wallet;

// ============================================================================
// Mock Cloud Provider Server
// ============================================================================

function createMockCloudServer(port: number) {
  const models: CloudModelInfo[] = [
    { id: 'gpt-4', name: 'GPT-4', provider: 'openai', modelType: 'llm', contextWindow: 128000 },
    { id: 'claude-3', name: 'Claude 3', provider: 'anthropic', modelType: 'llm', contextWindow: 200000, multiModal: true },
    { id: 'dall-e-3', name: 'DALL-E 3', provider: 'openai', modelType: 'image' },
    { id: 'whisper-1', name: 'Whisper', provider: 'openai', modelType: 'audio' },
  ];

  let requestCount = 0;
  let shouldFailModels = false;
  let shouldDelayMs = 0;
  let inferenceRequests: Array<{ model: string; messages: unknown[] }> = [];

  const app = new Hono();

  app.get('/api/v1/models', async (c) => {
    requestCount++;
    if (shouldDelayMs > 0) await new Promise(r => setTimeout(r, shouldDelayMs));
    if (shouldFailModels) return c.json({ error: 'Service unavailable' }, 503);
    return c.json({ models });
  });

  app.post('/api/v1/chat/completions', async (c) => {
    requestCount++;
    const body = await c.req.json() as { model: string; messages: unknown[] };
    inferenceRequests.push(body);

    return c.json({
      id: `req-${Date.now()}`,
      model: body.model,
      choices: [{ message: { content: `Response for ${body.model}` } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
  });

  const server = serve({ port, fetch: app.fetch });

  return {
    server,
    getRequestCount: () => requestCount,
    resetRequestCount: () => { requestCount = 0; },
    setFailModels: (fail: boolean) => { shouldFailModels = fail; },
    setDelay: (ms: number) => { shouldDelayMs = ms; },
    getInferenceRequests: () => inferenceRequests,
    clearInferenceRequests: () => { inferenceRequests = []; },
  };
}

// ============================================================================
// Cloud Provider Bridge Integration Tests
// ============================================================================

describe('CloudProviderBridge Integration', () => {
  let mockServer: ReturnType<typeof createMockCloudServer>;
  let port = 8750;

  beforeAll(() => {
    mockServer = createMockCloudServer(port);
  });

  afterAll(() => {
    mockServer.server.stop();
  });

  beforeEach(() => {
    mockServer.resetRequestCount();
    mockServer.setFailModels(false);
    mockServer.setDelay(0);
    mockServer.clearInferenceRequests();
  });

  test('discovers all models from cloud endpoint', async () => {
    const bridge = createCloudBridge({
      cloudEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
    });

    await bridge.initialize();
    const results = await bridge.discoverModels();

    expect(results.length).toBe(4);
    expect(results.map(r => r.model.name)).toContain('GPT-4');
    expect(results.map(r => r.model.name)).toContain('Claude 3');
    expect(mockServer.getRequestCount()).toBeGreaterThanOrEqual(1);
  });

  test('filters models by type', async () => {
    const bridge = createCloudBridge({
      cloudEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
    });

    await bridge.initialize();

    const llmResults = await bridge.discoverModels({ modelType: 0 }); // LLM = 0
    expect(llmResults.length).toBe(2);
    expect(llmResults.every(r => r.model.name.includes('GPT') || r.model.name.includes('Claude'))).toBe(true);
  });

  test('handles cloud endpoint failure gracefully', async () => {
    mockServer.setFailModels(true);

    const bridge = createCloudBridge({
      cloudEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
    });

    await expect(bridge.initialize()).rejects.toThrow();
  });

  test('makes inference request with correct payload', async () => {
    const bridge = createCloudBridge({
      cloudEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
    });

    await bridge.initialize();

    const result = await bridge.inference(
      'gpt-4',
      [{ role: 'user', content: 'Hello' }],
      { temperature: 0.5, maxTokens: 100 }
    );

    expect(result.model).toBe('gpt-4');
    expect(result.content).toBe('Response for gpt-4');
    expect(result.usage.totalTokens).toBe(30);

    const requests = mockServer.getInferenceRequests();
    expect(requests.length).toBe(1);
    expect(requests[0]!.model).toBe('gpt-4');
  });

  test('handles concurrent model discoveries', async () => {
    const bridge = createCloudBridge({
      cloudEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
    });

    mockServer.setDelay(50);

    const promises = Array.from({ length: 10 }, () => bridge.discoverModels());
    const results = await Promise.all(promises);

    // All should succeed
    expect(results.length).toBe(10);
    expect(results.every(r => r.length === 4)).toBe(true);

    // Should use caching (sync interval), so not 10 separate requests
    // (depends on implementation, but at least should work)
    expect(mockServer.getRequestCount()).toBeGreaterThanOrEqual(1);
  });

  test('getStatus returns accurate data after sync', async () => {
    const bridge = createCloudBridge({
      cloudEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
    });

    await bridge.initialize();
    const status = await bridge.getStatus();

    expect(status.endpoint).toBe(`http://localhost:${port}`);
    expect(status.modelCount).toBe(4);
    expect(status.skillCount).toBe(0);
  });
});

// ============================================================================
// Compute Node Manager Integration Tests
// ============================================================================

describe('ComputeNodeManager Integration', () => {
  let server: BunServer;
  let port = 8751;
  let provisionedNodes: string[] = [];
  let terminatedNodes: string[] = [];
  let shouldFailProvision = false;

  beforeAll(() => {
    const app = new Hono();

    app.post('/api/v1/compute/provision', async (c) => {
      if (shouldFailProvision) {
        return c.json({ error: 'Provision failed' }, 500);
      }

      const body = await c.req.json() as { nodeId: string };
      provisionedNodes.push(body.nodeId);

      await new Promise(r => setTimeout(r, 50)); // Simulate startup time

      return c.json({
        endpoint: `http://localhost:${port}/nodes/${body.nodeId}`,
        internalEndpoint: `http://internal:${port}/nodes/${body.nodeId}`,
        providerMeta: { region: 'us-east-1' },
      });
    });

    app.post('/api/v1/compute/terminate', async (c) => {
      const body = await c.req.json() as { nodeId: string };
      terminatedNodes.push(body.nodeId);
      return c.json({ success: true });
    });

    server = serve({ port, fetch: app.fetch });
  });

  afterAll(() => {
    server.stop();
  });

  beforeEach(() => {
    provisionedNodes = [];
    terminatedNodes = [];
    shouldFailProvision = false;
  });

  test('provisions node and returns endpoint', async () => {
    const manager = createComputeNodeManager({
      provisionerEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
      defaultIdleTimeoutMs: 60000,
      maxQueueTimeMs: 30000,
      statusPollIntervalMs: 100,
    });

    manager.registerNode({
      nodeId: 'test-node',
      name: 'Test Node',
      hardwareType: 'cpu',
      teeType: 'none',
      gpuType: 'none',
      cpuCores: 4,
      memoryGb: 16,
      containerImage: 'test:latest',
      idleTimeoutMs: 60000,
      coldStartTimeMs: 5000,
      pricePerHourWei: 1000000000000000n,
      regions: ['us-east-1'],
    });

    const result = await manager.provisionNode({ nodeId: 'test-node' });

    expect(result.status).toBe('ready');
    expect(result.endpoint).toContain('/nodes/test-node');
    expect(provisionedNodes).toContain('test-node');

    await manager.shutdown();
    expect(terminatedNodes).toContain('test-node');
  });

  test('executeRequest auto-provisions cold node', async () => {
    const manager = createComputeNodeManager({
      provisionerEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
      defaultIdleTimeoutMs: 60000,
      maxQueueTimeMs: 30000,
      statusPollIntervalMs: 100,
    });

    manager.registerNode({
      nodeId: 'auto-provision',
      name: 'Auto Provision',
      hardwareType: 'cpu',
      teeType: 'none',
      gpuType: 'none',
      cpuCores: 2,
      memoryGb: 8,
      containerImage: 'test:latest',
      idleTimeoutMs: 60000,
      coldStartTimeMs: 1000,
      pricePerHourWei: 500000000000000n,
      regions: ['us-west-2'],
    });

    // Node is cold, executeRequest should trigger provisioning
    // When node is cold, queue returns { endpoint, request } after provisioning completes
    const result = await manager.executeRequest(
      'auto-provision',
      { data: 'test' },
      async (endpoint) => ({ endpoint, success: true })
    ) as { endpoint?: string; request?: unknown };

    // Queue resolves with endpoint and original request
    expect(result).toHaveProperty('endpoint');
    expect(result).toHaveProperty('request');
    expect(provisionedNodes).toContain('auto-provision');

    await manager.shutdown();
  });

  test('handles provision failure and allows retry', async () => {
    shouldFailProvision = true;

    const manager = createComputeNodeManager({
      provisionerEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
      defaultIdleTimeoutMs: 60000,
      maxQueueTimeMs: 30000,
      statusPollIntervalMs: 100,
    });

    manager.registerNode({
      nodeId: 'retry-node',
      name: 'Retry Node',
      hardwareType: 'cpu',
      teeType: 'none',
      gpuType: 'none',
      cpuCores: 2,
      memoryGb: 8,
      containerImage: 'test:latest',
      idleTimeoutMs: 60000,
      coldStartTimeMs: 1000,
      pricePerHourWei: 500000000000000n,
      regions: ['us-east-1'],
    });

    // First attempt fails
    const result1 = await manager.provisionNode({ nodeId: 'retry-node' });
    expect(result1.status).toBe('error');

    // Fix the provisioner
    shouldFailProvision = false;

    // Second attempt succeeds
    const result2 = await manager.provisionNode({ nodeId: 'retry-node' });
    expect(result2.status).toBe('ready');

    await manager.shutdown();
  });

  test('getAllNodes returns all registered nodes', async () => {
    const manager = createComputeNodeManager({
      provisionerEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
      defaultIdleTimeoutMs: 60000,
      maxQueueTimeMs: 30000,
      statusPollIntervalMs: 100,
    });

    const configs = [
      { nodeId: 'node-1', name: 'Node 1' },
      { nodeId: 'node-2', name: 'Node 2' },
      { nodeId: 'node-3', name: 'Node 3' },
    ];

    for (const cfg of configs) {
      manager.registerNode({
        ...cfg,
        hardwareType: 'cpu',
        teeType: 'none',
        gpuType: 'none',
        cpuCores: 2,
        memoryGb: 8,
        containerImage: 'test:latest',
        idleTimeoutMs: 60000,
        coldStartTimeMs: 1000,
        pricePerHourWei: 500000000000000n,
        regions: ['us-east-1'],
      });
    }

    const allNodes = manager.getAllNodes();
    expect(allNodes.length).toBe(3);

    const allMetadata = manager.getAllNodeMetadata();
    expect(allMetadata.length).toBe(3);
    expect(allMetadata.map(m => m.nodeId)).toContain('node-1');
    expect(allMetadata.map(m => m.nodeId)).toContain('node-2');
    expect(allMetadata.map(m => m.nodeId)).toContain('node-3');

    await manager.shutdown();
  });
});

// ============================================================================
// Payment Flow Integration Tests
// ============================================================================

describe('Payment Flow Integration', () => {
  let server: BunServer;
  let port = 8752;
  let receivedPayments: Array<{ header: string; parsed: ReturnType<typeof parseX402Header> }> = [];

  beforeAll(() => {
    const app = new Hono();

    app.post('/v1/inference', async (c) => {
      const paymentHeader = c.req.header('X-Payment');
      
      if (!paymentHeader) {
        return c.json({
          x402Version: 1,
          error: 'Payment required',
          accepts: [{
            scheme: 'exact',
            network: 'jeju',
            maxAmountRequired: '1000000000000000',
            asset: '0x0000000000000000000000000000000000000000',
            payTo: '0x1234567890123456789012345678901234567890',
            resource: '/v1/inference',
            description: 'AI inference',
          }],
        }, 402);
      }

      const parsed = parseX402Header(paymentHeader);
      receivedPayments.push({ header: paymentHeader, parsed });

      return c.json({
        result: 'inference complete',
        payment: { received: true, amount: parsed?.amount },
      });
    });

    server = serve({ port, fetch: app.fetch });
  });

  afterAll(() => {
    server.stop();
  });

  beforeEach(() => {
    receivedPayments = [];
  });

  test('complete payment flow: 402 -> payment -> success', async () => {
    const wallet = createWallet();
    const client = new X402Client(wallet, 'jeju');

    // First request without payment
    const response1 = await fetch(`http://localhost:${port}/v1/inference`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    });

    expect(response1.status).toBe(402);

    // Handle 402 with automatic payment
    const finalResponse = await client.handlePaymentRequired(
      response1,
      `http://localhost:${port}/v1/inference`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'test' }),
      }
    );

    expect(finalResponse.status).toBe(200);
    expect(receivedPayments.length).toBe(1);
    expect(receivedPayments[0]!.parsed?.scheme).toBe('exact');
    expect(receivedPayments[0]!.parsed?.network).toBe('jeju');
  });

  test('paidFetch includes x-jeju-address header', async () => {
    let receivedHeaders: Record<string, string> = {};
    
    const app = new Hono();
    app.post('/check-headers', async (c) => {
      receivedHeaders = {};
      c.req.raw.headers.forEach((v, k) => { receivedHeaders[k] = v; });
      return c.json({ ok: true });
    });
    
    const headerServer = serve({ port: 8753, fetch: app.fetch });

    const wallet = createWallet();
    const client = new X402Client(wallet, 'jeju');
    const providerAddress = createWallet().address as Address;

    await client.paidFetch(
      'http://localhost:8753/check-headers',
      { method: 'POST' },
      providerAddress,
      '1000000'
    );

    expect(receivedHeaders['x-payment']).toBeDefined();
    expect(receivedHeaders['x-jeju-address']).toBe(wallet.address);

    headerServer.stop();
  });
});

// ============================================================================
// Model Discovery Combined Source Tests
// ============================================================================

describe('ModelDiscovery Combined Sources', () => {
  let mockServer: ReturnType<typeof createMockCloudServer>;
  let port = 8754;

  beforeAll(() => {
    mockServer = createMockCloudServer(port);
  });

  afterAll(() => {
    mockServer.server.stop();
  });

  test('discoverAll returns cloud models when registry unavailable', async () => {
    const discovery = createModelDiscovery({
      cloudEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545', // No actual registry
    });

    await discovery.initialize();
    const results = await discovery.discoverAll();

    expect(results.cloud.length).toBe(4);
    expect(results.combined.length).toBe(4); // Same as cloud when no registry
  });

  test('getters return correct instances', async () => {
    const discovery = createModelDiscovery({
      cloudEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
    });

    expect(discovery.getCloudBridge()).toBeInstanceOf(CloudProviderBridge);
    expect(discovery.getRegistrySDK()).toBeNull(); // No registry config
    expect(discovery.getComputeManager()).toBeNull(); // No compute config
  });

  test('with compute config initializes manager', () => {
    const discovery = createModelDiscovery({
      cloudEndpoint: `http://localhost:${port}`,
      rpcUrl: 'http://localhost:9545',
      computeConfig: {
        provisionerEndpoint: 'http://localhost:9999',
        rpcUrl: 'http://localhost:9545',
        defaultIdleTimeoutMs: 60000,
        maxQueueTimeMs: 30000,
        statusPollIntervalMs: 100,
      },
    });

    expect(discovery.getComputeManager()).toBeInstanceOf(ComputeNodeManager);
  });
});

// ============================================================================
// Race Condition Tests
// ============================================================================

describe('Race Conditions', () => {
  test('concurrent provision requests to same node deduplicate', async () => {
    let provisionCount = 0;
    const app = new Hono();
    app.post('/api/v1/compute/provision', async () => {
      provisionCount++;
      await new Promise(r => setTimeout(r, 100));
      return new Response(JSON.stringify({ endpoint: 'http://test' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    app.post('/api/v1/compute/terminate', () => new Response(JSON.stringify({ success: true })));

    const server = serve({ port: 8755, fetch: app.fetch });

    const manager = createComputeNodeManager({
      provisionerEndpoint: 'http://localhost:8755',
      rpcUrl: 'http://localhost:9545',
      defaultIdleTimeoutMs: 60000,
      maxQueueTimeMs: 30000,
      statusPollIntervalMs: 100,
    });

    manager.registerNode({
      nodeId: 'race-test',
      name: 'Race Test',
      hardwareType: 'cpu',
      teeType: 'none',
      gpuType: 'none',
      cpuCores: 2,
      memoryGb: 8,
      containerImage: 'test:latest',
      idleTimeoutMs: 60000,
      coldStartTimeMs: 1000,
      pricePerHourWei: 500000000000000n,
      regions: ['us-east-1'],
    });

    // Fire 10 concurrent provision requests
    const promises = Array.from({ length: 10 }, () =>
      manager.provisionNode({ nodeId: 'race-test' })
    );

    const results = await Promise.all(promises);

    expect(results.every(r => r.status === 'ready')).toBe(true);
    expect(provisionCount).toBe(1); // Only one actual provision call

    await manager.shutdown();
    server.stop();
  });

  test('concurrent payments don\'t interfere', async () => {
    const wallets = Array.from({ length: 5 }, () => createWallet());
    const providerAddress = createWallet().address as Address;

    const paymentPromises = wallets.map(async (wallet, i) => {
      const client = new X402Client(wallet, 'jeju');
      const payment = await client.generatePayment(providerAddress, `${1000 + i * 100}`);
      const parsed = parseX402Header(payment);
      return { wallet: wallet.address, payment, parsed };
    });

    const results = await Promise.all(paymentPromises);

    // Each should have unique payment
    const payments = results.map(r => r.payment);
    expect(new Set(payments).size).toBe(5);

    // Each should verify correctly
    for (const result of results) {
      const { verifyX402Payment } = await import('../sdk/x402');
      const isValid = verifyX402Payment(result.parsed!, providerAddress, result.wallet as Address);
      expect(isValid).toBe(true);
    }
  });
});

// ============================================================================
// Timeout and Retry Behavior
// ============================================================================

describe('Timeout and Retry Behavior', () => {
  test('cloud bridge handles slow endpoint', async () => {
    const app = new Hono();
    app.get('/api/v1/models', async () => {
      await new Promise(r => setTimeout(r, 200));
      return new Response(JSON.stringify({ models: [{ id: 'slow', name: 'Slow', provider: 'test', modelType: 'llm' }] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const server = serve({ port: 8756, fetch: app.fetch });

    const bridge = createCloudBridge({
      cloudEndpoint: 'http://localhost:8756',
      rpcUrl: 'http://localhost:9545',
      syncIntervalMs: 100,
    });

    // Should complete despite delay
    await bridge.initialize();
    const results = await bridge.discoverModels();

    expect(results.length).toBe(1);
    expect(results[0]!.model.name).toBe('Slow');

    server.stop();
  });

  test('compute manager respects queue timeout', async () => {
    const app = new Hono();
    app.post('/api/v1/compute/provision', async () => {
      await new Promise(r => setTimeout(r, 5000)); // Very long delay
      return new Response(JSON.stringify({ endpoint: 'http://test' }));
    });
    app.post('/api/v1/compute/terminate', () => new Response(JSON.stringify({ success: true })));

    const server = serve({ port: 8757, fetch: app.fetch });

    const manager = createComputeNodeManager({
      provisionerEndpoint: 'http://localhost:8757',
      rpcUrl: 'http://localhost:9545',
      defaultIdleTimeoutMs: 60000,
      maxQueueTimeMs: 100, // Very short timeout
      statusPollIntervalMs: 50,
    });

    manager.registerNode({
      nodeId: 'timeout-test',
      name: 'Timeout Test',
      hardwareType: 'cpu',
      teeType: 'none',
      gpuType: 'none',
      cpuCores: 2,
      memoryGb: 8,
      containerImage: 'test:latest',
      idleTimeoutMs: 60000,
      coldStartTimeMs: 1000,
      pricePerHourWei: 500000000000000n,
      regions: ['us-east-1'],
    });

    // Should timeout quickly
    await expect(
      manager.executeRequest('timeout-test', {}, async () => ({}))
    ).rejects.toThrow(/timeout/i);

    await manager.shutdown();
    server.stop();
  });
});
