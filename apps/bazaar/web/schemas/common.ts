/**
 * App-specific common schemas used across Bazaar
 *
 * For shared schemas like AddressSchema, BigIntSchema, etc.,
 * import directly from @jejunetwork/types
 */

import { z } from 'zod'

// App-specific: Chain type enum
export const ChainTypeSchema = z.enum(['evm', 'solana'])
export type ChainType = z.infer<typeof ChainTypeSchema>
