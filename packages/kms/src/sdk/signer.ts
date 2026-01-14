/**
 * KMS Signer - THE canonical interface for all Jeju signing operations
 *
 * SECURITY ARCHITECTURE:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * This signer NEVER exposes private keys. All signing operations use one of:
 *
 * 1. FROST MPC Threshold Signing (Production)
 *    - Private key distributed across 3-5 parties
 *    - Key is NEVER reconstructed, even during signing
 *    - Each party contributes a partial signature
 *    - Resistant to side-channel attacks when parties on separate hardware
 *
 * 2. TEE Hardware Isolation (Production)
 *    - Key sealed inside Intel SGX/AMD SEV/AWS Nitro enclave
 *    - Attestation required before any key operations
 *    - Memory encryption prevents physical attacks
 *
 * 3. Local Encrypted Mode (Development Only)
 *    - Key encrypted at rest with PBKDF2-derived key
 *    - BLOCKED in production environments
 *    - Logs warnings when used
 *
 * DEPLOYMENT REQUIREMENTS (Production):
 * - Set KMS_ENDPOINT to your KMS service URL
 * - Set KMS_SERVICE_ID to identify this service
 * - Ensure MPC parties are on SEPARATE physical hardware
 * - Enable TEE attestation verification
 *
 * MIGRATION:
 * - Replace all `privateKeyToAccount()` calls with `createKMSSigner()`
 * - Use `validateSecureSigning()` at startup to enforce KMS usage
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import {
  getCurrentNetwork,
  getEnvVar,
  getKmsServiceUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import type {
  Address,
  Chain,
  Hash,
  Hex,
  LocalAccount,
  SignableMessage,
  TransactionSerializable,
  TypedDataDefinition,
  WalletClient,
} from 'viem'
import {
  createPublicClient,
  createWalletClient,
  hashMessage,
  hashTypedData,
  http,
  keccak256,
  toBytes,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

// ════════════════════════════════════════════════════════════════════════════
//                              TYPES
// ════════════════════════════════════════════════════════════════════════════

export type SigningMode = 'mpc' | 'tee' | 'local-dev'

export interface KMSSignerConfig {
  /** Service identifier for key lookup in KMS */
  serviceId: string
  /** KMS API endpoint (defaults to KMS_ENDPOINT env var) */
  endpoint?: string
  /** Network for chain operations */
  network?: 'mainnet' | 'testnet' | 'localnet'
  /** Timeout for KMS requests in milliseconds */
  timeoutMs?: number
  /** Allow local development mode (BLOCKED in production) */
  allowLocalDev?: boolean
}

export interface SignResult {
  /** Full ECDSA signature (r + s + v) */
  signature: Hex
  /** Signature component r */
  r: Hex
  /** Signature component s */
  s: Hex
  /** Recovery ID (27 or 28) */
  v: number
  /** Signing mode used */
  mode: SigningMode
  /** Key ID that signed */
  keyId: string
  /** Timestamp of signature */
  signedAt: number
}

export interface TransactionSignResult {
  /** Serialized signed transaction ready for broadcast */
  signedTransaction: Hex
  /** Transaction hash */
  hash: Hash
  /** Signing mode used */
  mode: SigningMode
}

export interface KMSKeyInfo {
  /** Key identifier */
  keyId: string
  /** Public key (compressed, 33 bytes) */
  publicKey: Hex
  /** Ethereum address derived from public key */
  address: Address
  /** MPC threshold (e.g., 2 for 2-of-3) */
  threshold: number
  /** Total MPC parties */
  totalParties: number
  /** Key creation timestamp */
  createdAt: number
}

// Response validation schemas
const SignResponseSchema = z.object({
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  r: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  s: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  v: z.number().int().min(27).max(28),
  mode: z.enum(['mpc', 'tee', 'development']),
  keyId: z.string(),
})

const TransactionSignResponseSchema = z.object({
  signedTransaction: z.string().regex(/^0x[a-fA-F0-9]+$/),
  hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  mode: z.enum(['mpc', 'tee', 'development']),
})

const KeyInfoResponseSchema = z.object({
  keyId: z.string(),
  publicKey: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  threshold: z.number().int().positive().optional(),
  totalParties: z.number().int().positive().optional(),
  createdAt: z.number().optional(),
})

const HealthResponseSchema = z.object({
  healthy: z.boolean(),
  mode: z.enum(['mpc', 'tee', 'development']).optional(),
  threshold: z.number().optional(),
  activeParties: z.number().optional(),
})

// ════════════════════════════════════════════════════════════════════════════
//                              KMS SIGNER CLASS
// ════════════════════════════════════════════════════════════════════════════

/**
 * KMSSigner - The canonical signing interface for Jeju Network
 *
 * REPLACES: All app-specific kms-signer.ts, secure-signer.ts implementations
 *
 * Usage:
 * ```typescript
 * const signer = createKMSSigner({ serviceId: 'my-service' })
 * await signer.initialize()
 *
 * // Sign a message
 * const result = await signer.signMessage('Hello, World')
 *
 * // Sign a transaction
 * const txResult = await signer.signTransaction({ to: '0x...', value: 1n })
 *
 * // Get viem-compatible wallet client
 * const walletClient = await signer.getWalletClient(chain, rpcUrl)
 * ```
 */
export class KMSSigner {
  private readonly serviceId: string
  private readonly endpoint: string
  private readonly network: 'mainnet' | 'testnet' | 'localnet'
  private readonly timeoutMs: number
  private readonly allowLocalDev: boolean

  private initialized = false
  private keyId: string | null = null
  private address: Address | null = null
  private mode: SigningMode = 'mpc'

  constructor(config: KMSSignerConfig) {
    this.serviceId = config.serviceId
    this.endpoint = config.endpoint ?? getKmsServiceUrl()
    this.network = config.network ?? getCurrentNetwork()
    this.timeoutMs = config.timeoutMs ?? 30000
    this.allowLocalDev = config.allowLocalDev ?? false

    // SECURITY: Block local dev mode in production
    if (this.allowLocalDev && isProductionEnv()) {
      throw new Error(
        'SECURITY: allowLocalDev is forbidden in production. ' +
          'Configure KMS_ENDPOINT and ensure MPC cluster is available.',
      )
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  //                            INITIALIZATION
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Initialize the signer by connecting to KMS and retrieving/creating a key
   *
   * MUST be called before any signing operations.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Check KMS health first
    const health = await this.checkHealth()
    if (!health.healthy) {
      if (isProductionEnv()) {
        throw new Error(
          `KMS service unavailable at ${this.endpoint}. Production requires KMS.`,
        )
      }
      console.warn(
        `[KMSSigner] KMS unavailable at ${this.endpoint}. Using local-dev mode.`,
      )
      this.mode = 'local-dev'
    } else {
      this.mode = (health.mode as SigningMode) ?? 'mpc'
    }

    // Get or create key for this service
    const keyInfo = await this.getOrCreateKey()
    this.keyId = keyInfo.keyId
    this.address = keyInfo.address
    this.initialized = true

    console.log(`[KMSSigner] Initialized:`, {
      serviceId: this.serviceId,
      address: this.address,
      mode: this.mode,
      network: this.network,
    })
  }

  /**
   * Ensure the signer is initialized before operations
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('KMSSigner not initialized. Call initialize() first.')
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  //                            SIGNING OPERATIONS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Sign a message hash using FROST threshold signatures
   *
   * SECURITY: The private key is NEVER reconstructed.
   * Each MPC party contributes a partial signature that is aggregated.
   *
   * @param input - Either a Hash directly, or an object with { messageHash, metadata }
   */
  async sign(
    input: Hash | { messageHash: Hash; metadata?: Record<string, string> },
  ): Promise<SignResult> {
    this.ensureInitialized()

    const messageHash = typeof input === 'string' ? input : input.messageHash

    // Handle local-dev mode with local signing
    if (this.mode === 'local-dev') {
      return this.signLocal(messageHash)
    }

    const response = await this.kmsRequest('/sign', {
      serviceId: this.serviceId,
      keyId: this.keyId,
      messageHash,
    })

    const parsed = SignResponseSchema.parse(response)

    return {
      signature: parsed.signature as Hex,
      r: parsed.r as Hex,
      s: parsed.s as Hex,
      v: parsed.v,
      mode:
        parsed.mode === 'development'
          ? 'local-dev'
          : (parsed.mode as SigningMode),
      keyId: parsed.keyId,
      signedAt: Date.now(),
    }
  }

  /**
   * Sign locally for development mode
   */
  private async signLocal(messageHash: Hash): Promise<SignResult> {
    // In allowLocalDev mode, require an explicit local dev key (set by test harness / jeju cli).
    if (this.allowLocalDev) {
      const privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined
      if (
        !privateKey ||
        !privateKey.startsWith('0x') ||
        privateKey.length !== 66
      ) {
        throw new Error(
          'DEPLOYER_PRIVATE_KEY must be set for allowLocalDev local signing',
        )
      }
      const account = privateKeyToAccount(privateKey)
      const signature = await account.sign({ hash: messageHash })

      const r = `0x${signature.slice(2, 66)}` as Hex
      const s = `0x${signature.slice(66, 130)}` as Hex
      const v = parseInt(signature.slice(130, 132), 16)

      return {
        signature,
        r,
        s,
        v,
        mode: 'local-dev',
        keyId: this.keyId ?? `local-dev-${this.serviceId}`,
        signedAt: Date.now(),
      }
    }

    // Default local-dev mode: deterministic key per serviceId (useful for non-address-bound services)
    const seed = keccak256(
      toHex(`jeju-dev-${this.serviceId}-${this.network}`),
    ) as Hex
    const account = privateKeyToAccount(seed)

    const signature = await account.sign({ hash: messageHash })

    // Parse signature components (r, s, v)
    const r = `0x${signature.slice(2, 66)}` as Hex
    const s = `0x${signature.slice(66, 130)}` as Hex
    const v = parseInt(signature.slice(130, 132), 16)

    return {
      signature,
      r,
      s,
      v,
      mode: 'local-dev',
      keyId: this.keyId ?? `local-dev-${this.serviceId}`,
      signedAt: Date.now(),
    }
  }

  /**
   * Sign a raw message (will be hashed with Ethereum message prefix)
   */
  async signMessage(message: string | Uint8Array): Promise<SignResult> {
    this.ensureInitialized()

    const messageBytes =
      typeof message === 'string' ? toBytes(message) : message
    const messageHash = hashMessage({ raw: messageBytes })

    return this.sign(messageHash)
  }

  /**
   * Sign a transaction
   *
   * SECURITY: The transaction is serialized and its hash is signed.
   * The private key is NEVER exposed.
   */
  async signTransaction(
    transaction: TransactionSerializable,
  ): Promise<TransactionSignResult> {
    this.ensureInitialized()

    // Handle local-dev mode with local signing
    if (this.mode === 'local-dev') {
      return this.signTransactionLocal(transaction)
    }

    const response = await this.kmsRequest('/sign-transaction', {
      serviceId: this.serviceId,
      keyId: this.keyId,
      transaction: {
        ...transaction,
        value: transaction.value?.toString() ?? '0',
        gas: transaction.gas?.toString(),
        maxFeePerGas: transaction.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas?.toString(),
        gasPrice: transaction.gasPrice?.toString(),
      },
    })

    const parsed = TransactionSignResponseSchema.parse(response)

    return {
      signedTransaction: parsed.signedTransaction as Hex,
      hash: parsed.hash as Hash,
      mode:
        parsed.mode === 'development'
          ? 'local-dev'
          : (parsed.mode as SigningMode),
    }
  }

  /**
   * Sign transaction locally for development mode
   */
  private async signTransactionLocal(
    transaction: TransactionSerializable,
  ): Promise<TransactionSignResult> {
    // Generate the same deterministic key as getLocalDevKey
    const seed = keccak256(
      toHex(`jeju-dev-${this.serviceId}-${this.network}`),
    ) as Hex
    const account = privateKeyToAccount(seed)

    // Sign the transaction
    const signedTransaction = await account.signTransaction(transaction)
    const hash = keccak256(signedTransaction)

    return {
      signedTransaction,
      hash,
      mode: 'local-dev',
    }
  }

  /**
   * Sign EIP-712 typed data
   */
  async signTypedData(typedData: TypedDataDefinition): Promise<SignResult> {
    this.ensureInitialized()

    const hash = hashTypedData(typedData)
    return this.sign(hash)
  }

  /**
   * Sign and send a transaction to the network
   *
   * This is a convenience method that combines signing and broadcasting.
   * For more control, use signTransaction + manual broadcast.
   */
  async sendTransaction(
    request: { transaction: TransactionSerializable; chain: Chain },
    rpcUrl: string,
  ): Promise<Hash> {
    this.ensureInitialized()

    const result = await this.signTransaction(request.transaction)

    const publicClient = createPublicClient({
      chain: request.chain,
      transport: http(rpcUrl),
    })

    return publicClient.sendRawTransaction({
      serializedTransaction: result.signedTransaction,
    })
  }

  // ──────────────────────────────────────────────────────────────────────────
  //                            WALLET CLIENT
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get a viem WalletClient that delegates all signing to KMS
   *
   * This is the primary interface for contract interactions.
   *
   * @example
   * ```typescript
   * const walletClient = await signer.getWalletClient(chain, rpcUrl)
   * await walletClient.writeContract({
   *   address: contractAddress,
   *   abi,
   *   functionName: 'transfer',
   *   args: [recipient, amount],
   * })
   * ```
   */
  async getWalletClient(chain: Chain, rpcUrl: string): Promise<WalletClient> {
    this.ensureInitialized()

    const account = this.getViemAccount()

    return createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    })
  }

  /**
   * Get a viem LocalAccount that delegates all signing to KMS
   *
   * Use this when you need to pass an account to viem functions.
   */
  getViemAccount(): LocalAccount {
    this.ensureInitialized()
    if (!this.address) {
      throw new Error('Signer not initialized - address is undefined')
    }

    const address = this.address
    const self = this

    return {
      address,
      type: 'local',
      source: 'custom',
      publicKey: '0x' as Hex, // Not exposed for security

      async signMessage({
        message,
      }: {
        message: SignableMessage
      }): Promise<Hex> {
        let messageBytes: Uint8Array
        if (typeof message === 'string') {
          messageBytes = toBytes(message)
        } else if ('raw' in message) {
          messageBytes =
            typeof message.raw === 'string' ? toBytes(message.raw) : message.raw
        } else {
          messageBytes = toBytes(message)
        }
        const result = await self.signMessage(messageBytes)
        return result.signature
      },

      async signTransaction(tx: TransactionSerializable): Promise<Hex> {
        const result = await self.signTransaction(tx)
        return result.signedTransaction
      },

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viem's complex EIP-712 types
      async signTypedData(
        typedData: TypedDataDefinition | Record<string, unknown>,
      ): Promise<Hex> {
        const result = await self.signTypedData(
          typedData as TypedDataDefinition,
        )
        return result.signature
      },
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  //                            KEY MANAGEMENT
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get the address for this signer
   */
  getAddress(): Address {
    this.ensureInitialized()
    if (!this.address) {
      throw new Error('Signer not initialized - address is undefined')
    }
    return this.address
  }

  /**
   * Get the key ID for this signer
   */
  getKeyId(): string {
    this.ensureInitialized()
    if (!this.keyId) {
      throw new Error('Signer not initialized - keyId is undefined')
    }
    return this.keyId
  }

  /**
   * Get the current signing mode
   */
  getMode(): SigningMode {
    return this.mode
  }

  /**
   * Get key info from KMS
   */
  private async getOrCreateKey(): Promise<KMSKeyInfo> {
    // In local-dev mode, generate a deterministic key for testing
    if (this.mode === 'local-dev') {
      return this.getLocalDevKey()
    }

    const response = await this.kmsRequest('/keys', {
      serviceId: this.serviceId,
      action: 'get-or-create',
    })

    const parsed = KeyInfoResponseSchema.parse(response)

    return {
      keyId: parsed.keyId,
      publicKey: (parsed.publicKey ?? '0x') as Hex,
      address: parsed.address as Address,
      threshold: parsed.threshold ?? 2,
      totalParties: parsed.totalParties ?? 3,
      createdAt: parsed.createdAt ?? Date.now(),
    }
  }

  /**
   * Generate deterministic key for local development
   * Uses serviceId to generate a consistent key per service
   */
  private getLocalDevKey(): KMSKeyInfo {
    // In allowLocalDev mode, require an explicit local dev key (set by test harness / jeju cli).
    if (this.allowLocalDev) {
      const privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined
      if (
        !privateKey ||
        !privateKey.startsWith('0x') ||
        privateKey.length !== 66
      ) {
        throw new Error(
          'DEPLOYER_PRIVATE_KEY must be set for allowLocalDev local signing',
        )
      }
      const account = privateKeyToAccount(privateKey)
      const expectedAddress = process.env.TEST_WALLET_ADDRESS
      if (
        expectedAddress &&
        account.address.toLowerCase() !== expectedAddress.toLowerCase()
      ) {
        throw new Error(
          `DEPLOYER_PRIVATE_KEY does not match TEST_WALLET_ADDRESS (${account.address} != ${expectedAddress})`,
        )
      }

      console.warn(
        `[KMSSigner] Using LOCAL DEV deployer key for ${this.serviceId}. NOT secure for production.`,
      )

      return {
        keyId: `local-dev-${this.serviceId}`,
        publicKey: '0x' as Hex,
        address: account.address,
        threshold: 1,
        totalParties: 1,
        createdAt: Date.now(),
      }
    }

    // Default local-dev key: deterministic private key from serviceId
    const seed = keccak256(toHex(`jeju-dev-${this.serviceId}-${this.network}`))
    const account = privateKeyToAccount(seed as Hex)

    console.warn(
      `[KMSSigner] Using LOCAL DEV key for ${this.serviceId}. NOT secure for production.`,
    )

    return {
      keyId: `local-dev-${this.serviceId}`,
      publicKey: '0x' as Hex, // Not needed for local dev
      address: account.address,
      threshold: 1,
      totalParties: 1,
      createdAt: Date.now(),
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  //                            HEALTH & STATUS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Check KMS service health
   */
  async checkHealth(): Promise<{
    healthy: boolean
    available: boolean // Alias for healthy (backward compatibility)
    mode?: SigningMode
    threshold?: number
    activeParties?: number
  }> {
    try {
      const response = await fetch(`${this.endpoint}/health`, {
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        return { healthy: false, available: false }
      }

      const data: unknown = await response.json()
      const parsed = HealthResponseSchema.parse(data)
      const isHealthy = parsed.healthy

      return {
        healthy: isHealthy,
        available: isHealthy,
        mode:
          parsed.mode === 'development'
            ? 'local-dev'
            : (parsed.mode as SigningMode),
        threshold: parsed.threshold,
        activeParties: parsed.activeParties,
      }
    } catch {
      return { healthy: false, available: false }
    }
  }

  /**
   * Get signer status
   */
  getStatus(): {
    initialized: boolean
    serviceId: string
    address: Address | null
    mode: SigningMode
    network: string
  } {
    return {
      initialized: this.initialized,
      serviceId: this.serviceId,
      address: this.address,
      mode: this.mode,
      network: this.network,
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  //                            INTERNAL
  // ──────────────────────────────────────────────────────────────────────────

  private async kmsRequest(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.endpoint}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-ID': this.serviceId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        `KMS request to ${path} failed: ${response.status} - ${text}`,
      )
    }

    return response.json()
  }
}

// ════════════════════════════════════════════════════════════════════════════
//                            FACTORY FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

const signerCache = new Map<string, KMSSigner>()

/**
 * Create a KMSSigner for a service
 *
 * Service IDs should be unique and descriptive:
 * - 'oracle-worker' for oracle node worker
 * - 'faucet' for faucet service
 * - 'x402-facilitator' for payment facilitator
 *
 * @example
 * ```typescript
 * const signer = createKMSSigner({ serviceId: 'my-service' })
 * await signer.initialize()
 * const signature = await signer.signMessage('Hello')
 * ```
 */
export function createKMSSigner(config: KMSSignerConfig): KMSSigner {
  return new KMSSigner(config)
}

/**
 * Get or create a cached signer for a service
 *
 * Use this when you want to reuse the same signer instance across calls.
 */
export function getKMSSigner(serviceId: string): KMSSigner {
  let signer = signerCache.get(serviceId)
  if (!signer) {
    signer = createKMSSigner({ serviceId })
    signerCache.set(serviceId, signer)
  }
  return signer
}

/**
 * Reset all cached signers (for testing)
 */
export function resetKMSSigners(): void {
  signerCache.clear()
}

// ════════════════════════════════════════════════════════════════════════════
//                         SECURITY ENFORCEMENT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Validate that the application is configured for secure signing
 *
 * CALL THIS AT APPLICATION STARTUP to enforce KMS usage in production.
 *
 * @throws Error if production environment has insecure configuration
 */
export function validateSecureSigning(): void {
  const isProduction = isProductionEnv()

  if (!isProduction) {
    console.log('[Security] Development mode - local signing allowed')
    return
  }

  // In production, check for forbidden direct key usage
  const forbiddenEnvVars = [
    'PRIVATE_KEY',
    'OPERATOR_KEY',
    'WORKER_PRIVATE_KEY',
    'SOLVER_PRIVATE_KEY',
    'VERIFIER_PRIVATE_KEY',
    'ORACLE_PRIVATE_KEY',
    'DWS_PRIVATE_KEY',
    'TEE_VERIFIER_PRIVATE_KEY',
  ]

  const foundInsecureVars = forbiddenEnvVars.filter(
    (v) => process.env[v] && process.env[v]?.length === 66, // 0x + 64 hex chars
  )

  if (foundInsecureVars.length > 0) {
    throw new Error(
      `SECURITY VIOLATION: Raw private keys detected in environment: ${foundInsecureVars.join(', ')}. ` +
        'Production deployments MUST use KMS for signing. ' +
        'Replace privateKeyToAccount() with createKMSSigner().',
    )
  }

  // Ensure KMS is configured
  const kmsEndpoint = getEnvVar('KMS_ENDPOINT')
  if (!kmsEndpoint) {
    console.warn(
      '[Security] KMS_ENDPOINT not set. Using default KMS service URL.',
    )
  }

  console.log('[Security] Production mode - KMS signing enforced')
}

/**
 * Check if the current environment requires KMS signing
 */
export function requiresKMSSigning(): boolean {
  return isProductionEnv()
}
