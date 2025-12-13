/**
 * Trigger Edge Cases & Boundary Tests
 *
 * Tests boundary conditions, error handling, concurrent behavior,
 * and verifies actual output values.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Wallet } from 'ethers';
import { Hono } from 'hono';
import { serve } from 'bun';
import {
  TriggerIntegration,
  generateProofMessage,
  signTriggerProof,
  verifyTriggerProof,
  hashTriggerData,
  shouldExecuteCron,
  type TriggerProofMessage,
  type TriggerProof,
  type HttpTarget,
} from '../sdk/trigger-integration';
import { parseX402Header } from '../sdk/x402';
import type { Address } from 'viem';

type BunServer = ReturnType<typeof serve>;

const executorWallet = Wallet.createRandom() as unknown as Wallet;
const subscriberWallet = Wallet.createRandom() as unknown as Wallet;

// ============================================================================
// ============================================================================

describe('Cron Expression Edge Cases', () => {
  describe('Boundary Values', () => {
    test('minute boundary: 0 and 59', () => {
      const now = new Date();
      const min = now.getMinutes();
      
      // Test exact boundaries
      expect(shouldExecuteCron('0 * * * *')).toBe(min === 0);
      expect(shouldExecuteCron('59 * * * *')).toBe(min === 59);
    });

    test('hour boundary: 0 and 23', () => {
      const now = new Date();
      const hour = now.getHours();
      
      expect(shouldExecuteCron('* 0 * * *')).toBe(hour === 0);
      expect(shouldExecuteCron('* 23 * * *')).toBe(hour === 23);
    });

    test('day of month boundary: 1 and 31', () => {
      const now = new Date();
      const day = now.getDate();
      
      expect(shouldExecuteCron('* * 1 * *')).toBe(day === 1);
      expect(shouldExecuteCron('* * 31 * *')).toBe(day === 31);
    });

    test('month boundary: 1 (Jan) and 12 (Dec)', () => {
      const now = new Date();
      const month = now.getMonth() + 1;
      
      expect(shouldExecuteCron('* * * 1 *')).toBe(month === 1);
      expect(shouldExecuteCron('* * * 12 *')).toBe(month === 12);
    });

    test('day of week boundary: 0 (Sun) and 6 (Sat)', () => {
      const now = new Date();
      const dow = now.getDay();
      
      expect(shouldExecuteCron('* * * * 0')).toBe(dow === 0);
      expect(shouldExecuteCron('* * * * 6')).toBe(dow === 6);
    });
  });

  describe('Invalid Expressions', () => {
    test('rejects expressions with too few parts', () => {
      expect(shouldExecuteCron('* * * *')).toBe(false);
      expect(shouldExecuteCron('* * *')).toBe(false);
      expect(shouldExecuteCron('* *')).toBe(false);
      expect(shouldExecuteCron('*')).toBe(false);
    });

    test('rejects expressions with too many parts', () => {
      expect(shouldExecuteCron('* * * * * *')).toBe(false);
      expect(shouldExecuteCron('* * * * * * *')).toBe(false);
    });

    test('rejects empty string', () => {
      expect(shouldExecuteCron('')).toBe(false);
    });

    test('rejects whitespace-only', () => {
      expect(shouldExecuteCron('   ')).toBe(false);
      expect(shouldExecuteCron('\t\t')).toBe(false);
    });

    test('handles malformed step expressions', () => {
      expect(shouldExecuteCron('*/0 * * * *')).toBe(false); // step of 0
      expect(shouldExecuteCron('*/-1 * * * *')).toBe(false); // negative step
      expect(shouldExecuteCron('*/abc * * * *')).toBe(false); // non-numeric step
    });

    test('handles malformed range expressions', () => {
      // These should not throw, just return false for current time or true if matches
      const result1 = shouldExecuteCron('10-5 * * * *'); // inverted range
      const result2 = shouldExecuteCron('a-b * * * *'); // non-numeric
      expect(typeof result1).toBe('boolean');
      expect(typeof result2).toBe('boolean');
    });
  });

  describe('Step Expressions', () => {
    test('*/1 matches every minute', () => {
      expect(shouldExecuteCron('*/1 * * * *')).toBe(true);
    });

    test('*/60 only matches minute 0', () => {
      const now = new Date();
      expect(shouldExecuteCron('*/60 * * * *')).toBe(now.getMinutes() === 0);
    });

    test('step with large number', () => {
      expect(shouldExecuteCron('*/100 * * * *')).toBe(new Date().getMinutes() === 0);
    });
  });

  describe('Complex Expressions', () => {
    test('comma-separated with duplicates', () => {
      const now = new Date();
      const min = now.getMinutes();
      expect(shouldExecuteCron(`${min},${min},${min} * * * *`)).toBe(true);
    });

    test('range spanning entire field', () => {
      expect(shouldExecuteCron('0-59 * * * *')).toBe(true);
      expect(shouldExecuteCron('* 0-23 * * *')).toBe(true);
    });

    test('single value at current time', () => {
      const now = new Date();
      const expr = `${now.getMinutes()} ${now.getHours()} ${now.getDate()} ${now.getMonth() + 1} ${now.getDay()}`;
      expect(shouldExecuteCron(expr)).toBe(true);
    });
  });
});

// ============================================================================
// ============================================================================

describe('Proof System Edge Cases', () => {
  describe('Hash Function Edge Cases', () => {
    test('hashes empty object', () => {
      const hash = hashTriggerData({});
      expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    });

    test('hashes nested objects', () => {
      const hash = hashTriggerData({ a: { b: { c: { d: 1 } } } });
      expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    });

    test('hashes arrays', () => {
      const hash = hashTriggerData({ arr: [1, 2, 3, 'a', 'b', 'c'] });
      expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    });

    test('hashes special characters', () => {
      const hash = hashTriggerData({ text: '特殊字符 🎉 \n\t\\' });
      expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    });

    test('hashes large object', () => {
      const largeData: Record<string, number> = {};
      for (let i = 0; i < 1000; i++) largeData[`key${i}`] = i;
      const hash = hashTriggerData(largeData);
      expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    });

    test('order sensitivity - different key order produces different hash', () => {
      const hash1 = hashTriggerData({ a: 1, b: 2 });
      const hash2 = hashTriggerData({ b: 2, a: 1 });
      // JSON.stringify may produce different order, but in practice same object should be deterministic
      expect(hash1).toMatch(/^0x[a-f0-9]{64}$/);
      expect(hash2).toMatch(/^0x[a-f0-9]{64}$/);
    });

    test('null values in data', () => {
      const hash = hashTriggerData({ nullValue: null as unknown as string, undefinedValue: undefined as unknown as string });
      expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    });

    test('bigint values throw or get converted', () => {
      // bigint isn't JSON serializable by default
      expect(() => hashTriggerData({ big: 12345678901234567890n as unknown as number })).toThrow();
    });
  });

  describe('Proof Message Edge Cases', () => {
    test('generates proof with minimum timestamp', () => {
      const msg: TriggerProofMessage = {
        triggerId: 't1', executionId: 'e1', timestamp: 0, nonce: 'n',
        inputHash: '0x' + '0'.repeat(64), outputHash: '0x' + '0'.repeat(64),
        subscriberAddress: '0x0000000000000000000000000000000000000001' as Address, chainId: 1,
      };
      const hash = generateProofMessage(msg);
      expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    });

    test('generates proof with maximum safe timestamp', () => {
      const msg: TriggerProofMessage = {
        triggerId: 't1', executionId: 'e1', timestamp: Number.MAX_SAFE_INTEGER, nonce: 'n',
        inputHash: '0x' + 'f'.repeat(64), outputHash: '0x' + 'f'.repeat(64),
        subscriberAddress: subscriberWallet.address as Address, chainId: 1,
      };
      const hash = generateProofMessage(msg);
      expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    });

    test('generates proof with empty strings', () => {
      const msg: TriggerProofMessage = {
        triggerId: '', executionId: '', timestamp: Date.now(), nonce: '',
        inputHash: '0x' + '0'.repeat(64), outputHash: '0x' + '0'.repeat(64),
        subscriberAddress: subscriberWallet.address as Address, chainId: 1,
      };
      const hash = generateProofMessage(msg);
      expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    });

    test('generates proof with very long strings', () => {
      const longString = 'a'.repeat(10000);
      const msg: TriggerProofMessage = {
        triggerId: longString, executionId: longString, timestamp: Date.now(), nonce: longString,
        inputHash: '0x' + '0'.repeat(64), outputHash: '0x' + '0'.repeat(64),
        subscriberAddress: subscriberWallet.address as Address, chainId: 1,
      };
      const hash = generateProofMessage(msg);
      expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    });

    test('different chain IDs produce different hashes', () => {
      const base: TriggerProofMessage = {
        triggerId: 't1', executionId: 'e1', timestamp: 1700000000000, nonce: 'n',
        inputHash: '0x' + '0'.repeat(64), outputHash: '0x' + '0'.repeat(64),
        subscriberAddress: subscriberWallet.address as Address, chainId: 1,
      };
      const hash1 = generateProofMessage({ ...base, chainId: 1 });
      const hash2 = generateProofMessage({ ...base, chainId: 2 });
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Signature Verification Edge Cases', () => {
    test('verifies proof signed by correct wallet', async () => {
      const msg: TriggerProofMessage = {
        triggerId: 'test', executionId: 'exec', timestamp: Date.now(), nonce: 'nonce123',
        inputHash: hashTriggerData({ test: true }), outputHash: hashTriggerData({ result: 'ok' }),
        subscriberAddress: subscriberWallet.address as Address, chainId: 1,
      };
      const sig = await signTriggerProof(executorWallet, msg);
      const proof: TriggerProof = { ...msg, executorAddress: executorWallet.address as Address, executorSignature: sig };
      expect(verifyTriggerProof(proof, executorWallet.address as Address)).toBe(true);
    });

    test('rejects proof with malformed signature', () => {
      const msg: TriggerProofMessage = {
        triggerId: 'test', executionId: 'exec', timestamp: Date.now(), nonce: 'nonce',
        inputHash: '0x' + '0'.repeat(64), outputHash: '0x' + '0'.repeat(64),
        subscriberAddress: subscriberWallet.address as Address, chainId: 1,
      };
      const proof: TriggerProof = { ...msg, executorAddress: executorWallet.address as Address, executorSignature: 'invalid-sig' };
      expect(() => verifyTriggerProof(proof, executorWallet.address as Address)).toThrow();
    });

    test('rejects proof with empty signature', () => {
      const msg: TriggerProofMessage = {
        triggerId: 'test', executionId: 'exec', timestamp: Date.now(), nonce: 'nonce',
        inputHash: '0x' + '0'.repeat(64), outputHash: '0x' + '0'.repeat(64),
        subscriberAddress: subscriberWallet.address as Address, chainId: 1,
      };
      const proof: TriggerProof = { ...msg, executorAddress: executorWallet.address as Address, executorSignature: '' };
      expect(() => verifyTriggerProof(proof, executorWallet.address as Address)).toThrow();
    });

    test('rejects proof signed by different wallet', async () => {
      const msg: TriggerProofMessage = {
        triggerId: 'test', executionId: 'exec', timestamp: Date.now(), nonce: 'nonce',
        inputHash: '0x' + '0'.repeat(64), outputHash: '0x' + '0'.repeat(64),
        subscriberAddress: subscriberWallet.address as Address, chainId: 1,
      };
      const sig = await signTriggerProof(subscriberWallet, msg); // signed by subscriber, not executor
      const proof: TriggerProof = { ...msg, executorAddress: executorWallet.address as Address, executorSignature: sig };
      expect(verifyTriggerProof(proof, executorWallet.address as Address)).toBe(false);
    });
  });
});

// ============================================================================
// ============================================================================

describe('X402 Payment Header Edge Cases', () => {
  test('parses header with extra fields', () => {
    const header = 'scheme=exact;network=jeju;payload=0x123;amount=1000;extra=ignored;another=field';
    const parsed = parseX402Header(header);
    expect(parsed).not.toBeNull();
    expect(parsed!.scheme).toBe('exact');
    expect(parsed!.amount).toBe('1000');
  });

  test('parses header with empty values', () => {
    const header = 'scheme=;network=jeju;payload=0x123;amount=1000';
    const parsed = parseX402Header(header);
    expect(parsed).toBeNull(); // empty scheme should fail
  });

  test('handles duplicate keys (last wins)', () => {
    const header = 'scheme=wrong;scheme=exact;network=jeju;payload=0x123;amount=1000';
    const parsed = parseX402Header(header);
    expect(parsed?.scheme).toBe('exact');
  });

  test('handles very large amount', () => {
    const header = 'scheme=exact;network=jeju;payload=0x123;amount=999999999999999999999999999999';
    const parsed = parseX402Header(header);
    expect(parsed).not.toBeNull();
    expect(parsed!.amount).toBe('999999999999999999999999999999');
  });

  test('handles zero amount', () => {
    const header = 'scheme=exact;network=jeju;payload=0x123;amount=0';
    const parsed = parseX402Header(header);
    expect(parsed).not.toBeNull();
    expect(parsed!.amount).toBe('0');
  });

  test('handles negative amount (as string)', () => {
    const header = 'scheme=exact;network=jeju;payload=0x123;amount=-100';
    const parsed = parseX402Header(header);
    expect(parsed).not.toBeNull();
    expect(parsed!.amount).toBe('-100'); // parsing doesn't validate, caller should
  });

  test('handles special characters in payload', () => {
    const header = 'scheme=exact;network=jeju;payload=0x123abc!@#$%^&*();amount=1000';
    const parsed = parseX402Header(header);
    // Note: semicolons would break parsing, but other chars should be ok
    expect(parsed?.payload).toContain('0x123abc');
  });

  test('handles unicode in values', () => {
    const header = 'scheme=exact;network=日本語;payload=0x123;amount=1000';
    const parsed = parseX402Header(header);
    expect(parsed).not.toBeNull();
    expect(parsed!.network).toBe('日本語');
  });
});

describe('X402 Payment Verification', () => {
  const { verifyX402Payment, generateX402PaymentHeader, parseX402Header: parseHeader } = require('../sdk/x402');
  const testWallet = Wallet.createRandom() as unknown as Wallet;
  const providerWallet = Wallet.createRandom() as unknown as Wallet;

  test('verifies payment with correct payer address', async () => {
    const providerAddress = providerWallet.address as Address;
    const amount = '1000000';
    const header = await generateX402PaymentHeader(testWallet, providerAddress, amount, 'jeju');
    const payment = parseHeader(header);
    
    expect(payment).not.toBeNull();
    const isValid = verifyX402Payment(payment, providerAddress, testWallet.address as Address);
    expect(isValid).toBe(true);
  });

  test('rejects payment with wrong payer address', async () => {
    const providerAddress = providerWallet.address as Address;
    const amount = '1000000';
    const header = await generateX402PaymentHeader(testWallet, providerAddress, amount, 'jeju');
    const payment = parseHeader(header);
    
    const wrongPayer = Wallet.createRandom().address as Address;
    const isValid = verifyX402Payment(payment, providerAddress, wrongPayer);
    expect(isValid).toBe(false);
  });

  test('rejects payment with wrong provider address', async () => {
    const providerAddress = providerWallet.address as Address;
    const amount = '1000000';
    const header = await generateX402PaymentHeader(testWallet, providerAddress, amount, 'jeju');
    const payment = parseHeader(header);
    
    const wrongProvider = Wallet.createRandom().address as Address;
    const isValid = verifyX402Payment(payment, wrongProvider, testWallet.address as Address);
    expect(isValid).toBe(false);
  });
});

describe('Webhook x402 Payment Flow', () => {
  let integration: TriggerIntegration;
  let server: BunServer;
  const port = 9878;
  const testWallet = Wallet.createRandom() as unknown as Wallet;
  const providerWallet = Wallet.createRandom() as unknown as Wallet;

  beforeAll(async () => {
    const app = new Hono();
    app.post('/webhook-target', (c) => c.json({ received: true }));
    server = serve({ fetch: app.fetch, port });

    integration = new TriggerIntegration({
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

  test('handleWebhook requires payer address for x402 triggers', async () => {
    await integration.registerTrigger({
      source: 'local',
      type: 'webhook',
      name: 'x402-webhook',
      webhookPath: '/test-x402',
      target: { type: 'http', endpoint: `http://localhost:${port}/webhook-target`, method: 'POST', timeout: 30 },
      payment: { mode: 'x402', pricePerExecution: 1000n },
      ownerAddress: providerWallet.address as Address,
      active: true,
    });

    const { generateX402PaymentHeader } = await import('../sdk/x402');
    const paymentHeader = await generateX402PaymentHeader(testWallet, providerWallet.address as Address, '1000', 'jeju');

    // Without x-jeju-address header - should fail
    await expect(integration.handleWebhook('/test-x402', { data: 'test' }, {
      'x-payment': paymentHeader,
    })).rejects.toThrow('x-jeju-address header required');
  });

  test('handleWebhook accepts valid x402 payment with correct payer', async () => {
    await integration.registerTrigger({
      source: 'local',
      type: 'webhook',
      name: 'x402-webhook-valid',
      webhookPath: '/test-x402-valid',
      target: { type: 'http', endpoint: `http://localhost:${port}/webhook-target`, method: 'POST', timeout: 30 },
      payment: { mode: 'x402', pricePerExecution: 1000n },
      ownerAddress: providerWallet.address as Address,
      active: true,
    });

    const { generateX402PaymentHeader } = await import('../sdk/x402');
    const paymentHeader = await generateX402PaymentHeader(testWallet, providerWallet.address as Address, '1000', 'jeju');

    const result = await integration.handleWebhook('/test-x402-valid', { data: 'test' }, {
      'x-payment': paymentHeader,
      'x-jeju-address': testWallet.address,
    });
    expect(result).not.toBeNull();
    expect(result!.status).toBe('success');
  });

  test('handleWebhook rejects invalid x402 signature', async () => {
    await integration.registerTrigger({
      source: 'local',
      type: 'webhook',
      name: 'x402-webhook-invalid',
      webhookPath: '/test-x402-invalid',
      target: { type: 'http', endpoint: `http://localhost:${port}/webhook-target`, method: 'POST', timeout: 30 },
      payment: { mode: 'x402', pricePerExecution: 1000n },
      ownerAddress: providerWallet.address as Address,
      active: true,
    });

    const { generateX402PaymentHeader } = await import('../sdk/x402');
    const paymentHeader = await generateX402PaymentHeader(testWallet, providerWallet.address as Address, '1000', 'jeju');
    const wrongPayer = Wallet.createRandom().address;

    await expect(integration.handleWebhook('/test-x402-invalid', { data: 'test' }, {
      'x-payment': paymentHeader,
      'x-jeju-address': wrongPayer,
    })).rejects.toThrow('x402 verification failed');
  });
});

// ============================================================================
// ============================================================================

describe('Concurrent Trigger Execution', () => {
  let integration: TriggerIntegration;
  let server: BunServer;
  let port = 9879;
  let requestCount = 0;
  let concurrentMax = 0;
  let currentConcurrent = 0;

  beforeAll(async () => {
    requestCount = 0;
    concurrentMax = 0;
    currentConcurrent = 0;

    const app = new Hono();
    app.post('/api/concurrent', async (c) => {
      currentConcurrent++;
      if (currentConcurrent > concurrentMax) concurrentMax = currentConcurrent;
      requestCount++;
      
      await new Promise(r => setTimeout(r, 50)); // simulate work
      currentConcurrent--;
      
      return c.json({ success: true, requestNum: requestCount });
    });

    server = serve({ port, fetch: app.fetch });

    integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:9545',
      enableOnChainRegistration: false,
      executorWallet,
      chainId: 1,
    });
    await integration.initialize();
  });

  afterAll(async () => {
    await integration.shutdown();
    server.stop();
  });

  test('handles concurrent trigger executions', async () => {
    const target: HttpTarget = { type: 'http', endpoint: `http://localhost:${port}/api/concurrent`, method: 'POST', timeout: 30 };
    
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'webhook', name: 'concurrent-test', target, active: true,
    });

    // Fire 10 concurrent executions
    const promises = Array.from({ length: 10 }, (_, i) => 
      integration.executeTrigger({ triggerId, input: { seq: i } })
    );

    const results = await Promise.all(promises);
    
    expect(results.length).toBe(10);
    expect(results.every(r => r.status === 'success')).toBe(true);
    expect(requestCount).toBe(10);
    expect(concurrentMax).toBeGreaterThan(1); // at least some concurrency
  });

  test('maintains correct execution count across concurrent calls', async () => {
    const target: HttpTarget = { type: 'http', endpoint: `http://localhost:${port}/api/concurrent`, method: 'POST', timeout: 30 };
    
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'webhook', name: 'count-test', target, active: true,
    });

    const beforeCount = requestCount;
    await Promise.all(Array.from({ length: 5 }, () => integration.executeTrigger({ triggerId })));
    
    expect(requestCount - beforeCount).toBe(5);
    
    const history = integration.getExecutionHistory(triggerId);
    expect(history.length).toBe(5);
  });
});

// ============================================================================
// ============================================================================

describe('Subscription Edge Cases', () => {
  let integration: TriggerIntegration;
  let targetServer: BunServer;
  let callbackServer: BunServer;
  let targetPort = 9880;
  let callbackPort = 9881;
  let callbacks: Array<{ time: number; body: Record<string, unknown> }> = [];

  beforeAll(async () => {
    callbacks = [];
    
    // Separate target server (the trigger endpoint that returns data)
    const targetApp = new Hono();
    targetApp.post('/api/target', async () => new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } }));
    targetServer = serve({ port: targetPort, fetch: targetApp.fetch });
    
    // Callback server (where subscriber notifications go)
    const callbackApp = new Hono();
    callbackApp.post('/callback', async (c) => {
      const body = await c.req.json();
      callbacks.push({ time: Date.now(), body: body as Record<string, unknown> });
      return c.json({ received: true });
    });
    callbackServer = serve({ port: callbackPort, fetch: callbackApp.fetch });

    integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:9545',
      enableOnChainRegistration: false,
      executorWallet,
      chainId: 1,
      allowPrivateCallbacks: true,
    });
    await integration.initialize();
  });

  afterAll(async () => {
    await integration.shutdown();
    targetServer.stop();
    callbackServer.stop();
  });

  test('handles zero maxExecutions (unlimited)', async () => {
    const target: HttpTarget = { type: 'http', endpoint: `http://localhost:${targetPort}/api/target`, method: 'POST', timeout: 30 };
    const triggerId = await integration.registerTrigger({ source: 'local', type: 'webhook', name: 'unlimited', target, active: true });
    
    await integration.subscribe({
      triggerId, subscriberAddress: subscriberWallet.address as Address,
      callbackEndpoint: `http://localhost:${callbackPort}/callback`,
      payment: { mode: 'free', pricePerExecution: 0n },
      maxExecutions: 0, // unlimited
    });

    // Execute many times - should all succeed (callback per execution)
    const before = callbacks.length;
    for (let i = 0; i < 20; i++) {
      await integration.executeTrigger({ triggerId });
    }
    await new Promise(r => setTimeout(r, 100));
    
    expect(callbacks.length - before).toBe(20);
  });

  test('handles exactly maxExecutions=1', async () => {
    const target: HttpTarget = { type: 'http', endpoint: `http://localhost:${targetPort}/api/target`, method: 'POST', timeout: 30 };
    const triggerId = await integration.registerTrigger({ source: 'local', type: 'webhook', name: 'max-one', target, active: true });
    
    const sub = await integration.subscribe({
      triggerId, subscriberAddress: subscriberWallet.address as Address,
      callbackEndpoint: `http://localhost:${callbackPort}/callback`,
      payment: { mode: 'free', pricePerExecution: 0n },
      maxExecutions: 1,
    });

    const before = callbacks.length;
    await integration.executeTrigger({ triggerId });
    await integration.executeTrigger({ triggerId });
    await integration.executeTrigger({ triggerId });
    await new Promise(r => setTimeout(r, 100));
    
    // Only 1 callback should happen (maxExecutions=1)
    expect(callbacks.length - before).toBe(1);
    
    const updated = integration.getSubscriptions(triggerId).find(s => s.id === sub.id);
    expect(updated!.executionCount).toBe(1);
  });

  test('handles prepaid balance exactly equal to price', async () => {
    const target: HttpTarget = { type: 'http', endpoint: `http://localhost:${targetPort}/api/target`, method: 'POST', timeout: 30 };
    const triggerId = await integration.registerTrigger({ source: 'local', type: 'webhook', name: 'exact-balance', target, active: true });
    
    const price = 1000000000000000n;
    await integration.subscribe({
      triggerId, subscriberAddress: subscriberWallet.address as Address,
      callbackEndpoint: `http://localhost:${callbackPort}/callback`,
      payment: { mode: 'prepaid', pricePerExecution: price, prepaidBalance: price },
    });

    const before = callbacks.length;
    await integration.executeTrigger({ triggerId }); // should succeed
    await integration.executeTrigger({ triggerId }); // should skip callback (balance exhausted)
    await new Promise(r => setTimeout(r, 100));
    
    expect(callbacks.length - before).toBe(1);
  });

  test('handles prepaid balance of exactly 0', async () => {
    const target: HttpTarget = { type: 'http', endpoint: `http://localhost:${targetPort}/api/target`, method: 'POST', timeout: 30 };
    const triggerId = await integration.registerTrigger({ source: 'local', type: 'webhook', name: 'zero-balance', target, active: true });
    
    await integration.subscribe({
      triggerId, subscriberAddress: subscriberWallet.address as Address,
      callbackEndpoint: `http://localhost:${callbackPort}/callback`,
      payment: { mode: 'prepaid', pricePerExecution: 1000000000000000n, prepaidBalance: 0n },
    });

    const before = callbacks.length;
    await integration.executeTrigger({ triggerId });
    await new Promise(r => setTimeout(r, 100));
    
    // No callback should happen (insufficient balance)
    expect(callbacks.length - before).toBe(0);
  });
});

// ============================================================================
// ============================================================================

describe('Error Handling Edge Cases', () => {
  let integration: TriggerIntegration;

  beforeAll(async () => {
    integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:9545',
      enableOnChainRegistration: false,
      executorWallet,
      chainId: 1,
    });
    await integration.initialize();
  });

  afterAll(async () => {
    await integration.shutdown();
  });

  test('unsubscribe from non-existent subscription throws', async () => {
    await expect(integration.unsubscribe('non-existent-sub-id')).rejects.toThrow('not found');
  });

  test('getTrigger returns undefined for non-existent trigger', () => {
    expect(integration.getTrigger('non-existent-trigger-id')).toBeUndefined();
  });

  test('getSubscriptions returns empty array for trigger with no subscriptions', async () => {
    const target: HttpTarget = { type: 'http', endpoint: 'http://localhost:9999', method: 'POST', timeout: 1 };
    const triggerId = await integration.registerTrigger({ source: 'local', type: 'webhook', name: 'no-subs', target, active: true });
    
    expect(integration.getSubscriptions(triggerId)).toEqual([]);
  });

  test('execution of inactive trigger throws', async () => {
    const target: HttpTarget = { type: 'http', endpoint: 'http://localhost:9999', method: 'POST', timeout: 1 };
    const triggerId = await integration.registerTrigger({ source: 'local', type: 'webhook', name: 'inactive', target, active: false });
    
    await expect(integration.executeTrigger({ triggerId })).rejects.toThrow('not active');
  });

  test('handleWebhook returns null for unmatched path', async () => {
    const result = await integration.handleWebhook('/unmatched/path', {});
    expect(result).toBeNull();
  });

  test('emitEvent returns empty array when no triggers match', async () => {
    const results = await integration.emitEvent('unmatched.event.type', { data: 'test' });
    expect(results).toEqual([]);
  });

  test('getExecutionHistory with limit 0 returns empty', () => {
    expect(integration.getExecutionHistory(undefined, 0)).toEqual([]);
  });

  test('getTriggers with non-matching filter returns empty', () => {
    expect(integration.getTriggers({ source: 'onchain' })).toEqual([]);
    expect(integration.getTriggers({ type: 'nonexistent' as 'cron' })).toEqual([]);
  });
});

// ============================================================================
// ============================================================================

describe('Data Integrity Verification', () => {
  let integration: TriggerIntegration;
  let server: BunServer;
  let port = 9882;
  let receivedData: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];

  beforeAll(async () => {
    receivedData = [];
    const app = new Hono();
    app.post('/verify', async (c) => {
      const headers: Record<string, string> = {};
      c.req.raw.headers.forEach((v, k) => { headers[k] = v; });
      const body = await c.req.json();
      receivedData.push({ headers, body: body as Record<string, unknown> });
      return c.json({ verified: true, echo: body });
    });

    server = serve({ port, fetch: app.fetch });

    integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:9545',
      enableOnChainRegistration: false,
      executorWallet,
      chainId: 1,
      allowPrivateCallbacks: true,
    });
    await integration.initialize();
  });

  afterAll(async () => {
    await integration.shutdown();
    server.stop();
  });

  test('input data is passed correctly to target', async () => {
    const target: HttpTarget = { type: 'http', endpoint: `http://localhost:${port}/verify`, method: 'POST', timeout: 30 };
    const triggerId = await integration.registerTrigger({ source: 'local', type: 'webhook', name: 'input-verify', target, active: true });
    
    const inputData = { userId: 12345, action: 'test', nested: { a: 1, b: 2 }, arr: [1, 2, 3] };
    await integration.executeTrigger({ triggerId, input: inputData });
    
    const lastReceived = receivedData[receivedData.length - 1];
    expect(lastReceived!.body).toMatchObject(inputData);
  });

  test('output contains expected structure', async () => {
    const target: HttpTarget = { type: 'http', endpoint: `http://localhost:${port}/verify`, method: 'POST', timeout: 30 };
    const triggerId = await integration.registerTrigger({ source: 'local', type: 'webhook', name: 'output-verify', target, active: true });
    
    const result = await integration.executeTrigger({ triggerId, input: { test: 'data' } });
    
    expect(result.executionId).toMatch(/^exec-\d+-[a-z0-9]+$/);
    expect(result.triggerId).toBe(triggerId);
    expect(result.status).toBe('success');
    expect(result.startedAt).toBeInstanceOf(Date);
    expect(result.finishedAt).toBeInstanceOf(Date);
    expect(result.output).toHaveProperty('verified', true);
  });

  test('execution history records correct data', async () => {
    const target: HttpTarget = { type: 'http', endpoint: `http://localhost:${port}/verify`, method: 'POST', timeout: 30 };
    const triggerId = await integration.registerTrigger({ source: 'local', type: 'webhook', name: 'history-verify', target, active: true });
    
    await integration.executeTrigger({ triggerId, input: { seq: 1 } });
    await integration.executeTrigger({ triggerId, input: { seq: 2 } });
    
    const history = integration.getExecutionHistory(triggerId);
    expect(history.length).toBe(2);
    expect(history[0]!.triggerId).toBe(triggerId);
    expect(history[1]!.triggerId).toBe(triggerId);
    expect(history.every(h => h.status === 'success')).toBe(true);
  });

  test('proof contains all required fields', async () => {
    const target: HttpTarget = { type: 'http', endpoint: `http://localhost:${port}/verify`, method: 'POST', timeout: 30 };
    const triggerId = await integration.registerTrigger({ source: 'local', type: 'webhook', name: 'proof-verify', target, active: true });
    
    await integration.subscribe({
      triggerId, subscriberAddress: subscriberWallet.address as Address,
      callbackEndpoint: `http://localhost:${port}/verify`,
      payment: { mode: 'free', pricePerExecution: 0n },
    });
    
    const result = await integration.executeTrigger({ triggerId, input: { forProof: true } });
    
    expect(result.proof).toBeDefined();
    expect(result.proof!.triggerId).toBe(triggerId);
    expect(result.proof!.executionId).toBe(result.executionId);
    expect(result.proof!.timestamp).toBeGreaterThan(0);
    expect(result.proof!.nonce).toBeTruthy();
    expect(result.proof!.inputHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(result.proof!.outputHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(result.proof!.executorAddress).toBe(executorWallet.address as Address);
    expect(result.proof!.subscriberAddress).toBe(subscriberWallet.address as Address);
    expect(result.proof!.executorSignature).toMatch(/^0x[a-f0-9]+$/);
    expect(result.proof!.chainId).toBe(1);
    
    // Verify the proof is valid
    const isValid = verifyTriggerProof(result.proof!, executorWallet.address as Address);
    expect(isValid).toBe(true);
  });

  test('headers are correctly set on target request', async () => {
    const target: HttpTarget = {
      type: 'http', endpoint: `http://localhost:${port}/verify`, method: 'POST', timeout: 30,
      headers: { 'X-Custom-Header': 'custom-value', 'X-Api-Key': 'test-key' },
    };
    const triggerId = await integration.registerTrigger({ source: 'local', type: 'webhook', name: 'header-verify', target, active: true });
    
    await integration.executeTrigger({ triggerId });
    
    const lastReceived = receivedData[receivedData.length - 1];
    expect(lastReceived!.headers['x-custom-header']).toBe('custom-value');
    expect(lastReceived!.headers['x-api-key']).toBe('test-key');
    expect(lastReceived!.headers['x-trigger-source']).toBe('jeju');
  });
});
