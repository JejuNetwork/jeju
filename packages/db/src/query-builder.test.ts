/**
 * Query Builder Unit Tests
 */

import { describe, expect, it } from 'bun:test'
import {
  buildOrderByClause,
  buildWhereClause,
  toQueryParam,
} from './query-builder.js'
import type { QueryParam } from './types.js'

describe('buildWhereClause', () => {
  describe('simple equality', () => {
    it('should build simple equality condition', () => {
      const params: QueryParam[] = []
      const { sql, newOffset } = buildWhereClause({ name: 'Alice' }, params)

      expect(sql).toBe('"name" = $1')
      expect(params).toEqual(['Alice'])
      expect(newOffset).toBe(1)
    })

    it('should build multiple equality conditions', () => {
      const params: QueryParam[] = []
      const { sql, newOffset } = buildWhereClause(
        { name: 'Alice', age: 25 },
        params,
      )

      expect(sql).toBe('"name" = $1 AND "age" = $2')
      expect(params).toEqual(['Alice', 25])
      expect(newOffset).toBe(2)
    })

    it('should handle null values', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ deletedAt: null }, params)

      expect(sql).toBe('"deletedAt" IS NULL')
      expect(params).toEqual([])
    })

    it('should skip undefined values', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        { name: 'Alice', age: undefined },
        params,
      )

      expect(sql).toBe('"name" = $1')
      expect(params).toEqual(['Alice'])
    })
  })

  describe('comparison operators', () => {
    it('should handle equals operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ age: { equals: 25 } }, params)

      expect(sql).toBe('"age" = $1')
      expect(params).toEqual([25])
    })

    it('should handle equals null', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ deletedAt: { equals: null } }, params)

      expect(sql).toBe('"deletedAt" IS NULL')
      expect(params).toEqual([])
    })

    it('should handle not operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ status: { not: 'deleted' } }, params)

      expect(sql).toBe('"status" != $1')
      expect(params).toEqual(['deleted'])
    })

    it('should handle not null', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ deletedAt: { not: null } }, params)

      expect(sql).toBe('"deletedAt" IS NOT NULL')
      expect(params).toEqual([])
    })

    it('should handle not.equals', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        { status: { not: { equals: 'deleted' } } },
        params,
      )

      expect(sql).toBe('"status" != $1')
      expect(params).toEqual(['deleted'])
    })

    it('should handle in operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        { status: { in: ['active', 'pending'] } },
        params,
      )

      expect(sql).toBe('"status" IN ($1, $2)')
      expect(params).toEqual(['active', 'pending'])
    })

    it('should handle notIn operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        { status: { notIn: ['deleted', 'banned'] } },
        params,
      )

      expect(sql).toBe('"status" NOT IN ($1, $2)')
      expect(params).toEqual(['deleted', 'banned'])
    })

    it('should handle lt operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ age: { lt: 18 } }, params)

      expect(sql).toBe('"age" < $1')
      expect(params).toEqual([18])
    })

    it('should handle lte operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ age: { lte: 18 } }, params)

      expect(sql).toBe('"age" <= $1')
      expect(params).toEqual([18])
    })

    it('should handle gt operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ age: { gt: 18 } }, params)

      expect(sql).toBe('"age" > $1')
      expect(params).toEqual([18])
    })

    it('should handle gte operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ age: { gte: 18 } }, params)

      expect(sql).toBe('"age" >= $1')
      expect(params).toEqual([18])
    })
  })

  describe('string operators', () => {
    it('should handle contains operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ name: { contains: 'ali' } }, params)

      expect(sql).toBe('"name" LIKE $1')
      expect(params).toEqual(['%ali%'])
    })

    it('should handle contains with insensitive mode', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        { name: { contains: 'ali', mode: 'insensitive' } },
        params,
      )

      expect(sql).toBe('"name" ILIKE $1')
      expect(params).toEqual(['%ali%'])
    })

    it('should handle startsWith operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ name: { startsWith: 'Al' } }, params)

      expect(sql).toBe('"name" LIKE $1')
      expect(params).toEqual(['Al%'])
    })

    it('should handle endsWith operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ name: { endsWith: 'ce' } }, params)

      expect(sql).toBe('"name" LIKE $1')
      expect(params).toEqual(['%ce'])
    })
  })

  describe('logical operators', () => {
    it('should handle AND operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        { AND: [{ name: 'Alice' }, { age: { gte: 18 } }] },
        params,
      )

      expect(sql).toBe('(("name" = $1) AND ("age" >= $2))')
      expect(params).toEqual(['Alice', 18])
    })

    it('should handle OR operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        { OR: [{ name: 'Alice' }, { name: 'Bob' }] },
        params,
      )

      expect(sql).toBe('(("name" = $1) OR ("name" = $2))')
      expect(params).toEqual(['Alice', 'Bob'])
    })

    it('should handle NOT operator', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({ NOT: { status: 'deleted' } }, params)

      expect(sql).toBe('NOT ("status" = $1)')
      expect(params).toEqual(['deleted'])
    })

    it('should handle nested logical operators', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(
        {
          AND: [
            { status: 'active' },
            { OR: [{ age: { gte: 18 } }, { verified: true }] },
          ],
        },
        params,
      )

      expect(sql).toBe(
        '(("status" = $1) AND ((("age" >= $2) OR ("verified" = $3))))',
      )
      expect(params).toEqual(['active', 18, true])
    })
  })

  describe('param offset', () => {
    it('should respect initial param offset', () => {
      const params: QueryParam[] = ['existing']
      const { sql, newOffset } = buildWhereClause({ name: 'Alice' }, params, 1)

      expect(sql).toBe('"name" = $2')
      expect(params).toEqual(['existing', 'Alice'])
      expect(newOffset).toBe(2)
    })
  })

  describe('empty where', () => {
    it('should return empty string for undefined where', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause(undefined, params)

      expect(sql).toBe('')
      expect(params).toEqual([])
    })

    it('should return empty string for empty object', () => {
      const params: QueryParam[] = []
      const { sql } = buildWhereClause({}, params)

      expect(sql).toBe('')
      expect(params).toEqual([])
    })
  })
})

describe('buildOrderByClause', () => {
  it('should build single column order', () => {
    const result = buildOrderByClause({ name: 'asc' })
    expect(result).toBe(' ORDER BY "name" ASC')
  })

  it('should build descending order', () => {
    const result = buildOrderByClause({ createdAt: 'desc' })
    expect(result).toBe(' ORDER BY "createdAt" DESC')
  })

  it('should build multiple column order', () => {
    const result = buildOrderByClause({ lastName: 'asc', firstName: 'asc' })
    expect(result).toBe(' ORDER BY "lastName" ASC, "firstName" ASC')
  })

  it('should handle array of orderBy objects', () => {
    const result = buildOrderByClause([
      { lastName: 'asc' },
      { firstName: 'asc' },
    ])
    expect(result).toBe(' ORDER BY "lastName" ASC, "firstName" ASC')
  })

  it('should return empty string for undefined', () => {
    const result = buildOrderByClause(undefined)
    expect(result).toBe('')
  })

  it('should return empty string for empty object', () => {
    const result = buildOrderByClause({})
    expect(result).toBe('')
  })
})

describe('toQueryParam', () => {
  it('should pass through primitives', () => {
    expect(toQueryParam('hello')).toBe('hello')
    expect(toQueryParam(42)).toBe(42)
    expect(toQueryParam(true)).toBe(true)
    expect(toQueryParam(null)).toBe(null)
    expect(toQueryParam(123n)).toBe(123n)
  })

  it('should pass through Uint8Array', () => {
    const bytes = new Uint8Array([1, 2, 3])
    expect(toQueryParam(bytes)).toBe(bytes)
  })

  it('should convert Date to ISO string', () => {
    const date = new Date('2024-01-01T00:00:00Z')
    expect(toQueryParam(date)).toBe('2024-01-01T00:00:00.000Z')
  })

  it('should stringify objects as JSON', () => {
    const obj = { foo: 'bar' }
    expect(toQueryParam(obj)).toBe('{"foo":"bar"}')
  })

  it('should stringify arrays as JSON', () => {
    const arr = [1, 2, 3]
    expect(toQueryParam(arr)).toBe('[1,2,3]')
  })
})
