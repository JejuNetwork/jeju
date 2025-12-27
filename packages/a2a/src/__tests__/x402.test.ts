/**
 * X402Manager Live Integration Tests
 *
 * Tests micropayment protocol: payment creation, verification, expiration
 * Uses LIVE Redis - NO MOCKS
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test'
import {
  getLiveRedisClient,
  hasInfra,
} from '@jejunetwork/tests/shared/live-infrastructure'
import { type RedisClient, X402Manager } from '../payments/x402'

// Check if Redis is available before defining tests
const REDIS_AVAILABLE = await hasInfra(['redis'])

// Only run Redis tests if Redis is available
const describeIfRedis = REDIS_AVAILABLE ? describe : describe.skip

describeIfRedis('X402Manager with live Redis', () => {
  let manager: X402Manager
  let redisClient: RedisClient

  beforeAll(async () => {
    redisClient = await getLiveRedisClient()
  })

  beforeEach(() => {
    manager = new X402Manager({
      rpcUrl: 'http://127.0.0.1:8545',
      minPaymentAmount: '1000000000000000', // 0.001 ETH
      paymentTimeout: 5000, // 5 seconds for faster tests
      redis: redisClient,
    })
  })

  afterEach(async () => {
    manager.cleanup()
    // Clean up test keys from Redis
    const keys = await redisClient.keys('x402:payment:x402-*')
    for (const key of keys) {
      await redisClient.del(key)
    }
  })

  describe('createPaymentRequest', () => {
    it('should create payment request with correct fields', async () => {
      const request = await manager.createPaymentRequest(
        '0xSender',
        '0xRecipient',
        '5000000000000000', // 0.005 ETH
        'test-service',
        { orderId: 'order-123' },
      )

      expect(request.requestId).toMatch(/^x402-\d+-[a-f0-9]+$/)
      expect(request.from).toBe('0xSender')
      expect(request.to).toBe('0xRecipient')
      expect(request.amount).toBe('5000000000000000')
      expect(request.service).toBe('test-service')
      expect(request.metadata).toEqual({ orderId: 'order-123' })
      expect(request.expiresAt).toBeGreaterThan(Date.now())
    })

    it('should reject payment below minimum amount', async () => {
      await expect(
        manager.createPaymentRequest(
          '0xSender',
          '0xRecipient',
          '100', // Below minimum
          'test-service',
        ),
      ).rejects.toThrow(/Payment amount must be at least/)
    })

    it('should store payment in Redis', async () => {
      const request = await manager.createPaymentRequest(
        '0xSender',
        '0xRecipient',
        '5000000000000000',
        'test-service',
      )

      const stored = await redisClient.get(`x402:payment:${request.requestId}`)
      expect(stored).not.toBeNull()

      const parsed = JSON.parse(stored as string)
      expect(parsed.request.requestId).toBe(request.requestId)
      expect(parsed.verified).toBe(false)
    })
  })

  describe('getPaymentRequest', () => {
    it('should retrieve stored payment', async () => {
      const created = await manager.createPaymentRequest(
        '0xSender',
        '0xRecipient',
        '5000000000000000',
        'test-service',
      )

      const retrieved = await manager.getPaymentRequest(created.requestId)
      expect(retrieved).toEqual(created)
    })

    it('should return null for non-existent request', async () => {
      const retrieved = await manager.getPaymentRequest('non-existent-id')
      expect(retrieved).toBeNull()
    })
  })

  describe('isPaymentVerified', () => {
    it('should return false for unverified payment', async () => {
      const request = await manager.createPaymentRequest(
        '0xSender',
        '0xRecipient',
        '5000000000000000',
        'test-service',
      )

      const verified = await manager.isPaymentVerified(request.requestId)
      expect(verified).toBe(false)
    })

    it('should return false for non-existent payment', async () => {
      const verified = await manager.isPaymentVerified('non-existent')
      expect(verified).toBe(false)
    })
  })

  describe('cancelPaymentRequest', () => {
    it('should remove payment from storage', async () => {
      const request = await manager.createPaymentRequest(
        '0xSender',
        '0xRecipient',
        '5000000000000000',
        'test-service',
      )

      const cancelled = await manager.cancelPaymentRequest(request.requestId)
      expect(cancelled).toBe(true)

      const retrieved = await manager.getPaymentRequest(request.requestId)
      expect(retrieved).toBeNull()
    })
  })

  describe('getPendingPayments', () => {
    it('should return only unverified payments', async () => {
      await manager.createPaymentRequest(
        '0xSender',
        '0xRecipient',
        '5000000000000000',
        'service-1',
      )
      await manager.createPaymentRequest(
        '0xSender',
        '0xRecipient',
        '5000000000000000',
        'service-2',
      )

      const pending = await manager.getPendingPayments()
      expect(pending.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('getStatistics', () => {
    it('should count pending payments', async () => {
      await manager.createPaymentRequest(
        '0xSender',
        '0xRecipient',
        '5000000000000000',
        'service-1',
      )
      await manager.createPaymentRequest(
        '0xSender',
        '0xRecipient',
        '5000000000000000',
        'service-2',
      )

      const stats = await manager.getStatistics()
      expect(stats.pending).toBeGreaterThanOrEqual(2)
      expect(stats.verified).toBe(0)
    })
  })

  describe('verifyPayment', () => {
    it('should reject expired payment requests', async () => {
      // Create with very short timeout
      const shortManager = new X402Manager({
        rpcUrl: 'http://127.0.0.1:8545',
        paymentTimeout: 1, // 1ms timeout
        redis: redisClient,
      })

      const request = await shortManager.createPaymentRequest(
        '0xSender',
        '0xRecipient',
        '5000000000000000',
        'test-service',
      )

      // Wait for expiration
      await new Promise((r) => setTimeout(r, 10))

      const result = await shortManager.verifyPayment({
        requestId: request.requestId,
        txHash:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      })

      expect(result.verified).toBe(false)
      expect(result.error).toContain('expired')
    })

    it('should reject non-existent payment request', async () => {
      const result = await manager.verifyPayment({
        requestId: 'non-existent',
        txHash:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      })

      expect(result.verified).toBe(false)
      expect(result.error).toContain('not found')
    })
  })
})

// Tests that work with in-memory storage (no Redis required)
describe('X402Manager in-memory mode', () => {
  let manager: X402Manager

  beforeEach(() => {
    manager = new X402Manager({
      rpcUrl: 'http://127.0.0.1:8545',
      minPaymentAmount: '1000000000000000',
      paymentTimeout: 5000,
    })
  })

  afterEach(() => {
    manager.cleanup()
  })

  it('should work with in-memory storage only', async () => {
    const request = await manager.createPaymentRequest(
      '0xSender',
      '0xRecipient',
      '5000000000000000',
      'test-service',
    )

    const retrieved = await manager.getPaymentRequest(request.requestId)
    expect(retrieved).toEqual(request)
  })

  it('should maintain payments across operations', async () => {
    const request1 = await manager.createPaymentRequest(
      '0xSender',
      '0xRecipient',
      '5000000000000000',
      'service-1',
    )
    const _request2 = await manager.createPaymentRequest(
      '0xSender',
      '0xRecipient',
      '5000000000000000',
      'service-2',
    )

    const pending = await manager.getPendingPayments()
    expect(pending).toHaveLength(2)

    await manager.cancelPaymentRequest(request1.requestId)

    const pendingAfter = await manager.getPendingPayments()
    expect(pendingAfter).toHaveLength(1)
    expect(pendingAfter[0].service).toBe('service-2')
  })

  it('should create payment with unique request ID', async () => {
    const request1 = await manager.createPaymentRequest(
      '0xSender',
      '0xRecipient',
      '5000000000000000',
      'service-1',
    )
    const request2 = await manager.createPaymentRequest(
      '0xSender',
      '0xRecipient',
      '5000000000000000',
      'service-2',
    )

    expect(request1.requestId).not.toBe(request2.requestId)
  })

  it('should track expiration correctly', async () => {
    const request = await manager.createPaymentRequest(
      '0xSender',
      '0xRecipient',
      '5000000000000000',
      'test-service',
    )

    // Expiry should be in the future
    expect(request.expiresAt).toBeGreaterThan(Date.now())
    // But not too far (5 second timeout)
    expect(request.expiresAt).toBeLessThan(Date.now() + 10000)
  })
})
