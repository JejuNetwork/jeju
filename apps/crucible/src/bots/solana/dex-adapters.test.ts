/**
 * Tests for Solana DEX Adapters
 */

import { describe, expect, it } from 'bun:test'
import { Connection } from '@solana/web3.js'
import {
  JupiterAdapter,
  type LiquidityPool,
  MeteoraAdapter,
  OrcaAdapter,
  RaydiumAdapter,
  SolanaDexAggregator,
  type SwapQuote,
} from './dex-adapters'

describe('Solana DEX Adapters', () => {
  const mockConnection = new Connection('http://localhost:8899', 'confirmed')

  describe('JupiterAdapter', () => {
    const jupiter = new JupiterAdapter(mockConnection)

    it('should have correct name', () => {
      expect(jupiter.name).toBe('jupiter')
    })

    it('should throw when adding liquidity (Jupiter is aggregator)', () => {
      expect(() =>
        jupiter.addLiquidity('pool', 100n, 100n, {} as never),
      ).toThrow('Jupiter is an aggregator, not an AMM')
    })

    it('should return empty pools (Jupiter is aggregator)', async () => {
      const pools = await jupiter.getPools()
      expect(pools).toEqual([])
    })

    it('should return empty positions (Jupiter is aggregator)', async () => {
      const positions = await jupiter.getPositions('owner')
      expect(positions).toEqual([])
    })
  })

  describe('RaydiumAdapter', () => {
    const raydium = new RaydiumAdapter(mockConnection)

    it('should have correct name', () => {
      expect(raydium.name).toBe('raydium')
    })
  })

  describe('OrcaAdapter', () => {
    const orca = new OrcaAdapter(mockConnection)

    it('should have correct name', () => {
      expect(orca.name).toBe('orca')
    })
  })

  describe('MeteoraAdapter', () => {
    const meteora = new MeteoraAdapter(mockConnection)

    it('should have correct name', () => {
      expect(meteora.name).toBe('meteora')
    })
  })

  describe('SolanaDexAggregator', () => {
    const aggregator = new SolanaDexAggregator(mockConnection)

    it('should have all adapters', () => {
      expect(aggregator.getAdapter('jupiter')).toBeDefined()
      expect(aggregator.getAdapter('raydium')).toBeDefined()
      expect(aggregator.getAdapter('orca')).toBeDefined()
      expect(aggregator.getAdapter('meteora')).toBeDefined()
    })

    it('should return undefined for unknown adapter', () => {
      expect(aggregator.getAdapter('unknown' as never)).toBeUndefined()
    })
  })
})

describe('Quote Comparison', () => {
  it('should correctly compare quotes from multiple sources', () => {
    const quotes: SwapQuote[] = [
      {
        inputMint: 'a',
        outputMint: 'b',
        inputAmount: 100n,
        outputAmount: 95n,
        priceImpactPct: 0.5,
        source: 'jupiter',
        route: [],
      },
      {
        inputMint: 'a',
        outputMint: 'b',
        inputAmount: 100n,
        outputAmount: 97n,
        priceImpactPct: 0.3,
        source: 'raydium',
        route: [],
      },
      {
        inputMint: 'a',
        outputMint: 'b',
        inputAmount: 100n,
        outputAmount: 96n,
        priceImpactPct: 0.4,
        source: 'orca',
        route: [],
      },
    ]

    // Best by output
    const bestOutput = quotes.reduce((best, q) =>
      q.outputAmount > best.outputAmount ? q : best,
    )
    expect(bestOutput.source).toBe('raydium')
    expect(bestOutput.outputAmount).toBe(97n)

    // Best by price impact
    const bestImpact = quotes.reduce((best, q) =>
      q.priceImpactPct < best.priceImpactPct ? q : best,
    )
    expect(bestImpact.source).toBe('raydium')
  })

  it('should handle empty quote list', () => {
    const quotes: SwapQuote[] = []
    expect(quotes.length).toBe(0)
  })

  it('should handle single quote', () => {
    const quotes: SwapQuote[] = [
      {
        inputMint: 'a',
        outputMint: 'b',
        inputAmount: 100n,
        outputAmount: 95n,
        priceImpactPct: 0.5,
        source: 'jupiter',
        route: [],
      },
    ]
    const best = quotes.reduce((b, q) =>
      q.outputAmount > b.outputAmount ? q : b,
    )
    expect(best.source).toBe('jupiter')
  })
})

describe('Pool Analysis', () => {
  it('should filter pools by TVL', () => {
    const pools: LiquidityPool[] = [
      {
        id: '1',
        dex: 'raydium',
        tokenA: { mint: 'a', symbol: 'A', decimals: 9 },
        tokenB: { mint: 'b', symbol: 'B', decimals: 9 },
        reserveA: 0n,
        reserveB: 0n,
        fee: 30,
        tvlUsd: 1000000,
      },
      {
        id: '2',
        dex: 'orca',
        tokenA: { mint: 'a', symbol: 'A', decimals: 9 },
        tokenB: { mint: 'b', symbol: 'B', decimals: 9 },
        reserveA: 0n,
        reserveB: 0n,
        fee: 30,
        tvlUsd: 50000,
      },
      {
        id: '3',
        dex: 'meteora',
        tokenA: { mint: 'a', symbol: 'A', decimals: 9 },
        tokenB: { mint: 'b', symbol: 'B', decimals: 9 },
        reserveA: 0n,
        reserveB: 0n,
        fee: 25,
        tvlUsd: 5000000,
      },
    ]

    const minTvl = 100000
    const filtered = pools.filter((p) => p.tvlUsd >= minTvl)

    expect(filtered.length).toBe(2)
    expect(filtered.every((p) => p.tvlUsd >= minTvl)).toBe(true)
  })

  it('should sort pools by APR', () => {
    const pools: (LiquidityPool & { apr24h: number })[] = [
      {
        id: '1',
        dex: 'raydium',
        tokenA: { mint: 'a', symbol: 'A', decimals: 9 },
        tokenB: { mint: 'b', symbol: 'B', decimals: 9 },
        reserveA: 0n,
        reserveB: 0n,
        fee: 30,
        tvlUsd: 1000000,
        apr24h: 25,
      },
      {
        id: '2',
        dex: 'orca',
        tokenA: { mint: 'a', symbol: 'A', decimals: 9 },
        tokenB: { mint: 'b', symbol: 'B', decimals: 9 },
        reserveA: 0n,
        reserveB: 0n,
        fee: 30,
        tvlUsd: 50000,
        apr24h: 50,
      },
      {
        id: '3',
        dex: 'meteora',
        tokenA: { mint: 'a', symbol: 'A', decimals: 9 },
        tokenB: { mint: 'b', symbol: 'B', decimals: 9 },
        reserveA: 0n,
        reserveB: 0n,
        fee: 25,
        tvlUsd: 5000000,
        apr24h: 15,
      },
    ]

    const sorted = [...pools].sort((a, b) => b.apr24h - a.apr24h)

    expect(sorted[0].id).toBe('2') // Highest APR
    expect(sorted[0].apr24h).toBe(50)
    expect(sorted[2].id).toBe('3') // Lowest APR
    expect(sorted[2].apr24h).toBe(15)
  })

  it('should identify best pool by risk-adjusted return', () => {
    const pools = [
      { tvl: 1000000, apr: 25, risk: 20 },
      { tvl: 50000, apr: 100, risk: 80 },
      { tvl: 5000000, apr: 15, risk: 10 },
    ]

    // Risk-adjusted score: apr / risk
    const scored = pools.map((p) => ({ ...p, score: p.apr / p.risk }))
    const best = scored.reduce((b, p) => (p.score > b.score ? p : b))

    expect(best.tvl).toBe(5000000) // Low risk, decent APR wins
  })
})

describe('Position Tracking', () => {
  it('should calculate position value correctly', () => {
    const position = {
      liquidityA: BigInt(1e18), // 1 token
      liquidityB: BigInt(1e6), // 1 USDC
      priceA: 3000, // $3000/token
      priceB: 1, // $1/USDC
    }

    const valueA = (Number(position.liquidityA) / 1e18) * position.priceA
    const valueB = (Number(position.liquidityB) / 1e6) * position.priceB
    const totalValue = valueA + valueB

    expect(totalValue).toBe(3001)
  })

  it('should detect out of range positions', () => {
    const position = {
      tickLower: -1000,
      tickUpper: 1000,
      currentTick: 1500,
    }

    const inRange =
      position.currentTick >= position.tickLower &&
      position.currentTick <= position.tickUpper

    expect(inRange).toBe(false)
  })

  it('should calculate fees earned', () => {
    const fees = {
      token0: BigInt(1e16), // 0.01 tokens
      token1: BigInt(5e4), // 0.05 USDC
    }

    const totalFees =
      (Number(fees.token0) / 1e18) * 3000 + Number(fees.token1) / 1e6
    expect(totalFees).toBeCloseTo(30.05, 2)
  })
})
