import * as jeju from '../jeju'
import type { SupportedChainId } from '../rpc'

export interface GasPrice {
  slow: { gwei: number; estimatedTime: number }
  standard: { gwei: number; estimatedTime: number }
  fast: { gwei: number; estimatedTime: number }
}

export interface TokenPrice {
  symbol: string
  priceUsd: number
  change24h?: number
  timestamp: number
}

// Native token symbols by chain
const NATIVE_SYMBOLS: Record<number, string> = {
  1: 'ETH',
  8453: 'ETH',
  42161: 'ETH',
  10: 'ETH',
  56: 'BNB',
  31337: 'ETH',
  420691: 'ETH',
}

class OracleService {
  private priceCache = new Map<string, { price: number; timestamp: number }>()
  private cacheExpiry = 30_000 // 30 seconds

  // Get native token price in USD
  async getNativeTokenPrice(chainId: SupportedChainId): Promise<number> {
    const symbol = NATIVE_SYMBOLS[chainId]
    if (!symbol) {
      throw new Error(`No native token symbol configured for chain ${chainId}`)
    }
    return this.getTokenPrice(symbol)
  }

  // Get token price in USD
  async getTokenPrice(symbol: string): Promise<number> {
    const cached = this.priceCache.get(symbol)
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.price
    }

    const prices = await jeju.getOraclePrices([symbol])
    const feed = prices.get(symbol)

    if (!feed) {
      throw new Error(`No price feed for symbol: ${symbol}`)
    }

    const price = Number(feed.price) / 10 ** feed.decimals
    this.priceCache.set(symbol, { price, timestamp: Date.now() })
    return price
  }

  // Get multiple token prices
  async getTokenPrices(symbols: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>()
    const prices = await jeju.getOraclePrices(symbols)

    for (const symbol of symbols) {
      const feed = prices.get(symbol)
      if (!feed) {
        throw new Error(`No price feed for symbol: ${symbol}`)
      }
      const price = Number(feed.price) / 10 ** feed.decimals
      result.set(symbol, price)
      this.priceCache.set(symbol, { price, timestamp: Date.now() })
    }

    return result
  }

  // Get gas prices for a chain
  async getGasPrice(_chainId: SupportedChainId): Promise<GasPrice> {
    const prices = await jeju.getGasPrice()

    return {
      slow: { gwei: Number(prices.slow) / 1e9, estimatedTime: 120 },
      standard: { gwei: Number(prices.standard) / 1e9, estimatedTime: 60 },
      fast: { gwei: Number(prices.fast) / 1e9, estimatedTime: 15 },
    }
  }

  // Convert token amount to USD
  async toUsd(symbol: string, amount: bigint, decimals = 18): Promise<number> {
    const price = await this.getTokenPrice(symbol)
    return (Number(amount) / 10 ** decimals) * price
  }

  // Clear cache
  clearCache(): void {
    this.priceCache.clear()
  }
}

export const oracleService = new OracleService()
export { OracleService }
