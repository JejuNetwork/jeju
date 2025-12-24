import { AddressSchema, HexSchema, JsonValueSchema } from '@jejunetwork/types'
import { z } from 'zod'

export const PaymentRequirementsSchema = z.object({
  scheme: z.enum(['exact', 'upto']),
  network: z.string().min(1),
  maxAmountRequired: z.string().min(1),
  payTo: AddressSchema,
  asset: AddressSchema,
  resource: z.string().min(1),
  description: z.string().optional().nullable(),
  mimeType: z.string().optional().nullable(),
  outputSchema: z.string().optional().nullable(),
  maxTimeoutSeconds: z.number().int().positive().optional().nullable(),
  extra: z.record(z.string(), JsonValueSchema).optional().nullable(),
})

export const PaymentPayloadSchema = z.object({
  scheme: z.string().min(1),
  network: z.string().min(1),
  asset: AddressSchema,
  payTo: AddressSchema,
  amount: z.string().min(1),
  resource: z.string().min(1),
  nonce: z.string().min(1),
  timestamp: z.number().int().positive(),
  signature: HexSchema,
  payer: AddressSchema.nullable(),
})

export const VerifyRequestSchema = z.object({
  x402Version: z.literal(1),
  paymentHeader: z.string().min(1),
  paymentRequirements: PaymentRequirementsSchema,
})

export const VerifyResponseSchema = z.object({
  isValid: z.boolean(),
  invalidReason: z.string().nullable(),
  payer: AddressSchema.nullable(),
  amount: z.string().nullable(),
  timestamp: z.number().int().positive(),
})

export const SettleRequestSchema = z.object({
  x402Version: z.literal(1),
  paymentHeader: z.string().min(1),
  paymentRequirements: PaymentRequirementsSchema,
})

export const AuthParamsSchema = z.object({
  validAfter: z.number().int().nonnegative(),
  validBefore: z.number().int().positive(),
  authNonce: HexSchema,
  authSignature: HexSchema,
})

export const SettleRequestWithAuthSchema = SettleRequestSchema.extend({
  authParams: AuthParamsSchema,
})

export const SettleResponseSchema = z.object({
  success: z.boolean(),
  txHash: HexSchema.nullable(),
  networkId: z.string().min(1),
  settlementId: HexSchema.nullable(),
  payer: AddressSchema.nullable(),
  recipient: AddressSchema.nullable(),
  amount: z
    .object({
      human: z.string(),
      base: z.string(),
      symbol: z.string(),
      decimals: z.number().int().nonnegative(),
    })
    .nullable(),
  fee: z
    .object({
      human: z.string(),
      base: z.string(),
      bps: z.number().int().nonnegative(),
    })
    .nullable(),
  net: z
    .object({
      human: z.string(),
      base: z.string(),
    })
    .nullable(),
  error: z.string().nullable(),
  timestamp: z.number().int().positive(),
})

export const SupportedResponseSchema = z.object({
  kinds: z.array(
    z.object({
      scheme: z.enum(['exact', 'upto']),
      network: z.string().min(1),
    }),
  ),
  x402Version: z.literal(1),
  facilitator: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    url: z.string().url(),
  }),
})

export const StatsResponseSchema = z.object({
  totalSettlements: z.string(),
  totalVolumeUSD: z.string(),
  protocolFeeBps: z.number().int().nonnegative(),
  feeRecipient: AddressSchema,
  supportedTokens: z.array(AddressSchema),
  uptime: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
})

export const HealthResponseSchema = z.object({
  service: z.string().min(1),
  version: z.string().min(1),
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  mode: z.enum(['production', 'development']),
  chainId: z.number().int().positive(),
  network: z.string().min(1),
  facilitatorAddress: AddressSchema,
  endpoints: z.object({
    verify: z.string().url(),
    settle: z.string().url(),
    supported: z.string().url(),
    stats: z.string().url(),
  }),
  timestamp: z.number().int().positive(),
})

export const DecodedPaymentSchema = z.object({
  payer: AddressSchema,
  recipient: AddressSchema,
  token: AddressSchema,
  amount: z.bigint(),
  resource: z.string().min(1),
  nonce: z.string().min(1),
  timestamp: z.number().int().positive(),
  signature: HexSchema,
})

export const VerificationResultSchema = z.object({
  valid: z.boolean(),
  error: z.string().nullable(),
  signer: AddressSchema.nullable(),
  decodedPayment: DecodedPaymentSchema.nullable(),
})

export const SettlementResultSchema = z.object({
  success: z.boolean(),
  txHash: HexSchema.nullable(),
  paymentId: HexSchema.nullable(),
  protocolFee: z.bigint().nullable(),
  error: z.string().nullable(),
})

export const ChainConfigSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string().min(1),
  network: z.string().min(1),
  rpcUrl: z.string().url(),
  blockExplorer: z.string().url().nullable(),
  usdc: AddressSchema,
  facilitator: AddressSchema,
  nativeCurrency: z.object({
    name: z.string().min(1),
    symbol: z.string().min(1),
    decimals: z.number().int().nonnegative(),
  }),
})

export const TokenConfigSchema = z.object({
  address: AddressSchema,
  symbol: z.string().min(1),
  decimals: z.number().int().nonnegative(),
  name: z.string().min(1),
})

// Type exports
export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>
export type PaymentPayload = z.infer<typeof PaymentPayloadSchema>
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>
export type VerifyResponse = z.infer<typeof VerifyResponseSchema>
export type SettleRequest = z.infer<typeof SettleRequestSchema>
export type AuthParams = z.infer<typeof AuthParamsSchema>
export type SettleRequestWithAuth = z.infer<typeof SettleRequestWithAuthSchema>
export type SettleResponse = z.infer<typeof SettleResponseSchema>
export type SupportedResponse = z.infer<typeof SupportedResponseSchema>
export type StatsResponse = z.infer<typeof StatsResponseSchema>
export type HealthResponse = z.infer<typeof HealthResponseSchema>
export type DecodedPayment = z.infer<typeof DecodedPaymentSchema>
export type VerificationResult = z.infer<typeof VerificationResultSchema>
export type SettlementResult = z.infer<typeof SettlementResultSchema>
export type ChainConfig = z.infer<typeof ChainConfigSchema>
export type TokenConfig = z.infer<typeof TokenConfigSchema>
