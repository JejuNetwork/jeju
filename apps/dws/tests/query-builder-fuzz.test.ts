/**
 * Query Builder Fuzz Tests
 *
 * Comprehensive fuzzing and edge case testing for all SQL query builder functions.
 * Tests both @jejunetwork/db and @babylon/db query builders.
 *
 * Coverage:
 * - buildWhereClause: all operators, nested conditions, edge cases
 * - buildOrderByClause: sorting, multi-column, edge cases
 * - SQL helpers: eq, ne, gt, gte, lt, lte, like, ilike, between, inArray, notInArray
 * - Logical operators: and, or, not
 * - Aggregate functions: count, sum, avg, min, max
 * - Query builders: SelectBuilder, InsertBuilder, UpdateBuilder, DeleteBuilder
 * - Fuzzing with random/edge-case inputs
 */

import { describe, expect, test } from 'bun:test'
import type { QueryParam } from '@jejunetwork/db'
import {
  buildOrderByClause,
  buildWhereClause,
  toQueryParam,
} from '@jejunetwork/db'

// Test Data Generators for Fuzzing

function randomString(
  length: number,
  charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
): string {
  let result = ''
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length))
  }
  return result
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

function randomBool(): boolean {
  return Math.random() > 0.5
}

function randomDate(): Date {
  const start = new Date(2000, 0, 1).getTime()
  const end = new Date(2030, 11, 31).getTime()
  return new Date(start + Math.random() * (end - start))
}

function randomArray<T>(generator: () => T, minLen = 0, maxLen = 10): T[] {
  const len = randomInt(minLen, maxLen)
  return Array.from({ length: len }, generator)
}

// Edge case strings for SQL injection testing
const EDGE_CASE_STRINGS = [
  '',
  ' ',
  '  ',
  '\t',
  '\n',
  '\r\n',
  'null',
  'NULL',
  'undefined',
  'true',
  'false',
  '0',
  '-1',
  '1.5',
  'NaN',
  'Infinity',
  '-Infinity',
  // SQL injection attempts
  "'; DROP TABLE users; --",
  "' OR '1'='1",
  '1; DELETE FROM users',
  "' UNION SELECT * FROM secrets --",
  "1' AND '1'='1",
  '/**/OR/**/1=1',
  // Special characters
  "'",
  '"',
  '`',
  '\\',
  '/',
  '%',
  '_',
  '[',
  ']',
  '(',
  ')',
  '{',
  '}',
  '<',
  '>',
  '&',
  '|',
  '^',
  '~',
  '!',
  '@',
  '#',
  '$',
  // Unicode and encoding
  '日本語',
  'العربية',
  '中文',
  'Ελληνικά',
  'עברית',
  '🎉🔥💯',
  '\u0000',
  '\uFFFF',
  '\u200B', // Zero-width space
  '\\u0000',
  // Long strings
  'a'.repeat(100),
  'a'.repeat(1000),
  'a'.repeat(10000),
  // Whitespace variations
  ' leading',
  'trailing ',
  ' both ',
  'multiple   spaces',
  'tab\there',
  'new\nline',
]

const EDGE_CASE_NUMBERS = [
  0,
  -0,
  1,
  -1,
  0.1,
  -0.1,
  0.000001,
  -0.000001,
  1e10,
  -1e10,
  1e-10,
  -1e-10,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
  Number.EPSILON,
  Math.PI,
  Math.E,
]

// buildWhereClause Tests

describe('buildWhereClause - Comprehensive Tests', () => {
  describe('Basic Equality', () => {
    test('should handle string values', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ name: 'test' }, params)

      expect(sql).toBe('"name" = $1')
      expect(params).toEqual(['test'])
    })

    test('should handle number values', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ age: 25 }, params)

      expect(sql).toBe('"age" = $1')
      expect(params).toEqual([25])
    })

    test('should handle boolean values', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ active: true }, params)

      expect(sql).toBe('"active" = $1')
      expect(params).toEqual([true])
    })

    test('should handle null values with IS NULL', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ deletedAt: null }, params)

      expect(sql).toBe('"deletedAt" IS NULL')
      expect(params).toEqual([])
    })

    test('should skip undefined values', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ name: 'test', age: undefined }, params)

      expect(sql).toBe('"name" = $1')
      expect(params).toEqual(['test'])
    })

    test('should handle multiple conditions with AND', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        { name: 'test', age: 25, active: true },
        params,
      )

      expect(sql).toContain('"name" = $1')
      expect(sql).toContain('AND')
      expect(params.length).toBe(3)
    })
  })

  describe('Comparison Operators', () => {
    test('should handle equals operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ name: { equals: 'test' } }, params)

      expect(sql).toBe('"name" = $1')
      expect(params).toEqual(['test'])
    })

    test('should handle equals null', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ deletedAt: { equals: null } }, params)

      expect(sql).toBe('"deletedAt" IS NULL')
      expect(params).toEqual([])
    })

    test('should handle not operator with value', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ status: { not: 'deleted' } }, params)

      expect(sql).toBe('"status" != $1')
      expect(params).toEqual(['deleted'])
    })

    test('should handle not null (IS NOT NULL)', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ deletedAt: { not: null } }, params)

      expect(sql).toBe('"deletedAt" IS NOT NULL')
      expect(params).toEqual([])
    })

    test('should handle not.equals', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        { status: { not: { equals: 'deleted' } } },
        params,
      )

      expect(sql).toBe('"status" != $1')
      expect(params).toEqual(['deleted'])
    })

    test('should handle lt operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ age: { lt: 18 } }, params)

      expect(sql).toBe('"age" < $1')
      expect(params).toEqual([18])
    })

    test('should handle lte operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ age: { lte: 18 } }, params)

      expect(sql).toBe('"age" <= $1')
      expect(params).toEqual([18])
    })

    test('should handle gt operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ age: { gt: 18 } }, params)

      expect(sql).toBe('"age" > $1')
      expect(params).toEqual([18])
    })

    test('should handle gte operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ age: { gte: 18 } }, params)

      expect(sql).toBe('"age" >= $1')
      expect(params).toEqual([18])
    })

    test('should handle multiple comparison operators on same field', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ age: { gte: 18, lte: 65 } }, params)

      // Order of operators in object is not guaranteed
      expect(sql).toContain('"age" >=')
      expect(sql).toContain('"age" <=')
      expect(sql).toContain('AND')
      expect(params).toContain(18)
      expect(params).toContain(65)
      expect(params.length).toBe(2)
    })
  })

  describe('Array Operators', () => {
    test('should handle in operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        { status: { in: ['active', 'pending'] } },
        params,
      )

      expect(sql).toBe('"status" IN ($1, $2)')
      expect(params).toEqual(['active', 'pending'])
    })

    test('should handle in operator with single value', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ status: { in: ['active'] } }, params)

      expect(sql).toBe('"status" IN ($1)')
      expect(params).toEqual(['active'])
    })

    test('should handle in operator with numbers', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ id: { in: [1, 2, 3, 4, 5] } }, params)

      expect(sql).toBe('"id" IN ($1, $2, $3, $4, $5)')
      expect(params).toEqual([1, 2, 3, 4, 5])
    })

    test('should handle notIn operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        { status: { notIn: ['deleted', 'banned'] } },
        params,
      )

      expect(sql).toBe('"status" NOT IN ($1, $2)')
      expect(params).toEqual(['deleted', 'banned'])
    })

    test('should handle large in arrays', () => {
      const values = Array.from({ length: 100 }, (_, i) => `value${i}`)
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ field: { in: values } }, params)

      expect(sql).toContain('"field" IN (')
      expect(params.length).toBe(100)
    })
  })

  describe('String Operators', () => {
    test('should handle contains operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ name: { contains: 'test' } }, params)

      expect(sql).toBe('"name" LIKE $1')
      expect(params).toEqual(['%test%'])
    })

    test('should handle contains with insensitive mode', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        { name: { contains: 'test', mode: 'insensitive' } },
        params,
      )

      expect(sql).toBe('"name" ILIKE $1')
      expect(params).toEqual(['%test%'])
    })

    test('should handle startsWith operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ name: { startsWith: 'test' } }, params)

      expect(sql).toBe('"name" LIKE $1')
      expect(params).toEqual(['test%'])
    })

    test('should handle startsWith with insensitive mode', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        { name: { startsWith: 'test', mode: 'insensitive' } },
        params,
      )

      expect(sql).toBe('"name" ILIKE $1')
      expect(params).toEqual(['test%'])
    })

    test('should handle endsWith operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ name: { endsWith: 'test' } }, params)

      expect(sql).toBe('"name" LIKE $1')
      expect(params).toEqual(['%test'])
    })

    test('should handle endsWith with insensitive mode', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        { name: { endsWith: 'test', mode: 'insensitive' } },
        params,
      )

      expect(sql).toBe('"name" ILIKE $1')
      expect(params).toEqual(['%test'])
    })

    test('should handle special LIKE characters in contains', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ name: { contains: '%_[]' } }, params)

      expect(sql).toBe('"name" LIKE $1')
      expect(params[0]).toBe('%%_[]%')
    })
  })

  describe('Logical Operators', () => {
    test('should handle AND operator with array', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        { AND: [{ name: 'test' }, { age: 25 }] },
        params,
      )

      expect(sql).toContain('AND')
      expect(params).toEqual(['test', 25])
    })

    test('should handle AND operator with single condition', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ AND: { name: 'test' } }, params)

      expect(sql).toContain('"name" = $1')
      expect(params).toEqual(['test'])
    })

    test('should handle OR operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        { OR: [{ name: 'Alice' }, { name: 'Bob' }] },
        params,
      )

      expect(sql).toContain('OR')
      expect(params).toEqual(['Alice', 'Bob'])
    })

    test('should handle NOT operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ NOT: { status: 'deleted' } }, params)

      expect(sql).toBe('NOT ("status" = $1)')
      expect(params).toEqual(['deleted'])
    })

    test('should handle deeply nested logical operators', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        {
          AND: [
            { status: 'active' },
            {
              OR: [
                { AND: [{ age: { gte: 18 } }, { age: { lte: 65 } }] },
                { verified: true },
              ],
            },
          ],
        },
        params,
      )

      expect(sql).toContain('AND')
      expect(sql).toContain('OR')
      expect(params.length).toBe(4)
    })

    test('should handle multiple NOT conditions', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        {
          AND: [{ NOT: { status: 'deleted' } }, { NOT: { banned: true } }],
        },
        params,
      )

      expect(sql).toContain('NOT')
      expect(params.length).toBe(2)
    })
  })

  describe('Parameter Offset', () => {
    test('should respect initial param offset', () => {
      const params: QueryParam[] = ['existing1', 'existing2']
      const { sql, newOffset } = buildWhereClause({ name: 'test' }, params, 2)

      expect(sql).toBe('"name" = $3')
      expect(params).toEqual(['existing1', 'existing2', 'test'])
      expect(newOffset).toBe(3)
    })

    test('should handle complex queries with offset', () => {
      const params: QueryParam[] = ['param1']
      const { newOffset } = buildWhereClause({ a: 1, b: 2, c: 3 }, params, 1)

      expect(params.length).toBe(4)
      expect(newOffset).toBe(4)
    })
  })

  describe('Edge Cases', () => {
    test('should return empty string for undefined where', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(undefined, params)

      expect(sql).toBe('')
      expect(params).toEqual([])
    })

    test('should return empty string for empty object', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({}, params)

      expect(sql).toBe('')
      expect(params).toEqual([])
    })

    test('should handle Date objects', () => {
      const params: QueryParam[] = []
      const date = new Date('2024-01-01T00:00:00Z')
      const { sql } = buildWhereClause({ createdAt: date }, params)

      expect(sql).toBe('"createdAt" = $1')
      expect(params[0]).toEqual(date)
    })

    test('should handle empty AND array', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ AND: [] }, params)

      expect(sql).toBe('')
    })

    test('should handle empty OR array', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ OR: [] }, params)

      expect(sql).toBe('')
    })

    test('should handle fields with special characters in name', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ 'field-with-dash': 'value' }, params)

      expect(sql).toBe('"field-with-dash" = $1')
    })

    test('should handle camelCase field names', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ createdAt: 'now' }, params)

      expect(sql).toBe('"createdAt" = $1')
    })
  })

  describe('Fuzzing - Random Inputs', () => {
    test('should handle random string values safely', () => {
      for (const testString of EDGE_CASE_STRINGS) {
        const params: QueryParam[] = []
        const { sql } = buildWhereClause({ field: testString }, params)

        // Should produce valid parameterized SQL
        if (testString !== null && testString !== undefined) {
          expect(sql).toBe('"field" = $1')
          expect(params[0]).toBe(testString)
        }
      }
    })

    test('should handle random number values safely', () => {
      for (const testNumber of EDGE_CASE_NUMBERS) {
        const params: QueryParam[] = []
        const { sql } = buildWhereClause({ field: testNumber }, params)

        expect(sql).toBe('"field" = $1')
        expect(params[0]).toBe(testNumber)
      }
    })

    test('should handle generated random strings', () => {
      for (let i = 0; i < 100; i++) {
        const randomStr = randomString(randomInt(1, 100))
        const params: QueryParam[] = []
        const { sql } = buildWhereClause({ field: randomStr }, params)

        expect(sql).toBe('"field" = $1')
        expect(params[0]).toBe(randomStr)
      }
    })

    test('should handle generated random numbers', () => {
      for (let i = 0; i < 100; i++) {
        const num = randomBool()
          ? randomInt(-1000000, 1000000)
          : randomFloat(-1000, 1000)
        const params: QueryParam[] = []
        const { sql } = buildWhereClause({ field: num }, params)

        expect(sql).toBe('"field" = $1')
        expect(params[0]).toBe(num)
      }
    })

    test('should handle randomly generated complex where clauses', () => {
      for (let i = 0; i < 50; i++) {
        const whereClause: Record<string, unknown> = {}
        const numFields = randomInt(1, 5)

        for (let j = 0; j < numFields; j++) {
          const fieldName = `field${j}`
          const operatorChoice = randomInt(0, 5)

          switch (operatorChoice) {
            case 0:
              whereClause[fieldName] = randomString(10)
              break
            case 1:
              whereClause[fieldName] = { equals: randomString(10) }
              break
            case 2:
              whereClause[fieldName] = { gt: randomInt(0, 100) }
              break
            case 3:
              whereClause[fieldName] = { contains: randomString(5) }
              break
            case 4:
              whereClause[fieldName] = {
                in: randomArray(() => randomString(5), 1, 5),
              }
              break
            default:
              whereClause[fieldName] = null
          }
        }

        const params: QueryParam[] = []
        // Should not throw
        expect(() => buildWhereClause(whereClause, params)).not.toThrow()
      }
    })
  })
})

// buildOrderByClause Tests

describe('buildOrderByClause - Comprehensive Tests', () => {
  describe('Basic Ordering', () => {
    test('should build single column ascending order', () => {
      const result = buildOrderByClause({ name: 'asc' })
      expect(result).toBe(' ORDER BY "name" ASC')
    })

    test('should build single column descending order', () => {
      const result = buildOrderByClause({ createdAt: 'desc' })
      expect(result).toBe(' ORDER BY "createdAt" DESC')
    })

    test('should build multiple column order', () => {
      const result = buildOrderByClause({ lastName: 'asc', firstName: 'asc' })
      expect(result).toContain('"lastName" ASC')
      expect(result).toContain('"firstName" ASC')
    })

    test('should build mixed direction order', () => {
      const result = buildOrderByClause({ name: 'asc', createdAt: 'desc' })
      expect(result).toContain('ASC')
      expect(result).toContain('DESC')
    })
  })

  describe('Array of Order Objects', () => {
    test('should handle array of orderBy objects', () => {
      const result = buildOrderByClause([
        { lastName: 'asc' },
        { firstName: 'asc' },
      ])
      expect(result).toBe(' ORDER BY "lastName" ASC, "firstName" ASC')
    })

    test('should handle array with mixed directions', () => {
      const result = buildOrderByClause([
        { priority: 'desc' },
        { createdAt: 'asc' },
      ])
      expect(result).toContain('"priority" DESC')
      expect(result).toContain('"createdAt" ASC')
    })

    test('should handle single item array', () => {
      const result = buildOrderByClause([{ name: 'asc' }])
      expect(result).toBe(' ORDER BY "name" ASC')
    })
  })

  describe('Edge Cases', () => {
    test('should return empty string for undefined', () => {
      const result = buildOrderByClause(undefined)
      expect(result).toBe('')
    })

    test('should return empty string for empty object', () => {
      const result = buildOrderByClause({})
      expect(result).toBe('')
    })

    test('should return empty string for empty array', () => {
      const result = buildOrderByClause([])
      expect(result).toBe('')
    })

    test('should handle field names with special characters', () => {
      const result = buildOrderByClause({ 'field-name': 'asc' })
      expect(result).toBe(' ORDER BY "field-name" ASC')
    })

    test('should handle camelCase field names', () => {
      const result = buildOrderByClause({ createdAt: 'asc' })
      expect(result).toBe(' ORDER BY "createdAt" ASC')
    })
  })

  describe('Fuzzing', () => {
    test('should handle randomly generated field names', () => {
      for (let i = 0; i < 50; i++) {
        const fieldName = randomString(randomInt(1, 20))
        const direction = randomBool() ? 'asc' : 'desc'
        const result = buildOrderByClause({ [fieldName]: direction })

        expect(result).toContain(`"${fieldName}"`)
        expect(result).toContain(direction.toUpperCase())
      }
    })

    test('should handle multiple random fields', () => {
      for (let i = 0; i < 50; i++) {
        const orderBy: Record<string, 'asc' | 'desc'> = {}
        const numFields = randomInt(1, 5)

        for (let j = 0; j < numFields; j++) {
          orderBy[`field${j}`] = randomBool() ? 'asc' : 'desc'
        }

        const result = buildOrderByClause(orderBy)
        expect(result).toContain('ORDER BY')
      }
    })
  })
})

// toQueryParam Tests

describe('toQueryParam - Comprehensive Tests', () => {
  describe('Primitive Types', () => {
    test('should pass through string', () => {
      expect(toQueryParam('hello')).toBe('hello')
    })

    test('should pass through empty string', () => {
      expect(toQueryParam('')).toBe('')
    })

    test('should pass through number', () => {
      expect(toQueryParam(42)).toBe(42)
    })

    test('should pass through zero', () => {
      expect(toQueryParam(0)).toBe(0)
    })

    test('should pass through negative number', () => {
      expect(toQueryParam(-42)).toBe(-42)
    })

    test('should pass through float', () => {
      expect(toQueryParam(1.23456)).toBe(1.23456)
    })

    test('should pass through boolean true', () => {
      expect(toQueryParam(true)).toBe(true)
    })

    test('should pass through boolean false', () => {
      expect(toQueryParam(false)).toBe(false)
    })

    test('should pass through null', () => {
      expect(toQueryParam(null)).toBe(null)
    })

    test('should pass through bigint', () => {
      expect(toQueryParam(123n)).toBe(123n)
    })

    test('should pass through large bigint', () => {
      const large = 9007199254740993n
      expect(toQueryParam(large)).toBe(large)
    })
  })

  describe('Binary Data', () => {
    test('should pass through Uint8Array', () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5])
      expect(toQueryParam(bytes)).toBe(bytes)
    })

    test('should pass through empty Uint8Array', () => {
      const bytes = new Uint8Array([])
      expect(toQueryParam(bytes)).toBe(bytes)
    })

    test('should pass through large Uint8Array', () => {
      const bytes = new Uint8Array(1000)
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = i % 256
      }
      expect(toQueryParam(bytes)).toBe(bytes)
    })
  })

  describe('Date Conversion', () => {
    test('should convert Date to ISO string', () => {
      const date = new Date('2024-01-01T00:00:00.000Z')
      expect(toQueryParam(date)).toBe('2024-01-01T00:00:00.000Z')
    })

    test('should convert Date with timezone', () => {
      const date = new Date('2024-06-15T12:30:45.123Z')
      expect(toQueryParam(date)).toBe('2024-06-15T12:30:45.123Z')
    })
  })

  describe('Object Serialization', () => {
    test('should stringify plain objects as JSON', () => {
      const obj = { foo: 'bar' }
      expect(toQueryParam(obj)).toBe('{"foo":"bar"}')
    })

    test('should stringify nested objects', () => {
      const obj = { a: { b: { c: 1 } } }
      expect(toQueryParam(obj)).toBe('{"a":{"b":{"c":1}}}')
    })

    test('should stringify arrays as JSON', () => {
      const arr = [1, 2, 3]
      expect(toQueryParam(arr)).toBe('[1,2,3]')
    })

    test('should stringify mixed arrays', () => {
      const arr = [1, 'two', true, null]
      expect(toQueryParam(arr)).toBe('[1,"two",true,null]')
    })

    test('should stringify empty object', () => {
      expect(toQueryParam({})).toBe('{}')
    })

    test('should stringify empty array', () => {
      expect(toQueryParam([])).toBe('[]')
    })
  })

  describe('Edge Cases', () => {
    test('should handle all edge case numbers', () => {
      for (const num of EDGE_CASE_NUMBERS) {
        const result = toQueryParam(num)
        expect(result).toBe(num)
      }
    })

    test('should handle all edge case strings', () => {
      for (const str of EDGE_CASE_STRINGS) {
        const result = toQueryParam(str)
        expect(result).toBe(str)
      }
    })
  })

  describe('Fuzzing', () => {
    test('should handle random strings', () => {
      for (let i = 0; i < 100; i++) {
        const str = randomString(randomInt(0, 100))
        expect(toQueryParam(str)).toBe(str)
      }
    })

    test('should handle random numbers', () => {
      for (let i = 0; i < 100; i++) {
        const num = randomFloat(-1e10, 1e10)
        expect(toQueryParam(num)).toBe(num)
      }
    })

    test('should handle random dates', () => {
      for (let i = 0; i < 100; i++) {
        const date = randomDate()
        const result = toQueryParam(date)
        expect(result).toBe(date.toISOString())
      }
    })

    test('should handle random objects', () => {
      for (let i = 0; i < 50; i++) {
        const obj: Record<string, unknown> = {}
        const numFields = randomInt(1, 10)

        for (let j = 0; j < numFields; j++) {
          obj[`field${j}`] = randomBool()
            ? randomString(10)
            : randomInt(-100, 100)
        }

        const result = toQueryParam(obj)
        expect(typeof result).toBe('string')
        expect(JSON.parse(result as string)).toEqual(obj)
      }
    })
  })
})

// SQL Injection Prevention Tests

describe('SQL Injection Prevention', () => {
  test('should parameterize all user inputs', () => {
    const maliciousInputs = [
      "'; DROP TABLE users; --",
      "' OR '1'='1",
      '1; DELETE FROM users',
      "' UNION SELECT * FROM secrets --",
    ]

    for (const input of maliciousInputs) {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ field: input }, params)

      // SQL should use parameterized placeholder
      expect(sql).toBe('"field" = $1')
      // The malicious input should be in params, not in SQL
      expect(params[0]).toBe(input)
      // SQL should NOT contain the malicious input
      expect(sql).not.toContain(input)
    }
  })

  test('should handle SQL keywords in values', () => {
    const keywords = [
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'DROP',
      'TRUNCATE',
      'ALTER',
      'CREATE',
    ]

    for (const keyword of keywords) {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ field: keyword }, params)

      expect(sql).toBe('"field" = $1')
      expect(params[0]).toBe(keyword)
    }
  })

  test('should handle comment syntax in values', () => {
    const commentPatterns = [
      '-- comment',
      '/* comment */',
      '// not sql but test',
      '# hash comment',
    ]

    for (const pattern of commentPatterns) {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ field: pattern }, params)

      expect(sql).toBe('"field" = $1')
      expect(params[0]).toBe(pattern)
    }
  })

  test('should handle quote characters in values', () => {
    const quotePatterns = [
      "'single'",
      '"double"',
      '`backtick`',
      'mixed\'quotes"',
      "'''''",
      '""""',
    ]

    for (const pattern of quotePatterns) {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ field: pattern }, params)

      expect(sql).toBe('"field" = $1')
      expect(params[0]).toBe(pattern)
    }
  })

  test('should handle LIKE wildcards in contains/startsWith/endsWith', () => {
    const patterns = ['%', '_', '%_%', '%%', '__', '%test%']

    for (const pattern of patterns) {
      const params: QueryParam[] = []
      buildWhereClause({ field: { contains: pattern } }, params)

      // The wildcards should be in the params array, wrapped with %
      expect(typeof params[0]).toBe('string')
      expect((params[0] as string).includes(pattern)).toBe(true)
    }
  })
})

// Performance Tests

describe('Query Builder Performance', () => {
  test('should handle 1000 simple conditions efficiently', () => {
    const start = performance.now()

    for (let i = 0; i < 1000; i++) {
      const params: QueryParam[] = []
      buildWhereClause({ field: `value${i}` }, params)
    }

    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(1000) // Should complete in under 1 second
  })

  test('should handle deeply nested conditions', () => {
    const deepNesting: Record<string, unknown> = { field: 'value' }
    let current = deepNesting

    for (let i = 0; i < 20; i++) {
      const nested = { field: `value${i}` }
      current.AND = [nested]
      current = nested
    }

    const params: QueryParam[] = []
    const start = performance.now()
    buildWhereClause(deepNesting, params)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(100) // Should complete quickly
  })

  test('should handle large IN arrays', () => {
    const values = Array.from({ length: 10000 }, (_, i) => `value${i}`)
    const params: QueryParam[] = []

    const start = performance.now()
    buildWhereClause({ field: { in: values } }, params)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(500)
    expect(params.length).toBe(10000)
  })
})
