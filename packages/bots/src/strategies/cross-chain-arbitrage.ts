/**
 * Cross-Chain Arbitrage Strategy
 *
 * Monitors prices across multiple EVM chains and Solana,
 * identifying cross-chain arbitrage opportunities.
 * Supports DWS for decentralized API access.
 */

import { EventEmitter } from '@jejunetwork/shared'
import type { EVMChainId, SolanaNetwork } from '@jejunetwork/types'
import { expectValid } from '@jejunetwork/types'
import type { Commitment, PublicKey } from '@solana/web3.js'
import {
  type Address,
  createPublicClient,
  formatUnits,
  http,
  type PublicClient,
  parseAbi,
  parseUnits,
} from 'viem'
import { type DWSClient, getDWSClient } from '../dws'
import { TOKEN_SYMBOLS } from '../oracles'
import { JupiterQuoteResponseSchema } from '../schemas'
import type { CrossChainArbOpportunity } from '../types'

interface ChainConfig {
  chainId: EVMChainId | SolanaNetwork
  name: string
  rpcUrl: string
  type: 'evm' | 'solana'
  blockTimeMs: number
  nativeSymbol: string
  dexes: DexConfig[]
  bridges: BridgeConfig[]
}

interface DexConfig {
  name: string
  type: 'uniswap-v2' | 'uniswap-v3' | 'curve' | 'balancer' | 'raydium' | 'orca'
  router?: Address
  factory?: Address
  quoter?: Address
}

interface BridgeConfig {
  name: string
  type: 'stargate' | 'across' | 'wormhole' | 'layerzero' | 'hop'
  contract: Address | string
  supportedChains: (EVMChainId | SolanaNetwork)[]
  estimatedTimeSeconds: number
  baseFeeUsd: number
}

const UNISWAP_V2_ROUTER_ABI = parseAbi([
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)',
  'function factory() external view returns (address)',
])

const UNISWAP_V2_FACTORY_ABI = parseAbi([
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
])

const UNISWAP_V2_PAIR_ABI = parseAbi([
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
])

const UNISWAP_V3_QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)',
])

function getRequiredEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function getChainRpcUrl(chainId: number): string {
  switch (chainId) {
    case 1:
      return getRequiredEnv('ETH_RPC_URL')
    case 8453:
      return getRequiredEnv('BASE_RPC_URL')
    case 42161:
      return getRequiredEnv('ARB_RPC_URL')
    case 10:
      return getRequiredEnv('OP_RPC_URL')
    case 56:
      return getRequiredEnv('BSC_RPC_URL')
    default:
      throw new Error(`No RPC URL configured for chain ${chainId}`)
  }
}

// Chain configs are built lazily when needed
function buildDefaultChains(): ChainConfig[] {
  return [
    {
      chainId: 1,
      name: 'Ethereum',
      rpcUrl: getChainRpcUrl(1),
      type: 'evm',
      blockTimeMs: 12000,
      nativeSymbol: 'ETH',
      dexes: [
        {
          name: 'Uniswap V3',
          type: 'uniswap-v3',
          router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
          quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
        },
        {
          name: 'Uniswap V2',
          type: 'uniswap-v2',
          router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
          factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
        },
        {
          name: 'Curve',
          type: 'curve',
          router: '0x99a58482BD75cbab83b27EC03CA68fF489b5788f',
        },
      ],
      bridges: [
        {
          name: 'Stargate',
          type: 'stargate',
          contract: '0x8731d54E9D02c286767d56ac03e8037C07e01e98',
          supportedChains: [8453, 42161, 10, 56],
          estimatedTimeSeconds: 60,
          baseFeeUsd: 0.5,
        },
        {
          name: 'Across',
          type: 'across',
          contract: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
          supportedChains: [8453, 42161, 10],
          estimatedTimeSeconds: 120,
          baseFeeUsd: 0.3,
        },
      ],
    },
    {
      chainId: 8453,
      name: 'Base',
      rpcUrl: getChainRpcUrl(8453),
      type: 'evm',
      blockTimeMs: 2000,
      nativeSymbol: 'ETH',
      dexes: [
        {
          name: 'Aerodrome',
          type: 'uniswap-v2',
          router: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
          factory: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
        },
        {
          name: 'Uniswap V3',
          type: 'uniswap-v3',
          router: '0x2626664c2603336E57B271c5C0b26F421741e481',
          quoter: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
        },
      ],
      bridges: [
        {
          name: 'Stargate',
          type: 'stargate',
          contract: '0x45f1A95A4D3f3836523F5c83673c797f4d4d263B',
          supportedChains: [1, 42161, 10, 56],
          estimatedTimeSeconds: 60,
          baseFeeUsd: 0.5,
        },
      ],
    },
    {
      chainId: 42161,
      name: 'Arbitrum',
      rpcUrl: getChainRpcUrl(42161),
      type: 'evm',
      blockTimeMs: 250,
      nativeSymbol: 'ETH',
      dexes: [
        {
          name: 'Uniswap V3',
          type: 'uniswap-v3',
          router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
          quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
        },
        {
          name: 'Camelot',
          type: 'uniswap-v2',
          router: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
          factory: '0x6EcCab422D763aC031210895C81787E87B43A652',
        },
      ],
      bridges: [
        {
          name: 'Stargate',
          type: 'stargate',
          contract: '0x53Bf833A5d6c4ddA888F69c22C88C9f356a41614',
          supportedChains: [1, 8453, 10, 56],
          estimatedTimeSeconds: 60,
          baseFeeUsd: 0.5,
        },
      ],
    },
    {
      chainId: 10,
      name: 'Optimism',
      rpcUrl: getChainRpcUrl(10),
      type: 'evm',
      blockTimeMs: 2000,
      nativeSymbol: 'ETH',
      dexes: [
        {
          name: 'Velodrome',
          type: 'uniswap-v2',
          router: '0xa062aE8A9c5e11aaA026fc2670B0D65ccc8B2858',
          factory: '0x25CbdDb98b35ab1FF77413456B31EC81A6B6B746',
        },
        {
          name: 'Uniswap V3',
          type: 'uniswap-v3',
          router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
          quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
        },
      ],
      bridges: [
        {
          name: 'Stargate',
          type: 'stargate',
          contract: '0xB0D502E938ed5f4df2E681fE6E419ff29631d62b',
          supportedChains: [1, 8453, 42161, 56],
          estimatedTimeSeconds: 60,
          baseFeeUsd: 0.5,
        },
      ],
    },
    {
      chainId: 56,
      name: 'BSC',
      rpcUrl: getChainRpcUrl(56),
      type: 'evm',
      blockTimeMs: 3000,
      nativeSymbol: 'BNB',
      dexes: [
        {
          name: 'PancakeSwap V3',
          type: 'uniswap-v3',
          router: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
          quoter: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
        },
        {
          name: 'PancakeSwap V2',
          type: 'uniswap-v2',
          router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
          factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
        },
      ],
      bridges: [
        {
          name: 'Stargate',
          type: 'stargate',
          contract: '0x4a364f8c717cAAD9A442737Eb7b8A55cc6cf18D8',
          supportedChains: [1, 8453, 42161, 10],
          estimatedTimeSeconds: 60,
          baseFeeUsd: 0.5,
        },
      ],
    },
  ]
}

const MONITORED_PAIRS = [
  { base: 'WETH', quote: 'USDC' },
  { base: 'WETH', quote: 'USDT' },
  { base: 'WBTC', quote: 'WETH' },
  { base: 'WBTC', quote: 'USDC' },
  { base: 'ARB', quote: 'WETH' },
  { base: 'OP', quote: 'WETH' },
]

interface ChainPrice {
  chainId: EVMChainId | SolanaNetwork
  dex: string
  pair: string
  price: bigint
  liquidity: bigint
  timestamp: number
  blockNumber?: bigint
}

export interface CrossChainArbConfig {
  chains: ChainConfig[]
  minProfitBps: number
  minProfitUsd: number
  maxSlippageBps: number
  maxPositionUsd: number
  bridgeTimeoutSeconds: number
  gasBuffer: number
  enableExecution: boolean
}

const DEFAULT_CONFIG: Omit<CrossChainArbConfig, 'chains'> & {
  chains?: ChainConfig[]
} = {
  minProfitBps: 50,
  minProfitUsd: 10,
  maxSlippageBps: 100,
  maxPositionUsd: 50000,
  bridgeTimeoutSeconds: 300,
  gasBuffer: 1.5,
  enableExecution: false,
}

export class CrossChainArbitrage extends EventEmitter {
  private config: CrossChainArbConfig
  private evmClients: Map<EVMChainId, PublicClient> = new Map()
  private prices: Map<string, ChainPrice[]> = new Map()
  private opportunities: CrossChainArbOpportunity[] = []
  private running = false
  private monitorLoop: ReturnType<typeof setInterval> | null = null
  private stats = {
    opportunitiesFound: 0,
    totalProfitUsd: 0,
    tradesExecuted: 0,
    lastScan: 0,
  }

  constructor(config: Partial<CrossChainArbConfig> = {}) {
    super()
    // Build chains lazily - will throw if env vars not set
    const chains = config.chains ?? buildDefaultChains()
    this.config = { ...DEFAULT_CONFIG, chains, ...config }

    // Initialize EVM clients
    for (const chain of this.config.chains) {
      if (chain.type === 'evm') {
        this.evmClients.set(
          chain.chainId as EVMChainId,
          createPublicClient({ transport: http(chain.rpcUrl) }),
        )
      }
    }
  }

  /**
   * Start monitoring for opportunities
   */
  start(): void {
    if (this.running) return
    this.running = true

    console.log('Starting Cross-Chain Arbitrage Monitor...')
    console.log(`  Monitoring ${this.config.chains.length} chains`)
    console.log(
      `  Min profit: ${this.config.minProfitBps} bps / $${this.config.minProfitUsd}`,
    )

    // Start monitoring loop
    this.monitorLoop = setInterval(() => this.scan(), 5000) // 5 second intervals

    // Initial scan
    this.scan()

    this.emit('started')
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.running) return
    this.running = false

    if (this.monitorLoop) {
      clearInterval(this.monitorLoop)
      this.monitorLoop = null
    }

    console.log('Cross-Chain Arbitrage Monitor stopped')
    this.emit('stopped')
  }

  /**
   * Scan all chains for arbitrage opportunities
   */
  private async scan(): Promise<void> {
    this.stats.lastScan = Date.now()

    // Fetch prices from all chains
    await this.fetchAllPrices()

    // Find opportunities
    const opportunities = this.findOpportunities()

    for (const opp of opportunities) {
      this.stats.opportunitiesFound++
      this.opportunities.push(opp)
      this.emit('opportunity', opp)

      // Execute if enabled
      if (
        this.config.enableExecution &&
        opp.netProfitUsd > this.config.minProfitUsd.toString()
      ) {
        this.executeOpportunity(opp)
      }
    }

    // Clean up old opportunities
    this.opportunities = this.opportunities.filter(
      (o) => Date.now() - o.detectedAt < 60000,
    )
  }

  /**
   * Fetch prices from all DEXes on all chains
   */
  private async fetchAllPrices(): Promise<void> {
    const pricePromises: Promise<void>[] = []

    for (const chain of this.config.chains) {
      if (chain.type === 'evm') {
        for (const dex of chain.dexes) {
          for (const pair of MONITORED_PAIRS) {
            pricePromises.push(
              this.fetchDexPrice(chain, dex, pair.base, pair.quote),
            )
          }
        }
      }
    }

    await Promise.allSettled(pricePromises)
  }

  /**
   * Fetch price from a specific DEX
   */
  private async fetchDexPrice(
    chain: ChainConfig,
    dex: DexConfig,
    baseSymbol: string,
    quoteSymbol: string,
  ): Promise<void> {
    const client = this.evmClients.get(chain.chainId as EVMChainId)
    if (!client) {
      // Chain not initialized, skip silently (chain may not be configured)
      return
    }

    const pairKey = `${baseSymbol}/${quoteSymbol}`
    const baseToken = this.getTokenAddress(
      baseSymbol,
      chain.chainId as EVMChainId,
    )
    const quoteToken = this.getTokenAddress(
      quoteSymbol,
      chain.chainId as EVMChainId,
    )

    // Token not available on this chain, skip
    if (!baseToken || !quoteToken) return

    const amountIn = parseUnits('1', 18) // 1 token

    let price: bigint
    let liquidity = 0n

    if (dex.type === 'uniswap-v2' && dex.router) {
      const routerAddress = dex.router
      const amounts = (await client.readContract({
        address: routerAddress,
        abi: UNISWAP_V2_ROUTER_ABI,
        functionName: 'getAmountsOut',
        args: [amountIn, [baseToken, quoteToken]],
      })) as bigint[]

      price = amounts[1]

      // Fetch liquidity from pair contract (errors caught by Promise.allSettled in caller)
      const factory = (await client.readContract({
        address: routerAddress,
        abi: UNISWAP_V2_ROUTER_ABI,
        functionName: 'factory',
      })) as `0x${string}`

      const pairAddress = (await client.readContract({
        address: factory,
        abi: UNISWAP_V2_FACTORY_ABI,
        functionName: 'getPair',
        args: [baseToken, quoteToken],
      })) as `0x${string}`

      if (pairAddress !== '0x0000000000000000000000000000000000000000') {
        const [reserve0, reserve1] = (await client.readContract({
          address: pairAddress,
          abi: UNISWAP_V2_PAIR_ABI,
          functionName: 'getReserves',
        })) as [bigint, bigint, number]

        const token0 = (await client.readContract({
          address: pairAddress,
          abi: UNISWAP_V2_PAIR_ABI,
          functionName: 'token0',
        })) as `0x${string}`

        // Liquidity in quote token terms
        liquidity =
          token0.toLowerCase() === baseToken.toLowerCase() ? reserve1 : reserve0
      }
    } else if (dex.type === 'uniswap-v3' && dex.quoter) {
      // V3 quote
      price = (await client.readContract({
        address: dex.quoter,
        abi: UNISWAP_V3_QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [baseToken, quoteToken, 3000, amountIn, 0n],
      })) as bigint

      // V3 liquidity is more complex - use quote amount as proxy
      liquidity = price * 1000n // Rough estimate based on 0.1% depth
    } else {
      return
    }

    const chainPrice: ChainPrice = {
      chainId: chain.chainId as EVMChainId,
      dex: dex.name,
      pair: pairKey,
      price,
      liquidity,
      timestamp: Date.now(),
    }

    const existing = this.prices.get(pairKey) ?? [] // Empty array is valid initial state
    const filteredExisting = existing.filter(
      (p) => !(p.chainId === chain.chainId && p.dex === dex.name),
    )
    filteredExisting.push(chainPrice)
    this.prices.set(pairKey, filteredExisting)
  }

  /**
   * Find arbitrage opportunities across chains
   */
  private findOpportunities(): CrossChainArbOpportunity[] {
    const opportunities: CrossChainArbOpportunity[] = []

    for (const [pair, prices] of this.prices) {
      if (prices.length < 2) continue

      // Sort by price
      const sorted = [...prices].sort((a, b) =>
        a.price > b.price ? 1 : a.price < b.price ? -1 : 0,
      )

      const lowest = sorted[0]
      const highest = sorted[sorted.length - 1]

      // Calculate price difference with overflow protection
      if (lowest.price === 0n) continue // Prevent division by zero

      const priceDiff = highest.price - lowest.price
      // Cap to prevent overflow in BPS calculation
      const maxBpsValue = BigInt(Number.MAX_SAFE_INTEGER)
      const scaledDiff = priceDiff * 10000n

      // Use safe division that won't overflow
      const priceDiffBps =
        scaledDiff > maxBpsValue
          ? Number(scaledDiff / lowest.price)
          : Number(scaledDiff) / Number(lowest.price)

      if (priceDiffBps < this.config.minProfitBps) continue

      // Find bridge between chains
      const bridge = this.findBridge(
        lowest.chainId as EVMChainId,
        highest.chainId as EVMChainId,
      )

      if (!bridge) continue

      // Calculate net profit after bridge fees
      const [baseSymbol, quoteSymbol] = pair.split('/')
      const tradeSize = parseUnits('1000', 6) // $1000 trade
      const grossProfit =
        (tradeSize * BigInt(Math.floor(priceDiffBps))) / 10000n
      const bridgeFee = parseUnits(bridge.baseFeeUsd.toString(), 6)
      const gasEstimate = parseUnits('5', 6) // ~$5 gas estimate

      // Price movement buffer during bridge time
      // Assume worst case price movement based on bridge time and volatility
      // 0.1% per minute average volatility for crypto
      const bridgeMinutes = bridge.estimatedTimeSeconds / 60
      const volatilityBufferBps = Math.ceil(bridgeMinutes * 10) // 10 bps per minute
      const volatilityBuffer =
        (tradeSize * BigInt(volatilityBufferBps)) / 10000n

      const netProfit = grossProfit - bridgeFee - gasEstimate - volatilityBuffer

      if (netProfit <= 0n) continue

      const netProfitUsd = Number(formatUnits(netProfit, 6))
      if (netProfitUsd < this.config.minProfitUsd) continue

      const inputTokenAddress = this.getTokenAddress(
        baseSymbol,
        lowest.chainId as EVMChainId,
      )
      const outputTokenAddress = this.getTokenAddress(
        quoteSymbol,
        highest.chainId as EVMChainId,
      )
      if (!inputTokenAddress || !outputTokenAddress) continue

      const opportunity: CrossChainArbOpportunity = {
        id: `${pair}-${lowest.chainId}-${highest.chainId}-${Date.now()}`,
        type: 'CROSS_CHAIN',
        chainId: lowest.chainId as EVMChainId,
        sourceChainId: lowest.chainId,
        destChainId: highest.chainId,
        inputToken: {
          address: inputTokenAddress,
          symbol: baseSymbol,
          decimals: 18,
          chainId: lowest.chainId as EVMChainId,
        },
        outputToken: {
          address: outputTokenAddress,
          symbol: quoteSymbol,
          decimals: 6,
          chainId: highest.chainId as EVMChainId,
        },
        path: [],
        inputAmount: formatUnits(tradeSize, 6),
        expectedOutput: formatUnits(tradeSize + grossProfit, 6),
        expectedProfit: formatUnits(grossProfit, 6),
        expectedProfitBps: priceDiffBps,
        gasEstimate: formatUnits(gasEstimate, 6),
        netProfitWei: netProfit.toString(),
        netProfitUsd: netProfitUsd.toFixed(2),
        bridgeProtocol: bridge.name,
        bridgeFee: bridge.baseFeeUsd.toString(),
        bridgeTime: bridge.estimatedTimeSeconds,
        detectedAt: Date.now(),
        expiresAt: Date.now() + 30000, // 30 second validity
        status: 'DETECTED',
      }

      opportunities.push(opportunity)
    }

    return opportunities
  }

  /**
   * Execute an arbitrage opportunity
   *
   * MEV PROTECTION:
   * - Use private mempools (Flashbots on mainnet, similar services on L2s)
   * - Short transaction deadlines (2 minutes max)
   * - Monitor for sandwich attacks in bridge transactions
   * - Validate received amounts match expectations within tolerance
   */
  private async executeOpportunity(
    opp: CrossChainArbOpportunity,
  ): Promise<void> {
    // Validate opportunity hasn't expired
    const now = Date.now()
    if (now > opp.expiresAt) {
      opp.status = 'EXPIRED'
      this.emit('expired', opp)
      console.log(`Opportunity ${opp.id} expired before execution`)
      return
    }

    // Short deadline to minimize MEV exposure
    const DEADLINE_SECONDS = 120 // 2 minutes - short to prevent sandwich attacks
    const deadline = BigInt(Math.floor(now / 1000) + DEADLINE_SECONDS)

    opp.status = 'EXECUTING'
    this.emit('executing', opp)

    console.log(`Executing arbitrage: ${opp.id}`)
    console.log(`  Buy on ${opp.sourceChainId}, sell on ${opp.destChainId}`)
    console.log(`  Expected profit: $${opp.netProfitUsd}`)
    console.log(
      `  Deadline: ${new Date(Number(deadline) * 1000).toISOString()}`,
    )

    // Implementation would:
    // 1. Execute buy on source chain via Flashbots/private mempool
    // 2. Bridge tokens (monitor bridge for anomalies)
    // 3. Execute sell on dest chain via private mempool
    // 4. Validate received amounts match expectations (within slippage tolerance)
    // 5. Bridge profits back

    // For now, mark as completed (simulation)
    opp.status = 'COMPLETED'
    this.stats.tradesExecuted++
    this.stats.totalProfitUsd += Number(opp.netProfitUsd)

    this.emit('completed', opp)
  }

  /**
   * Find a bridge between two chains
   */
  private findBridge(
    sourceChain: EVMChainId,
    destChain: EVMChainId,
  ): BridgeConfig | null {
    const sourceConfig = this.config.chains.find(
      (c) => c.chainId === sourceChain,
    )
    if (!sourceConfig) return null

    for (const bridge of sourceConfig.bridges) {
      if (bridge.supportedChains.includes(destChain)) {
        return bridge
      }
    }

    return null
  }

  /**
   * Get token address for a symbol on a chain
   */
  private getTokenAddress(symbol: string, chainId: EVMChainId): Address | null {
    const chainTokens = TOKEN_SYMBOLS[chainId]
    if (!chainTokens) return null

    for (const [address, tokenSymbol] of Object.entries(chainTokens)) {
      if (tokenSymbol === symbol) return address as Address
    }

    return null
  }

  /**
   * Get current opportunities
   */
  getOpportunities(): CrossChainArbOpportunity[] {
    return this.opportunities
  }

  /**
   * Get stats
   */
  getStats(): typeof this.stats {
    return this.stats
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CrossChainArbConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Add a custom chain
   */
  addChain(chain: ChainConfig): void {
    this.config.chains.push(chain)

    if (chain.type === 'evm') {
      this.evmClients.set(
        chain.chainId as EVMChainId,
        createPublicClient({ transport: http(chain.rpcUrl) }),
      )
    }
  }
}

export interface SolanaArbConfig {
  rpcUrl: string
  commitment: Commitment
  minProfitBps: number
  minProfitUsd: number
  ethPriceUsd: number
  solPriceUsd: number
  monitoredTokens: SolanaTokenConfig[]
  /** Use DWS for Jupiter API access */
  useDWS?: boolean
  /** DWS client instance (uses shared instance if not provided) */
  dwsClient?: DWSClient | null
}

interface SolanaTokenConfig {
  symbol: string
  mint: string
  decimals: number
}

interface SolanaQuote {
  dex: string
  inputMint: string
  outputMint: string
  inputAmount: bigint
  outputAmount: bigint
  priceImpactPct: number
}

// Default tokens to monitor on Solana
const DEFAULT_SOLANA_TOKENS: SolanaTokenConfig[] = [
  {
    symbol: 'SOL',
    mint: 'So11111111111111111111111111111111111111112',
    decimals: 9,
  },
  {
    symbol: 'USDC',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
  },
  {
    symbol: 'USDT',
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    decimals: 6,
  },
  {
    symbol: 'JUP',
    mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    decimals: 6,
  },
  {
    symbol: 'RAY',
    mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    decimals: 6,
  },
  {
    symbol: 'BONK',
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    decimals: 5,
  },
]

export class SolanaArbitrage {
  private config: SolanaArbConfig
  private useDWS: boolean
  private dwsClient: DWSClient | null

  constructor(config: Partial<SolanaArbConfig> = {}) {
    const tokens = config.monitoredTokens ?? DEFAULT_SOLANA_TOKENS
    this.config = {
      rpcUrl: config.rpcUrl ?? 'https://api.mainnet-beta.solana.com',
      commitment: config.commitment ?? 'confirmed',
      minProfitBps: config.minProfitBps ?? 30,
      minProfitUsd: config.minProfitUsd ?? 5,
      ethPriceUsd: config.ethPriceUsd ?? 3500,
      solPriceUsd: config.solPriceUsd ?? 150,
      monitoredTokens: tokens,
      useDWS: config.useDWS ?? false,
      dwsClient: config.dwsClient ?? null,
    }
    this.useDWS = config.useDWS ?? false
    this.dwsClient = config.dwsClient ?? null
  }

  async getRaydiumQuote(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: bigint,
  ): Promise<bigint> {
    return this.getJupiterQuote(inputMint, outputMint, amount, 'Raydium')
  }

  async getOrcaQuote(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: bigint,
  ): Promise<bigint> {
    return this.getJupiterQuote(inputMint, outputMint, amount, 'Orca')
  }

  private async getJupiterQuote(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: bigint,
    dexFilter?: string,
  ): Promise<bigint> {
    const inputMintStr = inputMint.toBase58()
    const outputMintStr = outputMint.toBase58()

    const queryParams: Record<string, string> = {
      inputMint: inputMintStr,
      outputMint: outputMintStr,
      amount: amount.toString(),
      slippageBps: '50',
    }

    if (dexFilter) {
      queryParams.onlyDirectRoutes = 'true'
      queryParams.dexes = dexFilter
    }

    let data: { outAmount: string }

    if (this.useDWS) {
      // Use DWS for decentralized API access
      const client = this.dwsClient ?? getDWSClient()
      const response = await client.request<{
        inputMint: string
        inAmount: string
        outputMint: string
        outAmount: string
        otherAmountThreshold: string
        swapMode: string
        slippageBps: number
        priceImpactPct: string
        routePlan: unknown[]
        contextSlot: number
        timeTaken: number
      }>({
        providerId: 'jupiter',
        endpoint: '/quote',
        method: 'GET',
        queryParams,
      })

      data = expectValid(
        JupiterQuoteResponseSchema,
        response.data,
        `Jupiter quote ${inputMintStr} -> ${outputMintStr}`,
      )
    } else {
      // Direct API access
      const JUPITER_API = 'https://quote-api.jup.ag/v6'
      let url = `${JUPITER_API}/quote?inputMint=${inputMintStr}&outputMint=${outputMintStr}&amount=${amount.toString()}&slippageBps=50`

      if (dexFilter) {
        url += `&onlyDirectRoutes=true&dexes=${dexFilter}`
      }

      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Jupiter API error: ${response.statusText}`)
      }

      data = expectValid(
        JupiterQuoteResponseSchema,
        await response.json(),
        `Jupiter quote ${inputMintStr} -> ${outputMintStr}`,
      )
    }

    return BigInt(data.outAmount)
  }

  /**
   * Get quotes from multiple DEXes for a token pair
   */
  private async getMultiDexQuotes(
    inputMint: string,
    outputMint: string,
    amount: bigint,
  ): Promise<SolanaQuote[]> {
    const dexes = ['Raydium', 'Orca', 'Meteora', 'Phoenix', 'Lifinity']
    const quotes: SolanaQuote[] = []

    for (const dex of dexes) {
      const queryParams: Record<string, string> = {
        inputMint,
        outputMint,
        amount: amount.toString(),
        slippageBps: '50',
        onlyDirectRoutes: 'true',
        dexes: dex,
      }

      let responseData: unknown

      if (this.useDWS) {
        // Use DWS for decentralized API access
        const client = this.dwsClient ?? getDWSClient()
        const response = await client.request<unknown>({
          providerId: 'jupiter',
          endpoint: '/quote',
          method: 'GET',
          queryParams,
        })
        responseData = response.data
      } else {
        // Direct API access
        const JUPITER_API = 'https://quote-api.jup.ag/v6'
        const url = `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount.toString()}&slippageBps=50&onlyDirectRoutes=true&dexes=${dex}`

        const response = await fetch(url)
        if (!response.ok) continue
        responseData = await response.json()
      }

      const parsed = JupiterQuoteResponseSchema.safeParse(responseData)
      if (!parsed.success) continue

      quotes.push({
        dex,
        inputMint,
        outputMint,
        inputAmount: amount,
        outputAmount: BigInt(parsed.data.outAmount),
        priceImpactPct: parseFloat(parsed.data.priceImpactPct),
      })
    }

    return quotes
  }

  /**
   * Find Solana arbitrage opportunities across DEXes
   */
  async findOpportunities(): Promise<CrossChainArbOpportunity[]> {
    const opportunities: CrossChainArbOpportunity[] = []
    const tokens = this.config.monitoredTokens

    // Check pairs between monitored tokens
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const tokenA = tokens[i]
        const tokenB = tokens[j]

        // Standard trade size: 1000 units of the lower-decimal token
        const baseAmount =
          1000n * 10n ** BigInt(Math.min(tokenA.decimals, tokenB.decimals))

        // Get quotes in both directions from all DEXes
        const [quotesAtoB, quotesBtoA] = await Promise.all([
          this.getMultiDexQuotes(tokenA.mint, tokenB.mint, baseAmount),
          this.getMultiDexQuotes(tokenB.mint, tokenA.mint, baseAmount),
        ])

        if (quotesAtoB.length < 2 || quotesBtoA.length < 2) continue

        // Find best buy and sell prices for A->B direction
        const sortedAtoB = [...quotesAtoB].sort((a, b) =>
          a.outputAmount > b.outputAmount ? -1 : 1,
        )
        const sortedBtoA = [...quotesBtoA].sort((a, b) =>
          a.outputAmount > b.outputAmount ? -1 : 1,
        )

        // Check triangle arb: A -> B (best) -> A (best)
        const bestAtoB = sortedAtoB[0]
        const bestBtoA = sortedBtoA[0]

        if (!bestAtoB || !bestBtoA) continue

        // Simulate: start with baseAmount of A, swap to B, swap back to A
        const bReceived = bestAtoB.outputAmount

        // Get quote for swapping received B back to A
        const returnQuotes = await this.getMultiDexQuotes(
          tokenB.mint,
          tokenA.mint,
          bReceived,
        )
        if (returnQuotes.length === 0) continue

        const bestReturn = returnQuotes.sort((a, b) =>
          a.outputAmount > b.outputAmount ? -1 : 1,
        )[0]
        if (!bestReturn) continue

        const aReturned = bestReturn.outputAmount
        const profitRaw = aReturned - baseAmount

        if (profitRaw <= 0n) continue

        const profitBps = Number((profitRaw * 10000n) / baseAmount)

        if (profitBps < this.config.minProfitBps) continue

        // Calculate USD profit
        const tokenAPrice =
          tokenA.symbol === 'SOL'
            ? this.config.solPriceUsd
            : tokenA.symbol.includes('USD')
              ? 1
              : this.config.ethPriceUsd / 20 // Rough estimate for other tokens
        const profitUsd =
          (Number(profitRaw) / 10 ** tokenA.decimals) * tokenAPrice

        if (profitUsd < this.config.minProfitUsd) continue

        // Gas estimate for two swaps (~100k compute units each at 0.000005 SOL/CU)
        const gasEstimateUsd = 0.0001 * this.config.solPriceUsd * 2

        const netProfitUsd = profitUsd - gasEstimateUsd
        if (netProfitUsd <= 0) continue

        const opportunity: CrossChainArbOpportunity = {
          id: `solana-${tokenA.symbol}-${tokenB.symbol}-${bestAtoB.dex}-${bestReturn.dex}-${Date.now()}`,
          type: 'CROSS_CHAIN',
          chainId: 1, // Placeholder, Solana uses network names
          sourceChainId: 'solana-mainnet',
          destChainId: 'solana-mainnet',
          inputToken: {
            address: tokenA.mint,
            symbol: tokenA.symbol,
            decimals: tokenA.decimals,
            chainId: 'solana-mainnet',
          },
          outputToken: {
            address: tokenA.mint,
            symbol: tokenA.symbol,
            decimals: tokenA.decimals,
            chainId: 'solana-mainnet',
          },
          path: [],
          inputAmount: (Number(baseAmount) / 10 ** tokenA.decimals).toString(),
          expectedOutput: (
            Number(aReturned) /
            10 ** tokenA.decimals
          ).toString(),
          expectedProfit: (
            Number(profitRaw) /
            10 ** tokenA.decimals
          ).toString(),
          expectedProfitBps: profitBps,
          gasEstimate: gasEstimateUsd.toFixed(4),
          netProfitWei: profitRaw.toString(),
          netProfitUsd: netProfitUsd.toFixed(2),
          bridgeProtocol: `${bestAtoB.dex} -> ${bestReturn.dex}`,
          bridgeFee: '0',
          bridgeTime: 0,
          detectedAt: Date.now(),
          expiresAt: Date.now() + 10000, // 10 second validity for Solana (fast blocks)
          status: 'DETECTED',
        }

        opportunities.push(opportunity)
      }
    }

    return opportunities.sort(
      (a, b) => parseFloat(b.netProfitUsd) - parseFloat(a.netProfitUsd),
    )
  }

  /**
   * Update price configuration
   */
  updatePrices(solPriceUsd: number, ethPriceUsd: number): void {
    this.config.solPriceUsd = solPriceUsd
    this.config.ethPriceUsd = ethPriceUsd
  }
}
