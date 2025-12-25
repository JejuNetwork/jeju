/**
 * Oracle types
 */

import type { Hex } from 'viem'

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
