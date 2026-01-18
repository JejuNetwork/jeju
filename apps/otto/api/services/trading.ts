/**
 * Otto Trading Service
 *
 * Trading operations with DWS cache integration for:
 * - Token info lookups (60s TTL)
 * - Token prices (30s TTL)
 * - User balances (15s TTL)
 */

import { getCacheClient, safeParseCached } from '@jejunetwork/cache'
import { getCoreAppUrl, isDevelopmentEnv } from '@jejunetwork/config'
import { expectValid } from '@jejunetwork/types'
import { type Address, formatUnits, type Hex, parseUnits } from 'viem'
import { z } from 'zod'
import {
  type Balance,
  BalanceSchema,
  type BridgeParams,
  BridgeParamsSchema,
  type BridgeQuote,
  type BridgeResult,
  BridgeResultSchema,
  type CreateLimitOrderParams,
  CreateLimitOrderParamsSchema,
  ExternalBalancesResponseSchema,
  ExternalBridgeExecuteResponseSchema,
  ExternalBridgeQuotesResponseSchema,
  ExternalBridgeStatusResponseSchema,
  ExternalSwapExecuteResponseSchema,
  ExternalTokenInfoResponseSchema,
  ExternalTokenLaunchResponseSchema,
  ExternalTransferResponseSchema,
  type LimitOrder,
  LimitOrderSchema,
  type OttoUser,
  OttoUserSchema,
  type SwapParams,
  SwapParamsSchema,
  type SwapQuote,
  SwapQuoteSchema,
  type SwapResult,
  SwapResultSchema,
  type TokenInfo,
  TokenInfoSchema,
  type TokenLaunchParams,
  TokenLaunchParamsSchema,
  type TokenLaunchResult,
  TokenLaunchResultSchema,
} from '../../lib'
import { DEFAULT_CHAIN_ID, DEFAULT_SLIPPAGE_BPS, getChainName } from '../config'
import { getRequiredEnv } from '../utils/validation'
import { gatewayApi } from './clients'

const DEV_MODE = isDevelopmentEnv()

// Cache TTLs in seconds
const CACHE_TTL = {
  TOKEN_INFO: 60, // 1 minute
  TOKEN_PRICE: 30, // 30 seconds
  BALANCES: 15, // 15 seconds
} as const

// Cache client for Otto trading data
function getOttoCache() {
  return getCacheClient('otto-trading')
}

function getBazaarApi(): string {
  return getRequiredEnv('BAZAAR_API_URL', getCoreAppUrl('BAZAAR'))
}

function getIndexerApi(): string | null {
  const url =
    (typeof process !== 'undefined'
      ? process.env.INDEXER_API_URL
      : undefined) ?? getCoreAppUrl('INDEXER_GRAPHQL')
  if (url) return url
  if (DEV_MODE) return null
  throw new Error('Missing required environment variable: INDEXER_API_URL')
}

// Mock token prices for development
const DEV_TOKEN_PRICES: Record<string, number> = {
  ETH: 3500,
  WETH: 3500,
  USDC: 1,
  USDT: 1,
  DAI: 1,
  WBTC: 95000,
  BTC: 95000,
  ARB: 1.2,
  OP: 2.5,
  BASE: 0.5,
  LINK: 15,
  UNI: 12,
  AAVE: 180,
  CRV: 0.45,
}

const MAX_LIMIT_ORDERS = 10000
const MAX_ORDERS_PER_USER = 100

/** Zero address constant - properly typed */
const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'
/** USDC address on mainnet */
const USDC_MAINNET_ADDRESS: Address =
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

export class TradingService {
  private limitOrders = new Map<string, LimitOrder>()

  async getTokenInfo(
    addressOrSymbol: string,
    chainId: number = DEFAULT_CHAIN_ID,
  ): Promise<TokenInfo | null> {
    if (!addressOrSymbol || typeof addressOrSymbol !== 'string') {
      throw new Error('Invalid token address or symbol')
    }

    const indexerUrl = getIndexerApi()

    if (!indexerUrl && DEV_MODE) {
      return this.getMockTokenInfo(addressOrSymbol, chainId)
    }

    // Check cache first
    const cache = getOttoCache()
    const cacheKey = `token:${chainId}:${addressOrSymbol.toLowerCase()}`
    const cached = await cache.get(cacheKey).catch((err: Error) => {
      console.warn('[Otto] Cache read failed:', err)
      return null
    })
    const cachedToken = safeParseCached(cached, TokenInfoSchema)
    if (cachedToken) {
      return cachedToken
    }

    const response = await fetch(`${indexerUrl}/graphql`, {
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
    }).catch(() => null)

    if (!response?.ok) {
      if (DEV_MODE) {
        return this.getMockTokenInfo(addressOrSymbol, chainId)
      }
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
      if (DEV_MODE) {
        return this.getMockTokenInfo(addressOrSymbol, chainId)
      }
      return null
    }

    // Validate and cache token data
    const validatedToken = expectValid(TokenInfoSchema, token, 'token info')
    cache
      .set(cacheKey, JSON.stringify(validatedToken), CACHE_TTL.TOKEN_INFO)
      .catch((err: Error) => console.warn('[Otto] Cache write failed:', err))

    return validatedToken
  }

  private getMockTokenInfo(symbol: string, chainId: number): TokenInfo | null {
    const upperSymbol = symbol.toUpperCase()
    const price = DEV_TOKEN_PRICES[upperSymbol]
    if (!price) return null

    return {
      address: ZERO_ADDRESS,
      chainId,
      symbol: upperSymbol,
      name: upperSymbol,
      decimals: upperSymbol === 'WBTC' || upperSymbol === 'BTC' ? 8 : 18,
      logoUrl: undefined,
      price,
      priceChange24h: 0,
    }
  }

  async getTokenPrice(
    addressOrSymbol: string,
    chainId: number = DEFAULT_CHAIN_ID,
  ): Promise<number | null> {
    if (DEV_MODE) {
      const upperSymbol = addressOrSymbol.toUpperCase()
      if (DEV_TOKEN_PRICES[upperSymbol]) {
        return DEV_TOKEN_PRICES[upperSymbol]
      }
    }

    // Check price cache (shorter TTL than token info)
    const cache = getOttoCache()
    const cacheKey = `price:${chainId}:${addressOrSymbol.toLowerCase()}`
    const cached = await cache.get(cacheKey).catch((err: Error) => {
      console.warn('[Otto] Cache read failed:', err)
      return null
    })
    if (cached) {
      return parseFloat(cached)
    }

    const token = await this.getTokenInfo(addressOrSymbol, chainId)
    const price = token?.price ?? null

    if (price !== null) {
      cache
        .set(cacheKey, price.toString(), CACHE_TTL.TOKEN_PRICE)
        .catch((err: Error) => console.warn('[Otto] Cache write failed:', err))
    }

    return price
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

    const indexerUrl = getIndexerApi()

    if (!indexerUrl && DEV_MODE) {
      return this.getMockBalances(userAddress, chainId ?? DEFAULT_CHAIN_ID)
    }

    // Check cache first
    const cache = getOttoCache()
    const cacheKey = `balances:${userAddress.toLowerCase()}:${chains.sort().join(',')}`
    const cached = await cache.get(cacheKey).catch((err: Error) => {
      console.warn('[Otto] Cache read failed:', err)
      return null
    })
    const cachedBalances = safeParseCached(cached, z.array(BalanceSchema))
    if (cachedBalances) {
      return cachedBalances
    }

    for (const chain of chains) {
      const response = await fetch(`${indexerUrl}/graphql`, {
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
      }).catch(() => null)

      if (response?.ok) {
        const rawData = await response.json()
        const data = expectValid(
          ExternalBalancesResponseSchema,
          rawData,
          `balances response chain ${chain}`,
        )
        if (data.data?.balances) {
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

    if (balances.length === 0 && DEV_MODE) {
      return this.getMockBalances(userAddress, chainId ?? DEFAULT_CHAIN_ID)
    }

    // Cache the balances
    if (balances.length > 0) {
      cache
        .set(cacheKey, JSON.stringify(balances), CACHE_TTL.BALANCES)
        .catch((err: Error) => console.warn('[Otto] Cache write failed:', err))
    }

    return balances
  }

  private getMockBalances(_userAddress: Address, chainId: number): Balance[] {
    return [
      {
        token: {
          address: ZERO_ADDRESS,
          chainId,
          symbol: 'ETH',
          name: 'Ethereum',
          decimals: 18,
          price: DEV_TOKEN_PRICES.ETH,
        },
        balance: '1000000000000000000', // 1 ETH
        balanceUsd: DEV_TOKEN_PRICES.ETH,
      },
      {
        token: {
          address: USDC_MAINNET_ADDRESS,
          chainId,
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          price: 1,
        },
        balance: '1000000000', // 1000 USDC
        balanceUsd: 1000,
      },
    ]
  }

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

    if (quote.validUntil < Date.now()) {
      return {
        success: false,
        fromAmount: validatedParams.amount,
        toAmount: '0',
        error: 'Quote expired, please try again',
      }
    }

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

  async getBridgeQuote(params: BridgeParams): Promise<BridgeQuote | null> {
    const validatedParams = expectValid(
      BridgeParamsSchema,
      params,
      'bridge params',
    )

    const response = await gatewayApi.intents.quote({
      sourceChain: validatedParams.sourceChainId,
      destinationChain: validatedParams.destChainId,
      sourceToken: validatedParams.sourceToken,
      destinationToken: validatedParams.destToken,
      amount: validatedParams.amount,
    })

    if (response.error) {
      return null
    }

    const quotes = expectValid(
      ExternalBridgeQuotesResponseSchema,
      response.data,
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

    const response = await gatewayApi.intents.create(
      {
        quoteId: quote.quoteId,
        sourceChain: validatedParams.sourceChainId,
        destinationChain: validatedParams.destChainId,
        sourceToken: validatedParams.sourceToken,
        destinationToken: validatedParams.destToken,
        amount: validatedParams.amount,
        recipient: validatedParams.recipient ?? walletAddress,
        maxSlippageBps: validatedParams.maxSlippageBps ?? DEFAULT_SLIPPAGE_BPS,
      },
      {
        headers: {
          'X-Wallet-Address': walletAddress,
        },
      },
    )

    if (response.error) {
      return { success: false, status: 'failed', error: response.error }
    }

    const result = expectValid(
      ExternalBridgeExecuteResponseSchema,
      response.data,
      'bridge execute response',
    )

    const pendingStatus: 'pending' = 'pending'
    const bridgeResult = {
      success: true,
      intentId: result.intentId,
      sourceTxHash: result.sourceTxHash,
      status: pendingStatus,
    }

    return expectValid(BridgeResultSchema, bridgeResult, 'bridge result')
  }

  async getBridgeStatus(intentId: string): Promise<BridgeResult> {
    const response = await gatewayApi.intents.getStatus(intentId)

    if (response.error) {
      return {
        success: false,
        status: 'failed',
        error: 'Failed to get intent status',
      }
    }

    const data = expectValid(
      ExternalBridgeStatusResponseSchema,
      response.data,
      'bridge status response',
    )

    const mapStatus = (
      s: 'open' | 'pending' | 'filled' | 'expired',
    ): 'pending' | 'filled' | 'expired' => {
      if (s === 'open' || s === 'pending') return 'pending'
      if (s === 'filled') return 'filled'
      return 'expired'
    }

    const bridgeResult = {
      success: data.status === 'filled',
      intentId,
      sourceTxHash: data.sourceTxHash,
      destTxHash: data.destinationTxHash,
      status: mapStatus(data.status),
    }

    return expectValid(BridgeResultSchema, bridgeResult, 'bridge status result')
  }

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
        maxWalletBps: validatedParams.maxWalletBps ?? 10000,
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

    const userOrders = this.getOpenOrders(validatedParams.userId)
    if (userOrders.length >= MAX_ORDERS_PER_USER) {
      throw new Error(`Maximum ${MAX_ORDERS_PER_USER} open orders per user`)
    }

    if (this.limitOrders.size >= MAX_LIMIT_ORDERS) {
      for (const [orderId, order] of this.limitOrders) {
        if (order.status !== 'open') {
          this.limitOrders.delete(orderId)
          if (this.limitOrders.size < MAX_LIMIT_ORDERS) break
        }
      }
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

  async sendTokens(
    user: OttoUser,
    tokenAddress: Address,
    amount: string,
    recipient: Address,
    chainId: number = DEFAULT_CHAIN_ID,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    const validatedUser = expectValid(OttoUserSchema, user, 'user')

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

  formatAmount(amount: string, decimals: number): string {
    return formatUnits(BigInt(amount), decimals)
  }

  parseAmount(amount: string, decimals: number): string {
    if (!amount || typeof amount !== 'string') {
      throw new Error('Amount must be a non-empty string')
    }

    if (!/^\d+(\.\d+)?$/.test(amount)) {
      throw new Error('Amount must be a valid decimal number')
    }

    const maxLength = 77
    const amountWithoutDecimal = amount.replace('.', '')
    if (amountWithoutDecimal.length > maxLength) {
      throw new Error(`Amount too large: max ${maxLength} digits`)
    }

    if (decimals < 0 || decimals > 255) {
      throw new Error(`Invalid decimals: ${decimals}`)
    }

    const result = parseUnits(amount, decimals)

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

let tradingService: TradingService | null = null

export function getTradingService(): TradingService {
  if (!tradingService) {
    tradingService = new TradingService()
  }
  return tradingService
}
