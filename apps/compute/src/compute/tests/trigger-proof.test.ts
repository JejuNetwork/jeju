import { describe, test, expect, beforeEach, beforeAll, afterAll } from 'bun:test';
import { Wallet } from 'ethers';
import { serve } from 'bun';
import {
  TriggerIntegration,
  createTriggerIntegration,
  generateProofMessage,
  signTriggerProof,
  verifyTriggerProof,
  hashTriggerData,
  type TriggerProofMessage,
  type TriggerProof,
  type HttpTarget,
} from '../sdk/trigger-integration';
import type { Address } from 'viem';

type BunServer = ReturnType<typeof serve>;

describe('Trigger Proof System', () => {
  const testWallet = Wallet.createRandom() as unknown as Wallet;

  describe('generateProofMessage', () => {
    test('generates consistent hash for same input', () => {
      const proof: TriggerProofMessage = {
        triggerId: 'trigger-1',
        executionId: 'exec-1',
        timestamp: 1700000000000,
        nonce: 'abc123',
        inputHash: '0x' + '1'.repeat(64),
        outputHash: '0x' + '2'.repeat(64),
        subscriberAddress: '0x1234567890123456789012345678901234567890' as Address,
        chainId: 1,
      };

      const hash1 = generateProofMessage(proof);
      const hash2 = generateProofMessage(proof);

      expect(hash1).toBe(hash2);
      expect(hash1.startsWith('0x')).toBe(true);
    });

    test('generates different hash for different input', () => {
      const proof1: TriggerProofMessage = {
        triggerId: 'trigger-1',
        executionId: 'exec-1',
        timestamp: 1700000000000,
        nonce: 'abc123',
        inputHash: '0x' + '1'.repeat(64),
        outputHash: '0x' + '2'.repeat(64),
        subscriberAddress: '0x1234567890123456789012345678901234567890' as Address,
        chainId: 1,
      };

      const proof2: TriggerProofMessage = {
        ...proof1,
        executionId: 'exec-2',
      };

      const hash1 = generateProofMessage(proof1);
      const hash2 = generateProofMessage(proof2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('signTriggerProof', () => {
    test('signs proof message', async () => {
      const proof: TriggerProofMessage = {
        triggerId: 'trigger-1',
        executionId: 'exec-1',
        timestamp: Date.now(),
        nonce: 'test-nonce',
        inputHash: hashTriggerData({ foo: 'bar' }),
        outputHash: hashTriggerData({ result: 'success' }),
        subscriberAddress: '0x1234567890123456789012345678901234567890' as Address,
        chainId: 1,
      };

      const signature = await signTriggerProof(testWallet, proof);

      expect(signature).toBeDefined();
      expect(signature.startsWith('0x')).toBe(true);
      expect(signature.length).toBeGreaterThan(100);
    });
  });

  describe('verifyTriggerProof', () => {
    test('verifies valid proof', async () => {
      const proofMessage: TriggerProofMessage = {
        triggerId: 'trigger-1',
        executionId: 'exec-1',
        timestamp: Date.now(),
        nonce: 'verify-test',
        inputHash: hashTriggerData({ input: 'data' }),
        outputHash: hashTriggerData({ output: 'data' }),
        subscriberAddress: '0x1234567890123456789012345678901234567890' as Address,
        chainId: 1,
      };

      const signature = await signTriggerProof(testWallet, proofMessage);

      const proof: TriggerProof = {
        ...proofMessage,
        executorAddress: testWallet.address as Address,
        executorSignature: signature,
      };

      const isValid = verifyTriggerProof(proof, testWallet.address as Address);
      expect(isValid).toBe(true);
    });

    test('rejects invalid signature', () => {
      const proof: TriggerProof = {
        triggerId: 'trigger-1',
        executionId: 'exec-1',
        timestamp: Date.now(),
        nonce: 'invalid-test',
        inputHash: hashTriggerData({}),
        outputHash: hashTriggerData({}),
        subscriberAddress: '0x1234567890123456789012345678901234567890' as Address,
        executorAddress: testWallet.address as Address,
        executorSignature: '0x' + '1'.repeat(130),
        chainId: 1,
      };

      let isValid = true;
      try {
        isValid = verifyTriggerProof(proof, testWallet.address as Address);
      } catch {
        isValid = false;
      }
      expect(isValid).toBe(false);
    });
  });

  describe('hashTriggerData', () => {
    test('hashes object consistently', () => {
      const data = { foo: 'bar', num: 42 };
      const hash1 = hashTriggerData(data);
      const hash2 = hashTriggerData(data);

      expect(hash1).toBe(hash2);
      expect(hash1.startsWith('0x')).toBe(true);
    });

    test('different data produces different hash', () => {
      const hash1 = hashTriggerData({ a: 1 });
      const hash2 = hashTriggerData({ a: 2 });

      expect(hash1).not.toBe(hash2);
    });
  });
});

describe('TriggerIntegration Subscriptions', () => {
  let integration: TriggerIntegration;

  beforeEach(() => {
    integration = createTriggerIntegration({
      rpcUrl: 'http://localhost:9545',
      enableOnChainRegistration: false,
      chainId: 1,
    });
  });

  test('registers trigger', async () => {
    const target: HttpTarget = {
      type: 'http',
      endpoint: 'https://example.com/callback',
      method: 'POST',
      timeout: 30,
    };

    const triggerId = await integration.registerTrigger({
      name: 'test-trigger',
      type: 'cron',
      source: 'local',
      target,
      cronExpression: '* * * * *',
      active: true,
    });

    expect(triggerId).toBeDefined();
    expect(triggerId.startsWith('local-')).toBe(true);
  });

  test('subscribes to trigger', async () => {
    const target: HttpTarget = {
      type: 'http',
      endpoint: 'https://example.com',
      method: 'POST',
      timeout: 30,
    };

    const triggerId = await integration.registerTrigger({
      name: 'sub-test',
      type: 'webhook',
      source: 'local',
      target,
      active: true,
    });

    const subscription = await integration.subscribe({
      triggerId,
      subscriberAddress: '0x1234567890123456789012345678901234567890' as Address,
      callbackEndpoint: 'https://my-app.com/webhook',
      payment: {
        mode: 'free',
        pricePerExecution: 0n,
      },
    });

    expect(subscription.id).toBeDefined();
    expect(subscription.triggerId).toBe(triggerId);
    expect(subscription.active).toBe(true);
  });

  test('unsubscribes from trigger', async () => {
    const target: HttpTarget = {
      type: 'http',
      endpoint: 'https://example.com',
      method: 'POST',
      timeout: 30,
    };

    const triggerId = await integration.registerTrigger({
      name: 'unsub-test',
      type: 'cron',
      source: 'local',
      target,
      cronExpression: '0 * * * *',
      active: true,
    });

    const subscription = await integration.subscribe({
      triggerId,
      subscriberAddress: '0x1234567890123456789012345678901234567890' as Address,
      callbackEndpoint: 'https://my-app.com/webhook',
      payment: { mode: 'free', pricePerExecution: 0n },
    });

    await integration.unsubscribe(subscription.id);

    const subs = integration.getSubscriptions(triggerId);
    expect(subs.length).toBe(0);
  });

  test('gets subscriptions for trigger', async () => {
    const target: HttpTarget = {
      type: 'http',
      endpoint: 'https://example.com',
      method: 'POST',
      timeout: 30,
    };

    const triggerId = await integration.registerTrigger({
      name: 'multi-sub',
      type: 'webhook',
      source: 'local',
      target,
      active: true,
    });

    await integration.subscribe({
      triggerId,
      subscriberAddress: '0x1111111111111111111111111111111111111111' as Address,
      callbackEndpoint: 'https://app1.com/webhook',
      payment: { mode: 'free', pricePerExecution: 0n },
    });

    await integration.subscribe({
      triggerId,
      subscriberAddress: '0x2222222222222222222222222222222222222222' as Address,
      callbackEndpoint: 'https://app2.com/webhook',
      payment: { mode: 'free', pricePerExecution: 0n },
    });

    const subs = integration.getSubscriptions(triggerId);
    expect(subs.length).toBe(2);
  });
});

describe('Trigger Execution', () => {
  let integration: TriggerIntegration;
  let mockServer: BunServer;
  const port = 19999;

  beforeAll(() => {
    mockServer = serve({
      port,
      fetch: () => new Response(JSON.stringify({ success: true, data: 'test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
  });

  afterAll(() => {
    mockServer.stop();
  });

  beforeEach(() => {
    integration = createTriggerIntegration({
      rpcUrl: 'http://localhost:9545',
      enableOnChainRegistration: false,
      chainId: 1,
    });
  });

  test('executes trigger and returns result', async () => {
    const target: HttpTarget = {
      type: 'http',
      endpoint: `http://localhost:${port}/post`,
      method: 'POST',
      timeout: 30,
    };

    const triggerId = await integration.registerTrigger({
      name: 'exec-test',
      type: 'webhook',
      source: 'local',
      target,
      active: true,
    });

    const result = await integration.executeTrigger({
      triggerId,
      input: { test: 'data' },
    });

    expect(result.status).toBe('success');
    expect(result.executionId).toBeDefined();
  });

  test('throws for inactive trigger', async () => {
    const target: HttpTarget = {
      type: 'http',
      endpoint: `http://localhost:${port}`,
      method: 'POST',
      timeout: 30,
    };

    const triggerId = await integration.registerTrigger({
      name: 'inactive-test',
      type: 'webhook',
      source: 'local',
      target,
      active: false,
    });

    await expect(
      integration.executeTrigger({ triggerId })
    ).rejects.toThrow('not active');
  });
});
