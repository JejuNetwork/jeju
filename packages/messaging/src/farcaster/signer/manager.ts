/**
 * Farcaster Signer Manager
 *
 * Manages Ed25519 signers for Farcaster, stored securely in KMS or locally.
 * Signers are delegated from the custody wallet and registered on-chain.
 *
 * SECURITY NOTE:
 * For production use, prefer the DWS worker with MPC-backed signers.
 * Local signers store private keys in memory, making them vulnerable
 * to side-channel attacks on TEE enclaves.
 *
 * @see {@link ../dws-worker/index.ts} for the secure MPC-backed implementation
 */

import {
  createLogger,
  decryptAesGcm,
  deriveKeyScrypt,
  encryptAesGcm,
  randomBytes as sharedRandomBytes,
} from '@jejunetwork/shared'
import { randomBytes } from '@noble/ciphers/webcrypto'
import { ed25519 } from '@noble/curves/ed25519'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import type { Hex } from 'viem'

const log = createLogger('signer-manager')

import { enforceNoLocalKeysInProduction, securityAudit } from '../../security'

/**
 * SECURITY WARNING: Local key operations are vulnerable to side-channel attacks.
 * For production security, use MPC-backed signers via the DWS worker.
 */
function warnLocalKeyOperation(operation: string): void {
  // In production, this will throw - local keys not allowed
  enforceNoLocalKeysInProduction(operation)

  log.warn(
    `SECURITY: Local key operation "${operation}" - consider using KMS-backed signer for production`,
  )

  securityAudit.log({
    operation: `farcaster-signer:${operation}`,
    success: true,
    metadata: { mode: 'local', warning: 'local-key-operation' },
  })
}

// Scrypt parameters for file encryption key derivation
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 32
export type SignerStatus = 'pending' | 'active' | 'revoked'

export interface SignerInfo {
  /** Unique key ID */
  keyId: string
  /** Public key as hex */
  publicKey: Hex
  /** FID this signer is for */
  fid: number
  /** App name that created this signer */
  appName: string
  /** App FID (for signed key requests) */
  appFid?: number
  /** Current status */
  status: SignerStatus
  /** Creation timestamp */
  createdAt: number
  /** Approval timestamp (when registered on-chain) */
  approvedAt?: number
  /** Revocation timestamp */
  revokedAt?: number
}

export interface SignerManagerConfig {
  /** Storage backend: 'memory' | 'file' | 'kms' */
  storage?: 'memory' | 'file'
  /** File path for file storage (required if storage is 'file') */
  storagePath?: string
  /** Encryption password for file storage (required if storage is 'file') */
  encryptionPassword?: string
}

interface StoredSigner {
  info: SignerInfo
  privateKey: Uint8Array
}
export class FarcasterSignerManager {
  private signers: Map<string, StoredSigner> = new Map()
  private readonly storage: 'memory' | 'file'
  private readonly storagePath?: string
  private readonly encryptionPassword?: string

  constructor(config?: SignerManagerConfig) {
    this.storage = config?.storage ?? 'memory'
    this.storagePath = config?.storagePath
    this.encryptionPassword = config?.encryptionPassword

    // Validate file storage configuration
    if (this.storage === 'file') {
      if (!this.storagePath) {
        throw new Error('storagePath is required for file storage')
      }
      if (!this.encryptionPassword) {
        throw new Error('encryptionPassword is required for file storage')
      }
    }
  }

  /**
   * Generate a new signer key.
   * For production, consider using the MPC-backed DWS worker for secure signing.
   */
  async createSigner(params: {
    fid: number
    appName: string
    appFid?: number
  }): Promise<SignerInfo> {
    warnLocalKeyOperation('createSigner')

    // Generate Ed25519 key pair
    const privateKey = randomBytes(32)
    const publicKey = ed25519.getPublicKey(privateKey)

    const keyId = `fc-signer-${params.fid}-${Date.now()}`

    const signerInfo: SignerInfo = {
      keyId,
      publicKey: `0x${bytesToHex(publicKey)}` as Hex,
      fid: params.fid,
      appName: params.appName,
      appFid: params.appFid,
      status: 'pending',
      createdAt: Date.now(),
    }

    this.signers.set(keyId, {
      info: signerInfo,
      privateKey,
    })

    await this.persist()

    return signerInfo
  }

  /**
   * Import an existing signer key
   */
  async importSigner(params: {
    fid: number
    privateKey: Uint8Array | Hex
    appName: string
    appFid?: number
    status?: SignerStatus
  }): Promise<SignerInfo> {
    const privateKey =
      typeof params.privateKey === 'string'
        ? hexToBytes(params.privateKey.replace('0x', ''))
        : params.privateKey

    const publicKey = ed25519.getPublicKey(privateKey)
    const keyId = `fc-signer-${params.fid}-${Date.now()}`

    const signerInfo: SignerInfo = {
      keyId,
      publicKey: `0x${bytesToHex(publicKey)}` as Hex,
      fid: params.fid,
      appName: params.appName,
      appFid: params.appFid,
      status: params.status ?? 'active',
      createdAt: Date.now(),
      approvedAt: params.status === 'active' ? Date.now() : undefined,
    }

    this.signers.set(keyId, {
      info: signerInfo,
      privateKey,
    })

    await this.persist()

    return signerInfo
  }

  /**
   * Get signer info by key ID
   */
  async getSigner(keyId: string): Promise<SignerInfo | null> {
    const stored = this.signers.get(keyId)
    return stored?.info ?? null
  }

  /**
   * Get all signers for an FID
   */
  async getSignersForFid(fid: number): Promise<SignerInfo[]> {
    return Array.from(this.signers.values())
      .filter((s) => s.info.fid === fid)
      .map((s) => s.info)
  }

  /**
   * Get active signer for FID (first active one)
   */
  async getActiveSignerForFid(fid: number): Promise<SignerInfo | null> {
    const signers = await this.getSignersForFid(fid)
    return signers.find((s) => s.status === 'active') ?? null
  }

  /**
   * Mark signer as approved (after on-chain registration)
   */
  async markApproved(keyId: string): Promise<void> {
    const stored = this.signers.get(keyId)
    if (!stored) {
      throw new Error(`Signer not found: ${keyId}`)
    }

    stored.info.status = 'active'
    stored.info.approvedAt = Date.now()

    await this.persist()
  }

  /**
   * Revoke a signer
   */
  async revokeSigner(keyId: string): Promise<void> {
    const stored = this.signers.get(keyId)
    if (!stored) {
      throw new Error(`Signer not found: ${keyId}`)
    }

    stored.info.status = 'revoked'
    stored.info.revokedAt = Date.now()

    // Zero out private key
    stored.privateKey.fill(0)

    await this.persist()
  }

  /**
   * Delete a signer completely
   */
  async deleteSigner(keyId: string): Promise<void> {
    const stored = this.signers.get(keyId)
    if (stored) {
      // Zero out private key before deletion
      stored.privateKey.fill(0)
    }

    this.signers.delete(keyId)
    await this.persist()
  }

  /**
   * Get signer public key as bytes
   */
  async getSignerPublicKeyBytes(keyId: string): Promise<Uint8Array> {
    const stored = this.signers.get(keyId)
    if (!stored) {
      throw new Error(`Signer not found: ${keyId}`)
    }

    return hexToBytes(stored.info.publicKey.slice(2))
  }

  /**
   * Sign a message with the signer's private key
   */
  async sign(keyId: string, message: Uint8Array): Promise<Uint8Array> {
    const stored = this.signers.get(keyId)
    if (!stored) {
      throw new Error(`Signer not found: ${keyId}`)
    }

    if (stored.info.status !== 'active') {
      throw new Error(
        `Signer ${keyId} is not active (status: ${stored.info.status})`,
      )
    }

    return ed25519.sign(message, stored.privateKey)
  }

  /**
   * Get signer private key.
   *
   * SECURITY WARNING: This method returns the raw private key.
   * Only use this for legacy integrations that require direct key access.
   * Prefer using the sign() method instead.
   */
  async getSignerPrivateKey(keyId: string): Promise<Hex | null> {
    const stored = this.signers.get(keyId)
    if (!stored) {
      return null
    }

    log.warn('🚨 SECURITY WARNING: Accessing raw private key', {
      keyId,
      warning: 'Prefer using sign() method instead of direct key access',
    })

    return `0x${bytesToHex(stored.privateKey)}` as Hex
  }

  /**
   * List all signers
   */
  async listSigners(): Promise<SignerInfo[]> {
    return Array.from(this.signers.values()).map((s) => s.info)
  }

  /**
   * Export signer for backup.
   *
   * SECURITY WARNING: This method returns the raw private key.
   * - NEVER log or transmit the returned privateKey
   * - Store exported keys encrypted at rest
   * - Clear memory containing the key IMMEDIATELY after use
   */
  async exportSigner(keyId: string): Promise<{
    publicKey: Hex
    privateKey: Hex
    fid: number
    appName: string
  }> {
    const stored = this.signers.get(keyId)
    if (!stored) {
      throw new Error(`Signer not found: ${keyId}`)
    }

    log.warn('🚨 CRITICAL SECURITY WARNING: Exporting private key', {
      keyId,
      warning:
        'Private key exposure - use MPC-backed DWS worker for production',
    })

    return {
      publicKey: stored.info.publicKey,
      privateKey: `0x${bytesToHex(stored.privateKey)}` as Hex,
      fid: stored.info.fid,
      appName: stored.info.appName,
    }
  }
  private async persist(): Promise<void> {
    if (this.storage === 'memory') {
      return // No persistence needed
    }

    if (!this.storagePath || !this.encryptionPassword) {
      throw new Error('File storage not properly configured')
    }

    // Serialize signers to JSON
    const signersData: Array<{
      info: SignerInfo
      privateKey: string // hex-encoded
    }> = []

    for (const [, stored] of this.signers) {
      signersData.push({
        info: stored.info,
        privateKey: bytesToHex(stored.privateKey),
      })
    }

    const plaintext = new TextEncoder().encode(JSON.stringify(signersData))

    // Generate salt for key derivation
    const salt = sharedRandomBytes(32)

    // Derive encryption key from password
    const encryptionKey = await deriveKeyScrypt(this.encryptionPassword, salt, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      dkLen: SCRYPT_KEYLEN,
    })

    // Encrypt the data
    const { ciphertext, iv, tag } = await encryptAesGcm(
      plaintext,
      encryptionKey,
    )

    // Combine: salt (32) + iv (12) + tag (16) + ciphertext
    const combined = new Uint8Array(
      salt.length + iv.length + tag.length + ciphertext.length,
    )
    let offset = 0
    combined.set(salt, offset)
    offset += salt.length
    combined.set(iv, offset)
    offset += iv.length
    combined.set(tag, offset)
    offset += tag.length
    combined.set(ciphertext, offset)

    // Write to file
    await Bun.write(this.storagePath, combined)

    log.debug('Persisted signers to file', { path: this.storagePath })
  }

  async load(): Promise<void> {
    if (this.storage === 'memory') {
      return // Nothing to load
    }

    if (!this.storagePath || !this.encryptionPassword) {
      throw new Error('File storage not properly configured')
    }

    const file = Bun.file(this.storagePath)
    if (!(await file.exists())) {
      log.debug('No existing signer file found', { path: this.storagePath })
      return
    }

    const combined = new Uint8Array(await file.arrayBuffer())

    // Parse: salt (32) + iv (12) + tag (16) + ciphertext
    const salt = combined.subarray(0, 32)
    const iv = combined.subarray(32, 44)
    const tag = combined.subarray(44, 60)
    const ciphertext = combined.subarray(60)

    // Derive decryption key from password
    const decryptionKey = await deriveKeyScrypt(this.encryptionPassword, salt, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      dkLen: SCRYPT_KEYLEN,
    })

    // Decrypt the data
    const plaintext = await decryptAesGcm(ciphertext, decryptionKey, iv, tag)
    const signersData: Array<{
      info: SignerInfo
      privateKey: string
    }> = JSON.parse(new TextDecoder().decode(plaintext))

    // Load signers into memory
    for (const data of signersData) {
      this.signers.set(data.info.keyId, {
        info: data.info,
        privateKey: hexToBytes(data.privateKey),
      })
    }

    log.info('Loaded signers from file', {
      path: this.storagePath,
      count: this.signers.size,
    })
  }
}
