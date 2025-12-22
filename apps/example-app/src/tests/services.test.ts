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
    // nanoid uses URL-safe characters: a-zA-Z0-9_-
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
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

describe('Todo Prioritization', () => {
  test('should sort by priority then due date', async () => {
    const { prioritizeTodos } = await import('../utils');

    const now = Date.now();
    const todos = [
      { id: '1', priority: 'low' as const, dueDate: now + 1000, completed: false, title: 'Low soon', description: '', createdAt: now, updatedAt: now, owner: TEST_ADDRESS, encryptedData: null, attachmentCid: null },
      { id: '2', priority: 'high' as const, dueDate: now + 5000, completed: false, title: 'High later', description: '', createdAt: now, updatedAt: now, owner: TEST_ADDRESS, encryptedData: null, attachmentCid: null },
      { id: '3', priority: 'high' as const, dueDate: now + 2000, completed: false, title: 'High soon', description: '', createdAt: now, updatedAt: now, owner: TEST_ADDRESS, encryptedData: null, attachmentCid: null },
      { id: '4', priority: 'medium' as const, dueDate: null, completed: false, title: 'Medium no date', description: '', createdAt: now, updatedAt: now, owner: TEST_ADDRESS, encryptedData: null, attachmentCid: null },
    ];

    const sorted = prioritizeTodos(todos);

    // High priority first, then sorted by due date
    expect(sorted[0].id).toBe('3'); // high, earlier due date
    expect(sorted[1].id).toBe('2'); // high, later due date
    expect(sorted[2].id).toBe('4'); // medium, no date (comes after items with dates)
    expect(sorted[3].id).toBe('1'); // low
  });

  test('should handle todos without due dates', async () => {
    const { prioritizeTodos } = await import('../utils');

    const now = Date.now();
    const todos = [
      { id: '1', priority: 'high' as const, dueDate: null, completed: false, title: 'High no date', description: '', createdAt: now, updatedAt: now, owner: TEST_ADDRESS, encryptedData: null, attachmentCid: null },
      { id: '2', priority: 'high' as const, dueDate: now + 1000, completed: false, title: 'High with date', description: '', createdAt: now, updatedAt: now, owner: TEST_ADDRESS, encryptedData: null, attachmentCid: null },
    ];

    const sorted = prioritizeTodos(todos);

    // Todo with due date should come before one without
    expect(sorted[0].id).toBe('2');
    expect(sorted[1].id).toBe('1');
  });

  test('should handle empty array', async () => {
    const { prioritizeTodos } = await import('../utils');
    expect(prioritizeTodos([])).toEqual([]);
  });
});

describe('Filter Overdue', () => {
  test('should filter overdue incomplete todos', async () => {
    const { filterOverdue } = await import('../utils');

    const now = Date.now();
    const todos = [
      { id: '1', priority: 'high' as const, dueDate: now - 1000, completed: false, title: 'Overdue', description: '', createdAt: now, updatedAt: now, owner: TEST_ADDRESS, encryptedData: null, attachmentCid: null },
      { id: '2', priority: 'high' as const, dueDate: now + 5000, completed: false, title: 'Future', description: '', createdAt: now, updatedAt: now, owner: TEST_ADDRESS, encryptedData: null, attachmentCid: null },
      { id: '3', priority: 'high' as const, dueDate: now - 2000, completed: true, title: 'Overdue but done', description: '', createdAt: now, updatedAt: now, owner: TEST_ADDRESS, encryptedData: null, attachmentCid: null },
      { id: '4', priority: 'low' as const, dueDate: null, completed: false, title: 'No due date', description: '', createdAt: now, updatedAt: now, owner: TEST_ADDRESS, encryptedData: null, attachmentCid: null },
    ];

    const overdue = filterOverdue(todos);

    expect(overdue.length).toBe(1);
    expect(overdue[0].id).toBe('1');
  });

  test('should return empty array when no overdue items', async () => {
    const { filterOverdue } = await import('../utils');

    const now = Date.now();
    const todos = [
      { id: '1', priority: 'high' as const, dueDate: now + 5000, completed: false, title: 'Future', description: '', createdAt: now, updatedAt: now, owner: TEST_ADDRESS, encryptedData: null, attachmentCid: null },
    ];

    expect(filterOverdue(todos)).toEqual([]);
  });
});

describe('Get Top Priorities', () => {
  test('should return top N incomplete prioritized todos', async () => {
    const { getTopPriorities } = await import('../utils');

    const now = Date.now();
    const todos = [
      { id: '1', priority: 'low' as const, dueDate: null, completed: false, title: 'Low', description: '', createdAt: now, updatedAt: now, owner: TEST_ADDRESS, encryptedData: null, attachmentCid: null },
      { id: '2', priority: 'high' as const, dueDate: null, completed: false, title: 'High', description: '', createdAt: now, updatedAt: now, owner: TEST_ADDRESS, encryptedData: null, attachmentCid: null },
      { id: '3', priority: 'medium' as const, dueDate: null, completed: true, title: 'Medium done', description: '', createdAt: now, updatedAt: now, owner: TEST_ADDRESS, encryptedData: null, attachmentCid: null },
      { id: '4', priority: 'medium' as const, dueDate: null, completed: false, title: 'Medium', description: '', createdAt: now, updatedAt: now, owner: TEST_ADDRESS, encryptedData: null, attachmentCid: null },
    ];

    const top = getTopPriorities(todos, 2);

    expect(top.length).toBe(2);
    expect(top[0].id).toBe('2'); // High priority first
    expect(top[1].id).toBe('4'); // Medium second
  });

  test('should default to 5 items', async () => {
    const { getTopPriorities } = await import('../utils');

    const now = Date.now();
    const todos = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      priority: 'medium' as const,
      dueDate: null,
      completed: false,
      title: `Todo ${i}`,
      description: '',
      createdAt: now,
      updatedAt: now,
      owner: TEST_ADDRESS,
      encryptedData: null,
      attachmentCid: null,
    }));

    const top = getTopPriorities(todos);
    expect(top.length).toBe(5);
  });

  test('should handle fewer items than requested', async () => {
    const { getTopPriorities } = await import('../utils');

    const now = Date.now();
    const todos = [
      { id: '1', priority: 'high' as const, dueDate: null, completed: false, title: 'High', description: '', createdAt: now, updatedAt: now, owner: TEST_ADDRESS, encryptedData: null, attachmentCid: null },
    ];

    const top = getTopPriorities(todos, 10);
    expect(top.length).toBe(1);
  });
});

describe('Address Formatting', () => {
  test('should format address with default chars', async () => {
    const { formatAddress } = await import('../utils');

    const formatted = formatAddress('0x1234567890123456789012345678901234567890');
    expect(formatted).toBe('0x1234...7890');
  });

  test('should format address with custom chars', async () => {
    const { formatAddress } = await import('../utils');

    const formatted = formatAddress('0x1234567890123456789012345678901234567890', 6);
    expect(formatted).toBe('0x123456...567890');
  });

  test('should throw on empty address', async () => {
    const { formatAddress } = await import('../utils');

    expect(() => formatAddress('')).toThrow('Address is required');
  });

  test('should throw on invalid address format', async () => {
    const { formatAddress } = await import('../utils');

    expect(() => formatAddress('not-an-address')).toThrow('Invalid address format');
    expect(() => formatAddress('0x123')).toThrow('Invalid address format');
  });
});

describe('Timestamp Validation Details', () => {
  test('should return detailed validation info', async () => {
    const { validateTimestamp, TIMESTAMP_WINDOW_MS } = await import('../utils');

    const now = Date.now();
    const result = validateTimestamp(now);

    expect(result.valid).toBe(true);
    expect(result.age).toBeLessThan(100); // Should be nearly 0
    expect(result.maxAge).toBe(TIMESTAMP_WINDOW_MS);
  });

  test('should calculate age correctly for past timestamp', async () => {
    const { validateTimestamp } = await import('../utils');

    const now = Date.now();
    const past = now - 60000; // 1 minute ago
    const result = validateTimestamp(past);

    expect(result.valid).toBe(true);
    expect(result.age).toBeGreaterThanOrEqual(60000);
    expect(result.age).toBeLessThan(61000);
  });
});

describe('Validation Utilities', () => {
  test('expectDefined should return value when defined', async () => {
    const { expectDefined } = await import('../utils/validation');

    expect(expectDefined('hello')).toBe('hello');
    expect(expectDefined(0)).toBe(0);
    expect(expectDefined(false)).toBe(false);
  });

  test('expectDefined should throw on null or undefined', async () => {
    const { expectDefined, ValidationError } = await import('../utils/validation');

    expect(() => expectDefined(null)).toThrow(ValidationError);
    expect(() => expectDefined(undefined)).toThrow(ValidationError);
    expect(() => expectDefined(null, 'Custom message')).toThrow('Custom message');
  });

  test('expectTruthy should return value when truthy', async () => {
    const { expectTruthy } = await import('../utils/validation');

    expect(expectTruthy('hello')).toBe('hello');
    expect(expectTruthy(1)).toBe(1);
    expect(expectTruthy(true)).toBe(true);
    expect(expectTruthy([])).toEqual([]);
  });

  test('expectTruthy should throw on falsy values', async () => {
    const { expectTruthy, ValidationError } = await import('../utils/validation');

    expect(() => expectTruthy(null)).toThrow(ValidationError);
    expect(() => expectTruthy(undefined)).toThrow(ValidationError);
    expect(() => expectTruthy(0)).toThrow(ValidationError);
    expect(() => expectTruthy('')).toThrow(ValidationError);
    expect(() => expectTruthy(false)).toThrow(ValidationError);
  });

  test('expectInRange should validate number ranges', async () => {
    const { expectInRange, ValidationError } = await import('../utils/validation');

    expect(expectInRange(5, 0, 10)).toBe(5);
    expect(expectInRange(0, 0, 10)).toBe(0);
    expect(expectInRange(10, 0, 10)).toBe(10);

    expect(() => expectInRange(-1, 0, 10)).toThrow(ValidationError);
    expect(() => expectInRange(11, 0, 10)).toThrow(ValidationError);
    expect(() => expectInRange(5, 0, 10, 'Value')).not.toThrow();
    expect(() => expectInRange(-1, 0, 10, 'Value')).toThrow('Value:');
  });

  test('expectMatch should validate string patterns', async () => {
    const { expectMatch, ValidationError } = await import('../utils/validation');

    expect(expectMatch('hello123', /^[a-z0-9]+$/)).toBe('hello123');
    expect(expectMatch('test@example.com', /@/)).toBe('test@example.com');

    expect(() => expectMatch('HELLO', /^[a-z]+$/)).toThrow(ValidationError);
    expect(() => expectMatch('no-at-sign', /@/)).toThrow(ValidationError);
  });

  test('expectMinLength should validate minimum array length', async () => {
    const { expectMinLength, ValidationError } = await import('../utils/validation');

    expect(expectMinLength([1, 2, 3], 2)).toEqual([1, 2, 3]);
    expect(expectMinLength([1], 1)).toEqual([1]);

    expect(() => expectMinLength([], 1)).toThrow(ValidationError);
    expect(() => expectMinLength([1], 2)).toThrow(ValidationError);
    expect(() => expectMinLength([], 1, 'Items')).toThrow('Items:');
  });

  test('expectMaxLength should validate maximum array length', async () => {
    const { expectMaxLength, ValidationError } = await import('../utils/validation');

    expect(expectMaxLength([1, 2], 3)).toEqual([1, 2]);
    expect(expectMaxLength([1, 2, 3], 3)).toEqual([1, 2, 3]);

    expect(() => expectMaxLength([1, 2, 3, 4], 3)).toThrow(ValidationError);
    expect(() => expectMaxLength([1, 2, 3, 4], 3, 'Items')).toThrow('Items:');
  });

  test('expectValid should validate against zod schema', async () => {
    const { expectValid, ValidationError } = await import('../utils/validation');
    const { z } = await import('zod');

    const schema = z.object({
      name: z.string().min(1),
      age: z.number().positive(),
    });

    expect(expectValid(schema, { name: 'Test', age: 25 })).toEqual({ name: 'Test', age: 25 });

    expect(() => expectValid(schema, { name: '', age: 25 })).toThrow(ValidationError);
    expect(() => expectValid(schema, { name: 'Test', age: -1 })).toThrow(ValidationError);
    expect(() => expectValid(schema, null)).toThrow(ValidationError);
  });

  test('isValidationError should correctly identify ValidationError', async () => {
    const { isValidationError, ValidationError } = await import('../utils/validation');

    expect(isValidationError(new ValidationError('test'))).toBe(true);
    expect(isValidationError(new Error('test'))).toBe(false);
    expect(isValidationError('test')).toBe(false);
    expect(isValidationError(null)).toBe(false);
  });
});
