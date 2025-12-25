import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import { WalletService } from '../../api/services/wallet'
import type { OttoUser } from '../../lib'

// Test constants with proper types
const TEST_ADDRESS_1: Address = '0x1234567890123456789012345678901234567890'
const TEST_ADDRESS_2: Address = '0xabcdef1234567890123456789012345678901234'

function createMockUser(overrides: Partial<OttoUser> = {}): OttoUser {
  return {
    id: 'user-123',
    platforms: [],
    primaryWallet: TEST_ADDRESS_1,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    settings: {
      defaultSlippageBps: 50,
      defaultChainId: 420691,
      notifications: true,
    },
    ...overrides,
  }
}

beforeAll(() => {
  process.env.NODE_ENV = 'development'
})

describe('WalletService', () => {
  let service: WalletService

  beforeEach(() => {
    service = new WalletService()
  })

  describe('user management', () => {
    test('returns null for non-existent user', async () => {
      const user = await service.getOrCreateUser('discord', 'nonexistent')
      expect(user).toBeNull()
    })

    test('returns null for non-existent user by id', () => {
      const user = service.getUser('nonexistent')
      expect(user).toBeNull()
    })

    test('returns null for non-existent user by platform', () => {
      const user = service.getUserByPlatform('discord', 'nonexistent')
      expect(user).toBeNull()
    })
  })

  describe('wallet connection', () => {
    test('generates connect URL', async () => {
      const url = await service.generateConnectUrl(
        'discord',
        'user-123',
        'testuser',
      )
      expect(url).toContain('/connect/wallet')
      expect(url).toContain('platform=discord')
      expect(url).toContain('platformId=user-123')
    })
  })

  describe('session keys', () => {
    test('hasValidSessionKey returns false for user without session key', () => {
      const mockUser = createMockUser()

      expect(service.hasValidSessionKey(mockUser)).toBe(false)
    })

    test('hasValidSessionKey returns false for expired session key', () => {
      const mockUser = createMockUser({
        sessionKeyAddress: TEST_ADDRESS_2,
        sessionKeyExpiry: Date.now() - 1000, // Expired
      })

      expect(service.hasValidSessionKey(mockUser)).toBe(false)
    })

    test('hasValidSessionKey returns true for valid session key', () => {
      const mockUser = createMockUser({
        sessionKeyAddress: TEST_ADDRESS_2,
        sessionKeyExpiry: Date.now() + 3600000, // 1 hour from now
      })

      expect(service.hasValidSessionKey(mockUser)).toBe(true)
    })
  })

  describe('settings', () => {
    test('throws for non-existent user', () => {
      expect(() => service.getSettings('nonexistent')).toThrow(
        'User not found: nonexistent',
      )
    })

    test('returns false when updating non-existent user', () => {
      const result = service.updateSettings('nonexistent', {
        notifications: false,
      })
      expect(result).toBe(false)
    })
  })
})
