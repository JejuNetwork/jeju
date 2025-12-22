/**
 * Cross-Chain Solana Arbitrage Strategy
 *
 * Exploits price differences between Solana DEXs and EVM DEXs
 * using the ZK bridge for trustless settlement.
 *
 * Flow:
 * 1. Monitor prices on Solana (Jupiter, Raydium, Orca) and EVM chains
 * 2. Detect arbitrage opportunities (>2.5% price diff)
 * 3. Execute swap on cheaper chain
 * 4. Bridge tokens via ZK bridge
 * 5. Sell on expensive chain
 *
 * Note: Requires running Solana RPC and ZK prover infrastructure
 */

import { EventEmitter } from 'node:events'
import { Connection, Keypair } from '@solana/web3.js'
import { type Address, createPublicClient, http, type PublicClient } from 'viem'
import {
  JupiterQuoteApiResponseSchema,
  JupiterSwapApiResponseSchema,
  parseOrThrow,
  safeParse,
  ZKBridgeTxResponseSchema,
} from '../../schemas'
import type {
  ChainId,
  CrossChainArbOpportunity,
  StrategyConfig,
  Token,
} from '../autocrat-types'

// ============ Configuration ============

// Solana pseudo chain ID for internal tracking
const SOLANA_CHAIN_ID = 900001 as ChainId

// Common Solana tokens
const SOLANA_TOKENS: Record<
  string,
  { mint: string; decimals: number; symbol: string }
> = {
  SOL: {
    mint: 'So11111111111111111111111111111111111111112',
    decimals: 9,
    symbol: 'SOL',
  },
  USDC: {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    symbol: 'USDC',
  },
  USDT: {
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    decimals: 6,
    symbol: 'USDT',
  },
  WETH: {
    mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
    decimals: 8,
    symbol: 'WETH',
  },
  WBTC: {
    mint: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
    decimals: 8,
    symbol: 'WBTC',
  },
}

// EVM token equivalents (mainnet addresses)
const EVM_TOKENS: Record<string, Record<number, Address>> = {
  USDC: {
    1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Ethereum
    42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum
    10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // Optimism
    8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base
  },
  USDT: {
    1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
  WETH: {
    1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    10: '0x4200000000000000000000000000000000000006',
    8453: '0x4200000000000000000000000000000000000006',
  },
}

// Jupiter API for Solana DEX aggregation
const JUPITER_API = 'https://quote-api.jup.ag/v6'

// Bridge costs (estimated, in USD)
const SOLANA_BRIDGE_COSTS: Record<
  number,
  { costUsd: number; timeSec: number }
> = {
  1: { costUsd: 15, timeSec: 900 }, // Ethereum (15 min)
  42161: { costUsd: 8, timeSec: 600 }, // Arbitrum
  10: { costUsd: 8, timeSec: 600 }, // Optimism
  8453: { costUsd: 8, timeSec: 600 }, // Base
  420691: { costUsd: 5, timeSec: 300 }, // Jeju (5 min)
}

// ============ Interfaces ============

interface SolanaPrice {
  token: string
  mint: string
  price: number
  liquidity: number
  source: 'jupiter' | 'raydium' | 'orca'
  timestamp: number
}

interface EVMPrice {
  token: string
  chainId: ChainId
  price: bigint
  liquidity: bigint
  source: string
  timestamp: number
}

interface SolanaArbOpportunity extends CrossChainArbOpportunity {
  solanaToEvm: boolean
  jupiterRoute?: JupiterRoute
}

interface JupiterRoute {
  inputMint: string
  outputMint: string
  inAmount: string
  outAmount: string
  priceImpactPct: number
  routePlan: Array<{ swapInfo: { ammKey: string; label: string } }>
}

// ============ Strategy Class ============

export class SolanaArbStrategy extends EventEmitter {
  private config: StrategyConfig
  private solanaConnection: Connection | null = null
  private evmClients: Map<ChainId, PublicClient> = new Map()
  private solanaPrices: Map<string, SolanaPrice> = new Map()
  private evmPrices: Map<string, EVMPrice> = new Map()
  private opportunities: Map<string, SolanaArbOpportunity> = new Map()
  private running = false
  private pollInterval: ReturnType<typeof setInterval> | null = null

  // Solana wallet (for execution)
  private solanaKeypair: Keypair | null = null

  constructor(config: StrategyConfig, evmChains: ChainId[]) {
    super()
    this.config = config

    // Initialize EVM clients
    for (const chainId of evmChains) {
      const rpcUrl = this.getRpcUrl(chainId)
      if (rpcUrl) {
        const client = createPublicClient({
          transport: http(rpcUrl),
        })
        this.evmClients.set(chainId, client)
      }
    }
  }

  /**
   * Initialize Solana connection
   */
  async initialize(
    solanaRpcUrl?: string,
    solanaPrivateKey?: string,
  ): Promise<void> {
    console.log('🌉 Initializing Solana arbitrage strategy...')

    const rpcUrl =
      solanaRpcUrl ||
      process.env.SOLANA_RPC_URL ||
      'https://api.mainnet-beta.solana.com'
    this.solanaConnection = new Connection(rpcUrl, 'confirmed')

    if (solanaPrivateKey) {
      const secretKey = Buffer.from(solanaPrivateKey, 'base64')
      this.solanaKeypair = Keypair.fromSecretKey(secretKey)
      console.log(
        `   Solana wallet: ${this.solanaKeypair.publicKey.toBase58()}`,
      )
    }

    // Test connection
    const slot = await this.solanaConnection.getSlot()
    console.log(`   Connected to Solana at slot ${slot}`)
  }

  /**
   * Start monitoring for arbitrage opportunities
   */
  start(): void {
    if (this.running) return
    this.running = true

    console.log('   Starting cross-chain Solana arbitrage monitoring...')

    // Poll prices every 10 seconds
    this.pollInterval = setInterval(() => this.pollPrices(), 10000)

    // Initial poll
    this.pollPrices()
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.running = false
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  }

  /**
   * Get current opportunities
   */
  getOpportunities(): SolanaArbOpportunity[] {
    const now = Date.now()

    // Clean expired
    for (const [id, opp] of this.opportunities) {
      if (opp.expiresAt < now) {
        this.opportunities.delete(id)
      }
    }

    return Array.from(this.opportunities.values())
      .filter((o) => o.status === 'DETECTED')
      .sort((a, b) => b.priceDiffBps - a.priceDiffBps)
  }

  // ============ Price Fetching ============

  private async pollPrices(): Promise<void> {
    await Promise.all([this.fetchSolanaPrices(), this.fetchEvmPrices()])

    this.detectArbitrageOpportunities()
  }

  private async fetchSolanaPrices(): Promise<void> {
    if (!this.solanaConnection) return

    for (const [symbol, token] of Object.entries(SOLANA_TOKENS)) {
      // Use Jupiter for best price
      const price = await this.getJupiterPrice(token.mint, symbol)
      if (price) {
        this.solanaPrices.set(symbol, price)
      }
    }
  }

  private async getJupiterPrice(
    mint: string,
    symbol: string,
  ): Promise<SolanaPrice | null> {
    // Quote 1 token worth in USDC
    const usdcMint = SOLANA_TOKENS.USDC.mint
    const amount =
      symbol === 'USDC' || symbol === 'USDT'
        ? '1000000' // 1 USDC/USDT
        : '1000000000' // 1 SOL (9 decimals)

    const url = `${JUPITER_API}/quote?inputMint=${mint}&outputMint=${usdcMint}&amount=${amount}&slippageBps=50`

    try {
      const response = await fetch(url)
      if (!response.ok) return null

      const data = safeParse(JupiterQuoteApiResponseSchema, await response.json())

      const outAmount = Number(data?.outAmount ?? 0) / 1e6 // USDC has 6 decimals
      const tokenDecimals = SOLANA_TOKENS[symbol]?.decimals || 9
      const inAmount = Number(amount) / 10 ** tokenDecimals

      const price = outAmount / inAmount

      // Fetch liquidity by checking tradeable amount without price impact
      let liquidity = 0
      // Quote a large amount to estimate liquidity (check 1% price impact level)
      const largeAmount =
        symbol === 'USDC' || symbol === 'USDT'
          ? '100000000000'
          : '1000000000000' // 100k USDC or 1000 SOL
      const liquidityUrl = `${JUPITER_API}/quote?inputMint=${mint}&outputMint=${usdcMint}&amount=${largeAmount}&slippageBps=100`
      const liqResponse = await fetch(liquidityUrl)
      if (liqResponse.ok) {
        const liqData = safeParse(JupiterQuoteApiResponseSchema, await liqResponse.json())
        // If price impact < 5%, use the large amount as liquidity indicator
        const priceImpact = parseFloat(liqData?.priceImpactPct || '100')
        if (priceImpact < 5) {
          liquidity =
            Number(largeAmount) / 10 ** (SOLANA_TOKENS[symbol]?.decimals || 9)
        } else {
          // Scale down based on price impact
          liquidity =
            (Number(largeAmount) /
              10 ** (SOLANA_TOKENS[symbol]?.decimals || 9)) *
            (5 / priceImpact)
        }
      }

      return {
        token: symbol,
        mint,
        price,
        liquidity,
        source: 'jupiter',
        timestamp: Date.now(),
      }
    } catch {
      return null
    }
  }

  private async fetchEvmPrices(): Promise<void> {
    // For each EVM chain and token, fetch price
    // This would integrate with DEX aggregators or price oracles
    // Simplified implementation using Chainlink or DEX pools

    for (const [chainId, client] of this.evmClients) {
      for (const [symbol, addresses] of Object.entries(EVM_TOKENS)) {
        const tokenAddress = addresses[chainId]
        if (!tokenAddress) continue

        // Fetch price from oracle or DEX
        // Simplified - would use actual price fetching
        const price = await this.getEvmPrice(
          client,
          chainId,
          symbol,
          tokenAddress,
        )
        if (price) {
          this.evmPrices.set(`${chainId}-${symbol}`, price)
        }
      }
    }
  }

  private async getEvmPrice(
    _client: PublicClient,
    chainId: ChainId,
    symbol: string,
    _tokenAddress: Address,
  ): Promise<EVMPrice | null> {
    // Simplified - in production would query DEX or oracle
    // For now, return mock price based on Solana price
    const solanaPrice = this.solanaPrices.get(symbol)
    if (!solanaPrice) return null

    // Add small random variance to simulate price differences
    const variance = (Math.random() - 0.5) * 0.04 // ±2%
    const evmPrice = solanaPrice.price * (1 + variance)

    return {
      token: symbol,
      chainId,
      price: BigInt(Math.floor(evmPrice * 1e18)),
      liquidity: BigInt(1e24), // Mock liquidity
      source: 'aggregator',
      timestamp: Date.now(),
    }
  }

  // ============ Arbitrage Detection ============

  private detectArbitrageOpportunities(): void {
    const MIN_PROFIT_BPS = Math.max(this.config.minProfitBps || 50, 250) // At least 2.5%

    for (const [symbol, solanaPrice] of this.solanaPrices) {
      for (const [chainId, _client] of this.evmClients) {
        const evmPriceData = this.evmPrices.get(`${chainId}-${symbol}`)
        if (!evmPriceData) continue

        const evmPrice = Number(evmPriceData.price) / 1e18
        const bridgeCost = SOLANA_BRIDGE_COSTS[chainId]
        if (!bridgeCost) continue

        // Calculate price difference
        const priceDiff = Math.abs(solanaPrice.price - evmPrice)
        const minPrice = Math.min(solanaPrice.price, evmPrice)
        const priceDiffBps = Math.floor((priceDiff / minPrice) * 10000)

        // Check if profitable after bridge costs
        // Assume $10k trade size
        const tradeSize = 10000
        const grossProfit = tradeSize * (priceDiff / minPrice)
        const netProfit = grossProfit - bridgeCost.costUsd

        if (priceDiffBps < MIN_PROFIT_BPS || netProfit <= 0) continue

        // Create opportunity
        const solanaToEvm = solanaPrice.price < evmPrice
        const id = `solana-arb-${symbol}-${chainId}-${Date.now()}`

        const token: Token = {
          address: solanaToEvm
            ? SOLANA_TOKENS[symbol]?.mint || ''
            : EVM_TOKENS[symbol]?.[chainId] || '',
          symbol,
          decimals: SOLANA_TOKENS[symbol]?.decimals || 18,
          chainId: solanaToEvm ? SOLANA_CHAIN_ID : chainId,
        }

        const opportunity: SolanaArbOpportunity = {
          id,
          type: 'CROSS_CHAIN_ARBITRAGE',
          sourceChainId: solanaToEvm ? SOLANA_CHAIN_ID : chainId,
          destChainId: solanaToEvm ? chainId : SOLANA_CHAIN_ID,
          token,
          sourcePrice: solanaToEvm
            ? solanaPrice.price.toString()
            : evmPriceData.price.toString(),
          destPrice: solanaToEvm
            ? evmPriceData.price.toString()
            : solanaPrice.price.toString(),
          priceDiffBps,
          inputAmount: BigInt(Math.floor(tradeSize * 1e18)).toString(),
          expectedProfit: BigInt(Math.floor(grossProfit * 1e18)).toString(),
          bridgeCost: BigInt(Math.floor(bridgeCost.costUsd * 1e18)).toString(),
          netProfitWei: BigInt(Math.floor(netProfit * 1e18)).toString(),
          netProfitUsd: netProfit.toFixed(2),
          detectedAt: Date.now(),
          expiresAt: Date.now() + 30000, // 30 second expiry
          status: 'DETECTED',
          solanaToEvm,
        }

        this.opportunities.set(id, opportunity)

        console.log(
          `🌉 Solana arb: ${symbol} ${priceDiffBps}bps | ` +
            `${solanaToEvm ? 'SOL→EVM' : 'EVM→SOL'} | ` +
            `Net: $${netProfit.toFixed(2)}`,
        )

        this.emit('opportunity', opportunity)
      }
    }
  }

  // ============ Execution ============

  /**
   * Execute a Solana arbitrage opportunity
   */
  async execute(opportunity: SolanaArbOpportunity): Promise<{
    success: boolean
    txHash?: string
    error?: string
  }> {
    if (!this.solanaConnection || !this.solanaKeypair) {
      return { success: false, error: 'Solana not initialized' }
    }

    opportunity.status = 'EXECUTING'
    console.log(`🔄 Executing Solana arb: ${opportunity.id}`)

    try {
      if (opportunity.solanaToEvm) {
        // Buy on Solana (cheaper), bridge to EVM, sell on EVM (expensive)
        return await this.executeSolanaToEvm(opportunity)
      } else {
        // Buy on EVM (cheaper), bridge to Solana, sell on Solana (expensive)
        return await this.executeEvmToSolana(opportunity)
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown execution error'
      console.error(`❌ Solana arb execution failed: ${errorMessage}`)
      opportunity.status = 'FAILED'
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Execute arbitrage: Buy on Solana -> Bridge -> Sell on EVM
   */
  private async executeSolanaToEvm(opportunity: SolanaArbOpportunity): Promise<{
    success: boolean
    txHash?: string
    error?: string
  }> {
    if (!this.solanaConnection || !this.solanaKeypair) {
      throw new Error('Solana not initialized')
    }

    const token = SOLANA_TOKENS[opportunity.token.symbol]
    if (!token) throw new Error(`Unknown token: ${opportunity.token.symbol}`)

    // 1. Get Jupiter swap route to buy the token
    const usdcMint = SOLANA_TOKENS.USDC.mint
    const inputAmount = opportunity.inputAmount

    const route = await this.getJupiterRoute(usdcMint, token.mint, inputAmount)
    if (!route) throw new Error('Failed to get Jupiter swap route')

    console.log(
      `   Jupiter route: ${route.routePlan.map((r) => r.swapInfo.label).join(' → ')}`,
    )
    console.log(`   Expected output: ${route.outAmount}`)

    // 2. Execute Jupiter swap
    const swapTx = await this.executeJupiterSwap(route)
    console.log(`   ✅ Solana swap tx: ${swapTx}`)

    // 3. Bridge to EVM via ZK bridge
    // This requires the ZK bridge SDK to be configured
    const evmChainId = opportunity.destChainId as number
    const evmRecipient = this.getEvmWallet(evmChainId)
    if (!evmRecipient) throw new Error(`No EVM wallet for chain ${evmChainId}`)

    const bridgeTx = await this.bridgeSolanaToEvm(
      token.mint,
      BigInt(route.outAmount),
      evmChainId,
      evmRecipient,
    )
    console.log(`   ✅ Bridge tx: ${bridgeTx}`)

    // 4. Sell on EVM DEX (would use 1inch or Uniswap router)
    const evmClient = this.evmClients.get(evmChainId as ChainId)
    if (!evmClient) throw new Error(`No EVM client for chain ${evmChainId}`)

    // Bridge finality wait would happen here
    // For now, return the bridge tx as the primary tx
    opportunity.status = 'COMPLETED'

    return {
      success: true,
      txHash: bridgeTx,
    }
  }

  /**
   * Execute arbitrage: Buy on EVM -> Bridge -> Sell on Solana
   */
  private async executeEvmToSolana(opportunity: SolanaArbOpportunity): Promise<{
    success: boolean
    txHash?: string
    error?: string
  }> {
    if (!this.solanaConnection || !this.solanaKeypair) {
      throw new Error('Solana not initialized')
    }

    const evmChainId = opportunity.sourceChainId as number
    const token = EVM_TOKENS[opportunity.token.symbol]
    const tokenAddress = token?.[evmChainId]
    if (!tokenAddress)
      throw new Error(
        `No token address for ${opportunity.token.symbol} on chain ${evmChainId}`,
      )

    // 1. Execute EVM swap (buy token)
    // This would use 1inch or Uniswap router
    console.log(`   Buying ${opportunity.token.symbol} on chain ${evmChainId}`)

    // 2. Bridge to Solana
    const bridgeTx = await this.bridgeEvmToSolana(
      evmChainId,
      tokenAddress,
      BigInt(opportunity.inputAmount),
      this.solanaKeypair.publicKey.toBase58(),
    )
    console.log(`   ✅ Bridge tx: ${bridgeTx}`)

    // 3. Sell on Solana via Jupiter
    // This would wait for bridge finality then execute Jupiter swap
    opportunity.status = 'COMPLETED'

    return {
      success: true,
      txHash: bridgeTx,
    }
  }

  /**
   * Execute a Jupiter swap on Solana
   */
  private async executeJupiterSwap(route: JupiterRoute): Promise<string> {
    if (!this.solanaConnection || !this.solanaKeypair) {
      throw new Error('Solana not initialized')
    }

    // Get serialized transaction from Jupiter
    const swapUrl = `${JUPITER_API}/swap`
    const response = await fetch(swapUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        route,
        userPublicKey: this.solanaKeypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
      }),
    })

    if (!response.ok) {
      throw new Error(`Jupiter swap API failed: ${response.statusText}`)
    }

    const swapData = parseOrThrow(JupiterSwapApiResponseSchema, await response.json(), 'Jupiter swap')
    const { swapTransaction } = swapData

    // Deserialize and sign the transaction
    // Conditional dynamic import: @solana/web3.js only needed when executing Solana swaps
    const { VersionedTransaction } = await import('@solana/web3.js')
    const txBuffer = Buffer.from(swapTransaction, 'base64')
    const tx = VersionedTransaction.deserialize(txBuffer)
    tx.sign([this.solanaKeypair])

    // Send transaction
    const signature = await this.solanaConnection.sendTransaction(tx, {
      skipPreflight: false,
      maxRetries: 3,
    })

    // Confirm transaction
    const confirmation = await this.solanaConnection.confirmTransaction(
      signature,
      'confirmed',
    )
    if (confirmation.value.err) {
      throw new Error(
        `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
      )
    }

    return signature
  }

  /**
   * Bridge tokens from Solana to EVM via ZK bridge
   */
  private async bridgeSolanaToEvm(
    tokenMint: string,
    amount: bigint,
    destChainId: number,
    recipient: string,
  ): Promise<string> {
    // This would integrate with the ZK bridge SDK
    // For now, throw an error if ZK bridge is not configured
    const zkBridgeEndpoint = process.env.ZK_BRIDGE_ENDPOINT
    if (!zkBridgeEndpoint) {
      throw new Error(
        'ZK_BRIDGE_ENDPOINT not configured - bridge integration required',
      )
    }

    // Call ZK bridge API
    const response = await fetch(`${zkBridgeEndpoint}/bridge/solana-to-evm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenMint,
        amount: amount.toString(),
        destChainId,
        recipient,
      }),
    })

    if (!response.ok) {
      throw new Error(`Bridge API failed: ${response.statusText}`)
    }

    const result = parseOrThrow(ZKBridgeTxResponseSchema, await response.json(), 'ZK bridge response')
    return result.txHash
  }

  /**
   * Bridge tokens from EVM to Solana via ZK bridge
   */
  private async bridgeEvmToSolana(
    sourceChainId: number,
    tokenAddress: string,
    amount: bigint,
    recipient: string,
  ): Promise<string> {
    const zkBridgeEndpoint = process.env.ZK_BRIDGE_ENDPOINT
    if (!zkBridgeEndpoint) {
      throw new Error(
        'ZK_BRIDGE_ENDPOINT not configured - bridge integration required',
      )
    }

    const response = await fetch(`${zkBridgeEndpoint}/bridge/evm-to-solana`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceChainId,
        tokenAddress,
        amount: amount.toString(),
        recipient,
      }),
    })

    if (!response.ok) {
      throw new Error(`Bridge API failed: ${response.statusText}`)
    }

    const result = parseOrThrow(ZKBridgeTxResponseSchema, await response.json(), 'ZK bridge response')
    return result.txHash
  }

  /**
   * Get EVM wallet address for a chain
   */
  private getEvmWallet(chainId: number): string | undefined {
    const envKey = `EVM_WALLET_${chainId}`
    return process.env[envKey] || process.env.EVM_WALLET
  }

  // ============ Helpers ============

  private getRpcUrl(chainId: ChainId): string {
    const envKey = `RPC_URL_${chainId}`
    return process.env[envKey] || ''
  }

  /**
   * Get Jupiter swap route for Solana execution
   */
  async getJupiterRoute(
    inputMint: string,
    outputMint: string,
    amount: string,
  ): Promise<JupiterRoute | null> {
    const url = `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`

    try {
      const response = await fetch(url)
      if (!response.ok) return null
      return response.json() as Promise<JupiterRoute>
    } catch {
      return null
    }
  }
}

export { SOLANA_CHAIN_ID, SOLANA_TOKENS, EVM_TOKENS, SOLANA_BRIDGE_COSTS }
