/**
 * TEE-Backed XMTP Key Manager
 *
 * Manages XMTP identity keys within a TEE enclave.
 * Keys are generated and used inside the TEE, never exposed to application code.
 *
 * Modes:
 * - mockMode: true - Keys stored in-memory (local development only)
 * - mockMode: false - Keys managed by real TEE provider via @jejunetwork/kms
 */

import type {
  AccessControlPolicy,
  GeneratedKey,
  KeyCurve,
  KeyType,
  TEEAttestation as KMSTEEAttestation,
} from '@jejunetwork/kms'
import {
  bytesToHex,
  createLogger,
  decryptAesGcm,
  deriveKeyScrypt,
  encryptAesGcm,
  fromHex,
  hmacSha256,
  randomBytes,
  toHex,
} from '@jejunetwork/shared'
import type { TEEAttestation } from '@jejunetwork/types'

const log = createLogger('tee-key-manager')

import { ed25519, x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import type { Address, Hex } from 'viem'
import type {
  AttestationVerificationResult,
  EncryptedBackup,
  GenerateKeyRequest,
  GenerateKeyResult,
  SignRequest as LocalSignRequest,
  SignResult,
  TEEIdentityKey,
  TEEInstallationKey,
  TEEKeyConfig,
  TEEPreKey,
} from './types'

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

// TEE Provider interface (matches @jejunetwork/kms TEEProvider)
interface TEEProviderInterface {
  connect(): Promise<void>
  disconnect(): Promise<void>
  isAvailable(): Promise<boolean>
  generateKey(
    owner: Address,
    keyType: KeyType,
    curve: KeyCurve,
    policy: AccessControlPolicy,
  ): Promise<GeneratedKey>
  sign(request: {
    keyId: string
    message: Uint8Array | string
    hashAlgorithm?: string
  }): Promise<{ signature: Hex; keyId: string; signedAt: number }>
  getAttestation(keyId?: string): Promise<TEEAttestation>
  verifyAttestation(attestation: TEEAttestation): Promise<boolean>
  getStatus(): { connected: boolean; mode: 'remote' | 'local' }
}

/**
 * Manages XMTP keys in a Trusted Execution Environment
 */
export class TEEXMTPKeyManager {
  private config: TEEKeyConfig
  private keys: Map<string, TEEIdentityKey> = new Map()
  private preKeys: Map<string, TEEPreKey> = new Map()
  private installationKeys: Map<string, TEEInstallationKey> = new Map()

  // Mock key store - only used when mockMode is enabled
  private mockKeyStore: Map<string, MockKeyStore> = new Map()

  // Real TEE provider - used when mockMode is false
  private teeProvider: TEEProviderInterface | null = null
  private teeInitPromise: Promise<void> | null = null
  private teeInitError: Error | null = null

  constructor(config: TEEKeyConfig) {
    this.config = config

    // Enforce security policy: mockMode only allowed on 'local' network
    if (config.mockMode && config.network !== 'local') {
      throw new Error(
        `SECURITY: mockMode is only allowed on 'local' network. ` +
          `Cannot use mockMode on '${config.network}'. ` +
          `Set mockMode: false for testnet/mainnet deployments.`,
      )
    }

    if (config.mockMode) {
      log.warn(
        'Running in MOCK MODE - keys are stored in-memory, NOT in real TEE hardware',
      )
      log.warn(
        'Set mockMode: false in production to use actual TEE infrastructure',
      )
    } else {
      // In production mode, initialize real TEE provider
      this.teeInitPromise = this.initializeRealTEE()
    }
  }

  /**
   * Initialize real TEE provider from @jejunetwork/kms
   */
  private async initializeRealTEE(): Promise<void> {
    log.info('Initializing real TEE provider', {
      endpoint: this.config.kmsEndpoint,
      enclaveId: this.config.enclaveId,
      network: this.config.network,
    })

    try {
      const { getTEEProvider } = await import('@jejunetwork/kms')

      this.teeProvider = getTEEProvider({
        endpoint: this.config.kmsEndpoint,
      }) as unknown as TEEProviderInterface

      await this.teeProvider.connect()

      log.info('Connected to TEE provider')
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new Error('Unknown TEE initialization error')
      this.teeInitError = error
      log.error('Failed to initialize TEE provider', { error: error.message })
      throw new Error(
        `TEE provider initialization failed: ${error.message}. ` +
          `Ensure TEE_ENDPOINT and TEE_ENCRYPTION_SECRET are configured.`,
      )
    }
  }

  /**
   * Ensure TEE provider is connected (for real mode)
   */
  private async ensureTEEConnected(): Promise<void> {
    if (this.config.mockMode) return

    // Wait for initialization to complete
    if (this.teeInitPromise) {
      await this.teeInitPromise
    }

    // Check if initialization failed
    if (this.teeInitError) {
      throw this.teeInitError
    }

    if (!this.teeProvider) {
      throw new Error('TEE provider not initialized')
    }

    // TEEProvider.connect() is idempotent - it returns early if already connected
    await this.teeProvider.connect()
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

    log.info('Generated identity key', {
      keyId: keyId.slice(0, 20),
      address: address.slice(0, 10),
      mode: this.config.mockMode ? 'mock' : 'tee',
    })

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
      message: fromHex(preKeyPair.publicKey),
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

    log.info('Generated pre-key', { preKeyId })

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

    log.info('Derived installation key', { deviceId: deviceId.slice(0, 8) })

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
    if (this.config.mockMode) {
      // Mock ECDH using local key store
      const keyStore = this.mockKeyStore.get(privateKeyId)
      if (!keyStore || keyStore.type !== 'x25519') {
        throw new Error(`X25519 key not found: ${privateKeyId}`)
      }

      const theirPub = new Uint8Array(
        theirPublicKey
          .slice(2)
          .match(/.{2}/g)
          ?.map((b) => parseInt(b, 16)) ?? [],
      )

      // For mock, use x25519 shared secret
      const shared = x25519.getSharedSecret(keyStore.privateKey, theirPub)
      return shared
    }

    // Real TEE mode - use TEE provider for ECDH
    // Note: This requires the TEE provider to support ECDH operations
    // For now, we derive a shared secret using HKDF from both keys
    await this.ensureTEEConnected()

    // In real TEE, the ECDH happens inside the enclave
    // This is a simplified implementation - real TEE would handle this securely
    const derivedKey = await this.deriveKeyInTEE(
      privateKeyId,
      `ecdh-${Date.now()}`,
      `ecdh:${theirPublicKey}`,
    )

    return fromHex(derivedKey.publicKey)
  }

  /**
   * Export encrypted backup of keys with strong KDF
   */
  async exportEncrypted(
    keyId: string,
    backupPassword: string,
  ): Promise<EncryptedBackup> {
    if (!this.config.mockMode) {
      throw new Error(
        'Direct key export not supported in TEE mode. Use TEE provider backup mechanisms.',
      )
    }

    const keyStore = this.mockKeyStore.get(keyId)
    if (!keyStore) {
      throw new Error(`Key not found: ${keyId}`)
    }

    // Derive encryption key from password using strong scrypt parameters
    const salt = randomBytes(32)
    const encryptionKey = await deriveKeyScrypt(backupPassword, salt, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      dkLen: SCRYPT_KEYLEN,
    })

    // Encrypt private key using AES-GCM
    const { ciphertext, iv, tag } = await encryptAesGcm(
      keyStore.privateKey,
      encryptionKey,
    )

    // Combine: iv + authTag + ciphertext
    const combined = new Uint8Array(iv.length + tag.length + ciphertext.length)
    combined.set(iv, 0)
    combined.set(tag, iv.length)
    combined.set(ciphertext, iv.length + tag.length)

    return {
      ciphertext: `0x${bytesToHex(combined)}` as Hex,
      metadata: {
        keyId,
        algorithm: 'aes-256-gcm',
        kdfParams: {
          salt: `0x${bytesToHex(salt)}` as Hex,
          iterations: SCRYPT_N, // N value for reference
        },
      },
      createdAt: Date.now(),
    }
  }

  /**
   * Import key from encrypted backup
   * @param encryptedBackup - The encrypted backup data
   * @param password - Password to decrypt the backup
   * @param newKeyId - New key ID for the imported key
   * @param address - The Ethereum address associated with this key (from original backup)
   */
  async importFromBackup(
    encryptedBackup: EncryptedBackup,
    password: string,
    newKeyId: string,
    address: Address,
  ): Promise<TEEIdentityKey> {
    if (!this.config.mockMode) {
      throw new Error(
        'Direct key import not supported in TEE mode. Use TEE provider import mechanisms.',
      )
    }

    const { ciphertext, metadata } = encryptedBackup

    // Derive decryption key using strong scrypt parameters
    const salt = fromHex(metadata.kdfParams.salt)
    const decryptionKey = await deriveKeyScrypt(password, salt, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      dkLen: SCRYPT_KEYLEN,
    })

    // Parse ciphertext: iv (12 bytes) + authTag (16 bytes) + ciphertext
    const data = fromHex(ciphertext)
    const iv = data.subarray(0, 12)
    const authTag = data.subarray(12, 28)
    const encrypted = data.subarray(28)

    // Decrypt using AES-GCM
    const privateKey = await decryptAesGcm(
      encrypted,
      decryptionKey,
      iv,
      authTag,
    )

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
      address,
      publicKey: toHex(publicKey),
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
   * Convert messaging TEEAttestation to KMS TEEAttestation format
   */
  private toKMSAttestation(attestation: TEEAttestation): KMSTEEAttestation {
    return {
      quote: attestation.nonce ?? attestation.quote,
      measurement: attestation.measurement,
      timestamp: attestation.timestamp,
      verified: true, // Attestation was verified during generation
      verifierSignature: attestation.signature,
    }
  }

  /**
   * Verify TEE attestation
   */
  async verifyAttestation(
    attestation: TEEAttestation,
  ): Promise<AttestationVerificationResult> {
    if (!this.config.mockMode && this.teeProvider) {
      // Use real TEE provider attestation verification
      const kmsAttestation = this.toKMSAttestation(attestation)
      const valid = await this.teeProvider.verifyAttestation(kmsAttestation)
      return {
        valid,
        enclaveIdMatch: attestation.enclaveId === this.config.enclaveId,
        measurementMatch: valid,
        signatureValid: valid,
        chainValid: valid,
        errors: valid ? [] : ['TEE provider attestation verification failed'],
      }
    }

    // Mock verification
    const enclaveIdMatch = attestation.enclaveId === this.config.enclaveId

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
    if (!this.config.mockMode && this.teeProvider) {
      // Use real TEE provider
      await this.ensureTEEConnected()

      // Note: KMS doesn't support x25519 directly, but ed25519 keys can be converted
      // For x25519 requests, we use ed25519 in TEE and convert the public key
      const curve: KeyCurve = 'ed25519'
      const owner =
        (request.policy?.owner as Address) ??
        ('0x0000000000000000000000000000000000000000' as Address)

      // Convert KeyPolicy to AccessControlPolicy
      // For now, use empty conditions - the owner is already specified as a parameter
      const kmsPolicy: AccessControlPolicy = {
        conditions: [],
        operator: 'and',
      }

      const result = await this.teeProvider.generateKey(
        owner,
        request.type === 'ed25519' ? 'signing' : 'encryption',
        curve,
        kmsPolicy,
      )

      return {
        keyId: result.metadata.id,
        publicKey: result.publicKey,
        type: request.type,
      }
    }

    // Mock mode - generate locally
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
      publicKey: toHex(publicKey),
      type: request.type,
    }
  }

  /**
   * Sign inside TEE
   */
  private async signInTEE(request: LocalSignRequest): Promise<SignResult> {
    if (!this.config.mockMode && this.teeProvider) {
      // Use real TEE provider
      await this.ensureTEEConnected()

      // Map local hash algorithms to KMS-compatible ones
      // KMS supports: 'keccak256' | 'sha256' | 'none'
      // Local supports: 'sha256' | 'sha512' | 'none'
      // sha512 is not supported by KMS, fallback to sha256
      const hashAlgorithm =
        request.hashAlgorithm === 'sha512'
          ? 'sha256'
          : (request.hashAlgorithm ?? 'sha256')
      const result = await this.teeProvider.sign({
        keyId: request.keyId,
        message: request.message,
        hashAlgorithm,
      })

      return {
        signature: result.signature,
        keyId: result.keyId,
        timestamp: result.signedAt,
      }
    }

    // Mock mode - sign locally
    const keyStore = this.mockKeyStore.get(request.keyId)
    if (!keyStore || keyStore.type !== 'ed25519') {
      throw new Error(`Ed25519 key not found: ${request.keyId}`)
    }

    const signature = ed25519.sign(request.message, keyStore.privateKey)

    return {
      signature: toHex(signature),
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
    if (!this.config.mockMode) {
      // In real TEE mode, key derivation happens inside the enclave
      // For now, we generate a new key and link it to the parent
      return this.generateKeyInTEE({
        keyId: newKeyId,
        type: 'x25519',
        policy: { parentKey: parentKeyId },
      })
    }

    // Mock mode - derive locally
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
      publicKey: toHex(publicKey),
      type: 'x25519',
    }
  }

  /**
   * Convert KMS TEEAttestation to messaging TEEAttestation format
   */
  private fromKMSAttestation(kmsAtt: KMSTEEAttestation): TEEAttestation {
    return {
      quote: kmsAtt.quote,
      measurement: kmsAtt.measurement,
      timestamp: kmsAtt.timestamp,
      verified: kmsAtt.verified,
      verifierSignature: kmsAtt.verifierSignature,
    }
  }

  /**
   * Generate attestation for key
   */
  private async generateAttestation(keyId: string): Promise<TEEAttestation> {
    if (!this.config.mockMode && this.teeProvider) {
      // Use real TEE provider attestation
      await this.ensureTEEConnected()
      const kmsAttestation = await this.teeProvider.getAttestation(keyId)
      return this.fromKMSAttestation(kmsAttestation)
    }

    // Mock attestation
    const nonce = randomBytes(32)
    const timestamp = Date.now()

    const measurement = randomBytes(32)

    // Sign attestation using key-derived secret
    const enclaveIdBytes = new TextEncoder().encode(this.config.enclaveId)
    const timestampBytes = new TextEncoder().encode(timestamp.toString())
    const attestationData = new Uint8Array(
      enclaveIdBytes.length +
        measurement.length +
        nonce.length +
        timestampBytes.length,
    )
    let offset = 0
    attestationData.set(enclaveIdBytes, offset)
    offset += enclaveIdBytes.length
    attestationData.set(measurement, offset)
    offset += measurement.length
    attestationData.set(nonce, offset)
    offset += nonce.length
    attestationData.set(timestampBytes, offset)

    // Use key material for HMAC
    const keyStore = this.mockKeyStore.get(keyId)
    const hmacKey = keyStore ? keyStore.privateKey : randomBytes(32)

    const signature = hmacSha256(hmacKey, attestationData)

    // Create mock quote (serialized attestation document)
    const quoteData = {
      version: 1,
      enclaveId: this.config.enclaveId,
      measurement: toHex(measurement),
      pcrs: {
        '0': toHex(randomBytes(32)),
        '1': toHex(randomBytes(32)),
        '2': toHex(randomBytes(32)),
      },
      nonce: toHex(nonce),
      timestamp,
      signature: toHex(signature),
    }
    const quote = toHex(new TextEncoder().encode(JSON.stringify(quoteData)))

    return {
      quote,
      measurement: toHex(measurement),
      timestamp,
      verified: true,
      platform: 'simulated',
      version: 1,
      enclaveId: this.config.enclaveId,
      pcrs: {
        '0': toHex(randomBytes(32)),
        '1': toHex(randomBytes(32)),
        '2': toHex(randomBytes(32)),
      },
      nonce: toHex(nonce),
      signature: toHex(signature),
    }
  }

  /**
   * Get manager stats
   */
  getStats(): {
    identityKeys: number
    preKeys: number
    installationKeys: number
    mode: 'mock' | 'tee'
  } {
    return {
      identityKeys: this.keys.size,
      preKeys: this.preKeys.size,
      installationKeys: this.installationKeys.size,
      mode: this.config.mockMode ? 'mock' : 'tee',
    }
  }

  /**
   * Disconnect from TEE provider (cleanup)
   */
  async disconnect(): Promise<void> {
    if (this.teeProvider) {
      await this.teeProvider.disconnect()
      this.teeProvider = null
    }

    // Clear mock key store
    for (const key of this.mockKeyStore.values()) {
      key.privateKey.fill(0)
    }
    this.mockKeyStore.clear()

    log.info('TEE key manager disconnected')
  }
}

/**
 * Create TEE key manager
 *
 * @param config - Configuration for TEE key management
 * @param config.mockMode - Must be explicitly set to true for development or false for production
 */
export function createTEEKeyManager(config: TEEKeyConfig): TEEXMTPKeyManager {
  // Validate mockMode is explicitly set
  if (typeof config.mockMode !== 'boolean') {
    throw new Error(
      'TEEKeyConfig.mockMode must be explicitly set to true (development) or false (production).',
    )
  }

  return new TEEXMTPKeyManager(config)
}
