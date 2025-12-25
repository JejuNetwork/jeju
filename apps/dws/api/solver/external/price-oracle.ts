/**
 * On-Chain Price Oracle Integration
 *
 * Permissionless price feeds from Chainlink.
 * All reads are on-chain calls - no API keys required.
 */

import { readContract } from '@jejunetwork/contracts'
import type { Address, PublicClient } from 'viem'

// Chainlink Price Feed addresses on Ethereum mainnet
export const CHAINLINK_FEEDS: Record<
  string,
  { address: Address; decimals: number }
> = {
  'ETH/USD': {
    address: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
    decimals: 8,
  },
  'BTC/USD': {
    address: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
    decimals: 8,
  },
  'USDC/USD': {
    address: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
    decimals: 8,
  },
  'USDT/USD': {
    address: '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D',
    decimals: 8,
  },
  'DAI/USD': {
    address: '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9',
    decimals: 8,
  },
  'LINK/USD': {
    address: '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c',
    decimals: 8,
  },
}

// Token addresses to their USD feed key
export const TOKEN_TO_FEED: Record<string, string> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'ETH/USD', // WETH
  '0x0000000000000000000000000000000000000000': 'ETH/USD', // Native ETH
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'BTC/USD', // WBTC
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC/USD', // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT/USD', // USDT
  '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI/USD', // DAI
  '0x514910771af9ca656af840dff83e8264ecf986ca': 'LINK/USD', // LINK
}

// Chainlink Aggregator ABI (minimal)
const AGGREGATOR_ABI = [
  {
    type: 'function',
    name: 'latestRoundData',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  },
] as const

export interface PriceData {
  price: number
  decimals: number
  timestamp: number
  source: 'chainlink' | 'cached'
  stale: boolean
}

export interface TokenPrice {
  token: Address
  priceUsd: number
  decimals: number
  timestamp: number
}

export class PriceOracle {
  private client: PublicClient
  private cache = new Map<string, { price: PriceData; expiry: number }>()
  private readonly CACHE_TTL = 60_000 // 1 minute cache
  private readonly STALE_THRESHOLD = 3600 // 1 hour = stale

  constructor(client: PublicClient) {
    this.client = client
  }

  /**
   * Get USD price for a token
   */
  async getPrice(token: Address): Promise<PriceData | null> {
    const tokenLower = token.toLowerCase()

    // Check cache first
    const cached = this.cache.get(tokenLower)
    if (cached && Date.now() < cached.expiry) {
      return { ...cached.price, source: 'cached' }
    }

    // Find Chainlink feed
    const feedKey = TOKEN_TO_FEED[tokenLower]
    if (!feedKey) return null

    const feed = CHAINLINK_FEEDS[feedKey]
    if (!feed) return null

    try {
      const result = await readContract(this.client, {
        address: feed.address,
        abi: AGGREGATOR_ABI,
        functionName: 'latestRoundData',
      })

      const [, answer, , updatedAt] = result
      const price = Number(answer) / 10 ** feed.decimals
      const timestamp = Number(updatedAt)
      const stale = Date.now() / 1000 - timestamp > this.STALE_THRESHOLD

      const priceData: PriceData = {
        price,
        decimals: feed.decimals,
        timestamp,
        source: 'chainlink',
        stale,
      }

      // Cache it
      this.cache.set(tokenLower, {
        price: priceData,
        expiry: Date.now() + this.CACHE_TTL,
      })

      return priceData
    } catch (err) {
      console.error(`Error fetching Chainlink price for ${feedKey}:`, err)
      return null
    }
  }

  /**
   * Get prices for multiple tokens in parallel
   */
  async getPrices(tokens: Address[]): Promise<Map<string, TokenPrice>> {
    const results = new Map<string, TokenPrice>()

    const pricePromises = tokens.map(async (token) => {
      const price = await this.getPrice(token)
      if (price) {
        results.set(token.toLowerCase(), {
          token,
          priceUsd: price.price,
          decimals: price.decimals,
          timestamp: price.timestamp,
        })
      }
    })

    await Promise.all(pricePromises)
    return results
  }

  /**
   * Get the relative price between two tokens
   */
  async getRelativePrice(
    tokenA: Address,
    tokenB: Address,
  ): Promise<number | null> {
    const [priceA, priceB] = await Promise.all([
      this.getPrice(tokenA),
      this.getPrice(tokenB),
    ])

    if (!priceA || !priceB) return null
    if (priceB.price === 0) return null

    return priceA.price / priceB.price
  }

  /**
   * Calculate fair value for a swap
   */
  async getFairValue(
    sellToken: Address,
    buyToken: Address,
    sellAmount: bigint,
    sellDecimals: number,
    buyDecimals: number,
  ): Promise<bigint | null> {
    const relativePrice = await this.getRelativePrice(sellToken, buyToken)
    if (!relativePrice) return null

    const sellAmountFloat = Number(sellAmount) / 10 ** sellDecimals
    const buyAmountFloat = sellAmountFloat * relativePrice

    return BigInt(Math.floor(buyAmountFloat * 10 ** buyDecimals))
  }

  /**
   * Clear the price cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    }
  }
}
