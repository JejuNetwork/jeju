/**
 * Trigger Integration Tests
 *
 * Tests the generalized trigger system including:
 * - Proof of trigger generation and verification
 * - HTTP and contract targets
 * - Subscription management
 * - Cron expression matching
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Wallet, Interface } from 'ethers';
import {
  TriggerIntegration,
  generateProofMessage,
  signTriggerProof,
  verifyTriggerProof,
  hashTriggerData,
  shouldExecuteCron,
  type TriggerProof,
  type TriggerProofMessage,
  type HttpTarget,
  type ContractTarget,
} from '../sdk/trigger-integration';
import type { Address } from 'viem';

// Test wallets (cast HDNodeWallet to Wallet for compatibility)
const executorWallet = Wallet.createRandom() as unknown as Wallet;
const subscriberWallet = Wallet.createRandom() as unknown as Wallet;

describe('Trigger Integration', () => {
  let integration: TriggerIntegration;

  beforeAll(async () => {
    integration = new TriggerIntegration({
      rpcUrl: 'http://localhost:9545',
      enableOnChainRegistration: false,
      executorWallet,
      chainId: 9545,
    });
    await integration.initialize();
  });

  afterAll(async () => {
    await integration.shutdown();
  });

  describe('Proof of Trigger', () => {
    test('generates deterministic proof message', () => {
      const proofMessage: TriggerProofMessage = {
        triggerId: 'test-trigger-1',
        executionId: 'exec-1',
        timestamp: 1700000000000,
        nonce: 'abc123',
        inputHash: '0x' + '1'.repeat(64),
        outputHash: '0x' + '2'.repeat(64),
        subscriberAddress: subscriberWallet.address as Address,
        chainId: 9545,
      };

      const hash1 = generateProofMessage(proofMessage);
      const hash2 = generateProofMessage(proofMessage);

      expect(hash1).toBe(hash2);
      expect(hash1.startsWith('0x')).toBe(true);
    });

    test('signs trigger proof', async () => {
      const proofMessage: TriggerProofMessage = {
        triggerId: 'test-trigger-2',
        executionId: 'exec-2',
        timestamp: Date.now(),
        nonce: 'xyz789',
        inputHash: hashTriggerData({ foo: 'bar' }),
        outputHash: hashTriggerData({ result: 'success' }),
        subscriberAddress: subscriberWallet.address as Address,
        chainId: 9545,
      };

      const signature = await signTriggerProof(executorWallet, proofMessage);

      expect(signature).toBeDefined();
      expect(signature.startsWith('0x')).toBe(true);
      expect(signature.length).toBeGreaterThan(100);
    });

    test('verifies valid trigger proof', async () => {
      const proofMessage: TriggerProofMessage = {
        triggerId: 'test-trigger-3',
        executionId: 'exec-3',
        timestamp: Date.now(),
        nonce: 'verify-test',
        inputHash: hashTriggerData({ input: 'data' }),
        outputHash: hashTriggerData({ output: 'data' }),
        subscriberAddress: subscriberWallet.address as Address,
        chainId: 9545,
      };

      const signature = await signTriggerProof(executorWallet, proofMessage);

      const proof: TriggerProof = {
        ...proofMessage,
        executorAddress: executorWallet.address as Address,
        executorSignature: signature,
      };

      const isValid = verifyTriggerProof(proof, executorWallet.address as Address);
      expect(isValid).toBe(true);
    });

    test('rejects proof with wrong executor address', async () => {
      const proofMessage: TriggerProofMessage = {
        triggerId: 'test-trigger-4',
        executionId: 'exec-4',
        timestamp: Date.now(),
        nonce: 'wrong-executor',
        inputHash: hashTriggerData({}),
        outputHash: hashTriggerData({}),
        subscriberAddress: subscriberWallet.address as Address,
        chainId: 9545,
      };

      const signature = await signTriggerProof(executorWallet, proofMessage);

      const proof: TriggerProof = {
        ...proofMessage,
        executorAddress: executorWallet.address as Address,
        executorSignature: signature,
      };

      const wrongAddress = Wallet.createRandom().address as Address;
      const isValid = verifyTriggerProof(proof, wrongAddress);
      expect(isValid).toBe(false);
    });

    test('rejects tampered proof', async () => {
      const proofMessage: TriggerProofMessage = {
        triggerId: 'test-trigger-5',
        executionId: 'exec-5',
        timestamp: Date.now(),
        nonce: 'tamper-test',
        inputHash: hashTriggerData({ original: 'data' }),
        outputHash: hashTriggerData({}),
        subscriberAddress: subscriberWallet.address as Address,
        chainId: 9545,
      };

      const signature = await signTriggerProof(executorWallet, proofMessage);

      const tamperedProof: TriggerProof = {
        ...proofMessage,
        inputHash: hashTriggerData({ tampered: 'data' }),
        executorAddress: executorWallet.address as Address,
        executorSignature: signature,
      };

      const isValid = verifyTriggerProof(tamperedProof, executorWallet.address as Address);
      expect(isValid).toBe(false);
    });
  });

  describe('Data Hashing', () => {
    test('hashes data deterministically', () => {
      const data = { foo: 'bar', num: 42 };
      const hash1 = hashTriggerData(data);
      const hash2 = hashTriggerData(data);

      expect(hash1).toBe(hash2);
      expect(hash1.startsWith('0x')).toBe(true);
    });

    test('produces different hashes for different data', () => {
      const hash1 = hashTriggerData({ a: 1 });
      const hash2 = hashTriggerData({ a: 2 });

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('HTTP Target Registration', () => {
    test('registers a cron trigger with HTTP target', async () => {
      const httpTarget: HttpTarget = {
        type: 'http',
        endpoint: 'https://example.com/api/trigger',
        method: 'POST',
        timeout: 30,
      };

      const triggerId = await integration.registerTrigger({
        source: 'local',
        type: 'cron',
        name: 'test-cron-trigger',
        target: httpTarget,
        cronExpression: '* * * * *',
        active: true,
      });

      expect(triggerId).toBeDefined();
      expect(triggerId.startsWith('local-')).toBe(true);

      const trigger = integration.getTrigger(triggerId);
      expect(trigger).toBeDefined();
      expect(trigger!.target.type).toBe('http');
    });

    test('registers a webhook trigger with HTTP target', async () => {
      const httpTarget: HttpTarget = {
        type: 'http',
        endpoint: 'https://example.com/api/webhook',
        method: 'POST',
        timeout: 30,
      };

      const triggerId = await integration.registerTrigger({
        source: 'local',
        type: 'webhook',
        name: 'test-webhook-trigger',
        target: httpTarget,
        webhookPath: '/webhooks/test',
        active: true,
      });

      expect(triggerId).toBeDefined();
      
      const trigger = integration.getTrigger(triggerId);
      expect(trigger!.type).toBe('webhook');
    });

    test('registers an event trigger with HTTP target', async () => {
      const httpTarget: HttpTarget = {
        type: 'http',
        endpoint: 'https://example.com/api/events',
        method: 'POST',
        timeout: 30,
      };

      const triggerId = await integration.registerTrigger({
        source: 'local',
        type: 'event',
        name: 'test-event-trigger',
        target: httpTarget,
        eventTypes: ['order.created', 'order.updated'],
        active: true,
      });

      expect(triggerId).toBeDefined();
      
      const trigger = integration.getTrigger(triggerId);
      expect(trigger!.eventTypes).toContain('order.created');
    });
  });

  describe('Contract Target Configuration', () => {
    test('creates contract target configuration', () => {
      const contractTarget: ContractTarget = {
        type: 'contract',
        address: '0x1234567890123456789012345678901234567890' as Address,
        functionName: 'execute',
        abi: 'function execute(uint256 amount, address recipient) returns (bool)',
        args: [1000n, '0x0987654321098765432109876543210987654321'],
        value: 0n,
      };

      expect(contractTarget.type).toBe('contract');
      expect(contractTarget.functionName).toBe('execute');
    });

    test('registers trigger with contract target', async () => {
      const contractTarget: ContractTarget = {
        type: 'contract',
        address: '0x1234567890123456789012345678901234567890' as Address,
        functionName: 'trigger',
        abi: 'function trigger() external',
        args: [],
      };

      const triggerId = await integration.registerTrigger({
        source: 'local',
        type: 'cron',
        name: 'contract-trigger',
        target: contractTarget,
        cronExpression: '0 * * * *',
        active: true,
      });

      const trigger = integration.getTrigger(triggerId);
      expect(trigger!.target.type).toBe('contract');
    });
  });

  describe('Trigger Filtering', () => {
    test('lists triggers with filters', () => {
      const allTriggers = integration.getTriggers();
      expect(allTriggers.length).toBeGreaterThan(0);

      const cronTriggers = integration.getTriggers({ type: 'cron' });
      expect(cronTriggers.every((t) => t.type === 'cron')).toBe(true);

      const activeTriggers = integration.getTriggers({ active: true });
      expect(activeTriggers.every((t) => t.active === true)).toBe(true);
    });
  });

  describe('Subscription Management', () => {
    let testTriggerId: string;

    beforeEach(async () => {
      const httpTarget: HttpTarget = {
        type: 'http',
        endpoint: 'https://example.com/target',
        method: 'POST',
        timeout: 30,
      };

      testTriggerId = await integration.registerTrigger({
        source: 'local',
        type: 'cron',
        name: 'subscription-test-trigger',
        target: httpTarget,
        cronExpression: '* * * * *',
        active: true,
      });
    });

    test('creates a subscription', async () => {
      const subscription = await integration.subscribe({
        triggerId: testTriggerId,
        subscriberAddress: subscriberWallet.address as Address,
        callbackEndpoint: 'https://myapp.com/callback',
        payment: {
          mode: 'free',
          pricePerExecution: 0n,
        },
      });

      expect(subscription.id).toBeDefined();
      expect(subscription.triggerId).toBe(testTriggerId);
      expect(subscription.active).toBe(true);
    });

    test('creates subscription with prepaid payment', async () => {
      const subscription = await integration.subscribe({
        triggerId: testTriggerId,
        subscriberAddress: subscriberWallet.address as Address,
        callbackEndpoint: 'https://myapp.com/callback',
        payment: {
          mode: 'prepaid',
          pricePerExecution: 1000000000000000n,
          prepaidBalance: 10000000000000000n,
        },
      });

      expect(subscription.payment.mode).toBe('prepaid');
      expect(subscription.payment.prepaidBalance).toBe(10000000000000000n);
    });

    test('creates subscription with bearer auth', async () => {
      const subscription = await integration.subscribe({
        triggerId: testTriggerId,
        subscriberAddress: subscriberWallet.address as Address,
        callbackEndpoint: 'https://myapp.com/callback',
        callbackAuth: {
          type: 'bearer',
          value: 'my-secret-token',
        },
        payment: {
          mode: 'free',
          pricePerExecution: 0n,
        },
      });

      expect(subscription.callbackAuth?.type).toBe('bearer');
    });

    test('lists subscriptions for a trigger', async () => {
      await integration.subscribe({
        triggerId: testTriggerId,
        subscriberAddress: executorWallet.address as Address,
        callbackEndpoint: 'https://app1.com/callback',
        payment: { mode: 'free', pricePerExecution: 0n },
      });

      await integration.subscribe({
        triggerId: testTriggerId,
        subscriberAddress: subscriberWallet.address as Address,
        callbackEndpoint: 'https://app2.com/callback',
        payment: { mode: 'free', pricePerExecution: 0n },
      });

      const subs = integration.getSubscriptions(testTriggerId);
      expect(subs.length).toBeGreaterThanOrEqual(2);
    });

    test('unsubscribes from a trigger', async () => {
      const subscription = await integration.subscribe({
        triggerId: testTriggerId,
        subscriberAddress: subscriberWallet.address as Address,
        callbackEndpoint: 'https://myapp.com/callback',
        payment: { mode: 'free', pricePerExecution: 0n },
      });

      await integration.unsubscribe(subscription.id);

      const subs = integration.getSubscriptions(testTriggerId);
      const found = subs.find((s) => s.id === subscription.id);
      expect(found).toBeUndefined();
    });
  });

  describe('Cron Expression Matching', () => {
    test('matches every-minute expression', () => {
      expect(shouldExecuteCron('* * * * *')).toBe(true);
    });

    test('matches specific minute', () => {
      const now = new Date();
      const currentMinute = now.getMinutes();
      expect(shouldExecuteCron(`${currentMinute} * * * *`)).toBe(true);
      expect(shouldExecuteCron(`${(currentMinute + 1) % 60} * * * *`)).toBe(false);
    });

    test('matches step expressions', () => {
      const now = new Date();
      const currentMinute = now.getMinutes();

      if (currentMinute % 5 === 0) {
        expect(shouldExecuteCron('*/5 * * * *')).toBe(true);
      } else {
        expect(shouldExecuteCron('*/5 * * * *')).toBe(false);
      }
    });

    test('matches range expressions', () => {
      const now = new Date();
      const currentHour = now.getHours();

      if (currentHour >= 9 && currentHour <= 17) {
        expect(shouldExecuteCron('* 9-17 * * *')).toBe(true);
      } else {
        expect(shouldExecuteCron('* 9-17 * * *')).toBe(false);
      }
    });

    test('matches comma-separated values', () => {
      const now = new Date();
      const currentMinute = now.getMinutes();

      const minuteList = '0,15,30,45';
      if ([0, 15, 30, 45].includes(currentMinute)) {
        expect(shouldExecuteCron(`${minuteList} * * * *`)).toBe(true);
      } else {
        expect(shouldExecuteCron(`${minuteList} * * * *`)).toBe(false);
      }
    });

    test('rejects invalid expressions', () => {
      expect(shouldExecuteCron('* * *')).toBe(false);
      expect(shouldExecuteCron('* * * * * *')).toBe(false);
      expect(shouldExecuteCron('')).toBe(false);
    });
  });

  describe('Execution History', () => {
    test('records execution history', async () => {
      const httpTarget: HttpTarget = {
        type: 'http',
        endpoint: 'http://localhost:8080/trigger',
        method: 'POST',
        timeout: 30,
      };

      const triggerId = await integration.registerTrigger({
        source: 'local',
        type: 'event',
        name: 'history-test-trigger',
        target: httpTarget,
        eventTypes: ['test.event'],
        active: true,
      });

      try {
        await integration.executeTrigger({ triggerId });
      } catch {
        // Expected to fail
      }

      const history = integration.getExecutionHistory(triggerId);
      expect(history.length).toBeGreaterThan(0);
    });

    test('limits execution history', () => {
      const history = integration.getExecutionHistory(undefined, 10);
      expect(history.length).toBeLessThanOrEqual(10);
    });
  });
});

// ============================================================================
// X402 Payment Parsing Tests
// ============================================================================

import { parseX402PaymentHeader } from '../sdk/x402';

describe('X402 Payment Parsing', () => {
  test('parses valid x402 payment header', () => {
    const header = 'scheme=exact;network=jeju;payload=0x1234567890abcdef;asset=0x0000000000000000000000000000000000000000;amount=1000000';
    const parsed = parseX402PaymentHeader(header);

    expect(parsed).not.toBeNull();
    expect(parsed!.scheme).toBe('exact');
    expect(parsed!.network).toBe('jeju');
    expect(parsed!.payload).toBe('0x1234567890abcdef');
    expect(parsed!.amount).toBe('1000000');
  });

  test('returns null for missing required fields', () => {
    // scheme, network, and payload are required
    expect(parseX402PaymentHeader('network=jeju;payload=0x123;amount=1000')).toBeNull(); // missing scheme
    expect(parseX402PaymentHeader('scheme=exact;network=jeju;amount=1000')).toBeNull(); // missing payload
    expect(parseX402PaymentHeader('scheme=exact;payload=0x123;amount=1000')).toBeNull(); // missing network
  });

  test('amount defaults to 0 when not provided', () => {
    const parsed = parseX402PaymentHeader('scheme=exact;network=jeju;payload=0x123');
    expect(parsed).not.toBeNull();
    expect(parsed!.amount).toBe('0');
  });

  test('handles whitespace in header', () => {
    const header = 'scheme = exact ; network = jeju ; payload = 0x123 ; amount = 1000';
    const parsed = parseX402PaymentHeader(header);

    expect(parsed).not.toBeNull();
    expect(parsed!.scheme).toBe('exact');
  });

  test('provides default asset address when missing', () => {
    const header = 'scheme=exact;network=jeju;payload=0x123;amount=1000';
    const parsed = parseX402PaymentHeader(header);

    expect(parsed).not.toBeNull();
    expect(parsed!.asset).toBe('0x0000000000000000000000000000000000000000');
  });
});

// ============================================================================
// Target Type Tests
// ============================================================================

describe('Target Type Configuration', () => {
  test('HTTP target has required fields', () => {
    const target: HttpTarget = {
      type: 'http',
      endpoint: 'https://api.example.com/webhook',
      method: 'POST',
      timeout: 30,
      headers: { 'X-Custom-Header': 'value' },
      payload: { key: 'value' },
    };

    expect(target.type).toBe('http');
    expect(target.endpoint).toBeDefined();
    expect(target.method).toBeDefined();
    expect(target.timeout).toBeGreaterThan(0);
  });

  test('Contract target has required fields', () => {
    const target: ContractTarget = {
      type: 'contract',
      address: '0x1234567890123456789012345678901234567890' as Address,
      functionName: 'execute',
      abi: 'function execute(uint256 value) external returns (bool)',
      args: [100n],
      value: 0n,
      gasLimit: 100000n,
    };

    expect(target.type).toBe('contract');
    expect(target.address).toBeDefined();
    expect(target.functionName).toBeDefined();
    expect(target.abi).toBeDefined();
  });

  test('Contract target supports templated args', () => {
    const target: ContractTarget = {
      type: 'contract',
      address: '0x1234567890123456789012345678901234567890' as Address,
      functionName: 'transfer',
      abi: 'function transfer(address to, uint256 amount)',
      args: ['{{recipient}}', '{{amount}}'],
    };

    expect(target.args).toContain('{{recipient}}');
    expect(target.args).toContain('{{amount}}');
  });
});

// ============================================================================
// ABI Compatibility Tests
// ============================================================================

describe('TriggerRegistry ABI Compatibility', () => {
  const TRIGGER_REGISTRY_ABI = [
    'function getTrigger(bytes32 triggerId) view returns (address owner, uint8 triggerType, string name, string endpoint, bool active, uint256 executionCount, uint256 lastExecutedAt)',
    'function getCronTriggers() view returns (bytes32[] triggerIds, string[] cronExpressions, string[] endpoints)',
    'function recordExecution(bytes32 triggerId, bool success, bytes32 outputHash) returns (bytes32)',
    'function registerTrigger(string name, string description, uint8 triggerType, string cronExpression, string webhookPath, string[] eventTypes, string endpoint, string method, uint256 timeout, uint8 paymentMode, uint256 pricePerExecution) returns (bytes32)',
  ];

  test('ABI parses without errors', () => {
    const iface = new Interface(TRIGGER_REGISTRY_ABI);
    expect(iface).toBeDefined();
  });

  test('getTrigger has correct return values', () => {
    const iface = new Interface(TRIGGER_REGISTRY_ABI);
    const func = iface.getFunction('getTrigger');
    
    expect(func).not.toBeNull();
    expect(func!.outputs?.length).toBe(7);
  });

  test('getCronTriggers returns three arrays', () => {
    const iface = new Interface(TRIGGER_REGISTRY_ABI);
    const func = iface.getFunction('getCronTriggers');
    
    expect(func).not.toBeNull();
    expect(func!.outputs?.length).toBe(3);
  });

  test('registerTrigger has correct parameter count', () => {
    const iface = new Interface(TRIGGER_REGISTRY_ABI);
    const func = iface.getFunction('registerTrigger');
    
    expect(func).not.toBeNull();
    expect(func!.inputs?.length).toBe(11);
  });
});
