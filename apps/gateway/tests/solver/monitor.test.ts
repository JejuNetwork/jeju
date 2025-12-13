/**
 * Tests for solver/monitor.ts
 * Tests event parsing, validation, and edge cases
 */

import { describe, test, expect } from 'bun:test';
import { EventMonitor, type IntentEvent } from '../../src/solver/monitor';
import { bytes32ToAddress } from '../../src/solver/contracts';

// Create monitor instance for testing
const createMonitor = () => new EventMonitor({ chains: [] });

// Helper to create mock log data
function createMockLog(overrides: Partial<{
  orderId: `0x${string}`;
  user: `0x${string}`;
  maxSpent: Array<{ token: `0x${string}`; amount: bigint; recipient: `0x${string}`; chainId: bigint }>;
  minReceived: Array<{ token: `0x${string}`; amount: bigint; recipient: `0x${string}`; chainId: bigint }>;
  fillDeadline: number;
}> = {}) {
  const defaultSpent = {
    token: '0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as `0x${string}`,
    amount: 1000000n,
    recipient: '0x' + '00'.repeat(32) as `0x${string}`,
    chainId: 11155111n,
  };
  
  const defaultReceived = {
    token: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
    amount: 900000000000000n,
    recipient: '0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266' as `0x${string}`,
    chainId: 84532n,
  };

  return {
    args: {
      orderId: overrides.orderId ?? ('0x' + 'ab'.repeat(32) as `0x${string}`),
      order: {
        user: overrides.user ?? ('0x' + 'cc'.repeat(20) as `0x${string}`),
        maxSpent: overrides.maxSpent ?? [defaultSpent],
        minReceived: overrides.minReceived ?? [defaultReceived],
        fillDeadline: overrides.fillDeadline ?? 1700000000,
      },
    },
    blockNumber: 12345678n,
    transactionHash: ('0x' + 'dd'.repeat(32)) as `0x${string}`,
  };
}

describe('EventMonitor Construction', () => {
  test('should create monitor with empty chains', () => {
    const monitor = new EventMonitor({ chains: [] });
    expect(monitor).toBeDefined();
    expect(monitor.isRunning()).toBe(false);
  });

  test('should create monitor with chain config', () => {
    const monitor = new EventMonitor({
      chains: [
        { chainId: 11155111, name: 'Sepolia' },
        { chainId: 84532, name: 'Base Sepolia' },
      ],
    });
    expect(monitor).toBeDefined();
  });
});

describe('Event Parsing - Valid Events', () => {
  test('should parse valid cross-chain intent event', () => {
    const monitor = createMonitor();
    const log = createMockLog();
    
    // Access private method via prototype for testing
    const parseEvent = (monitor as unknown as { parseEvent: (chainId: number, log: unknown) => IntentEvent | null }).parseEvent.bind(monitor);
    const result = parseEvent(11155111, log);
    
    expect(result).not.toBeNull();
    expect(result!.orderId).toBe('0x' + 'ab'.repeat(32));
    expect(result!.sourceChain).toBe(11155111);
    expect(result!.destinationChain).toBe(84532);
    expect(result!.inputAmount).toBe('1000000');
    expect(result!.outputAmount).toBe('900000000000000');
    expect(result!.blockNumber).toBe(12345678n);
  });

  test('should convert bytes32 tokens to addresses', () => {
    const monitor = createMonitor();
    const log = createMockLog();
    const parseEvent = (monitor as unknown as { parseEvent: (chainId: number, log: unknown) => IntentEvent | null }).parseEvent.bind(monitor);
    const result = parseEvent(11155111, log);
    
    // Should extract last 20 bytes (40 hex chars) from bytes32
    expect(result!.inputToken).toMatch(/^0x[a-f0-9]{40}$/);
    expect(result!.outputToken).toMatch(/^0x[a-f0-9]{40}$/);
    expect(result!.recipient).toMatch(/^0x[a-f0-9]{40}$/);
  });

  test('should handle native token (zero address) correctly', () => {
    const monitor = createMonitor();
    const log = createMockLog({
      maxSpent: [{
        token: '0x' + '00'.repeat(32) as `0x${string}`,
        amount: 1000000000000000000n,
        recipient: '0x' + '00'.repeat(32) as `0x${string}`,
        chainId: 11155111n,
      }],
    });
    
    const parseEvent = (monitor as unknown as { parseEvent: (chainId: number, log: unknown) => IntentEvent | null }).parseEvent.bind(monitor);
    const result = parseEvent(11155111, log);
    
    expect(result!.inputToken).toBe('0x0000000000000000000000000000000000000000');
  });
});

describe('Event Parsing - Invalid Events', () => {
  test('should reject event without orderId', () => {
    const monitor = createMonitor();
    const log = createMockLog();
    // @ts-expect-error - testing invalid data
    delete log.args.orderId;
    
    const parseEvent = (monitor as unknown as { parseEvent: (chainId: number, log: unknown) => IntentEvent | null }).parseEvent.bind(monitor);
    const result = parseEvent(11155111, log);
    
    expect(result).toBeNull();
  });

  test('should reject event without order struct', () => {
    const monitor = createMonitor();
    const log = createMockLog();
    // @ts-expect-error - testing invalid data
    delete log.args.order;
    
    const parseEvent = (monitor as unknown as { parseEvent: (chainId: number, log: unknown) => IntentEvent | null }).parseEvent.bind(monitor);
    const result = parseEvent(11155111, log);
    
    expect(result).toBeNull();
  });

  test('should reject event with empty maxSpent', () => {
    const monitor = createMonitor();
    const log = createMockLog({ maxSpent: [] });
    
    const parseEvent = (monitor as unknown as { parseEvent: (chainId: number, log: unknown) => IntentEvent | null }).parseEvent.bind(monitor);
    const result = parseEvent(11155111, log);
    
    expect(result).toBeNull();
  });

  test('should reject event with empty minReceived', () => {
    const monitor = createMonitor();
    const log = createMockLog({ minReceived: [] });
    
    const parseEvent = (monitor as unknown as { parseEvent: (chainId: number, log: unknown) => IntentEvent | null }).parseEvent.bind(monitor);
    const result = parseEvent(11155111, log);
    
    expect(result).toBeNull();
  });

  test('should reject event with zero input amount', () => {
    const monitor = createMonitor();
    const log = createMockLog({
      maxSpent: [{
        token: '0x' + '11'.repeat(32) as `0x${string}`,
        amount: 0n,
        recipient: '0x' + '00'.repeat(32) as `0x${string}`,
        chainId: 11155111n,
      }],
    });
    
    const parseEvent = (monitor as unknown as { parseEvent: (chainId: number, log: unknown) => IntentEvent | null }).parseEvent.bind(monitor);
    const result = parseEvent(11155111, log);
    
    expect(result).toBeNull();
  });

  test('should reject event with zero output amount', () => {
    const monitor = createMonitor();
    const log = createMockLog({
      minReceived: [{
        token: '0x' + '00'.repeat(32) as `0x${string}`,
        amount: 0n,
        recipient: '0x' + '22'.repeat(32) as `0x${string}`,
        chainId: 84532n,
      }],
    });
    
    const parseEvent = (monitor as unknown as { parseEvent: (chainId: number, log: unknown) => IntentEvent | null }).parseEvent.bind(monitor);
    const result = parseEvent(11155111, log);
    
    expect(result).toBeNull();
  });

  test('should reject event with negative amount', () => {
    const monitor = createMonitor();
    const log = createMockLog({
      maxSpent: [{
        token: '0x' + '11'.repeat(32) as `0x${string}`,
        amount: -1n,
        recipient: '0x' + '00'.repeat(32) as `0x${string}`,
        chainId: 11155111n,
      }],
    });
    
    const parseEvent = (monitor as unknown as { parseEvent: (chainId: number, log: unknown) => IntentEvent | null }).parseEvent.bind(monitor);
    const result = parseEvent(11155111, log);
    
    expect(result).toBeNull();
  });
});

describe('Event Parsing - Edge Cases', () => {
  test('should handle very large amounts (max uint256)', () => {
    const monitor = createMonitor();
    const maxUint256 = 2n ** 256n - 1n;
    const log = createMockLog({
      maxSpent: [{
        token: '0x' + '11'.repeat(32) as `0x${string}`,
        amount: maxUint256,
        recipient: '0x' + '00'.repeat(32) as `0x${string}`,
        chainId: 11155111n,
      }],
    });
    
    const parseEvent = (monitor as unknown as { parseEvent: (chainId: number, log: unknown) => IntentEvent | null }).parseEvent.bind(monitor);
    const result = parseEvent(11155111, log);
    
    expect(result).not.toBeNull();
    expect(result!.inputAmount).toBe(maxUint256.toString());
  });

  test('should handle missing fillDeadline', () => {
    const monitor = createMonitor();
    const log = createMockLog();
    // Manually remove fillDeadline to test default behavior
    delete (log.args.order as Record<string, unknown>).fillDeadline;
    
    const parseEvent = (monitor as unknown as { parseEvent: (chainId: number, log: unknown) => IntentEvent | null }).parseEvent.bind(monitor);
    const result = parseEvent(11155111, log);
    
    expect(result).not.toBeNull();
    expect(result!.deadline).toBe(0);
  });

  test('should handle missing user address', () => {
    const monitor = createMonitor();
    const log = createMockLog();
    // Manually remove user to test default behavior
    delete (log.args.order as Record<string, unknown>).user;
    
    const parseEvent = (monitor as unknown as { parseEvent: (chainId: number, log: unknown) => IntentEvent | null }).parseEvent.bind(monitor);
    const result = parseEvent(11155111, log);
    
    expect(result).not.toBeNull();
    expect(result!.user).toBe('0x');
  });

  test('should preserve transactionHash from log', () => {
    const monitor = createMonitor();
    const log = createMockLog();
    
    const parseEvent = (monitor as unknown as { parseEvent: (chainId: number, log: unknown) => IntentEvent | null }).parseEvent.bind(monitor);
    const result = parseEvent(11155111, log);
    
    expect(result!.transactionHash).toBe('0x' + 'dd'.repeat(32));
  });

  test('should handle chainId 0 in minReceived', () => {
    const monitor = createMonitor();
    const log = createMockLog({
      minReceived: [{
        token: '0x' + '00'.repeat(32) as `0x${string}`,
        amount: 1000n,
        recipient: '0x' + '22'.repeat(32) as `0x${string}`,
        chainId: 0n,
      }],
    });
    
    const parseEvent = (monitor as unknown as { parseEvent: (chainId: number, log: unknown) => IntentEvent | null }).parseEvent.bind(monitor);
    const result = parseEvent(11155111, log);
    
    expect(result!.destinationChain).toBe(0);
  });
});

describe('Monitor Lifecycle', () => {
  test('should start and stop cleanly', async () => {
    const monitor = new EventMonitor({ chains: [] });
    
    expect(monitor.isRunning()).toBe(false);
    
    // Start with empty clients - should not throw
    await monitor.start(new Map());
    expect(monitor.isRunning()).toBe(true);
    
    await monitor.stop();
    expect(monitor.isRunning()).toBe(false);
  });

  test('should emit events via EventEmitter', () => {
    const monitor = createMonitor();
    
    let receivedEvent: IntentEvent | null = null;
    monitor.on('intent', (e: IntentEvent) => {
      receivedEvent = e;
    });
    
    // Manually emit for testing
    const testEvent: IntentEvent = {
      orderId: '0x' + 'ab'.repeat(32),
      user: '0x' + 'cc'.repeat(20),
      sourceChain: 11155111,
      destinationChain: 84532,
      inputToken: '0x' + 'aa'.repeat(20),
      inputAmount: '1000000',
      outputToken: '0x' + '00'.repeat(20),
      outputAmount: '900000',
      recipient: '0x' + 'ff'.repeat(20),
      deadline: 1700000000,
      blockNumber: 12345n,
      transactionHash: '0x' + 'dd'.repeat(32),
    };
    
    monitor.emit('intent', testEvent);
    
    expect(receivedEvent).not.toBeNull();
    expect(receivedEvent!.orderId).toBe(testEvent.orderId);
  });

  test('should handle multiple event listeners', () => {
    const monitor = createMonitor();
    const received: number[] = [];
    
    monitor.on('intent', () => received.push(1));
    monitor.on('intent', () => received.push(2));
    monitor.on('intent', () => received.push(3));
    
    monitor.emit('intent', {} as IntentEvent);
    
    expect(received).toEqual([1, 2, 3]);
  });
});

