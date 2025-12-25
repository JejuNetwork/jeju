/**
 * Oracle types - re-exported from @jejunetwork/types
 */

import type { Hex } from 'viem'

export type {
  Committee,
  FeedSpec,
  NetworkType,
  NodeMetrics,
  OracleNodeConfig,
  PriceReport as BasePriceReport,
  PriceSourceConfig,
  SignedReport,
} from '@jejunetwork/types'

/**
 * Extended PriceReport with sourcesHash for on-chain submission
 */
export interface PriceReport {
  feedId: Hex
  price: bigint
  confidence: bigint
  timestamp: bigint
  round: bigint
  sourcesHash: Hex
}
