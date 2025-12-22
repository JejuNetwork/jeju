/**
 * Common schemas used across the app
 * Re-exports shared schemas from @jejunetwork/types and defines app-specific ones
 */

import {
  AddressSchema,
  BigIntSchema,
  HashSchema,
  IsoDateSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  PercentageSchema,
  PositiveNumberSchema,
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
}
export { UrlSchema as URLSchema }
export { IsoDateSchema as DateStringSchema }

// App-specific: Chain type enum
export const ChainTypeSchema = z.enum(['evm', 'solana'])
export type ChainType = z.infer<typeof ChainTypeSchema>

// App-specific: Supported EVM chain IDs
export const EvmChainIdSchema = z.union([
  z.literal(1), // Ethereum Mainnet
  z.literal(10), // Optimism
  z.literal(56), // BSC
  z.literal(137), // Polygon
  z.literal(42161), // Arbitrum One
  z.literal(43114), // Avalanche
  z.literal(8453), // Base
  z.literal(84532), // Base Sepolia
  z.literal(11155111), // Sepolia
  z.literal(11155420), // Optimism Sepolia
  z.literal(421614), // Arbitrum Sepolia
  z.literal(420690), // Jeju Testnet
  z.literal(420691), // Jeju Mainnet
  z.literal(1337), // Localnet
  z.literal(31337), // Local EVM
])
export type EvmChainId = z.infer<typeof EvmChainIdSchema>

// App-specific: Supported Solana network IDs
export const SolanaNetworkIdSchema = z.union([
  z.literal(101), // Mainnet
  z.literal(103), // Devnet
])
export type SolanaNetworkId = z.infer<typeof SolanaNetworkIdSchema>

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
