/**
 * Oracle Service
 * Uses Jeju Oracle Network (JON) for price data
 */

import * as jeju from '../jeju';
import { SupportedChainId, SUPPORTED_CHAINS } from '../rpc';

export interface GasPrice {
  slow: { gwei: number; estimatedTime: number };
  standard: { gwei: number; estimatedTime: number };
  fast: { gwei: number; estimatedTime: number };
}

export interface TokenPrice {
  symbol: string;
  priceUsd: number;
  change24h?: number;
  timestamp: number;
}

// Native token symbols by chain
const NATIVE_SYMBOLS: Record<number, string> = {
  1: 'ETH',
  8453: 'ETH',
  42161: 'ETH',
  10: 'ETH',
  56: 'BNB',
  1337: 'ETH',
  420691: 'ETH',
};

// Fallback prices (used when oracle unavailable)
const FALLBACK_PRICES: Record<string, number> = {
  ETH: 3000,
  BNB: 600,
  USDC: 1,
  USDT: 1,
  DAI: 1,
  WETH: 3000,
};

class OracleService {
  private priceCache = new Map<string, { price: number; timestamp: number }>();
  private cacheExpiry = 30_000; // 30 seconds

  // Get native token price in USD
  async getNativeTokenPrice(chainId: SupportedChainId): Promise<number> {
    const symbol = NATIVE_SYMBOLS[chainId] || 'ETH';
    return this.getTokenPrice(symbol);
  }

  // Get token price in USD
  async getTokenPrice(symbol: string): Promise<number> {
    const cached = this.priceCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.price;
    }

    try {
      const prices = await jeju.getOraclePrices([symbol]);
      const feed = prices.get(symbol);
      
      if (feed) {
        const price = Number(feed.price) / 10 ** feed.decimals;
        this.priceCache.set(symbol, { price, timestamp: Date.now() });
        return price;
      }
    } catch (error) {
      console.warn('Oracle fetch failed, using fallback:', error);
    }

    return FALLBACK_PRICES[symbol] || 0;
  }

  // Get multiple token prices
  async getTokenPrices(symbols: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    
    try {
      const prices = await jeju.getOraclePrices(symbols);
      
      for (const symbol of symbols) {
        const feed = prices.get(symbol);
        if (feed) {
          const price = Number(feed.price) / 10 ** feed.decimals;
          result.set(symbol, price);
          this.priceCache.set(symbol, { price, timestamp: Date.now() });
        } else {
          result.set(symbol, FALLBACK_PRICES[symbol] || 0);
        }
      }
    } catch {
      // Use fallbacks
      for (const symbol of symbols) {
        result.set(symbol, FALLBACK_PRICES[symbol] || 0);
      }
    }

    return result;
  }

  // Get gas prices for a chain
  async getGasPrice(chainId: SupportedChainId): Promise<GasPrice> {
    try {
      const prices = await jeju.getGasPrice();
      
      return {
        slow: { gwei: Number(prices.slow) / 1e9, estimatedTime: 120 },
        standard: { gwei: Number(prices.standard) / 1e9, estimatedTime: 60 },
        fast: { gwei: Number(prices.fast) / 1e9, estimatedTime: 15 },
      };
    } catch {
      // Fallback based on chain
      const base = chainId === 1 ? 30 : chainId === 56 ? 3 : 0.001;
      return {
        slow: { gwei: base * 0.8, estimatedTime: 120 },
        standard: { gwei: base, estimatedTime: 60 },
        fast: { gwei: base * 1.5, estimatedTime: 15 },
      };
    }
  }

  // Convert token amount to USD
  async toUsd(symbol: string, amount: bigint, decimals = 18): Promise<number> {
    const price = await this.getTokenPrice(symbol);
    return (Number(amount) / 10 ** decimals) * price;
  }

  // Clear cache
  clearCache(): void {
    this.priceCache.clear();
  }
}

export const oracleService = new OracleService();
export { OracleService };
