/**
 * TEE (Trusted Execution Environment) types for attestation and key management.
 *
 * This module provides unified types for TEE attestations across different
 * platforms (SGX, SEV, AWS Nitro, etc.) and use cases (KMS, messaging, auth).
 */

import { z } from 'zod'
import { MAX_ARRAY_LENGTH, MAX_SHORT_STRING_LENGTH } from './validation'

/** Hex string type */
export type Hex = `0x${string}`

// Reusable hex schema
const HexSchema = z.custom<Hex>(
  (val) => typeof val === 'string' && /^0x[a-fA-F0-9]*$/.test(val),
  { message: 'Invalid hex string' },
)

/**
 * TEE platform identifiers
 */
export const TEEPlatform = {
  /** Intel SGX */
  SGX: 'sgx',
  /** Intel TDX */
  TDX: 'tdx',
  /** AMD SEV-SNP */
  SEV_SNP: 'sev-snp',
  /** AWS Nitro Enclaves */
  AWS_NITRO: 'aws-nitro',
  /** Azure Confidential Computing */
  AZURE_CC: 'azure-cc',
  /** GCP Confidential VM */
  GCP_CVM: 'gcp-cvm',
  /** Phala Network */
  PHALA: 'phala',
  /** DStack */
  DSTACK: 'dstack',
  /** NVIDIA Confidential Computing */
  NVIDIA_CC: 'nvidia-cc',
  /** Simulated/Mock (development only) */
  SIMULATED: 'simulated',
} as const
export type TEEPlatform = (typeof TEEPlatform)[keyof typeof TEEPlatform]

export const TEEPlatformSchema = z.enum([
  'sgx',
  'tdx',
  'sev-snp',
  'aws-nitro',
  'azure-cc',
  'gcp-cvm',
  'phala',
  'dstack',
  'nvidia-cc',
  'simulated',
])

/**
 * Unified TEE attestation type.
 *
 * Contains all fields needed across different TEE use cases:
 * - KMS: key generation and signing with attestation proof
 * - Messaging: XMTP key management with TEE-backed keys
 * - Auth: OAuth3 node attestation verification
 * - Bridge: Cross-chain transfer proof batching
 */
export interface TEEAttestation {
  /** Raw attestation quote from TEE hardware */
  quote: Hex
  /** Enclave measurement hash (mrEnclave) */
  measurement: Hex
  /** Attestation timestamp (Unix epoch seconds or milliseconds) */
  timestamp: number
  /** Whether attestation has been verified */
  verified?: boolean
  /** Signature from attestation verifier */
  verifierSignature?: Hex
  /** TEE platform that generated this attestation */
  platform?: TEEPlatform
  /** TEE provider name (for backwards compatibility with auth package) */
  provider?: string

  // SGX/TDX specific fields
  /** Enclave signer measurement (mrSigner) */
  mrSigner?: Hex
  /** SGX report data (user-defined data in attestation) */
  reportData?: Hex
  /** Platform Configuration Register values (keys are PCR indices as strings) */
  pcrs?: Record<string, Hex>

  // Extended attestation metadata
  /** Attestation format version */
  version?: number
  /** Enclave identifier */
  enclaveId?: string
  /** Nonce used in attestation generation */
  nonce?: Hex
  /** Attestation signature (for self-signed attestations) */
  signature?: Hex
  /** X.509 certificate chain for verification */
  certificateChain?: string[]
  /** Public key derived inside TEE */
  publicKey?: Hex
}

export const TEEAttestationSchema = z.object({
  quote: HexSchema,
  measurement: HexSchema,
  timestamp: z.number(),
  verified: z.boolean().optional(),
  verifierSignature: HexSchema.optional(),
  platform: TEEPlatformSchema.optional(),
  provider: z.string().optional(),

  // SGX/TDX specific
  mrSigner: HexSchema.optional(),
  reportData: HexSchema.optional(),
  pcrs: z.record(z.string(), HexSchema).optional(),

  // Extended metadata
  version: z.number().optional(),
  enclaveId: z.string().max(MAX_SHORT_STRING_LENGTH).optional(),
  nonce: HexSchema.optional(),
  signature: HexSchema.optional(),
  certificateChain: z
    .array(z.string().max(4096))
    .max(MAX_ARRAY_LENGTH)
    .optional(),
  publicKey: HexSchema.optional(),
})

/**
 * TEE node information for distributed TEE networks
 */
export interface TEENodeInfo {
  /** Unique node identifier */
  nodeId: string
  /** Node endpoint URL */
  endpoint: string
  /** TEE platform */
  platform: TEEPlatform
  /** Node's attestation */
  attestation: TEEAttestation
  /** Node's public key for encrypted communication */
  publicKey: Hex
  /** Whether node is currently active */
  active?: boolean
  /** Node capabilities */
  capabilities?: string[]
}

export const TEENodeInfoSchema = z.object({
  nodeId: z.string().max(MAX_SHORT_STRING_LENGTH),
  endpoint: z.string().url(),
  platform: TEEPlatformSchema,
  attestation: TEEAttestationSchema,
  publicKey: HexSchema,
  active: z.boolean().optional(),
  capabilities: z
    .array(z.string().max(MAX_SHORT_STRING_LENGTH))
    .max(MAX_ARRAY_LENGTH)
    .optional(),
})

/**
 * Result of attestation verification
 */
export interface TEEAttestationVerificationResult {
  /** Overall verification passed */
  valid: boolean
  /** Measurement matches expected value */
  measurementMatch: boolean
  /** Quote signature is valid */
  signatureValid: boolean
  /** Certificate chain is valid */
  chainValid: boolean
  /** Attestation is within time bounds */
  timestampValid: boolean
  /** Platform-specific verification passed */
  platformVerified: boolean
  /** Enclave ID matches (if specified) */
  enclaveIdMatch?: boolean
  /** Errors encountered during verification */
  errors: string[]
}

export const TEEAttestationVerificationResultSchema = z.object({
  valid: z.boolean(),
  measurementMatch: z.boolean(),
  signatureValid: z.boolean(),
  chainValid: z.boolean(),
  timestampValid: z.boolean(),
  platformVerified: z.boolean(),
  enclaveIdMatch: z.boolean().optional(),
  errors: z.array(z.string().max(256)).max(MAX_ARRAY_LENGTH),
})

/**
 * TEE key information for keys managed within TEE
 */
export interface TEEKeyInfo {
  /** Key identifier */
  keyId: string
  /** Public key (private key never leaves TEE) */
  publicKey: Hex
  /** Key's attestation proof */
  attestation: TEEAttestation
  /** Enclave ID where key was generated */
  enclaveId: string
  /** Key creation timestamp */
  createdAt: number
  /** Key expiration timestamp */
  expiresAt?: number
  /** Key type */
  keyType?: 'signing' | 'encryption' | 'session'
  /** Key curve */
  keyCurve?: 'ed25519' | 'secp256k1' | 'x25519' | 'bls12-381'
}

export const TEEKeyInfoSchema = z.object({
  keyId: z.string().max(MAX_SHORT_STRING_LENGTH),
  publicKey: HexSchema,
  attestation: TEEAttestationSchema,
  enclaveId: z.string().max(MAX_SHORT_STRING_LENGTH),
  createdAt: z.number(),
  expiresAt: z.number().optional(),
  keyType: z.enum(['signing', 'encryption', 'session']).optional(),
  keyCurve: z.enum(['ed25519', 'secp256k1', 'x25519', 'bls12-381']).optional(),
})
