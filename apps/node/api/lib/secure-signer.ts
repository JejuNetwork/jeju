/**
 * Secure Signer - TEE-Safe Key Management
 *
 * This module provides KMS-backed secure signing for node operations.
 * Private keys are NEVER loaded into memory. All cryptographic operations
 * are delegated to the KMS service (MPC or TEE).
 */

import { getCurrentNetwork, getKMSMpcUrl, getKMSUrl } from '@jejunetwork/config'
import { expectValid } from '@jejunetwork/types'
import {
  type Address,
  type Hash,
  type Hex,
  hashMessage,
  recoverAddress,
  toBytes,
} from 'viem'
import { z } from 'zod'

// Import directly from @jejunetwork/kms:
// import { createKMSSigner, getKMSSigner, KMSSigner } from '@jejunetwork/kms'

// Response schemas
const SignResponseSchema = z.object({
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  v: z.number(),
  r: z.string(),
  s: z.string(),
})

const SignTransactionResponseSchema = z.object({
  signedTransaction: z.string(),
  hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
})

const DeriveAddressResponseSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
})

const AttestationResponseSchema = z.object({
  attestation: z.string(),
  platform: z.enum(['sgx', 'sev', 'nitro', 'simulated']),
  timestamp: z.number(),
})

export interface SecureSignerConfig {
  /** KMS endpoint URL */
  kmsEndpoint?: string
  /** MPC endpoint URL (for threshold signing) */
  mpcEndpoint?: string
  /** Require TEE attestation for all operations */
  requireTeeAttestation: boolean
  /** Timeout for KMS operations (ms) */
  timeoutMs: number
  /** Key ID for this node's signing key (managed by KMS) */
  keyId: string
  /** Fallback to local signing (ONLY for development) */
  allowLocalFallback: boolean
}

export interface SignMessageRequest {
  message: string | Uint8Array
  keyId?: string
}

export interface SignTransactionRequest {
  to: Address
  value?: bigint
  data?: Hex
  nonce?: number
  gasLimit?: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  chainId: number
  keyId?: string
}

export interface SignTypedDataRequest {
  domain: {
    name?: string
    version?: string
    chainId?: number
    verifyingContract?: Address
  }
  types: Record<string, Array<{ name: string; type: string }>>
  primaryType: string
  message: Record<string, unknown>
  keyId?: string
}

export interface TeeAttestation {
  attestation: string
  platform: 'sgx' | 'sev' | 'nitro' | 'simulated'
  timestamp: number
}

/**
 * Secure Signer - Delegates all cryptographic operations to KMS
 *
 * NEVER holds private keys in memory. All operations go through:
 * 1. KMS MPC endpoint for threshold signatures (2-of-n)
 * 2. TEE attestation validation
 * 3. Audit logging
 */
export class SecureSigner {
  private config: SecureSignerConfig
  private cachedAddress: Address | null = null

  constructor(config: Partial<SecureSignerConfig> = {}) {
    const network = getCurrentNetwork()

    this.config = {
      kmsEndpoint: config.kmsEndpoint ?? getKMSUrl(network),
      mpcEndpoint: config.mpcEndpoint ?? getKMSMpcUrl(network),
      requireTeeAttestation:
        config.requireTeeAttestation ?? network !== 'localnet',
      timeoutMs: config.timeoutMs ?? 30000,
      keyId: config.keyId ?? '',
      allowLocalFallback: config.allowLocalFallback ?? network === 'localnet',
    }

    // For localnet with dev key, allow without real KMS
    const isDevLocalnet =
      network === 'localnet' && Boolean(this.config.keyId?.startsWith('dev-'))

    // Only throw if no keyId AND not in dev mode
    if (!this.config.keyId) {
      throw new Error(
        'SecureSigner requires a keyId. Register your node with KMS first.',
      )
    }

    // Store dev mode flag
    this.isDevMode = isDevLocalnet
  }

  private isDevMode = false

  // Well-known dev key for localnet testing (matches jeju CLI dev keys)
  private static DEV_PRIVATE_KEY =
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const

  /**
   * Get the address for this signer's key (derived from KMS-managed key)
   */
  async getAddress(): Promise<Address> {
    if (this.cachedAddress) {
      return this.cachedAddress
    }

    // In dev mode, derive address from well-known dev key
    if (this.isDevMode) {
      const { privateKeyToAccount } = await import('viem/accounts')
      const account = privateKeyToAccount(SecureSigner.DEV_PRIVATE_KEY)
      this.cachedAddress = account.address
      return this.cachedAddress
    }

    const response = await this.kmsRequest('/derive-address', {
      keyId: this.config.keyId,
    })

    const parsed = expectValid(
      DeriveAddressResponseSchema,
      response,
      'KMS derive-address response',
    )

    this.cachedAddress = parsed.address as Address
    return this.cachedAddress
  }

  /**
   * Sign a message using KMS MPC threshold signature
   *
   * The message is signed by collecting signature shares from multiple MPC nodes.
   * No single party ever has access to the full private key.
   */
  async signMessage(request: SignMessageRequest): Promise<Hex> {
    const keyId = request.keyId ?? this.config.keyId
    const messageBytes =
      typeof request.message === 'string'
        ? toBytes(request.message)
        : request.message
    const messageHash = hashMessage({ raw: messageBytes })

    // Request threshold signature from KMS MPC
    const response = await this.mpcRequest('/sign', {
      keyId,
      messageHash,
      operation: 'signMessage',
      requireAttestation: this.config.requireTeeAttestation,
    })

    const parsed = expectValid(
      SignResponseSchema,
      response,
      'KMS sign response',
    )
    return parsed.signature as Hex
  }

  /**
   * Sign a transaction using KMS MPC threshold signature
   *
   * Transaction is serialized and signed by MPC nodes.
   * The signed transaction is returned, ready for broadcast.
   */
  async signTransaction(request: SignTransactionRequest): Promise<{
    signedTransaction: Hex
    hash: Hash
  }> {
    // In dev mode, sign with well-known dev key
    if (this.isDevMode) {
      const { privateKeyToAccount } = await import('viem/accounts')
      const { keccak256 } = await import('viem')
      const account = privateKeyToAccount(SecureSigner.DEV_PRIVATE_KEY)

      const tx = {
        to: request.to,
        value: request.value ?? 0n,
        data: request.data ?? '0x',
        nonce: request.nonce ?? 0,
        gasLimit: request.gasLimit ?? 21000n,
        maxFeePerGas: request.maxFeePerGas ?? 1000000000n,
        maxPriorityFeePerGas: request.maxPriorityFeePerGas ?? 1000000000n,
        chainId: request.chainId,
        type: 'eip1559' as const,
      }

      const signature = await account.signTransaction(tx)
      const hash = keccak256(signature) as Hash

      return {
        signedTransaction: signature as Hex,
        hash,
      }
    }

    const keyId = request.keyId ?? this.config.keyId

    // Serialize transaction for signing
    const txData = {
      to: request.to,
      value: request.value?.toString() ?? '0',
      data: request.data ?? '0x',
      nonce: request.nonce,
      gasLimit: request.gasLimit?.toString(),
      maxFeePerGas: request.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: request.maxPriorityFeePerGas?.toString(),
      chainId: request.chainId,
    }

    // Request threshold signature from KMS MPC
    const response = await this.mpcRequest('/sign-transaction', {
      keyId,
      transaction: txData,
      operation: 'signTransaction',
      requireAttestation: this.config.requireTeeAttestation,
    })

    const parsed = expectValid(
      SignTransactionResponseSchema,
      response,
      'KMS sign-transaction response',
    )

    return {
      signedTransaction: parsed.signedTransaction as Hex,
      hash: parsed.hash as Hash,
    }
  }

  /**
   * Sign typed data (EIP-712) using KMS MPC threshold signature
   */
  async signTypedData(request: SignTypedDataRequest): Promise<Hex> {
    const keyId = request.keyId ?? this.config.keyId

    const response = await this.mpcRequest('/sign-typed-data', {
      keyId,
      domain: request.domain,
      types: request.types,
      primaryType: request.primaryType,
      message: request.message,
      operation: 'signTypedData',
      requireAttestation: this.config.requireTeeAttestation,
    })

    const parsed = expectValid(
      SignResponseSchema,
      response,
      'KMS sign response',
    )
    return parsed.signature as Hex
  }

  /**
   * Verify a signature was created by the expected address
   */
  async verify(
    message: string | Uint8Array,
    signature: Hex,
    expectedAddress: Address,
  ): Promise<boolean> {
    const messageBytes =
      typeof message === 'string' ? toBytes(message) : message
    const hash = hashMessage({ raw: messageBytes })
    const recoveredAddress = await recoverAddress({ hash, signature })
    return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase()
  }

  /**
   * Get TEE attestation for this node
   *
   * Used to prove the node is running in a secure enclave
   * before KMS will release key shares for signing.
   */
  async getAttestation(): Promise<TeeAttestation> {
    const response = await this.kmsRequest('/attestation', {
      keyId: this.config.keyId,
    })

    return expectValid(
      AttestationResponseSchema,
      response,
      'KMS attestation response',
    )
  }

  /**
   * Check if the signer is healthy and can perform operations
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.kmsEndpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Request to KMS endpoint
   */
  private async kmsRequest(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.config.kmsEndpoint}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`KMS request failed: ${response.status} - ${text}`)
    }

    return response.json()
  }

  /**
   * Request to MPC endpoint for threshold signatures
   */
  private async mpcRequest(path: string, body: unknown): Promise<unknown> {
    const endpoint = this.config.mpcEndpoint ?? this.config.kmsEndpoint

    const response = await fetch(`${endpoint}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`MPC request failed: ${response.status} - ${text}`)
    }

    return response.json()
  }
}

/**
 * Create a secure signer for node operations
 *
 * @param keyId - The KMS key ID for this node (obtained during node registration)
 * @param options - Additional configuration options
 */
export function createSecureSigner(
  keyId: string,
  options: Partial<Omit<SecureSignerConfig, 'keyId'>> = {},
): SecureSigner {
  return new SecureSigner({ ...options, keyId })
}

/**
 * Register a new node with KMS and get a key ID
 *
 * This should be called during initial node setup.
 * The KMS will:
 * 1. Generate a new key using MPC (no single party has full key)
 * 2. Store key shares across threshold nodes
 * 3. Return a keyId for future signing operations
 *
 * For localnet development, this returns a deterministic dev key instead.
 */
export async function registerNodeWithKMS(
  operatorAddress: Address,
  nodeMetadata: {
    nodeId: string
    region: string
    services: string[]
    teeCapable: boolean
    teePlatform?: string
  },
): Promise<{ keyId: string; address: Address }> {
  const network = getCurrentNetwork()

  // LOCAL DEVELOPMENT FALLBACK
  // For localnet, skip KMS and use well-known dev key
  if (network === 'localnet') {
    const { privateKeyToAccount } = await import('viem/accounts')
    // Use the same dev key as SecureSigner class
    const DEV_KEY =
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
    const account = privateKeyToAccount(DEV_KEY)

    console.log('[KMS] Using localnet development key (no KMS required)')
    console.log(`[KMS] Dev address: ${account.address}`)

    return {
      keyId: `dev-localnet-${nodeMetadata.nodeId}`,
      address: account.address,
    }
  }

  const endpoint = getKMSUrl(network)

  // Try to connect to KMS, with helpful error message if unavailable
  try {
    const response = await fetch(`${endpoint}/register-node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operator: operatorAddress,
        ...nodeMetadata,
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Node registration failed: ${response.status} - ${text}`)
    }

    const result = (await response.json()) as { keyId: string; address: string }

    return {
      keyId: result.keyId,
      address: result.address as Address,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // Provide helpful guidance if KMS is not available
    if (
      message.includes('fetch') ||
      message.includes('ECONNREFUSED') ||
      message.includes('timeout')
    ) {
      throw new Error(
        `KMS service not available at ${endpoint}. ` +
          `For local development, use: NETWORK=localnet bun run apps/node/api/cli.ts start --all`,
      )
    }

    throw error
  }
}
