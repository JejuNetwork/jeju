/**
 * SDK Shared Utilities Tests
 *
 * Tests shared schemas and API utilities
 */

import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import {
  LPPositionSchema,
  PaymasterDetailSchema,
  PaymasterInfoResponseSchema,
} from '../shared/schemas'

describe('LPPositionSchema', () => {
  it('should validate LP position with string values', () => {
    const position = {
      ethShares: '1000000000000000000',
      tokenShares: '5000000',
    }

    const result = LPPositionSchema.parse(position)
    expect(result.ethShares).toBe('1000000000000000000')
    expect(result.tokenShares).toBe('5000000')
  })

  it('should reject invalid LP position', () => {
    expect(() => LPPositionSchema.parse({})).toThrow()
    expect(() => LPPositionSchema.parse({ ethShares: 123 })).toThrow()
  })
})

describe('PaymasterInfoResponseSchema', () => {
  it('should validate paymaster list response', () => {
    const response = {
      paymasters: [
        {
          address: '0x1234567890123456789012345678901234567890',
          token: '0xabcdef1234567890123456789012345678901234',
          tokenSymbol: 'USDC',
          active: true,
          entryPointBalance: '1000000000000000000',
          vaultLiquidity: '5000000000000000000',
          exchangeRate: '1000000',
        },
      ],
    }

    const result = PaymasterInfoResponseSchema.parse(response)
    expect(result.paymasters).toHaveLength(1)
    expect(result.paymasters[0].tokenSymbol).toBe('USDC')
  })

  it('should validate empty paymasters list', () => {
    const response = { paymasters: [] }
    const result = PaymasterInfoResponseSchema.parse(response)
    expect(result.paymasters).toHaveLength(0)
  })
})

describe('PaymasterDetailSchema', () => {
  it('should validate paymaster detail with vault', () => {
    const detail = {
      vault: '0xabcdef1234567890123456789012345678901234',
    }

    const result = PaymasterDetailSchema.parse(detail)
    expect(result.vault).toBe('0xabcdef1234567890123456789012345678901234')
  })

  it('should reject missing vault', () => {
    expect(() => PaymasterDetailSchema.parse({})).toThrow()
  })
})

describe('API response validation patterns', () => {
  it('should handle bigint conversion from string', () => {
    const rawApiResponse = {
      balance: '1234567890123456789',
      shares: '9876543210',
    }

    const schema = z.object({
      balance: z.string().transform((v) => BigInt(v)),
      shares: z.string().transform((v) => BigInt(v)),
    })

    const result = schema.parse(rawApiResponse)
    expect(result.balance).toBe(1234567890123456789n)
    expect(result.shares).toBe(9876543210n)
  })

  it('should handle optional fields with defaults', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional().default('default-value'),
    })

    const result = schema.parse({ required: 'test' })
    expect(result.required).toBe('test')
    expect(result.optional).toBe('default-value')
  })
})
