/**
 * NFT-related Zod schemas
 */

import { z } from 'zod'
import { AddressSchema } from '@jejunetwork/types/contracts'
import {
  BigIntSchema,
  DateSchema,
  NonEmptyStringSchema,
  URLSchema,
  NonNegativeNumberSchema,
} from './common'

export const SolanaCreatorSchema = z.object({
  address: z.string(),
  verified: z.boolean(),
})

export const SolanaNFTSchema = z.object({
  mint: z.string(),
  owner: z.string(),
  name: NonEmptyStringSchema,
  symbol: z.string(),
  uri: URLSchema,
  sellerFeeBasisPoints: z.number().int().min(0).max(10000),
  creators: z.array(SolanaCreatorSchema),
  collection: z.object({
    verified: z.boolean(),
    key: z.string(),
  }).optional(),
})

export type SolanaNFT = z.infer<typeof SolanaNFTSchema>

export const NFTMetadataAttributeSchema = z.object({
  trait_type: z.string(),
  value: z.union([z.string(), z.number()]),
})

export const NFTMetadataJsonSchema = z.object({
  name: NonEmptyStringSchema,
  symbol: z.string().optional(),
  description: z.string().optional(),
  image: URLSchema.optional(),
  animation_url: URLSchema.optional(),
  external_url: URLSchema.optional(),
  attributes: z.array(NFTMetadataAttributeSchema).optional(),
  properties: z.object({
    files: z.array(z.object({
      uri: URLSchema,
      type: z.string(),
    })).optional(),
    category: z.string().optional(),
    creators: z.array(z.object({
      address: z.string(),
      share: z.number().int().min(0).max(100),
    })).optional(),
  }).optional(),
})

export type NFTMetadataJson = z.infer<typeof NFTMetadataJsonSchema>

export const NFTTokenSchema = z.object({
  id: NonEmptyStringSchema,
  tokenId: z.string(),
  owner: z.object({
    address: AddressSchema,
  }).optional(),
  contract: z.object({
    address: AddressSchema,
    name: NonEmptyStringSchema,
  }).optional(),
  metadata: z.string().optional(),
})

export type NFTToken = z.infer<typeof NFTTokenSchema>

export const NFTBalanceSchema = z.object({
  id: NonEmptyStringSchema,
  tokenId: z.string(),
  balance: z.string(),
  contract: z.object({
    address: AddressSchema,
    name: NonEmptyStringSchema,
  }),
})

export type NFTBalance = z.infer<typeof NFTBalanceSchema>

export const NormalizedNFTSchema = z.object({
  id: NonEmptyStringSchema,
  tokenId: z.string(),
  owner: AddressSchema.optional(),
  balance: z.string().optional(),
  contract: AddressSchema.optional(),
  contractName: NonEmptyStringSchema,
  type: z.enum(['ERC721', 'ERC1155']),
  metadata: z.string().optional(),
})

export type NormalizedNFT = z.infer<typeof NormalizedNFTSchema>

export const NFTSchema = z.object({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  image: URLSchema.optional(),
  price: z.string().optional(),
  collection: NonEmptyStringSchema,
})

export type NFT = z.infer<typeof NFTSchema>

export const NFTCollectionSchema = z.object({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  symbol: z.string(),
  address: AddressSchema,
  chainId: z.number().int().positive(),
  totalSupply: z.number().int().nonnegative(),
  ownerCount: z.number().int().nonnegative(),
  floorPrice: BigIntSchema.optional(),
  volume24h: BigIntSchema.optional(),
})

export type NFTCollection = z.infer<typeof NFTCollectionSchema>
