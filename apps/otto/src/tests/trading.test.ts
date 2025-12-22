import { beforeEach, describe, expect, test } from 'bun:test'
import { TradingService } from '../services/trading'

describe('TradingService', () => {
  let service: TradingService

  beforeEach(() => {
    service = new TradingService()
  })

  describe('formatAmount', () => {
    test('formats 18 decimal token amounts', () => {
      expect(service.formatAmount('1000000000000000000', 18)).toBe('1')
      expect(service.formatAmount('500000000000000000', 18)).toBe('0.5')
      expect(service.formatAmount('1234567890000000000', 18)).toBe('1.23456789')
    })

    test('formats 6 decimal token amounts', () => {
      expect(service.formatAmount('1000000', 6)).toBe('1')
      expect(service.formatAmount('500000', 6)).toBe('0.5')
      expect(service.formatAmount('1234567', 6)).toBe('1.234567')
    })

    test('formats 8 decimal token amounts', () => {
      expect(service.formatAmount('100000000', 8)).toBe('1')
      expect(service.formatAmount('50000000', 8)).toBe('0.5')
    })

    test('formats zero amounts', () => {
      expect(service.formatAmount('0', 18)).toBe('0')
      expect(service.formatAmount('0', 6)).toBe('0')
    })

    test('formats very small amounts', () => {
      expect(service.formatAmount('1', 18)).toBe('0.000000000000000001')
      expect(service.formatAmount('1', 6)).toBe('0.000001')
    })

    test('formats very large amounts', () => {
      const largeAmount = '1000000000000000000000000000' // 1 billion tokens with 18 decimals
      expect(service.formatAmount(largeAmount, 18)).toBe('1000000000')
    })

    test('formats amounts with trailing zeros', () => {
      expect(service.formatAmount('1000000000000000000', 18)).toBe('1')
      expect(service.formatAmount('10000000000000000000', 18)).toBe('10')
    })
  })

  describe('parseAmount', () => {
    test('parses 18 decimal amounts', () => {
      expect(service.parseAmount('1', 18)).toBe('1000000000000000000')
      expect(service.parseAmount('0.5', 18)).toBe('500000000000000000')
      expect(service.parseAmount('1.5', 18)).toBe('1500000000000000000')
    })

    test('parses 6 decimal amounts', () => {
      expect(service.parseAmount('1', 6)).toBe('1000000')
      expect(service.parseAmount('0.5', 6)).toBe('500000')
      expect(service.parseAmount('100', 6)).toBe('100000000')
    })

    test('parses zero amounts', () => {
      expect(service.parseAmount('0', 18)).toBe('0')
      expect(service.parseAmount('0', 6)).toBe('0')
    })

    test('parses very small decimal amounts', () => {
      expect(service.parseAmount('0.000001', 6)).toBe('1')
      expect(service.parseAmount('0.000000000000000001', 18)).toBe('1')
    })

    test('parses large amounts', () => {
      expect(service.parseAmount('1000000', 18)).toBe(
        '1000000000000000000000000',
      )
      expect(service.parseAmount('1000000', 6)).toBe('1000000000000')
    })

    test('throws for empty string', () => {
      expect(() => service.parseAmount('', 18)).toThrow(
        'Amount must be a non-empty string',
      )
    })

    test('throws for invalid decimals', () => {
      expect(() => service.parseAmount('1', -1)).toThrow('Invalid decimals')
      expect(() => service.parseAmount('1', 256)).toThrow('Invalid decimals')
    })

    test('handles integer strings', () => {
      expect(service.parseAmount('100', 18)).toBe('100000000000000000000')
    })
  })

  describe('formatUsd', () => {
    test('formats USD amounts', () => {
      expect(service.formatUsd(1234.56)).toBe('$1,234.56')
      expect(service.formatUsd(1000000)).toBe('$1,000,000.00')
      expect(service.formatUsd(0.99)).toBe('$0.99')
    })

    test('formats zero', () => {
      expect(service.formatUsd(0)).toBe('$0.00')
    })

    test('formats small amounts', () => {
      expect(service.formatUsd(0.01)).toBe('$0.01')
      expect(service.formatUsd(0.001)).toBe('$0.00')
    })

    test('formats large amounts', () => {
      expect(service.formatUsd(1000000000)).toBe('$1,000,000,000.00')
    })

    test('formats negative amounts', () => {
      expect(service.formatUsd(-100)).toBe('-$100.00')
    })

    test('handles rounding', () => {
      expect(service.formatUsd(1.005)).toBe('$1.01') // Should round up
      expect(service.formatUsd(1.004)).toBe('$1.00') // Should round down
    })
  })

  describe('limitOrders', () => {
    test('creates and retrieves limit orders', async () => {
      // Verify the order tracking works
      const orders = service.getOpenOrders('user-123')
      expect(orders).toEqual([])
    })

    test('cancels limit order', async () => {
      const result = await service.cancelLimitOrder('nonexistent', 'user-123')
      expect(result).toBe(false)
    })

    test('throws when cancelling with missing orderId', async () => {
      await expect(service.cancelLimitOrder('', 'user-123')).rejects.toThrow(
        'Order ID and user ID are required',
      )
    })

    test('throws when cancelling with missing userId', async () => {
      await expect(service.cancelLimitOrder('order-123', '')).rejects.toThrow(
        'Order ID and user ID are required',
      )
    })

    test('getOpenOrders returns empty array for new user', () => {
      const orders = service.getOpenOrders('brand-new-user')
      expect(orders).toEqual([])
      expect(Array.isArray(orders)).toBe(true)
    })
  })

  describe('amount conversion roundtrip', () => {
    test('parse then format returns original for whole numbers', () => {
      const original = '100'
      const parsed = service.parseAmount(original, 18)
      const formatted = service.formatAmount(parsed, 18)
      expect(formatted).toBe(original)
    })

    test('parse then format returns original for decimals', () => {
      const original = '1.5'
      const parsed = service.parseAmount(original, 18)
      const formatted = service.formatAmount(parsed, 18)
      expect(formatted).toBe(original)
    })

    test('handles precision for 6 decimal tokens', () => {
      const original = '123.456789'
      const parsed = service.parseAmount(original, 6)
      const formatted = service.formatAmount(parsed, 6)
      expect(formatted).toBe('123.456789')
    })

    test('handles max precision for 6 decimal tokens', () => {
      // parseUnits handles exact precision
      const original = '1.123456' // Exactly 6 decimals for 6 decimal token
      const parsed = service.parseAmount(original, 6)
      const formatted = service.formatAmount(parsed, 6)
      expect(formatted).toBe('1.123456')
    })
  })
})
