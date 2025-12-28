/**
 * KMS Signer - Gateway Application
 *
 * This module re-exports the KMS signer from @jejunetwork/kms.
 * All gateway services should use these exports for signing operations.
 *
 * SECURITY: Private keys are NEVER exposed. All signing uses:
 * - MPC/FROST threshold signing in production
 * - TEE hardware isolation when available
 * - Local dev mode only in development (blocked in production)
 *
 * @deprecated Direct imports from this file will be removed.
 * Import from '@jejunetwork/kms' instead:
 *
 * ```typescript
 * import {
 *   createKMSSigner,
 *   createKMSWalletClient,
 * } from '@jejunetwork/kms'
 * ```
 */

// ═══════════════════════════════════════════════════════════════════════════
//                    RE-EXPORTS FROM @jejunetwork/kms
// ═══════════════════════════════════════════════════════════════════════════

export {
  auditPrivateKeyUsage,
  createKMSClients,
  createKMSSigner,
  createKMSWalletClient,
  createMigrationWalletClient,
  ExtendedKMSWalletClient,
  enforceKMSSigningOnStartup,
  getKMSSigner,
  getKMSSignerAddress,
  type KMSKeyInfo,
  KMSSigner,
  type KMSSignerConfig,
  type KMSWalletClientConfig,
  type KMSWalletClientResult,
  logSecurityAudit,
  type MigrationWalletConfig,
  type MigrationWalletResult,
  type PrivateKeyUsageAudit,
  requiresKMSSigning,
  resetKMSSigners,
  type SigningMode,
  type SignResult,
  type TransactionSignResult,
  validateSecureSigning,
} from '@jejunetwork/kms'

// ═══════════════════════════════════════════════════════════════════════════
//                    LEGACY COMPATIBILITY (DEPRECATED)
// ═══════════════════════════════════════════════════════════════════════════
// These exports maintain backward compatibility with existing gateway code.
// They will be removed in a future version. Migrate to the canonical exports above.

import {
  createKMSSigner,
  getKMSSigner as getCanonicalKMSSigner,
} from '@jejunetwork/kms'
import type { Address, Chain, Hash, Hex, TransactionSerializable } from 'viem'
import { createPublicClient, http } from 'viem'

/**
 * @deprecated Use `createKMSSigner` from '@jejunetwork/kms' instead
 */
export interface SigningRequest {
  messageHash: Hash
  metadata?: Record<string, string>
}

/**
 * @deprecated Use `SignResult` from '@jejunetwork/kms' instead
 */
export interface SigningResult {
  signature: Hex
  signingMode: 'mpc' | 'tee' | 'local-dev'
  publicKey?: Hex
  address?: Address
}

/**
 * @deprecated Use `createKMSSigner` from '@jejunetwork/kms' instead
 */
export interface TransactionSigningRequest {
  transaction: TransactionSerializable
  chain: Chain
}

/**
 * @deprecated Use `TransactionSignResult` from '@jejunetwork/kms' instead
 */
export interface TransactionSigningResult {
  signedTransaction: Hex
  hash: Hash
  signingMode: 'mpc' | 'tee' | 'local-dev'
}

/**
 * @deprecated Use `KMSSignerConfig` from '@jejunetwork/kms' instead
 */
export interface LegacyKMSSignerConfig {
  serviceId: string
  endpoint: string
  allowLocalDev: boolean
  timeoutMs: number
}

/**
 * @deprecated Use `KMSSigner` from '@jejunetwork/kms' instead
 *
 * This class provides backward compatibility with the old KMSSigner API.
 * Internally delegates to the canonical KMSSigner.
 */
export class LegacyKMSSigner {
  private readonly serviceId: string
  private signer: ReturnType<typeof createKMSSigner> | null = null
  private initialized = false

  constructor(serviceId: string, _config?: Partial<LegacyKMSSignerConfig>) {
    this.serviceId = serviceId
    console.warn(
      '[LegacyKMSSigner] DEPRECATED: Use KMSSigner from @jejunetwork/kms instead',
    )
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    this.signer = createKMSSigner({ serviceId: this.serviceId })
    await this.signer.initialize()
    this.initialized = true
  }

  async sign(request: SigningRequest): Promise<SigningResult> {
    if (!this.signer) throw new Error('LegacyKMSSigner not initialized')
    const result = await this.signer.sign(request.messageHash)
    return {
      signature: result.signature,
      signingMode: result.mode,
      address: this.signer.getAddress(),
    }
  }

  async signMessage(message: string | Uint8Array): Promise<SigningResult> {
    if (!this.signer) throw new Error('LegacyKMSSigner not initialized')
    const result = await this.signer.signMessage(message)
    return {
      signature: result.signature,
      signingMode: result.mode,
      address: this.signer.getAddress(),
    }
  }

  async signTransaction(
    request: TransactionSigningRequest,
  ): Promise<TransactionSigningResult> {
    if (!this.signer) throw new Error('LegacyKMSSigner not initialized')
    const result = await this.signer.signTransaction(request.transaction)
    return {
      signedTransaction: result.signedTransaction,
      hash: result.hash,
      signingMode: result.mode,
    }
  }

  /**
   * Sign and send a transaction to the network
   */
  async sendTransaction(
    request: TransactionSigningRequest,
    rpcUrl: string,
  ): Promise<Hash> {
    if (!this.signer) throw new Error('LegacyKMSSigner not initialized')
    const result = await this.signer.signTransaction(request.transaction)

    const publicClient = createPublicClient({
      chain: request.chain,
      transport: http(rpcUrl),
    })

    return publicClient.sendRawTransaction({
      serializedTransaction: result.signedTransaction,
    })
  }

  async getAddress(): Promise<Address> {
    if (!this.signer) throw new Error('LegacyKMSSigner not initialized')
    return this.signer.getAddress()
  }

  async checkHealth(): Promise<{ available: boolean; error?: string }> {
    if (!this.signer) {
      this.signer = createKMSSigner({ serviceId: this.serviceId })
    }
    const health = await this.signer.checkHealth()
    return {
      available: health.healthy,
      error: health.healthy ? undefined : 'KMS service unhealthy',
    }
  }

  getMode(): 'mpc' | 'tee' | 'local-dev' {
    return this.signer?.getMode() ?? 'mpc'
  }

  getServiceId(): string {
    return this.serviceId
  }
}

/**
 * @deprecated Use `getKMSSigner` from '@jejunetwork/kms' instead
 */
export function getLegacyKMSSigner(serviceId: string): LegacyKMSSigner {
  console.warn(
    '[getLegacyKMSSigner] DEPRECATED: Use getKMSSigner from @jejunetwork/kms instead',
  )
  return new LegacyKMSSigner(serviceId)
}

/**
 * @deprecated Use `createKMSSigner(...).sign()` from '@jejunetwork/kms' instead
 */
export async function kmsSig(
  serviceId: string,
  messageHash: Hash,
): Promise<Hex> {
  const signer = getCanonicalKMSSigner(serviceId)
  await signer.initialize()
  const result = await signer.sign(messageHash)
  return result.signature
}

/**
 * @deprecated Use `createKMSSigner(...).getAddress()` from '@jejunetwork/kms' instead
 */
export async function kmsAddress(serviceId: string): Promise<Address> {
  const signer = getCanonicalKMSSigner(serviceId)
  await signer.initialize()
  return signer.getAddress()
}

/**
 * @deprecated Use `createKMSWalletClient` from '@jejunetwork/kms' instead
 */
export async function createKMSAccount(serviceId: string): Promise<{
  address: Address
  signMessage: (args: { message: string | { raw: Hex } }) => Promise<Hex>
  signTransaction: (tx: TransactionSerializable, chain: Chain) => Promise<Hex>
}> {
  console.warn(
    '[createKMSAccount] DEPRECATED: Use createKMSWalletClient from @jejunetwork/kms instead',
  )
  const signer = createKMSSigner({ serviceId })
  await signer.initialize()
  const address = signer.getAddress()

  return {
    address,
    signMessage: async (args) => {
      const message =
        typeof args.message === 'string' ? args.message : args.message.raw
      const result = await signer.signMessage(
        typeof message === 'string'
          ? new TextEncoder().encode(message)
          : (message as Uint8Array),
      )
      return result.signature
    },
    signTransaction: async (tx) => {
      const result = await signer.signTransaction(tx)
      return result.signedTransaction
    },
  }
}
