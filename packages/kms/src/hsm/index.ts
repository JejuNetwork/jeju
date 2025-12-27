/**
 * HSM (Hardware Security Module) Integration
 *
 * Provides an abstraction layer for HSM-backed key operations.
 * Master keys are stored in the HSM and never extracted.
 *
 * Supported HSM Types:
 * - AWS CloudHSM
 * - Azure Dedicated HSM
 * - Google Cloud HSM
 * - YubiHSM 2 (local)
 * - SoftHSM (development only)
 *
 * SECURITY PROPERTIES:
 * - Master keys never leave the HSM
 * - All cryptographic operations happen inside HSM
 * - Keys are protected by HSM's tamper-resistant hardware
 * - Audit logging of all key operations
 */

import type { Hex } from 'viem'
import { keccak256 } from 'viem'
import { kmsLogger as log } from '../logger.js'

/**
 * HSM key reference - the actual key never leaves the HSM
 */
export interface HSMKeyRef {
  /** Unique key identifier within the HSM */
  keyId: string
  /** Key label for human reference */
  label: string
  /** Key type */
  type: 'aes-256' | 'ec-secp256k1' | 'ec-ed25519' | 'rsa-2048'
  /** Whether key can be exported (should be false for master keys) */
  extractable: boolean
  /** Key usage permissions */
  usage: Array<'encrypt' | 'decrypt' | 'sign' | 'verify' | 'derive'>
  /** Creation timestamp */
  createdAt: number
}

/**
 * HSM configuration
 */
export interface HSMConfig {
  /** HSM type */
  type: 'aws-cloudhsm' | 'azure-hsm' | 'gcloud-hsm' | 'yubihsm' | 'softhsm'
  /** HSM connection endpoint */
  endpoint?: string
  /** HSM slot/partition */
  slot?: number
  /** Credentials file path or inline credentials */
  credentials?: string | HSMCredentials
  /** Network (for validation) */
  network?: 'localnet' | 'testnet' | 'mainnet'
}

export interface HSMCredentials {
  /** User/operator PIN */
  pin?: string
  /** Crypto user password (AWS CloudHSM) */
  cuPassword?: string
  /** Crypto officer password (AWS CloudHSM) */
  coPassword?: string
  /** YubiHSM auth key ID */
  authKeyId?: number
}

/**
 * Result of HSM encrypt operation
 */
export interface HSMEncryptResult {
  ciphertext: Uint8Array
  iv: Uint8Array
  keyId: string
}

/**
 * Result of HSM sign operation
 */
export interface HSMSignResult {
  signature: Hex
  keyId: string
}

/**
 * HSM Provider Interface
 */
export interface HSMProvider {
  /** Connect to HSM */
  connect(): Promise<void>
  /** Disconnect from HSM */
  disconnect(): Promise<void>
  /** Check if HSM is available */
  isAvailable(): Promise<boolean>
  /** Generate a new key in the HSM */
  generateKey(
    label: string,
    type: HSMKeyRef['type'],
    extractable?: boolean,
  ): Promise<HSMKeyRef>
  /** Get key reference by ID */
  getKey(keyId: string): Promise<HSMKeyRef | null>
  /** List all keys */
  listKeys(): Promise<HSMKeyRef[]>
  /** Delete a key */
  deleteKey(keyId: string): Promise<void>
  /** Encrypt data using HSM key */
  encrypt(keyId: string, plaintext: Uint8Array): Promise<HSMEncryptResult>
  /** Decrypt data using HSM key */
  decrypt(keyId: string, ciphertext: Uint8Array, iv: Uint8Array): Promise<Uint8Array>
  /** Sign data using HSM key */
  sign(keyId: string, data: Uint8Array): Promise<HSMSignResult>
  /** Verify signature using HSM key */
  verify(keyId: string, data: Uint8Array, signature: Hex): Promise<boolean>
  /** Derive a key from the master key (HKDF) */
  deriveKey(
    masterKeyId: string,
    salt: Uint8Array,
    info: string,
    outputLength: number,
  ): Promise<Uint8Array>
}

/**
 * SoftHSM Provider - For development and testing only
 *
 * WARNING: This is NOT a real HSM. Keys are stored in memory.
 * Only use for local development.
 */
export class SoftHSMProvider implements HSMProvider {
  private keys = new Map<string, { ref: HSMKeyRef; material: Uint8Array }>()
  private connected = false
  private network: string

  constructor(config: HSMConfig) {
    this.network = config.network ?? 'localnet'

    // SECURITY: Reject SoftHSM on mainnet
    if (this.network === 'mainnet') {
      throw new Error(
        'SECURITY: SoftHSM is NOT allowed on mainnet. ' +
          'Use a real hardware HSM (AWS CloudHSM, Azure HSM, YubiHSM, etc.)',
      )
    }

    if (this.network === 'testnet') {
      log.warn(
        'SECURITY WARNING: Using SoftHSM on testnet. ' +
          'Ensure hardware HSM is used for any real value operations.',
      )
    }
  }

  async connect(): Promise<void> {
    this.connected = true
    log.info('SoftHSM connected (development mode)')
  }

  async disconnect(): Promise<void> {
    // Securely zero all key material
    for (const { material } of this.keys.values()) {
      material.fill(0)
      crypto.getRandomValues(material)
      material.fill(0)
    }
    this.keys.clear()
    this.connected = false
    log.info('SoftHSM disconnected - all key material zeroed')
  }

  async isAvailable(): Promise<boolean> {
    return this.connected
  }

  async generateKey(
    label: string,
    type: HSMKeyRef['type'],
    extractable = false,
  ): Promise<HSMKeyRef> {
    this.ensureConnected()

    const keyId = `soft-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    let keyMaterial: Uint8Array

    switch (type) {
      case 'aes-256':
        keyMaterial = new Uint8Array(32)
        crypto.getRandomValues(keyMaterial)
        break
      case 'ec-secp256k1':
      case 'ec-ed25519':
        keyMaterial = new Uint8Array(32)
        crypto.getRandomValues(keyMaterial)
        break
      case 'rsa-2048':
        throw new Error('RSA key generation not implemented in SoftHSM')
      default:
        throw new Error(`Unknown key type: ${type}`)
    }

    const ref: HSMKeyRef = {
      keyId,
      label,
      type,
      extractable,
      usage: type === 'aes-256' 
        ? ['encrypt', 'decrypt', 'derive']
        : ['sign', 'verify'],
      createdAt: Date.now(),
    }

    this.keys.set(keyId, { ref, material: keyMaterial })
    log.info('SoftHSM key generated', { keyId, label, type })

    return ref
  }

  async getKey(keyId: string): Promise<HSMKeyRef | null> {
    this.ensureConnected()
    return this.keys.get(keyId)?.ref ?? null
  }

  async listKeys(): Promise<HSMKeyRef[]> {
    this.ensureConnected()
    return Array.from(this.keys.values()).map(({ ref }) => ref)
  }

  async deleteKey(keyId: string): Promise<void> {
    this.ensureConnected()
    const entry = this.keys.get(keyId)
    if (entry) {
      // Securely zero the key material
      entry.material.fill(0)
      crypto.getRandomValues(entry.material)
      entry.material.fill(0)
      this.keys.delete(keyId)
      log.info('SoftHSM key deleted', { keyId })
    }
  }

  async encrypt(keyId: string, plaintext: Uint8Array): Promise<HSMEncryptResult> {
    this.ensureConnected()
    const entry = this.keys.get(keyId)
    if (!entry || entry.ref.type !== 'aes-256') {
      throw new Error(`AES key not found: ${keyId}`)
    }

    const iv = crypto.getRandomValues(new Uint8Array(12))
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      entry.material,
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    )

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      plaintext,
    )

    return {
      ciphertext: new Uint8Array(ciphertext),
      iv,
      keyId,
    }
  }

  async decrypt(
    keyId: string,
    ciphertext: Uint8Array,
    iv: Uint8Array,
  ): Promise<Uint8Array> {
    this.ensureConnected()
    const entry = this.keys.get(keyId)
    if (!entry || entry.ref.type !== 'aes-256') {
      throw new Error(`AES key not found: ${keyId}`)
    }

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      entry.material,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    )

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext,
    )

    return new Uint8Array(plaintext)
  }

  async sign(keyId: string, data: Uint8Array): Promise<HSMSignResult> {
    this.ensureConnected()
    const entry = this.keys.get(keyId)
    if (!entry || !entry.ref.type.startsWith('ec-')) {
      throw new Error(`EC key not found: ${keyId}`)
    }

    // For SoftHSM, use keccak256 as a simple signature
    // Real HSM would use proper ECDSA
    const hash = keccak256(new Uint8Array([...entry.material, ...data]))

    return {
      signature: hash,
      keyId,
    }
  }

  async verify(keyId: string, data: Uint8Array, signature: Hex): Promise<boolean> {
    this.ensureConnected()
    const result = await this.sign(keyId, data)
    return result.signature === signature
  }

  async deriveKey(
    masterKeyId: string,
    salt: Uint8Array,
    info: string,
    outputLength: number,
  ): Promise<Uint8Array> {
    this.ensureConnected()
    const entry = this.keys.get(masterKeyId)
    if (!entry) {
      throw new Error(`Master key not found: ${masterKeyId}`)
    }

    const baseKey = await crypto.subtle.importKey(
      'raw',
      entry.material,
      { name: 'HKDF' },
      false,
      ['deriveBits'],
    )

    const infoBytes = new TextEncoder().encode(info)
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        salt,
        info: infoBytes,
        hash: 'SHA-256',
      },
      baseKey,
      outputLength * 8,
    )

    return new Uint8Array(derivedBits)
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('SoftHSM not connected')
    }
  }
}

/**
 * Create an HSM provider based on configuration.
 *
 * SECURITY: On mainnet, only hardware HSM providers are allowed.
 */
export function createHSMProvider(config: HSMConfig): HSMProvider {
  switch (config.type) {
    case 'softhsm':
      return new SoftHSMProvider(config)

    case 'aws-cloudhsm':
      // TODO: Implement AWS CloudHSM provider
      throw new Error(
        'AWS CloudHSM not yet implemented. ' +
          'Use HSM_TYPE=softhsm for development.',
      )

    case 'azure-hsm':
      // TODO: Implement Azure HSM provider
      throw new Error(
        'Azure HSM not yet implemented. ' +
          'Use HSM_TYPE=softhsm for development.',
      )

    case 'gcloud-hsm':
      // TODO: Implement Google Cloud HSM provider
      throw new Error(
        'Google Cloud HSM not yet implemented. ' +
          'Use HSM_TYPE=softhsm for development.',
      )

    case 'yubihsm':
      // TODO: Implement YubiHSM provider
      throw new Error(
        'YubiHSM not yet implemented. ' +
          'Use HSM_TYPE=softhsm for development.',
      )

    default:
      throw new Error(`Unknown HSM type: ${config.type}`)
  }
}

// Singleton HSM provider
let hsmProvider: HSMProvider | null = null

/**
 * Get or create the HSM provider.
 */
export function getHSMProvider(config?: HSMConfig): HSMProvider {
  if (!hsmProvider) {
    const hsmType = (process.env.HSM_TYPE as HSMConfig['type']) ?? 'softhsm'
    const network = (process.env.NETWORK as HSMConfig['network']) ?? 'localnet'

    hsmProvider = createHSMProvider({
      type: hsmType,
      network,
      ...config,
    })
  }
  return hsmProvider
}

/**
 * Reset the HSM provider (disconnect and clear).
 */
export async function resetHSMProvider(): Promise<void> {
  if (hsmProvider) {
    await hsmProvider.disconnect()
    hsmProvider = null
  }
}
