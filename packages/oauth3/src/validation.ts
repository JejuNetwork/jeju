/**
 * OAuth3 Validation Utilities
 *
 * Provides validation schemas and helper functions for fail-fast validation.
 * Use these at entry points instead of defensive fallbacks.
 */

import type { Hex } from 'viem'
import { z } from 'zod'
import { AuthProvider, SessionCapability, TEEProvider } from './types.js'

export {
  AddressSchema,
  expect,
  HexSchema,
  type JsonValue,
} from '@jejunetwork/types'
import { AddressSchema, HexSchema } from '@jejunetwork/types'

// Type guard helpers for runtime validation
export function isHex(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && HexSchema.safeParse(value).success
}

export function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && AddressSchema.safeParse(value).success
}

export const Bytes32Schema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid bytes32') as z.ZodType<Hex>

// ============ OAuth3 Config Validation ============

export const OAuth3ConfigSchema = z.object({
  appId: z.union([HexSchema, z.string().min(1, 'appId is required')]),
  redirectUri: z.string().url('redirectUri must be a valid URL'),
  teeAgentUrl: z.string().url().optional(),
  rpcUrl: z.string().url().optional(),
  chainId: z.number().int().positive().optional(),
  identityRegistryAddress: AddressSchema.optional(),
  appRegistryAddress: AddressSchema.optional(),
  accountFactoryAddress: AddressSchema.optional(),
  jnsGateway: z.string().url().optional(),
  storageEndpoint: z.string().url().optional(),
  decentralized: z.boolean().optional(),
})

export type ValidatedOAuth3Config = z.infer<typeof OAuth3ConfigSchema>

// ============ Core Type Schemas ============

export const TEEAttestationSchema = z.object({
  quote: HexSchema,
  measurement: HexSchema,
  reportData: HexSchema,
  timestamp: z.number().int().positive(),
  provider: z.nativeEnum(TEEProvider),
  verified: z.boolean(),
})

export const OAuth3SessionSchema = z.object({
  sessionId: HexSchema,
  identityId: HexSchema,
  smartAccount: AddressSchema,
  expiresAt: z.number().int().positive(),
  capabilities: z.array(z.nativeEnum(SessionCapability)),
  /** Public key for verifying signatures - the signing key stays in the TEE */
  signingPublicKey: HexSchema,
  attestation: TEEAttestationSchema,
})

export const CredentialSubjectSchema = z.object({
  id: z.string().min(1),
  provider: z.nativeEnum(AuthProvider),
  providerId: z.string().min(1),
  providerHandle: z.string(),
  walletAddress: AddressSchema,
  verifiedAt: z.string(),
})

export const CredentialProofSchema = z.object({
  type: z.string().min(1),
  created: z.string(),
  verificationMethod: z.string().min(1),
  proofPurpose: z.string().min(1),
  proofValue: HexSchema,
  jws: z.string().optional(),
})

export const VerifiableCredentialSchema = z.object({
  '@context': z.array(z.string()),
  type: z.array(z.string()),
  id: z.string().min(1),
  issuer: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
  issuanceDate: z.string(),
  expirationDate: z.string(),
  credentialSubject: CredentialSubjectSchema,
  proof: CredentialProofSchema,
})

// ============ API Response Validators ============

export const ErrorResponseSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
})

export const TOTPSetupResponseSchema = z.object({
  secret: z.string().min(1, 'secret is required'),
  uri: z.string().min(1, 'uri is required'),
  qrCode: z.string().min(1, 'qrCode is required'),
})

export const MFAStatusSchema = z.object({
  enabled: z.boolean(),
  methods: z.array(z.enum(['passkey', 'totp', 'sms', 'backup_code'])),
  preferredMethod: z.enum(['passkey', 'totp', 'sms', 'backup_code']).nullable(),
  totpEnabled: z.boolean(),
  passkeyCount: z.number().int().nonnegative(),
  backupCodesRemaining: z.number().int().nonnegative(),
})

export const PasskeyListItemSchema = z.object({
  id: z.string().min(1),
  deviceName: z.string(),
  createdAt: z.number().int(),
})

// OAuth Init Response
export const OAuthInitResponseSchema = z.object({
  authUrl: z.string().url(),
  state: z.string().min(1),
  sessionId: HexSchema,
})

// Sign Response
export const SignResponseSchema = z.object({
  signature: HexSchema,
})

// Credential Verify Response
export const CredentialVerifyResponseSchema = z.object({
  valid: z.boolean(),
})

// Auth Callback Data
export const AuthCallbackDataSchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
})

// ============ External API Response Validators ============

export const NeynarUserSchema = z.object({
  fid: z.number().int().positive(),
  username: z.string(),
  display_name: z.string(),
  pfp_url: z.string(),
  profile: z
    .object({
      bio: z
        .object({
          text: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  follower_count: z.number().int().nonnegative(),
  following_count: z.number().int().nonnegative(),
  verified_addresses: z
    .object({
      eth_addresses: z.array(z.string()).optional(),
    })
    .optional(),
  custody_address: z.string(),
  active_status: z.string(),
})

export type NeynarUser = z.infer<typeof NeynarUserSchema>

export const NeynarCastSchema = z.object({
  hash: z.string(),
  author: NeynarUserSchema,
  text: z.string(),
  timestamp: z.string(),
  parent_hash: z.string().optional(),
  parent_url: z.string().optional(),
  embeds: z.array(z.object({ url: z.string() })).optional(),
  reactions: z
    .object({
      likes_count: z.number().int().nonnegative().optional(),
      recasts_count: z.number().int().nonnegative().optional(),
    })
    .optional(),
})

export type NeynarCast = z.infer<typeof NeynarCastSchema>

// Hub API Response Schemas
export const HubUserDataResponseSchema = z.object({
  messages: z.array(
    z.object({
      data: z.object({
        fid: z.number().int(),
        userDataBody: z.object({ type: z.string(), value: z.string() }),
      }),
    }),
  ),
})

export const HubVerificationsResponseSchema = z.object({
  messages: z.array(
    z.object({
      data: z.object({
        fid: z.number().int().optional(),
        verificationAddAddressBody: z
          .object({
            address: z.string(),
            protocol: z.string(),
          })
          .optional(),
      }),
    }),
  ),
})

export const HubUsernameProofSchema = z.object({
  fid: z.number().int(),
})

// OAuth Token Response Schema
export const OAuthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().int(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
})

export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>

// OAuth Provider Profile Schemas
export const GoogleUserInfoSchema = z.object({
  id: z.string().optional(),
  sub: z.string().optional(),
  email: z.string(),
  email_verified: z.boolean().optional(),
  verified_email: z.boolean().optional(),
  name: z.string(),
  picture: z.string(),
})

export const GitHubUserSchema = z.object({
  id: z.number().int(),
  login: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  avatar_url: z.string(),
})

export const TwitterUserSchema = z.object({
  data: z.object({
    id: z.string(),
    username: z.string(),
    name: z.string(),
    profile_image_url: z.string().optional(),
    verified: z.boolean().optional(),
  }),
})

export const DiscordUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  global_name: z.string().nullable(),
  email: z.string().optional(),
  avatar: z.string().nullable(),
  verified: z.boolean().optional(),
})

// Frame Validation Response
export const FrameValidationResponseSchema = z.object({
  valid: z.boolean(),
  action: z.object({
    interactor: z.object({ fid: z.number().int() }),
    url: z.string(),
    message_hash: z.string(),
    timestamp: z.number().int(),
    network: z.number().int(),
    button_index: z.number().int(),
    cast_id: z.object({ fid: z.number().int(), hash: z.string() }).optional(),
    input_text: z.string().optional(),
    state: z.string().optional(),
    transaction_id: z.string().optional(),
    address: z.string().optional(),
  }),
})

// Node Resources Schema
export const NodeResourcesSchema = z.object({
  cpuCores: z.number().int().nonnegative().optional(),
  memoryGb: z.number().nonnegative().optional(),
  storageGb: z.number().nonnegative().optional(),
})

// IPFS Response Schema
export const IPFSAddResponseSchema = z.object({
  Hash: z.string().min(1),
  Size: z.string(),
})

// ============ Infrastructure Response Schemas ============

// TEE Provider Discovery Response
export const ProvidersListResponseSchema = z.object({
  providers: z.array(z.string()).optional(),
})

// Threshold Encryption Schemas
export const ThresholdDecryptResponseSchema = z.object({
  plaintext: z.string().min(1),
})

export const ThresholdClusterInfoResponseSchema = z.object({
  clusterId: z.string().min(1),
  threshold: z.number().int().positive(),
  totalNodes: z.number().int().positive(),
  publicKey: HexSchema,
})

// X402 Payment Header Schema
export const X402PaymentHeaderSchema = z.object({
  recipient: z.string().min(1),
  amount: z.string().min(1),
  token: z.string().min(1),
  resource: z.string().min(1),
  expiry: z.number().int(),
  nonce: z.string().min(1),
})

// Twilio Response Schema
export const TwilioMessageResponseSchema = z.object({
  message: z.string().optional(),
  sid: z.string().optional(),
  status: z.string().optional(),
  error_code: z.number().optional(),
  error_message: z.string().optional(),
})

// MFA Backup Codes Response
export const BackupCodesResponseSchema = z.object({
  codes: z.array(z.string()),
})

// Passkey Registration Options Response
export const PasskeyOptionsResponseSchema = z.object({
  challengeId: z.string().min(1),
  publicKey: z.record(z.string(), z.unknown()),
})

// ============ Storage Index Schemas ============

// Session Index Schema (for IPFS storage)
export const SessionIndexSchema = z.object({
  version: z.number().optional(),
  sessions: z.array(
    z.object({
      sessionId: HexSchema,
      cid: z.string().min(1),
    }),
  ),
  lastUpdated: z.number().optional(),
})

// Credential Index Schema (for IPFS storage)
export const CredentialIndexSchema = z.object({
  version: z.number().optional(),
  credentials: z.array(
    z.object({
      credentialId: z.string().min(1),
      cid: z.string().min(1),
    }),
  ),
  lastUpdated: z.number().optional(),
})

// ============ Farcaster SIWF Schemas ============

// Sign In With Farcaster result schema
export const SIWFResultSchema = z.object({
  result: z
    .object({
      fid: z.number().int().positive().optional(),
    })
    .optional(),
})

// Cast submission response schema
export const CastSubmitResponseSchema = z.object({
  hash: z.string().min(1),
})

// TEE/dstack Quote Response Schemas
export const DstackQuoteResponseSchema = z.object({
  quote: z.string().min(1),
  eventLog: z.string(),
})

export type DstackQuoteResponse = z.infer<typeof DstackQuoteResponseSchema>

// ============ Helper Functions ============

/**
 * Validates that a node endpoint is available.
 * Use this in React hooks instead of ?? 'http://localhost:4200'
 */
export function expectEndpoint(
  node: { endpoint: string } | null | undefined,
): string {
  if (!node) {
    throw new Error(
      'TEE node not initialized. Call client.initialize() first or wait for initialization to complete.',
    )
  }
  if (!node.endpoint) {
    throw new Error('TEE node has no endpoint configured.')
  }
  return node.endpoint
}

/**
 * Gets endpoint with localhost fallback only in development.
 * Use this for hooks where localhost fallback is acceptable in dev.
 */
export function getEndpointWithDevFallback(
  node: { endpoint: string } | null | undefined,
): string {
  if (node?.endpoint) {
    return node.endpoint
  }

  const isDev =
    typeof process !== 'undefined' &&
    (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test')

  if (isDev) {
    return 'http://localhost:4200'
  }

  throw new Error(
    'TEE node not initialized. In production, call client.initialize() first.',
  )
}

/**
 * Extracts error message from API response with proper typing.
 */
export function extractError(response: unknown): string {
  const parsed = ErrorResponseSchema.safeParse(response)
  if (parsed.success) {
    return parsed.data.error ?? parsed.data.message ?? 'Unknown error'
  }
  return 'Unknown error'
}

/**
 * Parse JSON string and validate with Zod schema (fail-fast)
 * Use this instead of JSON.parse(...) as Type
 */
export function expectJson<T>(
  json: string,
  schema: z.ZodType<T>,
  context = 'JSON data',
): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(
      `Invalid ${context}: failed to parse JSON - ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return validateResponse(schema, parsed, context)
}

/**
 * Validates OAuth3 config at initialization time.
 */
export function validateConfig(config: unknown): ValidatedOAuth3Config {
  return OAuth3ConfigSchema.parse(config)
}

/**
 * Validates an API response with a Zod schema.
 * Throws an error with context if validation fails.
 */
export function validateResponse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: string,
): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const errors = result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ')
    throw new Error(`Invalid ${context}: ${errors}`)
  }
  return result.data
}

/**
 * Safe JSON parse with Zod validation.
 * Returns null if parsing or validation fails.
 */
export function safeParseJson<T>(schema: z.ZodType<T>, json: string): T | null {
  try {
    const data = JSON.parse(json)
    const result = schema.safeParse(data)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/**
 * Generates a cryptographically secure OTP of the specified length.
 * Shared between email and phone providers.
 * @param length - Number of digits for the OTP
 * @returns A string of random digits
 */
export function generateOTP(length: number): string {
  const digits = '0123456789'
  let otp = ''
  const randomValues = crypto.getRandomValues(new Uint8Array(length))
  for (let i = 0; i < length; i++) {
    otp += digits[randomValues[i] % 10]
  }
  return otp
}

/**
 * Fetches JSON and validates with Zod schema.
 */
export async function fetchAndValidate<T>(
  schema: z.ZodType<T>,
  url: string,
  options?: RequestInit,
  context = 'API response',
): Promise<T> {
  const response = await fetch(url, options)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  const data = await response.json()
  return validateResponse(schema, data, context)
}
