/**
 * TEE Key Management Types
 *
 * Type definitions for TEE-backed XMTP key management.
 */

import type { Address, Hex } from 'viem'

// Re-export TEEAttestation from @jejunetwork/types for backwards compatibility
export type { TEEAttestation } from '@jejunetwork/types'

import type { TEEAttestation } from '@jejunetwork/types'

export interface TEEKeyConfig {
  /** KMS service endpoint (required for real TEE mode) */
  kmsEndpoint: string
  /** TEE enclave ID */
  enclaveId: string
  /** Require attestation for operations */
  attestationRequired: boolean
  /**
   * Network environment.
   * - 'local': Local development (mockMode allowed)
   * - 'testnet': Test network (requires real TEE)
   * - 'mainnet': Production (requires real TEE)
   */
  network: 'local' | 'testnet' | 'mainnet'
  /**
   * Enable mock mode for development/testing.
   * When true, keys are stored in-memory instead of real TEE hardware.
   * ONLY allowed when network is 'local'.
   * MUST be false for testnet/mainnet deployments.
   */
  mockMode: boolean
}

export interface TEEIdentityKey {
  /** Unique key ID */
  keyId: string
  /** Associated address */
  address: Address
  /** Public key (Ed25519) */
  publicKey: Hex
  /** TEE attestation */
  attestation?: TEEAttestation
  /** Creation timestamp */
  createdAt: number
  /** Last used timestamp */
  lastUsedAt?: number
}

export interface TEEPreKey {
  /** Pre-key ID */
  keyId: string
  /** Parent identity key ID */
  identityKeyId: string
  /** Public key (X25519) */
  publicKey: Hex
  /** Signature from identity key */
  signature: Hex
  /** Creation timestamp */
  createdAt: number
  /** Expiration timestamp */
  expiresAt?: number
}

export interface TEEInstallationKey {
  /** Installation key ID */
  keyId: string
  /** Parent identity key ID */
  identityKeyId: string
  /** Device/installation ID */
  deviceId: string
  /** Public key */
  publicKey: Hex
  /** Creation timestamp */
  createdAt: number
}

// TEEAttestation is imported from @jejunetwork/types at the top of this file

export interface AttestationVerificationResult {
  /** Verification passed */
  valid: boolean
  /** Enclave ID matches */
  enclaveIdMatch: boolean
  /** Measurement matches expected */
  measurementMatch: boolean
  /** Signature valid */
  signatureValid: boolean
  /** Certificate chain valid */
  chainValid: boolean
  /** Errors encountered */
  errors: string[]
}

export interface SignRequest {
  /** Key ID to sign with */
  keyId: string
  /** Message to sign */
  message: Uint8Array
  /** Hash algorithm */
  hashAlgorithm?: 'sha256' | 'sha512' | 'none'
}

export interface SignResult {
  /** Signature */
  signature: Hex
  /** Key ID used */
  keyId: string
  /** Timestamp */
  timestamp: number
}

export interface ECDHRequest {
  /** Private key ID */
  keyId: string
  /** Their public key */
  publicKey: Hex
}

export interface EncryptedBackup {
  /** Encrypted key data */
  ciphertext: Hex
  /** Encryption metadata */
  metadata: {
    keyId: string
    algorithm: string
    kdfParams: {
      salt: Hex
      iterations: number
    }
  }
  /** Creation timestamp */
  createdAt: number
}

export type KeyType = 'ed25519' | 'x25519' | 'secp256k1'

export interface GenerateKeyRequest {
  /** Key ID (unique identifier) */
  keyId: string
  /** Key type */
  type: KeyType
  /** Key policy */
  policy?: KeyPolicy
}

export interface KeyPolicy {
  /** Owner address */
  owner?: Address
  /** Allowed operations */
  operations?: Array<'sign' | 'derive' | 'encrypt' | 'decrypt'>
  /** Require attestation */
  attestation?: boolean
  /** Parent key for derivation */
  parentKey?: string
  /** Expiration timestamp */
  expiresAt?: number
}

export interface GenerateKeyResult {
  /** Key ID */
  keyId: string
  /** Public key */
  publicKey: Hex
  /** Key type */
  type: KeyType
  /** Attestation if requested */
  attestation?: TEEAttestation
}

export interface ImportKeyRequest {
  /** New key ID */
  keyId: string
  /** Encrypted key data */
  encryptedKey: string
  /** Decryption password */
  password: string
}

export interface ExportKeyRequest {
  /** Key ID to export */
  keyId: string
  /** Export format */
  format: 'encrypted'
  /** Encryption password */
  password: string
}

export interface DeriveKeyRequest {
  /** Parent key ID */
  parentKeyId: string
  /** New key ID */
  keyId: string
  /** Derivation info */
  info: string
}

export interface KeyRegistration {
  /** Address owning the key */
  address: Address
  /** Identity public key */
  identityKey: Hex
  /** Pre-key public key */
  preKey: Hex
  /** Pre-key signature */
  preKeySignature: Hex
  /** TEE attestation proof */
  attestationProof?: Hex
  /** Registration block */
  registeredAt: number
}

export interface RegistrationResult {
  /** Transaction hash */
  txHash: Hex
  /** Registration confirmed */
  confirmed: boolean
  /** Block number */
  blockNumber?: number
}
