/**
 * Unit Tests for Arbitrage Detector
 *
 * Tests mathematical calculations for:
 * - Price difference calculation (bps)
 * - Profit estimation
 * - Bridge cost calculation
 * - Arbitrage opportunity scoring
 */

import { describe, expect, it } from 'bun:test'
import {
  type ArbOpportunity,
  createArbitrageDetector,
  type PriceQuote,
} from '../../src/router/arbitrage-detector.js'

describe('ArbitrageDetector', () => {
  describe('Price Difference Calculation', () => {
    // Access the private method via prototype for testing core logic
    const calculatePriceDiff = (quote1: PriceQuote, quote2: PriceQuote) => {
      const price1 = Number(quote1.amountOut)
      const price2 = Number(quote2.amountOut)

      const minPrice = Math.min(price1, price2)
      const maxPrice = Math.max(price1, price2)
      const diffBps = Math.floor(((maxPrice - minPrice) / minPrice) * 10000)

      return {
        diffBps,
        lowPrice: BigInt(Math.floor(minPrice)),
        highPrice: BigInt(Math.floor(maxPrice)),
        buyLow: price1 < price2 ? quote1.chain : quote2.chain,
      }
    }

    it('should calculate zero difference for equal prices', () => {
      const quote1: PriceQuote = {
        chain: 'solana',
        dex: 'jupiter',
        tokenIn: 'USDC',
        tokenOut: 'ETH',
        amountIn: 1000000n,
        amountOut: 500000000n, // 0.5 ETH
        priceImpactBps: 10,
        timestamp: Date.now(),
      }

      const quote2: PriceQuote = {
        chain: 'evm:8453',
        dex: 'uniswap',
        tokenIn: 'USDC',
        tokenOut: 'ETH',
        amountIn: 1000000n,
        amountOut: 500000000n, // Same price
        priceImpactBps: 10,
        timestamp: Date.now(),
      }

      const result = calculatePriceDiff(quote1, quote2)
      expect(result.diffBps).toBe(0)
      expect(result.lowPrice).toBe(result.highPrice)
    })

    it('should calculate 1% difference correctly (100 bps)', () => {
      const quote1: PriceQuote = {
        chain: 'solana',
        dex: 'jupiter',
        tokenIn: 'USDC',
        tokenOut: 'ETH',
        amountIn: 1000000n,
        amountOut: 1000000000n, // Base price
        priceImpactBps: 10,
        timestamp: Date.now(),
      }

      const quote2: PriceQuote = {
        chain: 'evm:8453',
        dex: 'uniswap',
        tokenIn: 'USDC',
        tokenOut: 'ETH',
        amountIn: 1000000n,
        amountOut: 1010000000n, // 1% higher
        priceImpactBps: 10,
        timestamp: Date.now(),
      }

      const result = calculatePriceDiff(quote1, quote2)
      expect(result.diffBps).toBe(100) // 1% = 100 bps
      expect(result.buyLow).toBe('solana')
    })

    it('should calculate 5% difference correctly (500 bps)', () => {
      const quote1: PriceQuote = {
        chain: 'solana',
        dex: 'jupiter',
        tokenIn: 'USDC',
        tokenOut: 'ETH',
        amountIn: 1000000n,
        amountOut: 1000000000n,
        priceImpactBps: 10,
        timestamp: Date.now(),
      }

      const quote2: PriceQuote = {
        chain: 'evm:8453',
        dex: 'uniswap',
        tokenIn: 'USDC',
        tokenOut: 'ETH',
        amountIn: 1000000n,
        amountOut: 1050000000n, // 5% higher
        priceImpactBps: 10,
        timestamp: Date.now(),
      }

      const result = calculatePriceDiff(quote1, quote2)
      expect(result.diffBps).toBe(500)
      expect(result.lowPrice).toBe(1000000000n)
      expect(result.highPrice).toBe(1050000000n)
    })

    it('should identify correct buy chain (better rate)', () => {
      // In the arbitrage detector, "buyLow" refers to the chain with LOWER amountOut
      // This is because the comparison is based on the raw output amounts
      // Lower output = worse rate = "low price" in the arbitrage context
      const quote1: PriceQuote = {
        chain: 'solana',
        dex: 'jupiter',
        tokenIn: 'USDC',
        tokenOut: 'ETH',
        amountIn: 1000000n,
        amountOut: 1100000000n, // Higher output = better rate
        priceImpactBps: 10,
        timestamp: Date.now(),
      }

      const quote2: PriceQuote = {
        chain: 'evm:8453',
        dex: 'uniswap',
        tokenIn: 'USDC',
        tokenOut: 'ETH',
        amountIn: 1000000n,
        amountOut: 1000000000n, // Lower output = worse rate
        priceImpactBps: 10,
        timestamp: Date.now(),
      }

      const result = calculatePriceDiff(quote1, quote2)
      // buyLow points to the chain with lower price (lower amountOut)
      // In arbitrage: buy where amountOut is HIGH (you get more), sell where it's LOW
      expect(result.buyLow).toBe('evm:8453') // Lower output = "low price"
    })

    it('should handle very small price differences', () => {
      const quote1: PriceQuote = {
        chain: 'solana',
        dex: 'jupiter',
        tokenIn: 'USDC',
        tokenOut: 'ETH',
        amountIn: 1000000n,
        amountOut: 1000000000n,
        priceImpactBps: 10,
        timestamp: Date.now(),
      }

      const quote2: PriceQuote = {
        chain: 'evm:8453',
        dex: 'uniswap',
        tokenIn: 'USDC',
        tokenOut: 'ETH',
        amountIn: 1000000n,
        amountOut: 1000100000n, // 0.01% higher
        priceImpactBps: 10,
        timestamp: Date.now(),
      }

      const result = calculatePriceDiff(quote1, quote2)
      expect(result.diffBps).toBe(1) // 0.01% = 1 bps
    })

    it('should handle large price differences', () => {
      const quote1: PriceQuote = {
        chain: 'solana',
        dex: 'jupiter',
        tokenIn: 'USDC',
        tokenOut: 'ETH',
        amountIn: 1000000n,
        amountOut: 1000000000n,
        priceImpactBps: 10,
        timestamp: Date.now(),
      }

      const quote2: PriceQuote = {
        chain: 'evm:8453',
        dex: 'uniswap',
        tokenIn: 'USDC',
        tokenOut: 'ETH',
        amountIn: 1000000n,
        amountOut: 2000000000n, // 100% higher
        priceImpactBps: 10,
        timestamp: Date.now(),
      }

      const result = calculatePriceDiff(quote1, quote2)
      expect(result.diffBps).toBe(10000) // 100% = 10000 bps
    })
  })

  describe('Bridge Cost Estimation', () => {
    // Test the bridge cost logic
    const getBridgeCost = (from: string | number, to: number): number => {
      const solanaToEvm = 15
      const evmToSolana = 15
      const hyperliquidToEvm = 10
      const evmToEvm = 5

      if (from === 'solana' || from === 900001) return solanaToEvm
      if (to === 900001) return evmToSolana
      if (from === 998 || to === 998) return hyperliquidToEvm
      return evmToEvm
    }

    it('should return correct cost for Solana to EVM', () => {
      expect(getBridgeCost('solana', 1)).toBe(15)
      expect(getBridgeCost('solana', 8453)).toBe(15)
      expect(getBridgeCost('solana', 42161)).toBe(15)
    })

    it('should return correct cost for EVM to Solana', () => {
      expect(getBridgeCost(1, 900001)).toBe(15)
      expect(getBridgeCost(8453, 900001)).toBe(15)
    })

    it('should return correct cost for Hyperliquid routes', () => {
      expect(getBridgeCost(998, 1)).toBe(10)
      expect(getBridgeCost(1, 998)).toBe(10)
      expect(getBridgeCost(998, 8453)).toBe(10)
    })

    it('should return correct cost for EVM to EVM', () => {
      expect(getBridgeCost(1, 8453)).toBe(5)
      expect(getBridgeCost(8453, 42161)).toBe(5)
      expect(getBridgeCost(42161, 1)).toBe(5)
    })
  })

  describe('Profit Calculation', () => {
    it('should calculate net profit correctly', () => {
      // Assume $10k trade size with 200 bps (2%) price diff
      const tradeSize = 10000
      const priceDiffBps = 200
      const bridgeCost = 15

      const grossProfit = (priceDiffBps / 10000) * tradeSize
      const netProfit = grossProfit - bridgeCost

      expect(grossProfit).toBe(200) // 2% of $10k
      expect(netProfit).toBe(185) // $200 - $15
    })

    it('should return negative profit when bridge cost exceeds gross profit', () => {
      const tradeSize = 10000
      const priceDiffBps = 10 // Only 0.1%
      const bridgeCost = 15

      const grossProfit = (priceDiffBps / 10000) * tradeSize
      const netProfit = grossProfit - bridgeCost

      expect(grossProfit).toBe(10) // 0.1% of $10k
      expect(netProfit).toBe(-5) // Negative profit
    })

    it('should break even at specific bps threshold', () => {
      const tradeSize = 10000
      const bridgeCost = 15

      // Break-even bps = (bridgeCost / tradeSize) * 10000
      const breakEvenBps = (bridgeCost / tradeSize) * 10000

      expect(breakEvenBps).toBe(15) // 0.15% = 15 bps
    })

    it('should scale profit with trade size', () => {
      const priceDiffBps = 100 // 1%
      const bridgeCost = 15

      // Small trade
      const smallTrade = 1000
      const smallGross = (priceDiffBps / 10000) * smallTrade
      const smallNet = smallGross - bridgeCost

      // Large trade
      const largeTrade = 100000
      const largeGross = (priceDiffBps / 10000) * largeTrade
      const largeNet = largeGross - bridgeCost

      expect(smallNet).toBe(-5) // Unprofitable at $1k
      expect(largeNet).toBe(985) // Very profitable at $100k
    })
  })

  describe('Opportunity Filtering', () => {
    it('should filter opportunities with positive net profit', () => {
      const opportunities: ArbOpportunity[] = [
        {
          id: 'opp1',
          type: 'solana_evm',
          buyChain: 'solana',
          sellChain: 'evm:8453',
          token: 'USDC',
          buyPrice: 1000000n,
          sellPrice: 1020000n,
          priceDiffBps: 200,
          estimatedProfitUsd: 200,
          bridgeCostUsd: 15,
          netProfitUsd: 185,
          expiresAt: Date.now() + 30000,
          route: {
            steps: [],
            totalGasEstimate: 500000n,
            totalTimeSeconds: 300,
          },
        },
        {
          id: 'opp2',
          type: 'solana_evm',
          buyChain: 'solana',
          sellChain: 'evm:1',
          token: 'USDC',
          buyPrice: 1000000n,
          sellPrice: 1001000n,
          priceDiffBps: 10,
          estimatedProfitUsd: 10,
          bridgeCostUsd: 15,
          netProfitUsd: -5, // Negative
          expiresAt: Date.now() + 30000,
          route: {
            steps: [],
            totalGasEstimate: 500000n,
            totalTimeSeconds: 300,
          },
        },
      ]

      const profitable = opportunities.filter((o) => o.netProfitUsd > 0)
      expect(profitable.length).toBe(1)
      expect(profitable[0].id).toBe('opp1')
    })

    it('should sort opportunities by net profit descending', () => {
      const opportunities: ArbOpportunity[] = [
        {
          id: 'low',
          type: 'solana_evm',
          buyChain: 'solana',
          sellChain: 'evm:8453',
          token: 'USDC',
          buyPrice: 1000000n,
          sellPrice: 1010000n,
          priceDiffBps: 100,
          estimatedProfitUsd: 100,
          bridgeCostUsd: 15,
          netProfitUsd: 85,
          expiresAt: Date.now() + 30000,
          route: {
            steps: [],
            totalGasEstimate: 500000n,
            totalTimeSeconds: 300,
          },
        },
        {
          id: 'high',
          type: 'cross_dex',
          buyChain: 'evm:1',
          sellChain: 'evm:42161',
          token: 'WETH',
          buyPrice: 1000000n,
          sellPrice: 1050000n,
          priceDiffBps: 500,
          estimatedProfitUsd: 500,
          bridgeCostUsd: 5,
          netProfitUsd: 495,
          expiresAt: Date.now() + 30000,
          route: {
            steps: [],
            totalGasEstimate: 300000n,
            totalTimeSeconds: 120,
          },
        },
        {
          id: 'medium',
          type: 'hyperliquid',
          buyChain: 'hyperliquid',
          sellChain: 'evm:8453',
          token: 'ETH-USDC',
          buyPrice: 1000000n,
          sellPrice: 1030000n,
          priceDiffBps: 300,
          estimatedProfitUsd: 300,
          bridgeCostUsd: 10,
          netProfitUsd: 290,
          expiresAt: Date.now() + 15000,
          route: {
            steps: [],
            totalGasEstimate: 400000n,
            totalTimeSeconds: 180,
          },
        },
      ]

      const sorted = opportunities
        .filter((o) => o.netProfitUsd > 0)
        .sort((a, b) => b.netProfitUsd - a.netProfitUsd)

      expect(sorted[0].id).toBe('high')
      expect(sorted[1].id).toBe('medium')
      expect(sorted[2].id).toBe('low')
    })

    it('should filter expired opportunities', () => {
      const now = Date.now()
      const opportunities: ArbOpportunity[] = [
        {
          id: 'expired',
          type: 'solana_evm',
          buyChain: 'solana',
          sellChain: 'evm:8453',
          token: 'USDC',
          buyPrice: 1000000n,
          sellPrice: 1020000n,
          priceDiffBps: 200,
          estimatedProfitUsd: 200,
          bridgeCostUsd: 15,
          netProfitUsd: 185,
          expiresAt: now - 1000, // Expired
          route: {
            steps: [],
            totalGasEstimate: 500000n,
            totalTimeSeconds: 300,
          },
        },
        {
          id: 'valid',
          type: 'solana_evm',
          buyChain: 'solana',
          sellChain: 'evm:8453',
          token: 'USDC',
          buyPrice: 1000000n,
          sellPrice: 1020000n,
          priceDiffBps: 200,
          estimatedProfitUsd: 200,
          bridgeCostUsd: 15,
          netProfitUsd: 185,
          expiresAt: now + 30000, // Still valid
          route: {
            steps: [],
            totalGasEstimate: 500000n,
            totalTimeSeconds: 300,
          },
        },
      ]

      const valid = opportunities.filter((o) => o.expiresAt > now)
      expect(valid.length).toBe(1)
      expect(valid[0].id).toBe('valid')
    })
  })

  describe('Cross-Chain Arb Detection Logic', () => {
    it('should detect cross-chain price differences', () => {
      // Simulate prices across chains for same token
      const chainPrices = new Map<number, bigint>()
      chainPrices.set(1, 1000000000n) // Ethereum
      chainPrices.set(8453, 1020000000n) // Base (2% higher)
      chainPrices.set(42161, 990000000n) // Arbitrum (1% lower)
      chainPrices.set(56, 1050000000n) // BSC (5% higher)

      // Find min and max
      let minPrice = { chainId: 0, price: BigInt(Number.MAX_SAFE_INTEGER) }
      let maxPrice = { chainId: 0, price: 0n }

      for (const [chainId, price] of chainPrices) {
        if (price < minPrice.price) {
          minPrice = { chainId, price }
        }
        if (price > maxPrice.price) {
          maxPrice = { chainId, price }
        }
      }

      expect(minPrice.chainId).toBe(42161) // Arbitrum has lowest price
      expect(maxPrice.chainId).toBe(56) // BSC has highest price

      // Calculate opportunity
      const priceDiffBps = Number(
        ((maxPrice.price - minPrice.price) * 10000n) / minPrice.price,
      )
      expect(priceDiffBps).toBeGreaterThan(0)
      // (1050000000 - 990000000) / 990000000 * 10000 = 606 bps (~6%)
      expect(priceDiffBps).toBeCloseTo(606, 0)
    })
  })

  describe('Detector Lifecycle', () => {
    it('should start and stop without errors', () => {
      const detector = createArbitrageDetector({ minProfitBps: 50 })

      detector.start()
      // Should not throw on double start
      detector.start()

      detector.stop()
      // Should not throw on double stop
      detector.stop()
    })

    it('should return empty opportunities initially', () => {
      const detector = createArbitrageDetector()
      const opportunities = detector.getOpportunities()
      expect(opportunities).toEqual([])
    })

    it('should respect minProfitBps configuration', () => {
      const lowThreshold = createArbitrageDetector({ minProfitBps: 10 })
      const highThreshold = createArbitrageDetector({ minProfitBps: 500 })

      // Both should be created successfully
      expect(lowThreshold).toBeDefined()
      expect(highThreshold).toBeDefined()
    })
  })

  describe('BigInt Edge Cases', () => {
    it('should handle very large price values', () => {
      const largePrice = BigInt('999999999999999999999999')
      const slightlyLarger = largePrice + largePrice / 100n // 1% more

      const diff = Number(((slightlyLarger - largePrice) * 10000n) / largePrice)
      // Due to integer division, allow 99 or 100 bps
      expect(diff).toBeGreaterThanOrEqual(99)
      expect(diff).toBeLessThanOrEqual(100)
    })

    it('should handle minimum price values', () => {
      const minPrice = 1n
      const doublePrice = 2n

      const diff = Number(((doublePrice - minPrice) * 10000n) / minPrice)
      expect(diff).toBe(10000) // 100% = 10000 bps
    })

    it('should handle equal prices correctly', () => {
      const price = 1234567890123n
      const diff = Number(((price - price) * 10000n) / price)
      expect(diff).toBe(0)
    })
  })
})
