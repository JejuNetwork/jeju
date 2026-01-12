/**
 * TEE Inference Client
 *
 * Client for TEE-backed inference requests in the Babylon marketplace.
 * Routes requests to verified TEE providers and handles attestation validation.
 *
 * Features:
 * - Query ComputeRegistry for active TEE providers
 * - Route inference requests to verified TEE nodes
 * - Verify attestation on response
 * - Handle settlement via InferenceServing.sol
 */

import {
  createTypedPublicClient,
  createTypedWalletClient,
  readContract,
  writeContract,
} from '@jejunetwork/contracts/viem'
import {
  createDCAPVerifier,
  type DCAPVerifier,
  type TrustedMeasurement,
} from '@jejunetwork/zksolbridge/tee'
import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

export interface TEEInferenceConfig {
  /** RPC URL for chain access */
  rpcUrl: string
  /** Chain ID */
  chainId: number
  /** ComputeRegistry contract address */
  computeRegistryAddress: Address
  /** InferenceServing contract address */
  inferenceServingAddress: Address
  /** LedgerManager contract address */
  ledgerAddress: Address
  /** Operator private key for settlements */
  operatorPrivateKey?: `0x${string}`
  /** Request timeout in ms */
  timeout?: number
  /** Require TEE verification */
  requireTEE?: boolean
  /** Preferred TEE platforms */
  preferredPlatforms?: number[]
  /** Maximum price per token (wei) */
  maxPricePerToken?: bigint
  /** Trusted measurements for DCAP verification */
  trustedMeasurements?: TrustedMeasurement[]
  /** Allow test mode (skip strict DCAP verification) */
  allowTestMode?: boolean
}

export interface TEEProvider {
  address: Address
  name: string
  endpoint: string
  teePlatform: number
  mrEnclave: string
  mrSigner: string
  teeVerified: boolean
  pricePerInputToken: bigint
  pricePerOutputToken: bigint
  maxContextLength: number
}

export interface InferenceRequest {
  /** Model to use */
  model?: string
  /** Input prompt or messages */
  messages: Array<{ role: string; content: string }>
  /** Maximum tokens to generate */
  maxTokens?: number
  /** Temperature for sampling */
  temperature?: number
  /** Stop sequences */
  stop?: string[]
  /** Stream response */
  stream?: boolean
  /** Custom user data to include in attestation */
  userData?: string
}

export interface InferenceResponse {
  /** Generated content */
  content: string
  /** Model used */
  model: string
  /** Input token count */
  inputTokens: number
  /** Output token count */
  outputTokens: number
  /** Total cost in wei */
  totalCost: bigint
  /** Provider address */
  provider: Address
  /** TEE attestation */
  attestation: TEEAttestation
  /** Request hash for settlement */
  requestHash: `0x${string}`
  /** Finish reason */
  finishReason: 'stop' | 'length' | 'content_filter'
}

export interface TEEAttestation {
  /** Quote bytes (hex encoded) */
  quote: string
  /** Enclave measurement */
  mrEnclave: string
  /** Signer measurement */
  mrSigner: string
  /** Report data */
  reportData: string
  /** Attestation timestamp */
  timestamp: number
  /** Whether attestation is verified */
  verified: boolean
}

export interface SettlementResult {
  /** Transaction hash */
  txHash: `0x${string}`
  /** Settlement amount */
  amount: bigint
  /** Provider fee */
  providerFee: bigint
  /** Platform fee */
  platformFee: bigint
}

// ============================================================================
// ABI Definitions
// ============================================================================

const COMPUTE_REGISTRY_ABI = [
  {
    name: 'getTEEVerifiedProviders',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getTEEVerifiedProvidersByService',
    type: 'function',
    inputs: [{ name: 'serviceType', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    name: 'providers',
    type: 'function',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'name', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'attestationHash', type: 'bytes32' },
      { name: 'stake', type: 'uint256' },
      { name: 'registeredAt', type: 'uint256' },
      { name: 'agentId', type: 'uint256' },
      { name: 'serviceType', type: 'bytes32' },
      { name: 'active', type: 'bool' },
      { name: 'nodeId', type: 'bytes32' },
      { name: 'teePlatform', type: 'uint8' },
      { name: 'mrEnclave', type: 'bytes32' },
      { name: 'mrSigner', type: 'bytes32' },
      { name: 'teeVerified', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getCapabilities',
    type: 'function',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'model', type: 'string' },
          { name: 'pricePerInputToken', type: 'uint256' },
          { name: 'pricePerOutputToken', type: 'uint256' },
          { name: 'maxContextLength', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'SERVICE_INFERENCE',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
] as const

const INFERENCE_SERVING_ABI = [
  {
    name: 'settle',
    type: 'function',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'requestHash', type: 'bytes32' },
      { name: 'inputTokens', type: 'uint256' },
      { name: 'outputTokens', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getNonce',
    type: 'function',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'provider', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'calculateFee',
    type: 'function',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'inputTokens', type: 'uint256' },
      { name: 'outputTokens', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

const LEDGER_ABI = [
  {
    name: 'acknowledge',
    type: 'function',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'deposit',
    type: 'function',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'getProviderBalance',
    type: 'function',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'provider', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'isAcknowledged',
    type: 'function',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'provider', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const

// ============================================================================
// Response Schema
// ============================================================================

const TEEInferenceResponseSchema = z.object({
  content: z.string(),
  model: z.string(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  finish_reason: z.enum(['stop', 'length', 'content_filter']),
  attestation: z.object({
    quote: z.string(),
    mr_enclave: z.string(),
    mr_signer: z.string(),
    report_data: z.string(),
    timestamp: z.number(),
    signature: z.string(),
  }),
  request_hash: z.string(),
  settlement_signature: z.string(),
})

// ============================================================================
// TEE Inference Client
// ============================================================================

export class TEEInferenceClient {
  private config: TEEInferenceConfig
  private publicClient: PublicClient
  private walletClient: WalletClient | null = null
  private providerCache: Map<Address, TEEProvider> = new Map()
  private cacheExpiry = 0
  private dcapVerifier: DCAPVerifier | null = null

  constructor(config: TEEInferenceConfig) {
    this.config = {
      timeout: 60000,
      requireTEE: true,
      allowTestMode: false,
      ...config,
    }

    this.publicClient = createTypedPublicClient({
      chainId: config.chainId,
      rpcUrl: config.rpcUrl,
      chainName: 'Jeju',
    }) as PublicClient

    if (config.operatorPrivateKey) {
      const account = privateKeyToAccount(config.operatorPrivateKey)
      this.walletClient = createTypedWalletClient({
        chainId: config.chainId,
        rpcUrl: config.rpcUrl,
        chainName: 'Jeju',
        account,
      }) as WalletClient
    }

    // Initialize DCAP verifier if trusted measurements provided
    if (config.trustedMeasurements && config.trustedMeasurements.length > 0) {
      this.dcapVerifier = createDCAPVerifier(config.trustedMeasurements, {
        allowTestMode: config.allowTestMode ?? false,
        maxQuoteAge: 24 * 60 * 60, // 24 hours
        requireFreshQuote: true,
      })
    }
  }

  /**
   * Get available TEE providers
   */
  async getProviders(refresh = false): Promise<TEEProvider[]> {
    if (
      !refresh &&
      this.providerCache.size > 0 &&
      Date.now() < this.cacheExpiry
    ) {
      return Array.from(this.providerCache.values())
    }

    // Get inference service type hash
    const serviceType = await readContract(this.publicClient, {
      address: this.config.computeRegistryAddress,
      abi: COMPUTE_REGISTRY_ABI,
      functionName: 'SERVICE_INFERENCE',
    })

    // Get TEE verified providers
    const addresses = (await readContract(this.publicClient, {
      address: this.config.computeRegistryAddress,
      abi: COMPUTE_REGISTRY_ABI,
      functionName: 'getTEEVerifiedProvidersByService',
      args: [serviceType],
    })) as Address[]

    const providers: TEEProvider[] = []

    for (const address of addresses) {
      const [providerData, capabilities] = await Promise.all([
        readContract(this.publicClient, {
          address: this.config.computeRegistryAddress,
          abi: COMPUTE_REGISTRY_ABI,
          functionName: 'providers',
          args: [address],
        }),
        readContract(this.publicClient, {
          address: this.config.computeRegistryAddress,
          abi: COMPUTE_REGISTRY_ABI,
          functionName: 'getCapabilities',
          args: [address],
        }),
      ])

      const data = providerData as readonly [
        Address,
        string,
        string,
        `0x${string}`,
        bigint,
        bigint,
        bigint,
        `0x${string}`,
        boolean,
        `0x${string}`,
        number,
        `0x${string}`,
        `0x${string}`,
        boolean,
      ]

      const caps = capabilities as readonly {
        model: string
        pricePerInputToken: bigint
        pricePerOutputToken: bigint
        maxContextLength: bigint
        active: boolean
      }[]

      const activeCapability = caps.find((c) => c.active)

      const provider: TEEProvider = {
        address,
        name: data[1],
        endpoint: data[2],
        teePlatform: data[10],
        mrEnclave: data[11],
        mrSigner: data[12],
        teeVerified: data[13],
        pricePerInputToken: activeCapability?.pricePerInputToken ?? 0n,
        pricePerOutputToken: activeCapability?.pricePerOutputToken ?? 0n,
        maxContextLength: Number(activeCapability?.maxContextLength ?? 0n),
      }

      providers.push(provider)
      this.providerCache.set(address, provider)
    }

    this.cacheExpiry = Date.now() + 60000 // 1 minute cache

    return providers
  }

  /**
   * Select best provider for request
   */
  async selectProvider(
    _model?: string,
    contextLength?: number,
  ): Promise<TEEProvider | null> {
    const providers = await this.getProviders()

    // Filter by requirements
    let filtered = providers.filter((p) => p.teeVerified)

    if (
      this.config.preferredPlatforms &&
      this.config.preferredPlatforms.length > 0
    ) {
      const platformFiltered = filtered.filter((p) =>
        this.config.preferredPlatforms?.includes(p.teePlatform),
      )
      if (platformFiltered.length > 0) {
        filtered = platformFiltered
      }
    }

    if (contextLength) {
      filtered = filtered.filter((p) => p.maxContextLength >= contextLength)
    }

    if (this.config.maxPricePerToken) {
      filtered = filtered.filter(
        (p) =>
          p.pricePerInputToken <= this.config.maxPricePerToken! &&
          p.pricePerOutputToken <= this.config.maxPricePerToken!,
      )
    }

    if (filtered.length === 0) {
      return null
    }

    // Sort by price (cheapest first)
    filtered.sort((a, b) => {
      const aTotal = a.pricePerInputToken + a.pricePerOutputToken
      const bTotal = b.pricePerInputToken + b.pricePerOutputToken
      return aTotal < bTotal ? -1 : aTotal > bTotal ? 1 : 0
    })

    return filtered[0]
  }

  /**
   * Send inference request
   */
  async inference(request: InferenceRequest): Promise<InferenceResponse> {
    // Estimate context length
    const estimatedContext = request.messages.reduce(
      (sum, m) => sum + m.content.length / 4,
      0,
    )

    // Select provider
    const provider = await this.selectProvider(request.model, estimatedContext)
    if (!provider) {
      throw new Error('No suitable TEE provider found')
    }

    // Prepare request
    const requestBody = {
      model: request.model,
      messages: request.messages,
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0.7,
      stop: request.stop,
      stream: request.stream ?? false,
      user_data: request.userData,
      require_attestation: true,
    }

    // Send request to provider
    const timeout = this.config.timeout ?? 60000
    const response = await fetch(`${provider.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeout),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Inference failed: ${response.status} - ${errorText}`)
    }

    const rawData: unknown = await response.json()
    const data = TEEInferenceResponseSchema.parse(rawData)

    // Verify attestation
    const attestation: TEEAttestation = {
      quote: data.attestation.quote,
      mrEnclave: data.attestation.mr_enclave,
      mrSigner: data.attestation.mr_signer,
      reportData: data.attestation.report_data,
      timestamp: data.attestation.timestamp,
      verified: this.verifyAttestation(data.attestation, provider),
    }

    if (this.config.requireTEE && !attestation.verified) {
      throw new Error('TEE attestation verification failed')
    }

    // Calculate cost
    const totalCost = await readContract(this.publicClient, {
      address: this.config.inferenceServingAddress,
      abi: INFERENCE_SERVING_ABI,
      functionName: 'calculateFee',
      args: [
        provider.address,
        BigInt(data.input_tokens),
        BigInt(data.output_tokens),
      ],
    })

    return {
      content: data.content,
      model: data.model,
      inputTokens: data.input_tokens,
      outputTokens: data.output_tokens,
      totalCost,
      provider: provider.address,
      attestation,
      requestHash: data.request_hash as `0x${string}`,
      finishReason: data.finish_reason,
    }
  }

  /**
   * Verify attestation using DCAP verification when available
   *
   * Verification steps:
   * 1. Check mrEnclave matches provider registration
   * 2. Check mrSigner matches provider registration
   * 3. Check timestamp freshness
   * 4. If DCAP verifier configured, verify cryptographic signature
   */
  private verifyAttestation(
    attestation: {
      quote: string
      mr_enclave: string
      mr_signer: string
      timestamp: number
    },
    provider: TEEProvider,
  ): boolean {
    // Check mrEnclave matches provider
    if (
      attestation.mr_enclave.toLowerCase() !== provider.mrEnclave.toLowerCase()
    ) {
      console.error('[TEE] mrEnclave mismatch:', {
        expected: provider.mrEnclave,
        actual: attestation.mr_enclave,
      })
      return false
    }

    // Check mrSigner matches
    if (
      attestation.mr_signer.toLowerCase() !== provider.mrSigner.toLowerCase()
    ) {
      console.error('[TEE] mrSigner mismatch:', {
        expected: provider.mrSigner,
        actual: attestation.mr_signer,
      })
      return false
    }

    // Check timestamp freshness (within 1 hour)
    const maxAge = 60 * 60 * 1000
    if (Date.now() - attestation.timestamp > maxAge) {
      console.error('[TEE] Attestation too old:', {
        age: Date.now() - attestation.timestamp,
        maxAge,
      })
      return false
    }

    // If DCAP verifier is configured, perform cryptographic verification
    if (this.dcapVerifier && attestation.quote) {
      const quoteBytes = hexToBytes(attestation.quote)
      const result = this.dcapVerifier.verify(quoteBytes)

      if (!result.valid) {
        console.error('[TEE] DCAP verification failed:', result.errors)
        return false
      }

      // Verify DCAP result matches provider
      if (result.mrEnclave.toLowerCase() !== provider.mrEnclave.toLowerCase()) {
        console.error('[TEE] DCAP mrEnclave mismatch')
        return false
      }

      console.log('[TEE] DCAP verification passed:', {
        platform: result.platform,
        signatureValid: result.details.signatureValid,
        certChainValid: result.details.certChainValid,
      })
    } else if (this.config.requireTEE && !this.config.allowTestMode) {
      // No DCAP verifier but TEE required - warn but allow if measurements match
      console.warn(
        '[TEE] No DCAP verifier configured - relying on measurement matching only. ' +
          'Configure trustedMeasurements for cryptographic verification.',
      )
    }

    return true
  }

  /**
   * Settle inference payment
   */
  async settle(
    response: InferenceResponse,
    signature: `0x${string}`,
  ): Promise<SettlementResult> {
    if (!this.walletClient) {
      throw new Error('Wallet client not configured for settlements')
    }

    const account = this.walletClient.account
    if (!account) {
      throw new Error('No account configured')
    }

    // Get current nonce
    const nonce = await readContract(this.publicClient, {
      address: this.config.inferenceServingAddress,
      abi: INFERENCE_SERVING_ABI,
      functionName: 'getNonce',
      args: [account.address, response.provider],
    })

    // Ensure acknowledged
    const isAcknowledged = await readContract(this.publicClient, {
      address: this.config.ledgerAddress,
      abi: LEDGER_ABI,
      functionName: 'isAcknowledged',
      args: [account.address, response.provider],
    })

    if (!isAcknowledged) {
      const ackHash = await writeContract(this.walletClient, {
        address: this.config.ledgerAddress,
        abi: LEDGER_ABI,
        functionName: 'acknowledge',
        args: [response.provider],
      })
      await this.publicClient.waitForTransactionReceipt({ hash: ackHash })
    }

    // Check balance
    const balance = await readContract(this.publicClient, {
      address: this.config.ledgerAddress,
      abi: LEDGER_ABI,
      functionName: 'getProviderBalance',
      args: [account.address, response.provider],
    })

    if (balance < response.totalCost) {
      // Deposit required funds
      const depositAmount = response.totalCost - balance + 10000000000000000n // Add 0.01 ETH buffer
      const depositHash = await writeContract(this.walletClient, {
        address: this.config.ledgerAddress,
        abi: LEDGER_ABI,
        functionName: 'deposit',
        args: [response.provider],
        value: depositAmount,
      })
      await this.publicClient.waitForTransactionReceipt({ hash: depositHash })
    }

    // Settle
    const txHash = await writeContract(this.walletClient, {
      address: this.config.inferenceServingAddress,
      abi: INFERENCE_SERVING_ABI,
      functionName: 'settle',
      args: [
        response.provider,
        response.requestHash,
        BigInt(response.inputTokens),
        BigInt(response.outputTokens),
        nonce,
        signature,
      ],
    })

    await this.publicClient.waitForTransactionReceipt({ hash: txHash })

    // Estimate fees (would need actual contract to calculate)
    const platformFee = response.totalCost / 100n // ~1% platform fee
    const providerFee = response.totalCost - platformFee

    return {
      txHash,
      amount: response.totalCost,
      providerFee,
      platformFee,
    }
  }

  /**
   * Get user balance with provider
   */
  async getBalance(provider: Address): Promise<bigint> {
    if (!this.walletClient?.account) {
      throw new Error('Wallet client not configured')
    }

    return readContract(this.publicClient, {
      address: this.config.ledgerAddress,
      abi: LEDGER_ABI,
      functionName: 'getProviderBalance',
      args: [this.walletClient.account.address, provider],
    })
  }

  /**
   * Deposit funds for provider
   */
  async deposit(provider: Address, amount: bigint): Promise<Hex> {
    if (!this.walletClient) {
      throw new Error('Wallet client not configured')
    }

    const hash = await writeContract(this.walletClient, {
      address: this.config.ledgerAddress,
      abi: LEDGER_ABI,
      functionName: 'deposit',
      args: [provider],
      value: amount,
    })

    await this.publicClient.waitForTransactionReceipt({ hash })
    return hash
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

// ============================================================================
// Factory Function
// ============================================================================

export function createTEEInferenceClient(
  config: TEEInferenceConfig,
): TEEInferenceClient {
  return new TEEInferenceClient(config)
}
