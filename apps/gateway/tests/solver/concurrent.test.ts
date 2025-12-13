/**
 * Concurrent/Async Behavior Tests for OIF Solver
 * Tests race conditions, parallel execution, and async edge cases
 */

import { describe, test, expect, beforeEach } from 'bun:test';

describe('Concurrent Intent Processing', () => {
  // Simulates the solver's pending map behavior
  class IntentTracker {
    private pending = new Map<string, Promise<void>>();
    private results: string[] = [];

    async processIntent(orderId: string, delayMs: number): Promise<void> {
      // Check if already processing
      if (this.pending.has(orderId)) {
        return this.pending.get(orderId);
      }

      const promise = (async () => {
        await new Promise(r => setTimeout(r, delayMs));
        this.results.push(orderId);
      })();

      this.pending.set(orderId, promise);
      
      try {
        await promise;
      } finally {
        this.pending.delete(orderId);
      }
    }

    getResults(): string[] {
      return this.results;
    }

    getPendingCount(): number {
      return this.pending.size;
    }
  }

  test('should not process same order twice concurrently', async () => {
    const tracker = new IntentTracker();
    
    // Fire two requests for same order simultaneously
    await Promise.all([
      tracker.processIntent('order1', 10),
      tracker.processIntent('order1', 10),
    ]);
    
    // Should only have processed once
    expect(tracker.getResults()).toEqual(['order1']);
  });

  test('should process different orders concurrently', async () => {
    const tracker = new IntentTracker();
    
    await Promise.all([
      tracker.processIntent('order1', 10),
      tracker.processIntent('order2', 10),
      tracker.processIntent('order3', 10),
    ]);
    
    expect(tracker.getResults().sort()).toEqual(['order1', 'order2', 'order3']);
  });

  test('should clear pending after completion', async () => {
    const tracker = new IntentTracker();
    
    expect(tracker.getPendingCount()).toBe(0);
    
    const promise = tracker.processIntent('order1', 5);
    // Immediately after starting, should be pending
    expect(tracker.getPendingCount()).toBe(1);
    
    await promise;
    expect(tracker.getPendingCount()).toBe(0);
  });

  test('should handle high concurrency without data loss', async () => {
    const tracker = new IntentTracker();
    const orderCount = 100;
    const orders = Array.from({ length: orderCount }, (_, i) => `order${i}`);
    
    await Promise.all(orders.map(id => tracker.processIntent(id, 1)));
    
    expect(tracker.getResults().length).toBe(orderCount);
  });
});

describe('Settlement Retry Logic', () => {
  interface PendingSettlement {
    orderId: string;
    retries: number;
    lastAttempt: number;
  }

  class SettlementManager {
    private pending = new Map<string, PendingSettlement>();
    private maxRetries = 48;
    private results: Array<{ orderId: string; success: boolean }> = [];

    addSettlement(orderId: string): void {
      this.pending.set(orderId, {
        orderId,
        retries: 0,
        lastAttempt: Date.now(),
      });
    }

    async trySettle(orderId: string, shouldSucceed: boolean): Promise<boolean> {
      const settlement = this.pending.get(orderId);
      if (!settlement) return false;

      settlement.retries++;
      settlement.lastAttempt = Date.now();

      if (shouldSucceed) {
        this.results.push({ orderId, success: true });
        this.pending.delete(orderId);
        return true;
      }

      if (settlement.retries >= this.maxRetries) {
        this.results.push({ orderId, success: false });
        this.pending.delete(orderId);
      }

      return false;
    }

    getPending(): PendingSettlement[] {
      return Array.from(this.pending.values());
    }

    getResults() {
      return this.results;
    }
  }

  test('should track retry count correctly', async () => {
    const manager = new SettlementManager();
    manager.addSettlement('order1');
    
    // Fail 3 times
    await manager.trySettle('order1', false);
    await manager.trySettle('order1', false);
    await manager.trySettle('order1', false);
    
    const pending = manager.getPending();
    expect(pending[0].retries).toBe(3);
  });

  test('should remove after max retries', async () => {
    const manager = new SettlementManager();
    manager['maxRetries'] = 3; // Override for test
    manager.addSettlement('order1');
    
    await manager.trySettle('order1', false);
    await manager.trySettle('order1', false);
    await manager.trySettle('order1', false);
    
    expect(manager.getPending().length).toBe(0);
    expect(manager.getResults()).toEqual([{ orderId: 'order1', success: false }]);
  });

  test('should remove on success', async () => {
    const manager = new SettlementManager();
    manager.addSettlement('order1');
    
    await manager.trySettle('order1', true);
    
    expect(manager.getPending().length).toBe(0);
    expect(manager.getResults()).toEqual([{ orderId: 'order1', success: true }]);
  });

  test('should handle multiple settlements independently', async () => {
    const manager = new SettlementManager();
    manager.addSettlement('order1');
    manager.addSettlement('order2');
    manager.addSettlement('order3');
    
    await manager.trySettle('order1', true);  // Success
    await manager.trySettle('order2', false); // Fail once
    await manager.trySettle('order3', true);  // Success
    
    expect(manager.getPending().length).toBe(1);
    expect(manager.getPending()[0].orderId).toBe('order2');
  });
});

describe('Async Event Handling', () => {
  class EventQueue {
    private queue: Array<{ event: string; timestamp: number }> = [];
    private processing = false;
    private processed: string[] = [];

    async enqueue(event: string): Promise<void> {
      this.queue.push({ event, timestamp: Date.now() });
      if (!this.processing) {
        await this.processQueue();
      }
    }

    private async processQueue(): Promise<void> {
      this.processing = true;
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        await this.processEvent(item.event);
      }
      this.processing = false;
    }

    private async processEvent(event: string): Promise<void> {
      await new Promise(r => setTimeout(r, 1));
      this.processed.push(event);
    }

    getProcessed(): string[] {
      return this.processed;
    }
  }

  test('should process events in order', async () => {
    const queue = new EventQueue();
    
    await Promise.all([
      queue.enqueue('event1'),
      queue.enqueue('event2'),
      queue.enqueue('event3'),
    ]);
    
    // Events should be processed in arrival order
    expect(queue.getProcessed()).toEqual(['event1', 'event2', 'event3']);
  });

  test('should handle rapid event bursts', async () => {
    const queue = new EventQueue();
    const eventCount = 50;
    
    const promises = Array.from({ length: eventCount }, (_, i) => 
      queue.enqueue(`event${i}`)
    );
    
    await Promise.all(promises);
    
    expect(queue.getProcessed().length).toBe(eventCount);
  });
});

describe('Rate Limiting', () => {
  class RateLimiter {
    private timestamps: number[] = [];
    private windowMs: number;
    private maxRequests: number;

    constructor(windowMs: number, maxRequests: number) {
      this.windowMs = windowMs;
      this.maxRequests = maxRequests;
    }

    canProceed(): boolean {
      const now = Date.now();
      // Remove expired timestamps
      this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
      
      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return true;
      }
      return false;
    }

    getRemaining(): number {
      const now = Date.now();
      this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
      return Math.max(0, this.maxRequests - this.timestamps.length);
    }
  }

  test('should allow requests within limit', () => {
    const limiter = new RateLimiter(1000, 5);
    
    for (let i = 0; i < 5; i++) {
      expect(limiter.canProceed()).toBe(true);
    }
  });

  test('should block requests over limit', () => {
    const limiter = new RateLimiter(1000, 3);
    
    expect(limiter.canProceed()).toBe(true);
    expect(limiter.canProceed()).toBe(true);
    expect(limiter.canProceed()).toBe(true);
    expect(limiter.canProceed()).toBe(false);
  });

  test('should show correct remaining count', () => {
    const limiter = new RateLimiter(1000, 5);
    
    expect(limiter.getRemaining()).toBe(5);
    limiter.canProceed();
    expect(limiter.getRemaining()).toBe(4);
    limiter.canProceed();
    expect(limiter.getRemaining()).toBe(3);
  });

  test('should reset after window expires', async () => {
    const limiter = new RateLimiter(50, 2); // 50ms window
    
    limiter.canProceed();
    limiter.canProceed();
    expect(limiter.canProceed()).toBe(false);
    
    await new Promise(r => setTimeout(r, 60));
    
    expect(limiter.canProceed()).toBe(true);
  });
});

describe('Timeout Handling', () => {
  async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), ms);
    });
    return Promise.race([promise, timeout]);
  }

  test('should complete before timeout', async () => {
    const fast = new Promise<string>(r => setTimeout(() => r('done'), 10));
    const result = await withTimeout(fast, 100);
    expect(result).toBe('done');
  });

  test('should throw on timeout', async () => {
    const slow = new Promise<string>(r => setTimeout(() => r('done'), 200));
    await expect(withTimeout(slow, 50)).rejects.toThrow('Timeout');
  });

  test('should handle immediate resolution', async () => {
    const immediate = Promise.resolve('instant');
    const result = await withTimeout(immediate, 100);
    expect(result).toBe('instant');
  });
});

describe('Error Propagation', () => {
  class SafeExecutor {
    private errors: Error[] = [];

    async execute<T>(fn: () => Promise<T>): Promise<T | null> {
      try {
        return await fn();
      } catch (e) {
        this.errors.push(e as Error);
        return null;
      }
    }

    getErrors(): Error[] {
      return this.errors;
    }
  }

  test('should capture errors without crashing', async () => {
    const executor = new SafeExecutor();
    
    const result = await executor.execute(async () => {
      throw new Error('Test error');
    });
    
    expect(result).toBeNull();
    expect(executor.getErrors().length).toBe(1);
    expect(executor.getErrors()[0].message).toBe('Test error');
  });

  test('should pass through successful results', async () => {
    const executor = new SafeExecutor();
    
    const result = await executor.execute(async () => 'success');
    
    expect(result).toBe('success');
    expect(executor.getErrors().length).toBe(0);
  });

  test('should handle multiple operations', async () => {
    const executor = new SafeExecutor();
    
    await executor.execute(async () => 'success1');
    await executor.execute(async () => { throw new Error('fail'); });
    await executor.execute(async () => 'success2');
    await executor.execute(async () => { throw new Error('fail2'); });
    
    expect(executor.getErrors().length).toBe(2);
  });
});
