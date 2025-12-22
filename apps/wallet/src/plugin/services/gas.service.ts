/**
 * Gas Service
 *
 * Handles gas abstraction and multi-token gas payments.
 * Integrates with network's CrossChainPaymaster for sponsored transactions.
 */

import type { IAgentRuntime } from '@elizaos/core'
import {
  type Address,
  createPublicClient,
  formatUnits,
  type Hex,
  http,
  type PublicClient,
} from 'viem'
import {
  expectAddress,
  expectBigInt,
  expectChainId,
  expectHex,
} from '../../lib/validation'
import type { GasEstimate, GasOption, GasServiceConfig } from '../types'

export class GasService {
  static readonly serviceType = 'jeju-gas'

  private runtime: IAgentRuntime | null = null
  private publicClients: Map<number, PublicClient> = new Map()
  private config: GasServiceConfig

  // Paymaster addresses per chain
  private paymasterAddresses: Map<number, Address> = new Map([
    [8453, '0x0000000000000000000000000000000000000000' as Address],
    [1, '0x0000000000000000000000000000000000000000' as Address],
    [42161, '0x0000000000000000000000000000000000000000' as Address],
  ])

  // Cache for gas prices
  private gasPriceCache: Map<number, { price: bigint; timestamp: number }> =
    new Map()
  private readonly GAS_CACHE_TTL = 15000

  constructor() {
    this.config = {
      defaultGasMultiplier: 1.2,
      maxGasPrice: BigInt(500e9),
      supportedGasTokens: [
        {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
          symbol: 'USDC',
          decimals: 6,
        },
        {
          address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address,
          symbol: 'USDT',
          decimals: 6,
        },
        {
          address: '0x6B175474E89094C44Da98b954EescdecAD3F9e23A' as Address,
          symbol: 'DAI',
          decimals: 18,
        },
      ],
    }
  }

  get serviceType(): string {
    return GasService.serviceType
  }

  static async start(): Promise<GasService> {
    return new GasService()
  }

  static async stop(): Promise<void> {
    // Cleanup
  }

  async stop(): Promise<void> {
    this.runtime?.logger.info('[GasService] Stopped')
  }

  async initialize(runtime: IAgentRuntime): Promise<void> {
    this.runtime = runtime
    runtime.logger.info('[GasService] Initialized')
  }

  /**
   * Get current gas price for a chain
   */
  async getGasPrice(chainId: number): Promise<GasEstimate> {
    expectChainId(chainId, 'chainId')
    const cached = this.gasPriceCache.get(chainId)
    if (cached && Date.now() - cached.timestamp < this.GAS_CACHE_TTL) {
      return this.buildGasEstimate(cached.price, chainId)
    }

    const publicClient = this.getPublicClient(chainId)
    const gasPrice = await publicClient.getGasPrice()

    this.gasPriceCache.set(chainId, {
      price: gasPrice,
      timestamp: Date.now(),
    })

    return this.buildGasEstimate(gasPrice, chainId)
  }

  private buildGasEstimate(gasPrice: bigint, chainId: number): GasEstimate {
    return {
      gasPrice,
      maxFeePerGas:
        (gasPrice *
          BigInt(Math.floor(this.config.defaultGasMultiplier * 100))) /
        BigInt(100),
      maxPriorityFeePerGas: gasPrice / BigInt(10),
      baseFee: gasPrice,
      estimatedCost: {
        wei: gasPrice * BigInt(21000),
        eth: Number(gasPrice * BigInt(21000)) / 1e18,
      },
      speed: 'standard',
      chainId,
    }
  }

  /**
   * Get available gas payment options
   */
  async getGasOptions(
    chainId: number,
    userAddress?: Address,
  ): Promise<GasOption[]> {
    expectChainId(chainId, 'chainId')
    if (userAddress) expectAddress(userAddress, 'userAddress')

    const gasEstimate = await this.getGasPrice(chainId)

    const options: GasOption[] = [
      {
        type: 'native',
        token: {
          address: '0x0000000000000000000000000000000000000000' as Address,
          name: 'Ether',
          symbol: 'ETH',
          decimals: 18,
          chainId,
        },
        amount: gasEstimate.estimatedCost.wei,
        amountFormatted: gasEstimate.estimatedCost.eth.toFixed(6),
        gasPrice: gasEstimate.gasPrice,
        speed: 'standard',
        estimatedTime: 15,
      },
    ]

    // Add token payment options
    for (const token of this.config.supportedGasTokens) {
      const tokenCost = await this.calculateTokenGasCost(
        chainId,
        token.address,
        BigInt(21000),
        gasEstimate.gasPrice,
      )

      options.push({
        type: 'token',
        token: {
          address: token.address,
          name: token.symbol, // Use symbol as name
          symbol: token.symbol,
          decimals: token.decimals,
          chainId,
        },
        amount: tokenCost,
        amountFormatted: formatUnits(tokenCost, token.decimals),
        gasPrice: gasEstimate.gasPrice,
        speed: 'standard',
        estimatedTime: 15,
      })
    }

    return options
  }

  /**
   * Calculate gas cost in a specific token
   */
  async calculateTokenGasCost(
    chainId: number,
    gasToken: Address,
    gasUsed: bigint,
    gasPrice: bigint,
  ): Promise<bigint> {
    expectChainId(chainId, 'chainId')
    expectAddress(gasToken, 'gasToken')
    expectBigInt(gasUsed, 'gasUsed')
    expectBigInt(gasPrice, 'gasPrice')

    // Native gas cost
    const nativeGasCost = gasUsed * gasPrice

    // Get ETH price in USD (simplified)
    const ethPrice = BigInt(2000e6)

    // Get token price in USD (simplified - assume stablecoin at $1)
    const tokenPrice = BigInt(1e6)

    // Convert gas cost to token amount
    const tokenDecimals =
      this.config.supportedGasTokens.find(
        (t) => t.address.toLowerCase() === gasToken.toLowerCase(),
      )?.decimals || 18

    const tokenAmount =
      (nativeGasCost * ethPrice) /
      tokenPrice /
      BigInt(10 ** (18 - tokenDecimals))

    // Add paymaster markup (5%)
    const withMarkup = (tokenAmount * BigInt(105)) / BigInt(100)

    return withMarkup
  }

  /**
   * Build paymaster data for gas payment in token
   */
  async buildPaymasterData(options: {
    chainId: number
    gasToken: Address
    maxTokenAmount: bigint
    userOp?: {
      callGasLimit: bigint
      verificationGasLimit: bigint
      preVerificationGas: bigint
    }
  }): Promise<Hex> {
    expectChainId(options.chainId, 'chainId')
    expectAddress(options.gasToken, 'gasToken')
    expectBigInt(options.maxTokenAmount, 'maxTokenAmount')

    const paymasterAddress = this.paymasterAddresses.get(options.chainId)
    if (
      !paymasterAddress ||
      paymasterAddress === '0x0000000000000000000000000000000000000000'
    ) {
      throw new Error(`No paymaster configured for chain ${options.chainId}`)
    }

    // Construct paymaster data
    // Format: paymaster address (20 bytes) + gas token (20 bytes) + max amount (32 bytes) + mode (1 byte)
    const mode = '00'
    const paymasterData = (paymasterAddress +
      options.gasToken.slice(2) +
      options.maxTokenAmount.toString(16).padStart(64, '0') +
      mode) as Hex

    return paymasterData
  }

  /**
   * Check if user can afford gas
   */
  async canAffordGas(options: {
    chainId: number
    userAddress: Address
    gasToken?: Address
    estimatedGas?: bigint
  }): Promise<{
    canAfford: boolean
    availableBalance: bigint
    requiredAmount: bigint
    deficit?: bigint
  }> {
    expectChainId(options.chainId, 'chainId')
    expectAddress(options.userAddress, 'userAddress')
    if (options.gasToken) expectAddress(options.gasToken, 'gasToken')
    if (options.estimatedGas) expectBigInt(options.estimatedGas, 'estimatedGas')

    const publicClient = this.getPublicClient(options.chainId)
    const gasEstimate = await this.getGasPrice(options.chainId)
    const gasUsed = options.estimatedGas || BigInt(100000)

    let requiredAmount: bigint
    let availableBalance: bigint

    if (
      !options.gasToken ||
      options.gasToken === '0x0000000000000000000000000000000000000000'
    ) {
      requiredAmount = gasUsed * gasEstimate.maxFeePerGas
      availableBalance = await publicClient.getBalance({
        address: options.userAddress,
      })
    } else {
      requiredAmount = await this.calculateTokenGasCost(
        options.chainId,
        options.gasToken,
        gasUsed,
        gasEstimate.gasPrice,
      )

      const balanceResult = await publicClient.readContract({
        address: options.gasToken,
        abi: [
          {
            name: 'balanceOf',
            type: 'function',
            inputs: [{ type: 'address' }],
            outputs: [{ type: 'uint256' }],
          },
        ] as const,
        functionName: 'balanceOf',
        args: [options.userAddress],
      })

      availableBalance = balanceResult as bigint
    }

    const canAfford = availableBalance >= requiredAmount

    return {
      canAfford,
      availableBalance,
      requiredAmount,
      deficit: canAfford ? undefined : requiredAmount - availableBalance,
    }
  }

  /**
   * Get best gas token for user
   */
  async getBestGasToken(
    chainId: number,
    userAddress: Address,
    estimatedGas?: bigint,
  ): Promise<GasOption | null> {
    expectChainId(chainId, 'chainId')
    expectAddress(userAddress, 'userAddress')
    if (estimatedGas) expectBigInt(estimatedGas, 'estimatedGas')

    const options = await this.getGasOptions(chainId, userAddress)

    for (const option of options) {
      const affordability = await this.canAffordGas({
        chainId,
        userAddress,
        gasToken: option.token.address,
        estimatedGas,
      })

      if (affordability.canAfford) {
        return option
      }
    }

    return null
  }

  /**
   * Estimate transaction gas
   */
  async estimateGas(options: {
    chainId: number
    to: Address
    value?: bigint
    data?: Hex
    from?: Address
  }): Promise<bigint> {
    expectChainId(options.chainId, 'chainId')
    expectAddress(options.to, 'to')
    if (options.value) expectBigInt(options.value, 'value')
    if (options.data) expectHex(options.data, 'data')
    if (options.from) expectAddress(options.from, 'from')

    const publicClient = this.getPublicClient(options.chainId)

    const estimate = await publicClient.estimateGas({
      to: options.to,
      value: options.value,
      data: options.data,
      account: options.from,
    })

    // Add buffer
    return (estimate * BigInt(120)) / BigInt(100)
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
}

export default GasService
