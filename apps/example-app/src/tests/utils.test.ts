/**
 * Unit Tests for Utilities, Types, and Validation
 *
 * Tests type exports, utilities, configuration, and validation helpers
 * without requiring running services.
 */

import { describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import { cacheKeys } from '../services/cache'
import { getStorageService } from '../services/storage'
import { A2A_SKILLS, MCP_TOOLS, TODO_PRIORITIES, X402_CONFIG } from '../types'
import {
  constructAuthMessage,
  formatAddress,
  generateId,
  getNextMidnight,
  getTopPriorities,
  isOverdue,
  isValidJNSName,
  isValidTimestamp,
  normalizeJNSName,
  prioritizeTodos,
  sortByPriority,
  TIMESTAMP_WINDOW_MS,
  validateTimestamp,
} from '../utils'
import {
  expectDefined,
  expectInRange,
  expectMatch,
  expectMaxLength,
  expectMinLength,
  expectTruthy,
  expectValid,
  isValidationError,
  ValidationError,
} from '../utils/validation'

const TEST_ADDRESS = '0x1234567890123456789012345678901234567890' as Address

describe('Types and Interfaces', () => {
  test('should export TodoPriority enum values', () => {
    expect(TODO_PRIORITIES).toContain('low')
    expect(TODO_PRIORITIES).toContain('medium')
    expect(TODO_PRIORITIES).toContain('high')
    expect(TODO_PRIORITIES.length).toBe(3)
  })

  test('should export A2A skill IDs', () => {
    expect(A2A_SKILLS).toContain('list-todos')
    expect(A2A_SKILLS).toContain('create-todo')
    expect(A2A_SKILLS).toContain('complete-todo')
    expect(A2A_SKILLS).toContain('delete-todo')
    expect(A2A_SKILLS).toContain('get-summary')
    expect(A2A_SKILLS).toContain('set-reminder')
  })

  test('should export MCP tool names', () => {
    expect(MCP_TOOLS).toContain('create_todo')
    expect(MCP_TOOLS).toContain('list_todos')
    expect(MCP_TOOLS).toContain('update_todo')
    expect(MCP_TOOLS).toContain('delete_todo')
    expect(MCP_TOOLS).toContain('get_stats')
  })
})

describe('x402 Configuration', () => {
  test('should have valid payment configuration', () => {
    expect(X402_CONFIG.enabled).toBe(true)
    expect(X402_CONFIG.paymentAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(X402_CONFIG.acceptedTokens.length).toBeGreaterThan(0)
    expect(X402_CONFIG.prices.rest).toBeDefined()
    expect(X402_CONFIG.prices.a2a).toBeDefined()
    expect(X402_CONFIG.prices.mcp).toBeDefined()
  })

  test('should have valid pricing tiers', () => {
    const restPrice = BigInt(X402_CONFIG.prices.rest)
    const a2aPrice = BigInt(X402_CONFIG.prices.a2a)
    const mcpPrice = BigInt(X402_CONFIG.prices.mcp)

    expect(restPrice).toBeGreaterThan(0n)
    expect(a2aPrice).toBeGreaterThan(0n)
    expect(mcpPrice).toBeGreaterThan(0n)
  })
})

describe('Cache Keys', () => {
  test('should generate consistent keys', () => {
    const key1 = cacheKeys.todoList(TEST_ADDRESS)
    const key2 = cacheKeys.todoList(TEST_ADDRESS)

    expect(key1).toBe(key2)
  })

  test('should include address in keys', () => {
    const key = cacheKeys.todoList(TEST_ADDRESS)
    expect(key).toContain(TEST_ADDRESS.toLowerCase())
  })

  test('should generate different keys for different types', () => {
    const listKey = cacheKeys.todoList(TEST_ADDRESS)
    const statsKey = cacheKeys.todoStats(TEST_ADDRESS)
    const itemKey = cacheKeys.todoItem('todo-123')

    expect(listKey).not.toBe(statsKey)
    expect(listKey).not.toBe(itemKey)
    expect(statsKey).not.toBe(itemKey)
  })

  test('should lowercase addresses', () => {
    const mixedCaseAddress =
      '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12' as Address
    const key = cacheKeys.todoList(mixedCaseAddress)

    expect(key).not.toContain('A')
    expect(key).not.toContain('B')
    expect(key).not.toContain('C')
  })
})

describe('Authentication Message', () => {
  test('should construct correct message format', () => {
    const timestamp = Date.now()
    const message = constructAuthMessage(timestamp)

    expect(message).toBe(`jeju-dapp:${timestamp}`)
  })

  test('should validate timestamp within window', () => {
    const now = Date.now()
    expect(isValidTimestamp(now)).toBe(true)
    expect(isValidTimestamp(now - 1000)).toBe(true)
    expect(isValidTimestamp(now - 60000)).toBe(true)
    expect(isValidTimestamp(now - (TIMESTAMP_WINDOW_MS - 1000))).toBe(true)
    expect(isValidTimestamp(now - (TIMESTAMP_WINDOW_MS + 60000))).toBe(false)
    expect(isValidTimestamp(now + 60000)).toBe(false)
  })
})

describe('ID Generation', () => {
  test('should generate unique IDs', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateId())
    }

    expect(ids.size).toBe(100)
  })

  test('should follow expected format', () => {
    const id = generateId()
    expect(id.length).toBeGreaterThan(10)
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/)
  })

  test('should support prefixes', () => {
    const todoId = generateId('todo')
    const reminderId = generateId('reminder')

    expect(todoId.startsWith('todo-')).toBe(true)
    expect(reminderId.startsWith('reminder-')).toBe(true)
  })
})

describe('Priority Sorting', () => {
  test('should sort by priority correctly', () => {
    const todos = [
      { id: '1', priority: 'low' as const },
      { id: '2', priority: 'medium' as const },
      { id: '3', priority: 'high' as const },
    ]

    const sorted = sortByPriority(todos)

    expect(sorted[0].priority).toBe('high')
    expect(sorted[1].priority).toBe('medium')
    expect(sorted[2].priority).toBe('low')
  })

  test('should handle empty arrays', () => {
    const sorted = sortByPriority([])
    expect(sorted).toEqual([])
  })
})

describe('Date Helpers', () => {
  test('should calculate next midnight correctly', () => {
    const nextMidnight = getNextMidnight()
    const now = Date.now()

    expect(nextMidnight).toBeGreaterThan(now)
    expect(nextMidnight - now).toBeLessThanOrEqual(24 * 60 * 60 * 1000)

    const date = new Date(nextMidnight)
    expect(date.getHours()).toBe(0)
    expect(date.getMinutes()).toBe(0)
    expect(date.getSeconds()).toBe(0)
  })

  test('should detect overdue items', () => {
    const past = Date.now() - 1000
    const future = Date.now() + 60000

    expect(isOverdue(past)).toBe(true)
    expect(isOverdue(future)).toBe(false)
  })
})

describe('Storage URL Generation', () => {
  test('should generate IPFS gateway URLs', () => {
    const storage = getStorageService()

    const cid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'
    const url = storage.getUrl(cid)

    expect(url).toContain('ipfs')
    expect(url).toContain(cid)
  })

  test('should reject invalid CIDs', () => {
    const storage = getStorageService()

    expect(() => storage.getUrl('../../../etc/passwd')).toThrow('Invalid CID')
    expect(() => storage.getUrl('invalid-cid')).toThrow('Invalid CID')
    expect(() => storage.getUrl('')).toThrow('CID is required')
  })
})

describe('JNS Name Normalization', () => {
  test('should normalize names correctly', () => {
    expect(normalizeJNSName('test')).toBe('test.jeju')
    expect(normalizeJNSName('test.jeju')).toBe('test.jeju')
    expect(normalizeJNSName('TEST.JEJU')).toBe('test.jeju')
    expect(normalizeJNSName('Test')).toBe('test.jeju')
  })

  test('should validate JNS names', () => {
    expect(isValidJNSName('test')).toBe(true)
    expect(isValidJNSName('test123')).toBe(true)
    expect(isValidJNSName('test-name')).toBe(true)
    expect(isValidJNSName('')).toBe(false)
    expect(isValidJNSName('a')).toBe(true)
    expect(isValidJNSName('test_name')).toBe(false)
    expect(isValidJNSName('test name')).toBe(false)
  })
})

describe('Configuration', () => {
  test('should have valid port configuration', () => {
    const PORT = process.env.PORT || '4500'
    const FRONTEND_PORT = process.env.FRONTEND_PORT || '4501'

    expect(parseInt(PORT, 10)).toBeGreaterThan(0)
    expect(parseInt(FRONTEND_PORT, 10)).toBeGreaterThan(0)
    expect(parseInt(PORT, 10)).not.toBe(parseInt(FRONTEND_PORT, 10))
  })
})

import { z } from 'zod'
import { filterOverdue } from '../utils'

describe('Todo Prioritization', () => {
  const createTodo = (
    overrides: Partial<{
      id: string
      priority: 'low' | 'medium' | 'high'
      dueDate: number | null
      completed: boolean
      title: string
    }>,
  ) => {
    const now = Date.now()
    return {
      id: overrides.id || '1',
      priority: overrides.priority || ('medium' as const),
      dueDate: overrides.dueDate ?? null,
      completed: overrides.completed ?? false,
      title: overrides.title || 'Test',
      description: '',
      createdAt: now,
      updatedAt: now,
      owner: TEST_ADDRESS,
      encryptedData: null,
      attachmentCid: null,
    }
  }

  test('should sort by priority then due date', () => {
    const now = Date.now()
    const todos = [
      createTodo({
        id: '1',
        priority: 'low',
        dueDate: now + 1000,
        title: 'Low soon',
      }),
      createTodo({
        id: '2',
        priority: 'high',
        dueDate: now + 5000,
        title: 'High later',
      }),
      createTodo({
        id: '3',
        priority: 'high',
        dueDate: now + 2000,
        title: 'High soon',
      }),
      createTodo({
        id: '4',
        priority: 'medium',
        dueDate: null,
        title: 'Medium no date',
      }),
    ]

    const sorted = prioritizeTodos(todos)

    expect(sorted[0].id).toBe('3')
    expect(sorted[1].id).toBe('2')
    expect(sorted[2].id).toBe('4')
    expect(sorted[3].id).toBe('1')
  })

  test('should handle todos without due dates', () => {
    const now = Date.now()
    const todos = [
      createTodo({
        id: '1',
        priority: 'high',
        dueDate: null,
        title: 'High no date',
      }),
      createTodo({
        id: '2',
        priority: 'high',
        dueDate: now + 1000,
        title: 'High with date',
      }),
    ]

    const sorted = prioritizeTodos(todos)

    expect(sorted[0].id).toBe('2')
    expect(sorted[1].id).toBe('1')
  })

  test('should handle empty array', () => {
    expect(prioritizeTodos([])).toEqual([])
  })
})

describe('Filter Overdue', () => {
  const createTodo = (
    overrides: Partial<{
      id: string
      priority: 'low' | 'medium' | 'high'
      dueDate: number | null
      completed: boolean
      title: string
    }>,
  ) => {
    const now = Date.now()
    return {
      id: overrides.id || '1',
      priority: overrides.priority || ('high' as const),
      dueDate: overrides.dueDate ?? null,
      completed: overrides.completed ?? false,
      title: overrides.title || 'Test',
      description: '',
      createdAt: now,
      updatedAt: now,
      owner: TEST_ADDRESS,
      encryptedData: null,
      attachmentCid: null,
    }
  }

  test('should filter overdue incomplete todos', () => {
    const now = Date.now()
    const todos = [
      createTodo({
        id: '1',
        dueDate: now - 1000,
        completed: false,
        title: 'Overdue',
      }),
      createTodo({
        id: '2',
        dueDate: now + 5000,
        completed: false,
        title: 'Future',
      }),
      createTodo({
        id: '3',
        dueDate: now - 2000,
        completed: true,
        title: 'Overdue but done',
      }),
      createTodo({
        id: '4',
        priority: 'low',
        dueDate: null,
        completed: false,
        title: 'No due date',
      }),
    ]

    const overdue = filterOverdue(todos)

    expect(overdue.length).toBe(1)
    expect(overdue[0].id).toBe('1')
  })

  test('should return empty array when no overdue items', () => {
    const now = Date.now()
    const todos = [
      createTodo({
        id: '1',
        dueDate: now + 5000,
        completed: false,
        title: 'Future',
      }),
    ]

    expect(filterOverdue(todos)).toEqual([])
  })
})

describe('Get Top Priorities', () => {
  const createTodo = (
    overrides: Partial<{
      id: string
      priority: 'low' | 'medium' | 'high'
      dueDate: number | null
      completed: boolean
      title: string
    }>,
  ) => {
    const now = Date.now()
    return {
      id: overrides.id || '1',
      priority: overrides.priority || ('medium' as const),
      dueDate: overrides.dueDate ?? null,
      completed: overrides.completed ?? false,
      title: overrides.title || 'Test',
      description: '',
      createdAt: now,
      updatedAt: now,
      owner: TEST_ADDRESS,
      encryptedData: null,
      attachmentCid: null,
    }
  }

  test('should return top N incomplete prioritized todos', () => {
    const todos = [
      createTodo({ id: '1', priority: 'low', title: 'Low' }),
      createTodo({ id: '2', priority: 'high', title: 'High' }),
      createTodo({
        id: '3',
        priority: 'medium',
        completed: true,
        title: 'Medium done',
      }),
      createTodo({ id: '4', priority: 'medium', title: 'Medium' }),
    ]

    const top = getTopPriorities(todos, 2)

    expect(top.length).toBe(2)
    expect(top[0].id).toBe('2')
    expect(top[1].id).toBe('4')
  })

  test('should default to 5 items', () => {
    const todos = Array.from({ length: 10 }, (_, i) =>
      createTodo({ id: String(i), title: `Todo ${i}` }),
    )

    const top = getTopPriorities(todos)
    expect(top.length).toBe(5)
  })

  test('should handle fewer items than requested', () => {
    const todos = [createTodo({ id: '1', priority: 'high', title: 'High' })]

    const top = getTopPriorities(todos, 10)
    expect(top.length).toBe(1)
  })
})

describe('Address Formatting', () => {
  test('should format address with default chars', () => {
    const formatted = formatAddress(
      '0x1234567890123456789012345678901234567890',
    )
    expect(formatted).toBe('0x1234...7890')
  })

  test('should format address with custom chars', () => {
    const formatted = formatAddress(
      '0x1234567890123456789012345678901234567890',
      6,
    )
    expect(formatted).toBe('0x123456...567890')
  })

  test('should throw on empty address', () => {
    expect(() => formatAddress('')).toThrow('Address is required')
  })

  test('should throw on invalid address format', () => {
    expect(() => formatAddress('not-an-address')).toThrow(
      'Invalid address format',
    )
    expect(() => formatAddress('0x123')).toThrow('Invalid address format')
  })
})

describe('Timestamp Validation Details', () => {
  test('should return detailed validation info', () => {
    const now = Date.now()
    const result = validateTimestamp(now)

    expect(result.valid).toBe(true)
    expect(result.age).toBeLessThan(100)
    expect(result.maxAge).toBe(TIMESTAMP_WINDOW_MS)
  })

  test('should calculate age correctly for past timestamp', () => {
    const now = Date.now()
    const past = now - 60000
    const result = validateTimestamp(past)

    expect(result.valid).toBe(true)
    expect(result.age).toBeGreaterThanOrEqual(60000)
    expect(result.age).toBeLessThan(61000)
  })
})

describe('Validation Utilities', () => {
  test('expectDefined should return value when defined', () => {
    expect(expectDefined('hello')).toBe('hello')
    expect(expectDefined(0)).toBe(0)
    expect(expectDefined(false)).toBe(false)
  })

  test('expectDefined should throw on null or undefined', () => {
    expect(() => expectDefined(null)).toThrow(ValidationError)
    expect(() => expectDefined(undefined)).toThrow(ValidationError)
    expect(() => expectDefined(null, 'Custom message')).toThrow(
      'Custom message',
    )
  })

  test('expectTruthy should return value when truthy', () => {
    expect(expectTruthy('hello')).toBe('hello')
    expect(expectTruthy(1)).toBe(1)
    expect(expectTruthy(true)).toBe(true)
    expect(expectTruthy([])).toEqual([])
  })

  test('expectTruthy should throw on falsy values', () => {
    expect(() => expectTruthy(null)).toThrow(ValidationError)
    expect(() => expectTruthy(undefined)).toThrow(ValidationError)
    expect(() => expectTruthy(0)).toThrow(ValidationError)
    expect(() => expectTruthy('')).toThrow(ValidationError)
    expect(() => expectTruthy(false)).toThrow(ValidationError)
  })

  test('expectInRange should validate number ranges', () => {
    expect(expectInRange(5, 0, 10)).toBe(5)
    expect(expectInRange(0, 0, 10)).toBe(0)
    expect(expectInRange(10, 0, 10)).toBe(10)

    expect(() => expectInRange(-1, 0, 10)).toThrow(ValidationError)
    expect(() => expectInRange(11, 0, 10)).toThrow(ValidationError)
    expect(() => expectInRange(5, 0, 10, 'Value')).not.toThrow()
    expect(() => expectInRange(-1, 0, 10, 'Value')).toThrow('Value:')
  })

  test('expectMatch should validate string patterns', () => {
    expect(expectMatch('hello123', /^[a-z0-9]+$/)).toBe('hello123')
    expect(expectMatch('test@example.com', /@/)).toBe('test@example.com')

    expect(() => expectMatch('HELLO', /^[a-z]+$/)).toThrow(ValidationError)
    expect(() => expectMatch('no-at-sign', /@/)).toThrow(ValidationError)
  })

  test('expectMinLength should validate minimum array length', () => {
    expect(expectMinLength([1, 2, 3], 2)).toEqual([1, 2, 3])
    expect(expectMinLength([1], 1)).toEqual([1])

    expect(() => expectMinLength([], 1)).toThrow(ValidationError)
    expect(() => expectMinLength([1], 2)).toThrow(ValidationError)
    expect(() => expectMinLength([], 1, 'Items')).toThrow('Items:')
  })

  test('expectMaxLength should validate maximum array length', () => {
    expect(expectMaxLength([1, 2], 3)).toEqual([1, 2])
    expect(expectMaxLength([1, 2, 3], 3)).toEqual([1, 2, 3])

    expect(() => expectMaxLength([1, 2, 3, 4], 3)).toThrow(ValidationError)
    expect(() => expectMaxLength([1, 2, 3, 4], 3, 'Items')).toThrow('Items:')
  })

  test('expectValid should validate against zod schema', () => {
    const schema = z.object({
      name: z.string().min(1),
      age: z.number().positive(),
    })

    expect(expectValid(schema, { name: 'Test', age: 25 })).toEqual({
      name: 'Test',
      age: 25,
    })

    expect(() => expectValid(schema, { name: '', age: 25 })).toThrow(
      ValidationError,
    )
    expect(() => expectValid(schema, { name: 'Test', age: -1 })).toThrow(
      ValidationError,
    )
    expect(() => expectValid(schema, null)).toThrow(ValidationError)
  })

  test('isValidationError should correctly identify ValidationError', () => {
    expect(isValidationError(new ValidationError('test'))).toBe(true)
    expect(isValidationError(new Error('test'))).toBe(false)
    expect(isValidationError('test')).toBe(false)
    expect(isValidationError(null)).toBe(false)
  })
})
