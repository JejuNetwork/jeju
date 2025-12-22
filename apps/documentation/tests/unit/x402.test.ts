import { describe, expect, test } from 'bun:test'
import {
  createPaymentRequirement,
  PAYMENT_TIERS,
  parseEther,
} from '../../lib/x402'

describe('Payment Tiers', () => {
  test('PREMIUM_DOCS is 0.01 ETH', () => {
    expect(PAYMENT_TIERS.PREMIUM_DOCS).toBe(parseEther('0.01'))
  })

  test('API_DOCS is 0.005 ETH', () => {
    expect(PAYMENT_TIERS.API_DOCS).toBe(parseEther('0.005'))
  })

  test('TUTORIALS is 0.02 ETH', () => {
    expect(PAYMENT_TIERS.TUTORIALS).toBe(parseEther('0.02'))
  })

  test('EXAMPLES is 0.01 ETH', () => {
    expect(PAYMENT_TIERS.EXAMPLES).toBe(parseEther('0.01'))
  })

  test('all tiers are bigint', () => {
    expect(typeof PAYMENT_TIERS.PREMIUM_DOCS).toBe('bigint')
    expect(typeof PAYMENT_TIERS.API_DOCS).toBe('bigint')
    expect(typeof PAYMENT_TIERS.TUTORIALS).toBe('bigint')
    expect(typeof PAYMENT_TIERS.EXAMPLES).toBe('bigint')
  })

  test('tier order is correct', () => {
    expect(PAYMENT_TIERS.API_DOCS).toBeLessThan(PAYMENT_TIERS.PREMIUM_DOCS)
    expect(PAYMENT_TIERS.PREMIUM_DOCS).toBeLessThan(PAYMENT_TIERS.TUTORIALS)
  })
})

describe('Create Payment Requirement', () => {
  const recipientAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const
  const tokenAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
  const zeroAddress = '0x0000000000000000000000000000000000000000' as const

  test('creates valid payment requirement', () => {
    const req = createPaymentRequirement(
      '/api/docs',
      PAYMENT_TIERS.API_DOCS,
      'API documentation access',
      recipientAddress,
    )
    expect(req).toBeDefined()
    expect(req.x402Version).toBe(1)
    expect(req.error).toBe('Payment required to access this resource')
    expect(req.accepts).toHaveLength(1)
  })

  test('includes correct recipient', () => {
    const req = createPaymentRequirement(
      '/api/docs',
      PAYMENT_TIERS.API_DOCS,
      'Test',
      recipientAddress,
    )
    expect(req.accepts[0].payTo).toBe(recipientAddress)
  })

  test('includes correct amount', () => {
    const amount = PAYMENT_TIERS.PREMIUM_DOCS
    const req = createPaymentRequirement(
      '/premium',
      amount,
      'Test',
      recipientAddress,
    )
    expect(req.accepts[0].maxAmountRequired).toBe(amount.toString())
  })

  test('includes correct resource', () => {
    const resource = '/api/special-endpoint'
    const req = createPaymentRequirement(
      resource,
      PAYMENT_TIERS.API_DOCS,
      'Test',
      recipientAddress,
    )
    expect(req.accepts[0].resource).toBe(resource)
  })

  test('uses default token address (zero address)', () => {
    const req = createPaymentRequirement(
      '/api/docs',
      PAYMENT_TIERS.API_DOCS,
      'Test',
      recipientAddress,
    )
    expect(req.accepts[0].asset).toBe(zeroAddress)
  })

  test('accepts custom token address', () => {
    const req = createPaymentRequirement(
      '/api/docs',
      PAYMENT_TIERS.API_DOCS,
      'Test',
      recipientAddress,
      tokenAddress,
    )
    expect(req.accepts[0].asset).toBe(tokenAddress)
  })

  test('uses default network (jeju)', () => {
    const req = createPaymentRequirement(
      '/api/docs',
      PAYMENT_TIERS.API_DOCS,
      'Test',
      recipientAddress,
    )
    expect(req.accepts[0].network).toBe('jeju')
  })

  test('accepts custom network', () => {
    const req = createPaymentRequirement(
      '/api/docs',
      PAYMENT_TIERS.API_DOCS,
      'Test',
      recipientAddress,
      zeroAddress,
      'base-sepolia',
    )
    expect(req.accepts[0].network).toBe('base-sepolia')
  })

  test('uses exact scheme', () => {
    const req = createPaymentRequirement(
      '/api/docs',
      PAYMENT_TIERS.API_DOCS,
      'Test',
      recipientAddress,
    )
    expect(req.accepts[0].scheme).toBe('exact')
  })

  test('sets reasonable timeout', () => {
    const req = createPaymentRequirement(
      '/api/docs',
      PAYMENT_TIERS.API_DOCS,
      'Test',
      recipientAddress,
    )
    expect(req.accepts[0].maxTimeoutSeconds).toBe(300)
  })
})

describe('Edge Cases', () => {
  const recipientAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const

  test('handles zero amount', () => {
    const req = createPaymentRequirement(
      '/free',
      0n,
      'Free resource',
      recipientAddress,
    )
    expect(req.accepts[0].maxAmountRequired).toBe('0')
  })

  test('handles very large amount', () => {
    const largeAmount = parseEther('1000000')
    const req = createPaymentRequirement(
      '/expensive',
      largeAmount,
      'Expensive resource',
      recipientAddress,
    )
    expect(req.accepts[0].maxAmountRequired).toBe(largeAmount.toString())
  })

  test('handles special characters in resource', () => {
    const resource = '/api/docs?query=test&page=1#section'
    const req = createPaymentRequirement(
      resource,
      PAYMENT_TIERS.API_DOCS,
      'Test',
      recipientAddress,
    )
    expect(req.accepts[0].resource).toBe(resource)
  })

  test('handles unicode in description', () => {
    const description = 'Documentation access 文档访问 📚'
    const req = createPaymentRequirement(
      '/api',
      PAYMENT_TIERS.API_DOCS,
      description,
      recipientAddress,
    )
    expect(req.accepts[0].description).toBe(description)
  })
})

describe('Amount Calculations', () => {
  test('1 ETH in wei', () => {
    expect(parseEther('1')).toBe(1000000000000000000n)
  })

  test('0.01 ETH in wei', () => {
    expect(parseEther('0.01')).toBe(10000000000000000n)
  })

  test('tier amounts are in wei', () => {
    expect(PAYMENT_TIERS.PREMIUM_DOCS).toBe(10000000000000000n)
    expect(PAYMENT_TIERS.API_DOCS).toBe(5000000000000000n)
    expect(PAYMENT_TIERS.TUTORIALS).toBe(20000000000000000n)
  })
})
