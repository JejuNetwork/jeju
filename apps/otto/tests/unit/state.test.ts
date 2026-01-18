import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Address } from 'viem'
import type {
  LimitOrder,
  OttoUser,
  Platform,
  TokenInfo,
  UserPlatformLink,
} from '../../lib'

// Mock the SQLit client before importing the state manager
const mockQueryOne = mock(() => Promise.resolve(null))
const mockQuery = mock(() => Promise.resolve([]))
const mockRun = mock(() => Promise.resolve())
const mockCreateDatabase = mock(() =>
  Promise.resolve({ databaseId: 'test-db' }),
)
const _mockIsHealthy = mock(() => true)

mock.module('@jejunetwork/sqlit', () => ({
  SQLitClient: class MockSQLitClient {
    queryOne = mockQueryOne
    query = mockQuery
    run = mockRun
    createDatabase = mockCreateDatabase
  },
  SQLitError: class SQLitError extends Error {
    constructor(
      message: string,
      public code: string,
    ) {
      super(message)
    }
  },
}))

mock.module('@jejunetwork/config', () => ({
  getSQLitBlockProducerUrl: () => 'http://localhost:4661',
  getCurrentNetwork: () => 'localnet',
}))

import { getSQLitStateManager } from '../../api/services/sqlit-state'

// Test constants with proper types
const TEST_ADDRESS_1: Address = '0x1234567890123456789012345678901234567890'
const TEST_ADDRESS_2: Address = '0xabcdef1234567890123456789012345678901234'
const DISCORD_PLATFORM: Platform = 'discord'
const TELEGRAM_PLATFORM: Platform = 'telegram'

function createTestToken(overrides: Partial<TokenInfo> = {}): TokenInfo {
  return {
    address: TEST_ADDRESS_1,
    chainId: 420691,
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    ...overrides,
  }
}

function createTestPlatformLink(
  overrides: Partial<UserPlatformLink> = {},
): UserPlatformLink {
  return {
    platform: DISCORD_PLATFORM,
    platformId: 'discord-123',
    username: 'testuser',
    linkedAt: Date.now(),
    verified: true,
    ...overrides,
  }
}

function createTestUser(overrides: Partial<OttoUser> = {}): OttoUser {
  return {
    id: 'test-user-123',
    platforms: [createTestPlatformLink()],
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

type OrderStatus = 'open' | 'filled' | 'cancelled' | 'expired'
const STATUS_OPEN: OrderStatus = 'open'

function createTestLimitOrder(overrides: Partial<LimitOrder> = {}): LimitOrder {
  return {
    orderId: 'order-123',
    userId: 'user-123',
    fromToken: createTestToken(),
    toToken: createTestToken({
      address: TEST_ADDRESS_2,
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    }),
    fromAmount: '1000000000000000000',
    targetPrice: '4000',
    chainId: 420691,
    status: STATUS_OPEN,
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('SQLitStateManager', () => {
  beforeEach(async () => {
    // Reset mocks
    mockQueryOne.mockClear()
    mockQuery.mockClear()
    mockRun.mockClear()
    mockCreateDatabase.mockClear()

    // Initialize the manager to consume initialization-related mock calls
    const manager = getSQLitStateManager()
    // Force initialization by calling a method
    await manager.isHealthy().catch(() => {})

    // Reset mocks again so tests start fresh
    mockQueryOne.mockClear()
    mockQuery.mockClear()
    mockRun.mockClear()
  })

  afterEach(() => {
    mockQueryOne.mockClear()
    mockQuery.mockClear()
    mockRun.mockClear()
  })

  describe('initialization', () => {
    test('creates singleton instance', () => {
      const manager1 = getSQLitStateManager()
      const manager2 = getSQLitStateManager()
      expect(manager1).toBe(manager2)
    })

    test('returns database info', () => {
      const manager = getSQLitStateManager()
      const info = manager.getDatabaseInfo()
      expect(info.network).toBe('localnet')
      expect(info.databaseId).toContain('otto-localnet')
      expect(info.endpoint).toBe('http://localhost:4661')
    })
  })

  describe('user management', () => {
    test('returns null for non-existent user', async () => {
      mockQueryOne.mockResolvedValueOnce(null)

      const manager = getSQLitStateManager()
      const user = await manager.getUser('nonexistent-id')
      expect(user).toBeNull()
    })

    test('returns null for non-existent platform user', async () => {
      mockQueryOne.mockResolvedValueOnce(null)

      const manager = getSQLitStateManager()
      const user = await manager.getUserByPlatform('discord', 'nonexistent')
      expect(user).toBeNull()
    })

    test('sets and retrieves user', async () => {
      const testUser = createTestUser()

      // Mock the set operation
      mockRun.mockResolvedValue(undefined)

      const manager = getSQLitStateManager()
      await manager.setUser(testUser)

      // Verify run was called for insert
      expect(mockRun).toHaveBeenCalled()
    })

    test('retrieves user by platform', async () => {
      const testUser = createTestUser({
        id: 'platform-user-456',
        platforms: [
          createTestPlatformLink({
            platform: TELEGRAM_PLATFORM,
            platformId: 'tg-456',
            username: 'tguser',
          }),
        ],
        primaryWallet: TEST_ADDRESS_2,
      })

      // Mock platform link lookup then user lookup
      mockQueryOne
        .mockResolvedValueOnce({
          platform: 'telegram',
          platform_id: 'tg-456',
          user_id: 'platform-user-456',
        })
        .mockResolvedValueOnce({
          id: testUser.id,
          primary_wallet: testUser.primaryWallet,
          platforms: JSON.stringify(testUser.platforms),
          settings: JSON.stringify(testUser.settings),
          created_at: testUser.createdAt,
          updated_at: testUser.lastActiveAt,
        })

      const manager = getSQLitStateManager()
      const retrieved = await manager.getUserByPlatform('telegram', 'tg-456')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe('platform-user-456')
    })
  })

  describe('conversation state', () => {
    test('returns empty history for new conversation', async () => {
      mockQueryOne.mockResolvedValueOnce(null)

      const manager = getSQLitStateManager()
      const conversation = await manager.getConversation('web', 'channel-123')
      expect(conversation).toBeDefined()
      expect(conversation.history).toEqual([])
    })

    test('retrieves existing history', async () => {
      mockQueryOne.mockResolvedValueOnce({
        conversation_key: 'web:channel-add',
        history: JSON.stringify([
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi there' },
        ]),
        pending_action: null,
        last_updated: Date.now(),
      })

      const manager = getSQLitStateManager()
      const history = await manager.getHistory('web', 'channel-add')
      expect(history).toHaveLength(2)
      expect(history[0].role).toBe('user')
      expect(history[0].content).toBe('hello')
    })
  })

  describe('pending actions', () => {
    test('sets pending action', async () => {
      mockQueryOne.mockResolvedValueOnce(null) // getConversation returns null
      mockRun.mockResolvedValue(undefined)

      const manager = getSQLitStateManager()
      const pendingSwap = {
        type: 'swap' as const,
        quote: {
          quoteId: 'quote-123',
          fromAmount: '1000000000000000000',
          toAmount: '3500000000',
          toAmountMin: '3465000000',
          priceImpact: '0.01',
          validUntil: Date.now() + 60000,
        },
        params: {
          from: TEST_ADDRESS_1,
          to: TEST_ADDRESS_2,
          amount: '1',
          chainId: 420691,
        },
        expiresAt: Date.now() + 300000,
      }

      await manager.setPendingAction('web', 'channel-pending', pendingSwap)
      expect(mockRun).toHaveBeenCalled()
    })

    test('clears pending action', async () => {
      mockRun.mockResolvedValue(undefined)

      const manager = getSQLitStateManager()
      await manager.clearPendingAction('web', 'channel-clear')
      expect(mockRun).toHaveBeenCalled()
    })

    test('returns undefined for expired pending action', async () => {
      mockQueryOne.mockResolvedValueOnce({
        conversation_key: 'web:channel-expired',
        history: JSON.stringify([]),
        pending_action: JSON.stringify({
          type: 'swap',
          expiresAt: Date.now() - 1000, // Already expired
        }),
        last_updated: Date.now(),
      })

      const manager = getSQLitStateManager()
      const pending = await manager.getPendingAction('web', 'channel-expired')
      expect(pending).toBeUndefined()
    })
  })

  describe('chat sessions', () => {
    test('creates session without wallet', async () => {
      mockRun.mockResolvedValue(undefined)

      const manager = getSQLitStateManager()
      const session = await manager.createSession()
      expect(session.sessionId).toBeDefined()
      expect(session.sessionId.length).toBeGreaterThan(0)
      expect(session.walletAddress).toBeUndefined()
    })

    test('creates session with wallet address', async () => {
      mockRun.mockResolvedValue(undefined)

      const manager = getSQLitStateManager()
      const session = await manager.createSession(TEST_ADDRESS_1)
      expect(session.walletAddress).toBe(TEST_ADDRESS_1)
      expect(session.userId).toBe(TEST_ADDRESS_1)
    })

    test('retrieves session by id', async () => {
      const sessionId = 'test-session-123'
      mockQueryOne.mockResolvedValueOnce({
        session_id: sessionId,
        user_id: 'user-123',
        wallet_address: TEST_ADDRESS_1,
        created_at: Date.now(),
        last_active_at: Date.now(),
      })

      const manager = getSQLitStateManager()
      const session = await manager.getSession(sessionId)
      expect(session).not.toBeNull()
      expect(session?.sessionId).toBe(sessionId)
    })

    test('returns null for non-existent session', async () => {
      mockQueryOne.mockResolvedValueOnce(null)

      const manager = getSQLitStateManager()
      const session = await manager.getSession('nonexistent-session')
      expect(session).toBeNull()
    })
  })

  describe('limit orders', () => {
    test('adds limit order', async () => {
      mockRun.mockResolvedValue(undefined)

      const manager = getSQLitStateManager()
      const order = createTestLimitOrder({
        orderId: 'order-123',
        userId: 'user-456',
      })

      await manager.addLimitOrder(order)
      expect(mockRun).toHaveBeenCalled()
    })

    test('returns null for non-existent order', async () => {
      mockQueryOne.mockResolvedValueOnce(null)

      const manager = getSQLitStateManager()
      const order = await manager.getLimitOrder('nonexistent-order')
      expect(order).toBeNull()
    })

    test('retrieves user limit orders', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          order_id: 'order-a',
          user_id: 'user-x',
          from_token: JSON.stringify(createTestToken()),
          to_token: JSON.stringify(
            createTestToken({
              address: TEST_ADDRESS_2,
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
            }),
          ),
          from_amount: '1000000000000000000',
          target_price: '4000',
          chain_id: 420691,
          status: 'open',
          created_at: Date.now(),
        },
        {
          order_id: 'order-b',
          user_id: 'user-x',
          from_token: JSON.stringify(createTestToken()),
          to_token: JSON.stringify(
            createTestToken({
              address: TEST_ADDRESS_2,
              symbol: 'USDC',
              name: 'USD Coin',
              decimals: 6,
            }),
          ),
          from_amount: '2000000000000000000',
          target_price: '4500',
          chain_id: 420691,
          status: 'open',
          created_at: Date.now(),
        },
      ])

      const manager = getSQLitStateManager()
      const userXOrders = await manager.getUserLimitOrders('user-x')
      expect(userXOrders).toHaveLength(2)
      expect(userXOrders.every((o) => o.userId === 'user-x')).toBe(true)
    })

    test('updates limit order', async () => {
      mockRun.mockResolvedValue(undefined)

      const manager = getSQLitStateManager()
      await manager.updateLimitOrder('order-update', {
        status: 'filled',
        filledAt: Date.now(),
      })

      expect(mockRun).toHaveBeenCalled()
    })
  })

  describe('health check', () => {
    test('returns true when database is healthy', async () => {
      mockQueryOne.mockResolvedValueOnce({ value: '1' })

      const manager = getSQLitStateManager()
      const healthy = await manager.isHealthy()
      expect(healthy).toBe(true)
    })

    test('returns false when database query fails', async () => {
      mockQueryOne.mockRejectedValueOnce(new Error('Database error'))

      const manager = getSQLitStateManager()
      const healthy = await manager.isHealthy()
      expect(healthy).toBe(false)
    })
  })
})
