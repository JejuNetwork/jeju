/**
 * TEE-Backed XMTP Key Manager
 *
 * Manages XMTP identity keys within a TEE enclave.
 * Keys are generated and used inside the TEE, never exposed to application code.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt,
} from 'node:crypto'
import { ed25519, x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import type { Address, Hex } from 'viem'
import type {
  AttestationVerificationResult,
  EncryptedBackup,
  GenerateKeyRequest,
  GenerateKeyResult,
  SignRequest,
  SignResult,
  TEEAttestation,
  TEEIdentityKey,
  TEEInstallationKey,
  TEEKeyConfig,
  TEEPreKey,
} from './types'

// Typed promisified scrypt for async usage
const scryptAsync = (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey)
    })
  })
}

/** Max identity keys per manager to prevent memory exhaustion */
export const MAX_IDENTITY_KEYS = 10000
/** Max pre-keys per manager to prevent memory exhaustion */
export const MAX_PRE_KEYS = 100000
/** Max installation keys per manager to prevent memory exhaustion */
export const MAX_INSTALLATION_KEYS = 50000
/** Max mock keys in test mode to prevent memory exhaustion */
export const MAX_MOCK_KEYS = 100000

// Recommended scrypt parameters for backup encryption
// N=2^14 (~16k), r=8, p=1, keylen=32
// This provides strong security while staying within Bun's memory limits
// Note: r=8 provides ~128x memory multiplier, so effective cost is ~2MB
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 32

interface MockKeyStore {
  privateKey: Uint8Array
  publicKey: Uint8Array
  type: 'ed25519' | 'x25519'
}

/**
 * Manages XMTP keys in a Trusted Execution Environment
 */
export class TEEXMTPKeyManager {
  private config: TEEKeyConfig
  private keys: Map<string, TEEIdentityKey> = new Map()
  private preKeys: Map<string, TEEPreKey> = new Map()
  private installationKeys: Map<string, TEEInstallationKey> = new Map()

  // In production, this would be a TEE-backed store
  // For now, use in-memory mock
  private mockKeyStore: Map<string, MockKeyStore> = new Map()

  constructor(config: TEEKeyConfig) {
    this.config = config
  }

  /**
   * Generate XMTP identity key inside TEE
   */
  async generateIdentityKey(address: Address): Promise<TEEIdentityKey> {
    // Check limit to prevent memory exhaustion
    if (this.keys.size >= MAX_IDENTITY_KEYS) {
      throw new Error(
        `Cannot generate identity key: maximum limit (${MAX_IDENTITY_KEYS}) reached`,
      )
    }

    const keyId = `xmtp-identity-${address.toLowerCase()}-${Date.now()}`

    // Generate Ed25519 key pair inside TEE
    const keyPair = await this.generateKeyInTEE({
      keyId,
      type: 'ed25519',
      policy: {
        owner: address,
        operations: ['sign', 'derive'],
        attestation: this.config.attestationRequired,
      },
    })

    // Get attestation if required
    let attestation: TEEAttestation | undefined
    if (this.config.attestationRequired) {
      attestation = await this.generateAttestation(keyId)
    }

    const identityKey: TEEIdentityKey = {
      keyId,
      address,
      publicKey: keyPair.publicKey,
      attestation,
      createdAt: Date.now(),
    }

    this.keys.set(keyId, identityKey)

    // Log without exposing full key ID or address (use truncated versions)
    console.log(
      `[TEE] Generated identity key ${keyId.slice(0, 20)}... for ${address.slice(0, 10)}...`,
    )

    return identityKey
  }

  /**
   * Get identity key for address
   */
  async getIdentityKey(address: Address): Promise<TEEIdentityKey | null> {
    for (const key of this.keys.values()) {
      if (key.address.toLowerCase() === address.toLowerCase()) {
        return key
      }
    }
    return null
  }

  /**
   * Get identity key by ID
   */
  async getKey(keyId: string): Promise<TEEIdentityKey | null> {
    return this.keys.get(keyId) ?? null
  }

  /**
   * Generate XMTP pre-key inside TEE
   */
  async generatePreKey(identityKeyId: string): Promise<TEEPreKey> {
    // Check limit to prevent memory exhaustion
    if (this.preKeys.size >= MAX_PRE_KEYS) {
      throw new Error(
        `Cannot generate pre-key: maximum limit (${MAX_PRE_KEYS}) reached`,
      )
    }

    const identityKey = this.keys.get(identityKeyId)
    if (!identityKey) {
      throw new Error(`Identity key not found: ${identityKeyId}`)
    }

    const preKeyId = `${identityKeyId}-prekey-${Date.now()}`

    // Generate X25519 pre-key
    const preKeyPair = await this.generateKeyInTEE({
      keyId: preKeyId,
      type: 'x25519',
      policy: { parentKey: identityKeyId },
    })

    // Sign pre-key with identity key
    const signature = await this.signInTEE({
      keyId: identityKeyId,
      message: Buffer.from(preKeyPair.publicKey.slice(2), 'hex'),
    })

    const preKey: TEEPreKey = {
      keyId: preKeyId,
      identityKeyId,
      publicKey: preKeyPair.publicKey,
      signature: signature.signature,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
    }

    this.preKeys.set(preKeyId, preKey)

    console.log(`[TEE] Generated pre-key ${preKeyId}`)

    return preKey
  }

  /**
   * Get pre-keys for identity key
   */
  async getPreKeys(identityKeyId: string): Promise<TEEPreKey[]> {
    return Array.from(this.preKeys.values()).filter(
      (pk) => pk.identityKeyId === identityKeyId,
    )
  }

  /**
   * Derive installation key from identity key
   */
  async deriveInstallationKey(
    identityKeyId: string,
    deviceId: string,
  ): Promise<TEEInstallationKey> {
    const identityKey = this.keys.get(identityKeyId)
    if (!identityKey) {
      throw new Error(`Identity key not found: ${identityKeyId}`)
    }

    const installationKeyId = `${identityKeyId}-installation-${deviceId}`

    // Check if already exists
    const existing = this.installationKeys.get(installationKeyId)
    if (existing) return existing

    // Check limit to prevent memory exhaustion
    if (this.installationKeys.size >= MAX_INSTALLATION_KEYS) {
      throw new Error(
        `Cannot derive installation key: maximum limit (${MAX_INSTALLATION_KEYS}) reached`,
      )
    }

    // Derive key using HKDF inside TEE
    const derivedKey = await this.deriveKeyInTEE(
      identityKeyId,
      installationKeyId,
      `xmtp-installation-${deviceId}`,
    )

    const installationKey: TEEInstallationKey = {
      keyId: installationKeyId,
      identityKeyId,
      deviceId,
      publicKey: derivedKey.publicKey,
      createdAt: Date.now(),
    }

    this.installationKeys.set(installationKeyId, installationKey)

    // Log truncated device ID only
    console.log(
      `[TEE] Derived installation key for device ${deviceId.slice(0, 8)}...`,
    )

    return installationKey
  }

  /**
   * Sign message with identity key
   */
  async sign(keyId: string, message: Uint8Array): Promise<Hex> {
    const result = await this.signInTEE({
      keyId,
      message,
    })

    // Update last used timestamp
    const key = this.keys.get(keyId)
    if (key) {
      key.lastUsedAt = Date.now()
    }

    return result.signature
  }

  /**
   * Perform ECDH key exchange inside TEE
   */
  async sharedSecret(
    privateKeyId: string,
    theirPublicKey: Hex,
  ): Promise<Uint8Array> {
    // In production, this happens entirely inside TEE
    const keyStore = this.mockKeyStore.get(privateKeyId)
    if (!keyStore || keyStore.type !== 'x25519') {
      throw new Error(`X25519 key not found: ${privateKeyId}`)
    }

    // Mock ECDH - in production, use TEE-backed X25519
    const theirPub = Buffer.from(theirPublicKey.slice(2), 'hex')

    // For mock, just hash the concatenation
    const shared = createHash('sha256')
      .update(keyStore.privateKey)
      .update(theirPub)
      .digest()

    return shared
  }

  /**
   * Export encrypted backup of keys with strong KDF
   */
  async exportEncrypted(
    keyId: string,
    backupPassword: string,
  ): Promise<EncryptedBackup> {
    const keyStore = this.mockKeyStore.get(keyId)
    if (!keyStore) {
      throw new Error(`Key not found: ${keyId}`)
    }

    // Derive encryption key from password using strong scrypt parameters
    const salt = randomBytes(32)
    const encryptionKey = (await scryptAsync(
      backupPassword,
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
    )) as Buffer

    // Encrypt private key
    const iv = randomBytes(16)
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)

    const encrypted = Buffer.concat([
      cipher.update(keyStore.privateKey),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()

    // Combine: iv + authTag + ciphertext
    const ciphertext = Buffer.concat([iv, authTag, encrypted])

    return {
      ciphertext: `0x${ciphertext.toString('hex')}` as Hex,
      metadata: {
        keyId,
        algorithm: 'aes-256-gcm',
        kdfParams: {
          salt: `0x${salt.toString('hex')}` as Hex,
          iterations: SCRYPT_N, // N value for reference
        },
      },
      createdAt: Date.now(),
    }
  }

  /**
   * Import key from encrypted backup
   */
  async importFromBackup(
    encryptedBackup: EncryptedBackup,
    password: string,
    newKeyId: string,
  ): Promise<TEEIdentityKey> {
    const { ciphertext, metadata } = encryptedBackup

    // Derive decryption key using strong scrypt parameters
    const salt = Buffer.from(metadata.kdfParams.salt.slice(2), 'hex')
    const decryptionKey = (await scryptAsync(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    })) as Buffer

    // Parse ciphertext
    const data = Buffer.from(ciphertext.slice(2), 'hex')
    const iv = data.subarray(0, 16)
    const authTag = data.subarray(16, 32)
    const encrypted = data.subarray(32)

    // Decrypt
    const decipher = createDecipheriv('aes-256-gcm', decryptionKey, iv)
    decipher.setAuthTag(authTag)

    const privateKey = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ])

    // Generate public key from private key
    const publicKey = ed25519.getPublicKey(privateKey)

    // Check keys limit
    if (this.keys.size >= MAX_IDENTITY_KEYS) {
      throw new Error(
        `Cannot import key: maximum identity keys limit (${MAX_IDENTITY_KEYS}) reached`,
      )
    }

    // Store in mock key store
    if (this.mockKeyStore.size >= MAX_MOCK_KEYS) {
      throw new Error(
        `Cannot import key: maximum key store limit (${MAX_MOCK_KEYS}) reached`,
      )
    }

    this.mockKeyStore.set(newKeyId, {
      privateKey: new Uint8Array(privateKey),
      publicKey,
      type: 'ed25519',
    })

    const identityKey: TEEIdentityKey = {
      keyId: newKeyId,
      address: '0x0000000000000000000000000000000000000000' as Address, // Would derive from key
      publicKey: `0x${Buffer.from(publicKey).toString('hex')}` as Hex,
      createdAt: Date.now(),
    }

    this.keys.set(newKeyId, identityKey)

    return identityKey
  }

  /**
   * Get TEE attestation for key
   */
  async getAttestation(keyId: string): Promise<TEEAttestation> {
    const key = this.keys.get(keyId)
    if (!key) {
      throw new Error(`Key not found: ${keyId}`)
    }

    if (key.attestation) {
      return key.attestation
    }

    return this.generateAttestation(keyId)
  }

  /**
   * Verify TEE attestation
   */
  async verifyAttestation(
    attestation: TEEAttestation,
  ): Promise<AttestationVerificationResult> {
    // In production, verify against TEE attestation service
    const enclaveIdMatch = attestation.enclaveId === this.config.enclaveId

    // Mock verification
    return {
      valid: enclaveIdMatch,
      enclaveIdMatch,
      measurementMatch: true, // Would verify against expected measurement
      signatureValid: true, // Would verify attestation signature
      chainValid: true, // Would verify certificate chain
      errors: enclaveIdMatch ? [] : ['Enclave ID mismatch'],
    }
  }

  /**
   * Generate key inside TEE
   */
  private async generateKeyInTEE(
    request: GenerateKeyRequest,
  ): Promise<GenerateKeyResult> {
    let privateKey: Uint8Array
    let publicKey: Uint8Array

    if (request.type === 'ed25519') {
      privateKey = randomBytes(32)
      publicKey = ed25519.getPublicKey(privateKey)
    } else if (request.type === 'x25519') {
      privateKey = randomBytes(32)
      publicKey = x25519.getPublicKey(privateKey)
    } else {
      throw new Error(`Unsupported key type: ${request.type}`)
    }

    // Store in mock TEE store
    this.mockKeyStore.set(request.keyId, {
      privateKey,
      publicKey,
      type: request.type,
    })

    return {
      keyId: request.keyId,
      publicKey: `0x${Buffer.from(publicKey).toString('hex')}` as Hex,
      type: request.type,
    }
  }

  /**
   * Sign inside TEE
   */
  private async signInTEE(request: SignRequest): Promise<SignResult> {
    const keyStore = this.mockKeyStore.get(request.keyId)
    if (!keyStore || keyStore.type !== 'ed25519') {
      throw new Error(`Ed25519 key not found: ${request.keyId}`)
    }

    const signature = ed25519.sign(request.message, keyStore.privateKey)

    return {
      signature: `0x${Buffer.from(signature).toString('hex')}` as Hex,
      keyId: request.keyId,
      timestamp: Date.now(),
    }
  }

  /**
   * Derive key inside TEE using HKDF
   */
  private async deriveKeyInTEE(
    parentKeyId: string,
    newKeyId: string,
    info: string,
  ): Promise<GenerateKeyResult> {
    const parentKey = this.mockKeyStore.get(parentKeyId)
    if (!parentKey) {
      throw new Error(`Parent key not found: ${parentKeyId}`)
    }

    // HKDF derivation
    const derived = hkdf(
      sha256,
      parentKey.privateKey,
      new Uint8Array(0), // salt
      new TextEncoder().encode(info),
      32,
    )

    // Generate public key
    const publicKey = x25519.getPublicKey(derived)

    this.mockKeyStore.set(newKeyId, {
      privateKey: derived,
      publicKey,
      type: 'x25519',
    })

    return {
      keyId: newKeyId,
      publicKey: `0x${Buffer.from(publicKey).toString('hex')}` as Hex,
      type: 'x25519',
    }
  }

  /**
   * Generate attestation for key
   */
  private async generateAttestation(keyId: string): Promise<TEEAttestation> {
    const nonce = randomBytes(32)
    const timestamp = Date.now()

    // Mock attestation - in production, this comes from TEE hardware
    const measurement = randomBytes(32)

    // Sign attestation using key-derived secret
    // In production, TEE hardware provides the signing capability
    const attestationData = Buffer.concat([
      Buffer.from(this.config.enclaveId),
      measurement,
      nonce,
      Buffer.from(timestamp.toString()),
    ])

    // Use key material for HMAC instead of hardcoded secret
    // The attestation key should be derived from TEE-specific secrets
    const keyStore = this.mockKeyStore.get(keyId)
    const hmacKey = keyStore ? keyStore.privateKey : randomBytes(32) // Ephemeral key if no stored key

    const signature = createHmac('sha256', hmacKey)
      .update(attestationData)
      .digest()

    return {
      version: 1,
      enclaveId: this.config.enclaveId,
      measurement: `0x${measurement.toString('hex')}` as Hex,
      pcrs: {
        0: `0x${randomBytes(32).toString('hex')}` as Hex,
        1: `0x${randomBytes(32).toString('hex')}` as Hex,
        2: `0x${randomBytes(32).toString('hex')}` as Hex,
      },
      nonce: `0x${nonce.toString('hex')}` as Hex,
      timestamp,
      signature: `0x${signature.toString('hex')}` as Hex,
    }
  }

  /**
   * Get manager stats
   */
  getStats(): {
    identityKeys: number
    preKeys: number
    installationKeys: number
  } {
    return {
      identityKeys: this.keys.size,
      preKeys: this.preKeys.size,
      installationKeys: this.installationKeys.size,
    }
  }
}

/**
 * Create TEE key manager
 */
export function createTEEKeyManager(config: TEEKeyConfig): TEEXMTPKeyManager {
  return new TEEXMTPKeyManager(config)
}
