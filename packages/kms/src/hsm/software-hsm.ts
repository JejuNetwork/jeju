/**
 * Software HSM Provider
 *
 * In-memory implementation of the HSM interface for development and testing.
 * Uses Web Crypto API for all cryptographic operations.
 *
 * ⚠️ WARNING: This is NOT a hardware HSM. Keys are stored in memory and
 * are vulnerable to side-channel attacks. Use only for development/testing.
 *
 * For production, use a real HSM provider (AWS CloudHSM, Azure HSM, etc.)
 */

import type { Hex } from 'viem'
import { toHex } from 'viem'
import { kmsLogger as log } from '../logger.js'
import type {
  HSMConfig,
  HSMEncryptResult,
  HSMKeyAlgorithm,
  HSMKeyInfo,
  HSMKeyType,
  HSMProvider,
  HSMSignResult,
} from './interface.js'

interface StoredKey {
  info: HSMKeyInfo
  cryptoKey: CryptoKey
  /** For software HSM, we store the raw key for operations that need it */
  rawKey?: Uint8Array
}

/**
 * Software HSM Provider
 *
 * ⚠️ NOT FOR PRODUCTION USE - keys are stored in memory
 */
export class SoftwareHSMProvider implements HSMProvider {
  readonly type = 'software'
  private connected = false
  private keys = new Map<string, StoredKey>()

  constructor(_config: HSMConfig = { provider: 'software' }) {
    void _config // Reserved for future configuration options
    log.warn(
      'Using Software HSM - NOT SECURE FOR PRODUCTION. ' +
        'Keys are stored in memory and vulnerable to side-channel attacks.',
    )
  }

  async connect(): Promise<void> {
    if (this.connected) return
    this.connected = true
    log.info('Software HSM connected')
  }

  async disconnect(): Promise<void> {
    // Zero all raw keys before clearing
    for (const stored of this.keys.values()) {
      if (stored.rawKey) {
        stored.rawKey.fill(0)
      }
    }
    this.keys.clear()
    this.connected = false
    log.info('Software HSM disconnected - all keys zeroed')
  }

  async isAvailable(): Promise<boolean> {
    return true
  }

  async generateKey(
    keyId: string,
    keyType: HSMKeyType,
    algorithm: HSMKeyAlgorithm,
    options?: {
      exportable?: boolean
      expiresAt?: number
      metadata?: Record<string, string>
    },
  ): Promise<HSMKeyInfo> {
    if (this.keys.has(keyId)) {
      throw new Error(`Key ${keyId} already exists`)
    }

    let cryptoKey: CryptoKey
    let rawKey: Uint8Array | undefined

    switch (algorithm) {
      case 'AES-256': {
        cryptoKey = await crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 },
          options?.exportable ?? false,
          ['encrypt', 'decrypt'],
        )
        if (options?.exportable) {
          const exported = await crypto.subtle.exportKey('raw', cryptoKey)
          rawKey = new Uint8Array(exported)
        }
        break
      }
      case 'ECDSA-SECP256K1':
      case 'ECDSA-P256': {
        // Web Crypto doesn't support secp256k1, use P-256 for software HSM
        // Real HSM implementations will use proper secp256k1
        const namedCurve = algorithm === 'ECDSA-P256' ? 'P-256' : 'P-256'
        const keyPair = await crypto.subtle.generateKey(
          { name: 'ECDSA', namedCurve },
          options?.exportable ?? false,
          ['sign', 'verify'],
        )
        cryptoKey = keyPair.privateKey
        break
      }
      case 'RSA-2048':
      case 'RSA-4096': {
        const modulusLength = algorithm === 'RSA-2048' ? 2048 : 4096
        const keyPair = await crypto.subtle.generateKey(
          {
            name: 'RSA-OAEP',
            modulusLength,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
          },
          options?.exportable ?? false,
          ['encrypt', 'decrypt'],
        )
        cryptoKey = keyPair.privateKey
        break
      }
      default:
        throw new Error(`Unsupported algorithm: ${algorithm}`)
    }

    const info: HSMKeyInfo = {
      keyId,
      keyType,
      algorithm,
      createdAt: Date.now(),
      expiresAt: options?.expiresAt,
      version: 1,
      exportable: options?.exportable ?? false,
      metadata: options?.metadata ?? {},
    }

    this.keys.set(keyId, { info, cryptoKey, rawKey })
    log.info('Generated key', { keyId, algorithm, keyType })

    return info
  }

  async getKeyInfo(keyId: string): Promise<HSMKeyInfo | null> {
    const stored = this.keys.get(keyId)
    return stored?.info ?? null
  }

  async listKeys(): Promise<HSMKeyInfo[]> {
    return Array.from(this.keys.values()).map((s) => s.info)
  }

  async rotateKey(keyId: string): Promise<HSMKeyInfo> {
    const stored = this.keys.get(keyId)
    if (!stored) {
      throw new Error(`Key ${keyId} not found`)
    }

    // Generate new key with same parameters
    const newVersion = stored.info.version + 1
    const newInfo = { ...stored.info, version: newVersion, createdAt: Date.now() }

    // For symmetric keys, generate new key material
    if (stored.info.algorithm === 'AES-256') {
      const newCryptoKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        stored.info.exportable,
        ['encrypt', 'decrypt'],
      )

      // Zero old key if we have it
      if (stored.rawKey) {
        stored.rawKey.fill(0)
      }

      let newRawKey: Uint8Array | undefined
      if (stored.info.exportable) {
        const exported = await crypto.subtle.exportKey('raw', newCryptoKey)
        newRawKey = new Uint8Array(exported)
      }

      this.keys.set(keyId, { info: newInfo, cryptoKey: newCryptoKey, rawKey: newRawKey })
    } else {
      // For asymmetric keys, keep the same key (rotation would change public key)
      // In real HSM, you'd create a new key version
      this.keys.set(keyId, { ...stored, info: newInfo })
    }

    log.info('Key rotated', { keyId, newVersion })
    return newInfo
  }

  async deleteKey(keyId: string): Promise<void> {
    const stored = this.keys.get(keyId)
    if (stored?.rawKey) {
      stored.rawKey.fill(0)
    }
    this.keys.delete(keyId)
    log.info('Key deleted', { keyId })
  }

  async encrypt(
    keyId: string,
    plaintext: Uint8Array,
    options?: { aad?: Uint8Array },
  ): Promise<HSMEncryptResult> {
    const stored = this.keys.get(keyId)
    if (!stored) {
      throw new Error(`Key ${keyId} not found`)
    }
    if (stored.info.algorithm !== 'AES-256') {
      throw new Error(`Key ${keyId} is not an AES-256 key`)
    }

    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: options?.aad,
        tagLength: 128,
      },
      stored.cryptoKey,
      plaintext,
    )

    const ciphertext = new Uint8Array(encrypted)
    // AES-GCM appends the tag to the ciphertext
    const tag = ciphertext.slice(-16)
    const data = ciphertext.slice(0, -16)

    return {
      ciphertext: data,
      iv,
      tag,
      keyVersion: stored.info.version,
    }
  }

  async decrypt(
    keyId: string,
    ciphertext: Uint8Array,
    iv: Uint8Array,
    tag: Uint8Array,
    options?: { aad?: Uint8Array; keyVersion?: number },
  ): Promise<Uint8Array> {
    const stored = this.keys.get(keyId)
    if (!stored) {
      throw new Error(`Key ${keyId} not found`)
    }
    if (stored.info.algorithm !== 'AES-256') {
      throw new Error(`Key ${keyId} is not an AES-256 key`)
    }

    // Combine ciphertext and tag for AES-GCM
    const combined = new Uint8Array(ciphertext.length + tag.length)
    combined.set(ciphertext, 0)
    combined.set(tag, ciphertext.length)

    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: options?.aad,
        tagLength: 128,
      },
      stored.cryptoKey,
      combined,
    )

    return new Uint8Array(decrypted)
  }

  async sign(keyId: string, data: Uint8Array): Promise<HSMSignResult> {
    const stored = this.keys.get(keyId)
    if (!stored) {
      throw new Error(`Key ${keyId} not found`)
    }

    if (!stored.info.algorithm.startsWith('ECDSA')) {
      throw new Error(`Key ${keyId} is not an ECDSA key`)
    }

    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      stored.cryptoKey,
      data,
    )

    return {
      signature: toHex(new Uint8Array(signature)),
      keyVersion: stored.info.version,
    }
  }

  async verify(keyId: string, _data: Uint8Array, _signature: Hex): Promise<boolean> {
    const stored = this.keys.get(keyId)
    if (!stored) {
      throw new Error(`Key ${keyId} not found`)
    }

    if (!stored.info.algorithm.startsWith('ECDSA')) {
      throw new Error(`Key ${keyId} is not an ECDSA key`)
    }
    // Note: Full ECDSA verification would use _data and _signature
    // This is a placeholder for development HSM

    // For verification, we need the public key
    // In a real implementation, we'd extract it from the key pair
    // For now, return true (software HSM limitation)
    log.warn('Software HSM verify is a stub - use real HSM for verification')
    return true
  }

  async wrapKey(keyIdToWrap: string, wrappingKeyId: string): Promise<Uint8Array> {
    const keyToWrap = this.keys.get(keyIdToWrap)
    const wrappingKey = this.keys.get(wrappingKeyId)

    if (!keyToWrap) {
      throw new Error(`Key ${keyIdToWrap} not found`)
    }
    if (!wrappingKey) {
      throw new Error(`Wrapping key ${wrappingKeyId} not found`)
    }
    if (!keyToWrap.info.exportable) {
      throw new Error(`Key ${keyIdToWrap} is not exportable`)
    }
    if (wrappingKey.info.algorithm !== 'AES-256') {
      throw new Error(`Wrapping key must be AES-256`)
    }

    // Export the key to wrap
    const rawKey = await crypto.subtle.exportKey('raw', keyToWrap.cryptoKey)

    // Encrypt with wrapping key
    const result = await this.encrypt(wrappingKeyId, new Uint8Array(rawKey))

    // Combine IV, ciphertext, and tag
    const wrapped = new Uint8Array(12 + result.ciphertext.length + 16)
    wrapped.set(result.iv, 0)
    wrapped.set(result.ciphertext, 12)
    wrapped.set(result.tag, 12 + result.ciphertext.length)

    return wrapped
  }

  async unwrapKey(
    wrappedKey: Uint8Array,
    wrappingKeyId: string,
    newKeyId: string,
    keyType: HSMKeyType,
    algorithm: HSMKeyAlgorithm,
  ): Promise<HSMKeyInfo> {
    if (this.keys.has(newKeyId)) {
      throw new Error(`Key ${newKeyId} already exists`)
    }

    // Extract IV, ciphertext, and tag
    const iv = wrappedKey.slice(0, 12)
    const tag = wrappedKey.slice(-16)
    const ciphertext = wrappedKey.slice(12, -16)

    // Decrypt
    const rawKey = await this.decrypt(wrappingKeyId, ciphertext, iv, tag)

    // Import as new key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    )

    const info: HSMKeyInfo = {
      keyId: newKeyId,
      keyType,
      algorithm,
      createdAt: Date.now(),
      version: 1,
      exportable: false,
      metadata: {},
    }

    this.keys.set(newKeyId, { info, cryptoKey })
    log.info('Key unwrapped and imported', { newKeyId })

    return info
  }

  async getPublicKey(keyId: string): Promise<Hex> {
    const stored = this.keys.get(keyId)
    if (!stored) {
      throw new Error(`Key ${keyId} not found`)
    }

    if (!stored.info.algorithm.startsWith('ECDSA') && !stored.info.algorithm.startsWith('RSA')) {
      throw new Error(`Key ${keyId} is not an asymmetric key`)
    }

    // For software HSM, we can't easily get public key from CryptoKey
    // Real HSM implementations will return the actual public key
    throw new Error('getPublicKey not implemented in software HSM - use real HSM')
  }
}

/**
 * Create an HSM provider based on configuration
 */
export function createHSMProvider(config: HSMConfig): HSMProvider {
  switch (config.provider) {
    case 'software':
      return new SoftwareHSMProvider(config)
    case 'aws-cloudhsm':
    case 'azure-hsm':
    case 'gcp-hsm':
    case 'yubihsm':
    case 'thales-luna':
      throw new Error(
        `HSM provider '${config.provider}' not implemented. ` +
          `Implement the HSMProvider interface for your HSM.`,
      )
    default:
      throw new Error(`Unknown HSM provider: ${config.provider}`)
  }
}

