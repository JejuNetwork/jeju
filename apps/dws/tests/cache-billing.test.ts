import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Address, Hex } from 'viem'
import {
  BillingMode,
  type CacheBillingManager,
  type CachePaymentConfig,
  type CacheRentalPlan,
  initializeCacheBilling,
  type PaymentProof,
  PaymentStatus,
  resetCacheBilling,
  SubscriptionStatus,
} from '../api/cache/billing'
import { CacheTier } from '../api/cache/types'

// Test configuration
const TEST_CONFIG: CachePaymentConfig = {
  paymentRecipient: '0x1234567890123456789012345678901234567890' as Address,
  networkId: 420690,
  assetAddress: '0x0000000000000000000000000000000000000000' as Address,
  baseUrl: 'https://cache.test.jeju.network',
  platformFeeBps: 500,
}

// Test plan
const TEST_PLAN: CacheRentalPlan = {
  id: 'test-plan',
  name: 'Test Plan',
  tier: CacheTier.STANDARD,
  maxMemoryMb: 256,
  maxKeys: 100000,
  maxTtlSeconds: 86400,
  pricePerHour: 100000000000000n, // 0.0001 ETH
  pricePerMonth: 50000000000000000n, // 0.05 ETH
  teeRequired: false,
  features: ['test-feature'],
}

// Counter for unique tx hashes
let txHashCounter = 0

// Test payment proof with unique tx hash
function createTestPaymentProof(amount: bigint): PaymentProof {
  txHashCounter++
  const hexCounter = txHashCounter.toString(16).padStart(8, '0')
  return {
    txHash: `0x${hexCounter}${'a'.repeat(56)}` as Hex,
    amount,
    asset: TEST_CONFIG.assetAddress,
    payer: '0x9876543210987654321098765432109876543210' as Address,
    timestamp: Date.now(),
  }
}

describe('CacheBillingManager', () => {
  let manager: CacheBillingManager

  beforeAll(async () => {
    resetCacheBilling()
    manager = await initializeCacheBilling(TEST_CONFIG)
  })

  afterAll(() => {
    resetCacheBilling()
  })

  describe('Payment Requirements', () => {
    test('creates hourly payment requirement', () => {
      const requirement = manager.createPaymentRequirement(
        TEST_PLAN,
        BillingMode.HOURLY,
      )

      expect(requirement.x402Version).toBe(1)
      expect(requirement.error).toBe('Payment required')
      expect(requirement.accepts).toHaveLength(1)
      expect(requirement.accepts[0].scheme).toBe('exact')
      expect(requirement.accepts[0].maxAmountRequired).toBe(
        TEST_PLAN.pricePerHour.toString(),
      )
      expect(requirement.accepts[0].payTo).toBe(TEST_CONFIG.paymentRecipient)
      expect(requirement.accepts[0].metadata?.billingMode).toBe('hourly')
    })

    test('creates monthly payment requirement', () => {
      const requirement = manager.createPaymentRequirement(
        TEST_PLAN,
        BillingMode.MONTHLY,
      )

      expect(requirement.accepts[0].maxAmountRequired).toBe(
        TEST_PLAN.pricePerMonth.toString(),
      )
      expect(requirement.accepts[0].metadata?.billingMode).toBe('monthly')
      expect(requirement.accepts[0].metadata?.periodHours).toBe(720)
    })

    test('includes instance ID in requirement metadata', () => {
      const requirement = manager.createPaymentRequirement(
        TEST_PLAN,
        BillingMode.HOURLY,
        'instance-123',
      )

      expect(requirement.accepts[0].metadata?.instanceId).toBe('instance-123')
    })
  })

  describe('Payment Proof Parsing', () => {
    test('parses valid payment proof header', () => {
      const headers = {
        'x-payment-proof': `0x${'b'.repeat(64)}:1000000000000000:0x0000000000000000000000000000000000000000:0x1111111111111111111111111111111111111111:${Date.now()}`,
      }

      const proof = manager.parsePaymentProof(headers)

      expect(proof).not.toBeNull()
      expect(proof?.txHash).toBe(`0x${'b'.repeat(64)}`)
      expect(proof?.amount).toBe(1000000000000000n)
    })

    test('returns null for missing header', () => {
      const proof = manager.parsePaymentProof({})
      expect(proof).toBeNull()
    })

    test('returns null for invalid format', () => {
      const proof = manager.parsePaymentProof({
        'x-payment-proof': 'invalid',
      })
      expect(proof).toBeNull()
    })

    test('returns null for invalid tx hash', () => {
      const proof = manager.parsePaymentProof({
        'x-payment-proof': 'invalid:1000:0x0:0x1:12345',
      })
      expect(proof).toBeNull()
    })
  })

  describe('Payment Verification', () => {
    test('verifies valid payment', async () => {
      const proof = createTestPaymentProof(TEST_PLAN.pricePerHour)
      const result = await manager.verifyPayment(proof, TEST_PLAN.pricePerHour)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    test('rejects insufficient payment', async () => {
      const proof = createTestPaymentProof(TEST_PLAN.pricePerHour - 1n)
      const result = await manager.verifyPayment(proof, TEST_PLAN.pricePerHour)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Insufficient payment')
    })

    test('rejects expired payment proof', async () => {
      const proof: PaymentProof = {
        ...createTestPaymentProof(TEST_PLAN.pricePerHour),
        timestamp: Date.now() - 400000, // 6+ minutes ago
      }
      const result = await manager.verifyPayment(proof, TEST_PLAN.pricePerHour)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('expired')
    })

    test('rejects invalid transaction hash', async () => {
      const proof: PaymentProof = {
        ...createTestPaymentProof(TEST_PLAN.pricePerHour),
        txHash: '0xinvalid' as Hex,
      }
      const result = await manager.verifyPayment(proof, TEST_PLAN.pricePerHour)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid transaction hash')
    })
  })

  describe('Subscription Management', () => {
    const testOwner = '0xabcdef1234567890abcdef1234567890abcdef12' as Address
    const testInstanceId = `test-instance-${Date.now()}`

    test('creates hourly subscription', async () => {
      const proof = createTestPaymentProof(TEST_PLAN.pricePerHour)

      const subscription = await manager.createSubscription(
        testInstanceId,
        testOwner,
        TEST_PLAN,
        BillingMode.HOURLY,
        proof,
      )

      expect(subscription.instanceId).toBe(testInstanceId)
      expect(subscription.owner).toBe(testOwner)
      expect(subscription.planId).toBe(TEST_PLAN.id)
      expect(subscription.billingMode).toBe(BillingMode.HOURLY)
      expect(subscription.status).toBe(SubscriptionStatus.ACTIVE)
      expect(subscription.totalPaid).toBe(proof.amount)
    })

    test('retrieves subscription by instance ID', async () => {
      const subscription = manager.getSubscription(testInstanceId)

      expect(subscription).not.toBeUndefined()
      expect(subscription?.instanceId).toBe(testInstanceId)
    })

    test('checks active billing status', () => {
      const hasActive = manager.hasActiveBilling(testInstanceId)
      expect(hasActive).toBe(true)
    })

    test('returns false for non-existent instance', () => {
      const hasActive = manager.hasActiveBilling('non-existent')
      expect(hasActive).toBe(false)
    })
  })

  describe('Subscription Renewal', () => {
    const renewInstanceId = `renew-instance-${Date.now()}`
    const renewOwner = '0xfedcba0987654321fedcba0987654321fedcba09' as Address

    test('creates initial subscription', async () => {
      const proof = createTestPaymentProof(TEST_PLAN.pricePerHour)

      const subscription = await manager.createSubscription(
        renewInstanceId,
        renewOwner,
        TEST_PLAN,
        BillingMode.HOURLY,
        proof,
      )

      expect(subscription.status).toBe(SubscriptionStatus.ACTIVE)
    })

    test('processes renewal payment', async () => {
      const subscription = manager.getSubscription(renewInstanceId)
      expect(subscription).not.toBeUndefined()

      const renewalProof: PaymentProof = {
        txHash: `0x${'c'.repeat(64)}` as Hex,
        amount: TEST_PLAN.pricePerHour,
        asset: TEST_CONFIG.assetAddress,
        payer: renewOwner,
        timestamp: Date.now(),
      }

      const renewed = await manager.processRenewal(
        subscription?.id,
        renewalProof,
        TEST_PLAN,
      )

      expect(renewed.status).toBe(SubscriptionStatus.ACTIVE)
      expect(renewed.totalPaid).toBe(TEST_PLAN.pricePerHour * 2n)
    })
  })

  describe('Subscription Cancellation', () => {
    const cancelInstanceId = `cancel-instance-${Date.now()}`
    const cancelOwner = '0x1234abcd5678efgh1234abcd5678efgh1234abcd' as Address

    test('creates subscription to cancel', async () => {
      const proof = createTestPaymentProof(TEST_PLAN.pricePerHour)

      await manager.createSubscription(
        cancelInstanceId,
        cancelOwner,
        TEST_PLAN,
        BillingMode.HOURLY,
        proof,
      )
    })

    test('cancels subscription', async () => {
      const subscription = manager.getSubscription(cancelInstanceId)
      expect(subscription).not.toBeUndefined()

      const cancelled = await manager.cancelSubscription(
        subscription?.id,
        cancelOwner,
      )

      expect(cancelled.status).toBe(SubscriptionStatus.CANCELLED)
      expect(cancelled.cancelledAt).toBeGreaterThan(0)
    })

    test('rejects cancellation by non-owner', async () => {
      // Create a new subscription
      const newInstanceId = `auth-test-${Date.now()}`
      const proof = createTestPaymentProof(TEST_PLAN.pricePerHour)

      const subscription = await manager.createSubscription(
        newInstanceId,
        cancelOwner,
        TEST_PLAN,
        BillingMode.HOURLY,
        proof,
      )

      const wrongOwner = '0x9999999999999999999999999999999999999999' as Address

      await expect(
        manager.cancelSubscription(subscription.id, wrongOwner),
      ).rejects.toThrow('Not subscription owner')
    })
  })

  describe('Usage Metrics', () => {
    test('records usage metrics', async () => {
      const instanceId = `metrics-instance-${Date.now()}`
      const now = Date.now()

      await manager.recordUsage(instanceId, {
        periodStart: now - 3600000,
        periodEnd: now,
        operations: {
          gets: 1000,
          sets: 500,
          deletes: 50,
          total: 1550,
        },
        peakMemoryMb: 128,
        avgMemoryMb: 64,
        networkInBytes: 1024 * 1024,
        networkOutBytes: 512 * 1024,
      })

      // Usage is recorded internally - no direct getter, but invoice generation uses it
    })
  })

  describe('Invoice Generation', () => {
    test('generates invoice for hourly billing', async () => {
      const invoiceInstanceId = `invoice-instance-${Date.now()}`
      const invoiceOwner =
        '0xaaaa111122223333444455556666777788889999' as Address

      // Create subscription
      const proof = createTestPaymentProof(TEST_PLAN.pricePerHour)
      await manager.createSubscription(
        invoiceInstanceId,
        invoiceOwner,
        TEST_PLAN,
        BillingMode.HOURLY,
        proof,
      )

      const now = Date.now()
      const instance = {
        id: invoiceInstanceId,
        owner: invoiceOwner,
        namespace: 'test',
        tier: CacheTier.STANDARD,
        maxMemoryMb: 256,
        usedMemoryMb: 64,
        keyCount: 1000,
        createdAt: now - 7200000,
        expiresAt: now + 86400000,
        status: 'running' as const,
      }

      const invoice = await manager.generateInvoice(
        instance,
        TEST_PLAN,
        now - 7200000, // 2 hours ago
        now,
      )

      expect(invoice.instanceId).toBe(invoiceInstanceId)
      expect(invoice.owner).toBe(invoiceOwner)
      expect(invoice.lineItems.length).toBeGreaterThan(0)
      expect(invoice.total).toBeGreaterThan(0n)
      expect(invoice.status).toBe('issued')
    })
  })

  describe('Payment History', () => {
    const historyOwner = '0xbbbb222233334444555566667777888899990000' as Address

    test('creates payments for history', async () => {
      const instanceId1 = `history-1-${Date.now()}`
      const proof1 = createTestPaymentProof(TEST_PLAN.pricePerHour)

      await manager.createSubscription(
        instanceId1,
        historyOwner,
        TEST_PLAN,
        BillingMode.HOURLY,
        proof1,
      )
    })

    test('retrieves payment history', () => {
      const payments = manager.getPaymentHistory(historyOwner)

      expect(payments.length).toBeGreaterThan(0)
      expect(payments[0].owner).toBe(historyOwner)
      expect(payments[0].status).toBe(PaymentStatus.VERIFIED)
    })

    test('returns empty for unknown owner', () => {
      const unknownOwner =
        '0x0000000000000000000000000000000000000001' as Address
      const payments = manager.getPaymentHistory(unknownOwner)

      expect(payments.length).toBe(0)
    })
  })

  describe('Billing Statistics', () => {
    test('returns billing stats', () => {
      const stats = manager.getBillingStats()

      expect(stats.totalSubscriptions).toBeGreaterThan(0)
      expect(stats.activeSubscriptions).toBeGreaterThanOrEqual(0)
      expect(stats.totalPayments).toBeGreaterThan(0)
      expect(stats.totalRevenue).toBeGreaterThan(0n)
    })
  })

  describe('Replay Protection', () => {
    test('rejects duplicate transaction hash', async () => {
      const instanceId = `replay-test-${Date.now()}`
      const owner = '0xcccc333344445555666677778888999900001111' as Address

      // Create a specific proof for this test
      const replayTxHash = `0x${'f'.repeat(64)}` as Hex
      const proof: PaymentProof = {
        txHash: replayTxHash,
        amount: TEST_PLAN.pricePerHour,
        asset: TEST_CONFIG.assetAddress,
        payer: owner,
        timestamp: Date.now(),
      }

      await manager.createSubscription(
        instanceId,
        owner,
        TEST_PLAN,
        BillingMode.HOURLY,
        proof,
      )

      // Try to use the same proof again
      const secondInstanceId = `replay-test-2-${Date.now()}`
      const duplicateProof: PaymentProof = {
        txHash: replayTxHash, // Same tx hash
        amount: TEST_PLAN.pricePerHour,
        asset: TEST_CONFIG.assetAddress,
        payer: owner,
        timestamp: Date.now(),
      }

      await expect(
        manager.createSubscription(
          secondInstanceId,
          owner,
          TEST_PLAN,
          BillingMode.HOURLY,
          duplicateProof,
        ),
      ).rejects.toThrow('already used')
    })
  })
})

describe('Billing Integration with Routes', () => {
  // These tests verify the billing routes work through the API
  // They use the Elysia app directly

  test('billing requirement endpoint returns 200', async () => {
    const { createCacheRoutes } = await import('../api/cache/routes')
    const { initializeCacheProvisioning, resetCacheProvisioning } =
      await import('../api/cache/provisioning')

    resetCacheProvisioning()
    resetCacheBilling()

    await initializeCacheProvisioning()
    await initializeCacheBilling(TEST_CONFIG)

    const app = createCacheRoutes()

    const response = await app.handle(
      new Request(
        'http://localhost/cache/billing/requirement?planId=standard-256&billingMode=hourly',
      ),
    )

    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.requirement).toBeDefined()
    expect(data.requirement.x402Version).toBe(1)

    resetCacheProvisioning()
    resetCacheBilling()
  })

  test('billing stats endpoint returns stats', async () => {
    const { createCacheRoutes } = await import('../api/cache/routes')
    const { initializeCacheProvisioning, resetCacheProvisioning } =
      await import('../api/cache/provisioning')

    resetCacheProvisioning()
    resetCacheBilling()

    await initializeCacheProvisioning()
    await initializeCacheBilling(TEST_CONFIG)

    const app = createCacheRoutes()

    const response = await app.handle(
      new Request('http://localhost/cache/billing/stats'),
    )

    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.stats).toBeDefined()
    expect(typeof data.stats.totalSubscriptions).toBe('number')

    resetCacheProvisioning()
    resetCacheBilling()
  })
})
