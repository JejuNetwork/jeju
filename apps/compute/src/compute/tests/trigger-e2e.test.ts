/**
 * Trigger E2E Tests
 *
 * End-to-end tests for the trigger system with:
 * - Real HTTP callback server
 * - Full proof-of-trigger flow
 * - Subscription lifecycle testing
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Wallet } from 'ethers';
import { Hono } from 'hono';
import { serve } from 'bun';
import {
  TriggerIntegration,
  createTriggerIntegration,
  verifyTriggerProof,
  hashTriggerData,
  type HttpTarget,
} from '../sdk/trigger-integration';
import type { Address } from 'viem';

type BunServer = ReturnType<typeof serve>;

// Test wallets
const executorWallet = Wallet.createRandom() as unknown as Wallet;
const subscriberWallet = Wallet.createRandom() as unknown as Wallet;

// Track callback invocations
interface CallbackRecord {
  timestamp: number;
  triggerId: string;
  executionId: string;
  nonce: string;
  inputHash: string;
  outputHash: string;
  proofMessage: string;
}

let callbackRecords: CallbackRecord[] = [];
let callbackServer: BunServer | null = null;
let callbackPort = 9876;

let targetServer: BunServer | null = null;
let targetPort = 9877;
let targetInvocations: Array<{ timestamp: number; body: unknown }> = [];

describe('Trigger E2E Tests', () => {
  let integration: TriggerIntegration;

  beforeAll(async () => {
    callbackRecords = [];
    targetInvocations = [];

    // Create callback server (subscriber's endpoint)
    const callbackApp = new Hono();
    
    callbackApp.post('/trigger-callback', async (c) => {
      const body = await c.req.json() as CallbackRecord;
      callbackRecords.push({ ...body, timestamp: Date.now() });
      
      const ackSig = await subscriberWallet.signMessage(body.executionId);
      c.header('X-Acknowledgment-Signature', ackSig);
      
      return c.json({ received: true, executionId: body.executionId });
    });

    callbackServer = serve({
      port: callbackPort,
      fetch: callbackApp.fetch,
    });

    // Create target server
    const targetApp = new Hono();
    
    targetApp.post('/api/trigger', async (c) => {
      const body = await c.req.json();
      targetInvocations.push({ timestamp: Date.now(), body });
      return c.json({ success: true, result: 'triggered', timestamp: Date.now() });
    });

    targetServer = serve({
      port: targetPort,
      fetch: targetApp.fetch,
    });

    // Initialize trigger integration (allowPrivateCallbacks for localhost testing)
    integration = createTriggerIntegration({
      rpcUrl: 'http://localhost:9545',
      enableOnChainRegistration: false,
      executorWallet,
      chainId: 9545,
      allowPrivateCallbacks: true,
    });

    await integration.initialize();
  });

  afterAll(async () => {
    await integration.shutdown();
    if (callbackServer) callbackServer.stop();
    if (targetServer) targetServer.stop();
  });

  describe('Full Trigger Flow', () => {
    test('registers trigger, subscribes, executes, and verifies proof', async () => {
      const target: HttpTarget = {
        type: 'http',
        endpoint: `http://localhost:${targetPort}/api/trigger`,
        method: 'POST',
        timeout: 30,
      };

      const triggerId = await integration.registerTrigger({
        source: 'local',
        type: 'webhook',
        name: 'e2e-test-trigger',
        target,
        webhookPath: '/webhooks/e2e-test',
        active: true,
      });

      expect(triggerId).toBeDefined();

      const subscription = await integration.subscribe({
        triggerId,
        subscriberAddress: subscriberWallet.address as Address,
        callbackEndpoint: `http://localhost:${callbackPort}/trigger-callback`,
        callbackMethod: 'POST',
        payment: { mode: 'free', pricePerExecution: 0n },
      });

      expect(subscription.id).toBeDefined();

      const result = await integration.executeTrigger({
        triggerId,
        input: { action: 'test', value: 42 },
      });

      expect(result.status).toBe('success');
      expect(result.executionId).toBeDefined();
      expect(result.output).toBeDefined();
      expect((result.output as Record<string, unknown>).success).toBe(true);

      expect(targetInvocations.length).toBeGreaterThan(0);

      expect(result.proof).toBeDefined();
      expect(result.proof!.executorSignature).toBeDefined();

      const isValid = verifyTriggerProof(result.proof!, executorWallet.address as Address);
      expect(isValid).toBe(true);

      await new Promise((r) => setTimeout(r, 100));
      expect(callbackRecords.length).toBeGreaterThan(0);
    });

    test('callback receives proof message for acknowledgment', async () => {
      const target: HttpTarget = {
        type: 'http',
        endpoint: `http://localhost:${targetPort}/api/trigger`,
        method: 'POST',
        timeout: 30,
      };

      const triggerId = await integration.registerTrigger({
        source: 'local',
        type: 'event',
        name: 'proof-message-test',
        target,
        eventTypes: ['test.event'],
        active: true,
      });

      await integration.subscribe({
        triggerId,
        subscriberAddress: subscriberWallet.address as Address,
        callbackEndpoint: `http://localhost:${callbackPort}/trigger-callback`,
        payment: { mode: 'free', pricePerExecution: 0n },
      });

      const beforeCount = callbackRecords.length;

      await integration.executeTrigger({ triggerId, input: { event: 'proof-test' } });
      await new Promise((r) => setTimeout(r, 100));

      expect(callbackRecords.length).toBeGreaterThan(beforeCount);
      const callback = callbackRecords[callbackRecords.length - 1];
      
      expect(callback!.proofMessage).toBeDefined();
      expect(callback!.proofMessage.startsWith('0x')).toBe(true);
    });
  });

  describe('Subscription Payment', () => {
    test('prepaid balance is deducted on execution', async () => {
      const target: HttpTarget = {
        type: 'http',
        endpoint: `http://localhost:${targetPort}/api/trigger`,
        method: 'POST',
        timeout: 30,
      };

      const triggerId = await integration.registerTrigger({
        source: 'local',
        type: 'webhook',
        name: 'prepaid-test',
        target,
        active: true,
      });

      const pricePerExecution = 1000000000000000n;
      const initialBalance = 5000000000000000n;

      const subscription = await integration.subscribe({
        triggerId,
        subscriberAddress: subscriberWallet.address as Address,
        callbackEndpoint: `http://localhost:${callbackPort}/trigger-callback`,
        payment: {
          mode: 'prepaid',
          pricePerExecution,
          prepaidBalance: initialBalance,
        },
        maxExecutions: 5,
      });

      await integration.executeTrigger({ triggerId });
      await new Promise((r) => setTimeout(r, 50));

      const subs = integration.getSubscriptions(triggerId);
      const updated = subs.find((s) => s.id === subscription.id);
      
      expect(updated).toBeDefined();
      expect(updated!.payment.prepaidBalance).toBe(initialBalance - pricePerExecution);
      expect(updated!.executionCount).toBe(1);
    });

    test('execution skipped when prepaid balance insufficient', async () => {
      const target: HttpTarget = {
        type: 'http',
        endpoint: `http://localhost:${targetPort}/api/trigger`,
        method: 'POST',
        timeout: 30,
      };

      const triggerId = await integration.registerTrigger({
        source: 'local',
        type: 'webhook',
        name: 'insufficient-balance-test',
        target,
        active: true,
      });

      await integration.subscribe({
        triggerId,
        subscriberAddress: subscriberWallet.address as Address,
        callbackEndpoint: `http://localhost:${callbackPort}/trigger-callback`,
        payment: {
          mode: 'prepaid',
          pricePerExecution: 1000000000000000n,
          prepaidBalance: 500000000000000n,
        },
      });

      const beforeCount = callbackRecords.length;
      await integration.executeTrigger({ triggerId });
      await new Promise((r) => setTimeout(r, 50));

      expect(callbackRecords.length).toBe(beforeCount);
    });

    test('execution skipped when max executions reached', async () => {
      const target: HttpTarget = {
        type: 'http',
        endpoint: `http://localhost:${targetPort}/api/trigger`,
        method: 'POST',
        timeout: 30,
      };

      const triggerId = await integration.registerTrigger({
        source: 'local',
        type: 'webhook',
        name: 'max-exec-test',
        target,
        active: true,
      });

      await integration.subscribe({
        triggerId,
        subscriberAddress: subscriberWallet.address as Address,
        callbackEndpoint: `http://localhost:${callbackPort}/trigger-callback`,
        payment: { mode: 'free', pricePerExecution: 0n },
        maxExecutions: 2,
      });

      await integration.executeTrigger({ triggerId });
      await integration.executeTrigger({ triggerId });

      // Third execution should be ignored (max 2)
      await integration.executeTrigger({ triggerId });
      await new Promise((r) => setTimeout(r, 50));

      const thisTriggerCallbacks = callbackRecords.filter((r) => r.triggerId === triggerId);
      expect(thisTriggerCallbacks.length).toBe(2);
    });
  });

  describe('Multiple Subscribers', () => {
    test('all subscribers receive callbacks', async () => {
      const target: HttpTarget = {
        type: 'http',
        endpoint: `http://localhost:${targetPort}/api/trigger`,
        method: 'POST',
        timeout: 30,
      };

      const triggerId = await integration.registerTrigger({
        source: 'local',
        type: 'event',
        name: 'multi-subscriber-test',
        target,
        eventTypes: ['multi.event'],
        active: true,
      });

      const addresses = [
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222',
        '0x3333333333333333333333333333333333333333',
      ] as const;

      for (const addr of addresses) {
        await integration.subscribe({
          triggerId,
          subscriberAddress: addr,
          callbackEndpoint: `http://localhost:${callbackPort}/trigger-callback`,
          payment: { mode: 'free', pricePerExecution: 0n },
        });
      }

      const beforeCount = callbackRecords.length;
      await integration.executeTrigger({ triggerId, input: { multi: true } });
      await new Promise((r) => setTimeout(r, 150));

      expect(callbackRecords.length).toBe(beforeCount + 3);
    });
  });

  describe('Event Triggers', () => {
    test('emitEvent triggers matching handlers', async () => {
      const target: HttpTarget = {
        type: 'http',
        endpoint: `http://localhost:${targetPort}/api/trigger`,
        method: 'POST',
        timeout: 30,
      };

      await integration.registerTrigger({
        source: 'local',
        type: 'event',
        name: 'order-created-handler',
        target,
        eventTypes: ['order.created'],
        active: true,
      });

      await integration.registerTrigger({
        source: 'local',
        type: 'event',
        name: 'order-updated-handler',
        target,
        eventTypes: ['order.updated'],
        active: true,
      });

      const beforeCount = targetInvocations.length;

      const results = await integration.emitEvent('order.created', {
        orderId: '12345',
        amount: 100,
      });

      expect(results.length).toBe(1);
      expect(results[0]!.status).toBe('success');
      expect(targetInvocations.length).toBe(beforeCount + 1);
    });
  });

  describe('Cron Triggers', () => {
    test('cron triggers can be executed via executeTrigger', async () => {
      const target: HttpTarget = {
        type: 'http',
        endpoint: `http://localhost:${targetPort}/api/trigger`,
        method: 'POST',
        timeout: 30,
      };

      const triggerId = await integration.registerTrigger({
        source: 'local',
        type: 'cron',
        name: 'every-minute-test',
        target,
        cronExpression: '* * * * *',
        active: true,
      });

      const beforeCount = targetInvocations.length;
      const result = await integration.executeTrigger({ triggerId });

      expect(result.status).toBe('success');
      expect(targetInvocations.length).toBeGreaterThan(beforeCount);
    });

    test('getTriggers filters cron triggers correctly', async () => {
      const cronTriggers = integration.getTriggers({ type: 'cron', active: true });
      expect(cronTriggers.length).toBeGreaterThanOrEqual(1);
      expect(cronTriggers.every((t) => t.type === 'cron')).toBe(true);
    });
  });

  describe('Execution History', () => {
    test('tracks execution history', async () => {
      const target: HttpTarget = {
        type: 'http',
        endpoint: `http://localhost:${targetPort}/api/trigger`,
        method: 'POST',
        timeout: 30,
      };

      const triggerId = await integration.registerTrigger({
        source: 'local',
        type: 'webhook',
        name: 'history-test',
        target,
        active: true,
      });

      await integration.executeTrigger({ triggerId });
      await integration.executeTrigger({ triggerId });
      await integration.executeTrigger({ triggerId });

      const history = integration.getExecutionHistory(triggerId);
      expect(history.length).toBeGreaterThanOrEqual(3);
      expect(history.every((h) => h.triggerId === triggerId)).toBe(true);
    });

    test('limits execution history', () => {
      const history = integration.getExecutionHistory(undefined, 5);
      expect(history.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Error Handling', () => {
    test('handles endpoint timeout gracefully', async () => {
      const target: HttpTarget = {
        type: 'http',
        endpoint: 'http://localhost:59999/nonexistent',
        method: 'POST',
        timeout: 1,
      };

      const triggerId = await integration.registerTrigger({
        source: 'local',
        type: 'webhook',
        name: 'timeout-test',
        target,
        active: true,
      });

      await expect(
        integration.executeTrigger({ triggerId })
      ).rejects.toThrow();
    });

    test('rejects execution for non-existent trigger', async () => {
      await expect(
        integration.executeTrigger({ triggerId: 'non-existent-trigger' })
      ).rejects.toThrow('not found');
    });

    test('rejects subscription to non-existent trigger', async () => {
      await expect(
        integration.subscribe({
          triggerId: 'non-existent-trigger',
          subscriberAddress: subscriberWallet.address as Address,
          callbackEndpoint: 'http://localhost:9999/callback',
          payment: { mode: 'free', pricePerExecution: 0n },
        })
      ).rejects.toThrow('not found');
    });
  });

  describe('Proof Verification', () => {
    test('proof is tamper-proof', async () => {
      const target: HttpTarget = {
        type: 'http',
        endpoint: `http://localhost:${targetPort}/api/trigger`,
        method: 'POST',
        timeout: 30,
      };

      const triggerId = await integration.registerTrigger({
        source: 'local',
        type: 'webhook',
        name: 'tamper-proof-test',
        target,
        active: true,
      });

      await integration.subscribe({
        triggerId,
        subscriberAddress: subscriberWallet.address as Address,
        callbackEndpoint: `http://localhost:${callbackPort}/trigger-callback`,
        payment: { mode: 'free', pricePerExecution: 0n },
      });

      const result = await integration.executeTrigger({
        triggerId,
        input: { original: 'data' },
      });

      expect(result.proof).toBeDefined();

      const tamperedProof = {
        ...result.proof!,
        inputHash: hashTriggerData({ tampered: 'data' }),
      };

      const isValid = verifyTriggerProof(tamperedProof, executorWallet.address as Address);
      expect(isValid).toBe(false);
    });

    test('different executor cannot forge proof', async () => {
      const target: HttpTarget = {
        type: 'http',
        endpoint: `http://localhost:${targetPort}/api/trigger`,
        method: 'POST',
        timeout: 30,
      };

      const triggerId = await integration.registerTrigger({
        source: 'local',
        type: 'webhook',
        name: 'forge-proof-test',
        target,
        active: true,
      });

      await integration.subscribe({
        triggerId,
        subscriberAddress: subscriberWallet.address as Address,
        callbackEndpoint: `http://localhost:${callbackPort}/trigger-callback`,
        payment: { mode: 'free', pricePerExecution: 0n },
      });

      const result = await integration.executeTrigger({ triggerId });

      const fakeExecutor = Wallet.createRandom();
      const isValid = verifyTriggerProof(result.proof!, fakeExecutor.address as Address);
      expect(isValid).toBe(false);
    });
  });
});
