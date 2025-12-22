/**
 * @fileoverview Comprehensive tests for api.ts
 *
 * Tests cover:
 * - ErrorDetailSchema: Error detail validation
 * - PaginationInfoSchema: Pagination metadata
 * - ApiMetaSchema: API response metadata
 * - ApiErrorSchema: Error response format
 * - createApiResponseSchema: Generic API response factory
 * - createPaginatedResponseSchema: Paginated response factory
 * - createA2AResponseSchema: A2A protocol response factory
 */

import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  type ApiError,
  ApiErrorSchema,
  type ApiMeta,
  ApiMetaSchema,
  createA2AResponseSchema,
  createApiResponseSchema,
  createPaginatedResponseSchema,
  ErrorDetailSchema,
  type PaginationInfo,
  PaginationInfoSchema,
} from '../api'

// ============================================================================
// ErrorDetailSchema Tests
// ============================================================================

describe('ErrorDetailSchema', () => {
  test('accepts string', () => {
    const result = ErrorDetailSchema.safeParse('An error occurred')
    expect(result.success).toBe(true)
  })

  test('accepts array of strings', () => {
    const result = ErrorDetailSchema.safeParse([
      'Error 1',
      'Error 2',
      'Error 3',
    ])
    expect(result.success).toBe(true)
  })

  test('accepts array of field/message objects', () => {
    const fieldErrors = [
      { field: 'email', message: 'Invalid email format' },
      { field: 'password', message: 'Password too short' },
    ]
    const result = ErrorDetailSchema.safeParse(fieldErrors)
    expect(result.success).toBe(true)
  })

  test('accepts array of path/message objects', () => {
    const pathErrors = [
      { path: ['user', 'email'], message: 'Invalid email' },
      { path: ['user', 'profile', 'name'], message: 'Required' },
    ]
    const result = ErrorDetailSchema.safeParse(pathErrors)
    expect(result.success).toBe(true)
  })

  test('rejects invalid structures', () => {
    // Number is not a valid ErrorDetail
    expect(ErrorDetailSchema.safeParse(123).success).toBe(false)

    // Object without required fields
    expect(ErrorDetailSchema.safeParse({ error: 'test' }).success).toBe(false)

    // Array of numbers
    expect(ErrorDetailSchema.safeParse([1, 2, 3]).success).toBe(false)
  })

  test('rejects mixed arrays', () => {
    // Array with mixed types is not valid
    const mixed = ['string', { field: 'test', message: 'msg' }]
    // This should fail as it's neither all strings nor all objects
    // Note: Zod union may accept if it matches one variant
    const result = ErrorDetailSchema.safeParse(mixed)
    // The schema uses union, so it tries each variant - mixed arrays should fail all
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// PaginationInfoSchema Tests
// ============================================================================

describe('PaginationInfoSchema', () => {
  test('accepts valid pagination info', () => {
    const pagination: PaginationInfo = {
      page: 1,
      pageSize: 20,
      total: 100,
      totalPages: 5,
    }

    const result = PaginationInfoSchema.safeParse(pagination)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(pagination)
    }
  })

  test('rejects non-positive page', () => {
    expect(
      PaginationInfoSchema.safeParse({
        page: 0,
        pageSize: 20,
        total: 100,
        totalPages: 5,
      }).success,
    ).toBe(false)
    expect(
      PaginationInfoSchema.safeParse({
        page: -1,
        pageSize: 20,
        total: 100,
        totalPages: 5,
      }).success,
    ).toBe(false)
  })

  test('rejects non-positive pageSize', () => {
    expect(
      PaginationInfoSchema.safeParse({
        page: 1,
        pageSize: 0,
        total: 100,
        totalPages: 5,
      }).success,
    ).toBe(false)
    expect(
      PaginationInfoSchema.safeParse({
        page: 1,
        pageSize: -10,
        total: 100,
        totalPages: 5,
      }).success,
    ).toBe(false)
  })

  test('accepts zero for total and totalPages', () => {
    const emptyResult: PaginationInfo = {
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    }

    expect(PaginationInfoSchema.safeParse(emptyResult).success).toBe(true)
  })

  test('rejects negative total/totalPages', () => {
    expect(
      PaginationInfoSchema.safeParse({
        page: 1,
        pageSize: 20,
        total: -1,
        totalPages: 5,
      }).success,
    ).toBe(false)
    expect(
      PaginationInfoSchema.safeParse({
        page: 1,
        pageSize: 20,
        total: 100,
        totalPages: -1,
      }).success,
    ).toBe(false)
  })

  test('rejects non-integer values', () => {
    expect(
      PaginationInfoSchema.safeParse({
        page: 1.5,
        pageSize: 20,
        total: 100,
        totalPages: 5,
      }).success,
    ).toBe(false)
    expect(
      PaginationInfoSchema.safeParse({
        page: 1,
        pageSize: 20.5,
        total: 100,
        totalPages: 5,
      }).success,
    ).toBe(false)
  })
})

// ============================================================================
// ApiMetaSchema Tests
// ============================================================================

describe('ApiMetaSchema', () => {
  test('accepts minimal meta with just timestamp', () => {
    const meta = { timestamp: Date.now() }
    const result = ApiMetaSchema.safeParse(meta)
    expect(result.success).toBe(true)
  })

  test('accepts full meta with all fields', () => {
    const meta: ApiMeta = {
      timestamp: Date.now(),
      requestId: 'req-123-abc',
      version: '1.0.0',
      pagination: {
        page: 1,
        pageSize: 20,
        total: 100,
        totalPages: 5,
      },
    }

    const result = ApiMetaSchema.safeParse(meta)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(meta)
    }
  })

  test('accepts meta without optional fields', () => {
    const meta = {
      timestamp: Date.now(),
    }

    const result = ApiMetaSchema.safeParse(meta)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.requestId).toBeUndefined()
      expect(result.data.version).toBeUndefined()
      expect(result.data.pagination).toBeUndefined()
    }
  })

  test('rejects missing timestamp', () => {
    expect(ApiMetaSchema.safeParse({}).success).toBe(false)
    expect(ApiMetaSchema.safeParse({ requestId: 'abc' }).success).toBe(false)
  })

  test('rejects invalid pagination in meta', () => {
    const meta = {
      timestamp: Date.now(),
      pagination: {
        page: 0, // Invalid
        pageSize: 20,
        total: 100,
        totalPages: 5,
      },
    }

    expect(ApiMetaSchema.safeParse(meta).success).toBe(false)
  })
})

// ============================================================================
// ApiErrorSchema Tests
// ============================================================================

describe('ApiErrorSchema', () => {
  test('accepts minimal error', () => {
    const error: ApiError = {
      code: 'VALIDATION_ERROR',
      message: 'Invalid input',
    }

    const result = ApiErrorSchema.safeParse(error)
    expect(result.success).toBe(true)
  })

  test('accepts full error with all fields', () => {
    const error: ApiError = {
      code: 'VALIDATION_ERROR',
      message: 'Invalid input',
      details: ['Field X is required', 'Field Y must be a number'],
      requestId: 'req-123-abc',
      timestamp: Date.now(),
    }

    const result = ApiErrorSchema.safeParse(error)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(error)
    }
  })

  test('accepts error with string details', () => {
    const error = {
      code: 'AUTH_ERROR',
      message: 'Unauthorized',
      details: 'Token expired',
    }

    expect(ApiErrorSchema.safeParse(error).success).toBe(true)
  })

  test('accepts error with field error details', () => {
    const error = {
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: [
        { field: 'email', message: 'Invalid format' },
        { field: 'age', message: 'Must be positive' },
      ],
    }

    expect(ApiErrorSchema.safeParse(error).success).toBe(true)
  })

  test('rejects missing code', () => {
    expect(ApiErrorSchema.safeParse({ message: 'Error' }).success).toBe(false)
  })

  test('rejects missing message', () => {
    expect(ApiErrorSchema.safeParse({ code: 'ERROR' }).success).toBe(false)
  })
})

// ============================================================================
// createApiResponseSchema Tests
// ============================================================================

describe('createApiResponseSchema', () => {
  test('creates schema for simple data type', () => {
    const schema = createApiResponseSchema(z.string())

    const result = schema.safeParse({ data: 'hello' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.data).toBe('hello')
    }
  })

  test('creates schema for complex data type', () => {
    const UserSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
    })

    const schema = createApiResponseSchema(UserSchema)

    const result = schema.safeParse({
      data: { id: '1', name: 'Alice', email: 'alice@example.com' },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.data.name).toBe('Alice')
    }
  })

  test('allows optional meta', () => {
    const schema = createApiResponseSchema(z.number())

    const withMeta = schema.safeParse({
      data: 42,
      meta: { timestamp: Date.now() },
    })
    expect(withMeta.success).toBe(true)

    const withoutMeta = schema.safeParse({ data: 42 })
    expect(withoutMeta.success).toBe(true)
  })

  test('allows optional error', () => {
    const schema = createApiResponseSchema(z.string())

    const withError = schema.safeParse({
      data: 'success',
      error: { code: 'PARTIAL', message: 'Partial failure' },
    })
    expect(withError.success).toBe(true)
  })

  test('validates data against provided schema', () => {
    const schema = createApiResponseSchema(z.number().positive())

    const valid = schema.safeParse({ data: 42 })
    expect(valid.success).toBe(true)

    const invalid = schema.safeParse({ data: -1 })
    expect(invalid.success).toBe(false)

    const wrongType = schema.safeParse({ data: 'not a number' })
    expect(wrongType.success).toBe(false)
  })

  test('works with array data', () => {
    const schema = createApiResponseSchema(z.array(z.string()))

    const result = schema.safeParse({ data: ['a', 'b', 'c'] })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.data).toHaveLength(3)
    }
  })
})

// ============================================================================
// createPaginatedResponseSchema Tests
// ============================================================================

describe('createPaginatedResponseSchema', () => {
  test('creates schema for paginated items', () => {
    const ItemSchema = z.object({
      id: z.string(),
      value: z.number(),
    })

    const schema = createPaginatedResponseSchema(ItemSchema)

    const result = schema.safeParse({
      data: [
        { id: '1', value: 100 },
        { id: '2', value: 200 },
      ],
      meta: {
        timestamp: Date.now(),
        pagination: {
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
        },
      },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.data).toHaveLength(2)
      expect(result.data.meta.pagination.total).toBe(2)
    }
  })

  test('requires pagination in meta', () => {
    const schema = createPaginatedResponseSchema(z.string())

    // Missing pagination
    const result = schema.safeParse({
      data: ['a', 'b'],
      meta: {
        timestamp: Date.now(),
      },
    })

    expect(result.success).toBe(false)
  })

  test('requires timestamp in meta', () => {
    const schema = createPaginatedResponseSchema(z.string())

    const result = schema.safeParse({
      data: ['a', 'b'],
      meta: {
        pagination: {
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
        },
      },
    })

    expect(result.success).toBe(false)
  })

  test('allows empty data array', () => {
    const schema = createPaginatedResponseSchema(z.string())

    const result = schema.safeParse({
      data: [],
      meta: {
        timestamp: Date.now(),
        pagination: {
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 0,
        },
      },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.data).toHaveLength(0)
    }
  })

  test('validates each item in data array', () => {
    const schema = createPaginatedResponseSchema(z.number().positive())

    const valid = schema.safeParse({
      data: [1, 2, 3],
      meta: {
        timestamp: Date.now(),
        pagination: { page: 1, pageSize: 20, total: 3, totalPages: 1 },
      },
    })
    expect(valid.success).toBe(true)

    const invalid = schema.safeParse({
      data: [1, -1, 3], // -1 is not positive
      meta: {
        timestamp: Date.now(),
        pagination: { page: 1, pageSize: 20, total: 3, totalPages: 1 },
      },
    })
    expect(invalid.success).toBe(false)
  })

  test('allows optional fields in meta', () => {
    const schema = createPaginatedResponseSchema(z.string())

    const result = schema.safeParse({
      data: ['item'],
      meta: {
        timestamp: Date.now(),
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        requestId: 'req-123',
        version: '1.0.0',
      },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.meta.requestId).toBe('req-123')
      expect(result.data.meta.version).toBe('1.0.0')
    }
  })
})

// ============================================================================
// createA2AResponseSchema Tests
// ============================================================================

describe('createA2AResponseSchema', () => {
  test('creates schema with protocol field', () => {
    const schema = createA2AResponseSchema(z.string())

    const result = schema.safeParse({
      data: 'response',
      protocol: 'a2a',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.protocol).toBe('a2a')
    }
  })

  test('requires protocol to be "a2a"', () => {
    const schema = createA2AResponseSchema(z.string())

    const wrong = schema.safeParse({
      data: 'response',
      protocol: 'http',
    })
    expect(wrong.success).toBe(false)

    const missing = schema.safeParse({
      data: 'response',
    })
    expect(missing.success).toBe(false)
  })

  test('allows optional agentId', () => {
    const schema = createA2AResponseSchema(z.number())

    const withAgentId = schema.safeParse({
      data: 42,
      protocol: 'a2a',
      agentId: 'agent-123',
    })
    expect(withAgentId.success).toBe(true)
    if (withAgentId.success) {
      expect(withAgentId.data.agentId).toBe('agent-123')
    }

    const withoutAgentId = schema.safeParse({
      data: 42,
      protocol: 'a2a',
    })
    expect(withoutAgentId.success).toBe(true)
  })

  test('inherits meta and error from base schema', () => {
    const schema = createA2AResponseSchema(z.string())

    const result = schema.safeParse({
      data: 'response',
      protocol: 'a2a',
      meta: { timestamp: Date.now() },
      error: { code: 'WARNING', message: 'Deprecated' },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.meta).toBeDefined()
      expect(result.data.error).toBeDefined()
    }
  })

  test('validates data schema correctly', () => {
    const TaskResultSchema = z.object({
      taskId: z.string(),
      status: z.enum(['success', 'failure']),
      result: z.string().optional(),
    })

    const schema = createA2AResponseSchema(TaskResultSchema)

    const valid = schema.safeParse({
      data: { taskId: 'task-1', status: 'success', result: 'Done!' },
      protocol: 'a2a',
    })
    expect(valid.success).toBe(true)

    const invalid = schema.safeParse({
      data: { taskId: 'task-1', status: 'pending' }, // 'pending' not in enum
      protocol: 'a2a',
    })
    expect(invalid.success).toBe(false)
  })
})
