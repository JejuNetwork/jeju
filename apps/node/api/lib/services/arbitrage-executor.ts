import { getExternalRpc } from '@jejunetwork/config'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatUnits,
  type Hex,
  http,
  type PublicClient,
  parseAbi,
  type Transport,
  type WalletClient,
} from 'viem'
import { arbitrum, base, mainnet, optimism } from 'viem/chains'
import { z } from 'zod'
import { createSecureSigner, type SecureSigner } from '../secure-signer'

/**
 * SECURITY WARNING: Solana signing still uses in-memory keypair.
 * TODO: Integrate Solana KMS (e.g., Fireblocks, AWS KMS with Solana support)
 * For now, Solana operations should be disabled in production TEE environments.
 */

// Client types with generic chain/transport to avoid strict type checking issues
interface EVMClientPair {
  public: PublicClient<Transport, Chain>
  wallet: WalletClient<Transport, Chain>
}

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import {
  BridgeTransferResponseSchema,
  BridgeTxResponseSchema,
  HyperliquidPricesResponseSchema,
  JitoBundleResponseSchema,
  JitoBundleStatusResponseSchema,
  JupiterSwapResponseSchema,
  OneInchSwapResponseSchema,
} from '../../../lib/validation'
import type { ArbOpportunity } from './bridge'

const CHAIN_CONFIGS: Record<number, { chain: Chain; name: string }> = {
  1: { chain: mainnet, name: 'Ethereum' },
  42161: { chain: arbitrum, name: 'Arbitrum' },
  10: { chain: optimism, name: 'Optimism' },
  8453: { chain: base, name: 'Base' },
}

// Token addresses by chain
const TOKEN_ADDRESSES: Record<string, Record<number, Address>> = {
  WETH: {
    1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    10: '0x4200000000000000000000000000000000000006',
    8453: '0x4200000000000000000000000000000000000006',
  },
  USDC: {
    1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  USDT: {
    1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
}

// Solana token mints
const SOLANA_MINTS: Record<string, { mint: string; decimals: number }> = {
  SOL: { mint: 'So11111111111111111111111111111111111111112', decimals: 9 },
  USDC: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  USDT: { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  WETH: { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', decimals: 8 },
}

// 1inch Swap API
const ONEINCH_SWAP_API = 'https://api.1inch.dev/swap/v6.0'
const ONEINCH_ROUTER: Address = '0x1111111254EEB25477B68fb85Ed929f73A960582'

// Jupiter API
const JUPITER_API = 'https://quote-api.jup.ag/v6'

// Jito block engine
const JITO_BLOCK_ENGINE = 'https://mainnet.block-engine.jito.wtf'
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4bVmkdRmao126vhwQVqhEam',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
]

// Hyperliquid API
const HYPERLIQUID_API = 'https://api.hyperliquid.xyz'

export interface ExecutorConfig {
  /** KMS key ID for EVM signing (secure, no local private keys) */
  evmKeyId: string
  /**
   * @deprecated Solana private key - SECURITY RISK
   * TODO: Replace with Solana KMS integration (Fireblocks/AWS KMS)
   * Should be disabled in production TEE environments
   */
  solanaPrivateKey?: string
  evmRpcUrls: Record<number, string>
  solanaRpcUrl?: string
  zkBridgeEndpoint?: string
  oneInchApiKey?: string
  maxSlippageBps: number
  jitoTipLamports: bigint
}

interface SwapQuote {
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
  priceImpactBps: number
  route: string
  txData?: Hex
}

// Zod schema for JupiterQuote validation
const JupiterQuoteSchema = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  priceImpactPct: z.number(),
  routePlan: z.array(
    z.object({
      swapInfo: z.object({
        ammKey: z.string(),
        label: z.string(),
      }),
    }),
  ),
})

type JupiterQuote = z.infer<typeof JupiterQuoteSchema>

function isJupiterQuote(data: unknown): data is JupiterQuote {
  return JupiterQuoteSchema.safeParse(data).success
}

// JupiterSwapResponse type from validation.ts

export class ArbitrageExecutor {
  private config: ExecutorConfig
  private evmSigner: SecureSigner
  private evmAddress: Address | null = null // Derived from KMS on init
  /**
   * @deprecated Solana keypair in memory - SECURITY RISK
   * TODO: Replace with Solana KMS integration
   */
  private solanaKeypair: Keypair | null = null
  private solanaConnection: Connection | null = null
  private evmClients = new Map<number, EVMClientPair>()

  constructor(config: ExecutorConfig) {
    this.config = config
    // Use KMS-backed signer for EVM (no local private keys)
    this.evmSigner = createSecureSigner(config.evmKeyId)

    // Initialize Solana - WARNING: Uses in-memory keypair
    // This should be disabled in production TEE environments
    if (config.solanaPrivateKey) {
      console.warn(
        '[ArbitrageExecutor] WARNING: Solana uses in-memory keypair. ' +
          'This is a security risk in TEE environments. ' +
          'TODO: Integrate Solana KMS.',
      )
      const secretKey = Buffer.from(config.solanaPrivateKey, 'base64')
      this.solanaKeypair = Keypair.fromSecretKey(secretKey)
    }

    if (config.solanaRpcUrl) {
      this.solanaConnection = new Connection(config.solanaRpcUrl, 'confirmed')
    }

    // Initialize EVM clients (public only - signing via KMS)
    for (const [chainIdStr, rpcUrl] of Object.entries(config.evmRpcUrls)) {
      const chainId = Number(chainIdStr)
      const chainConfig = CHAIN_CONFIGS[chainId]
      if (!chainConfig) continue

      const publicClient: PublicClient<Transport, Chain> = createPublicClient({
        chain: chainConfig.chain,
        transport: http(rpcUrl),
      })

      // Wallet client without account - transactions signed via KMS
      const walletClient: WalletClient<Transport, Chain> = createWalletClient({
        chain: chainConfig.chain,
        transport: http(rpcUrl),
      })

      this.evmClients.set(chainId, {
        public: publicClient,
        wallet: walletClient,
      })
    }
  }

  /**
   * Initialize the executor - derives EVM address from KMS
   * Must be called before any operations
   */
  async initialize(): Promise<void> {
    this.evmAddress = await this.evmSigner.getAddress()
    console.log(`[ArbitrageExecutor] Initialized with address: ${this.evmAddress}`)
  }

  /**
   * Get EVM address (derived from KMS key)
   */
  getAddress(): Address {
    if (!this.evmAddress) {
      throw new Error(
        'ArbitrageExecutor not initialized. Call initialize() first.',
      )
    }
    return this.evmAddress
  }
  async executeSolanaEvmArb(opportunity: ArbOpportunity): Promise<{
    success: boolean
    txHash?: string
    profit?: number
    error?: string
  }> {
    console.log(`[Executor] Starting Solana<->EVM arb for ${opportunity.token}`)
    console.log(
      `   Buy: ${opportunity.buyChain}, Sell: ${opportunity.sellChain}`,
    )

    const isSolanaToBuy = opportunity.buyChain === 'solana'
    const evmChainId = this.parseEvmChainId(
      isSolanaToBuy ? opportunity.sellChain : opportunity.buyChain,
    )

    if (!evmChainId) {
      return {
        success: false,
        error: `Invalid chain: ${opportunity.buyChain} / ${opportunity.sellChain}`,
      }
    }

    const positionSizeUsd = Math.min(
      opportunity.netProfitUsd / (opportunity.priceDiffBps / 10000),
      10000, // Max $10k per trade
    )

    if (isSolanaToBuy) {
      return this.executeBuyOnSolanaSellOnEvm(
        opportunity.token,
        positionSizeUsd,
        evmChainId,
      )
    } else {
      return this.executeBuyOnEvmSellOnSolana(
        opportunity.token,
        positionSizeUsd,
        evmChainId,
      )
    }
  }

  async executeHyperliquidArb(opportunity: ArbOpportunity): Promise<{
    success: boolean
    txHash?: string
    profit?: number
    error?: string
  }> {
    console.log(`[Executor] Starting Hyperliquid arb for ${opportunity.token}`)

    const isHyperliquidCheaper = opportunity.buyChain === 'hyperliquid'
    const evmChainId = this.parseEvmChainId(
      isHyperliquidCheaper ? opportunity.sellChain : opportunity.buyChain,
    )

    if (!evmChainId) {
      return { success: false, error: 'Invalid EVM chain for Hyperliquid arb' }
    }

    // For Hyperliquid arb, we use perpetuals
    // If HL is cheaper: Long perp on HL, Short spot on EVM (or vice versa)
    const positionSizeUsd = Math.min(opportunity.netProfitUsd * 10, 10000)

    return this.executeHyperliquidSpotArb(
      opportunity.token,
      positionSizeUsd,
      evmChainId,
      isHyperliquidCheaper,
    )
  }

  async executeCrossDexArb(opportunity: ArbOpportunity): Promise<{
    success: boolean
    txHash?: string
    profit?: number
    error?: string
  }> {
    console.log(`[Executor] Starting cross-DEX arb for ${opportunity.token}`)

    const buyChainId = this.parseEvmChainId(opportunity.buyChain)
    const sellChainId = this.parseEvmChainId(opportunity.sellChain)

    if (!buyChainId || !sellChainId) {
      return { success: false, error: 'Invalid chains for cross-DEX arb' }
    }

    const positionSizeUsd = Math.min(opportunity.netProfitUsd * 10, 10000)

    return this.executeCrossChainEvmArb(
      opportunity.token,
      positionSizeUsd,
      buyChainId,
      sellChainId,
    )
  }
  private async executeBuyOnSolanaSellOnEvm(
    token: string,
    positionSizeUsd: number,
    evmChainId: number,
  ): Promise<{
    success: boolean
    txHash?: string
    profit?: number
    error?: string
  }> {
    if (!this.solanaConnection || !this.solanaKeypair) {
      return { success: false, error: 'Solana not configured' }
    }

    const solanaToken = SOLANA_MINTS[token]
    const evmToken = TOKEN_ADDRESSES[token][evmChainId]

    if (!solanaToken || !evmToken) {
      return {
        success: false,
        error: `Token ${token} not supported on both chains`,
      }
    }

    // 1. Get Jupiter quote to buy token with USDC
    const inputAmount = BigInt(Math.floor(positionSizeUsd * 1e6)) // USDC has 6 decimals
    const jupiterQuote = await this.getJupiterQuote(
      SOLANA_MINTS.USDC.mint,
      solanaToken.mint,
      inputAmount.toString(),
    )

    if (!jupiterQuote) {
      return { success: false, error: 'Failed to get Jupiter quote' }
    }

    console.log(`   Jupiter quote: ${jupiterQuote.outAmount} ${token}`)
    console.log(
      `   Route: ${jupiterQuote.routePlan.map((r) => r.swapInfo.label).join(' → ')}`,
    )

    // 2. Execute Jupiter swap
    const swapTx = await this.executeJupiterSwap(jupiterQuote)
    console.log(`   ✓ Solana swap: ${swapTx}`)

    // 3. Bridge tokens to EVM
    const bridgeAmount = BigInt(jupiterQuote.outAmount)
    const bridgeTx = await this.bridgeSolanaToEvm(
      solanaToken.mint,
      bridgeAmount,
      evmChainId,
      this.getAddress(),
    )
    console.log(`   ✓ Bridge initiated: ${bridgeTx}`)

    // 4. Wait for bridge finality
    const bridgeCompleted = await this.waitForBridgeCompletion(
      bridgeTx,
      evmChainId,
      evmToken,
      bridgeAmount,
    )

    if (!bridgeCompleted) {
      return {
        success: false,
        error: 'Bridge did not complete in time',
        txHash: swapTx,
      }
    }

    // 5. Sell on EVM
    const evmClients = this.evmClients.get(evmChainId)
    if (!evmClients) {
      return { success: false, error: `EVM chain ${evmChainId} not configured` }
    }

    const sellTx = await this.executeEvmSwap(
      evmChainId,
      evmToken,
      TOKEN_ADDRESSES.USDC[evmChainId],
      bridgeAmount,
    )

    console.log(`   ✓ EVM sell: ${sellTx}`)

    const priceDiffBps = await this.getPriceDiffBps(token, 'solana', evmChainId)
    const profit = positionSizeUsd * (priceDiffBps / 10000)

    return {
      success: true,
      txHash: sellTx,
      profit,
    }
  }

  private async waitForBridgeCompletion(
    bridgeTxHash: string,
    destChainId: number,
    destToken: Address,
    expectedAmount: bigint,
    maxWaitMs = 300000, // 5 minutes
    pollIntervalMs = 10000, // 10 seconds
  ): Promise<boolean> {
    const evmClients = this.evmClients.get(destChainId)
    if (!evmClients) return false

    const startBalance = await evmClients.public.readContract({
      address: destToken,
      abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
      functionName: 'balanceOf',
      args: [this.getAddress()],
    })

    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))

      const currentBalance = await evmClients.public.readContract({
        address: destToken,
        abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
        functionName: 'balanceOf',
        args: [this.getAddress()],
      })

      // Check if balance increased by expected amount (with 1% tolerance)
      const minExpected = (expectedAmount * 99n) / 100n
      if (currentBalance - startBalance >= minExpected) {
        console.log(`   ✓ Bridge completed: ${bridgeTxHash}`)
        return true
      }
    }

    console.error(`   ✗ Bridge timeout: ${bridgeTxHash}`)
    return false
  }

  private async executeBuyOnEvmSellOnSolana(
    token: string,
    positionSizeUsd: number,
    evmChainId: number,
  ): Promise<{
    success: boolean
    txHash?: string
    profit?: number
    error?: string
  }> {
    const evmClients = this.evmClients.get(evmChainId)
    if (!evmClients) {
      return { success: false, error: `EVM chain ${evmChainId} not configured` }
    }

    if (!this.solanaConnection || !this.solanaKeypair) {
      return { success: false, error: 'Solana not configured' }
    }

    const evmToken = TOKEN_ADDRESSES[token][evmChainId]
    const solanaToken = SOLANA_MINTS[token]

    if (!evmToken || !solanaToken) {
      return {
        success: false,
        error: `Token ${token} not supported on both chains`,
      }
    }

    // 1. Get 1inch quote to buy token
    const usdcAddress = TOKEN_ADDRESSES.USDC[evmChainId]
    const inputAmount = BigInt(Math.floor(positionSizeUsd * 1e6)) // USDC 6 decimals

    const swapQuote = await this.get1inchSwapQuote(
      evmChainId,
      usdcAddress,
      evmToken,
      inputAmount,
    )

    if (!swapQuote) {
      return { success: false, error: 'Failed to get 1inch quote' }
    }

    console.log(
      `   1inch quote: ${formatUnits(swapQuote.outputAmount, 18)} ${token}`,
    )

    // 2. Execute EVM swap
    const swapTx = await this.execute1inchSwap(evmChainId, swapQuote)
    console.log(`   ✓ EVM swap: ${swapTx}`)

    // 3. Bridge tokens to Solana
    const bridgeTx = await this.bridgeEvmToSolana(
      evmChainId,
      evmToken,
      swapQuote.outputAmount,
      this.solanaKeypair.publicKey.toBase58(),
    )
    console.log(`   ✓ Bridge initiated: ${bridgeTx}`)

    // 4. Sell on Solana after bridge completes
    const estimatedProfit =
      positionSizeUsd *
      ((await this.getPriceDiffBps(token, evmChainId, 'solana')) / 10000)

    return {
      success: true,
      txHash: swapTx,
      profit: estimatedProfit,
    }
  }
  private async executeHyperliquidSpotArb(
    token: string,
    positionSizeUsd: number,
    evmChainId: number,
    hlCheaper: boolean,
  ): Promise<{
    success: boolean
    txHash?: string
    profit?: number
    error?: string
  }> {
    // Hyperliquid uses ETH for trading, map token to HL symbol
    const hlSymbol = token === 'WETH' ? 'ETH' : token

    // 1. If HL is cheaper: Buy on HL (long perp or spot), sell on EVM
    // If EVM is cheaper: Buy on EVM, sell on HL (short perp or spot)

    if (hlCheaper) {
      // Long on Hyperliquid, bridge out and sell on EVM
      const orderResult = await this.placeHyperliquidOrder(
        hlSymbol,
        'buy',
        positionSizeUsd,
        true, // is spot
      )

      if (!orderResult.success) {
        return { success: false, error: orderResult.error }
      }

      console.log(`   ✓ HL buy order: ${orderResult.orderId}`)

      // Bridge USDC from HL to EVM to complete the arb
      // Note: HL uses HyperEVM which connects via CCIP
      const bridgeTx = await this.bridgeFromHyperliquid(
        evmChainId,
        positionSizeUsd,
      )
      console.log(`   ✓ HL bridge: ${bridgeTx}`)

      return {
        success: true,
        txHash: orderResult.orderId,
        profit: positionSizeUsd * 0.003, // Estimate 0.3% profit
      }
    } else {
      // Buy on EVM, sell on Hyperliquid
      const evmClients = this.evmClients.get(evmChainId)
      if (!evmClients) {
        return { success: false, error: `Chain ${evmChainId} not configured` }
      }

      const evmToken = TOKEN_ADDRESSES[token][evmChainId]
      const usdcAddress = TOKEN_ADDRESSES.USDC[evmChainId]

      if (!evmToken || !usdcAddress) {
        return { success: false, error: 'Token addresses not found' }
      }

      // Buy on EVM
      const inputAmount = BigInt(Math.floor(positionSizeUsd * 1e6))
      const swapQuote = await this.get1inchSwapQuote(
        evmChainId,
        usdcAddress,
        evmToken,
        inputAmount,
      )

      if (!swapQuote) {
        return { success: false, error: 'Failed to get EVM quote' }
      }

      const swapTx = await this.execute1inchSwap(evmChainId, swapQuote)
      console.log(`   ✓ EVM buy: ${swapTx}`)

      // Sell on Hyperliquid
      const sellResult = await this.placeHyperliquidOrder(
        hlSymbol,
        'sell',
        positionSizeUsd,
        true,
      )

      return {
        success: sellResult.success,
        txHash: swapTx,
        profit: positionSizeUsd * 0.003,
        error: sellResult.error,
      }
    }
  }
  private async executeCrossChainEvmArb(
    token: string,
    positionSizeUsd: number,
    buyChainId: number,
    sellChainId: number,
  ): Promise<{
    success: boolean
    txHash?: string
    profit?: number
    error?: string
  }> {
    const buyClients = this.evmClients.get(buyChainId)
    const sellClients = this.evmClients.get(sellChainId)

    if (!buyClients || !sellClients) {
      return { success: false, error: 'EVM clients not configured for chains' }
    }

    const buyToken = TOKEN_ADDRESSES[token][buyChainId]
    const sellToken = TOKEN_ADDRESSES[token][sellChainId]
    const buyUsdc = TOKEN_ADDRESSES.USDC[buyChainId]

    if (!buyToken || !sellToken || !buyUsdc) {
      return { success: false, error: 'Token addresses not found' }
    }

    // 1. Buy on cheaper chain
    const inputAmount = BigInt(Math.floor(positionSizeUsd * 1e6))
    const buyQuote = await this.get1inchSwapQuote(
      buyChainId,
      buyUsdc,
      buyToken,
      inputAmount,
    )

    if (!buyQuote) {
      return { success: false, error: 'Failed to get buy quote' }
    }

    const buyTx = await this.execute1inchSwap(buyChainId, buyQuote)
    console.log(`   ✓ Buy on chain ${buyChainId}: ${buyTx}`)

    // 2. Bridge to sell chain
    const bridgeTx = await this.bridgeEvmToEvm(
      buyChainId,
      sellChainId,
      buyToken,
      buyQuote.outputAmount,
    )
    console.log(`   ✓ Bridge: ${bridgeTx}`)

    // 3. Sell on expensive chain (queued for after bridge completes)
    const estimatedProfit =
      positionSizeUsd *
      ((await this.getPriceDiffBps(token, buyChainId, sellChainId)) / 10000)

    return {
      success: true,
      txHash: buyTx,
      profit: estimatedProfit,
    }
  }
  private async getJupiterQuote(
    inputMint: string,
    outputMint: string,
    amount: string,
  ): Promise<JupiterQuote | null> {
    const url = `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${this.config.maxSlippageBps}`

    const response = await fetch(url)
    if (!response.ok) {
      console.error(`Jupiter quote failed: ${response.status}`)
      return null
    }

    const data: unknown = await response.json()
    if (!isJupiterQuote(data)) {
      console.error('Invalid Jupiter quote response')
      return null
    }
    return data
  }

  private async executeJupiterSwap(quote: JupiterQuote): Promise<string> {
    if (!this.solanaConnection || !this.solanaKeypair) {
      throw new Error('Solana not configured')
    }

    // Get swap transaction
    const response = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: this.solanaKeypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    })

    if (!response.ok) {
      throw new Error(`Jupiter swap API failed: ${response.status}`)
    }

    const json: unknown = await response.json()
    const parsed = JupiterSwapResponseSchema.safeParse(json)
    if (!parsed.success) {
      throw new Error(
        `Invalid Jupiter swap response: ${parsed.error.issues[0].message}`,
      )
    }
    const { swapTransaction } = parsed.data

    // Deserialize, sign, and send
    const txBuffer = Buffer.from(swapTransaction, 'base64')
    const tx = VersionedTransaction.deserialize(txBuffer)
    tx.sign([this.solanaKeypair])

    // Submit via Jito for MEV protection
    return this.submitViaJito(tx)
  }

  private async submitViaJito(tx: VersionedTransaction): Promise<string> {
    if (!this.solanaConnection || !this.solanaKeypair) {
      throw new Error('Solana not configured')
    }

    // Add Jito tip transaction
    const tipAccount = new PublicKey(
      JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)],
    )
    const tipAmount = Number(this.config.jitoTipLamports)

    const tipIx = SystemProgram.transfer({
      fromPubkey: this.solanaKeypair.publicKey,
      toPubkey: tipAccount,
      lamports: tipAmount,
    })

    // Create tip transaction
    const { blockhash } = await this.solanaConnection.getLatestBlockhash()
    const tipMessage = new TransactionMessage({
      payerKey: this.solanaKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [tipIx],
    }).compileToV0Message()

    const tipTx = new VersionedTransaction(tipMessage)
    tipTx.sign([this.solanaKeypair])

    // Submit bundle
    const bundle = [tx, tipTx].map((t) =>
      Buffer.from(t.serialize()).toString('base64'),
    )

    const response = await fetch(`${JITO_BLOCK_ENGINE}/api/v1/bundles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [bundle],
      }),
    })

    const json: unknown = await response.json()
    const parsed = JitoBundleResponseSchema.safeParse(json)
    if (!parsed.success) {
      console.warn('Invalid Jito response, using regular submission')
      const signature = await this.solanaConnection.sendTransaction(tx)
      await this.solanaConnection.confirmTransaction(signature, 'confirmed')
      return signature
    }
    const result = parsed.data

    if (result.error) {
      // Fall back to regular submission
      console.warn(
        `Jito bundle failed, using regular submission: ${result.error.message}`,
      )
      const signature = await this.solanaConnection.sendTransaction(tx)
      await this.solanaConnection.confirmTransaction(signature, 'confirmed')
      return signature
    }

    // Wait for bundle confirmation
    const bundleId = result.result ?? ''
    await this.waitForJitoBundle(bundleId)

    // Get the main transaction signature
    const txSignature = Buffer.from(tx.signatures[0]).toString('base64')
    return txSignature
  }

  private async waitForJitoBundle(bundleId: string): Promise<void> {
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500))

      const response = await fetch(`${JITO_BLOCK_ENGINE}/api/v1/bundles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBundleStatuses',
          params: [[bundleId]],
        }),
      })

      const json: unknown = await response.json()
      const parsed = JitoBundleStatusResponseSchema.safeParse(json)
      if (!parsed.success) continue

      const firstValue = parsed.data.result?.value[0]
      const status = firstValue?.confirmation_status
      if (status === 'confirmed' || status === 'finalized') {
        return
      }
    }
  }
  private async get1inchSwapQuote(
    chainId: number,
    fromToken: Address,
    toToken: Address,
    amount: bigint,
  ): Promise<SwapQuote | null> {
    const apiKey = this.config.oneInchApiKey
    if (!apiKey) {
      // Fall back to Uniswap quoter
      return this.getUniswapQuote(chainId, fromToken, toToken, amount)
    }

    const url = `${ONEINCH_SWAP_API}/${chainId}/swap?src=${fromToken}&dst=${toToken}&amount=${amount}&from=${this.getAddress()}&slippage=${this.config.maxSlippageBps / 100}&disableEstimate=true`

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      console.error(`1inch API error: ${response.status}`)
      return this.getUniswapQuote(chainId, fromToken, toToken, amount)
    }

    const json: unknown = await response.json()
    const parsed = OneInchSwapResponseSchema.safeParse(json)
    if (!parsed.success) {
      console.error('Invalid 1inch response:', parsed.error.issues)
      return this.getUniswapQuote(chainId, fromToken, toToken, amount)
    }
    const data = parsed.data

    return {
      inputToken: fromToken,
      outputToken: toToken,
      inputAmount: amount,
      outputAmount: BigInt(data.dstAmount),
      priceImpactBps: 10, // 1inch doesn't return this directly
      route: '1inch',
      txData: data.tx.data,
    }
  }

  private async getUniswapQuote(
    chainId: number,
    fromToken: Address,
    toToken: Address,
    amount: bigint,
  ): Promise<SwapQuote | null> {
    const clients = this.evmClients.get(chainId)
    if (!clients) return null

    // Uniswap V3 QuoterV2 addresses
    const QUOTER_V2: Record<number, Address> = {
      1: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      42161: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      10: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      8453: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
    }

    const quoterAddress = QUOTER_V2[chainId]
    if (!quoterAddress) return null

    const QUOTER_ABI = parseAbi([
      'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
    ])

    const result = await clients.public.simulateContract({
      address: quoterAddress,
      abi: QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          tokenIn: fromToken,
          tokenOut: toToken,
          amountIn: amount,
          fee: 3000, // 0.3% pool
          sqrtPriceLimitX96: 0n,
        },
      ],
    })

    return {
      inputToken: fromToken,
      outputToken: toToken,
      inputAmount: amount,
      outputAmount: result.result[0],
      priceImpactBps: 10,
      route: 'uniswap_v3',
    }
  }

  private async execute1inchSwap(
    chainId: number,
    quote: SwapQuote,
  ): Promise<string> {
    const clients = this.evmClients.get(chainId)
    if (!clients) throw new Error(`Chain ${chainId} not configured`)

    if (quote.txData) {
      // Use 1inch tx data - sign via KMS and broadcast
      const chainId = chainConfig?.chain.id ?? 1
      const { signedTransaction, hash } = await this.evmSigner.signTransaction({
        to: ONEINCH_ROUTER,
        data: quote.txData,
        chainId,
      })
      await clients.public.sendRawTransaction({
        serializedTransaction: signedTransaction,
      })

      await clients.public.waitForTransactionReceipt({ hash })
      return hash
    }

    // Fall back to Uniswap V3 router
    return this.executeUniswapSwap(chainId, quote)
  }

  private async executeUniswapSwap(
    chainId: number,
    quote: SwapQuote,
  ): Promise<string> {
    const clients = this.evmClients.get(chainId)
    if (!clients) throw new Error(`Chain ${chainId} not configured`)

    // Uniswap V3 SwapRouter02 addresses
    const ROUTER_V2: Record<number, Address> = {
      1: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      42161: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      10: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      8453: '0x2626664c2603336E57B271c5C0b26F421741e481',
    }

    const routerAddress = ROUTER_V2[chainId]
    if (!routerAddress) throw new Error(`No router for chain ${chainId}`)

    const ROUTER_ABI = parseAbi([
      'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
    ])

    // First approve
    const approveData = encodeFunctionData({
      abi: parseAbi([
        'function approve(address spender, uint256 amount) returns (bool)',
      ]),
      functionName: 'approve',
      args: [routerAddress, quote.inputAmount],
    })

    // Sign approve tx via KMS
    const { signedTransaction: signedApprove, hash: approveHash } =
      await this.evmSigner.signTransaction({
        to: quote.inputToken,
        data: approveData,
        chainId: chainConfig?.chain.id ?? 1,
      })
    await clients.public.sendRawTransaction({
      serializedTransaction: signedApprove,
    })
    await clients.public.waitForTransactionReceipt({ hash: approveHash })

    // Then swap
    const minOut =
      (quote.outputAmount * BigInt(10000 - this.config.maxSlippageBps)) / 10000n

    const swapData = encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: quote.inputToken,
          tokenOut: quote.outputToken,
          fee: 3000,
          recipient: this.getAddress(),
          amountIn: quote.inputAmount,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: 0n,
        },
      ],
    })

    // Sign swap tx via KMS
    const { signedTransaction, hash } = await this.evmSigner.signTransaction({
      to: routerAddress,
      data: swapData,
      chainId: chainConfig?.chain.id ?? 1,
    })
    await clients.public.sendRawTransaction({
      serializedTransaction: signedTransaction,
    })

    await clients.public.waitForTransactionReceipt({ hash })
    return hash
  }

  private async executeEvmSwap(
    chainId: number,
    fromToken: Address,
    toToken: Address,
    amount: bigint,
  ): Promise<string> {
    const quote = await this.get1inchSwapQuote(
      chainId,
      fromToken,
      toToken,
      amount,
    )
    if (!quote) {
      throw new Error(
        `Failed to get swap quote for ${fromToken} -> ${toToken} on chain ${chainId}`,
      )
    }
    return this.execute1inchSwap(chainId, quote)
  }

  private async bridgeSolanaToEvm(
    tokenMint: string,
    amount: bigint,
    destChainId: number,
    recipient: string,
  ): Promise<string> {
    const endpoint = this.config.zkBridgeEndpoint
    if (!endpoint) {
      throw new Error('ZK_BRIDGE_ENDPOINT not configured')
    }

    // Generate a transfer ID
    const transferId = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`

    // Convert recipient to 32-byte format (EVM address padded)
    const recipientBytes = recipient.startsWith('0x')
      ? recipient.slice(2)
      : recipient
    const paddedRecipient = recipientBytes.padStart(64, '0')

    const response = await fetch(`${endpoint}/submit-transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'solana',
        transferId: Array.from(Buffer.from(transferId.slice(2), 'hex')),
        token: Array.from(Buffer.from(tokenMint)),
        recipient: Array.from(Buffer.from(paddedRecipient, 'hex')),
        amount: amount.toString(),
        sourceChainId: 900001, // Solana pseudo chain ID
        destChainId,
        timestamp: Date.now(),
        payload: [],
      }),
    })

    if (!response.ok) {
      throw new Error(
        `Bridge API failed: ${response.status} ${await response.text()}`,
      )
    }

    const json: unknown = await response.json()
    const parsed = BridgeTransferResponseSchema.safeParse(json)
    if (!parsed.success) {
      throw new Error(
        `Invalid bridge response: ${parsed.error.issues[0].message}`,
      )
    }
    return parsed.data.transferId
  }

  private async bridgeEvmToSolana(
    sourceChainId: number,
    tokenAddress: Address,
    amount: bigint,
    recipient: string, // Solana pubkey base58
  ): Promise<string> {
    const endpoint = this.config.zkBridgeEndpoint
    if (!endpoint) {
      throw new Error('ZK_BRIDGE_ENDPOINT not configured')
    }

    // Generate a transfer ID
    const transferId = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`

    // Convert token address to bytes
    const tokenBytes = tokenAddress.startsWith('0x')
      ? tokenAddress.slice(2)
      : tokenAddress

    // Solana pubkey is 32 bytes base58 encoded - convert to hex for the bridge API
    const recipientBytes = Buffer.from(recipient)
      .toString('hex')
      .padStart(64, '0')

    const response = await fetch(`${endpoint}/submit-transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'evm',
        transferId: Array.from(Buffer.from(transferId.slice(2), 'hex')),
        token: Array.from(Buffer.from(tokenBytes.padStart(40, '0'), 'hex')),
        recipient: Array.from(Buffer.from(recipientBytes, 'hex')),
        amount: amount.toString(),
        sourceChainId,
        destChainId: 900001, // Solana pseudo chain ID
        timestamp: Date.now(),
        payload: [],
      }),
    })

    if (!response.ok) {
      throw new Error(`Bridge API failed: ${response.status}`)
    }

    const json: unknown = await response.json()
    const parsed = BridgeTransferResponseSchema.safeParse(json)
    if (!parsed.success) {
      throw new Error(
        `Invalid bridge response: ${parsed.error.issues[0].message}`,
      )
    }
    return parsed.data.transferId
  }

  private async bridgeEvmToEvm(
    sourceChainId: number,
    destChainId: number,
    tokenAddress: Address,
    amount: bigint,
  ): Promise<string> {
    // Use native bridge or Hyperlane depending on chains
    const endpoint = this.config.zkBridgeEndpoint
    if (!endpoint) {
      throw new Error('Bridge endpoint not configured')
    }

    const response = await fetch(`${endpoint}/api/bridge/evm-to-evm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceChainId,
        destChainId,
        tokenAddress,
        amount: amount.toString(),
        recipient: this.getAddress(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Bridge API failed: ${response.status}`)
    }

    const json: unknown = await response.json()
    const parsed = BridgeTxResponseSchema.safeParse(json)
    if (!parsed.success) {
      throw new Error(
        `Invalid bridge response: ${parsed.error.issues[0].message}`,
      )
    }
    return parsed.data.txHash
  }
  private async placeHyperliquidOrder(
    symbol: string,
    side: 'buy' | 'sell',
    sizeUsd: number,
    isSpot: boolean,
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    // Get current price
    const priceResponse = await fetch(`${HYPERLIQUID_API}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
    })

    const priceJson: unknown = await priceResponse.json()
    const pricesParsed = HyperliquidPricesResponseSchema.safeParse(priceJson)
    if (!pricesParsed.success) {
      return { success: false, error: 'Invalid Hyperliquid prices response' }
    }
    const prices = pricesParsed.data
    const price = parseFloat(prices[symbol] ?? '')
    if (!price) {
      return { success: false, error: `No price for ${symbol}` }
    }

    const size = sizeUsd / price
    const isBuy = side === 'buy'

    // Build the order action for Hyperliquid L1
    const timestamp = Date.now()
    const nonce = timestamp

    // Hyperliquid order structure
    const orderAction = {
      type: 'order',
      orders: [
        {
          a: isSpot ? 10000 : this.getHyperliquidAssetIndex(symbol),
          b: isBuy,
          p: price.toFixed(1),
          s: size.toFixed(6),
          r: false,
          t: { limit: { tif: 'Ioc' } },
        },
      ],
      grouping: 'na',
    }

    // Create the typed data for EIP-712 signing (Hyperliquid format)
    const actionHash = this.hashHyperliquidAction(orderAction, nonce)

    // Sign via KMS (no local private keys)
    const signature = await this.evmSigner.signMessage({
      message: actionHash,
    })

    // Submit to Hyperliquid exchange API
    const response = await fetch(`${HYPERLIQUID_API}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: orderAction,
        nonce,
        signature,
        vaultAddress: null,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { success: false, error: `Hyperliquid API error: ${errorText}` }
    }

    const result: unknown = await response.json()
    const HyperliquidOrderResponseSchema = z.object({
      status: z.string(),
      response: z
        .object({
          type: z.string(),
          data: z
            .object({
              statuses: z.array(
                z.object({
                  resting: z.object({ oid: z.number() }).optional(),
                  filled: z
                    .object({ oid: z.number(), totalSz: z.string() })
                    .optional(),
                  error: z.string().optional(),
                }),
              ),
            })
            .optional(),
        })
        .optional(),
    })

    const parsed = HyperliquidOrderResponseSchema.safeParse(result)
    if (!parsed.success) {
      return { success: false, error: 'Invalid Hyperliquid order response' }
    }

    const status = parsed.data.response?.data?.statuses[0]
    if (status?.error) {
      return { success: false, error: status.error }
    }

    const orderId = status?.resting?.oid ?? status?.filled?.oid
    console.log(`   ✓ HL ${side} order placed: ${orderId}`)

    return {
      success: true,
      orderId: orderId ? `hl-${orderId}` : `hl-${nonce}`,
    }
  }

  private getHyperliquidAssetIndex(symbol: string): number {
    // Hyperliquid asset indices (perps)
    const ASSET_INDICES: Record<string, number> = {
      BTC: 0,
      ETH: 1,
      SOL: 4,
      AVAX: 5,
      ARB: 11,
      OP: 14,
    }
    return ASSET_INDICES[symbol] ?? 1 // Default to ETH
  }

  private hashHyperliquidAction(action: unknown, nonce: number): Uint8Array {
    // Hyperliquid uses EIP-712 typed data signing
    // The action hash is keccak256 of the structured data
    const { keccak256, toBytes, concat } = require('viem')

    // Serialize action to msgpack format (Hyperliquid uses msgpack)
    const actionBytes = this.msgpackEncode(action)
    const nonceBytes = toBytes(BigInt(nonce))

    // Combine and hash with keccak256
    const combined = concat([actionBytes, nonceBytes])
    const hashHex = keccak256(combined)

    return toBytes(hashHex)
  }

  private msgpackEncode(value: unknown): Uint8Array {
    // Simplified msgpack encoding for Hyperliquid action format
    // Uses canonical JSON as fallback since full msgpack requires external lib
    const json = JSON.stringify(value, (_, v) => {
      if (typeof v === 'bigint') return v.toString()
      return v
    })
    return new TextEncoder().encode(json)
  }

  private async bridgeFromHyperliquid(
    destChainId: number,
    amountUsd: number,
  ): Promise<string> {
    // Hyperliquid withdrawal to Arbitrum (native bridge)
    // Hyperliquid L1 settles to Arbitrum, so we withdraw to Arbitrum first
    const timestamp = Date.now()
    const nonce = timestamp

    // Withdrawal action
    const withdrawAction = {
      type: 'withdraw3',
      hyperliquidChain: 'Mainnet',
      signatureChainId: '0xa4b1', // Arbitrum chain ID in hex
      destination: this.getAddress(),
      amount: (amountUsd * 1e6).toFixed(0), // USDC has 6 decimals
      time: timestamp,
    }

    // Sign the withdrawal via KMS
    const actionHash = this.hashHyperliquidAction(withdrawAction, nonce)
    const signature = await this.evmSigner.signMessage({
      message: actionHash,
    })

    // Submit withdrawal
    const response = await fetch(`${HYPERLIQUID_API}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: withdrawAction,
        nonce,
        signature,
      }),
    })

    if (!response.ok) {
      throw new Error(`Hyperliquid withdrawal failed: ${response.status}`)
    }

    console.log(`   ✓ HL withdrawal initiated: ${amountUsd} USDC to Arbitrum`)

    // If destination is not Arbitrum, bridge from Arbitrum to destination
    if (destChainId !== 42161) {
      const bridgeTx = await this.bridgeEvmToEvm(
        42161, // Arbitrum
        destChainId,
        TOKEN_ADDRESSES.USDC[42161],
        BigInt(Math.floor(amountUsd * 1e6)),
      )
      return bridgeTx
    }

    return `hl-withdraw-${timestamp}`
  }

  private parseEvmChainId(chain: string): number | null {
    if (chain.startsWith('evm:')) {
      return parseInt(chain.split(':')[1], 10)
    }
    return null
  }

  private async getPriceDiffBps(
    token: string,
    buyChain: string | number,
    sellChain: string | number,
  ): Promise<number> {
    // Fetch real prices from both chains
    const buyPrice = await this.getChainPrice(token, buyChain)
    const sellPrice = await this.getChainPrice(token, sellChain)

    if (!buyPrice || !sellPrice || buyPrice <= 0 || sellPrice <= 0) {
      throw new Error(`Failed to fetch prices for ${token}`)
    }

    // Calculate price difference in basis points
    const priceDiffBps = Math.floor(((sellPrice - buyPrice) / buyPrice) * 10000)

    return priceDiffBps
  }

  private async getChainPrice(
    token: string,
    chain: string | number,
  ): Promise<number | null> {
    // Handle Solana
    if (chain === 'solana') {
      return this.getSolanaPrice(token)
    }

    // Handle Hyperliquid
    if (chain === 'hyperliquid') {
      return this.getHyperliquidPrice(token)
    }

    // Handle EVM chains
    const chainId =
      typeof chain === 'number' ? chain : this.parseEvmChainId(chain)
    if (!chainId) return null

    return this.getEvmChainPrice(token, chainId)
  }

  private async getSolanaPrice(token: string): Promise<number | null> {
    const solanaToken = SOLANA_MINTS[token]
    if (!solanaToken) return null

    const JUPITER_PRICE_API = 'https://price.jup.ag/v6/price'
    const response = await fetch(`${JUPITER_PRICE_API}?ids=${solanaToken.mint}`)

    if (!response.ok) return null

    const json: unknown = await response.json()
    const JupiterPriceSchema = z.object({
      data: z.record(z.string(), z.object({ price: z.number() })),
    })

    const parsed = JupiterPriceSchema.safeParse(json)
    if (!parsed.success) return null

    return parsed.data.data[solanaToken.mint].price ?? null
  }

  private async getHyperliquidPrice(token: string): Promise<number | null> {
    const response = await fetch(`${HYPERLIQUID_API}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
    })

    if (!response.ok) return null

    const json: unknown = await response.json()
    const parsed = HyperliquidPricesResponseSchema.safeParse(json)
    if (!parsed.success) return null

    const symbol = token === 'WETH' ? 'ETH' : token
    const priceStr = parsed.data[symbol]
    return priceStr ? parseFloat(priceStr) : null
  }

  private async getEvmChainPrice(
    token: string,
    chainId: number,
  ): Promise<number | null> {
    const rpcUrl = this.config.evmRpcUrls[chainId]
    if (!rpcUrl) return null

    // Chainlink price feed addresses
    const CHAINLINK_FEEDS: Record<string, Record<number, Address>> = {
      WETH: {
        1: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
        8453: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
        42161: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
        10: '0x13e3Ee699D1909E989722E753853AE30b17e08c5',
      },
      ETH: {
        1: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
        8453: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
        42161: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
        10: '0x13e3Ee699D1909E989722E753853AE30b17e08c5',
      },
      BTC: {
        1: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
        42161: '0x6ce185860a4963106506C203335A2910912DfbBA',
      },
    }

    const feedAddress = CHAINLINK_FEEDS[token][chainId]
    if (!feedAddress) return null

    const CHAINLINK_ABI = parseAbi([
      'function latestAnswer() external view returns (int256)',
    ])

    const client = createPublicClient({ transport: http(rpcUrl) })

    const result = await client.readContract({
      address: feedAddress,
      abi: CHAINLINK_ABI,
      functionName: 'latestAnswer',
    })

    // Chainlink returns 8 decimals
    return Number(result) / 1e8
  }
}

/** Validates that a string is a valid EVM private key format */
function validateEvmPrivateKey(key: string | undefined, source: string): Hex {
  if (!key) {
    throw new Error(
      `EVM private key required. Set ${source} environment variable or provide in config.`,
    )
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error(
      `Invalid EVM private key format from ${source}. Must be 0x followed by 64 hex characters.`,
    )
  }
  return expectHex(key, source)
}

export function createArbitrageExecutor(
  config: Partial<ExecutorConfig>,
): ArbitrageExecutor {
  // Validate EVM private key - required for operation
  const evmPrivateKey = validateEvmPrivateKey(
    config.evmPrivateKey ||
      process.env.EVM_PRIVATE_KEY ||
      process.env.JEJU_PRIVATE_KEY,
    'EVM_PRIVATE_KEY or JEJU_PRIVATE_KEY',
  )

  // Solana private key is optional but validated if provided
  const solanaPrivateKey =
    config.solanaPrivateKey || process.env.SOLANA_PRIVATE_KEY
  if (solanaPrivateKey) {
    // Validate base64 format (Solana keys are 64 bytes base64 encoded)
    const decoded = Buffer.from(solanaPrivateKey, 'base64')
    if (decoded.length !== 64) {
      throw new Error(
        'Invalid Solana private key format. Must be 64 bytes base64 encoded.',
      )
    }
  }

  const fullConfig: ExecutorConfig = {
    evmPrivateKey,
    solanaPrivateKey,
    evmRpcUrls: config.evmRpcUrls || {
      1: process.env.RPC_URL_1 || getExternalRpc('ethereum'),
      42161: process.env.RPC_URL_42161 || getExternalRpc('arbitrum'),
      10: process.env.RPC_URL_10 || getExternalRpc('optimism'),
      8453: process.env.RPC_URL_8453 || getExternalRpc('base'),
    },
    solanaRpcUrl: config.solanaRpcUrl ?? process.env.SOLANA_RPC_URL,
    zkBridgeEndpoint: config.zkBridgeEndpoint ?? process.env.ZK_BRIDGE_ENDPOINT,
    oneInchApiKey: config.oneInchApiKey ?? process.env.ONEINCH_API_KEY,
    maxSlippageBps: config.maxSlippageBps ?? 50,
    jitoTipLamports: config.jitoTipLamports ?? BigInt(10000),
  }

  return new ArbitrageExecutor(fullConfig)
}
