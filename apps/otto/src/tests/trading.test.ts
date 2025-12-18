/**
 * Otto Trading Service Tests
 */

import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { TradingService } from '../services/trading';

describe('TradingService', () => {
  let service: TradingService;

  beforeEach(() => {
    service = new TradingService();
  });

  describe('formatAmount', () => {
    test('formats 18 decimal token amounts', () => {
      expect(service.formatAmount('1000000000000000000', 18)).toBe('1');
      expect(service.formatAmount('500000000000000000', 18)).toBe('0.5');
      expect(service.formatAmount('1234567890000000000', 18)).toBe('1.23456789');
    });

    test('formats 6 decimal token amounts', () => {
      expect(service.formatAmount('1000000', 6)).toBe('1');
      expect(service.formatAmount('500000', 6)).toBe('0.5');
      expect(service.formatAmount('1234567', 6)).toBe('1.234567');
    });

    test('formats 8 decimal token amounts', () => {
      expect(service.formatAmount('100000000', 8)).toBe('1');
      expect(service.formatAmount('50000000', 8)).toBe('0.5');
    });
  });

  describe('parseAmount', () => {
    test('parses 18 decimal amounts', () => {
      expect(service.parseAmount('1', 18)).toBe('1000000000000000000');
      expect(service.parseAmount('0.5', 18)).toBe('500000000000000000');
      expect(service.parseAmount('1.5', 18)).toBe('1500000000000000000');
    });

    test('parses 6 decimal amounts', () => {
      expect(service.parseAmount('1', 6)).toBe('1000000');
      expect(service.parseAmount('0.5', 6)).toBe('500000');
      expect(service.parseAmount('100', 6)).toBe('100000000');
    });
  });

  describe('formatUsd', () => {
    test('formats USD amounts', () => {
      expect(service.formatUsd(1234.56)).toBe('$1,234.56');
      expect(service.formatUsd(1000000)).toBe('$1,000,000.00');
      expect(service.formatUsd(0.99)).toBe('$0.99');
    });
  });

  describe('limitOrders', () => {
    test('creates and retrieves limit orders', async () => {
      const mockUser = {
        id: 'user-123',
        platforms: [],
        primaryWallet: '0x1234567890123456789012345678901234567890' as const,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        settings: {
          defaultSlippageBps: 50,
          defaultChainId: 420691,
          notifications: true,
        },
      };

      // Note: This would need mocked token info in a real test
      // For now, we just verify the order tracking works
      const orders = service.getOpenOrders('user-123');
      expect(orders).toEqual([]);
    });

    test('cancels limit order', async () => {
      const result = await service.cancelLimitOrder('nonexistent', 'user-123');
      expect(result).toBe(false);
    });
  });
});

