/**
 * Common schemas used across the app
 * Re-exports shared schemas from @jejunetwork/types and defines app-specific ones
 */

import {
  AddressSchema,
  BigIntSchema,
  EvmChainIdSchema,
  HashSchema,
  IsoDateSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  PercentageSchema,
  PositiveNumberSchema,
  SolanaNetworkIdSchema,
  UrlSchema,
} from '@jejunetwork/types'
import { z } from 'zod'

// Re-export shared schemas
export {
  NonEmptyStringSchema,
  BigIntSchema,
  PositiveNumberSchema,
  NonNegativeNumberSchema,
  PercentageSchema,
  EvmChainIdSchema,
  SolanaNetworkIdSchema,
}
export { UrlSchema as URLSchema }
export { IsoDateSchema as DateStringSchema }

// Re-export types
export type { EvmChainId, SolanaNetworkId } from '@jejunetwork/types'

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

// Re-export transaction hash
export const TransactionHashSchema = HashSchema

// App-specific: Block number
export const BlockNumberSchema = z
  .number()
  .int()
  .nonnegative('Block number must be non-negative')
