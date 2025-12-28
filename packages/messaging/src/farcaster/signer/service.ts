/**
 * Farcaster Signer Service
 *
 * High-level service for managing Farcaster signers.
 * Combines signer manager and registration for a complete workflow.
 */

import type { Address, Hex, WalletClient } from 'viem'
import { hexToBytes } from '@noble/hashes/utils'
import { optimism } from 'viem/chains'
import { FarcasterPoster } from '../hub/poster'
import { FarcasterSignerManager, type SignerInfo } from './manager'
import { generateDeadline, SignerRegistration } from './registration'
export interface SignerServiceConfig {
  /** RPC URL for Optimism */
  rpcUrl?: string
  /** Hub URL for posting */
  hubUrl?: string
  /** Storage configuration */
  storage?: 'memory' | 'file'
  storagePath?: string
}

export interface CreateSignerResult {
  signer: SignerInfo
  approvalLink: string
  transaction?: { to: Address; data: Hex }
}

export interface SignerWithPoster {
  signer: SignerInfo
  poster: FarcasterPoster
}
export class FarcasterSignerService {
  private manager: FarcasterSignerManager
  private registration: SignerRegistration
  private hubUrl: string

  constructor(config?: SignerServiceConfig) {
    this.manager = new FarcasterSignerManager({
      storage: config?.storage ?? 'memory',
      storagePath: config?.storagePath,
    })
    this.registration = new SignerRegistration({
      rpcUrl: config?.rpcUrl,
    })
    this.hubUrl = config?.hubUrl ?? 'https://nemes.farcaster.xyz:2281'
  }

  /**
   * Create a new signer and get approval link
   *
   * @param params.fid - User's Farcaster ID
   * @param params.appName - Name of the app creating the signer
   * @param params.appFid - Optional app FID for signed key request flow
   * @param params.signedKeyRequestSignature - Required if appFid is provided. EIP-712 signature from the app's wallet.
   * @param params.deadline - Optional deadline for signed key request (defaults to 24h from now)
   */
  async createSigner(params: {
    fid: number
    appName: string
    appFid?: number
    signedKeyRequestSignature?: Hex
    deadline?: number
  }): Promise<CreateSignerResult> {
    // Create signer
    const signer = await this.manager.createSigner({
      fid: params.fid,
      appName: params.appName,
      appFid: params.appFid,
    })

    // Generate approval link
    let approvalLink: string
    let transaction: { to: Address; data: Hex } | undefined

    if (params.appFid) {
      // Signed key request flow requires a signature from the app's wallet
      if (!params.signedKeyRequestSignature) {
        throw new Error(
          'signedKeyRequestSignature is required when using appFid. ' +
            'Sign the key request payload using EIP-712 with your app wallet.',
        )
      }

      const deadline = params.deadline ?? generateDeadline(24)

      approvalLink = this.registration.generateWarpcastApprovalLink({
        publicKey: signer.publicKey,
        deadline,
        signature: params.signedKeyRequestSignature,
        requestFid: params.appFid,
      })

      // Also provide the transaction for on-chain submission
      transaction = this.registration.buildAddSignerTx({
        publicKey: signer.publicKey,
      })
    } else {
      // Simple approval link - user signs in Warpcast
      approvalLink = this.registration.generateSimpleApprovalLink(
        signer.publicKey,
      )
    }

    return { signer, approvalLink, transaction }
  }

  /**
   * Get signer for posting
   */
  async getSignerForPosting(fid: number): Promise<{
    sign: (message: Uint8Array) => Promise<Uint8Array>
    publicKey: Uint8Array
  } | null> {
    const signer = await this.manager.getActiveSignerForFid(fid)
    if (!signer) return null

    const publicKeyBytes = await this.manager.getSignerPublicKeyBytes(
      signer.keyId,
    )

    return {
      sign: (message) => this.manager.sign(signer.keyId, message),
      publicKey: publicKeyBytes,
    }
  }

  /**
   * Get a FarcasterPoster for an FID
   */
  async getPoster(
    fid: number,
    network?: 'mainnet' | 'testnet',
  ): Promise<FarcasterPoster | null> {
    const signer = await this.manager.getActiveSignerForFid(fid)
    if (!signer) return null

    const privateKeyHex = await this.manager.getSignerPrivateKey(signer.keyId)
    if (!privateKeyHex) return null

    // Convert hex to Uint8Array
    const privateKey = hexToBytes(privateKeyHex.slice(2))

    return new FarcasterPoster({
      fid,
      signerPrivateKey: privateKey,
      hubUrl: this.hubUrl,
      network,
    })
  }

  /**
   * Check and update signer status from chain
   */
  async syncSignerStatus(keyId: string): Promise<SignerInfo> {
    const signer = await this.manager.getSigner(keyId)
    if (!signer) {
      throw new Error(`Signer not found: ${keyId}`)
    }

    const isRegistered = await this.registration.isSignerRegistered(
      signer.fid,
      signer.publicKey,
    )

    if (isRegistered && signer.status === 'pending') {
      await this.manager.markApproved(keyId)
      return { ...signer, status: 'active', approvedAt: Date.now() }
    }

    return signer
  }

  /**
   * Revoke a signer (removes from manager and chain)
   */
  async revokeSigner(keyId: string, wallet: WalletClient): Promise<Hex> {
    const signer = await this.manager.getSigner(keyId)
    if (!signer) {
      throw new Error(`Signer not found: ${keyId}`)
    }

    // Build and send revoke transaction
    const tx = this.registration.buildRemoveSignerTx(signer.publicKey)

    if (!wallet.account) {
      throw new Error('Wallet client must have an account')
    }

    const hash = await wallet.sendTransaction({
      account: wallet.account,
      chain: optimism,
      to: tx.to,
      data: tx.data,
    })

    // Mark as revoked in manager
    await this.manager.revokeSigner(keyId)

    return hash
  }

  /**
   * List all signers for FID
   */
  async listSigners(fid: number): Promise<SignerInfo[]> {
    return this.manager.getSignersForFid(fid)
  }

  /**
   * Get signer by key ID
   */
  async getSigner(keyId: string): Promise<SignerInfo | null> {
    return this.manager.getSigner(keyId)
  }

  /**
   * Import an existing signer
   */
  async importSigner(params: {
    fid: number
    privateKey: Uint8Array | Hex
    appName: string
    checkOnChain?: boolean
  }): Promise<SignerInfo> {
    const signer = await this.manager.importSigner({
      fid: params.fid,
      privateKey: params.privateKey,
      appName: params.appName,
      status: 'pending',
    })

    // Check on-chain status if requested
    if (params.checkOnChain) {
      const isRegistered = await this.registration.isSignerRegistered(
        params.fid,
        signer.publicKey,
      )

      if (isRegistered) {
        await this.manager.markApproved(signer.keyId)
        return { ...signer, status: 'active', approvedAt: Date.now() }
      }
    }

    return signer
  }

  /**
   * Get FID for an address
   */
  async getFidForAddress(address: Address): Promise<number | null> {
    return this.registration.getFidForAddress(address)
  }

  /**
   * Check if address has an FID
   */
  async hasFid(address: Address): Promise<boolean> {
    const fid = await this.getFidForAddress(address)
    return fid !== null
  }

  /**
   * Export signer for backup
   */
  async exportSigner(keyId: string): Promise<{
    publicKey: Hex
    privateKey: Hex
    fid: number
    appName: string
  }> {
    return this.manager.exportSigner(keyId)
  }
}
