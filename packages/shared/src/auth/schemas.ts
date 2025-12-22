/**
 * Auth Validation Schemas
 *
 * Zod schemas for validating auth-related data from external sources.
 */

import { AddressSchema, HexSchema } from '@jejunetwork/types'
import { z } from 'zod'

// Auth method enum
const AuthMethodSchema = z.enum(['siwe', 'siwf', 'passkey', 'oauth3', 'social'])

// Social provider enum
const SocialProviderSchema = z.enum([
  'google',
  'apple',
  'twitter',
  'github',
  'discord',
])

// Provider type (social + farcaster + wallet)
const ProviderTypeSchema = z.union([
  SocialProviderSchema,
  z.literal('farcaster'),
  z.literal('wallet'),
])

// Linked provider schema
export const LinkedProviderSchema = z.object({
  provider: ProviderTypeSchema,
  providerId: z.string(),
  handle: z.string(),
  linkedAt: z.number(),
  verified: z.boolean(),
})

// TEE attestation schema
export const TEEAttestationSchema = z.object({
  quote: HexSchema,
  measurement: HexSchema,
  timestamp: z.number(),
  verified: z.boolean(),
})

// Auth session schema
export const AuthSessionSchema = z.object({
  id: z.string(),
  method: AuthMethodSchema,
  address: AddressSchema,
  smartAccount: AddressSchema.optional(),
  expiresAt: z.number(),
  attestation: TEEAttestationSchema.optional(),
  linkedProviders: z.array(LinkedProviderSchema),
})

// Authenticator transport enum
const AuthenticatorTransportSchema = z.enum([
  'usb',
  'nfc',
  'ble',
  'internal',
  'hybrid',
  'smart-card',
])

// Passkey credential schema (for storage)
export const PasskeyCredentialStorageSchema = z.object({
  id: z.string(),
  // publicKey is stored as base64 string in localStorage
  publicKey: z.string(),
  counter: z.number(),
  transports: z.array(AuthenticatorTransportSchema).optional(),
  createdAt: z.number(),
  lastUsedAt: z.number().optional(),
  name: z.string().optional(),
})

// Array of passkey credentials
export const PasskeyCredentialsArraySchema = z.array(
  PasskeyCredentialStorageSchema,
)

// OAuth init response schema
export const OAuthInitResponseSchema = z.object({
  authUrl: z.string().url(),
  state: z.string(),
})

// Validate and parse session from storage
export function parseStoredSession(
  json: string,
): z.infer<typeof AuthSessionSchema> | null {
  const parsed = JSON.parse(json)
  const result = AuthSessionSchema.safeParse(parsed)
  if (!result.success) {
    console.warn('[Auth] Invalid stored session:', result.error.message)
    return null
  }
  return result.data
}

// Validate and parse passkey credentials from storage
export function parseStoredPasskeys(
  json: string,
): z.infer<typeof PasskeyCredentialsArraySchema> {
  const parsed = JSON.parse(json)
  const result = PasskeyCredentialsArraySchema.safeParse(parsed)
  if (!result.success) {
    console.warn('[Auth] Invalid stored passkeys:', result.error.message)
    return []
  }
  return result.data
}

export type StoredPasskeyCredential = z.infer<
  typeof PasskeyCredentialStorageSchema
>
