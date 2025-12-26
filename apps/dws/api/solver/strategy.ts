import { readContract } from '@jejunetwork/contracts'
import {
  type Address,
  type Chain,
  createPublicClient,
  http,
  type PublicClient,
} from 'viem'
import { arbitrum, mainnet, optimism, sepolia } from 'viem/chains'
import { z } from 'zod'

const CoinGeckoResponseSchema = z.object({
  ethereum: z.object({ usd: z.number() }),
})

interface StrategyConfig {
  minProfitBps: number
  maxGasPrice: bigint
  maxIntentSize: string
}

interface IntentEvaluation {
  orderId: string
  sourceChain: number
  destinationChain: number
  inputToken: string
  inputAmount: string
  outputToken: string
  outputAmount: string
}

interface EvaluationResult {
  profitable: boolean
  expectedProfitBps: number
  reason?: string
  gasEstimate?: bigint
}

const CHAINLINK_ETH_USD: Record<number, Address> = {
  1: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  42161: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
  10: '0x13e3Ee699D1909E989722E753853AE30b17e08c5',
}

const AGGREGATOR_ABI = [
  {
    type: 'function',
    name: 'latestRoundData',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  },
] as const

const CHAINS: [number, Chain, string][] = [
  [1, mainnet, 'MAINNET'],
  [42161, arbitrum, 'ARBITRUM'],
  [10, optimism, 'OPTIMISM'],
  [11155111, sepolia, 'SEPOLIA'],
]

const FILL_GAS = 150_000n
const PRICE_STALE_MS = 5 * 60 * 1000
const COINGECKO_RATE_LIMIT_BACKOFF_MS = 60_000 // Wait 1 min after 429

export class StrategyEngine {
  private config: StrategyConfig
  private clients = new Map<number, PublicClient>()
  private ethPriceUsd: number | null = null
  private priceUpdatedAt = 0
  private lastCoinGecko429At = 0

  constructor(config: StrategyConfig) {
    this.config = config
    this.initClients()
    this.refreshPrices()
    setInterval(() => this.refreshPrices(), 60_000)
  }

  private initClients(): void {
    for (const [id, chain, envPrefix] of CHAINS) {
      const rpc = process.env[`${envPrefix}_RPC_URL`]
      if (rpc) {
        this.clients.set(
          id,
          createPublicClient({ chain, transport: http(rpc) }) as PublicClient,
        )
      }
    }
  }

  private async refreshPrices(): Promise<void> {
    // Try Chainlink first (most reliable)
    const client = this.clients.get(1)
    if (client) {
      const result = await readContract(client, {
        address: CHAINLINK_ETH_USD[1],
        abi: AGGREGATOR_ABI,
        functionName: 'latestRoundData',
      })
      if (result[1] > 0n) {
        this.ethPriceUsd = Number(result[1]) / 1e8
        this.priceUpdatedAt = Date.now()
        return
      }
    }

    // Skip CoinGecko if we were rate-limited recently
    const now = Date.now()
    if (now - this.lastCoinGecko429At < COINGECKO_RATE_LIMIT_BACKOFF_MS) {
      return
    }

    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      {
        signal: AbortSignal.timeout(5000),
      },
    )

    if (res.ok) {
      const rawData: unknown = await res.json()
      const parsed = CoinGeckoResponseSchema.parse(rawData)
      this.ethPriceUsd = parsed.ethereum.usd
      this.priceUpdatedAt = now
    } else if (res.status === 429) {
      this.lastCoinGecko429At = now
      console.warn(
        `[strategy] CoinGecko rate limited, backing off for ${COINGECKO_RATE_LIMIT_BACKOFF_MS / 1000}s`,
      )
    } else {
      throw new Error(`CoinGecko returned ${res.status}`)
    }
  }

  async evaluate(intent: IntentEvaluation): Promise<EvaluationResult> {
    if (this.isPriceStale()) {
      console.warn('[Strategy] ETH price stale, refreshing')
      await this.refreshPrices()
    }

    if (this.ethPriceUsd === null) {
      return {
        profitable: false,
        expectedProfitBps: 0,
        reason: 'Price feed unavailable',
      }
    }

    if (BigInt(intent.inputAmount) > BigInt(this.config.maxIntentSize)) {
      return {
        profitable: false,
        expectedProfitBps: 0,
        reason: 'Exceeds max size',
      }
    }

    const input = BigInt(intent.inputAmount)
    const output = BigInt(intent.outputAmount)
    const fee = input - output
    if (fee <= 0n)
      return { profitable: false, expectedProfitBps: 0, reason: 'No fee' }

    const client = this.clients.get(intent.destinationChain)
    const gasPrice = client
      ? await client.getGasPrice()
      : this.config.maxGasPrice
    if (gasPrice > this.config.maxGasPrice) {
      return { profitable: false, expectedProfitBps: 0, reason: 'Gas too high' }
    }

    const gasCost = FILL_GAS * gasPrice
    const netProfit = fee - gasCost
    if (netProfit <= 0n) {
      return {
        profitable: false,
        expectedProfitBps: 0,
        reason: 'Gas exceeds fee',
        gasEstimate: gasCost,
      }
    }

    const profitBps = Number((netProfit * 10000n) / input)
    if (profitBps < this.config.minProfitBps) {
      return {
        profitable: false,
        expectedProfitBps: profitBps,
        reason: `${profitBps} bps < min ${this.config.minProfitBps}`,
        gasEstimate: gasCost,
      }
    }

    return {
      profitable: true,
      expectedProfitBps: profitBps,
      gasEstimate: gasCost,
    }
  }

  getEthPrice(): number {
    if (this.ethPriceUsd === null) {
      throw new Error('ETH price not available')
    }
    return this.ethPriceUsd
  }

  isPriceStale(): boolean {
    if (this.ethPriceUsd === null) return true
    return Date.now() - this.priceUpdatedAt > PRICE_STALE_MS
  }
}
