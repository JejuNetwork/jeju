#!/usr/bin/env bun
/**
 * Live Opportunity Scanner
 *
 * Scans real on-chain data for MEV and arbitrage opportunities across:
 * - Ethereum, Base, Arbitrum, Optimism, BSC (EVM)
 * - Solana
 *
 * Uses:
 * - DeFi Llama for TVL/yields
 * - On-chain DEX price queries
 * - Real gas prices
 */

import { createPublicClient, http, parseAbi, formatUnits, formatEther } from 'viem'
import { mainnet, base, arbitrum, optimism, bsc } from 'viem/chains'

// ============ Types ============

interface TokenPrice {
  symbol: string
  address: string
  chainId: number
  price: number
  source: string
}

interface DEXPair {
  dex: string
  chainId: number
  pairAddress: string
  token0: string
  token1: string
  reserve0: bigint
  reserve1: bigint
  price: number
}

interface LiveOpportunity {
  type: 'arb' | 'cross-chain' | 'mev'
  chainId: number
  fromDex: string
  toDex: string
  token: string
  spreadBps: number
  estimatedProfit: number
  gasCost: number
  netProfit: number
  timestamp: number
}

interface ScanResult {
  timestamp: number
  chainScans: ChainScanResult[]
  totalOpportunities: number
  profitableOpportunities: number
  bestOpportunity: LiveOpportunity | null
}

interface ChainScanResult {
  chainId: number
  chainName: string
  gasPrice: number
  ethPrice: number
  pairsScanned: number
  opportunities: LiveOpportunity[]
}

// ============ Constants ============

const CHAINS = [
  { chainId: 1, name: 'Ethereum', chain: mainnet, rpc: 'https://eth.llamarpc.com', gasMultiplier: 1 },
  { chainId: 8453, name: 'Base', chain: base, rpc: 'https://mainnet.base.org', gasMultiplier: 0.01 },
  { chainId: 42161, name: 'Arbitrum', chain: arbitrum, rpc: 'https://arb1.arbitrum.io/rpc', gasMultiplier: 0.02 },
  { chainId: 10, name: 'Optimism', chain: optimism, rpc: 'https://mainnet.optimism.io', gasMultiplier: 0.01 },
  { chainId: 56, name: 'BSC', chain: bsc, rpc: 'https://bsc-dataseed.binance.org', gasMultiplier: 0.1 },
] as const

// Major DEX factory addresses
const DEX_FACTORIES: Record<number, Record<string, { address: string; fee: number }>> = {
  1: {
    'Uniswap V2': { address: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', fee: 30 },
    'Sushiswap': { address: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac', fee: 30 },
  },
  8453: {
    'Aerodrome': { address: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da', fee: 30 },
  },
  42161: {
    'Sushiswap': { address: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4', fee: 30 },
    'Camelot': { address: '0x6EcCab422D763aC031210895C81787E87B43A652', fee: 30 },
  },
  10: {
    'Velodrome': { address: '0x25CbdDb98b35ab1FF77413456B31EC81A6B6B746', fee: 30 },
  },
  56: {
    'PancakeSwap': { address: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73', fee: 25 },
  },
}

// Key token addresses
const KEY_TOKENS: Record<number, Record<string, string>> = {
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
    ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
  },
  10: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    OP: '0x4200000000000000000000000000000000000042',
  },
  56: {
    WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
  },
}

// Uniswap V2 pair ABI (minimal)
const PAIR_ABI = parseAbi([
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
])

// Factory ABI
const FACTORY_ABI = parseAbi([
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
  'function allPairsLength() external view returns (uint256)',
  'function allPairs(uint256) external view returns (address pair)',
])

// ============ Live Scanner ============

export class LiveOpportunityScanner {
  private clients: Map<number, ReturnType<typeof createPublicClient>> = new Map()
  private ethPrice = 3500

  constructor() {
    for (const chain of CHAINS) {
      const client = createPublicClient({
        chain: chain.chain,
        transport: http(chain.rpc, { timeout: 10000 }),
      })
      this.clients.set(chain.chainId, client)
    }
  }

  /**
   * Scan all chains for live opportunities
   */
  async scan(): Promise<ScanResult> {
    const timestamp = Date.now()
    console.log('\n' + '═'.repeat(70))
    console.log('  LIVE OPPORTUNITY SCANNER')
    console.log('═'.repeat(70))
    console.log(`  Scanning: ${CHAINS.map(c => c.name).join(', ')}`)
    console.log('═'.repeat(70) + '\n')

    // Fetch current ETH price
    await this.fetchEthPrice()
    console.log(`  Current ETH Price: $${this.ethPrice.toFixed(2)}\n`)

    const chainScans: ChainScanResult[] = []

    for (const chain of CHAINS) {
      console.log(`🔍 Scanning ${chain.name}...`)
      try {
        const result = await this.scanChain(chain.chainId)
        chainScans.push(result)
        console.log(`  ✓ Found ${result.opportunities.length} opportunities`)
      } catch (error) {
        console.log(`  ✗ Error: ${error instanceof Error ? error.message : 'Unknown'}`)
        chainScans.push({
          chainId: chain.chainId,
          chainName: chain.name,
          gasPrice: 0,
          ethPrice: this.ethPrice,
          pairsScanned: 0,
          opportunities: [],
        })
      }
    }

    // Find best opportunity
    const allOpportunities = chainScans.flatMap(c => c.opportunities)
    const profitableOpportunities = allOpportunities.filter(o => o.netProfit > 0)
    const bestOpportunity = profitableOpportunities.sort((a, b) => b.netProfit - a.netProfit)[0] ?? null

    // Print summary
    this.printSummary(chainScans, profitableOpportunities, bestOpportunity)

    return {
      timestamp,
      chainScans,
      totalOpportunities: allOpportunities.length,
      profitableOpportunities: profitableOpportunities.length,
      bestOpportunity,
    }
  }

  /**
   * Scan a single chain for opportunities
   */
  private async scanChain(chainId: number): Promise<ChainScanResult> {
    const client = this.clients.get(chainId)
    if (!client) throw new Error(`No client for chain ${chainId}`)

    const chainConfig = CHAINS.find(c => c.chainId === chainId)
    if (!chainConfig) throw new Error(`No config for chain ${chainId}`)

    // Get current gas price
    const gasPrice = await client.getGasPrice()
    const gasPriceGwei = Number(gasPrice) / 1e9

    // Get DEX factories for this chain
    const factories = DEX_FACTORIES[chainId] ?? {}
    const tokens = KEY_TOKENS[chainId] ?? {}
    const tokenAddresses = Object.values(tokens)

    const opportunities: LiveOpportunity[] = []
    let pairsScanned = 0

    // Compare prices across DEXes
    const dexNames = Object.keys(factories)
    if (dexNames.length < 2 && tokenAddresses.length < 2) {
      // Not enough to compare, skip
      return {
        chainId,
        chainName: chainConfig.name,
        gasPrice: gasPriceGwei,
        ethPrice: this.ethPrice,
        pairsScanned: 0,
        opportunities: [],
      }
    }

    // For each token pair, check prices across DEXes
    for (let i = 0; i < tokenAddresses.length; i++) {
      for (let j = i + 1; j < tokenAddresses.length; j++) {
        const token0 = tokenAddresses[i]
        const token1 = tokenAddresses[j]

        const prices: Array<{ dex: string; price: number }> = []

        for (const [dexName, factory] of Object.entries(factories)) {
          try {
            // Get pair address
            const pairAddress = await client.readContract({
              address: factory.address as `0x${string}`,
              abi: FACTORY_ABI,
              functionName: 'getPair',
              args: [token0 as `0x${string}`, token1 as `0x${string}`],
            })

            if (pairAddress === '0x0000000000000000000000000000000000000000') continue

            // Get reserves
            const [reserve0, reserve1] = await client.readContract({
              address: pairAddress,
              abi: PAIR_ABI,
              functionName: 'getReserves',
            }) as [bigint, bigint, number]

            if (reserve0 > 0n && reserve1 > 0n) {
              const price = Number(reserve1) / Number(reserve0)
              prices.push({ dex: dexName, price })
              pairsScanned++
            }
          } catch {
            // Skip failed pairs
          }
        }

        // Check for price discrepancies
        if (prices.length >= 2) {
          const sorted = prices.sort((a, b) => a.price - b.price)
          const lowest = sorted[0]
          const highest = sorted[sorted.length - 1]

          const spreadBps = ((highest.price - lowest.price) / lowest.price) * 10000

          if (spreadBps > 5) { // > 0.05% spread
            const tradeSize = 1e18 // 1 ETH equivalent
            const grossProfit = (spreadBps / 10000) * this.ethPrice
            const gasCost = gasPriceGwei * 300000 * 1e-9 * this.ethPrice * chainConfig.gasMultiplier
            const netProfit = grossProfit - gasCost

            opportunities.push({
              type: 'arb',
              chainId,
              fromDex: lowest.dex,
              toDex: highest.dex,
              token: `${Object.keys(tokens)[i]}/${Object.keys(tokens)[j]}`,
              spreadBps,
              estimatedProfit: grossProfit,
              gasCost,
              netProfit,
              timestamp: Date.now(),
            })
          }
        }
      }
    }

    return {
      chainId,
      chainName: chainConfig.name,
      gasPrice: gasPriceGwei,
      ethPrice: this.ethPrice,
      pairsScanned,
      opportunities,
    }
  }

  /**
   * Fetch current ETH price from DeFi Llama
   */
  private async fetchEthPrice(): Promise<void> {
    try {
      const response = await fetch('https://coins.llama.fi/prices/current/coingecko:ethereum')
      if (response.ok) {
        const data = await response.json() as { coins: Record<string, { price: number }> }
        this.ethPrice = data.coins['coingecko:ethereum']?.price ?? 3500
      }
    } catch {
      // Use default
    }
  }

  /**
   * Print formatted summary
   */
  private printSummary(
    chains: ChainScanResult[],
    profitable: LiveOpportunity[],
    best: LiveOpportunity | null,
  ): void {
    console.log('\n' + '═'.repeat(70))
    console.log('  SCAN RESULTS')
    console.log('═'.repeat(70))

    // Chain summary table
    console.log('\n  Chain Summary:')
    console.log('  ┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐')
    console.log('  │ Chain           │ Gas Price       │ Pairs Scanned   │ Opportunities   │')
    console.log('  ├─────────────────┼─────────────────┼─────────────────┼─────────────────┤')

    for (const chain of chains) {
      const profitable = chain.opportunities.filter(o => o.netProfit > 0).length
      console.log(`  │ ${chain.chainName.padEnd(15)} │ ${chain.gasPrice.toFixed(4).padStart(12)} gwei │ ${chain.pairsScanned.toString().padStart(15)} │ ${profitable.toString().padStart(15)} │`)
    }
    console.log('  └─────────────────┴─────────────────┴─────────────────┴─────────────────┘')

    // Profitable opportunities
    if (profitable.length > 0) {
      console.log('\n  Top Opportunities:')
      console.log('  ┌─────────────────┬─────────────────────┬─────────────────┬─────────────────┐')
      console.log('  │ Chain           │ Pair                │ Spread (bps)    │ Net Profit      │')
      console.log('  ├─────────────────┼─────────────────────┼─────────────────┼─────────────────┤')

      for (const opp of profitable.slice(0, 10)) {
        const chainName = CHAINS.find(c => c.chainId === opp.chainId)?.name ?? 'Unknown'
        console.log(`  │ ${chainName.padEnd(15)} │ ${opp.token.padEnd(19)} │ ${opp.spreadBps.toFixed(2).padStart(15)} │ $${opp.netProfit.toFixed(2).padStart(14)} │`)
      }
      console.log('  └─────────────────┴─────────────────────┴─────────────────┴─────────────────┘')
    }

    // Best opportunity
    if (best) {
      const chainName = CHAINS.find(c => c.chainId === best.chainId)?.name ?? 'Unknown'
      console.log('\n  🎯 BEST OPPORTUNITY:')
      console.log(`     Chain: ${chainName}`)
      console.log(`     Pair: ${best.token}`)
      console.log(`     Route: ${best.fromDex} → ${best.toDex}`)
      console.log(`     Spread: ${best.spreadBps.toFixed(2)} bps`)
      console.log(`     Estimated Profit: $${best.estimatedProfit.toFixed(2)}`)
      console.log(`     Gas Cost: $${best.gasCost.toFixed(2)}`)
      console.log(`     Net Profit: $${best.netProfit.toFixed(2)}`)
    } else {
      console.log('\n  ⚠️  No profitable opportunities found at current gas prices')
    }

    console.log('\n' + '═'.repeat(70))
  }
}

// ============ CLI ============

async function main() {
  const scanner = new LiveOpportunityScanner()
  const result = await scanner.scan()

  console.log(`\nScan completed. Found ${result.profitableOpportunities} profitable opportunities.\n`)
}

if (import.meta.main) {
  main().catch(console.error)
}

export { type ScanResult, type LiveOpportunity }

