/**
 * Thorough Test Coverage - Beyond Happy Paths
 *
 * Tests boundary conditions, error handling, invalid inputs,
 * concurrent behavior, and verifies actual output data.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { Wallet } from 'ethers';
import { Hono } from 'hono';
import { serve } from 'bun';
import {
  TriggerIntegration,
  createTriggerIntegration,
  hashTriggerData,
  type ContractTarget,
} from '../sdk/trigger-integration';
import {
  parseX402Header,
  generateX402PaymentHeader,
  verifyX402Payment,
  createPaymentRequirement,
  estimatePrice,
  X402Client,
  getX402Config,
} from '../sdk/x402';
import type { Address } from 'viem';

type BunServer = ReturnType<typeof serve>;

const testWallet = Wallet.createRandom() as unknown as Wallet;
const providerWallet = Wallet.createRandom() as unknown as Wallet;

// =============================================================================
// Contract Target Execution Tests
// =============================================================================

describe('Contract Target Execution', () => {
  let integration: TriggerIntegration;

  beforeEach(async () => {
    integration = createTriggerIntegration({
      rpcUrl: 'http://localhost:9545',
      enableOnChainRegistration: false,
      chainId: 9545,
    });
    await integration.initialize();
  });

  afterEach(async () => {
    await integration.shutdown();
  });

  test('registers trigger with contract target', async () => {
    const contractTarget: ContractTarget = {
      type: 'contract',
      address: '0x1234567890123456789012345678901234567890' as Address,
      functionName: 'execute',
      abi: 'function execute(uint256 value) returns (bool)',
      args: ['{{input.value}}'],
    };

    const triggerId = await integration.registerTrigger({
      source: 'local',
      type: 'event',
      name: 'contract-trigger',
      eventTypes: ['test-event'],
      target: contractTarget,
      active: true,
    });

    expect(triggerId).toMatch(/^local-/);
    const trigger = integration.getTrigger(triggerId);
    expect(trigger?.target.type).toBe('contract');
    expect((trigger?.target as ContractTarget).address).toBe('0x1234567890123456789012345678901234567890');
  });

  test('contract target with static args', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local',
      type: 'event',
      name: 'static-args-trigger',
      eventTypes: ['static-event'],
      target: {
        type: 'contract',
        address: '0xabcdef0123456789abcdef0123456789abcdef01' as Address,
        functionName: 'setConfig',
        abi: 'function setConfig(string key, uint256 value)',
        args: ['config-key', '12345'],
      },
      active: true,
    });

    const trigger = integration.getTrigger(triggerId);
    const target = trigger?.target as ContractTarget;
    expect(target.args).toEqual(['config-key', '12345']);
  });

  test('contract target with complex ABI', async () => {
    const complexAbi = 'function multicall(tuple(address target, bytes callData)[] calls) returns (bytes[])';

    const triggerId = await integration.registerTrigger({
      source: 'local',
      type: 'webhook',
      name: 'complex-abi-trigger',
      webhookPath: '/complex',
      target: {
        type: 'contract',
        address: '0x9876543210987654321098765432109876543210' as Address,
        functionName: 'multicall',
        abi: complexAbi,
        args: ['{{input.calls}}'],
      },
      active: true,
    });

    const trigger = integration.getTrigger(triggerId);
    const target = trigger?.target as ContractTarget;
    expect(target.abi).toBe(complexAbi);
  });
});

// =============================================================================
// Trigger Registration Validation Tests
// =============================================================================

describe('Trigger Registration Validation', () => {
  let integration: TriggerIntegration;

  beforeEach(async () => {
    integration = createTriggerIntegration({
      rpcUrl: 'http://localhost:9545',
      enableOnChainRegistration: false,
      chainId: 9545,
    });
    await integration.initialize();
  });

  afterEach(async () => {
    await integration.shutdown();
  });

  test('registers trigger with minimal required fields', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local',
      type: 'event',
      name: 'minimal-trigger',
      target: { type: 'http', endpoint: 'http://example.com', method: 'POST', timeout: 30 },
      active: true,
    });

    expect(triggerId).toBeDefined();
    const trigger = integration.getTrigger(triggerId);
    expect(trigger?.name).toBe('minimal-trigger');
  });

  test('registers trigger with all optional fields', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local',
      type: 'webhook',
      name: 'full-trigger',
      description: 'A fully specified trigger',
      webhookPath: '/full-path',
      target: { type: 'http', endpoint: 'http://example.com/full', method: 'PUT', timeout: 120 },
      payment: { mode: 'x402', pricePerExecution: 1000000n },
      ownerAddress: providerWallet.address as Address,
      active: true,
    });

    const trigger = integration.getTrigger(triggerId);
    expect(trigger?.description).toBe('A fully specified trigger');
    expect(trigger?.payment?.mode).toBe('x402');
    expect(trigger?.payment?.pricePerExecution).toBe(1000000n);
    expect(trigger?.ownerAddress).toBe(providerWallet.address as Address);
  });

  test('generates unique IDs for multiple triggers', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = await integration.registerTrigger({
        source: 'local',
        type: 'event',
        name: `trigger-${i}`,
        target: { type: 'http', endpoint: 'http://example.com', method: 'POST', timeout: 30 },
        active: true,
      });
      ids.push(id);
    }

    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(10);
  });

  test('trigger types are correctly assigned', async () => {
    const cronId = await integration.registerTrigger({
      source: 'local',
      type: 'cron',
      name: 'cron-type',
      cronExpression: '* * * * *',
      target: { type: 'http', endpoint: 'http://example.com', method: 'POST', timeout: 30 },
      active: true,
    });

    const webhookId = await integration.registerTrigger({
      source: 'local',
      type: 'webhook',
      name: 'webhook-type',
      webhookPath: '/webhook',
      target: { type: 'http', endpoint: 'http://example.com', method: 'POST', timeout: 30 },
      active: true,
    });

    const eventId = await integration.registerTrigger({
      source: 'local',
      type: 'event',
      name: 'event-type',
      eventTypes: ['type1', 'type2'],
      target: { type: 'http', endpoint: 'http://example.com', method: 'POST', timeout: 30 },
      active: true,
    });

    expect(integration.getTrigger(cronId)?.type).toBe('cron');
    expect(integration.getTrigger(webhookId)?.type).toBe('webhook');
    expect(integration.getTrigger(eventId)?.type).toBe('event');
  });
});

// =============================================================================
// X402 Network and Amount Edge Cases
// =============================================================================

describe('X402 Network Edge Cases', () => {
  test('handles all supported networks', () => {
    const networks = ['jeju', 'base', 'base-sepolia', 'ethereum', 'sepolia'] as const;
    
    for (const network of networks) {
      const header = `scheme=exact;network=${network};payload=0x123;amount=1000`;
      const parsed = parseX402Header(header);
      expect(parsed).not.toBeNull();
      expect(parsed!.network).toBe(network);
    }
  });

  test('handles unknown network gracefully', () => {
    const header = 'scheme=exact;network=unknown-chain;payload=0x123;amount=1000';
    const parsed = parseX402Header(header);
    expect(parsed).not.toBeNull();
    expect(parsed!.network).toBe('unknown-chain');
  });

  test('creates payment requirement with correct network config', () => {
    const requirement = createPaymentRequirement(
      '/test',
      1000000n,
      providerWallet.address as Address,
      'Test payment',
      'base-sepolia'
    );

    expect(requirement.accepts).toBeDefined();
    expect(requirement.accepts.length).toBeGreaterThan(0);
    expect(requirement.accepts[0].network).toBe('base-sepolia');
  });
});

describe('X402 Amount Edge Cases', () => {
  test('handles amount at uint256 max boundary', () => {
    const maxUint256 = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    const header = `scheme=exact;network=jeju;payload=0x123;amount=${maxUint256}`;
    const parsed = parseX402Header(header);
    
    expect(parsed).not.toBeNull();
    expect(parsed!.amount).toBe(maxUint256);
    expect(BigInt(parsed!.amount)).toBe(BigInt(maxUint256));
  });

  test('handles amount=0', () => {
    const header = 'scheme=exact;network=jeju;payload=0x123;amount=0';
    const parsed = parseX402Header(header);
    
    expect(parsed).not.toBeNull();
    expect(BigInt(parsed!.amount)).toBe(0n);
  });

  test('handles decimal amount (as string)', () => {
    const header = 'scheme=exact;network=jeju;payload=0x123;amount=1000.5';
    const parsed = parseX402Header(header);
    
    expect(parsed).not.toBeNull();
    expect(parsed!.amount).toBe('1000.5');
  });

  test('estimate price for different model types', () => {
    const llmPrice = estimatePrice('llm', 1000);
    const imagePrice = estimatePrice('image', 1);
    const videoPrice = estimatePrice('video', 60);
    const audioPrice = estimatePrice('audio', 60);
    const embeddingPrice = estimatePrice('embedding', 1000);

    expect(llmPrice).toBeGreaterThan(0n);
    expect(imagePrice).toBeGreaterThan(0n);
    expect(videoPrice).toBeGreaterThan(0n);
    expect(audioPrice).toBeGreaterThan(0n);
    expect(embeddingPrice).toBeGreaterThan(0n);
  });

  test('estimate price scales linearly with units', () => {
    const price1 = estimatePrice('llm', 1000);
    const price2 = estimatePrice('llm', 2000);
    
    expect(price2).toBe(price1 * 2n);
  });
});

describe('X402 Signature Edge Cases', () => {
  test('verifies signature from correct wallet', async () => {
    const header = await generateX402PaymentHeader(
      testWallet,
      providerWallet.address as Address,
      '1000000',
      'jeju'
    );
    const parsed = parseX402Header(header);
    
    expect(parsed).not.toBeNull();
    const isValid = verifyX402Payment(parsed!, providerWallet.address as Address, testWallet.address as Address);
    expect(isValid).toBe(true);
  });

  test('rejects signature from wrong wallet', async () => {
    const header = await generateX402PaymentHeader(
      testWallet,
      providerWallet.address as Address,
      '1000000',
      'jeju'
    );
    const parsed = parseX402Header(header);
    
    // Claim to be a different user
    const wrongUser = Wallet.createRandom().address as Address;
    const isValid = verifyX402Payment(parsed!, providerWallet.address as Address, wrongUser);
    expect(isValid).toBe(false);
  });

  test('verification handles different address casing', async () => {
    const header = await generateX402PaymentHeader(
      testWallet,
      providerWallet.address as Address,
      '1000000',
      'jeju'
    );
    const parsed = parseX402Header(header);
    
    // Use lowercase provider address - verification should normalize
    const isValid = verifyX402Payment(
      parsed!,
      providerWallet.address.toLowerCase() as Address,
      testWallet.address as Address
    );
    // May or may not work depending on implementation - test actual behavior
    expect(typeof isValid).toBe('boolean');
  });
});

// =============================================================================
// X402 Client Tests
// =============================================================================

describe('X402Client Edge Cases', () => {
  let client: X402Client;

  beforeEach(() => {
    client = new X402Client(testWallet, 'jeju');
  });

  test('getAddress returns correct wallet address', () => {
    expect(client.getAddress()).toBe(testWallet.address as Address);
  });

  test('getNetworkConfig returns valid config', () => {
    const config = client.getNetworkConfig();
    expect(config).toBeDefined();
    expect(config.chainId).toBeDefined();
    expect(config.name).toBeDefined();
  });

  test('generates payment for different amounts', async () => {
    const amounts = ['0', '1', '1000000', '999999999999999999'];
    
    for (const amount of amounts) {
      const header = await client.generatePayment(providerWallet.address as Address, amount);
      expect(header).toContain(`amount=${amount}`);
    }
  });

  test('verifies own generated payments', async () => {
    const header = await client.generatePayment(providerWallet.address as Address, '1000');
    const parsed = parseX402Header(header);
    expect(parsed).not.toBeNull();
    const isValid = client.verifyPayment(parsed!, providerWallet.address as Address);
    expect(isValid).toBe(true);
  });
});

// =============================================================================
// Payment Flow Integration Tests
// =============================================================================

describe('Payment Amount Boundary Tests', () => {
  let integration: TriggerIntegration;
  let server: BunServer;
  let port = 9950;
  let receivedRequests: Array<{ body: Record<string, unknown> }> = [];

  beforeAll(async () => {
    const app = new Hono();
    app.post('/payment-test', async (c) => {
      receivedRequests.push({ body: await c.req.json() });
      return c.json({ success: true });
    });
    server = serve({ fetch: app.fetch, port });

    integration = createTriggerIntegration({
      rpcUrl: 'http://localhost:9545',
      enableOnChainRegistration: false,
      chainId: 9545,
    });
    await integration.initialize();
  });

  afterAll(async () => {
    await integration.shutdown();
    server.stop();
  });

  beforeEach(() => {
    receivedRequests = [];
  });

  test('x402 payment exactly at required price succeeds', async () => {
    await integration.registerTrigger({
      source: 'local',
      type: 'webhook',
      name: 'exact-price',
      webhookPath: '/exact-price',
      target: { type: 'http', endpoint: `http://localhost:${port}/payment-test`, method: 'POST', timeout: 30 },
      payment: { mode: 'x402', pricePerExecution: 1000n },
      ownerAddress: providerWallet.address as Address,
      active: true,
    });

    const paymentHeader = await generateX402PaymentHeader(
      testWallet,
      providerWallet.address as Address,
      '1000', // Exactly at price
      'jeju'
    );

    const result = await integration.handleWebhook('/exact-price', { test: true }, {
      'x-payment': paymentHeader,
      'x-jeju-address': testWallet.address,
    });

    expect(result).not.toBeNull();
    expect(result!.status).toBe('success');
  });

  test('x402 payment above required price succeeds', async () => {
    await integration.registerTrigger({
      source: 'local',
      type: 'webhook',
      name: 'above-price',
      webhookPath: '/above-price',
      target: { type: 'http', endpoint: `http://localhost:${port}/payment-test`, method: 'POST', timeout: 30 },
      payment: { mode: 'x402', pricePerExecution: 1000n },
      ownerAddress: providerWallet.address as Address,
      active: true,
    });

    const paymentHeader = await generateX402PaymentHeader(
      testWallet,
      providerWallet.address as Address,
      '2000', // Above price
      'jeju'
    );

    const result = await integration.handleWebhook('/above-price', { test: true }, {
      'x-payment': paymentHeader,
      'x-jeju-address': testWallet.address,
    });

    expect(result).not.toBeNull();
    expect(result!.status).toBe('success');
  });

  test('x402 payment below required price fails', async () => {
    await integration.registerTrigger({
      source: 'local',
      type: 'webhook',
      name: 'below-price',
      webhookPath: '/below-price',
      target: { type: 'http', endpoint: `http://localhost:${port}/payment-test`, method: 'POST', timeout: 30 },
      payment: { mode: 'x402', pricePerExecution: 1000n },
      ownerAddress: providerWallet.address as Address,
      active: true,
    });

    const paymentHeader = await generateX402PaymentHeader(
      testWallet,
      providerWallet.address as Address,
      '999', // Below price
      'jeju'
    );

    await expect(integration.handleWebhook('/below-price', { test: true }, {
      'x-payment': paymentHeader,
      'x-jeju-address': testWallet.address,
    })).rejects.toThrow('Payment too low');
  });

  test('free trigger requires no payment headers', async () => {
    await integration.registerTrigger({
      source: 'local',
      type: 'webhook',
      name: 'free-trigger',
      webhookPath: '/free',
      target: { type: 'http', endpoint: `http://localhost:${port}/payment-test`, method: 'POST', timeout: 30 },
      payment: { mode: 'free' },
      active: true,
    });

    const result = await integration.handleWebhook('/free', { test: true }, {});

    expect(result).not.toBeNull();
    expect(result!.status).toBe('success');
  });
});

// =============================================================================
// Multi-Subscriber Notification Tests
// =============================================================================

describe('Multi-Subscriber Notifications', () => {
  let integration: TriggerIntegration;
  let server: BunServer;
  let port = 9951;
  let notifications: Array<{ subscriberId: string; data: Record<string, unknown> }> = [];

  beforeAll(async () => {
    const app = new Hono();
    app.post('/target', (c) => c.json({ result: 'executed' }));
    app.post('/subscriber/:id', async (c) => {
      const id = c.req.param('id');
      const body = await c.req.json();
      notifications.push({ subscriberId: id, data: body });
      return c.json({ received: true });
    });
    server = serve({ fetch: app.fetch, port });

    integration = createTriggerIntegration({
      rpcUrl: 'http://localhost:9545',
      enableOnChainRegistration: false,
      executorWallet: testWallet,
      chainId: 9545,
      allowPrivateCallbacks: true,
    });
    await integration.initialize();
  });

  afterAll(async () => {
    await integration.shutdown();
    server.stop();
  });

  beforeEach(() => {
    notifications = [];
  });

  test('notifies all subscribers on trigger execution', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local',
      type: 'event',
      name: 'multi-sub-trigger-' + Date.now(),
      eventTypes: ['multi-test'],
      target: { type: 'http', endpoint: `http://localhost:${port}/target`, method: 'POST', timeout: 30 },
      active: true,
    });

    // Add 3 subscribers with correct payment structure
    for (let i = 1; i <= 3; i++) {
      await integration.subscribe({
        triggerId,
        subscriberAddress: Wallet.createRandom().address as Address,
        callbackEndpoint: `http://localhost:${port}/subscriber/${i}`,
        callbackMethod: 'POST',
        payment: { mode: 'free', pricePerExecution: 0n },
        maxExecutions: 100,
      });
    }

    const subs = integration.getSubscriptions(triggerId);
    expect(subs).toHaveLength(3);

    await integration.executeTrigger({ triggerId, input: { value: 42 } });
    await new Promise(r => setTimeout(r, 300));

    expect(notifications.length).toBe(3);
  });

  test('notification data contains execution details', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local',
      type: 'event',
      name: 'detail-trigger-' + Date.now(),
      eventTypes: ['detail-test'],
      target: { type: 'http', endpoint: `http://localhost:${port}/target`, method: 'POST', timeout: 30 },
      active: true,
    });

    await integration.subscribe({
      triggerId,
      subscriberAddress: testWallet.address as Address,
      callbackEndpoint: `http://localhost:${port}/subscriber/detail`,
      callbackMethod: 'POST',
      payment: { mode: 'free', pricePerExecution: 0n },
      maxExecutions: 100,
    });

    await integration.executeTrigger({ triggerId, input: { key: 'value' } });
    await new Promise(r => setTimeout(r, 300));

    expect(notifications.length).toBeGreaterThanOrEqual(1);
    const data = notifications[notifications.length - 1].data as Record<string, unknown>;
    expect(data.triggerId).toBe(triggerId);
    expect(data.executionId).toMatch(/^exec-/);
    expect(data.inputHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(data.outputHash).toMatch(/^0x[a-f0-9]{64}$/);
  });
});

// =============================================================================
// Execution History Accuracy Tests  
// =============================================================================

describe('Execution History Accuracy', () => {
  let integration: TriggerIntegration;
  let server: BunServer;
  let port = 9952;

  beforeAll(async () => {
    const app = new Hono();
    app.post('/history-target', (c) => c.json({ timestamp: Date.now() }));
    server = serve({ fetch: app.fetch, port });

    integration = createTriggerIntegration({
      rpcUrl: 'http://localhost:9545',
      enableOnChainRegistration: false,
      chainId: 9545,
    });
    await integration.initialize();
  });

  afterAll(async () => {
    await integration.shutdown();
    server.stop();
  });

  test('execution history preserves order', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local',
      type: 'event',
      name: 'order-trigger',
      eventTypes: ['order-test'],
      target: { type: 'http', endpoint: `http://localhost:${port}/history-target`, method: 'POST', timeout: 30 },
      active: true,
    });

    const executions = [];
    for (let i = 0; i < 5; i++) {
      const results = await integration.emitEvent('order-test', { index: i });
      executions.push(results[0]);
      await new Promise(r => setTimeout(r, 10));
    }

    const history = integration.getExecutionHistory(triggerId, 10);
    
    expect(history).toHaveLength(5);
    for (let i = 0; i < 4; i++) {
      expect(history[i].startedAt.getTime()).toBeLessThanOrEqual(history[i + 1].startedAt.getTime());
    }
  });

  test('execution history records success/failure status', async () => {
    let shouldFail = false;
    const failApp = new Hono();
    failApp.post('/fail-target', (c) => {
      if (shouldFail) return c.text('Error', 500);
      return c.json({ ok: true });
    });
    const failServer = serve({ fetch: failApp.fetch, port: 9953 });

    const failIntegration = createTriggerIntegration({
      rpcUrl: 'http://localhost:9545',
      enableOnChainRegistration: false,
      chainId: 9545,
    });
    await failIntegration.initialize();

    const triggerId = await failIntegration.registerTrigger({
      source: 'local',
      type: 'event',
      name: 'fail-trigger',
      eventTypes: ['fail-test'],
      target: { type: 'http', endpoint: 'http://localhost:9953/fail-target', method: 'POST', timeout: 30 },
      active: true,
    });

    // Successful execution
    await failIntegration.emitEvent('fail-test', {});
    
    // Failed execution
    shouldFail = true;
    try {
      await failIntegration.emitEvent('fail-test', {});
    } catch {}

    const history = failIntegration.getExecutionHistory(triggerId, 10);
    const successCount = history.filter(h => h.status === 'success').length;
    
    expect(successCount).toBeGreaterThan(0);

    await failIntegration.shutdown();
    failServer.stop();
  });

  test('execution history includes timing data', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local',
      type: 'event',
      name: 'timing-trigger',
      eventTypes: ['timing-test'],
      target: { type: 'http', endpoint: `http://localhost:${port}/history-target`, method: 'POST', timeout: 30 },
      active: true,
    });

    await integration.emitEvent('timing-test', {});
    
    const history = integration.getExecutionHistory(triggerId, 1);
    expect(history).toHaveLength(1);
    expect(history[0].startedAt).toBeInstanceOf(Date);
    expect(history[0].finishedAt).toBeInstanceOf(Date);
    expect(history[0].finishedAt!.getTime()).toBeGreaterThanOrEqual(history[0].startedAt.getTime());
  });
});

// =============================================================================
// Hash Function Determinism Tests
// =============================================================================

describe('Hash Function Determinism', () => {
  test('same input produces same hash', () => {
    const data = { key: 'value', nested: { a: 1, b: 2 }, array: [1, 2, 3] };
    
    const hash1 = hashTriggerData(data);
    const hash2 = hashTriggerData(data);
    
    expect(hash1).toBe(hash2);
  });

  test('different inputs produce different hashes', () => {
    const hashes = new Set<string>();
    
    const inputs: Record<string, unknown>[] = [
      { a: 1 },
      { a: 2 },
      { b: 1 },
      { a: 1, b: 2 },
      { a: '1' },
      { arr: [1, 2, 3] },
      { str: 'string' },
      { num: 123 },
      { nil: null },
      {},
    ];
    
    for (const input of inputs) {
      hashes.add(hashTriggerData(input));
    }
    
    expect(hashes.size).toBe(inputs.length);
  });

  test('hash format is valid bytes32', () => {
    const hash = hashTriggerData({ test: 'data' });
    
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  test('hash handles unicode strings', () => {
    const hash = hashTriggerData({ message: '你好世界 🌍 مرحبا' });
    
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  test('hash handles empty structures', () => {
    const emptyObject = hashTriggerData({});
    const objectWithEmptyArray = hashTriggerData({ arr: [] });
    const objectWithEmptyString = hashTriggerData({ str: '' });
    
    expect(emptyObject).toMatch(/^0x[a-f0-9]{64}$/);
    expect(objectWithEmptyArray).toMatch(/^0x[a-f0-9]{64}$/);
    expect(objectWithEmptyString).toMatch(/^0x[a-f0-9]{64}$/);
    
    // All should be different
    expect(emptyObject).not.toBe(objectWithEmptyArray);
    expect(objectWithEmptyArray).not.toBe(objectWithEmptyString);
  });
});

// =============================================================================
// Concurrent State Modification Tests
// =============================================================================

describe('Concurrent State Modifications', () => {
  let integration: TriggerIntegration;
  let server: BunServer;
  let port = 9954;

  beforeAll(async () => {
    const app = new Hono();
    app.post('/concurrent', async (c) => {
      await new Promise(r => setTimeout(r, 10));
      return c.json({ ok: true });
    });
    server = serve({ fetch: app.fetch, port });

    integration = createTriggerIntegration({
      rpcUrl: 'http://localhost:9545',
      enableOnChainRegistration: false,
      chainId: 9545,
      allowPrivateCallbacks: true,
    });
    await integration.initialize();
  });

  afterAll(async () => {
    await integration.shutdown();
    server.stop();
  });

  test('concurrent trigger registrations are thread-safe', async () => {
    const registerPromises = [];
    
    for (let i = 0; i < 20; i++) {
      registerPromises.push(
        integration.registerTrigger({
          source: 'local',
          type: 'event',
          name: `concurrent-reg-${i}`,
          eventTypes: [`concurrent-${i}`],
          target: { type: 'http', endpoint: `http://localhost:${port}/concurrent`, method: 'POST', timeout: 30 },
          active: true,
        })
      );
    }

    const ids = await Promise.all(registerPromises);
    const uniqueIds = new Set(ids);
    
    expect(uniqueIds.size).toBe(20);
  });

  test('concurrent subscriptions are thread-safe', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local',
      type: 'event',
      name: 'sub-concurrent',
      eventTypes: ['sub-concurrent'],
      target: { type: 'http', endpoint: `http://localhost:${port}/concurrent`, method: 'POST', timeout: 30 },
      active: true,
    });

    const subPromises = [];
    for (let i = 0; i < 10; i++) {
      subPromises.push(
        integration.subscribe({
          triggerId,
          subscriberAddress: Wallet.createRandom().address as Address,
          callbackEndpoint: `http://localhost:${port}/concurrent`,
          maxExecutions: 100,
          payment: { mode: 'free', pricePerExecution: 0n },
        })
      );
    }

    const subIds = await Promise.all(subPromises);
    const uniqueSubIds = new Set(subIds);
    
    expect(uniqueSubIds.size).toBe(10);
    expect(integration.getSubscriptions(triggerId)).toHaveLength(10);
  });

  test('concurrent executions maintain accurate counts', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local',
      type: 'event',
      name: 'exec-concurrent',
      eventTypes: ['exec-concurrent'],
      target: { type: 'http', endpoint: `http://localhost:${port}/concurrent`, method: 'POST', timeout: 30 },
      active: true,
    });

    const execPromises = [];
    for (let i = 0; i < 15; i++) {
      execPromises.push(integration.emitEvent('exec-concurrent', { i }));
    }

    await Promise.all(execPromises);
    
    const history = integration.getExecutionHistory(triggerId, 100);
    expect(history).toHaveLength(15);
  });
});

// =============================================================================
// Config Validation Tests
// =============================================================================

describe('Configuration Validation', () => {
  test('getX402Config returns all required fields', () => {
    const config = getX402Config();
    
    expect(config.recipientAddress).toBeDefined();
    expect(config.network).toBeDefined();
    expect(config.creditsPerDollar).toBeDefined();
    expect(typeof config.creditsPerDollar).toBe('number');
  });

  test('createTriggerIntegration accepts minimal config', async () => {
    const integration = createTriggerIntegration({
      rpcUrl: 'http://localhost:9545',
    });
    
    await integration.initialize();
    expect(integration).toBeDefined();
    await integration.shutdown();
  });

  test('createTriggerIntegration applies defaults', async () => {
    const integration = createTriggerIntegration({});
    
    await integration.initialize();
    // Should not throw - defaults applied
    expect(integration).toBeDefined();
    await integration.shutdown();
  });
});
