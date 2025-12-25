/**
 * Price Oracle Unit Tests
 *
 * Tests for price oracle calculations and caching logic
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import {
  CHAINLINK_FEEDS,
  TOKEN_TO_FEED,
} from '../../api/solver/external/price-oracle'

// Re-implement fair value calculation for testing
function calculateFairValue(
  sellAmountFloat: number,
  relativePrice: number,
  buyDecimals: number,
): bigint {
  const buyAmountFloat = sellAmountFloat * relativePrice
  return BigInt(Math.floor(buyAmountFloat * 10 ** buyDecimals))
}

// Re-implement relative price calculation
function calculateRelativePrice(priceA: number, priceB: number): number | null {
  if (priceB === 0) return null
  return priceA / priceB
}

// Re-implement staleness check
function isStale(timestamp: number, staleThreshold: number): boolean {
  return Date.now() / 1000 - timestamp > staleThreshold
}

describe('Price Oracle - Chainlink Feed Configuration', () => {
  describe('CHAINLINK_FEEDS', () => {
    test('has ETH/USD feed', () => {
      expect(CHAINLINK_FEEDS['ETH/USD']).toBeDefined()
      expect(CHAINLINK_FEEDS['ETH/USD'].address).toBe(
        '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
      )
      expect(CHAINLINK_FEEDS['ETH/USD'].decimals).toBe(8)
    })

    test('has BTC/USD feed', () => {
      expect(CHAINLINK_FEEDS['BTC/USD']).toBeDefined()
      expect(CHAINLINK_FEEDS['BTC/USD'].address).toBe(
        '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
      )
      expect(CHAINLINK_FEEDS['BTC/USD'].decimals).toBe(8)
    })

    test('has USDC/USD feed', () => {
      expect(CHAINLINK_FEEDS['USDC/USD']).toBeDefined()
      expect(CHAINLINK_FEEDS['USDC/USD'].address).toBe(
        '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
      )
      expect(CHAINLINK_FEEDS['USDC/USD'].decimals).toBe(8)
    })

    test('has USDT/USD feed', () => {
      expect(CHAINLINK_FEEDS['USDT/USD']).toBeDefined()
      expect(CHAINLINK_FEEDS['USDT/USD'].decimals).toBe(8)
    })

    test('has DAI/USD feed', () => {
      expect(CHAINLINK_FEEDS['DAI/USD']).toBeDefined()
      expect(CHAINLINK_FEEDS['DAI/USD'].decimals).toBe(8)
    })

    test('has LINK/USD feed', () => {
      expect(CHAINLINK_FEEDS['LINK/USD']).toBeDefined()
      expect(CHAINLINK_FEEDS['LINK/USD'].decimals).toBe(8)
    })

    test('all feeds have valid Ethereum addresses', () => {
      for (const [_pair, feed] of Object.entries(CHAINLINK_FEEDS)) {
        expect(feed.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
        expect(feed.decimals).toBeGreaterThan(0)
      }
    })
  })

  describe('TOKEN_TO_FEED', () => {
    test('maps WETH to ETH/USD', () => {
      const wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
      expect(TOKEN_TO_FEED[wethAddress]).toBe('ETH/USD')
    })

    test('maps native ETH (zero address) to ETH/USD', () => {
      const zeroAddress = '0x0000000000000000000000000000000000000000'
      expect(TOKEN_TO_FEED[zeroAddress]).toBe('ETH/USD')
    })

    test('maps WBTC to BTC/USD', () => {
      const wbtcAddress = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'
      expect(TOKEN_TO_FEED[wbtcAddress]).toBe('BTC/USD')
    })

    test('maps USDC to USDC/USD', () => {
      const usdcAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
      expect(TOKEN_TO_FEED[usdcAddress]).toBe('USDC/USD')
    })

    test('maps USDT to USDT/USD', () => {
      const usdtAddress = '0xdac17f958d2ee523a2206206994597c13d831ec7'
      expect(TOKEN_TO_FEED[usdtAddress]).toBe('USDT/USD')
    })

    test('maps DAI to DAI/USD', () => {
      const daiAddress = '0x6b175474e89094c44da98b954eedeac495271d0f'
      expect(TOKEN_TO_FEED[daiAddress]).toBe('DAI/USD')
    })

    test('maps LINK to LINK/USD', () => {
      const linkAddress = '0x514910771af9ca656af840dff83e8264ecf986ca'
      expect(TOKEN_TO_FEED[linkAddress]).toBe('LINK/USD')
    })

    test('all mapped tokens have corresponding feeds', () => {
      for (const [_token, feedKey] of Object.entries(TOKEN_TO_FEED)) {
        expect(CHAINLINK_FEEDS[feedKey]).toBeDefined()
      }
    })
  })
})

describe('Price Oracle - Relative Price Calculation', () => {
  describe('calculateRelativePrice', () => {
    test('calculates relative price correctly', () => {
      // If ETH is $2000 and USDC is $1, ETH/USDC = 2000
      const result = calculateRelativePrice(2000, 1)
      expect(result).toBe(2000)
    })

    test('returns null when denominator is 0', () => {
      const result = calculateRelativePrice(2000, 0)
      expect(result).toBeNull()
    })

    test('handles equal prices', () => {
      const result = calculateRelativePrice(1, 1)
      expect(result).toBe(1)
    })

    test('handles inverted pairs correctly', () => {
      const ethToUsdc = calculateRelativePrice(2000, 1)
      const usdcToEth = calculateRelativePrice(1, 2000)

      expect(ethToUsdc).toBe(2000)
      expect(usdcToEth).toBe(0.0005)
    })

    test('handles fractional prices', () => {
      // If tokenA is $0.50 and tokenB is $2
      const result = calculateRelativePrice(0.5, 2)
      expect(result).toBe(0.25)
    })

    test('handles very small prices', () => {
      const result = calculateRelativePrice(0.00001, 1)
      expect(result).toBe(0.00001)
    })

    test('handles very large prices', () => {
      const result = calculateRelativePrice(100000, 0.0001)
      expect(result).toBe(1_000_000_000)
    })
  })
})

describe('Price Oracle - Fair Value Calculation', () => {
  describe('calculateFairValue', () => {
    test('calculates fair value for ETH to USDC swap', () => {
      // Sell 1 ETH at $2000/ETH, USDC has 6 decimals
      const sellAmount = 1 // 1 ETH
      const relativePrice = 2000 // 2000 USDC per ETH
      const buyDecimals = 6

      const result = calculateFairValue(sellAmount, relativePrice, buyDecimals)
      expect(result).toBe(2_000_000_000n) // 2000 USDC in 6 decimals
    })

    test('calculates fair value for USDC to ETH swap', () => {
      // Sell 2000 USDC at 0.0005 ETH/USDC, ETH has 18 decimals
      const sellAmount = 2000
      const relativePrice = 0.0005
      const buyDecimals = 18

      const result = calculateFairValue(sellAmount, relativePrice, buyDecimals)
      expect(result).toBe(1_000_000_000_000_000_000n) // 1 ETH in 18 decimals
    })

    test('handles fractional results by flooring', () => {
      const sellAmount = 1
      const relativePrice = 0.333333 // Results in 0.333333
      const buyDecimals = 6

      const result = calculateFairValue(sellAmount, relativePrice, buyDecimals)
      expect(result).toBe(333_333n) // Floored
    })

    test('returns 0 for zero sell amount', () => {
      const result = calculateFairValue(0, 2000, 18)
      expect(result).toBe(0n)
    })

    test('returns 0 for zero relative price', () => {
      const result = calculateFairValue(100, 0, 18)
      expect(result).toBe(0n)
    })

    test('handles very small amounts', () => {
      // 0.000001 ETH at $2000/ETH = $0.002
      const sellAmount = 0.000001
      const relativePrice = 2000
      const buyDecimals = 6

      const result = calculateFairValue(sellAmount, relativePrice, buyDecimals)
      expect(result).toBe(2000n) // 0.002 USDC = 2000 in 6 decimals
    })

    test('handles different decimal configurations', () => {
      // Token A (8 decimals) to Token B (18 decimals)
      const sellAmount = 1 // 1 token
      const relativePrice = 10
      const buyDecimals = 18

      const result = calculateFairValue(sellAmount, relativePrice, buyDecimals)
      expect(result).toBe(10_000_000_000_000_000_000n) // 10 tokens with 18 decimals
    })
  })
})

describe('Price Oracle - Staleness Detection', () => {
  const STALE_THRESHOLD = 3600 // 1 hour

  describe('isStale', () => {
    test('returns false for recent timestamp', () => {
      const now = Math.floor(Date.now() / 1000)
      const result = isStale(now, STALE_THRESHOLD)
      expect(result).toBe(false)
    })

    test('returns false for timestamp within threshold', () => {
      const now = Math.floor(Date.now() / 1000)
      const recentTimestamp = now - 1800 // 30 minutes ago

      const result = isStale(recentTimestamp, STALE_THRESHOLD)
      expect(result).toBe(false)
    })

    test('returns true for timestamp exceeding threshold', () => {
      const now = Math.floor(Date.now() / 1000)
      const oldTimestamp = now - 7200 // 2 hours ago

      const result = isStale(oldTimestamp, STALE_THRESHOLD)
      expect(result).toBe(true)
    })

    test('returns true at exactly the threshold boundary', () => {
      const now = Math.floor(Date.now() / 1000)
      const boundaryTimestamp = now - STALE_THRESHOLD

      const result = isStale(boundaryTimestamp, STALE_THRESHOLD)
      // At exactly 1 hour, Date.now()/1000 - timestamp = threshold, which is > due to millisecond precision
      expect(result).toBe(true)
    })

    test('returns true just past the threshold', () => {
      const now = Math.floor(Date.now() / 1000)
      const pastBoundary = now - STALE_THRESHOLD - 1

      const result = isStale(pastBoundary, STALE_THRESHOLD)
      expect(result).toBe(true)
    })
  })
})

describe('Price Oracle - Cache Logic', () => {
  // Simulate the cache behavior
  class MockCache {
    private cache = new Map<string, { price: number; expiry: number }>()
    private readonly cacheTtl: number

    constructor(ttlMs: number = 60_000) {
      this.cacheTtl = ttlMs
    }

    get(token: string): number | null {
      const cached = this.cache.get(token.toLowerCase())
      if (cached && Date.now() < cached.expiry) {
        return cached.price
      }
      return null
    }

    set(token: string, price: number): void {
      this.cache.set(token.toLowerCase(), {
        price,
        expiry: Date.now() + this.cacheTtl,
      })
    }

    clear(): void {
      this.cache.clear()
    }

    size(): number {
      return this.cache.size
    }
  }

  let cache: MockCache

  beforeEach(() => {
    cache = new MockCache(60_000)
  })

  test('returns null for uncached token', () => {
    const result = cache.get('0x1234')
    expect(result).toBeNull()
  })

  test('returns cached price within TTL', () => {
    cache.set('0x1234', 2000)
    const result = cache.get('0x1234')
    expect(result).toBe(2000)
  })

  test('normalizes token address to lowercase', () => {
    cache.set('0xABCD', 1500)
    expect(cache.get('0xabcd')).toBe(1500)
    expect(cache.get('0xABCD')).toBe(1500)
  })

  test('clear removes all entries', () => {
    cache.set('0x1234', 2000)
    cache.set('0x5678', 1500)

    expect(cache.size()).toBe(2)
    cache.clear()
    expect(cache.size()).toBe(0)
  })

  test('cache updates existing entry', () => {
    cache.set('0x1234', 2000)
    cache.set('0x1234', 2500)

    expect(cache.get('0x1234')).toBe(2500)
    expect(cache.size()).toBe(1)
  })
})

describe('Price Oracle - Price Normalization', () => {
  // Test price normalization from Chainlink format
  function normalizeChainlinkPrice(
    rawAnswer: bigint,
    feedDecimals: number,
  ): number {
    return Number(rawAnswer) / 10 ** feedDecimals
  }

  test('normalizes 8-decimal Chainlink price', () => {
    // ETH at $2,000.00 with 8 decimals = 200000000000
    const rawPrice = 200000000000n
    const price = normalizeChainlinkPrice(rawPrice, 8)

    expect(price).toBe(2000)
  })

  test('normalizes price with decimals', () => {
    // ETH at $2,345.67 with 8 decimals = 234567000000
    const rawPrice = 234567000000n
    const price = normalizeChainlinkPrice(rawPrice, 8)

    expect(price).toBe(2345.67)
  })

  test('handles small prices', () => {
    // SHIB at $0.00001 with 8 decimals = 1000
    const rawPrice = 1000n
    const price = normalizeChainlinkPrice(rawPrice, 8)

    expect(price).toBe(0.00001)
  })

  test('handles large prices', () => {
    // BTC at $50,000 with 8 decimals = 5000000000000
    const rawPrice = 5000000000000n
    const price = normalizeChainlinkPrice(rawPrice, 8)

    expect(price).toBe(50000)
  })

  test('handles zero price', () => {
    const price = normalizeChainlinkPrice(0n, 8)
    expect(price).toBe(0)
  })
})
