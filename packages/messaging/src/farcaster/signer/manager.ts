/**
 * Farcaster Signer Manager
 *
 * Manages Ed25519 signers for Farcaster, stored securely in KMS or locally.
 * Signers are delegated from the custody wallet and registered on-chain.
 */

import { randomBytes } from '@noble/ciphers/webcrypto'
import { ed25519 } from '@noble/curves/ed25519'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import type { Hex } from 'viem'
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
  /** File path for file storage */
  storagePath?: string
}

interface StoredSigner {
  info: SignerInfo
  privateKey: Uint8Array
}
export class FarcasterSignerManager {
  private signers: Map<string, StoredSigner> = new Map()
  private readonly storage: 'memory' | 'file'

  constructor(config?: SignerManagerConfig) {
    this.storage = config?.storage ?? 'memory'
  }

  /**
   * Generate a new signer key
   */
  async createSigner(params: {
    fid: number
    appName: string
    appFid?: number
  }): Promise<SignerInfo> {
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
   * Get private key for signing (should only be used internally)
   */
  async getSignerPrivateKey(keyId: string): Promise<Uint8Array | null> {
    const stored = this.signers.get(keyId)
    if (!stored || stored.info.status !== 'active') {
      return null
    }
    return stored.privateKey
  }

  /**
   * Sign a message with a signer
   */
  async sign(keyId: string, message: Uint8Array): Promise<Uint8Array> {
    const stored = this.signers.get(keyId)
    if (!stored) {
      throw new Error(`Signer not found: ${keyId}`)
    }

    if (stored.info.status !== 'active') {
      throw new Error(
        `Signer not active: ${keyId} (status: ${stored.info.status})`,
      )
    }

    return ed25519.sign(message, stored.privateKey)
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
   * List all signers
   */
  async listSigners(): Promise<SignerInfo[]> {
    return Array.from(this.signers.values()).map((s) => s.info)
  }

  /**
   * Export signer for backup.
   *
   * SECURITY WARNING: This method returns the raw private key.
   * - Never log or transmit the returned privateKey
   * - Store exported keys encrypted at rest
   * - Clear memory containing the key after use
   * - Consider using secure key storage (KMS, HSM) in production
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

    console.warn(
      `[SignerManager] SECURITY: Exporting private key for signer ${keyId}. ` +
        `Ensure proper key handling and storage.`,
    )

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

    // File-based persistence would go here
    // In production, use encrypted storage
  }

  async load(): Promise<void> {
    if (this.storage === 'memory') {
      return // Nothing to load
    }

    // File-based loading would go here
  }
}
