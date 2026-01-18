/**
 * Solana Price Aggregator - Token price aggregation for Solana tokens
 */

export interface SolanaTokenPrice {
  address: string // Base58 Solana address
  symbol: string
  price: number
  source: string
  timestamp: number
  confidence: number
}

interface SolanaPriceAggregator {
  getPrice(address: string): Promise<SolanaTokenPrice | null>
  getPrices(addresses: string[]): Promise<Map<string, SolanaTokenPrice>>
  subscribe(
    address: string,
    callback: (price: SolanaTokenPrice) => void,
  ): () => void
  start(): void
  stop(): void
}

export function getSolanaPriceAggregator(): SolanaPriceAggregator {
  return {
    getPrice: async () => null,
    getPrices: async () => new Map(),
    subscribe: () => () => {},
    start: () => {},
    stop: () => {},
  }
}
