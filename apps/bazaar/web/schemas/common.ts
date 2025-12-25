/**
 * App-specific common schemas used across Bazaar
 *
 * For shared schemas like AddressSchema, BigIntSchema, etc.,
 * import directly from @jejunetwork/types
 */

import {
  AddressSchema,
  EvmChainIdSchema,
  HashSchema,
  SolanaNetworkIdSchema,
} from '@jejunetwork/types'
import { z } from 'zod'

// App-specific: Chain type enum
export const ChainTypeSchema = z.enum(['evm', 'solana'])
export type ChainType = z.infer<typeof ChainTypeSchema>

// App-specific: Combined chain IDs
export const ChainIdSchema = z.union([EvmChainIdSchema, SolanaNetworkIdSchema])
export type ChainId = z.infer<typeof ChainIdSchema>

// App-specific: BigInt string validation (for API inputs)
export const BigIntStringSchema = z.string().refine(
  (val) => {
    try {
      BigInt(val)
      return true
    } catch {
      return false
    }
  },
  { error: 'Invalid bigint string' },
)

// App-specific: Date with transform to Date object
export const DateSchema = z.union([
  z.date(),
  z
    .string()
    .datetime()
    .transform((val) => new Date(val)),
])

// App-specific: Address including zero address
export const AddressOrEmptySchema = z.union([
  AddressSchema,
  z.literal('0x0000000000000000000000000000000000000000'),
])

// App-specific: Transaction hash alias
export const TransactionHashSchema = HashSchema

// App-specific: Block number
export const BlockNumberSchema = z
  .number()
  .int()
  .nonnegative('Block number must be non-negative')
