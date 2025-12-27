import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import type { Address } from 'viem'
import type {
  LimitOrder,
  OttoUser,
  Platform,
  TokenInfo,
  UserPlatformLink,
} from '../../lib'

// Set test data directory before importing state manager
const TEST_DATA_DIR = './test-data-state'
process.env.OTTO_DATA_DIR = TEST_DATA_DIR

import { getStateManager } from '../../api/services/state'

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

type PendingActionType = 'swap' | 'bridge' | 'send' | 'launch'
type OrderStatus = 'open' | 'filled' | 'cancelled' | 'expired'

const SWAP_TYPE: PendingActionType = 'swap'
const BRIDGE_TYPE: PendingActionType = 'bridge'
const STATUS_OPEN: OrderStatus = 'open'
const STATUS_FILLED: OrderStatus = 'filled'
const STATUS_CANCELLED: OrderStatus = 'cancelled'

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

describe('StateManager', () => {
  beforeEach(() => {
    // Create test directory
    if (!existsSync(TEST_DATA_DIR)) {
      mkdirSync(TEST_DATA_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true })
    }
  })

  describe('user management', () => {
    test('returns null for non-existent user', () => {
      const manager = getStateManager()
      const user = manager.getUser('nonexistent-id')
      expect(user).toBeNull()
    })

    test('returns null for non-existent platform user', () => {
      const manager = getStateManager()
      const user = manager.getUserByPlatform('discord', 'nonexistent')
      expect(user).toBeNull()
    })

    test('sets and retrieves user', () => {
      const manager = getStateManager()
      const testUser = createTestUser()

      manager.setUser(testUser)
      const retrieved = manager.getUser('test-user-123')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe('test-user-123')
    })

    test('retrieves user by platform', () => {
      const manager = getStateManager()
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
        settings: {
          defaultSlippageBps: 100,
          defaultChainId: 8453,
          notifications: false,
        },
      })

      manager.setUser(testUser)
      const retrieved = manager.getUserByPlatform('telegram', 'tg-456')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe('platform-user-456')
    })
  })

  describe('conversation state', () => {
    test('creates new conversation if none exists', () => {
      const manager = getStateManager()
      const conversation = manager.getConversation('web', 'channel-123')
      expect(conversation).toBeDefined()
      expect(conversation.history).toEqual([])
    })

    test('adds to history', () => {
      const manager = getStateManager()
      manager.addToHistory('web', 'channel-add', 'user', 'hello')
      manager.addToHistory('web', 'channel-add', 'assistant', 'hi there')

      const history = manager.getHistory('web', 'channel-add')
      expect(history).toHaveLength(2)
      expect(history[0].role).toBe('user')
      expect(history[0].content).toBe('hello')
      expect(history[1].role).toBe('assistant')
      expect(history[1].content).toBe('hi there')
    })

    test('limits history to max messages (50 by default)', () => {
      const manager = getStateManager()

      // Add 60 messages (more than the 50 limit)
      for (let i = 0; i < 60; i++) {
        const role = i % 2 === 0 ? 'user' : 'assistant'
        manager.addToHistory('web', 'channel-limit', role, `message ${i}`)
      }

      const history = manager.getHistory('web', 'channel-limit')
      expect(history).toHaveLength(50)
      // Should keep the last 50 (messages 10-59)
      expect(history[0].content).toBe('message 10')
      expect(history[49].content).toBe('message 59')
    })
  })

  describe('pending actions', () => {
    test('sets and retrieves pending action', () => {
      const manager = getStateManager()
      const pendingSwap = {
        type: SWAP_TYPE,
        quote: {
          quoteId: 'quote-123',
          fromToken: createTestToken(),
          toToken: createTestToken({
            address: TEST_ADDRESS_2,
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
          }),
          fromAmount: '1000000000000000000',
          toAmount: '3500000000',
          toAmountMin: '3465000000',
          priceImpact: 0.01,
          gasCost: '100000',
          route: [],
          validUntil: Date.now() + 60000,
        },
        params: { amount: '1', from: 'ETH', to: 'USDC', chainId: 420691 },
        expiresAt: Date.now() + 300000,
      }

      manager.setPendingAction('web', 'channel-pending', pendingSwap)
      const pending = manager.getPendingAction('web', 'channel-pending')
      expect(pending).toBeDefined()
      expect(pending?.type).toBe('swap')
    })

    test('clears pending action', () => {
      const manager = getStateManager()
      const pendingBridge = {
        type: BRIDGE_TYPE,
        params: {
          amount: '1',
          token: 'ETH',
          fromChain: 'ethereum',
          toChain: 'base',
          sourceChainId: 1,
          destChainId: 8453,
        },
        expiresAt: Date.now() + 300000,
      }

      manager.setPendingAction('web', 'channel-clear', pendingBridge)
      manager.clearPendingAction('web', 'channel-clear')
      const pending = manager.getPendingAction('web', 'channel-clear')
      expect(pending).toBeUndefined()
    })

    test('returns undefined for expired pending action', () => {
      const manager = getStateManager()
      const expiredAction = {
        type: SWAP_TYPE,
        quote: {
          quoteId: 'expired-quote',
          fromToken: createTestToken(),
          toToken: createTestToken({
            address: TEST_ADDRESS_2,
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
          }),
          fromAmount: '1000000000000000000',
          toAmount: '3500000000',
          toAmountMin: '3465000000',
          priceImpact: 0.01,
          gasCost: '100000',
          route: [],
          validUntil: Date.now() - 1000,
        },
        params: { amount: '1', from: 'ETH', to: 'USDC', chainId: 420691 },
        expiresAt: Date.now() - 1000, // Already expired
      }

      manager.setPendingAction('web', 'channel-expired', expiredAction)
      const pending = manager.getPendingAction('web', 'channel-expired')
      expect(pending).toBeUndefined()
    })
  })

  describe('chat sessions', () => {
    test('creates session without wallet', () => {
      const manager = getStateManager()
      const session = manager.createSession()
      expect(session.sessionId).toBeDefined()
      expect(session.sessionId.length).toBeGreaterThan(0)
      expect(session.walletAddress).toBeUndefined()
    })

    test('creates session with wallet address', () => {
      const manager = getStateManager()
      const session = manager.createSession(TEST_ADDRESS_1)
      expect(session.walletAddress).toBe(TEST_ADDRESS_1)
      expect(session.userId).toBe(TEST_ADDRESS_1)
    })

    test('retrieves session by id', () => {
      const manager = getStateManager()
      const session = manager.createSession()
      const retrieved = manager.getSession(session.sessionId)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.sessionId).toBe(session.sessionId)
    })

    test('returns null for non-existent session', () => {
      const manager = getStateManager()
      const session = manager.getSession('nonexistent-session')
      expect(session).toBeNull()
    })

    test('updates session', () => {
      const manager = getStateManager()
      const session = manager.createSession()

      manager.updateSession(session.sessionId, {
        walletAddress: TEST_ADDRESS_2,
      })
      const updated = manager.getSession(session.sessionId)
      expect(updated?.walletAddress).toBe(TEST_ADDRESS_2)
    })
  })

  describe('limit orders', () => {
    test('adds and retrieves limit order', () => {
      const manager = getStateManager()
      const order = createTestLimitOrder({
        orderId: 'order-123',
        userId: 'user-456',
      })

      manager.addLimitOrder(order)
      const retrieved = manager.getLimitOrder('order-123')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.orderId).toBe('order-123')
    })

    test('returns null for non-existent order', () => {
      const manager = getStateManager()
      const order = manager.getLimitOrder('nonexistent-order')
      expect(order).toBeNull()
    })

    test('retrieves user limit orders', () => {
      const manager = getStateManager()

      manager.addLimitOrder(
        createTestLimitOrder({
          orderId: 'order-a',
          userId: 'user-x',
          status: STATUS_OPEN,
        }),
      )
      manager.addLimitOrder(
        createTestLimitOrder({
          orderId: 'order-b',
          userId: 'user-x',
          status: STATUS_OPEN,
        }),
      )
      manager.addLimitOrder(
        createTestLimitOrder({
          orderId: 'order-c',
          userId: 'user-y',
          status: STATUS_OPEN,
        }),
      )

      const userXOrders = manager.getUserLimitOrders('user-x')
      expect(userXOrders).toHaveLength(2)
      expect(userXOrders.every((o) => o.userId === 'user-x')).toBe(true)
    })

    test('filters out non-open orders from user orders', () => {
      const manager = getStateManager()

      manager.addLimitOrder(
        createTestLimitOrder({
          orderId: 'order-open',
          userId: 'filter-user',
          status: STATUS_OPEN,
        }),
      )
      manager.addLimitOrder(
        createTestLimitOrder({
          orderId: 'order-filled',
          userId: 'filter-user',
          status: STATUS_FILLED,
        }),
      )
      manager.addLimitOrder(
        createTestLimitOrder({
          orderId: 'order-cancelled',
          userId: 'filter-user',
          status: STATUS_CANCELLED,
        }),
      )

      const orders = manager.getUserLimitOrders('filter-user')
      expect(orders).toHaveLength(1)
      expect(orders[0].status).toBe('open')
    })

    test('updates limit order', () => {
      const manager = getStateManager()
      const order = createTestLimitOrder({
        orderId: 'order-update',
        userId: 'user-update',
      })

      manager.addLimitOrder(order)
      manager.updateLimitOrder('order-update', {
        status: 'filled',
        filledAt: Date.now(),
      })

      const updated = manager.getLimitOrder('order-update')
      expect(updated?.status).toBe('filled')
      expect(updated?.filledAt).toBeDefined()
    })
  })
})
