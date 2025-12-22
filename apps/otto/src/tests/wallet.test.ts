/**
 * Otto Wallet Service Tests
 */

import { describe, expect, test, beforeEach, beforeAll } from 'bun:test';
import { WalletService } from '../services/wallet';

// Set test environment
beforeAll(() => {
  process.env.NODE_ENV = 'development';
});

describe('WalletService', () => {
  let service: WalletService;

  beforeEach(() => {
    service = new WalletService();
  });

  describe('user management', () => {
    test('returns null for non-existent user', async () => {
      const user = await service.getOrCreateUser('discord', 'nonexistent');
      expect(user).toBeNull();
    });

    test('returns null for non-existent user by id', () => {
      const user = service.getUser('nonexistent');
      expect(user).toBeNull();
    });

    test('returns null for non-existent user by platform', () => {
      const user = service.getUserByPlatform('discord', 'nonexistent');
      expect(user).toBeNull();
    });
  });

  describe('wallet connection', () => {
    test('generates connect URL', async () => {
      const url = await service.generateConnectUrl('discord', 'user-123', 'testuser');
      expect(url).toContain('/connect/wallet');
      expect(url).toContain('platform=discord');
      expect(url).toContain('platformId=user-123');
    });
  });

  describe('session keys', () => {
    test('hasValidSessionKey returns false for user without session key', () => {
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

      expect(service.hasValidSessionKey(mockUser)).toBe(false);
    });

    test('hasValidSessionKey returns false for expired session key', () => {
      const mockUser = {
        id: 'user-123',
        platforms: [],
        primaryWallet: '0x1234567890123456789012345678901234567890' as const,
        sessionKeyAddress: '0xabcdef1234567890123456789012345678901234' as const,
        sessionKeyExpiry: Date.now() - 1000, // Expired
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        settings: {
          defaultSlippageBps: 50,
          defaultChainId: 420691,
          notifications: true,
        },
      };

      expect(service.hasValidSessionKey(mockUser)).toBe(false);
    });

    test('hasValidSessionKey returns true for valid session key', () => {
      const mockUser = {
        id: 'user-123',
        platforms: [],
        primaryWallet: '0x1234567890123456789012345678901234567890' as const,
        sessionKeyAddress: '0xabcdef1234567890123456789012345678901234' as const,
        sessionKeyExpiry: Date.now() + 3600000, // 1 hour from now
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        settings: {
          defaultSlippageBps: 50,
          defaultChainId: 420691,
          notifications: true,
        },
      };

      expect(service.hasValidSessionKey(mockUser)).toBe(true);
    });
  });

  describe('settings', () => {
    test('throws for non-existent user', () => {
      expect(() => service.getSettings('nonexistent')).toThrow('User not found: nonexistent');
    });

    test('returns false when updating non-existent user', () => {
      const result = service.updateSettings('nonexistent', { notifications: false });
      expect(result).toBe(false);
    });
  });
});

