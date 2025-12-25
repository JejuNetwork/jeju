/**
 * NFT-related Zod schemas
 */

import { AddressSchema, NonEmptyStringSchema } from '@jejunetwork/types'
import { z } from 'zod'

const NormalizedNFTSchema = z.object({
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
