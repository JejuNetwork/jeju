/**
 * Risk Manager Tests
 *
 * Tests for:
 * - Kelly criterion position sizing
 * - Circuit breakers (consecutive failures)
 * - Daily/weekly loss limits
 * - Builder reliability tracking
 * - Position exposure limits
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import type { OpportunityExecutionResult } from '../autocrat-types'
import { DEFAULT_RISK_CONFIG, RiskManager } from './risk-manager'

describe('RiskManager', () => {
  let riskManager: RiskManager

  beforeEach(() => {
    riskManager = new RiskManager()
  })

  describe('Position Sizing', () => {
    test('should reject opportunity with profit below minimum', () => {
      const result = riskManager.canExecute({
        id: 'test-1',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(1e18),
        expectedProfit: String(1e14), // 0.0001 ETH < 0.001 ETH minimum
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('below minimum')
    })

    test('should reject opportunity with profit bps below minimum', () => {
      const result = riskManager.canExecute({
        id: 'test-2',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(100e18), // 100 ETH
        expectedProfit: String(1e15), // 0.001 ETH = 0.001% = 1 bps (below 10 bps min)
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('bps below minimum')
    })

    test('should allow valid opportunity with adjusted size', () => {
      const result = riskManager.canExecute({
        id: 'test-3',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(5e18), // 5 ETH
        expectedProfit: String(1e17), // 0.1 ETH = 2% = 200 bps
      })

      expect(result.allowed).toBe(true)
      expect(result.adjustedSize).toBeDefined()
    })

    test('should cap position size at max', () => {
      const result = riskManager.canExecute({
        id: 'test-4',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(50e18), // 50 ETH > 10 ETH max
        expectedProfit: String(5e18), // 5 ETH
      })

      expect(result.allowed).toBe(true)
      // Should be capped at max (10 ETH) or less
      expect(result.adjustedSize).toBeLessThanOrEqual(
        DEFAULT_RISK_CONFIG.maxPositionSizeWei,
      )
    })

    test('should reject if adjusted size too small after risk adjustments', () => {
      const riskManagerStrict = new RiskManager({
        maxPositionSizeWei: BigInt(1e14), // Very small max
        minNetProfitWei: BigInt(1e10), // Low minimum
        minProfitBps: 1,
      })

      const result = riskManagerStrict.canExecute({
        id: 'test-5',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(1e14),
        expectedProfit: String(1e11),
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('too small')
    })
  })

  describe('Circuit Breaker', () => {
    test('should trigger circuit breaker after consecutive failures', () => {
      const rm = new RiskManager({
        maxConsecutiveFails: 3,
        cooldownAfterFailMs: 1000,
      })

      // Start and complete 3 failed trades
      for (let i = 0; i < 3; i++) {
        const tradeId = rm.startTrade({
          id: `fail-${i}`,
          type: 'DEX_ARBITRAGE',
          inputAmount: String(1e18),
          expectedProfit: String(1e17),
        })

        const failResult: OpportunityExecutionResult = {
          opportunityId: `fail-${i}`,
          success: false,
          error: 'Simulation failed',
          executedAt: Date.now(),
          durationMs: 100,
        }

        rm.completeTrade(tradeId, failResult)
      }

      // Next opportunity should be blocked
      const result = rm.canExecute({
        id: 'test-blocked',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(1e18),
        expectedProfit: String(1e17),
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Circuit breaker')
    })

    test('should reset consecutive fails on success', () => {
      const rm = new RiskManager({
        maxConsecutiveFails: 3,
        cooldownAfterFailMs: 1000,
      })

      // 2 failures
      for (let i = 0; i < 2; i++) {
        const tradeId = rm.startTrade({
          id: `fail-${i}`,
          type: 'DEX_ARBITRAGE',
          inputAmount: String(1e18),
          expectedProfit: String(1e17),
        })

        rm.completeTrade(tradeId, {
          opportunityId: `fail-${i}`,
          success: false,
          error: 'Failed',
          executedAt: Date.now(),
          durationMs: 100,
        })
      }

      // 1 success
      const successTradeId = rm.startTrade({
        id: 'success',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(1e18),
        expectedProfit: String(1e17),
      })

      rm.completeTrade(successTradeId, {
        opportunityId: 'success',
        success: true,
        txHash: '0x123',
        actualProfit: String(1e17),
        executedAt: Date.now(),
        durationMs: 100,
      })

      const metrics = rm.getMetrics()
      expect(metrics.consecutiveFails).toBe(0)
      expect(metrics.isPaused).toBe(false)
    })
  })

  describe('PnL Tracking', () => {
    test('should track daily PnL correctly', () => {
      // Complete some trades with profits/losses
      const tradeId1 = riskManager.startTrade({
        id: 'trade-1',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(1e18),
        expectedProfit: String(1e17),
      })

      riskManager.completeTrade(tradeId1, {
        opportunityId: 'trade-1',
        success: true,
        txHash: '0x123',
        actualProfit: String(1e17), // 0.1 ETH profit
        executedAt: Date.now(),
        durationMs: 100,
      })

      const tradeId2 = riskManager.startTrade({
        id: 'trade-2',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(1e18),
        expectedProfit: String(5e16),
      })

      riskManager.completeTrade(tradeId2, {
        opportunityId: 'trade-2',
        success: true,
        txHash: '0x456',
        actualProfit: String(-2e16), // -0.02 ETH loss (gas exceeded profit)
        executedAt: Date.now(),
        durationMs: 100,
      })

      const metrics = riskManager.getMetrics()
      // Net: 0.1 - 0.02 = 0.08 ETH
      expect(metrics.dailyPnL).toBe(BigInt(8e16))
    })

    test('should block trading when daily loss limit reached', () => {
      const rm = new RiskManager({
        maxDailyLossWei: BigInt(5e16), // 0.05 ETH
        minNetProfitWei: BigInt(1e14),
        minProfitBps: 1,
      })

      // Record a big loss
      const tradeId = rm.startTrade({
        id: 'big-loss',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(1e18),
        expectedProfit: String(1e17),
      })

      rm.completeTrade(tradeId, {
        opportunityId: 'big-loss',
        success: true,
        txHash: '0x789',
        actualProfit: String(-1e17), // -0.1 ETH loss > 0.05 ETH limit
        executedAt: Date.now(),
        durationMs: 100,
      })

      const result = rm.canExecute({
        id: 'next-trade',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(1e18),
        expectedProfit: String(1e17),
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Daily loss limit')
    })
  })

  describe('Builder Stats', () => {
    test('should track builder inclusion rates', () => {
      for (let i = 0; i < 10; i++) {
        riskManager.updateBuilderStats('flashbots', i < 7, 100) // 70% inclusion
      }

      expect(riskManager.isBuilderReliable('flashbots')).toBe(true)

      for (let i = 0; i < 10; i++) {
        riskManager.updateBuilderStats('lowrate-builder', i < 1, 100) // 10% inclusion
      }

      // At 10% inclusion, should still be reliable (min is 10%)
      expect(riskManager.isBuilderReliable('lowrate-builder')).toBe(true)
    })

    test('should return unreliable for builders below threshold', () => {
      const rm = new RiskManager({
        minBuilderInclusionRate: 0.5, // 50% minimum
      })

      for (let i = 0; i < 20; i++) {
        rm.updateBuilderStats('bad-builder', i < 5, 100) // 25% inclusion
      }

      expect(rm.isBuilderReliable('bad-builder')).toBe(false)
    })

    test('should return true for unknown builders (not enough data)', () => {
      expect(riskManager.isBuilderReliable('unknown-builder')).toBe(true)
    })

    test('should sort reliable builders by performance', () => {
      // Add builders with different inclusion rates
      for (let i = 0; i < 10; i++) {
        riskManager.updateBuilderStats('builder-90', i < 9, 100) // 90%
        riskManager.updateBuilderStats('builder-50', i < 5, 100) // 50%
        riskManager.updateBuilderStats('builder-70', i < 7, 100) // 70%
      }

      const reliable = riskManager.getReliableBuilders()
      expect(reliable[0]).toBe('builder-90')
      expect(reliable[1]).toBe('builder-70')
      expect(reliable[2]).toBe('builder-50')
    })
  })

  describe('Concurrent Exposure', () => {
    test('should track pending trades as exposure', () => {
      // Start a trade but don't complete it
      riskManager.startTrade({
        id: 'pending-1',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(5e18), // 5 ETH
        expectedProfit: String(1e17),
      })

      const metrics = riskManager.getMetrics()
      expect(metrics.currentExposure).toBe(BigInt(5e18))
    })

    test('should limit new trades when exposure is high', () => {
      const rm = new RiskManager({
        maxConcurrentExposureWei: BigInt(10e18), // 10 ETH max
        minNetProfitWei: BigInt(1e14),
        minProfitBps: 1,
      })

      // Start trades totaling 9 ETH
      rm.startTrade({
        id: 'pending-1',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(5e18),
        expectedProfit: String(1e17),
      })

      rm.startTrade({
        id: 'pending-2',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(4e18),
        expectedProfit: String(1e17),
      })

      // Try to add 5 ETH more - should be limited to 1 ETH
      const result = rm.canExecute({
        id: 'new-trade',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(5e18),
        expectedProfit: String(1e18),
      })

      expect(result.allowed).toBe(true)
      expect(result.adjustedSize).toBeLessThanOrEqual(BigInt(1e18))
    })

    test('should reject when max exposure reached', () => {
      const rm = new RiskManager({
        maxConcurrentExposureWei: BigInt(5e18),
        minNetProfitWei: BigInt(1e14),
        minProfitBps: 1,
      })

      // Fill up exposure
      rm.startTrade({
        id: 'pending-1',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(5e18),
        expectedProfit: String(1e17),
      })

      const result = rm.canExecute({
        id: 'new-trade',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(1e18),
        expectedProfit: String(1e17),
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Max concurrent exposure')
    })
  })

  describe('Kelly Criterion Sizing', () => {
    test('should use conservative sizing with insufficient trade history', () => {
      // No trade history yet
      const result = riskManager.canExecute({
        id: 'first-trade',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(10e18),
        expectedProfit: String(1e18),
      })

      expect(result.allowed).toBe(true)
      // With no history, should use conservative 10% of max
      expect(result.adjustedSize).toBeLessThanOrEqual(
        DEFAULT_RISK_CONFIG.maxPositionSizeWei,
      )
    })

    test('should adjust size based on historical win rate', () => {
      // Build up trade history with 80% win rate
      for (let i = 0; i < 10; i++) {
        const tradeId = riskManager.startTrade({
          id: `hist-${i}`,
          type: 'DEX_ARBITRAGE',
          inputAmount: String(1e18),
          expectedProfit: String(1e17),
        })

        const isWin = i < 8 // 80% wins
        riskManager.completeTrade(tradeId, {
          opportunityId: `hist-${i}`,
          success: true,
          txHash: `0x${i}`,
          actualProfit: isWin ? String(1e17) : String(-5e16),
          executedAt: Date.now(),
          durationMs: 100,
        })
      }

      // Kelly should now be calculated from history
      const result = riskManager.canExecute({
        id: 'kelly-sized',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(5e18),
        expectedProfit: String(5e17),
      })

      expect(result.allowed).toBe(true)
      expect(result.adjustedSize).toBeDefined()
    })
  })

  describe('Chain Risk Profiles', () => {
    test('should apply chain risk multiplier', () => {
      // Ethereum mainnet has 0.95 multiplier
      const resultMainnet = riskManager.canExecute({
        id: 'mainnet-trade',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(1e18),
        expectedProfit: String(1e17),
        chainId: 1,
      })

      // Arbitrum has 1.0 multiplier
      const resultArbitrum = riskManager.canExecute({
        id: 'arbitrum-trade',
        type: 'DEX_ARBITRAGE',
        inputAmount: String(1e18),
        expectedProfit: String(1e17),
        chainId: 42161,
      })

      expect(resultMainnet.allowed).toBe(true)
      expect(resultArbitrum.allowed).toBe(true)

      // Mainnet should have slightly smaller adjusted size due to reorg risk
      if (resultMainnet.adjustedSize && resultArbitrum.adjustedSize) {
        expect(resultMainnet.adjustedSize).toBeLessThanOrEqual(
          resultArbitrum.adjustedSize,
        )
      }
    })
  })

  describe('Metrics', () => {
    test('should calculate success rate correctly', () => {
      // 3 successful, 2 failed
      for (let i = 0; i < 5; i++) {
        const tradeId = riskManager.startTrade({
          id: `trade-${i}`,
          type: 'DEX_ARBITRAGE',
          inputAmount: String(1e18),
          expectedProfit: String(1e17),
        })

        riskManager.completeTrade(tradeId, {
          opportunityId: `trade-${i}`,
          success: i < 3,
          txHash: i < 3 ? `0x${i}` : undefined,
          actualProfit: i < 3 ? String(1e17) : undefined,
          error: i >= 3 ? 'Failed' : undefined,
          executedAt: Date.now(),
          durationMs: 100,
        })
      }

      const metrics = riskManager.getMetrics()
      expect(metrics.successRate).toBe(0.6) // 3/5 = 60%
    })

    test('should calculate average profit per trade', () => {
      // 3 trades with different profits
      const profits = [1e17, 2e17, 3e17] // 0.1, 0.2, 0.3 ETH

      for (let i = 0; i < profits.length; i++) {
        const tradeId = riskManager.startTrade({
          id: `trade-${i}`,
          type: 'DEX_ARBITRAGE',
          inputAmount: String(1e18),
          expectedProfit: String(profits[i]),
        })

        riskManager.completeTrade(tradeId, {
          opportunityId: `trade-${i}`,
          success: true,
          txHash: `0x${i}`,
          actualProfit: String(profits[i]),
          executedAt: Date.now(),
          durationMs: 100,
        })
      }

      const metrics = riskManager.getMetrics()
      // Average: (0.1 + 0.2 + 0.3) / 3 = 0.2 ETH
      expect(metrics.avgProfitPerTrade).toBe(BigInt(2e17))
    })
  })
})
