/**
 * LockManager Tests - Edge cases, concurrency, error handling
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { LockManager, withTestLock } from './lock-manager';
import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'bun';

const TEST_LOCK_DIR = '/tmp/jeju-test-locks';
const TEST_LOCK_FILE = 'test.lock';

// Helper to get a fresh lock manager for each test
function createTestLock(options: { ttlMs?: number; force?: boolean } = {}) {
  return new LockManager({
    lockDir: TEST_LOCK_DIR,
    ...options,
  });
}

// Ensure test directory exists
beforeEach(() => {
  const { mkdirSync } = require('fs');
  try {
    mkdirSync(TEST_LOCK_DIR, { recursive: true });
  } catch {}
});

// Cleanup after tests
afterEach(() => {
  const lockPath = join(TEST_LOCK_DIR, '.jeju', '.jeju-e2e-test.lock');
  if (existsSync(lockPath)) {
    try { unlinkSync(lockPath); } catch {}
  }
});

describe('LockManager - Basic Operations', () => {
  test('should acquire lock when none exists', () => {
    const lock = createTestLock();
    const result = lock.acquireLock();

    expect(result.acquired).toBe(true);
    expect(result.message).toBeUndefined();
    expect(existsSync(lock.getLockPath())).toBe(true);

    lock.releaseLock();
  });

  test('should release lock and delete file', () => {
    const lock = createTestLock();
    lock.acquireLock();

    const released = lock.releaseLock();

    expect(released).toBe(true);
    expect(existsSync(lock.getLockPath())).toBe(false);
  });

  test('should report not locked when no lock file', () => {
    const lock = createTestLock();
    const status = lock.isLocked();

    expect(status.locked).toBe(false);
    expect(status.metadata).toBeUndefined();
    expect(status.stale).toBeUndefined();
  });

  test('should not release lock if not owner', () => {
    const lock1 = createTestLock();
    const lock2 = createTestLock();

    lock1.acquireLock();

    // lock2 didn't acquire, so it shouldn't be able to release
    const released = lock2.releaseLock();

    expect(released).toBe(false);
    expect(existsSync(lock1.getLockPath())).toBe(true);

    lock1.releaseLock();
  });
});

describe('LockManager - Lock Conflict Handling', () => {
  test('should block acquisition when lock exists from another process', () => {
    const lock1 = createTestLock();
    const lock2 = createTestLock();

    lock1.acquireLock();
    const result = lock2.acquireLock();

    expect(result.acquired).toBe(false);
    expect(result.blockedBy).toBeDefined();
    expect(result.blockedBy?.pid).toBe(process.pid);
    expect(result.message).toContain('already running');

    lock1.releaseLock();
  });

  test('should include correct metadata in blocked response', () => {
    const lock1 = createTestLock();
    lock1.acquireLock();

    const lock2 = createTestLock();
    const result = lock2.acquireLock();

    expect(result.blockedBy?.hostname).toBeDefined();
    expect(result.blockedBy?.timestamp).toBeLessThanOrEqual(Date.now());
    expect(result.blockedBy?.command).toContain('bun');

    lock1.releaseLock();
  });

  test('should allow force override of existing lock', () => {
    const lock1 = createTestLock();
    lock1.acquireLock();

    const lock2 = createTestLock({ force: true });
    const result = lock2.acquireLock();

    expect(result.acquired).toBe(true);

    lock2.releaseLock();
  });
});

describe('LockManager - Stale Lock Detection', () => {
  test('should detect stale lock based on TTL', () => {
    const lock = createTestLock({ ttlMs: 100 }); // Very short TTL

    // Write a lock file with old timestamp
    const lockPath = lock.getLockPath();
    const staleMetadata = {
      pid: process.pid,
      timestamp: Date.now() - 1000, // 1 second ago, exceeds 100ms TTL
      hostname: 'test',
      command: 'test',
    };
    writeFileSync(lockPath, JSON.stringify(staleMetadata));

    const status = lock.isLocked();

    expect(status.locked).toBe(true);
    expect(status.stale).toBe(true);
  });

  test('should auto-cleanup stale lock on acquire', () => {
    const lock = createTestLock({ ttlMs: 100 });

    // Create stale lock
    const lockPath = lock.getLockPath();
    writeFileSync(lockPath, JSON.stringify({
      pid: 999999, // Non-existent PID
      timestamp: Date.now() - 1000,
      hostname: 'old-host',
      command: 'old-command',
    }));

    // Should acquire successfully after cleaning stale lock
    const result = lock.acquireLock();

    expect(result.acquired).toBe(true);

    // Verify new lock has current PID
    const newMetadata = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(newMetadata.pid).toBe(process.pid);

    lock.releaseLock();
  });

  test('should detect stale lock from dead process', () => {
    const lock = createTestLock({ ttlMs: 60000 }); // Long TTL

    // Write lock with non-existent PID
    const lockPath = lock.getLockPath();
    writeFileSync(lockPath, JSON.stringify({
      pid: 999999999, // Very unlikely to exist
      timestamp: Date.now(), // Recent timestamp
      hostname: 'test',
      command: 'test',
    }));

    const status = lock.isLocked();

    expect(status.locked).toBe(true);
    expect(status.stale).toBe(true);
  });
});

describe('LockManager - Edge Cases', () => {
  test('should handle malformed lock file gracefully', () => {
    const lock = createTestLock();
    const lockPath = lock.getLockPath();

    // Write invalid JSON
    writeFileSync(lockPath, 'not valid json {{{');

    // Should throw when trying to read
    expect(() => lock.isLocked()).toThrow();

    unlinkSync(lockPath);
  });

  test('should handle empty lock file', () => {
    const lock = createTestLock();
    const lockPath = lock.getLockPath();

    writeFileSync(lockPath, '');

    expect(() => lock.isLocked()).toThrow();

    unlinkSync(lockPath);
  });

  test('should handle missing fields in lock metadata', () => {
    const lock = createTestLock();
    const lockPath = lock.getLockPath();

    // Partial metadata
    writeFileSync(lockPath, JSON.stringify({ pid: 12345 }));

    // Should still work (may throw on missing timestamp)
    const status = lock.isLocked();
    expect(status.locked).toBe(true);

    unlinkSync(lockPath);
  });

  test('should return false when releasing non-owned lock', () => {
    const lock = createTestLock();

    // Never acquired, should return false
    const released = lock.releaseLock();

    expect(released).toBe(false);
  });

  test('should handle forceReleaseLock when no lock exists', () => {
    const lock = createTestLock();

    // Should not throw
    expect(() => lock.forceReleaseLock()).not.toThrow();
  });

  test('should double release safely', () => {
    const lock = createTestLock();
    lock.acquireLock();

    const first = lock.releaseLock();
    const second = lock.releaseLock();

    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});

describe('withTestLock - Wrapper Function', () => {
  test('should execute function with lock protection', async () => {
    let executed = false;

    await withTestLock(async () => {
      executed = true;
      return 'result';
    }, { lockDir: TEST_LOCK_DIR });

    expect(executed).toBe(true);
  });

  test('should return function result', async () => {
    const result = await withTestLock(async () => {
      return { value: 42 };
    }, { lockDir: TEST_LOCK_DIR });

    expect(result.value).toBe(42);
  });

  test('should release lock after function completes', async () => {
    const lockPath = join(TEST_LOCK_DIR, '.jeju', '.jeju-e2e-test.lock');

    await withTestLock(async () => {
      expect(existsSync(lockPath)).toBe(true);
    }, { lockDir: TEST_LOCK_DIR });

    expect(existsSync(lockPath)).toBe(false);
  });

  test('should release lock on function error', async () => {
    const lockPath = join(TEST_LOCK_DIR, '.jeju', '.jeju-e2e-test.lock');

    try {
      await withTestLock(async () => {
        throw new Error('Test error');
      }, { lockDir: TEST_LOCK_DIR });
    } catch (e) {
      // Expected
    }

    expect(existsSync(lockPath)).toBe(false);
  });

  test('should throw when lock not acquired', async () => {
    const blocker = createTestLock();
    blocker.acquireLock();

    await expect(
      withTestLock(async () => 'should not run', { lockDir: TEST_LOCK_DIR })
    ).rejects.toThrow(/Lock not acquired|already running/);

    blocker.releaseLock();
  });
});

describe('LockManager - Concurrent Access', () => {
  test('should handle rapid acquire/release cycles', async () => {
    const iterations = 10;
    let successCount = 0;

    for (let i = 0; i < iterations; i++) {
      const lock = createTestLock();
      const result = lock.acquireLock();
      if (result.acquired) {
        successCount++;
        lock.releaseLock();
      }
    }

    expect(successCount).toBe(iterations);
  });

  test('should prevent simultaneous acquisition', async () => {
    const lock1 = createTestLock();
    const lock2 = createTestLock();

    const result1 = lock1.acquireLock();
    expect(result1.acquired).toBe(true);

    const result2 = lock2.acquireLock();
    expect(result2.acquired).toBe(false);

    lock1.releaseLock();
  });

  test('should use atomic file creation (wx flag)', () => {
    const lock = createTestLock();
    const lockPath = lock.getLockPath();

    // Pre-create the lock file to simulate race
    writeFileSync(lockPath, JSON.stringify({
      pid: process.pid + 1,
      timestamp: Date.now(),
      hostname: 'other',
      command: 'other',
    }));

    // Atomic create should fail, not overwrite
    const result = lock.acquireLock();
    expect(result.acquired).toBe(false);

    // Verify original content preserved
    const content = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(content.hostname).toBe('other');

    unlinkSync(lockPath);
  });

  test('should claim stale lock atomically with verification', () => {
    const lock = createTestLock();
    const lockPath = lock.getLockPath();

    // Create stale lock (dead PID)
    writeFileSync(lockPath, JSON.stringify({
      pid: 999999,
      timestamp: Date.now() - 40 * 60 * 1000, // 40 min old
      hostname: 'old',
      command: 'old',
    }));

    const result = lock.acquireLock();
    expect(result.acquired).toBe(true);

    // Verify we now own it
    const content = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(content.pid).toBe(process.pid);

    lock.releaseLock();
  });
});

