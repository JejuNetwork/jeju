/**
 * KMS-Backed Cryptography Module
 *
 * This module provides cryptographic operations that delegate to a remote KMS.
 * Private keys NEVER exist in application memory - they remain inside the
 * secure enclave (TEE/HSM).
 *
 * SECURITY PROPERTIES:
 * - Private keys never leave the KMS
 * - All signing/ECDH happens inside the secure enclave
 * - Protects against side-channel attacks on TEE
 * - Even if the enclave memory is compromised, full keys are never exposed
 */

import type { Address, Hex } from 'viem'
import type { KMSEncryptionProvider, KMSSigner } from './types'

/**
 * KMS Client Configuration
 */
export interface KMSClientConfig {
  /** KMS endpoint URL */
  endpoint: string
  /** User's Ethereum address (for key derivation) */
  address: Address
  /** Optional API key for authentication */
  apiKey?: string
  /** Request timeout in milliseconds */
  timeoutMs?: number
}

/**
 * KMS Key Types
 */
export type KMSKeyType = 'signing' | 'encryption'
export type KMSKeyCurve = 'ed25519' | 'x25519'

/**
 * Remote KMS Signer Implementation
 *
 * Delegates all signing operations to the KMS.
 * The private key never exists in application memory.
 */
export class RemoteKMSSigner implements KMSSigner {
  readonly keyId: string
  readonly publicKey: Uint8Array

  private readonly endpoint: string
  private readonly apiKey?: string
  private readonly timeoutMs: number

  constructor(config: {
    keyId: string
    publicKey: Uint8Array
    endpoint: string
    apiKey?: string
    timeoutMs?: number
  }) {
    this.keyId = config.keyId
    this.publicKey = config.publicKey
    this.endpoint = config.endpoint
    this.apiKey = config.apiKey
    this.timeoutMs = config.timeoutMs ?? 10000
  }

  /**
   * Sign a message using the KMS.
   * The private key remains in the secure enclave.
   */
  async sign(message: Uint8Array): Promise<Uint8Array> {
    const response = await this.fetchWithTimeout(`${this.endpoint}/sign`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        keyId: this.keyId,
        message: Buffer.from(message).toString('base64'),
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`KMS signing failed: ${response.status} - ${error}`)
    }

    const result = (await response.json()) as { signature: string }
    return Buffer.from(result.signature, 'base64')
  }

  /**
   * Perform ECDH key exchange inside the KMS.
   * Returns only the derived shared secret.
   */
  async ecdh(theirPublicKey: Uint8Array): Promise<Uint8Array> {
    const response = await this.fetchWithTimeout(`${this.endpoint}/ecdh`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        keyId: this.keyId,
        theirPublicKey: Buffer.from(theirPublicKey).toString('base64'),
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`KMS ECDH failed: ${response.status} - ${error}`)
    }

    const result = (await response.json()) as { sharedSecret: string }
    return Buffer.from(result.sharedSecret, 'base64')
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

/**
 * Remote KMS Encryption Provider Implementation
 *
 * Delegates all encryption/decryption operations to the KMS.
 * The private key never exists in application memory.
 */
export class RemoteKMSEncryptionProvider implements KMSEncryptionProvider {
  readonly keyId: string
  readonly publicKey: Uint8Array

  private readonly endpoint: string
  private readonly apiKey?: string
  private readonly timeoutMs: number

  constructor(config: {
    keyId: string
    publicKey: Uint8Array
    endpoint: string
    apiKey?: string
    timeoutMs?: number
  }) {
    this.keyId = config.keyId
    this.publicKey = config.publicKey
    this.endpoint = config.endpoint
    this.apiKey = config.apiKey
    this.timeoutMs = config.timeoutMs ?? 10000
  }

  /**
   * Encrypt a message for a recipient.
   * Ephemeral key generation and ECDH happen inside the KMS.
   */
  async encrypt(
    plaintext: Uint8Array,
    recipientPublicKey: Uint8Array,
  ): Promise<{
    ciphertext: Uint8Array
    nonce: Uint8Array
    ephemeralPublicKey: Uint8Array
  }> {
    const response = await this.fetchWithTimeout(`${this.endpoint}/encrypt`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        keyId: this.keyId,
        plaintext: Buffer.from(plaintext).toString('base64'),
        recipientPublicKey: Buffer.from(recipientPublicKey).toString('base64'),
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`KMS encryption failed: ${response.status} - ${error}`)
    }

    const result = (await response.json()) as {
      ciphertext: string
      nonce: string
      ephemeralPublicKey: string
    }

    return {
      ciphertext: Buffer.from(result.ciphertext, 'base64'),
      nonce: Buffer.from(result.nonce, 'base64'),
      ephemeralPublicKey: Buffer.from(result.ephemeralPublicKey, 'base64'),
    }
  }

  /**
   * Decrypt a message sent to us.
   * ECDH and decryption happen inside the KMS.
   */
  async decrypt(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    ephemeralPublicKey: Uint8Array,
  ): Promise<Uint8Array> {
    const response = await this.fetchWithTimeout(`${this.endpoint}/decrypt`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        keyId: this.keyId,
        ciphertext: Buffer.from(ciphertext).toString('base64'),
        nonce: Buffer.from(nonce).toString('base64'),
        ephemeralPublicKey: Buffer.from(ephemeralPublicKey).toString('base64'),
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`KMS decryption failed: ${response.status} - ${error}`)
    }

    const result = (await response.json()) as { plaintext: string }
    return Buffer.from(result.plaintext, 'base64')
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

/**
 * Initialize KMS keys for a user.
 *
 * This function:
 * 1. Derives deterministic key IDs from the user's address
 * 2. Requests key generation in the KMS if not already present
 * 3. Returns signer and encryption provider interfaces
 *
 * @param config - KMS client configuration
 * @param signature - Wallet signature for authentication
 */
export async function initializeKMSKeys(
  config: KMSClientConfig,
  signature: Hex,
): Promise<{
  signer: KMSSigner
  encryption: KMSEncryptionProvider
}> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`
  }

  // Request key initialization from KMS
  const response = await fetch(`${config.endpoint}/init`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      address: config.address,
      signature,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`KMS initialization failed: ${response.status} - ${error}`)
  }

  const result = (await response.json()) as {
    signingKeyId: string
    signingPublicKey: string
    encryptionKeyId: string
    encryptionPublicKey: string
  }

  const signer = new RemoteKMSSigner({
    keyId: result.signingKeyId,
    publicKey: Buffer.from(result.signingPublicKey, 'base64'),
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
  })

  const encryption = new RemoteKMSEncryptionProvider({
    keyId: result.encryptionKeyId,
    publicKey: Buffer.from(result.encryptionPublicKey, 'base64'),
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
  })

  return { signer, encryption }
}

import { enforceNoLocalKeysInProduction, securityAudit } from '../security'

/**
 * Security Warning Helper
 *
 * Logs a warning when local key operations are used instead of KMS.
 * In production/staging, this will throw an error.
 */
export function warnLocalKeyUsage(operation: string): void {
  // In production, this will throw - local keys not allowed
  enforceNoLocalKeysInProduction(operation)

  console.warn(
    `⚠️  SECURITY WARNING: Using local key for "${operation}" operation.\n` +
      `   Private keys in application memory are vulnerable to side-channel attacks.\n` +
      `   Use KMS-backed operations (kmsSigner/kmsEncryption) for production security.`,
  )

  securityAudit.log({
    operation: `sdk:${operation}`,
    success: true,
    metadata: { mode: 'local', warning: 'local-key-operation' },
  })
}
