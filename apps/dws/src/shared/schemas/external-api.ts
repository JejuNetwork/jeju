/**
 * Schemas for external API responses
 * Used for validated parsing of responses from third-party APIs
 */

import type { Address, Hex } from 'viem'
import { z } from 'zod'
import { addressSchema, strictHexSchema } from '../validation'

// ============ GitHub API Schemas ============

export const GitHubUserSchema = z.object({
  login: z.string(),
  id: z.number(),
  avatar_url: z.string().optional(),
  url: z.string().optional(),
  type: z.string().optional(),
})

export const GitHubRepoSchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  owner: GitHubUserSchema.optional(),
  private: z.boolean().optional(),
  description: z.string().nullable().optional(),
  fork: z.boolean().optional(),
  stargazers_count: z.number().optional(),
  forks_count: z.number().optional(),
})

export const GitHubPackageSchema = z.object({
  repository: z
    .object({
      full_name: z.string(),
      owner: z.object({ login: z.string() }),
    })
    .nullable()
    .optional(),
})

export const GitHubTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
})

// ============ CoW Protocol API Schemas ============

export const CowApiQuoteSchema = z.object({
  quote: z.object({
    sellToken: addressSchema,
    buyToken: addressSchema,
    sellAmount: z.string(),
    buyAmount: z.string(),
    feeAmount: z.string(),
    validTo: z.number(),
    kind: z.string(),
    partiallyFillable: z.boolean().optional(),
    receiver: addressSchema.optional(),
  }),
  from: addressSchema.optional(),
  expiresAt: z.string().optional(),
})

export const CowApiOrderSchema = z.object({
  uid: z.string(),
  sellToken: addressSchema,
  buyToken: addressSchema,
  sellAmount: z.string(),
  buyAmount: z.string(),
  feeAmount: z.string().optional(),
  validTo: z.number(),
  kind: z.string(),
  status: z.string().optional(),
  creationDate: z.string().optional(),
  executedSellAmount: z.string().optional(),
  executedBuyAmount: z.string().optional(),
})

export const CowApiAuctionSchema = z.object({
  id: z.number().optional(),
  block: z.number().optional(),
  orders: z.array(CowApiOrderSchema).optional(),
})

// ============ Flashbots API Schemas ============

export const FlashbotsSubmissionSchema = z.object({
  bundleHash: strictHexSchema.optional(),
  error: z.string().optional(),
  message: z.string().optional(),
})

export const FlashbotsStatsSchema = z.object({
  isHighPriority: z.boolean().optional(),
  isSentToMiners: z.boolean().optional(),
  isSimulated: z.boolean().optional(),
  simulatedAt: z.string().optional(),
  receivedAt: z.string().optional(),
})

// ============ Price API Schemas ============

export const CoinGeckoPriceSchema = z.object({
  ethereum: z.object({
    usd: z.number(),
  }),
})

export const TokenPriceResponseSchema = z.object({
  price: z.number(),
  symbol: z.string().optional(),
  timestamp: z.number().optional(),
})

// ============ Storage API Schemas ============

export const IPFSAddResponseSchema = z.object({
  Hash: z.string(),
  Name: z.string().optional(),
  Size: z.string().optional(),
})

export const IPFSPinResponseSchema = z.object({
  Pins: z.array(z.string()).optional(),
})

export const ArweaveUploadResponseSchema = z.object({
  id: z.string(),
  timestamp: z.number().optional(),
})

// ============ ActivityPub Schemas ============

export const ActivityPubActorSchema = z.object({
  '@context': z.union([z.string(), z.array(z.string())]),
  id: z.string(),
  type: z.enum(['Person', 'Organization', 'Application']),
  preferredUsername: z.string(),
  name: z.string().optional(),
  summary: z.string().optional(),
  inbox: z.string(),
  outbox: z.string(),
  followers: z.string().optional(),
  following: z.string().optional(),
  publicKey: z.object({
    id: z.string(),
    owner: z.string(),
    publicKeyPem: z.string(),
  }),
  icon: z
    .object({
      type: z.literal('Image'),
      url: z.string(),
      mediaType: z.string(),
    })
    .optional(),
})

// ============ Compute/Worker Schemas ============

export const TEEQuoteResponseSchema = z.object({
  quote: z.string(),
  event_log: z.string().optional(),
})

export const InferenceResponseSchema = z.object({
  text: z.string().optional(),
  output: z.string().optional(),
  tokens: z.number().optional(),
  latency_ms: z.number().optional(),
})

// ============ CDN Schemas ============

export const CDNUploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
  url: z.string().optional(),
})

export const CDNInvalidationResponseSchema = z.object({
  success: z.boolean(),
  invalidatedPaths: z.array(z.string()).optional(),
  message: z.string().optional(),
})

// ============ Agent Schemas ============

export const AgentMemorySchema = z.object({
  id: z.string().optional(),
  content: z.string().optional(),
  embedding: z.array(z.number()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.number().optional(),
})

export const AgentInvokeResponseSchema = z.object({
  text: z.string().optional(),
  response: z.string().optional(),
  error: z.string().optional(),
})

// ============ Signature/Attestation Schemas ============

export const SignatureResponseSchema = z.object({
  signature: strictHexSchema,
})

export const OracleAttestationSchema = z.object({
  signature: strictHexSchema,
  timestamp: z.number(),
  data: z.record(z.string(), z.unknown()).optional(),
})

// ============ Type Exports ============

export type GitHubUser = z.infer<typeof GitHubUserSchema>
export type GitHubRepo = z.infer<typeof GitHubRepoSchema>
export type CowApiQuote = z.infer<typeof CowApiQuoteSchema>
export type CowApiOrder = z.infer<typeof CowApiOrderSchema>
export type ActivityPubActor = z.infer<typeof ActivityPubActorSchema>
