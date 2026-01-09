/**
 * Price Aggregator - Token price aggregation from multiple sources
 */

import type { Address } from 'viem'

export interface PriceSource {
  dex: string
  pool: string
  price: number
  liquidity: number
  lastUpdate: number
}

export interface TokenPrice {
  address: string
  chainId: number
  symbol: string
  price: number
  priceUSD: number
  priceETH: number
  source: string
  sources: PriceSource[]
  timestamp: number
  confidence: number
  liquidityUSD: number
}

interface PriceAggregator {
  getPrice(address: Address, chainId?: number): Promise<TokenPrice | null>
  getPrices(addresses: Address[]): Promise<Map<Address, TokenPrice>>
  getETHPrice(chainId: number): Promise<number>
  subscribe(address: Address, callback: (price: TokenPrice) => void): () => void
  start(): void
  stop(): void
}

let priceAggregator: PriceAggregator | null = null

export function getPriceAggregator(): PriceAggregator {
  if (!priceAggregator) {
    priceAggregator = {
      getPrice: async () => null,
      getPrices: async () => new Map(),
      getETHPrice: async () => 0,
      subscribe: () => () => {},
      start: () => {},
      stop: () => {},
    }
  }
  return priceAggregator
}
