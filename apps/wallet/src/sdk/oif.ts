/**
 * @fileoverview Open Intents Framework (OIF) SDK
 *
 * Enables intent-based cross-chain transactions:
 * - User submits an intent (desired outcome)
 * - Solver network finds optimal route
 * - Oracle attests to fulfillment
 * - Settlement happens atomically
 *
 * No manual bridging, routing, or chain switching required.
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { encodeAbiParameters, parseEther } from 'viem'
import { getChainContracts } from './chains'
import type { Intent, IntentParams, IntentQuote, IntentStatus } from './types'

// ============================================================================
// ABI Fragments
// ============================================================================

const INPUT_SETTLER_ABI = [
  {
    name: 'open',
    type: 'function',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'originSettler', type: 'address' },
          { name: 'user', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'originChainId', type: 'uint256' },
          { name: 'openDeadline', type: 'uint32' },
          { name: 'fillDeadline', type: 'uint32' },
          { name: 'orderDataType', type: 'bytes32' },
          { name: 'orderData', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'openFor',
    type: 'function',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'originSettler', type: 'address' },
          { name: 'user', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'originChainId', type: 'uint256' },
          { name: 'openDeadline', type: 'uint32' },
          { name: 'fillDeadline', type: 'uint32' },
          { name: 'orderDataType', type: 'bytes32' },
          { name: 'orderData', type: 'bytes' },
        ],
      },
      { name: 'signature', type: 'bytes' },
      { name: 'originFillerData', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getOrder',
    type: 'function',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'user', type: 'address' },
          { name: 'inputToken', type: 'address' },
          { name: 'inputAmount', type: 'uint256' },
          { name: 'outputToken', type: 'address' },
          { name: 'outputAmount', type: 'uint256' },
          { name: 'destinationChainId', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'maxFee', type: 'uint256' },
          { name: 'openDeadline', type: 'uint32' },
          { name: 'fillDeadline', type: 'uint32' },
          { name: 'solver', type: 'address' },
          { name: 'filled', type: 'bool' },
          { name: 'refunded', type: 'bool' },
          { name: 'createdBlock', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'canSettle',
    type: 'function',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'canRefund',
    type: 'function',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'refund',
    type: 'function',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getUserNonce',
    type: 'function',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

const SOLVER_REGISTRY_ABI = [
  {
    name: 'getSolver',
    type: 'function',
    inputs: [{ name: 'solver', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'solver', type: 'address' },
          { name: 'stake', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'successCount', type: 'uint256' },
          { name: 'failureCount', type: 'uint256' },
          { name: 'totalVolume', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getActiveSolvers',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
] as const

// ============================================================================
// Constants
// ============================================================================

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address
const SWAP_ORDER_TYPE =
  '0x43726f7373436861696e53776170000000000000000000000000000000000000' as Hex
const DEFAULT_OPEN_DEADLINE_BLOCKS = 50 // ~100 seconds
const DEFAULT_FILL_DEADLINE_BLOCKS = 200 // ~400 seconds

// ============================================================================
// OIF Client
// ============================================================================

export interface OIFClientConfig {
  chainId: number
  publicClient: PublicClient
  walletClient?: WalletClient
  inputSettlerAddress?: Address
  solverRegistryAddress?: Address
  quoteApiUrl?: string
}

export interface GaslessCrossChainOrder {
  originSettler: Address
  user: Address
  nonce: bigint
  originChainId: bigint
  openDeadline: number
  fillDeadline: number
  orderDataType: Hex
  orderData: Hex
}

export class OIFClient {
  private config: OIFClientConfig
  private inputSettlerAddress: Address
  private solverRegistryAddress: Address
  private quoteApiUrl: string
  private isConfigured: boolean

  constructor(config: OIFClientConfig) {
    this.config = config
    const contracts = getChainContracts(config.chainId)
    this.inputSettlerAddress =
      config.inputSettlerAddress ?? contracts.inputSettler ?? ZERO_ADDRESS
    this.solverRegistryAddress =
      config.solverRegistryAddress ?? contracts.solverRegistry ?? ZERO_ADDRESS
    this.quoteApiUrl = config.quoteApiUrl ?? 'http://localhost:4010/oif' // Local gateway

    // Track if contracts are actually configured
    this.isConfigured = this.inputSettlerAddress !== ZERO_ADDRESS

    if (!this.isConfigured) {
      console.warn(
        `[OIFClient] InputSettler not configured for chain ${config.chainId}. ` +
          `Intent creation will fail. Deploy contracts and update chainContracts.`,
      )
    }
  }

  /**
   * Check if the client is properly configured
   */
  isReady(): boolean {
    return this.isConfigured
  }

  /**
   * Get a quote for an intent
   * Queries solver network for optimal route and pricing
   */
  async getQuote(params: IntentParams): Promise<IntentQuote> {
    // In production, this calls the solver aggregator API
    // For now, return a simulated quote
    const response = await fetch(`${this.quoteApiUrl}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputToken: params.inputToken,
        inputAmount: params.inputAmount.toString(),
        outputToken: params.outputToken,
        minOutputAmount: params.minOutputAmount.toString(),
        sourceChainId: this.config.chainId,
        destinationChainId: params.destinationChainId,
        recipient: params.recipient,
      }),
    })

    if (!response.ok) {
      // Fallback to estimated quote
      return this.estimateQuote(params)
    }

    return response.json()
  }

  /**
   * Estimate a quote locally (fallback)
   */
  private estimateQuote(params: IntentParams): IntentQuote {
    // Simple estimate: 0.3% fee, same output as input (assumes 1:1 wrapped tokens)
    const fee = (params.inputAmount * 30n) / 10000n
    const outputAmount = params.inputAmount - fee

    return {
      inputToken: params.inputToken,
      inputAmount: params.inputAmount,
      outputToken: params.outputToken,
      outputAmount:
        outputAmount > params.minOutputAmount
          ? outputAmount
          : params.minOutputAmount,
      fee,
      route: [
        {
          chainId: this.config.chainId,
          protocol: 'jeju-oif',
          action: 'bridge',
          inputToken: params.inputToken,
          outputToken: params.outputToken,
          inputAmount: params.inputAmount,
          outputAmount,
        },
      ],
      estimatedTime: 120, // 2 minutes
      priceImpact: 0.003,
    }
  }

  /**
   * Create and submit an intent
   */
  async createIntent(
    params: IntentParams,
  ): Promise<{ intentId: Hex; txHash: Hex }> {
    if (!this.isConfigured) {
      throw new Error(
        `OIF not configured for chain ${this.config.chainId}. ` +
          `InputSettler contract address not set. Deploy contracts first.`,
      )
    }

    const { walletClient, publicClient } = this.config
    if (!walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const userAddress = walletClient.account.address
    const recipient = params.recipient ?? userAddress

    // Get user's current nonce
    const nonce = await this.getUserNonce(userAddress)

    // Get current block for deadline calculation
    const currentBlock = await publicClient.getBlockNumber()
    const openDeadline = Number(currentBlock) + DEFAULT_OPEN_DEADLINE_BLOCKS
    const fillDeadline = Number(currentBlock) + DEFAULT_FILL_DEADLINE_BLOCKS

    // Encode order data
    const orderData = encodeAbiParameters(
      [
        { type: 'address' }, // inputToken
        { type: 'uint256' }, // inputAmount
        { type: 'address' }, // outputToken
        { type: 'uint256' }, // outputAmount
        { type: 'uint256' }, // destinationChainId
        { type: 'address' }, // recipient
        { type: 'uint256' }, // maxFee
      ],
      [
        params.inputToken,
        params.inputAmount,
        params.outputToken,
        params.minOutputAmount,
        BigInt(params.destinationChainId),
        recipient,
        params.maxFee ?? parseEther('0.01'),
      ],
    )

    const order: GaslessCrossChainOrder = {
      originSettler: this.inputSettlerAddress,
      user: userAddress,
      nonce,
      originChainId: BigInt(this.config.chainId),
      openDeadline,
      fillDeadline,
      orderDataType: SWAP_ORDER_TYPE,
      orderData,
    }

    // For native token, ensure approval is not needed
    // For ERC20, caller must have approved InputSettler

    // Cast through const to satisfy strict ABI typing
    const args = [order] as const
    const hash = await walletClient.writeContract({
      chain: null,
      account: walletClient.account,
      address: this.inputSettlerAddress,
      abi: INPUT_SETTLER_ABI,
      functionName: 'open',
      args,
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    // Parse intentId from logs
    const intentId = (receipt.logs[0]?.topics[1] ?? '0x') as Hex

    return { intentId, txHash: hash }
  }

  /**
   * Create a gasless intent (signed by user, submitted by relayer)
   */
  async createGaslessIntent(
    params: IntentParams,
    signatureCallback: (order: GaslessCrossChainOrder) => Promise<Hex>,
  ): Promise<{ intentId: Hex; order: GaslessCrossChainOrder; signature: Hex }> {
    const { walletClient, publicClient } = this.config
    if (!walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const userAddress = walletClient.account.address
    const recipient = params.recipient ?? userAddress

    const nonce = await this.getUserNonce(userAddress)
    const currentBlock = await publicClient.getBlockNumber()

    const orderData = encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint256' },
      ],
      [
        params.inputToken,
        params.inputAmount,
        params.outputToken,
        params.minOutputAmount,
        BigInt(params.destinationChainId),
        recipient,
        params.maxFee ?? parseEther('0.01'),
      ],
    )

    const order: GaslessCrossChainOrder = {
      originSettler: this.inputSettlerAddress,
      user: userAddress,
      nonce,
      originChainId: BigInt(this.config.chainId),
      openDeadline: Number(currentBlock) + DEFAULT_OPEN_DEADLINE_BLOCKS,
      fillDeadline: Number(currentBlock) + DEFAULT_FILL_DEADLINE_BLOCKS,
      orderDataType: SWAP_ORDER_TYPE,
      orderData,
    }

    const signature = await signatureCallback(order)

    // Generate intent ID
    const intentId = `0x${Buffer.from(
      JSON.stringify({ order, nonce: nonce.toString() }),
    )
      .toString('hex')
      .slice(0, 64)}` as Hex

    return { intentId, order, signature }
  }

  /**
   * Get intent details
   */
  async getIntent(intentId: Hex): Promise<Intent | null> {
    const result = await this.config.publicClient.readContract({
      address: this.inputSettlerAddress,
      abi: INPUT_SETTLER_ABI,
      functionName: 'getOrder',
      args: [intentId],
    })

    if (result.user === ZERO_ADDRESS) return null

    let status: IntentStatus = 'open'
    if (result.solver !== ZERO_ADDRESS) status = 'pending'
    if (result.filled) status = 'filled'
    if (result.refunded) status = 'expired'

    return {
      id: intentId,
      user: result.user,
      inputToken: result.inputToken,
      inputAmount: result.inputAmount,
      outputToken: result.outputToken,
      outputAmount: result.outputAmount,
      sourceChainId: this.config.chainId,
      destinationChainId: Number(result.destinationChainId),
      recipient: result.recipient,
      maxFee: result.maxFee,
      openDeadline: result.openDeadline,
      fillDeadline: result.fillDeadline,
      status,
      solver: result.solver !== ZERO_ADDRESS ? result.solver : undefined,
      createdAt: Date.now(), // Would need to fetch from events in production
    }
  }

  /**
   * Check if intent can be refunded
   */
  async canRefund(intentId: Hex): Promise<boolean> {
    const result = await this.config.publicClient.readContract({
      address: this.inputSettlerAddress,
      abi: INPUT_SETTLER_ABI,
      functionName: 'canRefund',
      args: [intentId],
    })
    return result
  }

  /**
   * Refund an expired intent
   */
  async refundIntent(intentId: Hex): Promise<Hex> {
    const { walletClient } = this.config
    if (!walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const hash = await walletClient.writeContract({
      chain: null,
      account: walletClient.account,
      address: this.inputSettlerAddress,
      abi: INPUT_SETTLER_ABI,
      functionName: 'refund',
      args: [intentId],
    })

    return hash
  }

  /**
   * Get user's current nonce
   */
  async getUserNonce(userAddress: Address): Promise<bigint> {
    const nonce = await this.config.publicClient.readContract({
      address: this.inputSettlerAddress,
      abi: INPUT_SETTLER_ABI,
      functionName: 'getUserNonce',
      args: [userAddress],
    })
    return nonce
  }

  /**
   * Get active solvers
   */
  async getActiveSolvers(): Promise<Address[]> {
    if (this.solverRegistryAddress === ZERO_ADDRESS) return []

    const solvers = await this.config.publicClient.readContract({
      address: this.solverRegistryAddress,
      abi: SOLVER_REGISTRY_ABI,
      functionName: 'getActiveSolvers',
      args: [],
    })
    return [...solvers]
  }

  /**
   * Watch for intent status changes
   */
  watchIntent(
    intentId: Hex,
    callback: (status: IntentStatus) => void,
  ): () => void {
    let cancelled = false

    const poll = async () => {
      while (!cancelled) {
        const intent = await this.getIntent(intentId)
        if (intent) {
          callback(intent.status)
          if (intent.status === 'filled' || intent.status === 'expired') {
            break
          }
        }
        await new Promise((r) => setTimeout(r, 5000))
      }
    }

    poll()

    return () => {
      cancelled = true
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createOIFClient(config: OIFClientConfig): OIFClient {
  return new OIFClient(config)
}
