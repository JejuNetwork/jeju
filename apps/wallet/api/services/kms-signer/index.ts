/**
 * KMS-Backed Signing Service
 *
 * Provides signing operations through KMS/MPC without ever holding
 * private keys locally. This is the side-channel resistant path for
 * signing operations.
 *
 * SECURITY GUARANTEES:
 * - Private keys are never reconstructed on this server
 * - All signing happens via threshold MPC (FROST) or remote TEE
 * - Signature requests are logged for audit trail
 * - Rate limiting prevents abuse
 *
 * Use Cases:
 * - Smart wallet operations (gasless transactions)
 * - DAO governance actions
 * - Treasury operations
 * - Any high-security signing requirement
 */

import type { Address, Hex } from 'viem'
import { z } from 'zod'

// KMS client configuration
interface KMSSignerConfig {
  /** KMS endpoint URL (uses KMS_ENDPOINT env var if not provided) */
  endpoint?: string
  /** API key for KMS authentication */
  apiKey?: string
  /** Enable MPC signing (requires MPC_THRESHOLD and MPC_TOTAL_PARTIES) */
  useMPC: boolean
  /** Minimum threshold for MPC signing (default: 2) */
  threshold?: number
  /** Total parties for MPC signing (default: 3) */
  totalParties?: number
}

interface SignRequest {
  /** Key ID in KMS (must be registered first) */
  keyId: string
  /** Message to sign (raw bytes or string) */
  message: Uint8Array | string
  /** Hash algorithm (default: keccak256) */
  hashAlgorithm?: 'keccak256' | 'sha256' | 'none'
  /** Requester address for audit */
  requester: Address
}

interface SignResult {
  /** The signature (65 bytes: r + s + v) */
  signature: Hex
  /** Recovery ID */
  recoveryId: number
  /** Key ID used */
  keyId: string
  /** Timestamp */
  signedAt: number
  /** MPC participants (if MPC signing) */
  participants?: string[]
}

interface TypedDataRequest {
  keyId: string
  domain: {
    name?: string
    version?: string
    chainId?: number
    verifyingContract?: Address
    salt?: Hex
  }
  types: Record<string, Array<{ name: string; type: string }>>
  primaryType: string
  message: Record<string, unknown>
  requester: Address
}

// Zod schemas for validation
const KMSSignResponseSchema = z.object({
  signature: z.string(),
  recoveryId: z.number().optional(),
  keyId: z.string(),
  signedAt: z.number(),
  participants: z.array(z.string()).optional(),
})

const KMSKeyInfoSchema = z.object({
  keyId: z.string(),
  publicKey: z.string(),
  address: z.string(),
  type: z.enum(['signing', 'encryption']),
  curve: z.enum(['secp256k1', 'ed25519']),
  createdAt: z.number(),
  owner: z.string(),
  mpc: z
    .object({
      threshold: z.number(),
      totalParties: z.number(),
    })
    .optional(),
})

type KMSKeyInfo = z.infer<typeof KMSKeyInfoSchema>

/**
 * KMS-backed signer that never holds private keys locally.
 *
 * All signing operations are delegated to the KMS service which uses
 * either TEE-protected signing or MPC threshold signing.
 */
export class KMSSigner {
  private config: Required<KMSSignerConfig>
  private keyCache = new Map<string, KMSKeyInfo>()
  private initialized = false

  constructor(config: KMSSignerConfig) {
    this.config = {
      endpoint: config.endpoint ?? process.env.KMS_ENDPOINT ?? '',
      apiKey: config.apiKey ?? process.env.KMS_API_KEY ?? '',
      useMPC: config.useMPC,
      threshold: config.threshold ?? 2,
      totalParties: config.totalParties ?? 3,
    }

    if (!this.config.endpoint) {
      throw new Error(
        'KMS endpoint required. Set KMS_ENDPOINT env var or provide in config.',
      )
    }
  }

  /**
   * Initialize connection to KMS and verify availability.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    const response = await fetch(`${this.config.endpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`KMS not available: ${response.status}`)
    }

    this.initialized = true
  }

  /**
   * Get key info from KMS.
   */
  async getKey(keyId: string): Promise<KMSKeyInfo> {
    await this.ensureInitialized()

    const cached = this.keyCache.get(keyId)
    if (cached) return cached

    const response = await fetch(`${this.config.endpoint}/keys/${keyId}`, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      throw new Error(`Key not found: ${keyId}`)
    }

    const raw = await response.json()
    const keyInfo = KMSKeyInfoSchema.parse(raw)
    this.keyCache.set(keyId, keyInfo)
    return keyInfo
  }

  /**
   * Sign a message using KMS.
   *
   * SECURITY: The private key never exists on this server.
   * Signing happens entirely within the KMS (TEE or MPC).
   */
  async sign(request: SignRequest): Promise<SignResult> {
    await this.ensureInitialized()

    const messageBytes =
      typeof request.message === 'string'
        ? new TextEncoder().encode(request.message)
        : request.message

    const response = await fetch(`${this.config.endpoint}/sign`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        keyId: request.keyId,
        message: Array.from(messageBytes),
        hashAlgorithm: request.hashAlgorithm ?? 'keccak256',
        requester: request.requester,
        useMPC: this.config.useMPC,
        mpcOptions: this.config.useMPC
          ? {
              threshold: this.config.threshold,
              totalParties: this.config.totalParties,
            }
          : undefined,
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Signing failed: ${error}`)
    }

    const raw = await response.json()
    const result = KMSSignResponseSchema.parse(raw)

    return {
      signature: result.signature as Hex,
      recoveryId: result.recoveryId ?? 0,
      keyId: result.keyId,
      signedAt: result.signedAt,
      participants: result.participants,
    }
  }

  /**
   * Sign a personal message (EIP-191).
   */
  async signPersonalMessage(
    keyId: string,
    message: string,
    requester: Address,
  ): Promise<SignResult> {
    const prefix = `\x19Ethereum Signed Message:\n${message.length}`
    const prefixedMessage = new TextEncoder().encode(`${prefix}${message}`)

    return this.sign({
      keyId,
      message: prefixedMessage,
      hashAlgorithm: 'keccak256',
      requester,
    })
  }

  /**
   * Sign typed data (EIP-712).
   */
  async signTypedData(request: TypedDataRequest): Promise<SignResult> {
    await this.ensureInitialized()

    const response = await fetch(`${this.config.endpoint}/sign/typed-data`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        keyId: request.keyId,
        domain: request.domain,
        types: request.types,
        primaryType: request.primaryType,
        message: request.message,
        requester: request.requester,
        useMPC: this.config.useMPC,
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Typed data signing failed: ${error}`)
    }

    const raw = await response.json()
    const result = KMSSignResponseSchema.parse(raw)

    return {
      signature: result.signature as Hex,
      recoveryId: result.recoveryId ?? 0,
      keyId: result.keyId,
      signedAt: result.signedAt,
      participants: result.participants,
    }
  }

  /**
   * Sign a transaction hash.
   *
   * Use this for signing transaction hashes for smart contract wallets
   * or gasless transactions. The transaction is NOT broadcast by KMS.
   */
  async signTransactionHash(
    keyId: string,
    txHash: Hex,
    requester: Address,
  ): Promise<SignResult> {
    // Validate tx hash format
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      throw new Error('Invalid transaction hash format')
    }

    return this.sign({
      keyId,
      message: txHash,
      hashAlgorithm: 'none', // Already hashed
      requester,
    })
  }

  /**
   * Register a new key in KMS for this user.
   * Returns the key ID and public address.
   */
  async registerKey(
    owner: Address,
    options?: { name?: string; useMPC?: boolean },
  ): Promise<{ keyId: string; address: Address; publicKey: Hex }> {
    await this.ensureInitialized()

    const response = await fetch(`${this.config.endpoint}/keys`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        owner,
        name: options?.name ?? 'wallet-key',
        type: 'signing',
        curve: 'secp256k1',
        useMPC: options?.useMPC ?? this.config.useMPC,
        mpcOptions:
          options?.useMPC ?? this.config.useMPC
            ? {
                threshold: this.config.threshold,
                totalParties: this.config.totalParties,
              }
            : undefined,
      }),
      signal: AbortSignal.timeout(60000), // Key generation can take longer
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Key registration failed: ${error}`)
    }

    const raw = await response.json()
    const keyInfo = KMSKeyInfoSchema.parse(raw)

    // Cache the new key
    this.keyCache.set(keyInfo.keyId, keyInfo)

    return {
      keyId: keyInfo.keyId,
      address: keyInfo.address as Address,
      publicKey: keyInfo.publicKey as Hex,
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey
    }
    return headers
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }
}

// Singleton instance
let kmsSigner: KMSSigner | undefined

/**
 * Get the KMS signer instance.
 *
 * This is the recommended way to get a signer that never holds
 * private keys locally.
 */
export function getKMSSigner(config?: Partial<KMSSignerConfig>): KMSSigner {
  if (!kmsSigner) {
    kmsSigner = new KMSSigner({
      useMPC: config?.useMPC ?? process.env.KMS_USE_MPC === 'true',
      ...config,
    })
  }
  return kmsSigner
}

/**
 * Reset the KMS signer instance.
 */
export function resetKMSSigner(): void {
  kmsSigner = undefined
}

export type { KMSSignerConfig, SignRequest, SignResult, TypedDataRequest }

