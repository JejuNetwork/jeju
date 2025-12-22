/**
 * A2A Validation Schema Tests
 *
 * Tests Zod schemas for A2A protocol parameters
 */

import { describe, expect, it } from 'bun:test'
import {
  BuySharesParamsSchema,
  CreatePostParamsSchema,
  DiscoverParamsSchema,
  GetFeedParamsSchema,
  OpenPositionParamsSchema,
  PaymentRequestParamsSchema,
  SearchUsersParamsSchema,
  TransferPointsParamsSchema,
} from '../core/validation'

describe('DiscoverParamsSchema', () => {
  it('should accept empty object', () => {
    const result = DiscoverParamsSchema.parse({})
    expect(result).toEqual({})
  })

  it('should accept filters with strategies', () => {
    const result = DiscoverParamsSchema.parse({
      filters: { strategies: ['momentum', 'mean-reversion'] },
    })
    expect(result.filters?.strategies).toEqual(['momentum', 'mean-reversion'])
  })

  it('should accept filters with minReputation', () => {
    const result = DiscoverParamsSchema.parse({
      filters: { minReputation: 100 },
    })
    expect(result.filters?.minReputation).toBe(100)
  })

  it('should accept limit parameter', () => {
    const result = DiscoverParamsSchema.parse({ limit: 50 })
    expect(result.limit).toBe(50)
  })

  it('should reject negative limit', () => {
    expect(() => DiscoverParamsSchema.parse({ limit: -1 })).toThrow()
  })
})

describe('PaymentRequestParamsSchema', () => {
  it('should require to, amount, and service', () => {
    const result = PaymentRequestParamsSchema.parse({
      to: '0xRecipient',
      amount: '1000000000000000',
      service: 'prediction-market',
    })
    expect(result.to).toBe('0xRecipient')
    expect(result.amount).toBe('1000000000000000')
    expect(result.service).toBe('prediction-market')
  })

  it('should accept optional from and metadata', () => {
    const result = PaymentRequestParamsSchema.parse({
      to: '0xRecipient',
      amount: '1000000000000000',
      service: 'test',
      from: '0xSender',
      metadata: { orderId: '123' },
    })
    expect(result.from).toBe('0xSender')
    expect(result.metadata).toEqual({ orderId: '123' })
  })

  it('should reject empty to address', () => {
    expect(() =>
      PaymentRequestParamsSchema.parse({
        to: '',
        amount: '100',
        service: 'test',
      }),
    ).toThrow()
  })
})

describe('BuySharesParamsSchema', () => {
  it('should accept valid buy shares params', () => {
    const result = BuySharesParamsSchema.parse({
      marketId: 'market-123',
      outcome: 'YES',
      amount: 100,
    })
    expect(result.marketId).toBe('market-123')
    expect(result.outcome).toBe('YES')
    expect(result.amount).toBe(100)
  })

  it('should accept NO outcome', () => {
    const result = BuySharesParamsSchema.parse({
      marketId: 'market-123',
      outcome: 'NO',
      amount: 50,
    })
    expect(result.outcome).toBe('NO')
  })

  it('should reject invalid outcome', () => {
    expect(() =>
      BuySharesParamsSchema.parse({
        marketId: 'market-123',
        outcome: 'MAYBE',
        amount: 100,
      }),
    ).toThrow()
  })

  it('should reject non-positive amount', () => {
    expect(() =>
      BuySharesParamsSchema.parse({
        marketId: 'market-123',
        outcome: 'YES',
        amount: 0,
      }),
    ).toThrow()
  })
})

describe('OpenPositionParamsSchema', () => {
  it('should accept valid position params', () => {
    const result = OpenPositionParamsSchema.parse({
      ticker: 'ETH-PERP',
      side: 'LONG',
      amount: 1000,
      leverage: 10,
    })
    expect(result.ticker).toBe('ETH-PERP')
    expect(result.side).toBe('LONG')
    expect(result.amount).toBe(1000)
    expect(result.leverage).toBe(10)
  })

  it('should accept SHORT side', () => {
    const result = OpenPositionParamsSchema.parse({
      ticker: 'BTC-PERP',
      side: 'SHORT',
      amount: 500,
      leverage: 5,
    })
    expect(result.side).toBe('SHORT')
  })

  it('should reject leverage > 100', () => {
    expect(() =>
      OpenPositionParamsSchema.parse({
        ticker: 'ETH-PERP',
        side: 'LONG',
        amount: 1000,
        leverage: 101,
      }),
    ).toThrow()
  })

  it('should reject leverage < 1', () => {
    expect(() =>
      OpenPositionParamsSchema.parse({
        ticker: 'ETH-PERP',
        side: 'LONG',
        amount: 1000,
        leverage: 0,
      }),
    ).toThrow()
  })
})

describe('CreatePostParamsSchema', () => {
  it('should accept content with default type', () => {
    const result = CreatePostParamsSchema.parse({
      content: 'Hello world',
    })
    expect(result.content).toBe('Hello world')
    expect(result.type).toBe('post')
  })

  it('should accept explicit type', () => {
    const result = CreatePostParamsSchema.parse({
      content: 'Article content',
      type: 'article',
    })
    expect(result.type).toBe('article')
  })

  it('should reject empty content', () => {
    expect(() =>
      CreatePostParamsSchema.parse({
        content: '',
      }),
    ).toThrow()
  })

  it('should reject content over 5000 chars', () => {
    expect(() =>
      CreatePostParamsSchema.parse({
        content: 'x'.repeat(5001),
      }),
    ).toThrow()
  })
})

describe('GetFeedParamsSchema', () => {
  it('should accept empty object with defaults', () => {
    const result = GetFeedParamsSchema.parse({})
    expect(result.limit).toBe(20)
    expect(result.offset).toBe(0)
  })

  it('should accept custom limit and offset', () => {
    const result = GetFeedParamsSchema.parse({
      limit: 50,
      offset: 100,
    })
    expect(result.limit).toBe(50)
    expect(result.offset).toBe(100)
  })

  it('should accept following filter', () => {
    const result = GetFeedParamsSchema.parse({
      following: true,
    })
    expect(result.following).toBe(true)
  })

  it('should reject negative offset', () => {
    expect(() =>
      GetFeedParamsSchema.parse({
        offset: -1,
      }),
    ).toThrow()
  })
})

describe('SearchUsersParamsSchema', () => {
  it('should require query', () => {
    const result = SearchUsersParamsSchema.parse({
      query: 'alice',
    })
    expect(result.query).toBe('alice')
    expect(result.limit).toBe(20) // default
  })

  it('should accept custom limit', () => {
    const result = SearchUsersParamsSchema.parse({
      query: 'bob',
      limit: 10,
    })
    expect(result.limit).toBe(10)
  })

  it('should reject empty query', () => {
    expect(() =>
      SearchUsersParamsSchema.parse({
        query: '',
      }),
    ).toThrow()
  })
})

describe('TransferPointsParamsSchema', () => {
  it('should accept valid transfer params', () => {
    const result = TransferPointsParamsSchema.parse({
      recipientId: 'user-123',
      amount: 100,
    })
    expect(result.recipientId).toBe('user-123')
    expect(result.amount).toBe(100)
    expect(result.message).toBeUndefined()
  })

  it('should accept optional message', () => {
    const result = TransferPointsParamsSchema.parse({
      recipientId: 'user-123',
      amount: 50,
      message: 'Thanks for your help',
    })
    expect(result.message).toBe('Thanks for your help')
  })

  it('should reject non-integer amount', () => {
    expect(() =>
      TransferPointsParamsSchema.parse({
        recipientId: 'user-123',
        amount: 50.5,
      }),
    ).toThrow()
  })

  it('should reject message over 200 chars', () => {
    expect(() =>
      TransferPointsParamsSchema.parse({
        recipientId: 'user-123',
        amount: 50,
        message: 'x'.repeat(201),
      }),
    ).toThrow()
  })
})
