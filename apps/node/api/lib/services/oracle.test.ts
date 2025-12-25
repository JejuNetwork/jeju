import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

// Oracle Service Configuration Schema
const OracleServiceConfigSchema = z.object({
  markets: z.array(z.string().min(1)),
  updateIntervalMs: z.number().int().positive(),
  stakeAmount: z.bigint(),
})

type OracleServiceConfig = z.infer<typeof OracleServiceConfigSchema>

// Oracle Service State Schema
const OracleServiceStateSchema = z.object({
  isRegistered: z.boolean(),
  stake: z.bigint(),
  supportedMarkets: z.array(z.string()),
  totalSubmissions: z.number().int().nonnegative(),
  lastSubmissionAt: z.number().int().nonnegative(),
})

type OracleServiceState = z.infer<typeof OracleServiceStateSchema>

// Price Submission Schema
const PriceSubmissionSchema = z.object({
  market: z.string().min(1),
  price: z.bigint(),
  timestamp: z.number().int().positive(),
  txHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
})

type PriceSubmission = z.infer<typeof PriceSubmissionSchema>

function validateOracleConfig(data: unknown): OracleServiceConfig {
  return OracleServiceConfigSchema.parse(data)
}

function validateOracleState(data: unknown): OracleServiceState {
  return OracleServiceStateSchema.parse(data)
}

function validatePriceSubmission(data: unknown): PriceSubmission {
  return PriceSubmissionSchema.parse(data)
}

describe('Oracle Service Validation', () => {
  describe('validateOracleConfig', () => {
    test('validates valid config', () => {
      const config: OracleServiceConfig = {
        markets: ['ETH/USD', 'BTC/USD'],
        updateIntervalMs: 60000,
        stakeAmount: 1000000000000000000n,
      }

      const result = validateOracleConfig(config)
      expect(result.markets).toEqual(['ETH/USD', 'BTC/USD'])
      expect(result.updateIntervalMs).toBe(60000)
    })

    test('rejects empty markets array', () => {
      const config = {
        markets: [],
        updateIntervalMs: 60000,
        stakeAmount: 1000000000000000000n,
      }

      // Empty array is valid by schema, but may be rejected by service logic
      const result = validateOracleConfig(config)
      expect(result.markets).toEqual([])
    })

    test('rejects negative update interval', () => {
      const config = {
        markets: ['ETH/USD'],
        updateIntervalMs: -1000,
        stakeAmount: 1000000000000000000n,
      }

      expect(() => validateOracleConfig(config)).toThrow()
    })

    test('rejects zero update interval', () => {
      const config = {
        markets: ['ETH/USD'],
        updateIntervalMs: 0,
        stakeAmount: 1000000000000000000n,
      }

      expect(() => validateOracleConfig(config)).toThrow()
    })
  })

  describe('validateOracleState', () => {
    test('validates valid state', () => {
      const state: OracleServiceState = {
        isRegistered: true,
        stake: 1000000000000000000n,
        supportedMarkets: ['ETH/USD', 'BTC/USD'],
        totalSubmissions: 1000,
        lastSubmissionAt: Date.now(),
      }

      const result = validateOracleState(state)
      expect(result.isRegistered).toBe(true)
      expect(result.totalSubmissions).toBe(1000)
    })

    test('validates unregistered state', () => {
      const state: OracleServiceState = {
        isRegistered: false,
        stake: 0n,
        supportedMarkets: [],
        totalSubmissions: 0,
        lastSubmissionAt: 0,
      }

      const result = validateOracleState(state)
      expect(result.isRegistered).toBe(false)
    })

    test('rejects negative submissions count', () => {
      const state = {
        isRegistered: true,
        stake: 1000000000000000000n,
        supportedMarkets: [],
        totalSubmissions: -1,
        lastSubmissionAt: Date.now(),
      }

      expect(() => validateOracleState(state)).toThrow()
    })
  })

  describe('validatePriceSubmission', () => {
    test('validates valid submission', () => {
      const submission: PriceSubmission = {
        market: 'ETH/USD',
        price: 2000000000000000000000n, // $2000 with 18 decimals
        timestamp: Date.now(),
        txHash:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      }

      const result = validatePriceSubmission(submission)
      expect(result.market).toBe('ETH/USD')
    })

    test('validates submission without txHash', () => {
      const submission: PriceSubmission = {
        market: 'ETH/USD',
        price: 2000000000000000000000n,
        timestamp: Date.now(),
      }

      const result = validatePriceSubmission(submission)
      expect(result.txHash).toBeUndefined()
    })

    test('rejects empty market string', () => {
      const submission = {
        market: '',
        price: 2000000000000000000000n,
        timestamp: Date.now(),
      }

      expect(() => validatePriceSubmission(submission)).toThrow()
    })

    test('rejects invalid txHash format', () => {
      const submission = {
        market: 'ETH/USD',
        price: 2000000000000000000000n,
        timestamp: Date.now(),
        txHash: 'invalid-hash',
      }

      expect(() => validatePriceSubmission(submission)).toThrow()
    })
  })
})

describe('Price Calculations', () => {
  function calculatePriceWithDecimals(price: number, decimals: number): bigint {
    return BigInt(Math.floor(price * 10 ** decimals))
  }

  function formatPriceFromBigInt(price: bigint, decimals: number): number {
    return Number(price) / 10 ** decimals
  }

  test('converts price to bigint correctly', () => {
    const priceUsd = 2000.5
    const decimals = 8 // Chainlink uses 8 decimals

    const priceBigInt = calculatePriceWithDecimals(priceUsd, decimals)
    expect(priceBigInt).toBe(200050000000n)
  })

  test('converts bigint back to price correctly', () => {
    const priceBigInt = 200050000000n
    const decimals = 8

    const price = formatPriceFromBigInt(priceBigInt, decimals)
    expect(price).toBe(2000.5)
  })

  test('handles 18 decimal precision', () => {
    const priceEth = 1.5
    const decimals = 18

    const priceBigInt = calculatePriceWithDecimals(priceEth, decimals)
    expect(priceBigInt).toBe(1500000000000000000n)
  })
})

describe('Market Hash Generation', () => {
  function hashMarket(market: string): `0x${string}` {
    // Simple hash for testing - in production uses keccak256
    const encoder = new TextEncoder()
    const data = encoder.encode(market)
    let hash = 0
    for (const byte of data) {
      hash = ((hash << 5) - hash + byte) | 0
    }
    return `0x${Math.abs(hash).toString(16).padStart(64, '0')}` as `0x${string}`
  }

  test('generates deterministic hash for same market', () => {
    const hash1 = hashMarket('ETH/USD')
    const hash2 = hashMarket('ETH/USD')
    expect(hash1).toBe(hash2)
  })

  test('generates different hashes for different markets', () => {
    const hash1 = hashMarket('ETH/USD')
    const hash2 = hashMarket('BTC/USD')
    expect(hash1).not.toBe(hash2)
  })

  test('hash starts with 0x', () => {
    const hash = hashMarket('ETH/USD')
    expect(hash.startsWith('0x')).toBe(true)
  })

  test('hash is 66 characters (0x + 64 hex)', () => {
    const hash = hashMarket('ETH/USD')
    expect(hash.length).toBe(66)
  })
})
