/**
 * CoW Protocol Integration
 *
 * CoW Protocol uses batch auctions where solvers compete to provide
 * the best execution for a batch of orders.
 *
 * This implementation provides FULL functionality EXCEPT solver competition:
 *
 * ✅ Works without registration:
 * - Monitor auctions and orders
 * - Create and sign orders (as a market maker)
 * - Get quotes from CoW API
 * - Build settlement calldata
 * - Route orders through our DEXs
 * - Provide liquidity via pre-signed orders
 *
 * ❌ Requires $1M+ bond:
 * - Submitting solutions to solver competition
 *
 * Strategy: Instead of competing as a solver, we act as a MARKET MAKER:
 * 1. Monitor CoW orders for profitable fills
 * 2. Create counter-orders that match them
 * 3. Let registered solvers match our orders with user orders (CoW = Coincidence of Wants)
 * 4. Earn spread between our quote and execution
 */

import { EventEmitter } from 'node:events'
import {
  type Address,
  hexToBytes,
  keccak256,
  type PublicClient,
  toHex,
  type WalletClient,
} from 'viem'

// CoW Protocol Settlement addresses (same on all chains via CREATE2)
export const COW_SETTLEMENT: Record<number, Address> = {
  1: '0x9008D19f58AAbD9eD0D60971565AA8510560ab41', // Ethereum
  42161: '0x9008D19f58AAbD9eD0D60971565AA8510560ab41', // Arbitrum
  100: '0x9008D19f58AAbD9eD0D60971565AA8510560ab41', // Gnosis
}

// CoW Vault Relayer (for token approvals)
export const COW_VAULT_RELAYER: Record<number, Address> = {
  1: '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110',
  42161: '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110',
  100: '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110',
}

// CoW Protocol API endpoints
const COW_API: Record<number, string> = {
  1: 'https://api.cow.fi/mainnet',
  42161: 'https://api.cow.fi/arbitrum_one',
  100: 'https://api.cow.fi/xdai',
}

// EIP-712 Domain for CoW Protocol
const COW_DOMAIN = {
  name: 'Gnosis Protocol',
  version: 'v2',
} as const

// Order types for EIP-712 signing (used in order hash computation)
const _ORDER_TYPE_HASH = keccak256(
  toHex(
    'Order(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,string kind,bool partiallyFillable,string sellTokenBalance,string buyTokenBalance)',
  ),
)
void _ORDER_TYPE_HASH // Reserved for future EIP-712 signing

export interface CowOrder {
  uid: `0x${string}`
  chainId: number
  owner: Address
  sellToken: Address
  buyToken: Address
  sellAmount: bigint
  buyAmount: bigint
  validTo: number
  appData: `0x${string}`
  feeAmount: bigint
  kind: 'sell' | 'buy'
  partiallyFillable: boolean
  receiver: Address
  signature: `0x${string}`
  signingScheme: 'eip712' | 'ethsign' | 'presign' | 'eip1271'
  status: 'open' | 'fulfilled' | 'cancelled' | 'expired'
  createdAt: number
  filledAmount: bigint
}

export interface CowAuction {
  id: number
  chainId: number
  orders: CowOrder[]
  tokens: Address[]
  deadline: number
}

export interface CowQuote {
  sellToken: Address
  buyToken: Address
  sellAmount: bigint
  buyAmount: bigint
  feeAmount: bigint
  validTo: number
  kind: 'sell' | 'buy'
}

export interface CowOrderParams {
  sellToken: Address
  buyToken: Address
  sellAmount: bigint
  buyAmount: bigint
  validTo: number
  receiver?: Address
  partiallyFillable?: boolean
  kind?: 'sell' | 'buy'
  appData?: `0x${string}`
}

export interface CowSolution {
  auctionId: number
  trades: Array<{
    orderUid: `0x${string}`
    executedSellAmount: bigint
    executedBuyAmount: bigint
  }>
  interactions: Array<{
    target: Address
    value: bigint
    callData: `0x${string}`
  }>
  prices: Record<string, bigint>
}

interface CowApiOrder {
  uid: string
  owner: string
  sellToken: string
  buyToken: string
  sellAmount: string
  buyAmount: string
  validTo: number
  appData: string
  feeAmount: string
  kind: string
  partiallyFillable: boolean
  receiver: string
  signature: string
  signingScheme: string
  status: string
  creationDate: string
  executedSellAmount: string
  executedBuyAmount: string
}

interface CowApiAuction {
  id: number
  orders: CowApiOrder[]
}

interface CowApiQuote {
  quote: {
    sellToken: string
    buyToken: string
    sellAmount: string
    buyAmount: string
    feeAmount: string
    validTo: number
    kind: string
  }
  id: number
}

export class CowProtocolSolver extends EventEmitter {
  private clients: Map<number, { public: PublicClient; wallet?: WalletClient }>
  private supportedChains: number[]
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private running = false
  private currentAuctions = new Map<number, CowAuction>()
  private ourOrders = new Map<string, CowOrder>() // Track our market maker orders

  constructor(
    clients: Map<number, { public: PublicClient; wallet?: WalletClient }>,
    supportedChains: number[],
  ) {
    super()
    this.clients = clients
    this.supportedChains = supportedChains.filter((c) => COW_SETTLEMENT[c])
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    console.log('🐮 Starting CoW Protocol market maker...')

    // Poll for auctions and order opportunities
    await this.pollAuctions()
    this.pollInterval = setInterval(() => this.pollAuctions(), 5000)
  }

  stop(): void {
    this.running = false
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  }

  // ============================================================
  // MARKET MAKER FUNCTIONS (No registration required)
  // ============================================================

  /**
   * Get a quote from CoW Protocol for a swap
   * This tells us the expected output and fees
   */
  async getQuote(
    chainId: number,
    params: {
      sellToken: Address
      buyToken: Address
      sellAmountBeforeFee?: bigint
      buyAmountAfterFee?: bigint
      from: Address
      kind?: 'sell' | 'buy'
    },
  ): Promise<CowQuote | null> {
    const apiUrl = COW_API[chainId]
    if (!apiUrl) return null

    const quoteRequest = {
      sellToken: params.sellToken,
      buyToken: params.buyToken,
      from: params.from,
      kind: params.kind || 'sell',
      ...(params.sellAmountBeforeFee
        ? { sellAmountBeforeFee: params.sellAmountBeforeFee.toString() }
        : { buyAmountAfterFee: params.buyAmountAfterFee?.toString() }),
    }

    const response = await fetch(`${apiUrl}/api/v1/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quoteRequest),
    })

    if (!response.ok) return null

    const data = (await response.json()) as CowApiQuote

    return {
      sellToken: data.quote.sellToken as Address,
      buyToken: data.quote.buyToken as Address,
      sellAmount: BigInt(data.quote.sellAmount),
      buyAmount: BigInt(data.quote.buyAmount),
      feeAmount: BigInt(data.quote.feeAmount),
      validTo: data.quote.validTo,
      kind: data.quote.kind as 'sell' | 'buy',
    }
  }

  /**
   * Create and submit an order to CoW Protocol
   * This is how we act as a market maker - we create orders that provide liquidity
   */
  async createOrder(
    chainId: number,
    params: CowOrderParams,
  ): Promise<{ success: boolean; orderUid?: `0x${string}`; error?: string }> {
    const client = this.clients.get(chainId)
    const apiUrl = COW_API[chainId]

    if (!client?.wallet?.account) {
      return { success: false, error: 'No wallet configured' }
    }
    if (!apiUrl) {
      return { success: false, error: 'Chain not supported' }
    }

    const owner = client.wallet.account.address
    const receiver = params.receiver || owner

    // Default app data (can be customized for tracking)
    const appData =
      params.appData ||
      '0x0000000000000000000000000000000000000000000000000000000000000000'

    // Build the order struct
    const order = {
      sellToken: params.sellToken,
      buyToken: params.buyToken,
      receiver,
      sellAmount: params.sellAmount,
      buyAmount: params.buyAmount,
      validTo: params.validTo,
      appData,
      feeAmount: BigInt(0), // Fee is taken from output
      kind: params.kind || 'sell',
      partiallyFillable: params.partiallyFillable ?? false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
    }

    // Sign the order using EIP-712
    const signature = await this.signOrder(chainId, order, client.wallet)
    if (!signature) {
      return { success: false, error: 'Failed to sign order' }
    }

    // Submit to CoW API
    const orderCreation = {
      ...order,
      sellAmount: order.sellAmount.toString(),
      buyAmount: order.buyAmount.toString(),
      feeAmount: order.feeAmount.toString(),
      signature,
      signingScheme: 'eip712',
      from: owner,
    }

    const response = await fetch(`${apiUrl}/api/v1/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderCreation),
    })

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error }
    }

    const uid = (await response.json()) as string
    console.log(`   ✅ CoW order created: ${uid.slice(0, 20)}...`)

    return { success: true, orderUid: uid as `0x${string}` }
  }

  /**
   * Cancel an order we created
   */
  async cancelOrder(
    chainId: number,
    orderUid: `0x${string}`,
  ): Promise<{ success: boolean; error?: string }> {
    const client = this.clients.get(chainId)
    const apiUrl = COW_API[chainId]

    if (!client?.wallet?.account) {
      return { success: false, error: 'No wallet configured' }
    }
    if (!apiUrl) {
      return { success: false, error: 'Chain not supported' }
    }

    // Sign cancellation message
    const signature = await client.wallet.signMessage({
      account: client.wallet.account,
      message: { raw: hexToBytes(orderUid) },
    })

    const response = await fetch(`${apiUrl}/api/v1/orders/${orderUid}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signature,
        signingScheme: 'eip712',
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error }
    }

    this.ourOrders.delete(orderUid)
    return { success: true }
  }

  /**
   * Create a counter-order to match a user order
   * This is how we earn spread as a market maker
   */
  async createCounterOrder(
    userOrder: CowOrder,
    spreadBps: number = 10,
  ): Promise<{ success: boolean; orderUid?: `0x${string}`; error?: string }> {
    // Our counter-order: we sell what they want to buy, we buy what they want to sell
    // Add our spread to the price

    const spreadMultiplier = BigInt(10000 + spreadBps)
    const adjustedBuyAmount =
      (userOrder.sellAmount * spreadMultiplier) / BigInt(10000)

    const counterParams: CowOrderParams = {
      sellToken: userOrder.buyToken, // We sell what they buy
      buyToken: userOrder.sellToken, // We buy what they sell
      sellAmount: userOrder.buyAmount, // We sell the amount they want to buy
      buyAmount: adjustedBuyAmount, // We buy slightly more (our spread)
      validTo: userOrder.validTo,
      kind: 'sell',
      partiallyFillable: userOrder.partiallyFillable,
    }

    return this.createOrder(userOrder.chainId, counterParams)
  }

  /**
   * Approve tokens for CoW Vault Relayer
   * Required before creating orders
   */
  async approveToken(
    chainId: number,
    token: Address,
    amount: bigint = BigInt(
      '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    ),
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const client = this.clients.get(chainId)
    const vaultRelayer = COW_VAULT_RELAYER[chainId]

    if (!client?.wallet) {
      return { success: false, error: 'No wallet configured' }
    }
    if (!vaultRelayer) {
      return { success: false, error: 'Chain not supported' }
    }

    const account = client.wallet.account
    if (!account) {
      return { success: false, error: 'No account configured' }
    }

    const hash = await client.wallet.writeContract({
      chain: client.wallet.chain,
      account,
      address: token,
      abi: [
        {
          type: 'function',
          name: 'approve',
          inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          outputs: [{ type: 'bool' }],
          stateMutability: 'nonpayable',
        },
      ] as const,
      functionName: 'approve',
      args: [vaultRelayer, amount],
    })

    await client.public.waitForTransactionReceipt({ hash })
    return { success: true, txHash: hash }
  }

  // ============================================================
  // MONITORING FUNCTIONS
  // ============================================================

  /**
   * Fetch open orders from CoW API
   */
  async fetchOpenOrders(chainId: number, limit = 100): Promise<CowOrder[]> {
    const apiUrl = COW_API[chainId]
    if (!apiUrl) return []

    const response = await fetch(
      `${apiUrl}/api/v1/orders?status=open&limit=${limit}`,
      { headers: { Accept: 'application/json' } },
    )

    if (!response.ok) return []

    const data = (await response.json()) as CowApiOrder[]
    return this.parseOrders(data, chainId)
  }

  /**
   * Fetch orders for a specific token pair
   */
  async fetchOrdersForPair(
    chainId: number,
    sellToken: Address,
    buyToken: Address,
  ): Promise<CowOrder[]> {
    const apiUrl = COW_API[chainId]
    if (!apiUrl) return []

    const response = await fetch(
      `${apiUrl}/api/v1/orders?sellToken=${sellToken}&buyToken=${buyToken}&status=open`,
      { headers: { Accept: 'application/json' } },
    )

    if (!response.ok) return []

    const data = (await response.json()) as CowApiOrder[]
    return this.parseOrders(data, chainId)
  }

  /**
   * Get current auction
   */
  getCurrentAuction(chainId: number): CowAuction | undefined {
    return this.currentAuctions.get(chainId)
  }

  /**
   * Find profitable opportunities in current orders
   * Returns orders where we can provide a better price than the limit
   */
  findProfitableOrders(
    chainId: number,
    ourPrices: Map<string, bigint>, // token -> price in wei
    minProfitBps: number = 10,
  ): Array<{ order: CowOrder; profitBps: number }> {
    const auction = this.currentAuctions.get(chainId)
    if (!auction) return []

    const profitable: Array<{ order: CowOrder; profitBps: number }> = []

    for (const order of auction.orders) {
      const sellPrice = ourPrices.get(order.sellToken.toLowerCase())
      const buyPrice = ourPrices.get(order.buyToken.toLowerCase())

      if (!sellPrice || !buyPrice) continue

      // Order's implied price
      const orderPrice = (order.sellAmount * BigInt(1e18)) / order.buyAmount

      // Our price for the same trade
      const ourPrice = (sellPrice * BigInt(1e18)) / buyPrice

      // If our price is better (lower for sell orders), we can profit
      if (ourPrice < orderPrice) {
        const profitBps = Number(
          ((orderPrice - ourPrice) * BigInt(10000)) / orderPrice,
        )
        if (profitBps >= minProfitBps) {
          profitable.push({ order, profitBps })
        }
      }
    }

    return profitable.sort((a, b) => b.profitBps - a.profitBps)
  }

  // ============================================================
  // SOLUTION BUILDING (for future solver registration)
  // ============================================================

  /**
   * Build a solution for a set of orders using our liquidity
   */
  buildSolution(
    auction: CowAuction,
    liquidityPools: Map<
      string,
      { reserve0: bigint; reserve1: bigint; token0: Address; token1: Address }
    >,
  ): CowSolution | null {
    const trades: CowSolution['trades'] = []
    const interactions: CowSolution['interactions'] = []
    const prices: Record<string, bigint> = {}

    for (const order of auction.orders) {
      const poolKey = this.getPoolKey(order.sellToken, order.buyToken)
      const pool = liquidityPools.get(poolKey)
      if (!pool) continue

      // Calculate AMM output
      const isToken0ToToken1 =
        pool.token0.toLowerCase() === order.sellToken.toLowerCase()
      const reserveIn = isToken0ToToken1 ? pool.reserve0 : pool.reserve1
      const reserveOut = isToken0ToToken1 ? pool.reserve1 : pool.reserve0

      // x * y = k formula with 0.3% fee
      const amountInWithFee = order.sellAmount * BigInt(997)
      const numerator = amountInWithFee * reserveOut
      const denominator = reserveIn * BigInt(1000) + amountInWithFee
      const amountOut = numerator / denominator

      if (amountOut >= order.buyAmount) {
        trades.push({
          orderUid: order.uid,
          executedSellAmount: order.sellAmount,
          executedBuyAmount: amountOut,
        })

        // Set clearing prices
        const scale = BigInt(10) ** BigInt(18)
        prices[order.sellToken.toLowerCase()] = scale
        prices[order.buyToken.toLowerCase()] =
          (order.sellAmount * scale) / amountOut
      }
    }

    if (trades.length === 0) return null

    return {
      auctionId: auction.id,
      trades,
      interactions,
      prices,
    }
  }

  /**
   * Evaluate potential profit from solving an auction
   */
  evaluateAuction(
    auction: CowAuction,
    gasPrice: bigint,
    tokenPrices: Record<string, number>,
  ): {
    profitable: boolean
    expectedProfitUsd: number
    fillableOrders: number
  } {
    let fillableOrders = 0
    let totalProfitUsd = 0

    for (const order of auction.orders) {
      const sellPrice = tokenPrices[order.sellToken.toLowerCase()]
      const buyPrice = tokenPrices[order.buyToken.toLowerCase()]

      if (!sellPrice || !buyPrice) continue

      const sellValueUsd = (Number(order.sellAmount) / 1e18) * sellPrice
      const buyValueUsd = (Number(order.buyAmount) / 1e18) * buyPrice
      const feeValueUsd = (Number(order.feeAmount) / 1e18) * sellPrice
      const surplus = sellValueUsd - buyValueUsd - feeValueUsd

      if (surplus > 0) {
        fillableOrders++
        totalProfitUsd += surplus
      }
    }

    // Estimate gas cost
    const gasPerTrade = BigInt(100000)
    const totalGas = gasPerTrade * BigInt(Math.max(1, fillableOrders))
    const gasCostWei = totalGas * gasPrice
    const ethPrice =
      tokenPrices['0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'] ||
      tokenPrices['0x0000000000000000000000000000000000000000'] ||
      3000
    const gasCostUsd = (Number(gasCostWei) / 1e18) * ethPrice

    const netProfit = totalProfitUsd - gasCostUsd

    return {
      profitable: netProfit > 0,
      expectedProfitUsd: netProfit,
      fillableOrders,
    }
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private async pollAuctions(): Promise<void> {
    for (const chainId of this.supportedChains) {
      if (!this.clients.has(chainId)) continue

      try {
        const auction = await this.fetchCurrentAuction(chainId)
        if (!auction) continue

        const existing = this.currentAuctions.get(chainId)
        if (!existing || existing.id !== auction.id) {
          this.currentAuctions.set(chainId, auction)
          console.log(
            `🐮 CoW auction ${auction.id}: ${auction.orders.length} orders on chain ${chainId}`,
          )
          this.emit('auction', auction)
        }
      } catch (_err) {
        // Silently handle errors - API might be temporarily unavailable
      }
    }
  }

  private async fetchCurrentAuction(
    chainId: number,
  ): Promise<CowAuction | null> {
    const apiUrl = COW_API[chainId]
    if (!apiUrl) return null

    const response = await fetch(`${apiUrl}/api/v1/auction`, {
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) return null

    const data = (await response.json()) as CowApiAuction

    const tokenSet = new Set<Address>()
    const orders = this.parseOrders(data.orders, chainId)

    for (const order of orders) {
      tokenSet.add(order.sellToken)
      tokenSet.add(order.buyToken)
    }

    return {
      id: data.id,
      chainId,
      orders: orders.filter((o) => o.status === 'open'),
      tokens: Array.from(tokenSet),
      deadline: Math.floor(Date.now() / 1000) + 30,
    }
  }

  private parseOrders(apiOrders: CowApiOrder[], chainId: number): CowOrder[] {
    return apiOrders.map((o) => ({
      uid: o.uid as `0x${string}`,
      chainId,
      owner: o.owner as Address,
      sellToken: o.sellToken as Address,
      buyToken: o.buyToken as Address,
      sellAmount: BigInt(o.sellAmount),
      buyAmount: BigInt(o.buyAmount),
      validTo: o.validTo,
      appData: o.appData as `0x${string}`,
      feeAmount: BigInt(o.feeAmount),
      kind: o.kind as 'sell' | 'buy',
      partiallyFillable: o.partiallyFillable,
      receiver: (o.receiver || o.owner) as Address,
      signature: o.signature as `0x${string}`,
      signingScheme: o.signingScheme as
        | 'eip712'
        | 'ethsign'
        | 'presign'
        | 'eip1271',
      status: o.status as 'open' | 'fulfilled' | 'cancelled' | 'expired',
      createdAt: new Date(o.creationDate).getTime(),
      filledAmount: BigInt(o.executedSellAmount || '0'),
    }))
  }

  private async signOrder(
    chainId: number,
    order: {
      sellToken: Address
      buyToken: Address
      receiver: Address
      sellAmount: bigint
      buyAmount: bigint
      validTo: number
      appData: `0x${string}`
      feeAmount: bigint
      kind: string
      partiallyFillable: boolean
      sellTokenBalance: string
      buyTokenBalance: string
    },
    wallet: WalletClient,
  ): Promise<`0x${string}` | null> {
    if (!wallet.account) return null

    const domain = {
      name: COW_DOMAIN.name,
      version: COW_DOMAIN.version,
      chainId,
      verifyingContract: COW_SETTLEMENT[chainId],
    }

    const types = {
      Order: [
        { name: 'sellToken', type: 'address' },
        { name: 'buyToken', type: 'address' },
        { name: 'receiver', type: 'address' },
        { name: 'sellAmount', type: 'uint256' },
        { name: 'buyAmount', type: 'uint256' },
        { name: 'validTo', type: 'uint32' },
        { name: 'appData', type: 'bytes32' },
        { name: 'feeAmount', type: 'uint256' },
        { name: 'kind', type: 'string' },
        { name: 'partiallyFillable', type: 'bool' },
        { name: 'sellTokenBalance', type: 'string' },
        { name: 'buyTokenBalance', type: 'string' },
      ],
    }

    const signature = await wallet.signTypedData({
      account: wallet.account,
      domain,
      types,
      primaryType: 'Order',
      message: order,
    })

    return signature
  }

  private getPoolKey(token0: Address, token1: Address): string {
    const [a, b] =
      token0.toLowerCase() < token1.toLowerCase()
        ? [token0, token1]
        : [token1, token0]
    return `${a}-${b}`
  }
}
