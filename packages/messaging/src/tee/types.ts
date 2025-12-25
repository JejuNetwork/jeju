/**
 * TEE Key Management Types
 *
 * Type definitions for TEE-backed XMTP key management.
 */

import type { Address, Hex } from 'viem'

export interface TEEKeyConfig {
  /** KMS service endpoint */
  kmsEndpoint: string
  /** TEE enclave ID */
  enclaveId: string
  /** Require attestation for operations */
  attestationRequired: boolean
  /** Network for on-chain operations */
  network?: 'mainnet' | 'testnet'
  /**
   * Enable mock mode for development/testing.
   * When true, keys are stored in-memory instead of real TEE hardware.
   * MUST be false in production to use actual TEE infrastructure.
   * @default false
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

export interface TEEAttestation {
  /** Attestation version */
  version: number
  /** Enclave ID */
  enclaveId: string
  /** Enclave measurement hash */
  measurement: Hex
  /** Platform configuration register values */
  pcrs: Record<number, Hex>
  /** Nonce used in attestation */
  nonce: Hex
  /** Attestation timestamp */
  timestamp: number
  /** Attestation signature */
  signature: Hex
  /** Certificate chain */
  certificateChain?: string[]
}

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
