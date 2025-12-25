/**
 * Oracle Update Arbitrage (Chainlink)
 *
 * Captures arbitrage when oracle prices update:
 * 1. Monitor Chainlink oracle update transactions
 * 2. Predict new price from pending update
 * 3. Trade on DEXes before price catches up
 *
 * Implementation follows professional MEV searcher patterns.
 */

import { EventEmitter } from 'node:events'
import {
  type Address,
  encodeFunctionData,
  type Hash,
  type PublicClient,
  parseAbi,
  parseEther,
  type WalletClient,
} from 'viem'
import { z } from 'zod'

const RpcSendTxResponseSchema = z.object({
  result: z.string().optional(),
  error: z.object({ message: z.string() }).optional(),
})

export interface OracleArbConfig {
  chainId: number
  minProfitUsd: number
  maxGasPrice: bigint
  oracleAddresses: Address[]
  dexRouters: Address[]
  arbContract: Address
  useFlashbots: boolean
  flashbotsRpc?: string
  maxSlippageBps: number
}

interface OracleUpdate {
  oracle: Address
  oldPrice: bigint
  newPrice: bigint
  txHash: Hash
  blockNumber: bigint
  asset: string
  decimals: number
}

interface OracleArbOpportunity {
  oracle: Address
  asset: string
  priceDelta: number
  direction: 'long' | 'short'
  expectedProfitUsd: number
  router: Address
  path: Address[]
  amountIn: bigint
  minAmountOut: bigint
  gasEstimate: bigint
}

interface ExecutionResult {
  success: boolean
  txHash?: Hash
  profit?: bigint
  gasUsed?: bigint
  error?: string
}

/** AnswerUpdated event args from Chainlink oracle */
interface AnswerUpdatedArgs {
  current: bigint
  roundId: bigint
  updatedAt: bigint
}

const CHAINLINK_AGGREGATOR_ABI = parseAbi([
  'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function description() view returns (string)',
  'function decimals() view returns (uint8)',
])

const UNISWAP_ROUTER_ABI = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])',
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])',
])

const _ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
])

// Token addresses by chain
const TOKENS: Record<number, Record<string, Address>> = {
  1: {
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  },
  8453: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  42161: {
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
}

// Major Chainlink price feeds
const _CHAINLINK_FEEDS: Record<number, Record<string, Address>> = {
  1: {
    'ETH/USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
    'BTC/USD': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
    'LINK/USD': '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c',
  },
  8453: {
    'ETH/USD': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
  },
  42161: {
    'ETH/USD': '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
  },
}

export class OracleArbStrategy extends EventEmitter {
  private config: OracleArbConfig
  private client: PublicClient
  private wallet: WalletClient
  private running = false
  private lastPrices: Map<Address, { price: bigint; decimals: number }> =
    new Map()
  private recentUpdates: OracleUpdate[] = []
  private executionStats = {
    attempts: 0,
    successes: 0,
    totalProfit: 0n,
    totalGas: 0n,
  }

  constructor(
    config: OracleArbConfig,
    client: PublicClient,
    wallet: WalletClient,
  ) {
    super()
    this.config = config
    this.client = client
    this.wallet = wallet
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    console.log(
      `📊 Oracle Arb: monitoring ${this.config.oracleAddresses.length} Chainlink feeds`,
    )

    await this.initializePrices()
    this.watchOracles()
  }

  stop(): void {
    this.running = false
  }

  private async initializePrices(): Promise<void> {
    for (const oracle of this.config.oracleAddresses) {
      try {
        const [roundData, decimals] = await Promise.all([
          this.client.readContract({
            address: oracle,
            abi: CHAINLINK_AGGREGATOR_ABI,
            functionName: 'latestRoundData',
          }),
          this.client.readContract({
            address: oracle,
            abi: CHAINLINK_AGGREGATOR_ABI,
            functionName: 'decimals',
          }),
        ])

        this.lastPrices.set(oracle, { price: roundData[1], decimals })
      } catch (_error) {
        console.warn(`Failed to initialize price for oracle ${oracle}`)
      }
    }
  }

  private watchOracles(): void {
    for (const oracle of this.config.oracleAddresses) {
      this.client.watchContractEvent({
        address: oracle,
        abi: CHAINLINK_AGGREGATOR_ABI,
        eventName: 'AnswerUpdated',
        onLogs: (logs) => {
          for (const log of logs) {
            this.onOracleUpdate(oracle, log)
          }
        },
      })
    }
  }

  private async onOracleUpdate(
    oracle: Address,
    log: {
      args: AnswerUpdatedArgs
      transactionHash: Hash
      blockNumber: bigint
    },
  ): Promise<void> {
    if (!this.running) return

    const { current: newPrice } = log.args
    const lastData = this.lastPrices.get(oracle)
    const oldPrice = lastData?.price ?? newPrice
    const decimals = lastData?.decimals ?? 8

    const priceDelta = Number(newPrice - oldPrice) / Number(oldPrice)

    let asset = 'UNKNOWN'
    try {
      asset = await this.client.readContract({
        address: oracle,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: 'description',
      })
    } catch {
      // Ignore
    }

    const update: OracleUpdate = {
      oracle,
      oldPrice,
      newPrice,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      asset,
      decimals,
    }

    this.lastPrices.set(oracle, { price: newPrice, decimals })
    this.recentUpdates.push(update)
    if (this.recentUpdates.length > 100) {
      this.recentUpdates.shift()
    }

    console.log(`📊 Oracle update: ${asset} ${(priceDelta * 100).toFixed(3)}%`)

    // Check if price move is significant
    if (Math.abs(priceDelta) < 0.002) return // 0.2% minimum

    const opportunity = await this.findOpportunity(update, priceDelta)
    if (
      opportunity &&
      opportunity.expectedProfitUsd >= this.config.minProfitUsd
    ) {
      const result = await this.execute(opportunity)
      this.emit('execution', { opportunity, result })
    }
  }

  private async findOpportunity(
    update: OracleUpdate,
    priceDelta: number,
  ): Promise<OracleArbOpportunity | null> {
    const direction = priceDelta > 0 ? 'long' : 'short'
    const tokens = TOKENS[this.config.chainId]
    if (!tokens) return null

    // DEX prices lag oracle by 20-50% of the move typically
    const expectedLag = Math.abs(priceDelta) * 0.3

    // Map oracle asset to tokens
    const isEthOracle = update.asset.includes('ETH')
    const isBtcOracle = update.asset.includes('BTC')

    let tokenIn: Address
    let tokenOut: Address

    if (isEthOracle) {
      tokenIn = direction === 'long' ? tokens.USDC : tokens.WETH
      tokenOut = direction === 'long' ? tokens.WETH : tokens.USDC
    } else if (isBtcOracle && tokens.WBTC) {
      tokenIn = direction === 'long' ? tokens.USDC : tokens.WBTC
      tokenOut = direction === 'long' ? tokens.WBTC : tokens.USDC
    } else {
      return null
    }

    // Calculate trade size (start conservative)
    const tradeSize = parseEther('0.1') // 0.1 ETH equivalent

    // Get quote from router
    const router = this.config.dexRouters[0]
    const path = [tokenIn, tokenOut]

    let amountOut: bigint
    try {
      const amounts = await this.client.readContract({
        address: router,
        abi: UNISWAP_ROUTER_ABI,
        functionName: 'getAmountsOut',
        args: [tradeSize, path],
      })
      amountOut = amounts[amounts.length - 1]
    } catch {
      return null
    }

    // Calculate expected profit
    const _expectedProfitBps = Math.floor(expectedLag * 10000)
    const minAmountOut =
      (amountOut * BigInt(10000 - this.config.maxSlippageBps)) / 10000n

    // Estimate gas (swap + some buffer)
    const gasEstimate = 200000n

    // Calculate profit in USD
    const priceUsd = Number(update.newPrice) / 10 ** update.decimals
    const expectedProfitUsd =
      (Number(tradeSize) / 1e18) * priceUsd * expectedLag

    if (expectedProfitUsd < this.config.minProfitUsd) {
      return null
    }

    return {
      oracle: update.oracle,
      asset: update.asset,
      priceDelta,
      direction,
      expectedProfitUsd,
      router,
      path,
      amountIn: tradeSize,
      minAmountOut,
      gasEstimate,
    }
  }

  private async execute(
    opportunity: OracleArbOpportunity,
  ): Promise<ExecutionResult> {
    this.executionStats.attempts++
    console.log(
      `📊 Oracle arb: ${opportunity.direction} ${opportunity.asset}, ${opportunity.expectedProfitUsd.toFixed(2)} USD expected`,
    )

    const [account] = await this.wallet.getAddresses()
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 120)

    // Check gas price
    const gasPrice = await this.client.getGasPrice()
    if (gasPrice > this.config.maxGasPrice) {
      return { success: false, error: 'Gas price too high' }
    }

    try {
      // 1. Simulate the trade first
      const simulationResult = await this.client.simulateContract({
        address: opportunity.router,
        abi: UNISWAP_ROUTER_ABI,
        functionName: 'swapExactTokensForTokens',
        args: [
          opportunity.amountIn,
          opportunity.minAmountOut,
          opportunity.path,
          account,
          deadline,
        ],
        account,
      })

      // 2. Check if simulation shows profit
      const actualOutput =
        simulationResult.result[simulationResult.result.length - 1]
      if (actualOutput < opportunity.minAmountOut) {
        return { success: false, error: 'Simulation shows insufficient output' }
      }

      // 3. Execute the trade
      let txHash: Hash

      if (this.config.useFlashbots && this.config.flashbotsRpc) {
        // Submit via Flashbots for frontrunning protection
        txHash = await this.submitViaFlashbots(opportunity, account, deadline)
      } else {
        // Direct submission
        txHash = await this.wallet.writeContract({
          address: opportunity.router,
          abi: UNISWAP_ROUTER_ABI,
          functionName: 'swapExactTokensForTokens',
          args: [
            opportunity.amountIn,
            opportunity.minAmountOut,
            opportunity.path,
            account,
            deadline,
          ],
          account,
          chain: null,
          gas: opportunity.gasEstimate,
        })
      }

      // 4. Wait for confirmation
      const receipt = await this.client.waitForTransactionReceipt({
        hash: txHash,
      })

      if (receipt.status === 'success') {
        this.executionStats.successes++
        const profit = actualOutput - opportunity.amountIn
        this.executionStats.totalProfit += profit
        this.executionStats.totalGas += receipt.gasUsed

        console.log(`✅ Oracle arb executed: ${txHash}`)
        console.log(`   Profit: ${Number(profit) / 1e18} tokens`)

        return {
          success: true,
          txHash,
          profit,
          gasUsed: receipt.gasUsed,
        }
      } else {
        return { success: false, txHash, error: 'Transaction reverted' }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error(`Oracle arb failed: ${errorMsg}`)
      return { success: false, error: errorMsg }
    }
  }

  private async submitViaFlashbots(
    opportunity: OracleArbOpportunity,
    account: Address,
    deadline: bigint,
  ): Promise<Hash> {
    // Build the transaction
    const callData = encodeFunctionData({
      abi: UNISWAP_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        opportunity.amountIn,
        opportunity.minAmountOut,
        opportunity.path,
        account,
        deadline,
      ],
    })

    // Sign and submit to Flashbots
    const signedTx = await this.wallet.signTransaction({
      to: opportunity.router,
      data: callData,
      gas: opportunity.gasEstimate,
      account,
      chain: null,
    })

    const response = await fetch(
      this.config.flashbotsRpc ?? 'https://protect.flashbots.net',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_sendRawTransaction',
          params: [signedTx],
          id: 1,
        }),
      },
    )

    const result = RpcSendTxResponseSchema.parse(await response.json())
    if (result.error) {
      throw new Error(result.error.message)
    }
    if (!result.result) {
      throw new Error('No transaction hash in response')
    }
    return result.result as Hash
  }

  getStats(): {
    recentUpdates: number
    trackedOracles: number
    attempts: number
    successes: number
    successRate: number
    totalProfit: bigint
    totalGas: bigint
  } {
    return {
      recentUpdates: this.recentUpdates.length,
      trackedOracles: this.config.oracleAddresses.length,
      ...this.executionStats,
      successRate:
        this.executionStats.attempts > 0
          ? this.executionStats.successes / this.executionStats.attempts
          : 0,
    }
  }
}
