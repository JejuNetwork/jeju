/**
 * HSM (Hardware Security Module) Abstraction Interface
 *
 * This interface abstracts key storage operations to allow using:
 * 1. Software-based encryption (development/testing)
 * 2. Cloud HSM (AWS CloudHSM, Azure Dedicated HSM, Google Cloud HSM)
 * 3. Hardware security modules (YubiHSM, Thales Luna, etc.)
 *
 * SECURITY: Using HSM for master key storage provides:
 * - Keys never leave the HSM boundary
 * - Tamper-resistant hardware protection
 * - FIPS 140-2/140-3 certified security
 * - Protection against side-channel attacks on the host
 */

import type { Hex } from 'viem'

/**
 * HSM key type - the purpose of the key
 */
export type HSMKeyType = 'master' | 'signing' | 'encryption' | 'wrapping'

/**
 * HSM key algorithm
 */
export type HSMKeyAlgorithm =
  | 'AES-256'
  | 'ECDSA-P256'
  | 'ECDSA-SECP256K1'
  | 'RSA-2048'
  | 'RSA-4096'

/**
 * Key metadata stored in HSM
 */
export interface HSMKeyInfo {
  /** Unique key identifier */
  keyId: string
  /** Key type (purpose) */
  keyType: HSMKeyType
  /** Algorithm used */
  algorithm: HSMKeyAlgorithm
  /** When the key was created */
  createdAt: number
  /** When the key expires (optional) */
  expiresAt?: number
  /** Key version for rotation tracking */
  version: number
  /** Whether the key is exportable (should be false for production) */
  exportable: boolean
  /** Custom metadata */
  metadata: Record<string, string>
}

/**
 * Result of an encryption operation
 */
export interface HSMEncryptResult {
  /** Encrypted ciphertext */
  ciphertext: Uint8Array
  /** Initialization vector (for AES-GCM) */
  iv: Uint8Array
  /** Authentication tag (for AES-GCM) */
  tag: Uint8Array
  /** Key version used for encryption */
  keyVersion: number
}

/**
 * Result of a signing operation
 */
export interface HSMSignResult {
  /** The signature */
  signature: Hex
  /** Recovery ID (for ECDSA) */
  recoveryId?: number
  /** Key version used for signing */
  keyVersion: number
}

/**
 * HSM Provider Interface
 *
 * Implement this interface to add support for different HSM backends.
 */
export interface HSMProvider {
  /**
   * Provider type identifier
   */
  readonly type: string

  /**
   * Initialize connection to HSM
   */
  connect(): Promise<void>

  /**
   * Disconnect from HSM
   */
  disconnect(): Promise<void>

  /**
   * Check if HSM is available and healthy
   */
  isAvailable(): Promise<boolean>

  /**
   * Generate a new key in the HSM
   *
   * SECURITY: Keys generated in HSM never leave the HSM boundary.
   */
  generateKey(
    keyId: string,
    keyType: HSMKeyType,
    algorithm: HSMKeyAlgorithm,
    options?: {
      exportable?: boolean
      expiresAt?: number
      metadata?: Record<string, string>
    },
  ): Promise<HSMKeyInfo>

  /**
   * Get key information (does not export key material)
   */
  getKeyInfo(keyId: string): Promise<HSMKeyInfo | null>

  /**
   * List all keys in the HSM
   */
  listKeys(): Promise<HSMKeyInfo[]>

  /**
   * Rotate a key (creates new version, old version remains usable for decryption)
   */
  rotateKey(keyId: string): Promise<HSMKeyInfo>

  /**
   * Delete a key (use with caution - data encrypted with this key becomes unrecoverable)
   */
  deleteKey(keyId: string): Promise<void>

  /**
   * Encrypt data using a key in the HSM
   *
   * SECURITY: Data is encrypted inside the HSM; the key never leaves.
   */
  encrypt(
    keyId: string,
    plaintext: Uint8Array,
    options?: { aad?: Uint8Array },
  ): Promise<HSMEncryptResult>

  /**
   * Decrypt data using a key in the HSM
   *
   * SECURITY: Decryption happens inside the HSM; the key never leaves.
   */
  decrypt(
    keyId: string,
    ciphertext: Uint8Array,
    iv: Uint8Array,
    tag: Uint8Array,
    options?: { aad?: Uint8Array; keyVersion?: number },
  ): Promise<Uint8Array>

  /**
   * Sign data using a key in the HSM
   *
   * SECURITY: Signing happens inside the HSM; the key never leaves.
   */
  sign(keyId: string, data: Uint8Array): Promise<HSMSignResult>

  /**
   * Verify a signature using a key in the HSM
   */
  verify(keyId: string, data: Uint8Array, signature: Hex): Promise<boolean>

  /**
   * Wrap (encrypt) a key using another key in the HSM
   *
   * SECURITY: Used for secure key export/import. The wrapped key is encrypted
   * by the wrapping key inside the HSM.
   */
  wrapKey(keyIdToWrap: string, wrappingKeyId: string): Promise<Uint8Array>

  /**
   * Unwrap (decrypt and import) a key using a wrapping key in the HSM
   */
  unwrapKey(
    wrappedKey: Uint8Array,
    wrappingKeyId: string,
    newKeyId: string,
    keyType: HSMKeyType,
    algorithm: HSMKeyAlgorithm,
  ): Promise<HSMKeyInfo>

  /**
   * Get public key for an asymmetric key (safe to export)
   */
  getPublicKey(keyId: string): Promise<Hex>
}

/**
 * HSM configuration for different providers
 */
export interface HSMConfig {
  /** HSM provider type */
  provider:
    | 'software'
    | 'aws-cloudhsm'
    | 'azure-hsm'
    | 'gcp-hsm'
    | 'yubihsm'
    | 'thales-luna'

  /** Connection configuration (provider-specific) */
  connection?: {
    /** Endpoint URL for cloud HSMs */
    endpoint?: string
    /** Cluster ID (AWS CloudHSM) */
    clusterId?: string
    /** Key vault name (Azure) */
    keyVaultName?: string
    /** Project ID (GCP) */
    projectId?: string
    /** Location/region */
    location?: string
    /** Key ring name (GCP) */
    keyRing?: string
    /** Device serial (YubiHSM) */
    deviceSerial?: string
  }

  /** Authentication configuration */
  auth?: {
    /** Username for HSM login */
    username?: string
    /** Password for HSM login (use environment variable) */
    passwordEnvVar?: string
    /** Path to credentials file */
    credentialsPath?: string
    /** Service account (GCP) */
    serviceAccount?: string
  }

  /** Key management configuration */
  keyConfig?: {
    /** Default key expiration in days */
    defaultExpirationDays?: number
    /** Enable automatic key rotation */
    autoRotate?: boolean
    /** Rotation interval in days */
    rotationIntervalDays?: number
  }
}

