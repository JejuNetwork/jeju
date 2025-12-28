/**
 * KMS-Backed Solana Client for Cross-Chain Bridge
 *
 * SECURITY: This client NEVER stores private keys in memory.
 * All signing operations are delegated to the KMS/MPC infrastructure.
 *
 * Side-Channel Resistance:
 * - Private keys exist only as threshold shares in remote enclaves
 * - Signing happens via MPC protocol without key reconstruction
 * - No key material ever enters this process
 *
 * Solana uses Ed25519 signatures, so we need a different signing approach
 * than EVM's secp256k1. The KMS must support Ed25519 key generation and signing.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  type TransactionInstruction,
  type VersionedTransaction,
} from '@solana/web3.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('kms-solana-client')

/**
 * KMS Ed25519 Signer Interface
 *
 * For Solana, we need Ed25519 signatures instead of secp256k1.
 */
export interface KMSEd25519Signer {
  /** Key ID in the KMS */
  keyId: string
  /** Public key bytes (32 bytes for Ed25519) */
  publicKey: Uint8Array

  /**
   * Sign a message with Ed25519.
   * The private key NEVER leaves the KMS.
   *
   * @param message - The message to sign (will be signed directly, not hashed)
   * @returns Ed25519 signature (64 bytes)
   */
  sign(message: Uint8Array): Promise<Uint8Array>
}

export interface KMSSolanaClientConfig {
  rpcUrl: string
  commitment?: 'processed' | 'confirmed' | 'finalized'
  bridgeProgramId: PublicKey
  evmLightClientProgramId: PublicKey
  /** KMS signer - signing happens remotely */
  kmsSigner: KMSEd25519Signer
}

/**
 * KMS-Backed Solana Client
 *
 * SECURITY GUARANTEES:
 * 1. Private keys NEVER enter this process
 * 2. All signing delegated to remote KMS
 * 3. Resistant to TEE side-channel attacks
 * 4. Compatible with MPC/threshold signing
 */
export class KMSSolanaClient {
  private config: KMSSolanaClientConfig
  private connection: Connection
  private publicKey: PublicKey

  constructor(config: KMSSolanaClientConfig) {
    this.config = config
    this.connection = new Connection(
      config.rpcUrl,
      config.commitment ?? 'confirmed',
    )
    this.publicKey = new PublicKey(config.kmsSigner.publicKey)

    log.info('KMS Solana client initialized', {
      publicKey: this.publicKey.toBase58(),
      keyId: config.kmsSigner.keyId,
    })
  }

  /**
   * Get the public key
   */
  getPublicKey(): PublicKey {
    return this.publicKey
  }

  /**
   * Get the connection
   */
  getConnection(): Connection {
    return this.connection
  }

  /**
   * Sign a transaction using KMS
   *
   * SECURITY: Signing happens in the remote KMS.
   * No private key material enters this process.
   */
  async signTransaction(transaction: Transaction): Promise<Transaction> {
    // Get recent blockhash if not set
    if (!transaction.recentBlockhash) {
      const { blockhash } = await this.connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
    }

    // Set fee payer if not set
    if (!transaction.feePayer) {
      transaction.feePayer = this.publicKey
    }

    // Serialize the transaction message for signing
    const message = transaction.compileMessage()
    const messageBytes = message.serialize()

    // Sign via KMS - no private key in this process
    const signature = await this.config.kmsSigner.sign(messageBytes)

    // Add the signature to the transaction
    transaction.addSignature(this.publicKey, Buffer.from(signature))

    return transaction
  }

  /**
   * Sign a versioned transaction using KMS
   */
  async signVersionedTransaction(
    transaction: VersionedTransaction,
  ): Promise<VersionedTransaction> {
    // Serialize the message for signing
    const messageBytes = transaction.message.serialize()

    // Sign via KMS
    const signature = await this.config.kmsSigner.sign(messageBytes)

    // Add the signature
    transaction.addSignature(this.publicKey, signature)

    return transaction
  }

  /**
   * Send a signed transaction
   */
  async sendTransaction(transaction: Transaction): Promise<string> {
    // Sign the transaction
    const signedTx = await this.signTransaction(transaction)

    // Send and confirm
    const signature = await this.connection.sendRawTransaction(
      signedTx.serialize(),
      { skipPreflight: false, maxRetries: 3 },
    )

    await this.connection.confirmTransaction(
      signature,
      this.config.commitment ?? 'confirmed',
    )

    return signature
  }

  /**
   * Send a versioned transaction
   */
  async sendVersionedTransaction(
    transaction: VersionedTransaction,
  ): Promise<string> {
    // Sign the transaction
    const signedTx = await this.signVersionedTransaction(transaction)

    // Send and confirm
    const signature = await this.connection.sendRawTransaction(
      signedTx.serialize(),
      { skipPreflight: false, maxRetries: 3 },
    )

    await this.connection.confirmTransaction(
      signature,
      this.config.commitment ?? 'confirmed',
    )

    return signature
  }

  /**
   * Send an instruction as a transaction
   */
  async sendInstruction(instruction: TransactionInstruction): Promise<string> {
    const transaction = new Transaction().add(instruction)
    return this.sendTransaction(transaction)
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<bigint> {
    const balance = await this.connection.getBalance(this.publicKey)
    return BigInt(balance)
  }

  /**
   * Get the KMS key ID
   */
  getKeyId(): string {
    return this.config.kmsSigner.keyId
  }
}

/**
 * Remote KMS Ed25519 Signer
 *
 * Connects to a remote KMS endpoint for Ed25519 signing.
 */
export interface RemoteKMSEd25519Config {
  endpoint: string
  apiKey?: string
  timeoutMs?: number
}

/**
 * Create a remote KMS Ed25519 signer
 */
export function createRemoteKMSEd25519Signer(
  config: RemoteKMSEd25519Config,
  keyId: string,
  publicKey: Uint8Array,
): KMSEd25519Signer {
  const { endpoint, apiKey, timeoutMs = 30000 } = config

  return {
    keyId,
    publicKey,

    async sign(message: Uint8Array): Promise<Uint8Array> {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        }
        if (apiKey) {
          headers.Authorization = `Bearer ${apiKey}`
        }

        const response = await fetch(`${endpoint}/sign-ed25519`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            keyId,
            message: Buffer.from(message).toString('base64'),
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const error = await response.text()
          throw new Error(
            `KMS Ed25519 signing failed: ${response.status} - ${error}`,
          )
        }

        const result = (await response.json()) as { signature: string }
        return new Uint8Array(Buffer.from(result.signature, 'base64'))
      } finally {
        clearTimeout(timeoutId)
      }
    },
  }
}

/**
 * Initialize a remote KMS Ed25519 signer
 *
 * Fetches or creates the key from the remote endpoint.
 */
export async function initializeRemoteKMSEd25519Signer(
  config: RemoteKMSEd25519Config,
  keyId: string,
): Promise<KMSEd25519Signer> {
  const { endpoint, apiKey, timeoutMs = 30000 } = config
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    // Try to get existing key
    const response = await fetch(
      `${endpoint}/keys/ed25519/${encodeURIComponent(keyId)}`,
      {
        method: 'GET',
        headers,
        signal: controller.signal,
      },
    )

    if (!response.ok) {
      // Key doesn't exist, create it
      if (response.status === 404) {
        const createResponse = await fetch(`${endpoint}/keys/ed25519`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ keyId }),
          signal: controller.signal,
        })

        if (!createResponse.ok) {
          const error = await createResponse.text()
          throw new Error(
            `KMS Ed25519 key creation failed: ${createResponse.status} - ${error}`,
          )
        }

        const keyInfo = (await createResponse.json()) as {
          keyId: string
          publicKey: string
        }

        const publicKey = new Uint8Array(
          Buffer.from(keyInfo.publicKey, 'base64'),
        )
        return createRemoteKMSEd25519Signer(config, keyId, publicKey)
      }

      const error = await response.text()
      throw new Error(
        `KMS Ed25519 key lookup failed: ${response.status} - ${error}`,
      )
    }

    const keyInfo = (await response.json()) as {
      keyId: string
      publicKey: string
    }

    const publicKey = new Uint8Array(Buffer.from(keyInfo.publicKey, 'base64'))
    return createRemoteKMSEd25519Signer(config, keyId, publicKey)
  } finally {
    clearTimeout(timeoutId)
  }
}

export function createKMSSolanaClient(
  config: KMSSolanaClientConfig,
): KMSSolanaClient {
  return new KMSSolanaClient(config)
}
