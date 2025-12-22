/**
 * Token-related Zod schemas
 */

import { AddressSchema } from '@jejunetwork/types'
import { z } from 'zod'
import {
  BigIntSchema,
  ChainTypeSchema,
  DateSchema,
  EvmChainIdSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  PercentageSchema,
  SolanaNetworkIdSchema,
  URLSchema,
} from './common'

export const TokenMetadataSchema = z.object({
  name: NonEmptyStringSchema,
  symbol: NonEmptyStringSchema.max(10, 'Symbol must be 10 characters or less'),
  description: z.string().optional(),
  imageUrl: URLSchema.optional(),
  website: URLSchema.optional(),
  twitter: z
    .string()
    .regex(/^[a-zA-Z0-9_]{1,15}$/, 'Invalid Twitter handle')
    .optional(),
  telegram: z.string().optional(),
  discord: URLSchema.optional(),
})

export type TokenMetadata = z.infer<typeof TokenMetadataSchema>

export const BondingCurveSchema = z.object({
  virtualReserves: BigIntSchema,
  realReserves: BigIntSchema,
  progress: PercentageSchema,
  graduated: z.boolean(),
  graduationTarget: BigIntSchema,
})

export type BondingCurve = z.infer<typeof BondingCurveSchema>

export const TokenBaseSchema = z.object({
  id: NonEmptyStringSchema,
  chainType: ChainTypeSchema,
  contractAddress: z.string(),
  name: NonEmptyStringSchema,
  symbol: NonEmptyStringSchema,
  decimals: z.number().int().min(0).max(18),
  imageUrl: URLSchema.optional(),
  description: z.string().optional(),
  website: URLSchema.optional(),
  twitter: z.string().optional(),
  telegram: z.string().optional(),
  discord: z.string().optional(),
  createdAt: DateSchema,
  createdBy: z.string(),
  verified: z.boolean(),
  scamWarning: z.boolean(),
})

export const EvmTokenSchema = TokenBaseSchema.extend({
  chainType: z.literal('evm'),
  chainId: EvmChainIdSchema,
  contractAddress: AddressSchema,
  totalSupply: BigIntSchema,
  marketCap: BigIntSchema.optional(),
  liquidity: BigIntSchema.optional(),
  priceUsd: NonNegativeNumberSchema.optional(),
  price24hChange: z.number().optional(),
  volume24h: BigIntSchema.optional(),
  holders: z.number().int().nonnegative().optional(),
  bondingCurve: BondingCurveSchema.optional(),
})

export type EvmToken = z.infer<typeof EvmTokenSchema>

export const SolanaTokenSchema = TokenBaseSchema.extend({
  chainType: z.literal('solana'),
  networkId: SolanaNetworkIdSchema,
  mint: z.string(),
  totalSupply: BigIntSchema,
  marketCap: BigIntSchema.optional(),
  priceUsd: NonNegativeNumberSchema.optional(),
  volume24h: BigIntSchema.optional(),
})

export type SolanaToken = z.infer<typeof SolanaTokenSchema>

export const TokenSchema = z.discriminatedUnion('chainType', [
  EvmTokenSchema,
  SolanaTokenSchema,
])

export type Token = z.infer<typeof TokenSchema>

export const TokenTradeSchema = z.object({
  id: NonEmptyStringSchema,
  tokenId: NonEmptyStringSchema,
  trader: AddressSchema,
  isBuy: z.boolean(),
  tokenAmount: BigIntSchema,
  ethAmount: BigIntSchema,
  pricePerToken: BigIntSchema,
  timestamp: DateSchema,
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  blockNumber: z.number().int().nonnegative(),
})

export type TokenTrade = z.infer<typeof TokenTradeSchema>

export const TokenHolderSchema = z.object({
  address: AddressSchema,
  balance: BigIntSchema,
  percentage: PercentageSchema,
  firstPurchase: DateSchema,
  isCreator: z.boolean(),
  labels: z.array(z.string()),
})

export type TokenHolder = z.infer<typeof TokenHolderSchema>

export const CreateTokenParamsSchema = z.object({
  chainType: ChainTypeSchema,
  chainId: z.union([EvmChainIdSchema, SolanaNetworkIdSchema]),
  metadata: TokenMetadataSchema,
  initialSupply: BigIntSchema.optional(),
  bondingCurveEnabled: z.boolean().optional(),
  aiGenerated: z.boolean().optional(),
})

export type CreateTokenParams = z.infer<typeof CreateTokenParamsSchema>

export const TokenListFilterSchema = z.object({
  chain: ChainTypeSchema.optional(),
  chainId: z.union([EvmChainIdSchema, SolanaNetworkIdSchema]).optional(),
  verified: z.boolean().optional(),
  graduated: z.boolean().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['newest', 'marketcap', 'volume', 'holders']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
})

export type TokenListFilter = z.infer<typeof TokenListFilterSchema>
