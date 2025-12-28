/**
 * Wallet KMS-Backed Signing Service
 *
 * This module provides wallet-specific KMS signing operations.
 * For general KMS signing, use @jejunetwork/kms directly.
 *
 * Wallet-specific features:
 * - Key registration/management per user
 * - Typed data signing (EIP-712)
 * - Personal message signing (EIP-191)
 * - Transaction hash signing
 */

import type { Address, Hex } from 'viem'
import { z } from 'zod'

// Re-export canonical KMS for general usage
export {
  createKMSSigner,
  getKMSSigner as getCanonicalKMSSigner,
  type KMSKeyInfo,
  KMSSigner as CanonicalKMSSigner,
  type KMSSignerConfig as CanonicalKMSSignerConfig,
  type SigningMode,
  type SignResult as CanonicalSignResult,
  type TransactionSignResult,
  validateSecureSigning,
} from '@jejunetwork/kms'

// ════════════════════════════════════════════════════════════════════════════
//                     WALLET-SPECIFIC KMS SIGNER
// ════════════════════════════════════════════════════════════════════════════

interface WalletKMSSignerConfig {
  endpoint?: string
  apiKey?: string
  useMPC: boolean
  threshold?: number
  totalParties?: number
}

interface SignRequest {
  keyId: string
  message: Uint8Array | string
  hashAlgorithm?: 'keccak256' | 'sha256' | 'none'
  requester: Address
}

interface SignResult {
  signature: Hex
  recoveryId: number
  keyId: string
  signedAt: number
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

type WalletKMSKeyInfo = z.infer<typeof KMSKeyInfoSchema>

/**
 * Wallet-specific KMS signer with key registration and advanced signing.
 */
export class WalletKMSSigner {
  private config: Required<WalletKMSSignerConfig>
  private keyCache = new Map<string, WalletKMSKeyInfo>()
  private initialized = false

  constructor(config: WalletKMSSignerConfig) {
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

  async getKey(keyId: string): Promise<WalletKMSKeyInfo> {
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

    const raw: unknown = await response.json()
    const keyInfo = KMSKeyInfoSchema.parse(raw)
    this.keyCache.set(keyId, keyInfo)
    return keyInfo
  }

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

    const raw: unknown = await response.json()
    const result = KMSSignResponseSchema.parse(raw)

    return {
      signature: result.signature as Hex,
      recoveryId: result.recoveryId ?? 0,
      keyId: result.keyId,
      signedAt: result.signedAt,
      participants: result.participants,
    }
  }

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

    const raw: unknown = await response.json()
    const result = KMSSignResponseSchema.parse(raw)

    return {
      signature: result.signature as Hex,
      recoveryId: result.recoveryId ?? 0,
      keyId: result.keyId,
      signedAt: result.signedAt,
      participants: result.participants,
    }
  }

  async signTransactionHash(
    keyId: string,
    txHash: Hex,
    requester: Address,
  ): Promise<SignResult> {
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      throw new Error('Invalid transaction hash format')
    }

    return this.sign({
      keyId,
      message: txHash,
      hashAlgorithm: 'none',
      requester,
    })
  }

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
          (options?.useMPC ?? this.config.useMPC)
            ? {
                threshold: this.config.threshold,
                totalParties: this.config.totalParties,
              }
            : undefined,
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Key registration failed: ${error}`)
    }

    const raw: unknown = await response.json()
    const keyInfo = KMSKeyInfoSchema.parse(raw)

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

// Singleton
let walletKmsSigner: WalletKMSSigner | undefined

export function getWalletKMSSigner(
  config?: Partial<WalletKMSSignerConfig>,
): WalletKMSSigner {
  if (!walletKmsSigner) {
    walletKmsSigner = new WalletKMSSigner({
      useMPC: config?.useMPC ?? process.env.KMS_USE_MPC === 'true',
      ...config,
    })
  }
  return walletKmsSigner
}

export function resetWalletKMSSigner(): void {
  walletKmsSigner = undefined
}

// Legacy aliases for backward compatibility
export {
  WalletKMSSigner as KMSSigner,
  getWalletKMSSigner as getKMSSigner,
  resetWalletKMSSigner as resetKMSSigner,
}

export type {
  WalletKMSSignerConfig as KMSSignerConfig,
  SignRequest,
  SignResult,
  TypedDataRequest,
}
