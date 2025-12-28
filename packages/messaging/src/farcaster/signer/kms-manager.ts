/**
 * KMS-Backed Farcaster Signer Manager
 *
 * Manages Ed25519 signers for Farcaster using MPC/KMS infrastructure.
 * Private keys NEVER exist in application memory - they remain as
 * threshold shares across secure enclaves.
 *
 * SECURITY PROPERTIES:
 * - Private keys never leave the KMS
 * - Signing happens inside secure enclaves
 * - Threshold cryptography prevents single point of compromise
 * - Protected against TEE side-channel attacks
 */

import { createLogger } from '@jejunetwork/shared'
import { hexToBytes } from '@noble/hashes/utils'
import type { Address, Hex } from 'viem'

const log = createLogger('kms-signer-manager')

/**
 * KMS Signer Interface
 *
 * Represents a signer where the private key exists only inside
 * the KMS as threshold shares.
 */
export interface KMSFarcasterSigner {
  /** Unique signer ID */
  signerId: string
  /** Key ID in the KMS */
  keyId: string
  /** Public key (safe to expose) */
  publicKey: Hex
  /** MPC group address (for authentication) */
  groupAddress: Address
  /** FID this signer is for */
  fid: number
  /** App that created this signer */
  appName: string
  /** Signer status */
  status: 'pending' | 'active' | 'revoked'
  /** Creation timestamp */
  createdAt: number
  /** Approval timestamp */
  approvedAt?: number
}

/**
 * KMS Provider Interface
 *
 * The KMS provider handles all cryptographic operations.
 * Must be implemented by the actual KMS integration.
 */
export interface KMSProvider {
  /**
   * Generate a new Ed25519 key in the KMS.
   * Returns the key ID and public key - private key never exposed.
   */
  generateKey(params: {
    keyId: string
    keyType: 'ed25519'
    owner: Address
  }): Promise<{
    keyId: string
    publicKey: Hex
    groupAddress: Address
  }>

  /**
   * Sign a message using a key in the KMS.
   * The private key never leaves the secure enclave.
   */
  sign(params: { keyId: string; message: Uint8Array }): Promise<{
    signature: Uint8Array
    signedAt: number
  }>

  /**
   * Revoke a key in the KMS.
   */
  revokeKey(keyId: string): Promise<void>

  /**
   * Check if a key exists in the KMS.
   */
  keyExists(keyId: string): Promise<boolean>
}

/**
 * Configuration for KMS Signer Manager
 */
export interface KMSSignerManagerConfig {
  /** KMS provider implementation */
  kmsProvider: KMSProvider
  /** Optional callback for signer events */
  onSignerEvent?: (event: SignerEvent) => void
}

export type SignerEvent =
  | { type: 'created'; signer: KMSFarcasterSigner }
  | { type: 'approved'; signer: KMSFarcasterSigner }
  | { type: 'revoked'; signer: KMSFarcasterSigner }

/**
 * KMS-Backed Farcaster Signer Manager
 *
 * This manager stores only metadata about signers.
 * All cryptographic operations are delegated to the KMS.
 */
export class KMSFarcasterSignerManager {
  private readonly kmsProvider: KMSProvider
  private readonly onSignerEvent?: (event: SignerEvent) => void

  // Signer metadata (no private keys!)
  private signers = new Map<string, KMSFarcasterSigner>()
  private fidSigners = new Map<number, string[]>()

  constructor(config: KMSSignerManagerConfig) {
    this.kmsProvider = config.kmsProvider
    this.onSignerEvent = config.onSignerEvent

    log.info('KMS Signer Manager initialized - private keys protected in KMS')
  }

  /**
   * Create a new signer in the KMS.
   *
   * The private key is generated inside the KMS and never exposed.
   * Only the public key is returned.
   */
  async createSigner(params: {
    fid: number
    appName: string
    ownerAddress: Address
    appFid?: number
  }): Promise<KMSFarcasterSigner> {
    const signerId = crypto.randomUUID()
    const keyId = `farcaster:${params.fid}:${signerId}`

    log.info('Creating KMS-backed signer', {
      fid: params.fid,
      appName: params.appName,
    })

    // Generate key in KMS - private key never exposed
    const kmsResult = await this.kmsProvider.generateKey({
      keyId,
      keyType: 'ed25519',
      owner: params.ownerAddress,
    })

    const signer: KMSFarcasterSigner = {
      signerId,
      keyId: kmsResult.keyId,
      publicKey: kmsResult.publicKey,
      groupAddress: kmsResult.groupAddress,
      fid: params.fid,
      appName: params.appName,
      status: 'pending',
      createdAt: Date.now(),
    }

    this.signers.set(signerId, signer)

    // Track by FID
    const existing = this.fidSigners.get(params.fid) ?? []
    existing.push(signerId)
    this.fidSigners.set(params.fid, existing)

    this.onSignerEvent?.({ type: 'created', signer })

    log.info('Created KMS-backed signer', {
      signerId,
      publicKey: `${signer.publicKey.slice(0, 20)}...`,
    })

    return signer
  }

  /**
   * Sign a message using a signer.
   *
   * The signing happens inside the KMS - private key never exposed.
   */
  async sign(signerId: string, message: Uint8Array): Promise<Uint8Array> {
    const signer = this.signers.get(signerId)
    if (!signer) {
      throw new Error(`Signer not found: ${signerId}`)
    }

    if (signer.status !== 'active') {
      throw new Error(
        `Signer not active: ${signerId} (status: ${signer.status})`,
      )
    }

    // Delegate to KMS - private key never leaves secure enclave
    const result = await this.kmsProvider.sign({
      keyId: signer.keyId,
      message,
    })

    return result.signature
  }

  /**
   * Get signer by ID
   */
  getSigner(signerId: string): KMSFarcasterSigner | null {
    return this.signers.get(signerId) ?? null
  }

  /**
   * Get all signers for an FID
   */
  getSignersForFid(fid: number): KMSFarcasterSigner[] {
    const signerIds = this.fidSigners.get(fid) ?? []
    return signerIds
      .map((id) => this.signers.get(id))
      .filter((s): s is KMSFarcasterSigner => s !== undefined)
  }

  /**
   * Get active signer for FID
   */
  getActiveSignerForFid(fid: number): KMSFarcasterSigner | null {
    const signers = this.getSignersForFid(fid)
    return signers.find((s) => s.status === 'active') ?? null
  }

  /**
   * Mark signer as approved (after on-chain registration)
   */
  async markApproved(signerId: string): Promise<void> {
    const signer = this.signers.get(signerId)
    if (!signer) {
      throw new Error(`Signer not found: ${signerId}`)
    }

    signer.status = 'active'
    signer.approvedAt = Date.now()

    this.onSignerEvent?.({ type: 'approved', signer })

    log.info('Signer approved', { signerId })
  }

  /**
   * Revoke a signer
   */
  async revokeSigner(signerId: string): Promise<void> {
    const signer = this.signers.get(signerId)
    if (!signer) {
      throw new Error(`Signer not found: ${signerId}`)
    }

    // Revoke in KMS
    await this.kmsProvider.revokeKey(signer.keyId)

    signer.status = 'revoked'

    this.onSignerEvent?.({ type: 'revoked', signer })

    log.info('Signer revoked', { signerId })
  }

  /**
   * Get signer public key as bytes
   */
  getSignerPublicKeyBytes(signerId: string): Uint8Array {
    const signer = this.signers.get(signerId)
    if (!signer) {
      throw new Error(`Signer not found: ${signerId}`)
    }

    return hexToBytes(signer.publicKey.slice(2))
  }

  /**
   * List all signers
   */
  listSigners(): KMSFarcasterSigner[] {
    return Array.from(this.signers.values())
  }

  /**
   * Generate Warpcast approval link
   */
  generateApprovalLink(signerId: string): string {
    const signer = this.signers.get(signerId)
    if (!signer) {
      throw new Error(`Signer not found: ${signerId}`)
    }

    const encodedKey = encodeURIComponent(signer.publicKey)
    return `https://warpcast.com/~/add-signer?publicKey=${encodedKey}`
  }

  /**
   * Get manager stats
   */
  getStats(): {
    totalSigners: number
    activeSigners: number
    pendingSigners: number
    revokedSigners: number
  } {
    const signers = Array.from(this.signers.values())
    return {
      totalSigners: signers.length,
      activeSigners: signers.filter((s) => s.status === 'active').length,
      pendingSigners: signers.filter((s) => s.status === 'pending').length,
      revokedSigners: signers.filter((s) => s.status === 'revoked').length,
    }
  }
}

/**
 * Create a KMS-backed signer manager.
 *
 * This is the recommended way to manage Farcaster signers in production.
 * Private keys never exist in application memory.
 */
export function createKMSSignerManager(
  config: KMSSignerManagerConfig,
): KMSFarcasterSignerManager {
  return new KMSFarcasterSignerManager(config)
}

/**
 * MPC KMS Provider Implementation
 *
 * Connects to the Jeju MPC infrastructure for threshold key management.
 */
export class MPCKMSProvider implements KMSProvider {
  private readonly endpoint: string
  private readonly apiKey?: string
  private readonly timeoutMs: number

  constructor(config: {
    endpoint: string
    apiKey?: string
    timeoutMs?: number
  }) {
    this.endpoint = config.endpoint
    this.apiKey = config.apiKey
    this.timeoutMs = config.timeoutMs ?? 10000
  }

  async generateKey(params: {
    keyId: string
    keyType: 'ed25519'
    owner: Address
  }): Promise<{
    keyId: string
    publicKey: Hex
    groupAddress: Address
  }> {
    const response = await this.fetchWithTimeout(`${this.endpoint}/keys`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        keyId: params.keyId,
        keyType: params.keyType,
        owner: params.owner,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(
        `KMS key generation failed: ${response.status} - ${error}`,
      )
    }

    const result = (await response.json()) as {
      keyId: string
      publicKey: Hex
      groupAddress: Address
    }

    return result
  }

  async sign(params: { keyId: string; message: Uint8Array }): Promise<{
    signature: Uint8Array
    signedAt: number
  }> {
    const response = await this.fetchWithTimeout(`${this.endpoint}/sign`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        keyId: params.keyId,
        message: Buffer.from(params.message).toString('base64'),
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`KMS signing failed: ${response.status} - ${error}`)
    }

    const result = (await response.json()) as {
      signature: string
      signedAt: number
    }

    return {
      signature: Buffer.from(result.signature, 'base64'),
      signedAt: result.signedAt,
    }
  }

  async revokeKey(keyId: string): Promise<void> {
    const response = await this.fetchWithTimeout(
      `${this.endpoint}/keys/${encodeURIComponent(keyId)}`,
      {
        method: 'DELETE',
        headers: this.getHeaders(),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(
        `KMS key revocation failed: ${response.status} - ${error}`,
      )
    }
  }

  async keyExists(keyId: string): Promise<boolean> {
    const response = await this.fetchWithTimeout(
      `${this.endpoint}/keys/${encodeURIComponent(keyId)}`,
      {
        method: 'HEAD',
        headers: this.getHeaders(),
      },
    )

    return response.ok
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }
    return headers
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
