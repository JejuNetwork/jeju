/**
 * EIL SDK - Ethereum Interop Layer Client
 * Cross-chain operations and paymaster integrations
 */

import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import type { TokenBalance } from './types'

// EIL contract addresses by chain
const EIL_CONTRACTS: Record<number, { paymaster: Address; router: Address }> = {
  // Mainnet
  1: {
    paymaster: '0x0000000000000000000000000000000000000000' as Address,
    router: '0x0000000000000000000000000000000000000000' as Address,
  },
  // Base Sepolia (testnet)
  84532: {
    paymaster: '0x9406Cc6185a346906296840746125a0E44976454' as Address,
    router: '0x1234567890123456789012345678901234567890' as Address,
  },
  // Base
  8453: {
    paymaster: '0x9406Cc6185a346906296840746125a0E44976454' as Address,
    router: '0x1234567890123456789012345678901234567890' as Address,
  },
}

export interface EILClientConfig {
  chainId: number
  publicClient: PublicClient
  walletClient?: WalletClient
  paymasterAddress?: Address
}

export interface SponsorResult {
  canSponsor: boolean
  tokenCost: bigint
  userBalance: bigint
}

export interface BestTokenResult {
  bestToken: Address
  tokenCost: bigint
}

export interface BestPaymentTokenResult {
  bestToken: Address
  tokenCost: bigint
  reason: string
}

export interface SwapQuoteResult {
  amountOut: bigint
  priceImpact: number
}

export interface CrossChainTransferParams {
  sourceToken: Address
  amount: bigint
  destinationToken: Address
  destinationChainId: number
  recipient?: Address
  gasOnDestination?: bigint
  maxFee?: bigint
}

export interface RequestInfo {
  requester: Address
  token: Address
  amount: bigint
  destinationToken: Address
  destinationChainId: number
  recipient: Address
  status: 'pending' | 'claimed' | 'expired' | 'refunded'
}

/**
 * EIL Client for cross-chain operations
 */
export class EILClient {
  private _chainId: number
  private publicClient: PublicClient
  private walletClient?: WalletClient
  private paymasterAddress: Address

  constructor(config: EILClientConfig) {
    this._chainId = config.chainId
    this.publicClient = config.publicClient
    this.walletClient = config.walletClient

    // Use custom paymaster or look up from contracts
    const contracts = EIL_CONTRACTS[config.chainId]
    this.paymasterAddress =
      config.paymasterAddress ??
      contracts?.paymaster ??
      (ZERO_ADDRESS as Address)
  }

  /** Get the chain ID */
  get chainId(): number {
    return this._chainId
  }

  /**
   * Check if EIL is configured for this chain
   */
  isReady(): boolean {
    return this.paymasterAddress !== ZERO_ADDRESS
  }

  /**
   * Build paymaster data for token payment
   * Format: [mode(1 byte)][token(20 bytes)][appAddress(20 bytes)]
   */
  buildPaymasterData(token: Address, appAddress?: Address): Hex {
    const mode = '00'
    const tokenHex = token.slice(2).toLowerCase()
    const appHex = (appAddress ?? ZERO_ADDRESS).slice(2).toLowerCase()
    return `0x${mode}${tokenHex}${appHex}` as Hex
  }

  /**
   * Check if paymaster can sponsor with a specific token
   */
  async canSponsor(
    gasCost: bigint,
    token: Address,
    user: Address,
  ): Promise<SponsorResult> {
    const result = (await this.publicClient.readContract({
      address: this.paymasterAddress,
      abi: [
        {
          type: 'function',
          name: 'canSponsor',
          inputs: [
            { type: 'uint256', name: 'gasCost' },
            { type: 'address', name: 'token' },
            { type: 'address', name: 'user' },
          ],
          outputs: [
            { type: 'bool', name: 'canSponsor' },
            { type: 'uint256', name: 'tokenCost' },
            { type: 'uint256', name: 'userBalance' },
          ],
        },
      ],
      functionName: 'canSponsor',
      args: [gasCost, token, user],
    })) as [boolean, bigint, bigint]

    return {
      canSponsor: result[0],
      tokenCost: result[1],
      userBalance: result[2],
    }
  }

  /**
   * Find the best gas payment token from available options
   */
  async getBestGasToken(
    user: Address,
    gasCost: bigint,
    tokens: Address[],
  ): Promise<BestTokenResult> {
    const result = (await this.publicClient.readContract({
      address: this.paymasterAddress,
      abi: [
        {
          type: 'function',
          name: 'getBestGasToken',
          inputs: [
            { type: 'address', name: 'user' },
            { type: 'uint256', name: 'gasCost' },
            { type: 'address[]', name: 'tokens' },
          ],
          outputs: [
            { type: 'address', name: 'bestToken' },
            { type: 'uint256', name: 'tokenCost' },
          ],
        },
      ],
      functionName: 'getBestGasToken',
      args: [user, gasCost, tokens],
    })) as [Address, bigint]

    return {
      bestToken: result[0],
      tokenCost: result[1],
    }
  }

  /**
   * Find the best payment token considering app preferences
   */
  async getBestPaymentTokenForApp(
    app: Address,
    user: Address,
    gasCost: bigint,
    tokenBalances: TokenBalance[],
  ): Promise<BestPaymentTokenResult> {
    const tokens = tokenBalances.map((tb) => tb.token.address)

    const result = (await this.publicClient.readContract({
      address: this.paymasterAddress,
      abi: [
        {
          type: 'function',
          name: 'getBestPaymentTokenForApp',
          inputs: [
            { type: 'address', name: 'app' },
            { type: 'address', name: 'user' },
            { type: 'uint256', name: 'gasCost' },
            { type: 'address[]', name: 'tokens' },
          ],
          outputs: [
            { type: 'address', name: 'bestToken' },
            { type: 'uint256', name: 'tokenCost' },
            { type: 'string', name: 'reason' },
          ],
        },
      ],
      functionName: 'getBestPaymentTokenForApp',
      args: [app, user, gasCost, tokens],
    })) as [Address, bigint, string]

    return {
      bestToken: result[0],
      tokenCost: result[1],
      reason: result[2],
    }
  }

  /**
   * Preview the token cost for a given gas amount
   */
  async previewTokenCost(
    estimatedGas: bigint,
    gasPrice: bigint,
    token: Address,
  ): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.paymasterAddress,
      abi: [
        {
          type: 'function',
          name: 'previewTokenCost',
          inputs: [
            { type: 'uint256', name: 'estimatedGas' },
            { type: 'uint256', name: 'gasPrice' },
            { type: 'address', name: 'token' },
          ],
          outputs: [{ type: 'uint256', name: '' }],
        },
      ],
      functionName: 'previewTokenCost',
      args: [estimatedGas, gasPrice, token],
    }) as Promise<bigint>
  }

  /**
   * Get a swap quote between two tokens
   */
  async getSwapQuote(
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
  ): Promise<SwapQuoteResult> {
    const result = (await this.publicClient.readContract({
      address: this.paymasterAddress,
      abi: [
        {
          type: 'function',
          name: 'getSwapQuote',
          inputs: [
            { type: 'address', name: 'tokenIn' },
            { type: 'address', name: 'tokenOut' },
            { type: 'uint256', name: 'amountIn' },
          ],
          outputs: [
            { type: 'uint256', name: 'amountOut' },
            { type: 'uint256', name: 'priceImpactBps' },
          ],
        },
      ],
      functionName: 'getSwapQuote',
      args: [tokenIn, tokenOut, amountIn],
    })) as [bigint, bigint]

    return {
      amountOut: result[0],
      priceImpact: Number(result[1]) / 10000, // Convert bps to decimal
    }
  }

  /**
   * Create a cross-chain transfer request
   */
  async createCrossChainTransfer(
    _params: CrossChainTransferParams,
  ): Promise<Hex> {
    if (!this.isReady()) {
      throw new Error('EIL not configured for this chain')
    }

    if (!this.walletClient) {
      throw new Error('Wallet not connected')
    }

    // Implementation would call the EIL router contract
    throw new Error('Not implemented')
  }

  /**
   * Get the current fee for a request
   */
  async getCurrentFee(requestId: Hex): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.paymasterAddress,
      abi: [
        {
          type: 'function',
          name: 'getCurrentFee',
          inputs: [{ type: 'bytes32', name: 'requestId' }],
          outputs: [{ type: 'uint256', name: '' }],
        },
      ],
      functionName: 'getCurrentFee',
      args: [requestId],
    }) as Promise<bigint>
  }

  /**
   * Get request information
   */
  async getRequest(requestId: Hex): Promise<RequestInfo | null> {
    const result = (await this.publicClient.readContract({
      address: this.paymasterAddress,
      abi: [
        {
          type: 'function',
          name: 'getRequest',
          inputs: [{ type: 'bytes32', name: 'requestId' }],
          outputs: [
            {
              type: 'tuple',
              name: '',
              components: [
                { type: 'address', name: 'requester' },
                { type: 'address', name: 'token' },
                { type: 'uint256', name: 'amount' },
                { type: 'address', name: 'destinationToken' },
                { type: 'uint256', name: 'destinationChainId' },
                { type: 'address', name: 'recipient' },
                { type: 'uint256', name: 'gasOnDestination' },
                { type: 'uint256', name: 'maxFee' },
                { type: 'uint256', name: 'feeIncrement' },
                { type: 'uint256', name: 'deadline' },
                { type: 'uint256', name: 'createdBlock' },
                { type: 'bool', name: 'claimed' },
                { type: 'bool', name: 'expired' },
                { type: 'bool', name: 'refunded' },
                { type: 'uint256', name: 'bidCount' },
                { type: 'address', name: 'winningXLP' },
                { type: 'uint256', name: 'winningFee' },
              ],
            },
          ],
        },
      ],
      functionName: 'getRequest',
      args: [requestId],
    })) as {
      requester: Address
      token: Address
      amount: bigint
      destinationToken: Address
      destinationChainId: bigint
      recipient: Address
      claimed: boolean
      expired: boolean
      refunded: boolean
    }

    // Check if request exists
    if (result.requester === ZERO_ADDRESS) {
      return null
    }

    // Determine status
    let status: 'pending' | 'claimed' | 'expired' | 'refunded'
    if (result.claimed) {
      status = 'claimed'
    } else if (result.expired) {
      status = 'expired'
    } else if (result.refunded) {
      status = 'refunded'
    } else {
      status = 'pending'
    }

    return {
      requester: result.requester,
      token: result.token,
      amount: result.amount,
      destinationToken: result.destinationToken,
      destinationChainId: Number(result.destinationChainId),
      recipient: result.recipient,
      status,
    }
  }
}

/**
 * Create an EIL client instance
 */
export function createEILClient(config: EILClientConfig): EILClient {
  return new EILClient(config)
}
