/**
 * Unit Tests for Decentralized App Template
 *
 * These tests verify types, utilities, and configuration
 * without requiring running services.
 */

import { describe, test, expect } from 'bun:test';
import type { Address } from 'viem';

// Test wallet address
const TEST_ADDRESS = '0x1234567890123456789012345678901234567890' as Address;

describe('Types and Interfaces', () => {
  test('should export TodoPriority enum values', async () => {
    const { TODO_PRIORITIES } = await import('../types');
    expect(TODO_PRIORITIES).toContain('low');
    expect(TODO_PRIORITIES).toContain('medium');
    expect(TODO_PRIORITIES).toContain('high');
    expect(TODO_PRIORITIES.length).toBe(3);
  });

  test('should export A2A skill IDs', async () => {
    const { A2A_SKILLS } = await import('../types');
    expect(A2A_SKILLS).toContain('list-todos');
    expect(A2A_SKILLS).toContain('create-todo');
    expect(A2A_SKILLS).toContain('complete-todo');
    expect(A2A_SKILLS).toContain('delete-todo');
    expect(A2A_SKILLS).toContain('get-summary');
    expect(A2A_SKILLS).toContain('set-reminder');
  });

  test('should export MCP tool names', async () => {
    const { MCP_TOOLS } = await import('../types');
    expect(MCP_TOOLS).toContain('create_todo');
    expect(MCP_TOOLS).toContain('list_todos');
    expect(MCP_TOOLS).toContain('update_todo');
    expect(MCP_TOOLS).toContain('delete_todo');
    expect(MCP_TOOLS).toContain('get_stats');
  });
});

describe('x402 Configuration', () => {
  test('should have valid payment configuration', async () => {
    const { X402_CONFIG } = await import('../types');
    expect(X402_CONFIG.enabled).toBe(true);
    expect(X402_CONFIG.paymentAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(X402_CONFIG.acceptedTokens.length).toBeGreaterThan(0);
    expect(X402_CONFIG.prices.rest).toBeDefined();
    expect(X402_CONFIG.prices.a2a).toBeDefined();
    expect(X402_CONFIG.prices.mcp).toBeDefined();
  });

  test('should have valid pricing tiers', async () => {
    const { X402_CONFIG } = await import('../types');
    const restPrice = BigInt(X402_CONFIG.prices.rest);
    const a2aPrice = BigInt(X402_CONFIG.prices.a2a);
    const mcpPrice = BigInt(X402_CONFIG.prices.mcp);

    expect(restPrice).toBeGreaterThan(0n);
    expect(a2aPrice).toBeGreaterThan(0n);
    expect(mcpPrice).toBeGreaterThan(0n);
  });
});

describe('Cache Keys', () => {
  test('should generate consistent keys', async () => {
    const { cacheKeys } = await import('../services/cache');

    const key1 = cacheKeys.todoList(TEST_ADDRESS);
    const key2 = cacheKeys.todoList(TEST_ADDRESS);

    expect(key1).toBe(key2);
  });

  test('should include address in keys', async () => {
    const { cacheKeys } = await import('../services/cache');

    const key = cacheKeys.todoList(TEST_ADDRESS);
    expect(key).toContain(TEST_ADDRESS.toLowerCase());
  });

  test('should generate different keys for different types', async () => {
    const { cacheKeys } = await import('../services/cache');

    const listKey = cacheKeys.todoList(TEST_ADDRESS);
    const statsKey = cacheKeys.todoStats(TEST_ADDRESS);
    const itemKey = cacheKeys.todoItem('todo-123');

    expect(listKey).not.toBe(statsKey);
    expect(listKey).not.toBe(itemKey);
    expect(statsKey).not.toBe(itemKey);
  });

  test('should lowercase addresses', async () => {
    const { cacheKeys } = await import('../services/cache');

    const mixedCaseAddress = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12' as Address;
    const key = cacheKeys.todoList(mixedCaseAddress);

    expect(key).not.toContain('A');
    expect(key).not.toContain('B');
    expect(key).not.toContain('C');
  });
});

describe('Authentication Message', () => {
  test('should construct correct message format', async () => {
    const { constructAuthMessage } = await import('../utils');

    const timestamp = Date.now();
    const message = constructAuthMessage(timestamp);

    expect(message).toBe('jeju-dapp:' + timestamp);
  });

  test('should validate timestamp within window', async () => {
    const { isValidTimestamp, TIMESTAMP_WINDOW_MS } = await import('../utils');

    const now = Date.now();
    expect(isValidTimestamp(now)).toBe(true);
    expect(isValidTimestamp(now - 1000)).toBe(true); // 1 second ago
    expect(isValidTimestamp(now - 60000)).toBe(true); // 1 minute ago
    expect(isValidTimestamp(now - (TIMESTAMP_WINDOW_MS - 1000))).toBe(true); // Just under window
    expect(isValidTimestamp(now - (TIMESTAMP_WINDOW_MS + 60000))).toBe(false); // Well past window
    expect(isValidTimestamp(now + 60000)).toBe(false); // Future timestamp
  });
});

describe('ID Generation', () => {
  test('should generate unique IDs', async () => {
    const { generateId } = await import('../utils');

    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }

    expect(ids.size).toBe(100);
  });

  test('should follow expected format', async () => {
    const { generateId } = await import('../utils');

    const id = generateId();
    expect(id.length).toBeGreaterThan(10);
    expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  test('should support prefixes', async () => {
    const { generateId } = await import('../utils');

    const todoId = generateId('todo');
    const reminderId = generateId('reminder');

    expect(todoId.startsWith('todo-')).toBe(true);
    expect(reminderId.startsWith('reminder-')).toBe(true);
  });
});

describe('Priority Sorting', () => {
  test('should sort by priority correctly', async () => {
    const { sortByPriority } = await import('../utils');

    const todos = [
      { id: '1', priority: 'low' as const },
      { id: '2', priority: 'medium' as const },
      { id: '3', priority: 'high' as const },
    ];

    const sorted = sortByPriority(todos);

    expect(sorted[0].priority).toBe('high');
    expect(sorted[1].priority).toBe('medium');
    expect(sorted[2].priority).toBe('low');
  });

  test('should handle empty arrays', async () => {
    const { sortByPriority } = await import('../utils');
    const sorted = sortByPriority([]);
    expect(sorted).toEqual([]);
  });
});

describe('Date Helpers', () => {
  test('should calculate next midnight correctly', async () => {
    const { getNextMidnight } = await import('../utils');

    const nextMidnight = getNextMidnight();
    const now = Date.now();

    expect(nextMidnight).toBeGreaterThan(now);
    expect(nextMidnight - now).toBeLessThanOrEqual(24 * 60 * 60 * 1000);

    const date = new Date(nextMidnight);
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
    expect(date.getSeconds()).toBe(0);
  });

  test('should detect overdue items', async () => {
    const { isOverdue } = await import('../utils');

    const past = Date.now() - 1000;
    const future = Date.now() + 60000;

    expect(isOverdue(past)).toBe(true);
    expect(isOverdue(future)).toBe(false);
  });
});

describe('Storage URL Generation', () => {
  test('should generate IPFS gateway URLs', async () => {
    const { getStorageService } = await import('../services/storage');
    const storage = getStorageService();

    const cid = 'QmTest123456789';
    const url = storage.getUrl(cid);

    expect(url).toContain('ipfs');
    expect(url).toContain(cid);
  });
});

describe('JNS Name Normalization', () => {
  test('should normalize names correctly', async () => {
    const { normalizeJNSName } = await import('../utils');

    expect(normalizeJNSName('test')).toBe('test.jeju');
    expect(normalizeJNSName('test.jeju')).toBe('test.jeju');
    expect(normalizeJNSName('TEST.JEJU')).toBe('test.jeju');
    expect(normalizeJNSName('Test')).toBe('test.jeju');
  });

  test('should validate JNS names', async () => {
    const { isValidJNSName } = await import('../utils');

    expect(isValidJNSName('test')).toBe(true);
    expect(isValidJNSName('test123')).toBe(true);
    expect(isValidJNSName('test-name')).toBe(true);
    expect(isValidJNSName('')).toBe(false);
    expect(isValidJNSName('a')).toBe(true); // Single char allowed
    expect(isValidJNSName('test_name')).toBe(false); // Underscores not allowed
    expect(isValidJNSName('test name')).toBe(false); // Spaces not allowed
  });
});

describe('Configuration', () => {
  test('should have valid port configuration', () => {
    const PORT = process.env.PORT || '4500';
    const FRONTEND_PORT = process.env.FRONTEND_PORT || '4501';

    expect(parseInt(PORT)).toBeGreaterThan(0);
    expect(parseInt(FRONTEND_PORT)).toBeGreaterThan(0);
    expect(parseInt(PORT)).not.toBe(parseInt(FRONTEND_PORT));
  });
});
