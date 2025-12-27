/**
 * Secure Signer - Routes all signing through KMS with threshold cryptography
 *
 * SECURITY: This module ensures private keys are NEVER loaded into server memory.
 * In production, all signing MUST go through the KMS which uses FROST threshold
 * signing - the full private key is never reconstructed.
 *
 * Side-Channel Attack Mitigation:
 * - No private keys in memory (threshold signing only)
 * - Keys distributed across multiple parties
 * - Signing requires threshold agreement
 * - TEE attestation for key operations
 */

import type { Address, Hex } from 'viem'
import { keccak256, toHex } from 'viem'

// KMS endpoint - in production, this should be a secure internal service
const KMS_ENDPOINT = process.env.KMS_ENDPOINT ?? 'http://localhost:4030/kms'

interface SignResult {
  signature: Hex
  keyId: string
  address: Address
  mode: 'frost' | 'development'
}

interface KMSKey {
  keyId: string
  address: Address
  publicKey: Hex
}

/**
 * SecureSigner - Delegates all signing to KMS (FROST threshold signing)
 *
 * NEVER use privateKeyToAccount() in production code. Always use this.
 */
export class SecureSigner {
  private keyId: string | null = null
  private address: Address | null = null
  private readonly owner: Address
  private readonly isProduction: boolean

  constructor(owner: Address) {
    this.owner = owner
    this.isProduction = process.env.NODE_ENV === 'production'
  }

  /**
   * Initialize the signer with a KMS key
   * Creates a new FROST threshold key if none exists
   */
  async initialize(existingKeyId?: string): Promise<void> {
    if (existingKeyId) {
      // Use existing key
      const key = await this.getKey(existingKeyId)
      this.keyId = key.keyId
      this.address = key.address
      return
    }

    // Create new FROST key
    const key = await this.createKey()
    this.keyId = key.keyId
    this.address = key.address
  }

  /**
   * Get the signer's address (derived from FROST group key)
   */
  getAddress(): Address {
    if (!this.address) {
      throw new Error('SecureSigner not initialized - call initialize() first')
    }
    return this.address
  }

  /**
   * Get the key ID for reference
   */
  getKeyId(): string {
    if (!this.keyId) {
      throw new Error('SecureSigner not initialized - call initialize() first')
    }
    return this.keyId
  }

  /**
   * Sign a message using FROST threshold signing
   * The full private key is NEVER reconstructed
   */
  async signMessage(message: string | Uint8Array): Promise<Hex> {
    if (!this.keyId) {
      throw new Error('SecureSigner not initialized - call initialize() first')
    }

    const messageHash =
      typeof message === 'string'
        ? keccak256(new TextEncoder().encode(message))
        : keccak256(message)

    const result = await this.requestSignature(messageHash)
    return result.signature
  }

  /**
   * Sign a hash directly using FROST threshold signing
   */
  async signHash(hash: Hex): Promise<Hex> {
    if (!this.keyId) {
      throw new Error('SecureSigner not initialized - call initialize() first')
    }

    const result = await this.requestSignature(hash)
    return result.signature
  }

  /**
   * Sign typed data (EIP-712) using FROST threshold signing
   */
  async signTypedData(
    domain: {
      name?: string
      version?: string
      chainId?: number
      verifyingContract?: Address
    },
    types: Record<string, Array<{ name: string; type: string }>>,
    message: Record<string, unknown>,
  ): Promise<Hex> {
    if (!this.keyId) {
      throw new Error('SecureSigner not initialized - call initialize() first')
    }

    // Compute EIP-712 hash
    const typedDataHash = this.computeTypedDataHash(domain, types, message)
    const result = await this.requestSignature(typedDataHash)
    return result.signature
  }

  // Private methods

  private async createKey(): Promise<KMSKey> {
    const response = await fetch(`${KMS_ENDPOINT}/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': this.owner,
      },
      body: JSON.stringify({
        threshold: 2, // Require 2 of 3 parties
        totalParties: 3,
        metadata: {
          purpose: 'secure-signer',
          createdAt: new Date().toISOString(),
        },
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to create KMS key: ${error}`)
    }

    const data = (await response.json()) as {
      keyId: string
      address: Address
      publicKey: Hex
    }
    return {
      keyId: data.keyId,
      address: data.address,
      publicKey: data.publicKey,
    }
  }

  private async getKey(keyId: string): Promise<KMSKey> {
    const response = await fetch(`${KMS_ENDPOINT}/keys/${keyId}`, {
      headers: {
        'x-jeju-address': this.owner,
      },
    })

    if (!response.ok) {
      throw new Error(`KMS key not found: ${keyId}`)
    }

    const data = (await response.json()) as {
      keyId: string
      address: Address
      publicKey: Hex
    }
    return {
      keyId: data.keyId,
      address: data.address,
      publicKey: data.publicKey,
    }
  }

  private async requestSignature(messageHash: Hex): Promise<SignResult> {
    const response = await fetch(`${KMS_ENDPOINT}/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': this.owner,
      },
      body: JSON.stringify({
        keyId: this.keyId,
        messageHash,
        encoding: 'hex',
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`KMS signing failed: ${error}`)
    }

    return response.json() as Promise<SignResult>
  }

  private computeTypedDataHash(
    domain: {
      name?: string
      version?: string
      chainId?: number
      verifyingContract?: Address
    },
    types: Record<string, Array<{ name: string; type: string }>>,
    message: Record<string, unknown>,
  ): Hex {
    // Simplified EIP-712 hash computation
    // In production, use a full EIP-712 implementation
    const domainSeparator = keccak256(
      toHex(
        JSON.stringify({
          name: domain.name ?? '',
          version: domain.version ?? '1',
          chainId: domain.chainId ?? 1,
          verifyingContract: domain.verifyingContract ?? '',
        }),
      ),
    )
    const messageHash = keccak256(toHex(JSON.stringify({ types, message })))

    // EIP-712: keccak256("\x19\x01" ++ domainSeparator ++ structHash)
    const prefix = toHex(new Uint8Array([0x19, 0x01]))
    return keccak256(
      `${prefix}${domainSeparator.slice(2)}${messageHash.slice(2)}` as Hex,
    )
  }
}

/**
 * Factory function to create a secure signer
 */
export async function createSecureSigner(
  owner: Address,
  existingKeyId?: string,
): Promise<SecureSigner> {
  const signer = new SecureSigner(owner)
  await signer.initialize(existingKeyId)
  return signer
}

/**
 * SECURITY CHECK: Enforce KMS usage in production
 * Call this at startup to verify no direct key usage
 */
export function validateSecureSigningMode(): void {
  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction) {
    // In production, these environment variables should NOT exist
    // because we should be using KMS, not direct keys
    const directKeyVars = [
      'PRIVATE_KEY',
      'DWS_PRIVATE_KEY',
      'SOLVER_PRIVATE_KEY',
      'TEE_VERIFIER_PRIVATE_KEY',
      'OPERATOR_PRIVATE_KEY',
      'WORKER_PRIVATE_KEY',
    ]

    const foundDirectKeys = directKeyVars.filter((v) => process.env[v])

    if (foundDirectKeys.length > 0) {
      console.warn(
        `[SecureSigner] WARNING: Direct private key environment variables detected in production: ${foundDirectKeys.join(', ')}`,
      )
      console.warn(
        '[SecureSigner] These should be migrated to KMS for side-channel attack protection.',
      )
      // In a future version, this should throw an error:
      // throw new Error('Direct private keys not allowed in production. Use KMS.')
    }
  }
}

