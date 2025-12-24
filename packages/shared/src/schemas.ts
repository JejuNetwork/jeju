/**
 * API Response Schemas - Zod schemas for validating external API responses
 *
 * These schemas are used with expectValid() to validate JSON.parse() and
 * response.json() results, preventing insecure deserialization.
 */

import type { Address, Hex } from 'viem'
import { z } from 'zod'

// IPFS Response Schemas

/** Schema for IPFS upload response (supports both DWS and IPFS API styles) */
export const IPFSUploadResponseSchema = z.object({
  cid: z.string().optional(),
  Hash: z.string().optional(),
})

/** Schema for IPFS pin count response */
export const IPFSPinCountResponseSchema = z.object({
  count: z.number().optional(),
})

// Storage Response Schemas

/** Schema for storage upload response */
export const StorageUploadResponseSchema = z.object({
  cid: z.string().min(1),
})

// JNS Response Schemas

/** Schema for JNS availability check */
export const JNSAvailabilityResponseSchema = z.object({
  available: z.boolean(),
})

/** Schema for JNS registration response */
export const JNSRegisterResponseSchema = z.object({
  txHash: z.string() as z.ZodType<Hex>,
})

/** Schema for JNS resolve response */
export const JNSResolveResponseSchema = z.object({
  address: z.string() as z.ZodType<Address>,
})

/** Schema for JNS reverse resolve response */
export const JNSReverseResolveResponseSchema = z.object({
  name: z.string(),
})

/** Schema for JNS records response */
export const JNSRecordsResponseSchema = z.object({
  address: z.string().optional() as z.ZodType<Address | undefined>,
  contentHash: z.string().optional(),
  a2aEndpoint: z.string().optional(),
  mcpEndpoint: z.string().optional(),
  restEndpoint: z.string().optional(),
  avatar: z.string().optional(),
  url: z.string().optional(),
  description: z.string().optional(),
  text: z.record(z.string(), z.string()).optional(),
})

/** Schema for JNS set records response */
export const JNSSetRecordsResponseSchema = z.object({
  txHash: z.string() as z.ZodType<Hex>,
})

/** Schema for JNS price response */
export const JNSPriceResponseSchema = z.object({
  price: z.string(),
})

// KMS Response Schemas

/** Schema for KMS encrypt response */
export const KMSEncryptResponseSchema = z.object({
  encrypted: z.string(),
})

/** Schema for KMS decrypt response */
export const KMSDecryptResponseSchema = z.object({
  decrypted: z.string(),
})

/** Schema for KMS sign response */
export const KMSSignResponseSchema = z.object({
  signature: z.string(),
})

// HSM Response Schemas

/** Schema for HSM key generation response */
export const HSMKeyGenerationResponseSchema = z.object({
  publicKey: z.string().optional(),
  address: z.string().optional(),
})

/** Schema for HSM signature response */
export const HSMSignatureResponseSchema = z.object({
  signature: z.string() as z.ZodType<Hex>,
  r: z.string() as z.ZodType<Hex>,
  s: z.string() as z.ZodType<Hex>,
  v: z.number(),
})

/** Schema for HSM verify response */
export const HSMVerifyResponseSchema = z.object({
  valid: z.boolean(),
})

/** Schema for HSM encryption response */
export const HSMEncryptionResponseSchema = z.object({
  ciphertext: z.string() as z.ZodType<Hex>,
  iv: z.string() as z.ZodType<Hex>,
  tag: z.string().optional() as z.ZodType<Hex | undefined>,
})

/** Schema for HSM decryption response */
export const HSMDecryptionResponseSchema = z.object({
  plaintext: z.string(),
})

// Trigger Response Schemas

/** Schema for trigger response */
export const TriggerResponseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  type: z.enum(['cron', 'webhook', 'event']),
  cronExpression: z.string().optional(),
  webhookPath: z.string().optional(),
  eventTypes: z.array(z.string()).optional(),
  endpoint: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  timeout: z.number().positive(),
  active: z.boolean(),
  owner: z.string().optional() as z.ZodType<Address | undefined>,
  agentId: z.number().nonnegative().optional(),
  paymentMode: z.enum(['free', 'x402', 'prepaid']),
  pricePerExecution: z.string(),
  createdAt: z.number().nonnegative(),
  lastExecutedAt: z.number().nonnegative().optional(),
  executionCount: z.number().nonnegative(),
  onChainId: z.string().optional(),
  source: z.enum(['local', 'onchain']),
})

/** Schema for trigger creation response */
export const TriggerCreateResponseSchema = z.object({
  trigger: TriggerResponseSchema,
})

/** Schema for trigger get response */
export const TriggerGetResponseSchema = z.object({
  trigger: TriggerResponseSchema,
})

/** Schema for trigger list response */
export const TriggerListResponseSchema = z.object({
  triggers: z.array(TriggerResponseSchema),
})

/** Schema for trigger proof response */
export const TriggerProofResponseSchema = z.object({
  proof: z.object({
    triggerId: z.string().min(1),
    executionId: z.string().min(1),
    timestamp: z.number().nonnegative(),
    inputHash: z.string().min(1),
    outputHash: z.string().min(1),
    executorAddress: z.string() as z.ZodType<Address>,
    executorSignature: z.string().min(1),
    chainId: z.number().positive(),
    txHash: z.string().optional(),
  }),
})

/** Schema for trigger stats response */
export const TriggerStatsResponseSchema = z.object({
  totalExecutions: z.number().nonnegative(),
  successfulExecutions: z.number().nonnegative(),
  failedExecutions: z.number().nonnegative(),
  lastPollAt: z.number().nonnegative(),
  triggerCount: z.number().nonnegative(),
  activeExecutions: z.number().nonnegative(),
})

/** Schema for trigger deposit/withdraw response */
export const TriggerTxHashResponseSchema = z.object({
  txHash: z.string(),
})

/** Schema for trigger balance response */
export const TriggerBalanceResponseSchema = z.object({
  balance: z.string(),
})

// Farcaster/SIWF Response Schemas

/** Schema for Farcaster auth channel creation response */
export const FarcasterChannelResponseSchema = z.object({
  channelToken: z.string(),
})

/** Schema for Farcaster auth channel status response */
export const FarcasterChannelStatusResponseSchema = z.object({
  state: z.enum(['pending', 'completed']),
  message: z.string().optional(),
  signature: z.string().optional() as z.ZodType<Hex | undefined>,
  fid: z.number().optional(),
  username: z.string().optional(),
  displayName: z.string().optional(),
  pfpUrl: z.string().optional(),
  custodyAddress: z.string().optional() as z.ZodType<Address | undefined>,
  nonce: z.string().optional(),
})

/** Schema for Farcaster user data response */
export const FarcasterUserDataResponseSchema = z.object({
  messages: z
    .array(
      z.object({
        data: z.object({
          type: z.string(),
          userDataBody: z
            .object({
              type: z.string(),
              value: z.string(),
            })
            .optional(),
          verificationAddEthAddressBody: z
            .object({
              address: z.string(),
            })
            .optional(),
        }),
      }),
    )
    .optional(),
})

// Cron Response Schemas

/** Recursive schema for metadata values (JSON-compatible) */
const MetadataValueSchema: z.ZodType<
  | string
  | number
  | boolean
  | null
  | MetadataValue[]
  | { [key: string]: MetadataValue }
> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(MetadataValueSchema),
    z.record(z.string(), MetadataValueSchema),
  ]),
)

type MetadataValue =
  | string
  | number
  | boolean
  | null
  | MetadataValue[]
  | { [key: string]: MetadataValue }

/** Schema for cron job */
export const CronJobSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['cron', 'once', 'interval']),
  expression: z.string().optional(),
  webhook: z.string().url(),
  enabled: z.boolean(),
  lastRun: z.number().optional(),
  nextRun: z.number(),
  executionCount: z.number().nonnegative(),
  metadata: z.record(z.string(), MetadataValueSchema).optional(),
})

/** Schema for cron list response */
export const CronListResponseSchema = z.object({
  jobs: z.array(CronJobSchema),
})

// Secrets Response Schemas

/** Schema for secret metadata */
export const SecretMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.number().nonnegative(),
  owner: z.string() as z.ZodType<Address>,
  createdAt: z.number().nonnegative(),
  updatedAt: z.number().nonnegative(),
  expiresAt: z.number().nonnegative().optional(),
  tags: z.array(z.string()),
})

/** Schema for get secret response */
export const GetSecretResponseSchema = z.object({
  value: z.string(),
})

/** Schema for store/rotate secret response */
export const StoreSecretResponseSchema = SecretMetadataSchema

/** Schema for list secrets response */
export const ListSecretsResponseSchema = z.object({
  secrets: z.array(SecretMetadataSchema),
})

// TEE Response Schemas (Dstack/Tappd)

/** Schema for Tappd quote response */
export const TappdQuoteResponseSchema = z.object({
  quote: z.string(),
  event_log: z.string(),
})

/** Schema for Tappd TLS key response */
export const TappdKeyResponseSchema = z.object({
  key: z.string(),
  certificate_chain: z.array(z.string()),
})

/**
 * Schema for TCB (Trusted Computing Base) info values.
 * TCB info structure varies by TEE provider (Intel TDX, AMD SEV, etc.)
 * so we use a recursive JSON-compatible schema.
 */
const TcbInfoValueSchema: z.ZodType<TcbInfoValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(TcbInfoValueSchema),
    z.record(z.string(), TcbInfoValueSchema),
  ]),
)

type TcbInfoValue =
  | string
  | number
  | boolean
  | null
  | TcbInfoValue[]
  | { [key: string]: TcbInfoValue }

/** Schema for Tappd info response */
export const TappdInfoResponseSchema = z.object({
  app_id: z.string(),
  instance_id: z.string(),
  os_image_hash: z.string(),
  compose_hash: z.string(),
  tcb_info: z.record(z.string(), TcbInfoValueSchema),
})

/** Schema for Tappd derive key response (JSON representation) */
export const TappdDeriveKeyResponseSchema = z.object({
  key: z.string(),
  signature: z.string(),
})

// Type exports for inference
export type IPFSUploadResponse = z.infer<typeof IPFSUploadResponseSchema>
export type StorageUploadResponse = z.infer<typeof StorageUploadResponseSchema>
export type JNSRecordsResponse = z.infer<typeof JNSRecordsResponseSchema>
export type TriggerResponse = z.infer<typeof TriggerResponseSchema>
export type TriggerStatsResponse = z.infer<typeof TriggerStatsResponseSchema>
export type FarcasterChannelResponse = z.infer<
  typeof FarcasterChannelResponseSchema
>
export type FarcasterChannelStatusResponse = z.infer<
  typeof FarcasterChannelStatusResponseSchema
>
export type CronJob = z.infer<typeof CronJobSchema>
export type SecretMetadata = z.infer<typeof SecretMetadataSchema>
export type TappdQuoteResponse = z.infer<typeof TappdQuoteResponseSchema>
export type TappdKeyResponse = z.infer<typeof TappdKeyResponseSchema>
export type TappdInfoResponse = z.infer<typeof TappdInfoResponseSchema>
export type TappdDeriveKeyResponse = z.infer<
  typeof TappdDeriveKeyResponseSchema
>
