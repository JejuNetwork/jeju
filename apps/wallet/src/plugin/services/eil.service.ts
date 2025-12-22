/**
 * Ethereum Interop Layer (EIL) Service
 *
 * Handles cross-chain operations using the network's CrossChainPaymaster.
 * Enables bridgeless, trustless cross-chain swaps and transfers.
 */

import type { IAgentRuntime } from '@elizaos/core'
import {
  expectAddress,
  expectBigInt,
  expectChainId,
  expectHex,
  expectNonNegative,
} from '@jejunetwork/types'
import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  toHex,
} from 'viem'
import type { EILServiceConfig, Voucher, VoucherRequest } from '../types'

// CrossChainPaymaster ABI (from the network contracts)
const CROSS_CHAIN_PAYMASTER_ABI = [
  {
    name: 'createVoucherRequest',
    type: 'function',
    inputs: [
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'sourceToken', type: 'address' },
      { name: 'destinationToken', type: 'address' },
      { name: 'sourceAmount', type: 'uint256' },
      { name: 'minDestinationAmount', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'requestId', type: 'bytes32' }],
  },
  {
    name: 'getBestXLP',
    type: 'function',
    inputs: [
      { name: 'sourceChainId', type: 'uint256' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'sourceToken', type: 'address' },
      { name: 'destinationToken', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [
      { name: 'xlp', type: 'address' },
      { name: 'quote', type: 'uint256' },
    ],
  },
  {
    name: 'supportedTokens',
    type: 'function',
    inputs: [{ name: 'chainId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    name: 'getVoucherRequest',
    type: 'function',
    inputs: [{ name: 'requestId', type: 'bytes32' }],
    outputs: [
      { name: 'user', type: 'address' },
      { name: 'sourceChainId', type: 'uint256' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'sourceToken', type: 'address' },
      { name: 'destinationToken', type: 'address' },
      { name: 'sourceAmount', type: 'uint256' },
      { name: 'minDestinationAmount', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'status', type: 'uint8' },
    ],
  },
  {
    name: 'getVoucher',
    type: 'function',
    inputs: [{ name: 'voucherId', type: 'bytes32' }],
    outputs: [
      { name: 'requestId', type: 'bytes32' },
      { name: 'xlp', type: 'address' },
      { name: 'destinationAmount', type: 'uint256' },
      { name: 'issuedAt', type: 'uint256' },
      { name: 'expiresAt', type: 'uint256' },
      { name: 'fulfilled', type: 'bool' },
    ],
  },
] as const

export class EILService {
  static readonly serviceType = 'jeju-eil'

  private runtime: IAgentRuntime | null = null
  private publicClients: Map<number, PublicClient> = new Map()
  private config: EILServiceConfig

  // Cache for quotes
  private quoteCache: Map<
    string,
    { quote: bigint; xlp: Address; timestamp: number }
  > = new Map()
  private readonly QUOTE_CACHE_TTL = 30000

  constructor() {
    this.config = {
      crossChainPaymasterAddress:
        '0x0000000000000000000000000000000000000000' as Address,
      supportedChains: [8453, 1, 42161, 10, 137],
    }
  }

  get serviceType(): string {
    return EILService.serviceType
  }

  static async start(): Promise<EILService> {
    return new EILService()
  }

  static async stop(): Promise<void> {
    // Cleanup
  }

  async stop(): Promise<void> {
    this.runtime?.logger.info('[EILService] Stopped')
  }

  async initialize(runtime: IAgentRuntime): Promise<void> {
    this.runtime = runtime
    runtime.logger.info('[EILService] Initialized')
  }

  /**
   * Get quote for cross-chain swap
   */
  async getQuote(options: {
    sourceChainId: number
    destinationChainId: number
    sourceToken: Address
    destinationToken: Address
    amount: bigint
  }): Promise<{
    outputAmount: bigint
    xlp: Address
    feePercent: number
    estimatedTime: number
  }> {
    expectChainId(options.sourceChainId, 'sourceChainId')
    expectChainId(options.destinationChainId, 'destinationChainId')
    expectAddress(options.sourceToken, 'sourceToken')
    expectAddress(options.destinationToken, 'destinationToken')
    expectBigInt(options.amount, 'amount')

    const cacheKey = `${options.sourceChainId}-${options.destinationChainId}-${options.sourceToken}-${options.destinationToken}-${options.amount}`
    const cached = this.quoteCache.get(cacheKey)

    if (cached && Date.now() - cached.timestamp < this.QUOTE_CACHE_TTL) {
      return {
        outputAmount: cached.quote,
        xlp: cached.xlp,
        feePercent: 0.3,
        estimatedTime: 120,
      }
    }

    const publicClient = this.getPublicClient(options.sourceChainId)

    const result = await publicClient.readContract({
      address: this.config.crossChainPaymasterAddress,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'getBestXLP',
      args: [
        BigInt(options.sourceChainId),
        BigInt(options.destinationChainId),
        options.sourceToken,
        options.destinationToken,
        options.amount,
      ],
    })

    const [xlp, quote] = result as [Address, bigint]

    this.quoteCache.set(cacheKey, {
      quote,
      xlp,
      timestamp: Date.now(),
    })

    return {
      outputAmount: quote,
      xlp,
      feePercent: 0.3,
      estimatedTime: 120,
    }
  }

  /**
   * Get supported tokens for cross-chain operations
   */
  async getSupportedTokens(chainId: number): Promise<Address[]> {
    const publicClient = this.getPublicClient(chainId)

    const tokens = (await publicClient.readContract({
      address: this.config.crossChainPaymasterAddress,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'supportedTokens',
      args: [BigInt(chainId)],
    })) as Address[]

    return [...tokens]
  }

  /**
   * Create a voucher request for cross-chain swap
   */
  async createVoucherRequest(options: {
    sourceChainId: number
    destinationChainId: number
    sourceToken: Address
    destinationToken: Address
    sourceAmount: bigint
    minDestinationAmount: bigint
    deadline?: number
  }): Promise<{
    requestId: Hex
    callData: Hex
  }> {
    expectChainId(options.sourceChainId, 'sourceChainId')
    expectChainId(options.destinationChainId, 'destinationChainId')
    expectAddress(options.sourceToken, 'sourceToken')
    expectAddress(options.destinationToken, 'destinationToken')
    expectBigInt(options.sourceAmount, 'sourceAmount')
    expectBigInt(options.minDestinationAmount, 'minDestinationAmount')

    const deadline = options.deadline || Math.floor(Date.now() / 1000) + 3600
    expectNonNegative(deadline, 'deadline')

    const callData = encodeFunctionData({
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'createVoucherRequest',
      args: [
        BigInt(options.destinationChainId),
        options.sourceToken,
        options.destinationToken,
        options.sourceAmount,
        options.minDestinationAmount,
        BigInt(deadline),
      ],
    })

    const requestId = keccak256(
      toHex(
        JSON.stringify({
          destinationChainId: options.destinationChainId,
          sourceToken: options.sourceToken,
          destinationToken: options.destinationToken,
          sourceAmount: options.sourceAmount.toString(),
          deadline,
        }),
      ),
    )

    return {
      requestId,
      callData,
    }
  }

  /**
   * Get voucher request status
   */
  async getVoucherRequest(
    requestId: Hex,
    chainId: number,
  ): Promise<VoucherRequest | null> {
    expectHex(requestId, 'requestId')
    expectChainId(chainId, 'chainId')

    const publicClient = this.getPublicClient(chainId)

    const result = await publicClient.readContract({
      address: this.config.crossChainPaymasterAddress,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'getVoucherRequest',
      args: [requestId],
    })

    const [
      user,
      sourceChainId,
      destinationChainId,
      sourceToken,
      destinationToken,
      sourceAmount,
      minDestinationAmount,
      deadline,
      nonce,
      status,
    ] = result as [
      Address,
      bigint,
      bigint,
      Address,
      Address,
      bigint,
      bigint,
      bigint,
      bigint,
      number,
    ]

    if (!user || user === '0x0000000000000000000000000000000000000000') {
      return null
    }

    const statusMap: Record<number, VoucherRequest['status']> = {
      0: 'pending',
      1: 'voucher-issued',
      2: 'fulfilled',
      3: 'expired',
      4: 'cancelled',
    }

    return {
      id: requestId,
      user,
      sourceChainId: Number(sourceChainId),
      destinationChainId: Number(destinationChainId),
      sourceToken,
      destinationToken,
      sourceAmount,
      minDestinationAmount,
      deadline: Number(deadline),
      nonce,
      status: statusMap[status] || 'pending',
    }
  }

  /**
   * Get voucher details
   */
  async getVoucher(voucherId: Hex, chainId: number): Promise<Voucher | null> {
    expectHex(voucherId, 'voucherId')
    expectChainId(chainId, 'chainId')

    const publicClient = this.getPublicClient(chainId)

    const result = await publicClient.readContract({
      address: this.config.crossChainPaymasterAddress,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'getVoucher',
      args: [voucherId],
    })

    const [requestId, xlp, destinationAmount, issuedAt, expiresAt, fulfilled] =
      result as [Hex, Address, bigint, bigint, bigint, boolean]

    if (!xlp || xlp === '0x0000000000000000000000000000000000000000') {
      return null
    }

    return {
      id: voucherId,
      requestId,
      xlp,
      destinationAmount,
      issuedAt: Number(issuedAt),
      expiresAt: Number(expiresAt),
      fulfilled,
    }
  }

  /**
   * Execute a cross-chain swap (full flow)
   */
  async executeCrossChainSwap(options: {
    sourceChainId: number
    destinationChainId: number
    sourceToken: Address
    destinationToken: Address
    amount: bigint
    recipient: Address
    slippagePercent?: number
  }): Promise<{
    requestId: Hex
    sourceChainCallData: Hex
    estimatedOutput: bigint
  }> {
    expectChainId(options.sourceChainId, 'sourceChainId')
    expectChainId(options.destinationChainId, 'destinationChainId')
    expectAddress(options.sourceToken, 'sourceToken')
    expectAddress(options.destinationToken, 'destinationToken')
    expectBigInt(options.amount, 'amount')
    expectAddress(options.recipient, 'recipient')

    this.runtime?.logger.info(
      `[EILService] Executing cross-chain swap: ${options.sourceChainId} -> ${options.destinationChainId}`,
    )

    const quote = await this.getQuote({
      sourceChainId: options.sourceChainId,
      destinationChainId: options.destinationChainId,
      sourceToken: options.sourceToken,
      destinationToken: options.destinationToken,
      amount: options.amount,
    })

    const slippage = options.slippagePercent || 0.5
    const minOutput =
      (quote.outputAmount * BigInt(Math.floor((100 - slippage) * 100))) /
      BigInt(10000)

    const { requestId, callData } = await this.createVoucherRequest({
      sourceChainId: options.sourceChainId,
      destinationChainId: options.destinationChainId,
      sourceToken: options.sourceToken,
      destinationToken: options.destinationToken,
      sourceAmount: options.amount,
      minDestinationAmount: minOutput,
    })

    return {
      requestId,
      sourceChainCallData: callData,
      estimatedOutput: quote.outputAmount,
    }
  }

  /**
   * Check cross-chain swap status
   */
  async getSwapStatus(
    requestId: Hex,
    sourceChainId: number,
    _destinationChainId: number,
  ): Promise<{
    status: 'pending' | 'voucher-issued' | 'fulfilled' | 'expired' | 'cancelled'
    voucherId?: Hex
    outputAmount?: bigint
    completedAt?: number
  }> {
    const request = await this.getVoucherRequest(requestId, sourceChainId)

    if (!request) {
      return { status: 'pending' }
    }

    if (request.status === 'voucher-issued') {
      return {
        status: 'voucher-issued',
      }
    }

    return { status: request.status }
  }

  /**
   * Get available gas payment tokens on a chain
   */
  async getGasPaymentTokens(_chainId: number): Promise<
    Array<{
      token: Address
      symbol: string
      exchangeRate: bigint
    }>
  > {
    return [
      {
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
        symbol: 'USDC',
        exchangeRate: BigInt(1e18),
      },
      {
        token: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address,
        symbol: 'USDT',
        exchangeRate: BigInt(1e18),
      },
    ]
  }

  /**
   * Build paymaster data for gas payment in token
   */
  async buildPaymasterData(options: {
    chainId: number
    gasToken: Address
    maxGasTokenAmount: bigint
  }): Promise<Hex> {
    expectChainId(options.chainId, 'chainId')
    expectAddress(options.gasToken, 'gasToken')
    expectBigInt(options.maxGasTokenAmount, 'maxGasTokenAmount')

    return ('0x' +
      this.config.crossChainPaymasterAddress.slice(2) +
      options.gasToken.slice(2) +
      options.maxGasTokenAmount.toString(16).padStart(64, '0')) as Hex
  }

  private getPublicClient(chainId: number): PublicClient {
    let client = this.publicClients.get(chainId)
    if (!client) {
      client = createPublicClient({
        transport: http(`http://localhost:4010/rpc/${chainId}`),
      })
      this.publicClients.set(chainId, client)
    }
    return client
  }

  /**
   * Check if a route is supported
   */
  isRouteSupported(sourceChainId: number, destinationChainId: number): boolean {
    return (
      this.config.supportedChains.includes(sourceChainId) &&
      this.config.supportedChains.includes(destinationChainId)
    )
  }
}

export default EILService
