/**
 * Oracle types - re-exported from @jejunetwork/types
 */

export type {
  NodeMetrics,
  OracleNodeConfig,
  PriceSourceConfig,
  SignedReport,
} from '@jejunetwork/types'

export { type NetworkType } from '@jejunetwork/types'

// Re-export PriceReport-like interface for backwards compatibility
export interface PriceReport {
  feedId: `0x${string}`
  price: bigint
  confidence: bigint
  timestamp: bigint
  round: bigint
  sourcesHash: `0x${string}`
}

// Re-export FeedSpec-like interface for backwards compatibility
export interface FeedSpec {
  feedId: `0x${string}`
  symbol: string
  baseToken: `0x${string}`
  quoteToken: `0x${string}`
  decimals: number
  heartbeatSeconds: number
  twapWindowSeconds: number
  minLiquidityUSD: bigint
  maxDeviationBps: number
  minOracles: number
  quorumThreshold: number
  isActive: boolean
  category: number
}

// Re-export Committee-like interface
export interface Committee {
  feedId: `0x${string}`
  round: bigint
  members: `0x${string}`[]
  threshold: number
  activeUntil: bigint
  leader: `0x${string}`
  isActive: boolean
}
