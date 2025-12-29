/**
 * Unified KMS Signing Service for Farcaster
 *
 * This service provides a single interface for all Farcaster KMS operations,
 * making it easy to use secure signing across all Farcaster components.
 *
 * SECURITY PROPERTIES:
 * - Private keys NEVER exist in application memory
 * - All signing happens inside secure KMS enclaves
 * - Threshold cryptography (MPC) prevents single point of compromise
 * - Protected against TEE side-channel attacks
 *
 * Usage:
 * ```typescript
 * const kmsService = await createFarcasterKMSService({
 *   endpoint: 'https://kms.jejunetwork.org',
 *   apiKey: process.env.KMS_API_KEY,
 * })
 *
 * // Create a signer for a user
 * const signer = await kmsService.createSigner({
 *   fid: 12345,
 *   appName: 'MyApp',
 *   ownerAddress: '0x...',
 * })
 *
 * // Get a poster that uses KMS signing
 * const poster = kmsService.getPoster(signer, {
 *   hubUrl: 'https://hub.example.com',
 * })
 *
 * // Post with secure signing
 * await poster.cast('Hello from KMS!')
 * ```
 */

import { createLogger } from '@jejunetwork/shared'
import type { Address } from 'viem'

import {
  createKMSDirectCastClient,
  type DCKMSEncryptionProvider,
  type DCKMSSigner,
  type KMSDirectCastClient,
} from './dc/kms-client'
import {
  createKMSPoster,
  type KMSFarcasterPoster,
  type KMSPosterSigner,
  RemoteKMSPosterSigner,
} from './hub/kms-poster'
import {
  createKMSSignerManager,
  type KMSFarcasterSigner,
  type KMSFarcasterSignerManager,
  type KMSProvider,
  MPCKMSProvider,
} from './signer/kms-manager'

const log = createLogger('farcaster-kms-service')

/**
 * KMS Service Configuration
 */
export interface FarcasterKMSServiceConfig {
  /** KMS endpoint URL */
  endpoint: string
  /** API key for authentication */
  apiKey?: string
  /** Request timeout in ms */
  timeoutMs?: number
}

/**
 * Unified Farcaster KMS Service
 *
 * Provides a centralized interface for all KMS-backed Farcaster operations.
 */
export class FarcasterKMSService {
  private readonly kmsProvider: KMSProvider
  private readonly signerManager: KMSFarcasterSignerManager
  private readonly config: FarcasterKMSServiceConfig

  constructor(config: FarcasterKMSServiceConfig) {
    this.config = config

    // Create MPC KMS provider
    this.kmsProvider = new MPCKMSProvider({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
    })

    // Create signer manager
    this.signerManager = createKMSSignerManager({
      kmsProvider: this.kmsProvider,
    })

    log.info('Farcaster KMS Service initialized', {
      endpoint: config.endpoint,
    })
  }

  /**
   * Create a new Farcaster signer in the KMS.
   *
   * The private key is generated inside the KMS and never exposed.
   */
  async createSigner(params: {
    fid: number
    appName: string
    ownerAddress: Address
    appFid?: number
  }): Promise<KMSFarcasterSigner> {
    return this.signerManager.createSigner(params)
  }

  /**
   * Get an existing signer by ID.
   */
  getSigner(signerId: string): KMSFarcasterSigner | null {
    return this.signerManager.getSigner(signerId)
  }

  /**
   * Get all signers for an FID.
   */
  getSignersForFid(fid: number): KMSFarcasterSigner[] {
    return this.signerManager.getSignersForFid(fid)
  }

  /**
   * Get the active signer for an FID.
   */
  getActiveSignerForFid(fid: number): KMSFarcasterSigner | null {
    return this.signerManager.getActiveSignerForFid(fid)
  }

  /**
   * Sign a message using a signer.
   */
  async sign(signerId: string, message: Uint8Array): Promise<Uint8Array> {
    return this.signerManager.sign(signerId, message)
  }

  /**
   * Mark a signer as approved (after on-chain registration).
   */
  async markSignerApproved(signerId: string): Promise<void> {
    return this.signerManager.markApproved(signerId)
  }

  /**
   * Revoke a signer.
   */
  async revokeSigner(signerId: string): Promise<void> {
    return this.signerManager.revokeSigner(signerId)
  }

  /**
   * Generate Warpcast approval link for a signer.
   */
  generateApprovalLink(signerId: string): string {
    return this.signerManager.generateApprovalLink(signerId)
  }

  /**
   * Get a KMS-backed poster for a signer.
   *
   * The poster will use the signer's key for all signing operations,
   * with the private key never leaving the KMS.
   */
  getPoster(
    signer: KMSFarcasterSigner,
    options: {
      hubUrl: string
      fallbackHubUrls?: string[]
      network?: 'mainnet' | 'testnet' | 'devnet'
      timeoutMs?: number
    },
  ): KMSFarcasterPoster {
    // Create a poster signer that delegates to our KMS
    const posterSigner = this.createPosterSigner(signer)

    return createKMSPoster({
      fid: signer.fid,
      kmsSigner: posterSigner,
      hubUrl: options.hubUrl,
      fallbackHubUrls: options.fallbackHubUrls,
      network: options.network,
      timeoutMs: options.timeoutMs,
    })
  }

  /**
   * Get a KMS-backed Direct Cast client for a signer.
   *
   * Both signing and encryption are done inside the KMS.
   */
  async getDCClient(
    signer: KMSFarcasterSigner,
    options: {
      hubUrl: string
      relayUrl?: string
      persistenceEnabled?: boolean
      persistencePath?: string
    },
  ): Promise<KMSDirectCastClient> {
    // Create KMS-backed signer and encryption provider
    const dcSigner = this.createDCSigner(signer)
    const dcEncryption = await this.createDCEncryption(signer)

    return createKMSDirectCastClient({
      fid: signer.fid,
      kmsSigner: dcSigner,
      kmsEncryption: dcEncryption,
      hubUrl: options.hubUrl,
      relayUrl: options.relayUrl,
      persistenceEnabled: options.persistenceEnabled,
      persistencePath: options.persistencePath,
    })
  }

  /**
   * Create a poster signer that delegates to the KMS.
   */
  private createPosterSigner(signer: KMSFarcasterSigner): KMSPosterSigner {
    const publicKeyBytes = Buffer.from(signer.publicKey.slice(2), 'hex')

    return new RemoteKMSPosterSigner({
      endpoint: this.config.endpoint,
      keyId: signer.keyId,
      publicKey: publicKeyBytes,
      apiKey: this.config.apiKey,
      timeoutMs: this.config.timeoutMs,
    })
  }

  /**
   * Create a DC signer that delegates to the KMS.
   */
  private createDCSigner(signer: KMSFarcasterSigner): DCKMSSigner {
    const publicKeyBytes = Buffer.from(signer.publicKey.slice(2), 'hex')

    return {
      keyId: signer.keyId,
      publicKey: publicKeyBytes,
      sign: async (message: Uint8Array): Promise<Uint8Array> => {
        return this.signerManager.sign(signer.signerId, message)
      },
    }
  }

  /**
   * Create a DC encryption provider that delegates to the KMS.
   */
  private async createDCEncryption(
    signer: KMSFarcasterSigner,
  ): Promise<DCKMSEncryptionProvider> {
    // Derive encryption key ID from signer
    const encryptionKeyId = `${signer.keyId}:encryption`

    // Request encryption key from KMS
    const response = await fetch(`${this.config.endpoint}/keys/derive`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        parentKeyId: signer.keyId,
        derivedKeyId: encryptionKeyId,
        keyType: 'x25519',
        purpose: 'dc-encryption',
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to derive encryption key: ${response.status}`)
    }

    const result = (await response.json()) as {
      keyId: string
      publicKey: string
    }

    const publicKeyBytes = Buffer.from(result.publicKey, 'base64')

    return {
      keyId: result.keyId,
      publicKey: publicKeyBytes,

      encrypt: async (
        plaintext: Uint8Array,
        recipientPublicKey: Uint8Array,
      ): Promise<{
        ciphertext: Uint8Array
        nonce: Uint8Array
        ephemeralPublicKey: Uint8Array
      }> => {
        const encResponse = await fetch(`${this.config.endpoint}/encrypt`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            keyId: result.keyId,
            plaintext: Buffer.from(plaintext).toString('base64'),
            recipientPublicKey:
              Buffer.from(recipientPublicKey).toString('base64'),
          }),
        })

        if (!encResponse.ok) {
          throw new Error(`KMS encryption failed: ${encResponse.status}`)
        }

        const encResult = (await encResponse.json()) as {
          ciphertext: string
          nonce: string
          ephemeralPublicKey: string
        }

        return {
          ciphertext: Buffer.from(encResult.ciphertext, 'base64'),
          nonce: Buffer.from(encResult.nonce, 'base64'),
          ephemeralPublicKey: Buffer.from(
            encResult.ephemeralPublicKey,
            'base64',
          ),
        }
      },

      decrypt: async (
        ciphertext: Uint8Array,
        nonce: Uint8Array,
        ephemeralPublicKey: Uint8Array,
      ): Promise<Uint8Array> => {
        const decResponse = await fetch(`${this.config.endpoint}/decrypt`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            keyId: result.keyId,
            ciphertext: Buffer.from(ciphertext).toString('base64'),
            nonce: Buffer.from(nonce).toString('base64'),
            ephemeralPublicKey:
              Buffer.from(ephemeralPublicKey).toString('base64'),
          }),
        })

        if (!decResponse.ok) {
          throw new Error(`KMS decryption failed: ${decResponse.status}`)
        }

        const decResult = (await decResponse.json()) as { plaintext: string }
        return Buffer.from(decResult.plaintext, 'base64')
      },
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`
    }
    return headers
  }

  /**
   * Get service stats
   */
  getStats(): {
    signers: {
      total: number
      active: number
      pending: number
      revoked: number
    }
  } {
    const stats = this.signerManager.getStats()
    return {
      signers: {
        total: stats.totalSigners,
        active: stats.activeSigners,
        pending: stats.pendingSigners,
        revoked: stats.revokedSigners,
      },
    }
  }
}

/**
 * Create a Farcaster KMS Service.
 *
 * This is the recommended entry point for production Farcaster integrations.
 * All cryptographic operations are delegated to the KMS.
 */
export function createFarcasterKMSService(
  config: FarcasterKMSServiceConfig,
): FarcasterKMSService {
  return new FarcasterKMSService(config)
}

// Export types for convenience
export type {
  DCKMSEncryptionProvider,
  DCKMSSigner,
  KMSDCClientConfig,
} from './dc/kms-client'
export type {
  KMSPosterConfig,
  KMSPosterSigner,
  PostedCast,
  ReactionTarget,
  UserDataUpdate,
} from './hub/kms-poster'
export type {
  KMSFarcasterSigner,
  KMSProvider,
  KMSSignerManagerConfig,
  SignerEvent,
} from './signer/kms-manager'
