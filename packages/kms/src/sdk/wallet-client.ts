/**
 * KMS Wallet Client - viem-compatible wallet backed by KMS
 *
 * This provides a drop-in replacement for viem WalletClient that delegates
 * all signing operations to KMS (MPC/TEE), ensuring private keys are NEVER
 * handled locally.
 *
 * MIGRATION GUIDE:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * BEFORE (insecure - private key in memory):
 *   const account = privateKeyToAccount(privateKey)
 *   const client = createWalletClient({ account, chain, transport })
 *
 * AFTER (secure - KMS signing):
 *   const { client, account } = await createKMSWalletClient({
 *     serviceId: 'my-service',
 *     chain,
 *     rpcUrl,
 *   })
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import type {
  Address,
  Chain,
  Hash,
  Hex,
  LocalAccount,
  PublicClient,
  TypedDataDefinition,
  WalletClient,
  WriteContractParameters,
} from 'viem'
import { createPublicClient, createWalletClient, http } from 'viem'
import { createKMSSigner, type SigningMode } from './signer.js'

// ════════════════════════════════════════════════════════════════════════════
//                              TYPES
// ════════════════════════════════════════════════════════════════════════════

export interface KMSWalletClientConfig {
  /** Service identifier for KMS key lookup */
  serviceId: string
  /** Chain to connect to */
  chain: Chain
  /** RPC URL for the chain */
  rpcUrl: string
  /** KMS endpoint (defaults to KMS_ENDPOINT env var) */
  kmsEndpoint?: string
  /** Request timeout in milliseconds */
  timeoutMs?: number
}

export interface KMSWalletClientResult {
  /** viem WalletClient backed by KMS */
  client: WalletClient
  /** viem PublicClient for read operations */
  publicClient: PublicClient
  /** The KMS-backed account */
  account: LocalAccount
  /** The signer's address */
  address: Address
  /** Current signing mode */
  mode: SigningMode
  /** Service ID */
  serviceId: string
  /** Key ID in KMS */
  keyId: string
}

// ════════════════════════════════════════════════════════════════════════════
//                         KMS WALLET CLIENT FACTORY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a viem WalletClient backed by KMS
 *
 * This is the PRIMARY INTERFACE for production signing operations.
 * Use this instead of createWalletClient with privateKeyToAccount.
 *
 * @example
 * ```typescript
 * const { client, account, address } = await createKMSWalletClient({
 *   serviceId: 'oracle-operator',
 *   chain: mainnet,
 *   rpcUrl: 'https://eth.llamarpc.com',
 * })
 *
 * // Use like any viem WalletClient
 * const hash = await client.sendTransaction({
 *   to: recipient,
 *   value: parseEther('1'),
 * })
 *
 * // Write to contracts
 * const txHash = await client.writeContract({
 *   address: contractAddress,
 *   abi: contractAbi,
 *   functionName: 'transfer',
 *   args: [recipient, amount],
 * })
 * ```
 */
export async function createKMSWalletClient(
  config: KMSWalletClientConfig,
): Promise<KMSWalletClientResult> {
  // Create and initialize the signer
  const signer = createKMSSigner({
    serviceId: config.serviceId,
    endpoint: config.kmsEndpoint,
    timeoutMs: config.timeoutMs,
  })

  await signer.initialize()

  // Create the KMS-backed account
  const account = signer.getViemAccount()
  const address = signer.getAddress()
  const keyId = signer.getKeyId()
  const mode = signer.getMode()

  // Create public client for read operations
  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  })

  // Create wallet client with KMS account
  const client = createWalletClient({
    account,
    chain: config.chain,
    transport: http(config.rpcUrl),
  })

  return {
    client,
    publicClient,
    account,
    address,
    mode,
    serviceId: config.serviceId,
    keyId,
  }
}

// ════════════════════════════════════════════════════════════════════════════
//                   EXTENDED KMS WALLET CLIENT CLASS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extended KMS Wallet Client with additional utilities
 *
 * Use this when you need more control over the wallet client lifecycle,
 * or when you need to access KMS-specific functionality.
 */
export class ExtendedKMSWalletClient {
  private readonly signer: ReturnType<typeof createKMSSigner>
  private readonly chain: Chain
  private readonly rpcUrl: string
  private initialized = false

  private _publicClient: PublicClient | null = null
  private _walletClient: WalletClient | null = null
  private _account: LocalAccount | null = null

  constructor(config: KMSWalletClientConfig) {
    this.signer = createKMSSigner({
      serviceId: config.serviceId,
      endpoint: config.kmsEndpoint,
      timeoutMs: config.timeoutMs,
    })
    this.chain = config.chain
    this.rpcUrl = config.rpcUrl
  }

  /**
   * Initialize the wallet client
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    await this.signer.initialize()

    this._account = this.signer.getViemAccount()

    this._publicClient = createPublicClient({
      chain: this.chain,
      transport: http(this.rpcUrl),
    })

    this._walletClient = createWalletClient({
      account: this._account,
      chain: this.chain,
      transport: http(this.rpcUrl),
    })

    this.initialized = true
  }

  /**
   * Validate initialization and return validated clients
   * Fail fast if not properly initialized
   */
  private getValidatedState(): {
    publicClient: PublicClient
    walletClient: WalletClient
    account: LocalAccount
  } {
    if (!this.initialized) {
      throw new Error(
        'ExtendedKMSWalletClient not initialized. Call initialize() first.',
      )
    }
    if (!this._publicClient) {
      throw new Error('PublicClient not initialized - initialization failed')
    }
    if (!this._walletClient) {
      throw new Error('WalletClient not initialized - initialization failed')
    }
    if (!this._account) {
      throw new Error('Account not initialized - initialization failed')
    }
    return {
      publicClient: this._publicClient,
      walletClient: this._walletClient,
      account: this._account,
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  //                            ACCESSORS
  // ──────────────────────────────────────────────────────────────────────────

  get publicClient(): PublicClient {
    return this.getValidatedState().publicClient
  }

  get walletClient(): WalletClient {
    return this.getValidatedState().walletClient
  }

  get account(): LocalAccount {
    return this.getValidatedState().account
  }

  get address(): Address {
    this.getValidatedState()
    return this.signer.getAddress()
  }

  get keyId(): string {
    this.getValidatedState()
    return this.signer.getKeyId()
  }

  get mode(): SigningMode {
    return this.signer.getMode()
  }

  // ──────────────────────────────────────────────────────────────────────────
  //                         TRANSACTION METHODS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Send a transaction
   */
  async sendTransaction(args: {
    to: Address
    value?: bigint
    data?: Hex
    gas?: bigint
    maxFeePerGas?: bigint
    maxPriorityFeePerGas?: bigint
  }): Promise<Hash> {
    const { walletClient, account } = this.getValidatedState()

    return walletClient.sendTransaction({
      account,
      chain: this.chain,
      ...args,
    })
  }

  /**
   * Write to a contract
   */
  async writeContract<TAbi extends readonly unknown[]>(args: {
    address: Address
    abi: TAbi
    functionName: string
    args?: readonly unknown[]
    value?: bigint
    gas?: bigint
  }): Promise<Hash> {
    const { walletClient, account } = this.getValidatedState()

    return walletClient.writeContract({
      account,
      chain: this.chain,
      ...args,
    } as WriteContractParameters)
  }

  /**
   * Sign a message
   */
  async signMessage(message: string | Uint8Array): Promise<Hex> {
    this.getValidatedState()

    const result = await this.signer.signMessage(message)
    return result.signature
  }

  /**
   * Sign typed data (EIP-712)
   */
  async signTypedData(typedData: TypedDataDefinition): Promise<Hex> {
    this.getValidatedState()

    const result = await this.signer.signTypedData(typedData)
    return result.signature
  }

  // ──────────────────────────────────────────────────────────────────────────
  //                         READ METHODS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get the balance of the wallet
   */
  async getBalance(): Promise<bigint> {
    const { publicClient } = this.getValidatedState()

    return publicClient.getBalance({ address: this.address })
  }

  /**
   * Get the transaction count (nonce)
   */
  async getTransactionCount(): Promise<number> {
    const { publicClient } = this.getValidatedState()

    return publicClient.getTransactionCount({ address: this.address })
  }

  // ──────────────────────────────────────────────────────────────────────────
  //                            HEALTH & STATUS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Check KMS health
   */
  async checkHealth(): Promise<{
    healthy: boolean
    mode?: SigningMode
    threshold?: number
    activeParties?: number
  }> {
    return this.signer.checkHealth()
  }

  /**
   * Get wallet status
   */
  getStatus(): {
    initialized: boolean
    address: Address | null
    mode: SigningMode
    chain: string
  } {
    const signerStatus = this.signer.getStatus()
    return {
      initialized: this.initialized,
      address: signerStatus.address,
      mode: signerStatus.mode,
      chain: this.chain.name,
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
//                            UTILITY FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create clients for a service (both public and wallet)
 *
 * Convenience function that returns both public and wallet clients.
 */
export async function createKMSClients(
  serviceId: string,
  chain: Chain,
  rpcUrl: string,
): Promise<{
  publicClient: PublicClient
  walletClient: WalletClient
  account: LocalAccount
  address: Address
}> {
  const result = await createKMSWalletClient({
    serviceId,
    chain,
    rpcUrl,
  })

  return {
    publicClient: result.publicClient,
    walletClient: result.client,
    account: result.account,
    address: result.address,
  }
}

/**
 * Get the signer address for a service without initializing a full wallet client
 */
export async function getKMSSignerAddress(serviceId: string): Promise<Address> {
  const signer = createKMSSigner({ serviceId })
  await signer.initialize()
  return signer.getAddress()
}
