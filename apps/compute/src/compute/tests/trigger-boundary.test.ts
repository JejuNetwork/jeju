/** Trigger Boundary & Integration Tests */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Wallet } from 'ethers';
import { serve } from 'bun';
import {
  TriggerIntegration,
  shouldExecuteCron,
  hashTriggerData,
  generateProofMessage,
  signTriggerProof,
  verifyTriggerProof,
  type HttpTarget,
  type TriggerProofMessage,
  type TriggerProof,
} from '../sdk/trigger-integration';
import type { Address } from 'viem';

type BunServer = ReturnType<typeof serve>;

const createWallet = (): Wallet => Wallet.createRandom() as unknown as Wallet;
const wallet = createWallet();
const subscriberWallet = createWallet();

describe('HTTP Target Timeouts', () => {
  let integration: TriggerIntegration;
  let slowServer: BunServer;
  const port = 19800;

  beforeAll(async () => {
    slowServer = serve({
      port,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === '/slow') {
          await new Promise(r => setTimeout(r, 5000)); // 5 second delay
          return new Response(JSON.stringify({ late: true }));
        }
        if (url.pathname === '/fast') {
          return new Response(JSON.stringify({ fast: true }));
        }
        return new Response('Not Found', { status: 404 });
      },
    });

    integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      enableOnChainRegistration: false,
      executorWallet: wallet,
    });
    await integration.initialize();
  });

  afterAll(async () => {
    await integration.shutdown();
    slowServer.stop();
  });

  test('fast request completes within timeout', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'fast-trigger', eventTypes: ['fast'],
      target: { type: 'http', endpoint: `http://localhost:${port}/fast`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    const result = await integration.executeTrigger({ triggerId });
    expect(result.status).toBe('success');
    expect(result.output).toHaveProperty('fast', true);
  });

  test('slow request times out', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'slow-trigger', eventTypes: ['slow'],
      target: { type: 'http', endpoint: `http://localhost:${port}/slow`, method: 'POST', timeout: 1 } as HttpTarget, // 1 second timeout
      active: true,
    });

    await expect(integration.executeTrigger({ triggerId })).rejects.toThrow();
  }, 10000);

  test('timeout boundary: exactly at timeout limit', async () => {
    const boundaryServer = serve({
      port: 19801,
      fetch: async () => {
        await new Promise(r => setTimeout(r, 500)); // 500ms
        return new Response(JSON.stringify({ boundary: true }));
      },
    });

    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'boundary-trigger', eventTypes: ['boundary'],
      target: { type: 'http', endpoint: 'http://localhost:19801/', method: 'POST', timeout: 1 } as HttpTarget, // 1 second should be enough
      active: true,
    });

    const result = await integration.executeTrigger({ triggerId });
    expect(result.status).toBe('success');

    boundaryServer.stop();
  });
});

describe('HTTP Response Handling', () => {
  let integration: TriggerIntegration;
  let responseServer: BunServer;
  const port = 19810;

  beforeAll(async () => {
    responseServer = serve({
      port,
      fetch: async (req) => {
        const url = new URL(req.url);
        switch (url.pathname) {
          case '/200': return new Response(JSON.stringify({ status: 200 }));
          case '/201': return new Response(JSON.stringify({ created: true }), { status: 201 });
          case '/204': return new Response(null, { status: 204 });
          case '/400': return new Response(JSON.stringify({ error: 'Bad Request' }), { status: 400 });
          case '/401': return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
          case '/403': return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
          case '/404': return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
          case '/500': return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
          case '/503': return new Response(JSON.stringify({ error: 'Service Unavailable' }), { status: 503 });
          case '/invalid-json': return new Response('not json', { headers: { 'Content-Type': 'application/json' } });
          case '/empty': return new Response('');
          case '/html': return new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } });
          default: return new Response('Not Found', { status: 404 });
        }
      },
    });

    integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      enableOnChainRegistration: false,
      executorWallet: wallet,
    });
    await integration.initialize();
  });

  afterAll(async () => {
    await integration.shutdown();
    responseServer.stop();
  });

  test('handles 200 OK response', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'test-200', eventTypes: ['http'],
      target: { type: 'http', endpoint: `http://localhost:${port}/200`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });
    const result = await integration.executeTrigger({ triggerId });
    expect(result.status).toBe('success');
    expect(result.output).toHaveProperty('status', 200);
  });

  test('handles 201 Created response', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'test-201', eventTypes: ['http'],
      target: { type: 'http', endpoint: `http://localhost:${port}/201`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });
    const result = await integration.executeTrigger({ triggerId });
    expect(result.status).toBe('success');
  });

  test('handles 204 No Content', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'test-204', eventTypes: ['http'],
      target: { type: 'http', endpoint: `http://localhost:${port}/204`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });
    const result = await integration.executeTrigger({ triggerId });
    expect(result.status).toBe('success');
    expect(result.output === null || result.output === undefined || Object.keys(result.output as object).length === 0).toBe(true);
  });

  test('400 error throws with message', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'test-400', eventTypes: ['http'],
      target: { type: 'http', endpoint: `http://localhost:${port}/400`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });
    await expect(integration.executeTrigger({ triggerId })).rejects.toThrow('HTTP 400');
  });

  test('500 error throws with message', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'test-500', eventTypes: ['http'],
      target: { type: 'http', endpoint: `http://localhost:${port}/500`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });
    await expect(integration.executeTrigger({ triggerId })).rejects.toThrow('HTTP 500');
  });

  test('handles invalid JSON gracefully', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'test-invalid-json', eventTypes: ['http'],
      target: { type: 'http', endpoint: `http://localhost:${port}/invalid-json`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });
    const result = await integration.executeTrigger({ triggerId });
    expect(result.status).toBe('success');
    expect(result.output).toEqual({}); // Falls back to empty object
  });

  test('handles empty response body', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'test-empty', eventTypes: ['http'],
      target: { type: 'http', endpoint: `http://localhost:${port}/empty`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });
    const result = await integration.executeTrigger({ triggerId });
    expect(result.status).toBe('success');
  });
});

describe('Cron Expression Parsing', () => {
  test('handles leading/trailing whitespace', () => {
    expect(shouldExecuteCron('  * * * * *  ')).toBe(true);
    expect(shouldExecuteCron('\t* * * * *\t')).toBe(true);
    expect(shouldExecuteCron('\n* * * * *\n')).toBe(true);
  });

  test('handles multiple spaces between fields', () => {
    expect(shouldExecuteCron('*  *   *    *     *')).toBe(true);
  });

  test('mixed valid/invalid parts', () => {
    // If any part is valid and matches, the whole expression could still work
    const now = new Date();
    const currentMin = now.getMinutes();
    expect(shouldExecuteCron(`${currentMin} * * * *`)).toBe(true);
  });

  test('out of range values', () => {
    // These should not crash, may match or not depending on current time
    expect(typeof shouldExecuteCron('60 * * * *')).toBe('boolean'); // minute 60 doesn't exist
    expect(typeof shouldExecuteCron('* 24 * * *')).toBe('boolean'); // hour 24 doesn't exist
    expect(typeof shouldExecuteCron('* * 32 * *')).toBe('boolean'); // day 32 doesn't exist
    expect(typeof shouldExecuteCron('* * * 13 *')).toBe('boolean'); // month 13 doesn't exist
    expect(typeof shouldExecuteCron('* * * * 7')).toBe('boolean'); // day 7 is valid (some implementations)
  });

  test('negative values', () => {
    expect(typeof shouldExecuteCron('-1 * * * *')).toBe('boolean');
  });

  test('step with zero base', () => {
    expect(shouldExecuteCron('0/5 * * * *')).toBe(new Date().getMinutes() % 5 === 0);
  });

  test('range with step', () => {
    // 0-30/5 means 0, 5, 10, 15, 20, 25, 30 - verify it doesn't crash
    expect(typeof shouldExecuteCron('0-30/5 * * * *')).toBe('boolean');
  });

  test('all wildcards', () => {
    expect(shouldExecuteCron('* * * * *')).toBe(true);
  });
});

describe('Proof System Integrity', () => {
  test('proof signature is deterministic for same input', async () => {
    const msg: TriggerProofMessage = {
      triggerId: 'test-123',
      executionId: 'exec-456',
      timestamp: 1700000000000,
      nonce: 'fixed-nonce',
      inputHash: hashTriggerData({ a: 1 }),
      outputHash: hashTriggerData({ b: 2 }),
      subscriberAddress: subscriberWallet.address as Address,
      chainId: 1,
    };

    const sig1 = await signTriggerProof(wallet as Wallet, msg);
    const sig2 = await signTriggerProof(wallet as Wallet, msg);

    expect(sig1).toBe(sig2);
  });

  test('proof signature differs for different inputs', async () => {
    const baseMsg: TriggerProofMessage = {
      triggerId: 'test-123',
      executionId: 'exec-456',
      timestamp: 1700000000000,
      nonce: 'fixed-nonce',
      inputHash: hashTriggerData({ a: 1 }),
      outputHash: hashTriggerData({ b: 2 }),
      subscriberAddress: subscriberWallet.address as Address,
      chainId: 1,
    };

    const sig1 = await signTriggerProof(wallet as Wallet, baseMsg);
    const sig2 = await signTriggerProof(wallet as Wallet, { ...baseMsg, nonce: 'different' });
    const sig3 = await signTriggerProof(wallet as Wallet, { ...baseMsg, timestamp: 1700000000001 });

    expect(sig1).not.toBe(sig2);
    expect(sig2).not.toBe(sig3);
  });

  test('proof verification returns correct result', async () => {
    const msg: TriggerProofMessage = {
      triggerId: 'verify-test',
      executionId: 'verify-exec',
      timestamp: Date.now(),
      nonce: 'verify-nonce',
      inputHash: hashTriggerData({ input: true }),
      outputHash: hashTriggerData({ output: true }),
      subscriberAddress: subscriberWallet.address as Address,
      chainId: 31337,
    };

    const signature = await signTriggerProof(wallet as Wallet, msg);
    const proof: TriggerProof = {
      ...msg,
      executorAddress: wallet.address as Address,
      executorSignature: signature,
    };

    // Correct executor - should pass
    expect(verifyTriggerProof(proof, wallet.address as Address)).toBe(true);

    // Wrong executor - should fail
    expect(verifyTriggerProof(proof, subscriberWallet.address as Address)).toBe(false);
  });

  test('proof message hash is 66 chars (0x + 64 hex)', () => {
    const msg: TriggerProofMessage = {
      triggerId: 'hash-test',
      executionId: 'hash-exec',
      timestamp: Date.now(),
      nonce: 'hash-nonce',
      inputHash: hashTriggerData({}),
      outputHash: hashTriggerData({}),
      subscriberAddress: subscriberWallet.address as Address,
      chainId: 1,
    };

    const hash = generateProofMessage(msg);
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(hash.length).toBe(66);
  });
});

describe('Event Emission Matching', () => {
  let integration: TriggerIntegration;
  let callbackServer: BunServer;
  const port = 19820;
  const receivedEvents: Array<{ triggerId: string }> = [];

  beforeAll(async () => {
    callbackServer = serve({
      port,
      fetch: async (req) => {
        const body = await req.json() as { triggerId?: string };
        if (body.triggerId) receivedEvents.push({ triggerId: body.triggerId });
        return new Response(JSON.stringify({ ok: true }));
      },
    });

    integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      enableOnChainRegistration: false,
      executorWallet: wallet,
    });
    await integration.initialize();
  });

  afterAll(async () => {
    await integration.shutdown();
    callbackServer.stop();
  });

  test('emits to all matching triggers', async () => {
    receivedEvents.length = 0;

    const triggerId1 = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'multi-1',
      eventTypes: ['shared-event', 'event-a'],
      target: { type: 'http', endpoint: `http://localhost:${port}/callback`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    const triggerId2 = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'multi-2',
      eventTypes: ['shared-event', 'event-b'],
      target: { type: 'http', endpoint: `http://localhost:${port}/callback`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    const triggerId3 = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'multi-3',
      eventTypes: ['event-c'], // Does NOT match shared-event
      target: { type: 'http', endpoint: `http://localhost:${port}/callback`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    const results = await integration.emitEvent('shared-event', { data: 'test' });

    expect(results.length).toBe(2); // Only 2 triggers match
    expect(results.map(r => r.triggerId)).toContain(triggerId1);
    expect(results.map(r => r.triggerId)).toContain(triggerId2);
    expect(results.map(r => r.triggerId)).not.toContain(triggerId3);
  });

  test('emits to none when no triggers match', async () => {
    const results = await integration.emitEvent('non-existent-event', { data: 'test' });
    expect(results).toEqual([]);
  });

  test('skips inactive triggers', async () => {
    await integration.registerTrigger({
      source: 'local', type: 'event', name: 'inactive-event-trigger',
      eventTypes: ['inactive-event'],
      target: { type: 'http', endpoint: `http://localhost:${port}/callback`, method: 'POST', timeout: 30 } as HttpTarget,
      active: false,
    });

    const results = await integration.emitEvent('inactive-event', { data: 'test' });
    expect(results).toEqual([]);
  });
});

// =============================================================================
// Input/Output Data Integrity
// =============================================================================

describe('Data Integrity Through Execution', () => {
  let integration: TriggerIntegration;
  let dataServer: BunServer;
  const port = 19830;
  let lastReceivedBody: Record<string, unknown> | null = null;

  beforeAll(async () => {
    dataServer = serve({
      port,
      fetch: async (req) => {
        try {
          lastReceivedBody = await req.json() as Record<string, unknown>;
        } catch {
          lastReceivedBody = null;
        }
        return new Response(JSON.stringify({ 
          echo: lastReceivedBody,
          serverTime: Date.now(),
          randomId: Math.random().toString(36).slice(2),
        }));
      },
    });

    integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      enableOnChainRegistration: false,
      executorWallet: wallet,
    });
    await integration.initialize();
  });

  afterAll(async () => {
    await integration.shutdown();
    dataServer.stop();
  });

  test('nested object input preserved', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'nested-input',
      eventTypes: ['data'],
      target: { type: 'http', endpoint: `http://localhost:${port}/data`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    const input = {
      level1: {
        level2: {
          level3: {
            value: 'deep',
            array: [1, 2, { nested: true }],
          },
        },
      },
    };

    await integration.executeTrigger({ triggerId, input });

    expect(lastReceivedBody).toMatchObject(input);
  });

  test('special characters in input preserved', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'special-chars',
      eventTypes: ['data'],
      target: { type: 'http', endpoint: `http://localhost:${port}/data`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    const input = {
      unicode: '日本語テスト 🎉 العربية',
      escaped: '\n\t\r\\\"',
      html: '<script>alert("xss")</script>',
      url: 'https://example.com?foo=bar&baz=qux',
    };

    await integration.executeTrigger({ triggerId, input });

    expect(lastReceivedBody).toMatchObject(input);
  });

  test('large input handled correctly', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'large-input',
      eventTypes: ['data'],
      target: { type: 'http', endpoint: `http://localhost:${port}/data`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    const largeArray = Array.from({ length: 1000 }, (_, i) => ({ index: i, data: 'x'.repeat(100) }));
    const input = { items: largeArray };

    await integration.executeTrigger({ triggerId, input });

    expect((lastReceivedBody as { items: unknown[] })?.items?.length).toBe(1000);
  });

  test('empty input sends empty object', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'empty-input',
      eventTypes: ['data'],
      target: { type: 'http', endpoint: `http://localhost:${port}/data`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    await integration.executeTrigger({ triggerId });

    expect(lastReceivedBody).toEqual({});
  });

  test('output contains actual response data', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'output-test',
      eventTypes: ['data'],
      target: { type: 'http', endpoint: `http://localhost:${port}/data`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    const result = await integration.executeTrigger({ triggerId, input: { test: true } });

    expect(result.output).toHaveProperty('serverTime');
    expect(result.output).toHaveProperty('randomId');
    expect((result.output as { echo: { test: boolean } }).echo).toEqual({ test: true });
  });
});

describe('Execution ID Uniqueness', () => {
  let integration: TriggerIntegration;
  let dummyServer: BunServer;
  const port = 19840;

  beforeAll(async () => {
    dummyServer = serve({
      port,
      fetch: () => new Response(JSON.stringify({ ok: true })),
    });

    integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      enableOnChainRegistration: false,
      executorWallet: wallet,
    });
    await integration.initialize();
  });

  afterAll(async () => {
    await integration.shutdown();
    dummyServer.stop();
  });

  test('generates unique execution IDs across 100 executions', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'unique-id-test',
      eventTypes: ['unique'],
      target: { type: 'http', endpoint: `http://localhost:${port}/`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    const ids = new Set<string>();
    const promises = Array.from({ length: 100 }, () => integration.executeTrigger({ triggerId }));
    const results = await Promise.all(promises);

    for (const result of results) {
      ids.add(result.executionId);
    }

    expect(ids.size).toBe(100); // All unique
  });

  test('execution ID format is consistent', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'id-format-test',
      eventTypes: ['format'],
      target: { type: 'http', endpoint: `http://localhost:${port}/`, method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    const results = await Promise.all(Array.from({ length: 10 }, () => integration.executeTrigger({ triggerId })));

    for (const result of results) {
      expect(result.executionId).toMatch(/^exec-\d+-[a-z0-9]{6}$/);
    }
  });
});

describe('Trigger State Management', () => {
  let integration: TriggerIntegration;

  beforeAll(async () => {
    integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      enableOnChainRegistration: false,
    });
    await integration.initialize();
  });

  afterAll(async () => {
    await integration.shutdown();
  });

  test('newly registered trigger is retrievable', async () => {
    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'state-test',
      eventTypes: ['state'],
      target: { type: 'http', endpoint: 'http://example.com', method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    const trigger = integration.getTrigger(triggerId);
    expect(trigger).toBeDefined();
    expect(trigger!.id).toBe(triggerId);
    expect(trigger!.name).toBe('state-test');
    expect(trigger!.active).toBe(true);
    expect(trigger!.createdAt).toBeInstanceOf(Date);
  });

  test('trigger filter by source works', async () => {
    await integration.registerTrigger({
      source: 'local', type: 'event', name: 'filter-local',
      eventTypes: ['filter'],
      target: { type: 'http', endpoint: 'http://example.com', method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    const localTriggers = integration.getTriggers({ source: 'local' });
    expect(localTriggers.every(t => t.source === 'local')).toBe(true);

    const onchainTriggers = integration.getTriggers({ source: 'onchain' });
    expect(onchainTriggers.every(t => t.source === 'onchain')).toBe(true);
  });

  test('trigger filter by type works', async () => {
    await integration.registerTrigger({
      source: 'local', type: 'cron', name: 'filter-cron', cronExpression: '* * * * *',
      target: { type: 'http', endpoint: 'http://example.com', method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    await integration.registerTrigger({
      source: 'local', type: 'webhook', name: 'filter-webhook', webhookPath: '/test',
      target: { type: 'http', endpoint: 'http://example.com', method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    const cronTriggers = integration.getTriggers({ type: 'cron' });
    expect(cronTriggers.length).toBeGreaterThan(0);
    expect(cronTriggers.every(t => t.type === 'cron')).toBe(true);
  });

  test('trigger filter by active status works', async () => {
    await integration.registerTrigger({
      source: 'local', type: 'event', name: 'filter-active',
      eventTypes: ['active'],
      target: { type: 'http', endpoint: 'http://example.com', method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    await integration.registerTrigger({
      source: 'local', type: 'event', name: 'filter-inactive',
      eventTypes: ['inactive'],
      target: { type: 'http', endpoint: 'http://example.com', method: 'POST', timeout: 30 } as HttpTarget,
      active: false,
    });

    const activeTriggers = integration.getTriggers({ active: true });
    expect(activeTriggers.every(t => t.active)).toBe(true);

    const inactiveTriggers = integration.getTriggers({ active: false });
    expect(inactiveTriggers.every(t => !t.active)).toBe(true);
  });
});

describe('Security Features', () => {
  test('SSRF protection blocks localhost by default', async () => {
    const integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      enableOnChainRegistration: false,
    });
    await integration.initialize();

    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'ssrf-test', eventTypes: ['ssrf'],
      target: { type: 'http', endpoint: 'https://example.com', method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    await expect(integration.subscribe({
      triggerId, subscriberAddress: wallet.address as Address,
      callbackEndpoint: 'http://localhost:8080/callback',
      payment: { mode: 'free', pricePerExecution: 0n },
    })).rejects.toThrow('Callback URL blocked');

    await expect(integration.subscribe({
      triggerId, subscriberAddress: wallet.address as Address,
      callbackEndpoint: 'http://127.0.0.1:8080/callback',
      payment: { mode: 'free', pricePerExecution: 0n },
    })).rejects.toThrow('Callback URL blocked');

    await expect(integration.subscribe({
      triggerId, subscriberAddress: wallet.address as Address,
      callbackEndpoint: 'http://10.0.0.1:8080/callback',
      payment: { mode: 'free', pricePerExecution: 0n },
    })).rejects.toThrow('Callback URL blocked');

    await integration.shutdown();
  });

  test('SSRF protection allows external URLs', async () => {
    const integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      enableOnChainRegistration: false,
    });
    await integration.initialize();

    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'ssrf-allow-test', eventTypes: ['ssrf'],
      target: { type: 'http', endpoint: 'https://example.com', method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    // Should not throw for external URLs
    const sub = await integration.subscribe({
      triggerId, subscriberAddress: wallet.address as Address,
      callbackEndpoint: 'https://api.example.com/webhook',
      payment: { mode: 'free', pricePerExecution: 0n },
    });
    expect(sub.id).toBeDefined();

    await integration.shutdown();
  });

  test('allowPrivateCallbacks flag permits localhost', async () => {
    const integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      enableOnChainRegistration: false,
      allowPrivateCallbacks: true,
    });
    await integration.initialize();

    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'allow-private-test', eventTypes: ['private'],
      target: { type: 'http', endpoint: 'https://example.com', method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    const sub = await integration.subscribe({
      triggerId, subscriberAddress: wallet.address as Address,
      callbackEndpoint: 'http://localhost:8080/callback',
      payment: { mode: 'free', pricePerExecution: 0n },
    });
    expect(sub.id).toBeDefined();

    await integration.shutdown();
  });

  test('rate limiting blocks excessive webhook calls', async () => {
    const rateServer = serve({
      port: 19901,
      fetch: () => new Response(JSON.stringify({ ok: true })),
    });

    const integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      enableOnChainRegistration: false,
      webhookRateLimit: { windowMs: 1000, maxRequests: 3 },
      allowPrivateCallbacks: true,
    });
    await integration.initialize();

    await integration.registerTrigger({
      source: 'local', type: 'webhook', name: 'rate-limit-test', webhookPath: '/test',
      target: { type: 'http', endpoint: 'http://localhost:19901/', method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    // First 3 should succeed
    await integration.handleWebhook('/test', {});
    await integration.handleWebhook('/test', {});
    await integration.handleWebhook('/test', {});

    // 4th should be rate limited
    await expect(integration.handleWebhook('/test', {})).rejects.toThrow('Rate limit exceeded');

    rateServer.stop();
    await integration.shutdown();
  });

  test('history is pruned when exceeds maxHistorySize', async () => {
    const server = serve({
      port: 19900,
      fetch: () => new Response(JSON.stringify({ ok: true })),
    });

    const integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      enableOnChainRegistration: false,
      maxHistorySize: 10,
      allowPrivateCallbacks: true,
    });
    await integration.initialize();

    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'history-test', eventTypes: ['history'],
      target: { type: 'http', endpoint: 'http://localhost:19900/', method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    // Execute 15 triggers
    for (let i = 0; i < 15; i++) {
      await integration.executeTrigger({ triggerId });
    }

    // History should be pruned to ~80% of max
    const history = integration.getExecutionHistory();
    expect(history.length).toBeLessThanOrEqual(10);
    expect(history.length).toBeGreaterThan(0);

    server.stop();
    await integration.shutdown();
  });

  test('shutdown blocks new executions', async () => {
    const integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      enableOnChainRegistration: false,
    });
    await integration.initialize();

    const triggerId = await integration.registerTrigger({
      source: 'local', type: 'event', name: 'shutdown-test', eventTypes: ['shutdown'],
      target: { type: 'http', endpoint: 'https://example.com', method: 'POST', timeout: 30 } as HttpTarget,
      active: true,
    });

    // Start shutdown
    const shutdownPromise = integration.shutdown();

    // New executions should fail
    await expect(integration.executeTrigger({ triggerId })).rejects.toThrow('Shutdown in progress');

    await shutdownPromise;
  });

  test('getActiveRequestCount and isShuttingDown work correctly', async () => {
    const integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      enableOnChainRegistration: false,
    });
    await integration.initialize();

    expect(integration.getActiveRequestCount()).toBe(0);
    expect(integration.isShuttingDown()).toBe(false);

    await integration.shutdown();

    expect(integration.isShuttingDown()).toBe(true);
  });
});
