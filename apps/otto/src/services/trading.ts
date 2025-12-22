/**
 * Otto Trading Service
 * Handles all trading operations: swaps, bridges, token launches, etc.
 */

import { type Address, formatUnits, type Hex, parseUnits } from 'viem'
import { DEFAULT_CHAIN_ID, DEFAULT_SLIPPAGE_BPS, getChainName } from '../config'
import {
  BalanceSchema,
  BridgeParamsSchema,
  BridgeResultSchema,
  CreateLimitOrderParamsSchema,
  ExternalBalancesResponseSchema,
  ExternalBridgeExecuteResponseSchema,
  ExternalBridgeQuotesResponseSchema,
  ExternalBridgeStatusResponseSchema,
  ExternalSwapExecuteResponseSchema,
  ExternalTokenInfoResponseSchema,
  ExternalTokenLaunchResponseSchema,
  ExternalTransferResponseSchema,
  expectValid,
  LimitOrderSchema,
  OttoUserSchema,
  SwapParamsSchema,
  SwapQuoteSchema,
  SwapResultSchema,
  TokenInfoSchema,
  TokenLaunchParamsSchema,
  TokenLaunchResultSchema,
} from '../schemas'
import type {
  Balance,
  BridgeParams,
  BridgeQuote,
  BridgeResult,
  CreateLimitOrderParams,
  LimitOrder,
  OttoUser,
  SwapParams,
  SwapQuote,
  SwapResult,
  TokenInfo,
  TokenLaunchParams,
  TokenLaunchResult,
} from '../types'
import { getRequiredEnv } from '../utils/validation'

function getBazaarApi(): string {
  return getRequiredEnv('BAZAAR_API_URL', 'http://localhost:3001')
}

function getGatewayApi(): string {
  return getRequiredEnv('GATEWAY_API_URL', 'http://localhost:4003')
}

function getIndexerApi(): string {
  return getRequiredEnv('INDEXER_API_URL', 'http://localhost:4350')
}

// Bounded limits to prevent memory exhaustion
const MAX_LIMIT_ORDERS = 10000
const MAX_ORDERS_PER_USER = 100

export class TradingService {
  private limitOrders = new Map<string, LimitOrder>()

  // ============================================================================
  // Token & Price Operations
  // ============================================================================

  async getTokenInfo(
    addressOrSymbol: string,
    chainId: number = DEFAULT_CHAIN_ID,
  ): Promise<TokenInfo | null> {
    if (!addressOrSymbol || typeof addressOrSymbol !== 'string') {
      throw new Error('Invalid token address or symbol')
    }

    const response = await fetch(`${getIndexerApi()}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `
          query GetToken($input: String!, $chainId: Int!) {
            token(input: $input, chainId: $chainId) {
              address
              chainId
              symbol
              name
              decimals
              logoUrl
              price
              priceChange24h
            }
          }
        `,
        variables: { input: addressOrSymbol, chainId },
      }),
    })

    if (!response.ok) {
      return null
    }

    const rawData = await response.json()
    const data = expectValid(
      ExternalTokenInfoResponseSchema,
      rawData,
      'token info response',
    )
    const token = data.data?.token

    if (!token) {
      return null
    }

    // Validate token data
    return expectValid(TokenInfoSchema, token, 'token info')
  }

  async getTokenPrice(
    addressOrSymbol: string,
    chainId: number = DEFAULT_CHAIN_ID,
  ): Promise<number | null> {
    const token = await this.getTokenInfo(addressOrSymbol, chainId)
    return token?.price ?? null
  }

  async getBalances(
    userAddress: Address,
    chainId?: number,
  ): Promise<Balance[]> {
    if (!userAddress) {
      throw new Error('User address is required')
    }

    const chains = chainId ? [chainId] : [DEFAULT_CHAIN_ID, 1, 8453, 10, 42161]
    const balances: Balance[] = []

    for (const chain of chains) {
      const response = await fetch(`${getIndexerApi()}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `
            query GetBalances($address: String!, $chainId: Int!) {
              balances(address: $address, chainId: $chainId) {
                token {
                  address
                  chainId
                  symbol
                  name
                  decimals
                  logoUrl
                  price
                }
                balance
                balanceUsd
              }
            }
          `,
          variables: { address: userAddress, chainId: chain },
        }),
      })

      if (response.ok) {
        const rawData = await response.json()
        const data = expectValid(
          ExternalBalancesResponseSchema,
          rawData,
          `balances response chain ${chain}`,
        )
        if (data.data?.balances) {
          // Validate each balance
          for (const balance of data.data.balances) {
            const validated = expectValid(
              BalanceSchema,
              balance,
              `balance on chain ${chain}`,
            )
            balances.push(validated)
          }
        }
      }
    }

    return balances
  }

  // ============================================================================
  // Swap Operations
  // ============================================================================

  async getSwapQuote(params: SwapParams): Promise<SwapQuote | null> {
    const validatedParams = expectValid(SwapParamsSchema, params, 'swap params')
    const chainId = validatedParams.chainId ?? DEFAULT_CHAIN_ID
    const slippageBps = validatedParams.slippageBps ?? DEFAULT_SLIPPAGE_BPS

    const response = await fetch(`${getBazaarApi()}/api/swap/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromToken: validatedParams.fromToken,
        toToken: validatedParams.toToken,
        amount: validatedParams.amount,
        chainId,
        slippageBps,
      }),
    })

    if (!response.ok) {
      return null
    }

    return expectValid(SwapQuoteSchema, await response.json(), 'swap quote')
  }

  async executeSwap(user: OttoUser, params: SwapParams): Promise<SwapResult> {
    const validatedUser = expectValid(OttoUserSchema, user, 'user')
    const validatedParams = expectValid(SwapParamsSchema, params, 'swap params')

    const quote = await this.getSwapQuote(validatedParams)
    if (!quote) {
      return {
        success: false,
        fromAmount: validatedParams.amount,
        toAmount: '0',
        error: 'Failed to get swap quote',
      }
    }

    // Check quote hasn't expired to prevent stale/front-run transactions
    if (quote.validUntil < Date.now()) {
      return {
        success: false,
        fromAmount: validatedParams.amount,
        toAmount: '0',
        error: 'Quote expired, please try again',
      }
    }

    // Use smart account if available, otherwise primary wallet
    const walletAddress =
      validatedUser.smartAccountAddress ?? validatedUser.primaryWallet
    if (!walletAddress) {
      throw new Error('User has no wallet address')
    }

    const response = await fetch(`${getBazaarApi()}/api/swap/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Address': walletAddress,
      },
      body: JSON.stringify({
        quoteId: quote.quoteId,
        fromToken: validatedParams.fromToken,
        toToken: validatedParams.toToken,
        amount: validatedParams.amount,
        minOutput: quote.toAmountMin,
        chainId: validatedParams.chainId ?? DEFAULT_CHAIN_ID,
        // For AA, we'd include session key signature here
        sessionKey: validatedUser.sessionKeyAddress,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      return {
        success: false,
        fromAmount: validatedParams.amount,
        toAmount: '0',
        error,
      }
    }

    const rawResult = await response.json()
    const result = expectValid(
      ExternalSwapExecuteResponseSchema,
      rawResult,
      'swap execute response',
    )

    const swapResult = {
      success: true,
      txHash: result.txHash,
      fromAmount: validatedParams.amount,
      toAmount: result.toAmount,
    }

    return expectValid(SwapResultSchema, swapResult, 'swap result')
  }

  // ============================================================================
  // Bridge Operations
  // ============================================================================

  async getBridgeQuote(params: BridgeParams): Promise<BridgeQuote | null> {
    const validatedParams = expectValid(
      BridgeParamsSchema,
      params,
      'bridge params',
    )

    const response = await fetch(`${getGatewayApi()}/api/intents/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceChain: validatedParams.sourceChainId,
        destinationChain: validatedParams.destChainId,
        sourceToken: validatedParams.sourceToken,
        destinationToken: validatedParams.destToken,
        amount: validatedParams.amount,
      }),
    })

    if (!response.ok) {
      return null
    }

    const quotes = expectValid(
      ExternalBridgeQuotesResponseSchema,
      await response.json(),
      'bridge quotes response',
    )
    const bestQuote = quotes[0]

    if (!bestQuote) {
      return null
    }

    return bestQuote
  }

  async executeBridge(
    user: OttoUser,
    params: BridgeParams,
  ): Promise<BridgeResult> {
    const validatedUser = expectValid(OttoUserSchema, user, 'user')
    const validatedParams = expectValid(
      BridgeParamsSchema,
      params,
      'bridge params',
    )

    const quote = await this.getBridgeQuote(validatedParams)
    if (!quote) {
      return {
        success: false,
        status: 'failed',
        error: 'Failed to get bridge quote',
      }
    }

    // Check quote hasn't expired to prevent stale/front-run transactions
    if (quote.validUntil < Date.now()) {
      return {
        success: false,
        status: 'failed',
        error: 'Quote expired, please try again',
      }
    }

    const walletAddress =
      validatedUser.smartAccountAddress ?? validatedUser.primaryWallet
    if (!walletAddress) {
      throw new Error('User has no wallet address')
    }

    const response = await fetch(`${getGatewayApi()}/api/intents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Address': walletAddress,
      },
      body: JSON.stringify({
        quoteId: quote.quoteId,
        sourceChain: validatedParams.sourceChainId,
        destinationChain: validatedParams.destChainId,
        sourceToken: validatedParams.sourceToken,
        destinationToken: validatedParams.destToken,
        amount: validatedParams.amount,
        recipient: validatedParams.recipient ?? walletAddress,
        maxSlippageBps: validatedParams.maxSlippageBps ?? DEFAULT_SLIPPAGE_BPS,
        sessionKey: validatedUser.sessionKeyAddress,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      return { success: false, status: 'failed', error }
    }

    const rawResult = await response.json()
    const result = expectValid(
      ExternalBridgeExecuteResponseSchema,
      rawResult,
      'bridge execute response',
    )

    const bridgeResult = {
      success: true,
      intentId: result.intentId,
      sourceTxHash: result.sourceTxHash,
      status: 'pending' as const,
    }

    return expectValid(BridgeResultSchema, bridgeResult, 'bridge result')
  }

  async getBridgeStatus(intentId: string): Promise<BridgeResult> {
    const response = await fetch(`${getGatewayApi()}/api/intents/${intentId}`)

    if (!response.ok) {
      return {
        success: false,
        status: 'failed',
        error: 'Failed to get intent status',
      }
    }

    const rawData = await response.json()
    const data = expectValid(
      ExternalBridgeStatusResponseSchema,
      rawData,
      'bridge status response',
    )

    const bridgeResult = {
      success: data.status === 'filled',
      intentId,
      sourceTxHash: data.sourceTxHash,
      destTxHash: data.destinationTxHash,
      status:
        data.status === 'open' || data.status === 'pending'
          ? ('pending' as const)
          : data.status === 'filled'
            ? ('filled' as const)
            : ('expired' as const),
    }

    return expectValid(BridgeResultSchema, bridgeResult, 'bridge status result')
  }

  // ============================================================================
  // Token Launch (Clanker-style)
  // ============================================================================

  async launchToken(
    user: OttoUser,
    params: TokenLaunchParams,
  ): Promise<TokenLaunchResult> {
    const validatedUser = expectValid(OttoUserSchema, user, 'user')
    const validatedParams = expectValid(
      TokenLaunchParamsSchema,
      params,
      'token launch params',
    )

    const walletAddress =
      validatedUser.smartAccountAddress ?? validatedUser.primaryWallet
    if (!walletAddress) {
      throw new Error('User has no wallet address')
    }

    const chainId = validatedParams.chainId ?? DEFAULT_CHAIN_ID

    const response = await fetch(`${getBazaarApi()}/api/launchpad/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Address': walletAddress,
      },
      body: JSON.stringify({
        name: validatedParams.name,
        symbol: validatedParams.symbol,
        description: validatedParams.description,
        imageUrl: validatedParams.imageUrl,
        initialSupply: validatedParams.initialSupply,
        initialLiquidity: validatedParams.initialLiquidity,
        chainId,
        taxBuyBps: validatedParams.taxBuyBps ?? 0,
        taxSellBps: validatedParams.taxSellBps ?? 0,
        maxWalletBps: validatedParams.maxWalletBps ?? 10000, // 100% = no limit
        creator: walletAddress,
        sessionKey: validatedUser.sessionKeyAddress,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error }
    }

    const rawResult = await response.json()
    const result = expectValid(
      ExternalTokenLaunchResponseSchema,
      rawResult,
      'token launch response',
    )

    const launchResult = {
      success: true,
      tokenAddress: result.tokenAddress,
      poolAddress: result.poolAddress,
      txHash: result.txHash,
    }

    return expectValid(
      TokenLaunchResultSchema,
      launchResult,
      'token launch result',
    )
  }

  // ============================================================================
  // Limit Orders
  // ============================================================================

  async createLimitOrder(
    user: OttoUser,
    params: CreateLimitOrderParams,
  ): Promise<LimitOrder> {
    expectValid(OttoUserSchema, user, 'user')
    const validatedParams = expectValid(
      CreateLimitOrderParamsSchema,
      params,
      'limit order params',
    )

    // Enforce max orders per user to prevent abuse
    const userOrders = this.getOpenOrders(validatedParams.userId)
    if (userOrders.length >= MAX_ORDERS_PER_USER) {
      throw new Error(`Maximum ${MAX_ORDERS_PER_USER} open orders per user`)
    }

    // Enforce global limit and cleanup old orders if needed
    if (this.limitOrders.size >= MAX_LIMIT_ORDERS) {
      // Remove oldest non-open orders first
      for (const [orderId, order] of this.limitOrders) {
        if (order.status !== 'open') {
          this.limitOrders.delete(orderId)
          if (this.limitOrders.size < MAX_LIMIT_ORDERS) break
        }
      }
      // If still at limit, reject new order
      if (this.limitOrders.size >= MAX_LIMIT_ORDERS) {
        throw new Error('Maximum limit orders reached, please try again later')
      }
    }

    const chainId = validatedParams.chainId ?? DEFAULT_CHAIN_ID
    const fromToken = await this.getTokenInfo(
      validatedParams.fromToken.toString(),
      chainId,
    )
    const toToken = await this.getTokenInfo(
      validatedParams.toToken.toString(),
      chainId,
    )

    if (!fromToken || !toToken) {
      throw new Error(
        `Invalid tokens: ${!fromToken ? 'fromToken' : 'toToken'} not found`,
      )
    }

    const orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const order: LimitOrder = {
      orderId,
      userId: validatedParams.userId,
      fromToken,
      toToken,
      fromAmount: validatedParams.fromAmount,
      targetPrice: validatedParams.targetPrice,
      chainId,
      status: 'open',
      createdAt: Date.now(),
      expiresAt: validatedParams.expiresIn
        ? Date.now() + validatedParams.expiresIn
        : undefined,
    }

    const validatedOrder = expectValid(LimitOrderSchema, order, 'limit order')
    this.limitOrders.set(orderId, validatedOrder)

    // In production, this would be submitted to a limit order system
    // For now, we store it locally and check periodically

    return validatedOrder
  }

  async cancelLimitOrder(orderId: string, userId: string): Promise<boolean> {
    if (!orderId || !userId) {
      throw new Error('Order ID and user ID are required')
    }

    const order = this.limitOrders.get(orderId)
    if (!order) {
      return false
    }

    if (order.userId !== userId) {
      return false
    }

    if (order.status !== 'open') {
      return false
    }

    order.status = 'cancelled'
    return true
  }

  getOpenOrders(userId: string): LimitOrder[] {
    return Array.from(this.limitOrders.values()).filter(
      (o) => o.userId === userId && o.status === 'open',
    )
  }

  // ============================================================================
  // Send Operations
  // ============================================================================

  async sendTokens(
    user: OttoUser,
    tokenAddress: Address,
    amount: string,
    recipient: Address,
    chainId: number = DEFAULT_CHAIN_ID,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    const validatedUser = expectValid(OttoUserSchema, user, 'user')

    // Validate inputs
    if (!tokenAddress || !amount || !recipient) {
      throw new Error('Token address, amount, and recipient are required')
    }

    const walletAddress =
      validatedUser.smartAccountAddress ?? validatedUser.primaryWallet
    if (!walletAddress) {
      throw new Error('User has no wallet address')
    }

    const response = await fetch(`${getBazaarApi()}/api/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Address': walletAddress,
      },
      body: JSON.stringify({
        token: tokenAddress,
        amount,
        to: recipient,
        chainId,
        sessionKey: validatedUser.sessionKeyAddress,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error }
    }

    const rawResult = await response.json()
    const result = expectValid(
      ExternalTransferResponseSchema,
      rawResult,
      'transfer response',
    )
    return { success: true, txHash: result.txHash }
  }

  // ============================================================================
  // Portfolio
  // ============================================================================

  async getPortfolio(
    user: OttoUser,
    chainId?: number,
  ): Promise<{
    totalValueUsd: number
    balances: Balance[]
    chains: { chainId: number; name: string; valueUsd: number }[]
  }> {
    const balances = await this.getBalances(user.primaryWallet, chainId)

    let totalValueUsd = 0
    const chainValues = new Map<number, number>()

    for (const balance of balances) {
      const value = balance.balanceUsd ?? 0
      totalValueUsd += value

      const chainId = balance.token.chainId
      chainValues.set(chainId, (chainValues.get(chainId) ?? 0) + value)
    }

    const chains = Array.from(chainValues.entries()).map(
      ([chainId, valueUsd]) => ({
        chainId,
        name: getChainName(chainId),
        valueUsd,
      }),
    )

    return { totalValueUsd, balances, chains }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  formatAmount(amount: string, decimals: number): string {
    return formatUnits(BigInt(amount), decimals)
  }

  parseAmount(amount: string, decimals: number): string {
    if (!amount || typeof amount !== 'string') {
      throw new Error('Amount must be a non-empty string')
    }

    // Validate amount format to prevent overflow attacks
    if (!/^\d+(\.\d+)?$/.test(amount)) {
      throw new Error('Amount must be a valid decimal number')
    }

    // Limit amount length to prevent BigInt overflow (max ~77 digits for uint256)
    const maxLength = 77
    const amountWithoutDecimal = amount.replace('.', '')
    if (amountWithoutDecimal.length > maxLength) {
      throw new Error(`Amount too large: max ${maxLength} digits`)
    }

    if (decimals < 0 || decimals > 255) {
      throw new Error(`Invalid decimals: ${decimals}`)
    }

    const result = parseUnits(amount, decimals)

    // Ensure result is within uint256 bounds
    const MAX_UINT256 = 2n ** 256n - 1n
    if (result > MAX_UINT256) {
      throw new Error('Amount exceeds maximum token amount (uint256)')
    }

    return result.toString()
  }

  formatUsd(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }
}

// Singleton instance
let tradingService: TradingService | null = null

export function getTradingService(): TradingService {
  if (!tradingService) {
    tradingService = new TradingService()
  }
  return tradingService
}
