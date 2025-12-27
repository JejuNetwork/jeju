/**
 * @fileoverview Ethereum Interop Layer (EIL) SDK
 *
 * Provides trustless cross-chain transfers using:
 * - CrossChainPaymaster for voucher-based atomic swaps
 * - L1StakeManager for XLP stake verification
 * - Multi-token gas payment
 *
 * Users don't need to manually bridge or switch chains.
 * XLPs (Cross-chain Liquidity Providers) fulfill transfers atomically.
 */

import { expectHex, ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { parseEther } from 'viem'
import { getChainContracts } from './chains'
import type { TokenBalance, VoucherRequest } from './types'

const CROSS_CHAIN_PAYMASTER_ABI = [
  {
    name: 'createVoucherRequest',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'destinationToken', type: 'address' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'gasOnDestination', type: 'uint256' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'feeIncrement', type: 'uint256' },
    ],
    outputs: [{ name: 'requestId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'getCurrentFee',
    type: 'function',
    inputs: [{ name: 'requestId', type: 'bytes32' }],
    outputs: [{ name: 'currentFee', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'canSponsor',
    type: 'function',
    inputs: [
      { name: 'gasCost', type: 'uint256' },
      { name: 'paymentToken', type: 'address' },
      { name: 'userAddress', type: 'address' },
    ],
    outputs: [
      { name: 'canSponsorTx', type: 'bool' },
      { name: 'tokenCost', type: 'uint256' },
      { name: 'userBal', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getBestGasToken',
    type: 'function',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'gasCostETH', type: 'uint256' },
      { name: 'tokens', type: 'address[]' },
    ],
    outputs: [
      { name: 'bestToken', type: 'address' },
      { name: 'tokenCost', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getBestPaymentTokenForApp',
    type: 'function',
    inputs: [
      { name: 'appAddress', type: 'address' },
      { name: 'user', type: 'address' },
      { name: 'gasCostETH', type: 'uint256' },
      { name: 'tokens', type: 'address[]' },
      { name: 'balances', type: 'uint256[]' },
    ],
    outputs: [
      { name: 'bestToken', type: 'address' },
      { name: 'tokenCost', type: 'uint256' },
      { name: 'reason', type: 'string' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'previewTokenCost',
    type: 'function',
    inputs: [
      { name: 'estimatedGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: 'tokenCost', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getRequest',
    type: 'function',
    inputs: [{ name: 'requestId', type: 'bytes32' }],
    outputs: [
      {
        name: 'request',
        type: 'tuple',
        components: [
          { name: 'requester', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'destinationToken', type: 'address' },
          { name: 'destinationChainId', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'gasOnDestination', type: 'uint256' },
          { name: 'maxFee', type: 'uint256' },
          { name: 'feeIncrement', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'createdBlock', type: 'uint256' },
          { name: 'claimed', type: 'bool' },
          { name: 'expired', type: 'bool' },
          { name: 'refunded', type: 'bool' },
          { name: 'bidCount', type: 'uint256' },
          { name: 'winningXLP', type: 'address' },
          { name: 'winningFee', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'refundExpiredRequest',
    type: 'function',
    inputs: [{ name: 'requestId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'swap',
    type: 'function',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minAmountOut', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    name: 'getSwapQuote',
    type: 'function',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'priceImpact', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const

const DEFAULT_MAX_FEE = parseEther('0.01')
const DEFAULT_FEE_INCREMENT = parseEther('0.0001')
const DEFAULT_GAS_ON_DESTINATION = parseEther('0.001')

export interface EILClientConfig {
  chainId: number
  publicClient: PublicClient
  walletClient?: WalletClient
  paymasterAddress?: Address
}

export interface CrossChainTransferParams {
  sourceToken: Address
  amount: bigint
  destinationToken: Address
  destinationChainId: number
  recipient?: Address
  maxFee?: bigint
  feeIncrement?: bigint
  gasOnDestination?: bigint
}

export interface SwapParams {
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  minAmountOut: bigint
}

export class EILClient {
  private config: EILClientConfig
  private paymasterAddress: Address
  private isConfigured: boolean

  constructor(config: EILClientConfig) {
    this.config = config
    const contracts = getChainContracts(config.chainId)
    this.paymasterAddress =
      config.paymasterAddress ?? contracts.crossChainPaymaster ?? ZERO_ADDRESS

    // Track if contracts are actually configured
    this.isConfigured = this.paymasterAddress !== ZERO_ADDRESS

    if (!this.isConfigured) {
      console.warn(
        `[EILClient] CrossChainPaymaster not configured for chain ${config.chainId}. ` +
          `Cross-chain transfers will fail. Deploy contracts and update chainContracts.`,
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
   * Create a cross-chain transfer request
   * Locks tokens on source chain, XLP fulfills on destination
   */
  async createCrossChainTransfer(
    params: CrossChainTransferParams,
  ): Promise<{ requestId: Hex; txHash: Hex }> {
    if (!this.isConfigured) {
      throw new Error(
        `EIL not configured for chain ${this.config.chainId}. ` +
          `CrossChainPaymaster contract address not set. Deploy contracts first.`,
      )
    }

    const { walletClient, publicClient } = this.config
    if (!walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const userAddress = walletClient.account.address
    const recipient = params.recipient ?? userAddress
    const maxFee = params.maxFee ?? DEFAULT_MAX_FEE
    const feeIncrement = params.feeIncrement ?? DEFAULT_FEE_INCREMENT
    const gasOnDestination =
      params.gasOnDestination ?? DEFAULT_GAS_ON_DESTINATION

    const isNativeToken = params.sourceToken === ZERO_ADDRESS
    const value = isNativeToken ? params.amount + maxFee : maxFee

    const hash = await walletClient.writeContract({
      chain: null,
      account: walletClient.account,
      address: this.paymasterAddress,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'createVoucherRequest',
      args: [
        params.sourceToken,
        params.amount,
        params.destinationToken,
        BigInt(params.destinationChainId),
        recipient,
        gasOnDestination,
        maxFee,
        feeIncrement,
      ],
      value,
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    // Parse requestId from logs
    const rawRequestId = receipt.logs[0].topics[1]
    if (!rawRequestId) {
      throw new Error('No requestId found in transaction logs')
    }
    const requestId = expectHex(rawRequestId, 'requestId')

    return { requestId, txHash: hash }
  }

  /**
   * Get the current fee for an active request (reverse Dutch auction)
   */
  async getCurrentFee(requestId: Hex): Promise<bigint> {
    const fee = await this.config.publicClient.readContract({
      address: this.paymasterAddress,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'getCurrentFee',
      args: [requestId],
    })
    return fee
  }

  /**
   * Get voucher request details
   */
  async getRequest(requestId: Hex): Promise<VoucherRequest | null> {
    const result = await this.config.publicClient.readContract({
      address: this.paymasterAddress,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'getRequest',
      args: [requestId],
    })

    if (result.requester === ZERO_ADDRESS) return null

    let status: VoucherRequest['status'] = 'pending'
    if (result.claimed) status = 'claimed'
    if (result.expired) status = 'expired'
    if (result.refunded) status = 'expired'

    return {
      id: requestId,
      requester: result.requester,
      token: result.token,
      amount: result.amount,
      destinationToken: result.destinationToken,
      destinationChainId: Number(result.destinationChainId),
      recipient: result.recipient,
      gasOnDestination: result.gasOnDestination,
      maxFee: result.maxFee,
      feeIncrement: result.feeIncrement,
      deadline: Number(result.deadline),
      status,
    }
  }

  /**
   * Refund an expired request
   */
  async refundExpiredRequest(requestId: Hex): Promise<Hex> {
    const { walletClient } = this.config
    if (!walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const hash = await walletClient.writeContract({
      chain: null,
      account: walletClient.account,
      address: this.paymasterAddress,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'refundExpiredRequest',
      args: [requestId],
    })

    return hash
  }

  /**
   * Check if paymaster can sponsor a transaction with given token
   */
  async canSponsor(
    gasCost: bigint,
    paymentToken: Address,
    userAddress: Address,
  ): Promise<{ canSponsor: boolean; tokenCost: bigint; userBalance: bigint }> {
    const [canSponsorTx, tokenCost, userBal] =
      await this.config.publicClient.readContract({
        address: this.paymasterAddress,
        abi: CROSS_CHAIN_PAYMASTER_ABI,
        functionName: 'canSponsor',
        args: [gasCost, paymentToken, userAddress],
      })

    return { canSponsor: canSponsorTx, tokenCost, userBalance: userBal }
  }

  /**
   * Get the best gas payment token for a user
   */
  async getBestGasToken(
    userAddress: Address,
    gasCostETH: bigint,
    tokens: Address[],
  ): Promise<{ bestToken: Address; tokenCost: bigint }> {
    const [bestToken, tokenCost] = await this.config.publicClient.readContract({
      address: this.paymasterAddress,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'getBestGasToken',
      args: [userAddress, gasCostETH, tokens],
    })

    return { bestToken, tokenCost }
  }

  /**
   * Get best payment token considering app preferences
   */
  async getBestPaymentTokenForApp(
    appAddress: Address,
    userAddress: Address,
    gasCostETH: bigint,
    tokenBalances: TokenBalance[],
  ): Promise<{ bestToken: Address; tokenCost: bigint; reason: string }> {
    const tokens = tokenBalances.map((t) => t.token.address)
    const balances = tokenBalances.map((t) => t.balance)

    const [bestToken, tokenCost, reason] =
      await this.config.publicClient.readContract({
        address: this.paymasterAddress,
        abi: CROSS_CHAIN_PAYMASTER_ABI,
        functionName: 'getBestPaymentTokenForApp',
        args: [appAddress, userAddress, gasCostETH, tokens, balances],
      })

    return { bestToken, tokenCost, reason }
  }

  /**
   * Preview token cost for gas
   */
  async previewTokenCost(
    estimatedGas: bigint,
    gasPrice: bigint,
    token: Address,
  ): Promise<bigint> {
    const cost = await this.config.publicClient.readContract({
      address: this.paymasterAddress,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'previewTokenCost',
      args: [estimatedGas, gasPrice, token],
    })
    return cost
  }

  /**
   * Get swap quote from embedded AMM
   */
  async getSwapQuote(
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
  ): Promise<{ amountOut: bigint; priceImpact: number }> {
    const [amountOut, priceImpactBps] =
      await this.config.publicClient.readContract({
        address: this.paymasterAddress,
        abi: CROSS_CHAIN_PAYMASTER_ABI,
        functionName: 'getSwapQuote',
        args: [tokenIn, tokenOut, amountIn],
      })

    return {
      amountOut,
      priceImpact: Number(priceImpactBps) / 10000,
    }
  }

  /**
   * Execute swap via embedded AMM
   */
  async swap(params: SwapParams): Promise<Hex> {
    const { walletClient } = this.config
    if (!walletClient?.account) {
      throw new Error('Wallet not connected')
    }

    const isNativeIn = params.tokenIn === ZERO_ADDRESS
    const value = isNativeIn ? params.amountIn : 0n

    const hash = await walletClient.writeContract({
      chain: null,
      account: walletClient.account,
      address: this.paymasterAddress,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'swap',
      args: [
        params.tokenIn,
        params.tokenOut,
        params.amountIn,
        params.minAmountOut,
      ],
      value,
    })

    return hash
  }

  /**
   * Build paymaster data for ERC-4337 UserOp
   */
  buildPaymasterData(
    paymentToken: Address,
    appAddress: Address = ZERO_ADDRESS,
  ): Hex {
    // Token payment: [mode(1)][token(20)][appAddress(20)]
    const modeHex = '00'
    const tokenHex = paymentToken.slice(2).toLowerCase()
    const appHex = appAddress.slice(2).toLowerCase()
    return expectHex(`0x${modeHex}${tokenHex}${appHex}`, 'paymasterData')
  }
}

export function createEILClient(config: EILClientConfig): EILClient {
  return new EILClient(config)
}
