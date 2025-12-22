/**
 * Drizzle Adapter Unit Tests
 *
 * Tests for the sql template literal function which is a non-trivial
 * parameterized query builder.
 */

import { describe, expect, it } from 'bun:test'
import { sql } from './drizzle.js'

describe('sql template literal', () => {
  describe('basic queries', () => {
    it('should create query with no parameters', () => {
      const query = sql`SELECT * FROM users`
      const { sql: sqlStr, params } = query.toQuery()

      expect(sqlStr).toBe('SELECT * FROM users')
      expect(params).toEqual([])
    })

    it('should create query with single parameter', () => {
      const id = 42
      const query = sql`SELECT * FROM users WHERE id = ${id}`
      const { sql: sqlStr, params } = query.toQuery()

      expect(sqlStr).toBe('SELECT * FROM users WHERE id = ?')
      expect(params).toEqual([42])
    })

    it('should create query with multiple parameters', () => {
      const name = 'John'
      const age = 25
      const query = sql`SELECT * FROM users WHERE name = ${name} AND age > ${age}`
      const { sql: sqlStr, params } = query.toQuery()

      expect(sqlStr).toBe('SELECT * FROM users WHERE name = ? AND age > ?')
      expect(params).toEqual(['John', 25])
    })
  })

  describe('parameter types', () => {
    it('should handle string parameters', () => {
      const email = 'user@example.com'
      const query = sql`SELECT * FROM users WHERE email = ${email}`
      const { params } = query.toQuery()

      expect(params).toEqual(['user@example.com'])
    })

    it('should handle number parameters', () => {
      const price = 99.99
      const query = sql`SELECT * FROM products WHERE price < ${price}`
      const { params } = query.toQuery()

      expect(params).toEqual([99.99])
    })

    it('should handle boolean parameters', () => {
      const isActive = true
      const query = sql`SELECT * FROM users WHERE active = ${isActive}`
      const { params } = query.toQuery()

      expect(params).toEqual([true])
    })

    it('should handle null parameters', () => {
      const value = null
      const query = sql`UPDATE users SET deleted_at = ${value}`
      const { params } = query.toQuery()

      expect(params).toEqual([null])
    })

    it('should handle bigint parameters', () => {
      const bigId = 9007199254740993n
      const query = sql`SELECT * FROM ledger WHERE id = ${bigId}`
      const { params } = query.toQuery()

      expect(params).toEqual([9007199254740993n])
    })

    it('should handle Uint8Array parameters', () => {
      const hash = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
      const query = sql`SELECT * FROM blocks WHERE hash = ${hash}`
      const { params } = query.toQuery()

      expect(params[0]).toBeInstanceOf(Uint8Array)
      expect(params[0]).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
    })
  })

  describe('complex queries', () => {
    it('should handle INSERT with multiple values', () => {
      const name = 'Alice'
      const email = 'alice@example.com'
      const age = 30
      const query = sql`INSERT INTO users (name, email, age) VALUES (${name}, ${email}, ${age})`
      const { sql: sqlStr, params } = query.toQuery()

      expect(sqlStr).toBe(
        'INSERT INTO users (name, email, age) VALUES (?, ?, ?)',
      )
      expect(params).toEqual(['Alice', 'alice@example.com', 30])
    })

    it('should handle UPDATE with multiple columns', () => {
      const newName = 'Bob'
      const newAge = 35
      const id = 1
      const query = sql`UPDATE users SET name = ${newName}, age = ${newAge} WHERE id = ${id}`
      const { sql: sqlStr, params } = query.toQuery()

      expect(sqlStr).toBe('UPDATE users SET name = ?, age = ? WHERE id = ?')
      expect(params).toEqual(['Bob', 35, 1])
    })

    it('should handle DELETE with condition', () => {
      const userId = 123
      const query = sql`DELETE FROM posts WHERE user_id = ${userId}`
      const { sql: sqlStr, params } = query.toQuery()

      expect(sqlStr).toBe('DELETE FROM posts WHERE user_id = ?')
      expect(params).toEqual([123])
    })

    it('should handle JOIN queries', () => {
      const minAge = 18
      const query = sql`
        SELECT u.*, p.title
        FROM users u
        JOIN posts p ON p.user_id = u.id
        WHERE u.age >= ${minAge}
      `
      const { sql: sqlStr, params } = query.toQuery()

      expect(sqlStr).toContain('WHERE u.age >= ?')
      expect(params).toEqual([18])
    })

    it('should handle subqueries', () => {
      const status = 'active'
      const limit = 10
      const query = sql`
        SELECT * FROM orders
        WHERE user_id IN (SELECT id FROM users WHERE status = ${status})
        LIMIT ${limit}
      `
      const { sql: sqlStr, params } = query.toQuery()

      expect(sqlStr).toContain('WHERE status = ?')
      expect(sqlStr).toContain('LIMIT ?')
      expect(params).toEqual(['active', 10])
    })
  })

  describe('edge cases', () => {
    it('should handle empty template literal', () => {
      const query = sql``
      const { sql: sqlStr, params } = query.toQuery()

      expect(sqlStr).toBe('')
      expect(params).toEqual([])
    })

    it('should handle query with only parameters', () => {
      const a = 1
      const b = 2
      const query = sql`${a}${b}`
      const { sql: sqlStr, params } = query.toQuery()

      expect(sqlStr).toBe('??')
      expect(params).toEqual([1, 2])
    })

    it('should preserve whitespace in SQL', () => {
      const id = 1
      const query = sql`SELECT    *    FROM    users    WHERE    id = ${id}`
      const { sql: sqlStr } = query.toQuery()

      expect(sqlStr).toBe('SELECT    *    FROM    users    WHERE    id = ?')
    })

    it('should handle newlines in template', () => {
      const id = 1
      const query = sql`
        SELECT *
        FROM users
        WHERE id = ${id}
      `
      const { sql: sqlStr, params } = query.toQuery()

      expect(sqlStr).toContain('\n')
      expect(sqlStr).toContain('WHERE id = ?')
      expect(params).toEqual([1])
    })

    it('should handle parameter at the end', () => {
      const limit = 50
      const query = sql`SELECT * FROM users LIMIT ${limit}`
      const { sql: sqlStr, params } = query.toQuery()

      expect(sqlStr).toBe('SELECT * FROM users LIMIT ?')
      expect(params).toEqual([50])
    })

    it('should handle parameter at the start', () => {
      const tableName = 'users'
      // Note: This is for testing the template, not recommended SQL practice
      const query = sql`${tableName} has data`
      const { sql: sqlStr, params } = query.toQuery()

      expect(sqlStr).toBe('? has data')
      expect(params).toEqual(['users'])
    })
  })

  describe('special characters', () => {
    it('should handle parameters with special SQL characters', () => {
      const name = "O'Brien"
      const query = sql`SELECT * FROM users WHERE name = ${name}`
      const { params } = query.toQuery()

      // The parameter should be passed as-is, escaping is done by the database
      expect(params).toEqual(["O'Brien"])
    })

    it('should handle parameters with percent signs', () => {
      const pattern = '%admin%'
      const query = sql`SELECT * FROM users WHERE role LIKE ${pattern}`
      const { params } = query.toQuery()

      expect(params).toEqual(['%admin%'])
    })

    it('should handle unicode in parameters', () => {
      const name = '日本語テスト'
      const query = sql`INSERT INTO users (name) VALUES (${name})`
      const { params } = query.toQuery()

      expect(params).toEqual(['日本語テスト'])
    })

    it('should handle emoji in parameters', () => {
      const content = 'Hello 👋 World 🌍'
      const query = sql`INSERT INTO posts (content) VALUES (${content})`
      const { params } = query.toQuery()

      expect(params).toEqual(['Hello 👋 World 🌍'])
    })
  })

  describe('numeric edge cases', () => {
    it('should handle zero', () => {
      const value = 0
      const query = sql`SELECT * FROM items WHERE count = ${value}`
      const { params } = query.toQuery()

      expect(params).toEqual([0])
    })

    it('should handle negative numbers', () => {
      const value = -100
      const query = sql`SELECT * FROM transactions WHERE amount >= ${value}`
      const { params } = query.toQuery()

      expect(params).toEqual([-100])
    })

    it('should handle very small decimals', () => {
      const value = 0.00000001
      const query = sql`SELECT * FROM rates WHERE rate > ${value}`
      const { params } = query.toQuery()

      expect(params).toEqual([0.00000001])
    })

    it('should handle very large numbers', () => {
      const value = Number.MAX_SAFE_INTEGER
      const query = sql`SELECT * FROM bigdata WHERE id < ${value}`
      const { params } = query.toQuery()

      expect(params).toEqual([Number.MAX_SAFE_INTEGER])
    })

    it('should handle Infinity', () => {
      const value = Infinity
      const query = sql`SELECT * FROM items WHERE value < ${value}`
      const { params } = query.toQuery()

      expect(params).toEqual([Infinity])
    })
  })

  describe('many parameters', () => {
    it('should handle 10 parameters', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      const query = sql`INSERT INTO data (a, b, c, d, e, f, g, h, i, j) VALUES (${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}, ${values[4]}, ${values[5]}, ${values[6]}, ${values[7]}, ${values[8]}, ${values[9]})`
      const { params } = query.toQuery()

      expect(params).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    })

    it('should maintain parameter order', () => {
      const a = 'first'
      const b = 'second'
      const c = 'third'
      const d = 'fourth'
      const e = 'fifth'

      const query = sql`SELECT ${a}, ${b}, ${c}, ${d}, ${e}`
      const { params } = query.toQuery()

      expect(params).toEqual(['first', 'second', 'third', 'fourth', 'fifth'])
    })
  })
})
