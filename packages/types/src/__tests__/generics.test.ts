import { describe, expect, it } from 'bun:test'
import {
  createStatusEnum,
  Result,
  Brand,
  typedKeys,
  typedEntries,
  keyBy,
  groupBy,
  parseOrDefault,
} from '../generics'
import { z } from 'zod'

describe('Generics Types', () => {
  describe('createStatusEnum', () => {
    it('creates a valid status enum with schema', () => {
      const statusValues = ['pending', 'active', 'completed'] as const

      const result = createStatusEnum(statusValues)

      expect(result.values).toEqual(statusValues)
      expect(result.Schema).toBeDefined()
      expect(() => result.Schema.parse('pending')).not.toThrow()
      expect(() => result.Schema.parse('active')).not.toThrow()
      expect(() => result.Schema.parse('completed')).not.toThrow()
      expect(() => result.Schema.parse('invalid')).toThrow()
    })

    it('provides type guard function', () => {
      const statusValues = ['open', 'closed'] as const

      const result = createStatusEnum(statusValues)

      expect(result.is('open')).toBe(true)
      expect(result.is('closed')).toBe(true)
      expect(result.is('pending')).toBe(false)
    })
  })

  describe('Result type', () => {
    it('creates success result', () => {
      const success: Result<number, string> = {
        success: true,
        data: 42,
      }
      expect(success.success).toBe(true)
      if (success.success) {
        expect(success.data).toBe(42)
      }
    })

    it('creates error result', () => {
      const error: Result<number, string> = {
        success: false,
        error: 'Something went wrong',
      }
      expect(error.success).toBe(false)
      if (!error.success) {
        expect(error.error).toBe('Something went wrong')
      }
    })
  })

  describe('Brand type', () => {
    it('creates branded types', () => {
      type UserId = Brand<string, 'UserId'>
      type OrderId = Brand<string, 'OrderId'>

      const userId: UserId = 'user-123' as UserId
      const orderId: OrderId = 'order-456' as OrderId

      expect(typeof userId).toBe('string')
      expect(typeof orderId).toBe('string')
      expect(userId).toBe('user-123')
      expect(orderId).toBe('order-456')
    })
  })

  describe('typedKeys', () => {
    it('returns correctly typed keys', () => {
      const obj = { a: 1, b: 2, c: 3 }
      const keys = typedKeys(obj)
      
      expect(keys).toEqual(['a', 'b', 'c'])
      expect(keys.includes('a')).toBe(true)
    })

    it('works with different value types', () => {
      const mixed = { name: 'test', count: 5, active: true }
      const keys = typedKeys(mixed)
      
      expect(keys.length).toBe(3)
      expect(keys).toContain('name')
      expect(keys).toContain('count')
      expect(keys).toContain('active')
    })
  })

  describe('typedEntries', () => {
    it('returns correctly typed entries', () => {
      const obj = { x: 10, y: 20 }
      const entries = typedEntries(obj)
      
      expect(entries).toEqual([['x', 10], ['y', 20]])
    })
  })

  describe('keyBy', () => {
    it('creates object keyed by specified property', () => {
      const items = [
        { id: 'a', value: 1 },
        { id: 'b', value: 2 },
        { id: 'c', value: 3 },
      ]
      
      const result = keyBy(items, (item) => item.id)
      
      expect(result.a).toEqual({ id: 'a', value: 1 })
      expect(result.b).toEqual({ id: 'b', value: 2 })
      expect(result.c).toEqual({ id: 'c', value: 3 })
    })

    it('handles empty array', () => {
      const items: { id: string; name: string }[] = []
      const result = keyBy(items, (item) => item.id)
      
      expect(result).toEqual({})
    })
  })

  describe('groupBy', () => {
    it('groups items by specified property', () => {
      const items = [
        { category: 'fruit', name: 'apple' },
        { category: 'vegetable', name: 'carrot' },
        { category: 'fruit', name: 'banana' },
      ]
      
      const result = groupBy(items, (item) => item.category)
      
      expect(result.fruit.length).toBe(2)
      expect(result.vegetable.length).toBe(1)
      expect(result.fruit[0].name).toBe('apple')
      expect(result.fruit[1].name).toBe('banana')
    })

    it('handles empty array', () => {
      const items: { type: string }[] = []
      const result = groupBy(items, (item) => item.type)
      
      expect(result).toEqual({})
    })
  })

  describe('parseOrDefault', () => {
    it('returns parsed value on success', () => {
      const schema = z.object({ name: z.string() })
      const data = { name: 'test' }
      const defaultValue = { name: 'default' }
      
      const result = parseOrDefault(schema, data, defaultValue)
      
      expect(result).toEqual({ name: 'test' })
    })

    it('returns default value on parse failure', () => {
      const schema = z.object({ name: z.string() })
      const invalidData = { name: 123 }
      const defaultValue = { name: 'default' }
      
      const result = parseOrDefault(schema, invalidData, defaultValue)
      
      expect(result).toEqual(defaultValue)
    })

    it('works with primitive schemas', () => {
      const schema = z.number().positive()
      
      expect(parseOrDefault(schema, 42, 0)).toBe(42)
      expect(parseOrDefault(schema, -5, 0)).toBe(0)
      expect(parseOrDefault(schema, 'invalid', 0)).toBe(0)
    })
  })
})

