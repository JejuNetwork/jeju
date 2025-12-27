/**
 * KMS Signer Abstraction
 *
 * SECURITY: This module provides a signing abstraction that NEVER exposes
 * private keys in memory. All signing operations use one of:
 *
 * 1. MPC/FROST threshold signing (production) - key never reconstructed
 * 2. Remote TEE signing (production) - key isolated in hardware enclave
 * 3. Local encrypted signing (development only)
 *
 * Gateway services MUST use this module instead of privateKeyToAccount().
 */

import { getEnv, getEnvBoolean } from '@jejunetwork/shared'
import type { Address, Chain, Hash, Hex, TransactionSerializable } from 'viem'
import {
  createPublicClient,
  http,
  keccak256,
  serializeTransaction,
  toHex,
} from 'viem'

// ============================================================================
// Types
// ============================================================================

export interface SigningRequest {
  /** Message hash to sign (32 bytes) */
  messageHash: Hash
  /** Optional metadata for audit logging */
  metadata?: Record<string, string>
}

export interface SigningResult {
  signature: Hex
  signingMode: 'mpc' | 'tee' | 'local-dev'
  /** Public key of signer (if available) */
  publicKey?: Hex
  /** Address derived from public key */
  address?: Address
}

export interface TransactionSigningRequest {
  /** Unsigned transaction to sign */
  transaction: TransactionSerializable
  /** Chain for the transaction */
  chain: Chain
}

export interface TransactionSigningResult {
  /** Signed transaction ready for broadcast */
  signedTransaction: Hex
  /** Transaction hash */
  hash: Hash
  signingMode: 'mpc' | 'tee' | 'local-dev'
}

export interface KMSSignerConfig {
  /** Service identifier for key lookup */
  serviceId: string
  /** KMS API endpoint */
  endpoint: string
  /** Whether to allow local dev mode (NEVER in production) */
  allowLocalDev: boolean
  /** Timeout for signing requests */
  timeoutMs: number
}

// ============================================================================
// Signing Modes
// ============================================================================

type SigningMode = 'mpc' | 'tee' | 'local-dev'

function getSigningMode(): SigningMode {
  const mode = getEnv('KMS_SIGNING_MODE')
  if (mode === 'mpc' || mode === 'tee') return mode

  const isProduction = getEnv('NODE_ENV') === 'production'
  if (isProduction) {
    // In production, require explicit MPC or TEE configuration
    if (getEnv('MPC_CLUSTER_ENDPOINTS')) return 'mpc'
    if (getEnv('TEE_ENDPOINT')) return 'tee'
    throw new Error(
      'Production requires KMS_SIGNING_MODE=mpc or KMS_SIGNING_MODE=tee. ' +
        'Set MPC_CLUSTER_ENDPOINTS or TEE_ENDPOINT.',
    )
  }

  // Development fallback (local encrypted mode)
  return 'local-dev'
}

// ============================================================================
// KMS Signer Class
// ============================================================================

/**
 * KMS Signer that abstracts away key management.
 *
 * SECURITY GUARANTEES:
 * - Private keys are NEVER loaded into memory in production
 * - All signing uses threshold cryptography (MPC) or hardware isolation (TEE)
 * - Audit logging of all signing operations
 * - Automatic key rotation support
 */
export class KMSSigner {
  private readonly config: KMSSignerConfig
  private readonly mode: SigningMode
  private initialized = false

  constructor(serviceId: string, config?: Partial<KMSSignerConfig>) {
    this.mode = getSigningMode()

    const defaultEndpoint =
      getEnv('KMS_SERVICE_URL') ?? 'http://localhost:4200'

    this.config = {
      serviceId,
      endpoint: config?.endpoint ?? defaultEndpoint,
      allowLocalDev:
        config?.allowLocalDev ?? getEnvBoolean('KMS_ALLOW_LOCAL_DEV', false),
      timeoutMs: config?.timeoutMs ?? 30000,
    }

    // SECURITY: Block local dev mode in production
    if (this.mode === 'local-dev' && getEnv('NODE_ENV') === 'production') {
      throw new Error(
        'SECURITY: Local dev signing mode is not allowed in production. ' +
          'Configure MPC_CLUSTER_ENDPOINTS or TEE_ENDPOINT.',
      )
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    // Verify KMS connectivity
    const healthCheck = await this.checkHealth()
    if (!healthCheck.available) {
      throw new Error(
        `KMS service not available at ${this.config.endpoint}: ${healthCheck.error}`,
      )
    }

    this.initialized = true
  }

  /**
   * Sign a message hash using MPC/TEE.
   *
   * SECURITY: The private key is never exposed. Signing happens:
   * - MPC mode: Across multiple parties, key never reconstructed
   * - TEE mode: Inside hardware enclave
   * - Local-dev: Only in development, key encrypted at rest
   */
  async sign(request: SigningRequest): Promise<SigningResult> {
    if (!this.initialized) {
      throw new Error('KMSSigner not initialized. Call initialize() first.')
    }

    const response = await fetch(`${this.config.endpoint}/kms/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-ID': this.config.serviceId,
      },
      body: JSON.stringify({
        messageHash: request.messageHash,
        serviceId: this.config.serviceId,
        metadata: request.metadata,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`KMS signing failed: ${error}`)
    }

    const result = (await response.json()) as {
      signature: string
      mode: 'mpc' | 'tee' | 'development'
      publicKey?: string
      address?: string
    }

    return {
      signature: result.signature as Hex,
      signingMode:
        result.mode === 'development' ? 'local-dev' : (result.mode as SigningMode),
      publicKey: result.publicKey as Hex | undefined,
      address: result.address as Address | undefined,
    }
  }

  /**
   * Sign a raw message (will be hashed with keccak256).
   */
  async signMessage(message: string | Uint8Array): Promise<SigningResult> {
    const messageBytes =
      typeof message === 'string'
        ? new TextEncoder().encode(message)
        : message
    const messageHash = keccak256(toHex(messageBytes)) as Hash
    return this.sign({ messageHash })
  }

  /**
   * Sign a transaction using MPC/TEE.
   *
   * SECURITY: The private key is never exposed. Transaction is serialized,
   * sent to KMS for signing, and returned ready for broadcast.
   */
  async signTransaction(
    request: TransactionSigningRequest,
  ): Promise<TransactionSigningResult> {
    if (!this.initialized) {
      throw new Error('KMSSigner not initialized. Call initialize() first.')
    }

    // Serialize the unsigned transaction
    const serialized = serializeTransaction(request.transaction)
    const txHash = keccak256(serialized)

    const response = await fetch(`${this.config.endpoint}/kms/sign-transaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-ID': this.config.serviceId,
      },
      body: JSON.stringify({
        transaction: serialized,
        chainId: request.chain.id,
        serviceId: this.config.serviceId,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`KMS transaction signing failed: ${error}`)
    }

    const result = (await response.json()) as {
      signedTransaction: string
      hash: string
      mode: 'mpc' | 'tee' | 'development'
    }

    return {
      signedTransaction: result.signedTransaction as Hex,
      hash: result.hash as Hash,
      signingMode:
        result.mode === 'development' ? 'local-dev' : (result.mode as SigningMode),
    }
  }

  /**
   * Send a signed transaction to the network.
   */
  async sendTransaction(
    request: TransactionSigningRequest,
    rpcUrl: string,
  ): Promise<Hash> {
    const { signedTransaction } = await this.signTransaction(request)

    const client = createPublicClient({
      chain: request.chain,
      transport: http(rpcUrl),
    })

    return client.sendRawTransaction({
      serializedTransaction: signedTransaction,
    })
  }

  /**
   * Get the public address for this service's signing key.
   */
  async getAddress(): Promise<Address> {
    const response = await fetch(
      `${this.config.endpoint}/kms/keys/${this.config.serviceId}`,
      {
        headers: { 'X-Service-ID': this.config.serviceId },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      },
    )

    if (!response.ok) {
      throw new Error(`Failed to get signing address: ${await response.text()}`)
    }

    const result = (await response.json()) as { address: string }
    return result.address as Address
  }

  /**
   * Check KMS service health.
   */
  async checkHealth(): Promise<{ available: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.config.endpoint}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      return { available: response.ok }
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  getMode(): SigningMode {
    return this.mode
  }

  getServiceId(): string {
    return this.config.serviceId
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

const signerCache = new Map<string, KMSSigner>()

/**
 * Get or create a KMS signer for a service.
 *
 * Service IDs should be unique per-service:
 * - 'oracle-worker' for oracle node worker signing
 * - 'oracle-operator' for oracle node operator signing
 * - 'faucet' for faucet token transfers
 * - 'leaderboard-oracle' for reputation attestations
 * - 'x402-facilitator' for x402 settlements
 */
export function getKMSSigner(serviceId: string): KMSSigner {
  let signer = signerCache.get(serviceId)
  if (!signer) {
    signer = new KMSSigner(serviceId)
    signerCache.set(serviceId, signer)
  }
  return signer
}

/**
 * Clear all cached signers (for testing).
 */
export function resetKMSSigners(): void {
  signerCache.clear()
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Sign a message hash using the specified service's key.
 *
 * SECURITY: This is the preferred API for all signing operations.
 * The private key is never exposed.
 */
export async function kmsSig(
  serviceId: string,
  messageHash: Hash,
): Promise<Hex> {
  const signer = getKMSSigner(serviceId)
  await signer.initialize()
  const result = await signer.sign({ messageHash })
  return result.signature
}

/**
 * Get the address for a service's signing key.
 */
export async function kmsAddress(serviceId: string): Promise<Address> {
  const signer = getKMSSigner(serviceId)
  await signer.initialize()
  return signer.getAddress()
}

/**
 * Create a viem-compatible local account that uses KMS for signing.
 *
 * SECURITY: This provides compatibility with viem's wallet client
 * while keeping private keys in the KMS. The account object exposes
 * the address but all signing operations are delegated to KMS.
 */
export async function createKMSAccount(
  serviceId: string,
): Promise<{
  address: Address
  signMessage: (args: { message: string | { raw: Hex } }) => Promise<Hex>
  signTransaction: (tx: TransactionSerializable, chain: Chain) => Promise<Hex>
}> {
  const signer = getKMSSigner(serviceId)
  await signer.initialize()
  const address = await signer.getAddress()

  return {
    address,
    signMessage: async (args) => {
      const message =
        typeof args.message === 'string'
          ? args.message
          : args.message.raw
      const result = await signer.signMessage(
        typeof message === 'string'
          ? new TextEncoder().encode(message)
          : message as unknown as Uint8Array,
      )
      return result.signature
    },
    signTransaction: async (tx, chain) => {
      const result = await signer.signTransaction({ transaction: tx, chain })
      return result.signedTransaction
    },
  }
}

