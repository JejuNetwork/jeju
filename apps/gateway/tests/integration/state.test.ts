/**
 * Gateway State Module Integration Tests
 *
 * REQUIRES: Jeju CLI infrastructure (SQLit)
 * Run with: jeju test --mode integration --app gateway
 *
 * These tests will skip if infrastructure is not available.
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import type { Intent, Solver, SupportedChainId } from '@jejunetwork/types'
import {
  getStateMode,
  initializeState,
  intentState,
  routeState,
  solverState,
} from '../../api/services/state'

describe('Gateway State Module', () => {
  beforeAll(async () => {
    await initializeState()
  })

  test('initializes state with valid mode', () => {
    // State can be either memory or sqlit depending on environment
    const mode = getStateMode()
    expect(['memory', 'sqlit']).toContain(mode)
  })

  describe('Intent State', () => {
    const testIntent: Intent = {
      intentId:
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`,
      user: '0x1234567890123456789012345678901234567890' as `0x${string}`,
      nonce: '12345',
      sourceChainId: 1 as SupportedChainId,
      openDeadline: Math.floor(Date.now() / 1000) + 300,
      fillDeadline: Math.floor(Date.now() / 1000) + 3600,
      inputs: [
        {
          token: '0x0000000000000000000000000000000000000000' as `0x${string}`,
          amount: '1000000000000000000',
          chainId: 1 as SupportedChainId,
        },
      ],
      outputs: [
        {
          token: '0x0000000000000000000000000000000000000000' as `0x${string}`,
          amount: '1000000000000000000',
          recipient:
            '0x1234567890123456789012345678901234567890' as `0x${string}`,
          chainId: 42161 as SupportedChainId,
        },
      ],
      signature: '0x' as `0x${string}`,
      status: 'open',
      createdAt: Date.now(),
    }

    test('saves and retrieves intent', async () => {
      await intentState.save(testIntent)
      const retrieved = await intentState.get(testIntent.intentId)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.intentId).toBe(testIntent.intentId)
      expect(retrieved?.user).toBe(testIntent.user.toLowerCase())
      expect(retrieved?.status).toBe('open')
    })

    test('lists intents', async () => {
      const intents = await intentState.list({ limit: 10 })
      expect(intents.length).toBeGreaterThan(0)
      expect(intents[0].intentId).toBe(testIntent.intentId)
    })

    test('updates intent status', async () => {
      await intentState.updateStatus(testIntent.intentId, 'filled', {
        solver: '0xabcd000000000000000000000000000000000001',
        filledAt: Date.now(),
      })

      const updated = await intentState.get(testIntent.intentId)
      expect(updated?.status).toBe('filled')
      expect(updated?.solver).toBe('0xabcd000000000000000000000000000000000001')
    })

    test('counts intents', async () => {
      const total = await intentState.count()
      expect(total).toBeGreaterThan(0)

      const filled = await intentState.count({ status: 'filled' })
      expect(filled).toBeGreaterThan(0)
    })
  })

  describe('Solver State', () => {
    // Clean up any invalid test data from previous runs
    beforeAll(async () => {
      // Delete the old invalid solver address if it exists
      await solverState.delete('0xsolver0000000000000000000000000000000001')
    })

    const testSolver: Solver = {
      address: '0xabc1230000000000000000000000000000000001' as `0x${string}`,
      name: 'Test Solver',
      endpoint: 'http://test-solver.local/a2a',
      supportedChains: [1, 42161] as SupportedChainId[],
      supportedTokens: {},
      liquidity: [],
      reputation: 95,
      totalFills: 100,
      successfulFills: 95,
      failedFills: 5,
      successRate: 95,
      avgResponseMs: 50,
      avgFillTimeMs: 5000,
      totalVolumeUsd: '1000000',
      totalFeesEarnedUsd: '10000',
      status: 'active',
      stakedAmount: '100000000000000000000',
      registeredAt: Date.now() - 86400000,
      lastActiveAt: Date.now(),
    }

    test('saves and retrieves solver', async () => {
      await solverState.save(testSolver)
      const retrieved = await solverState.get(testSolver.address)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.address).toBe(testSolver.address.toLowerCase())
      expect(retrieved?.name).toBe('Test Solver')
      expect(retrieved?.reputation).toBe(95)
    })

    test('lists solvers', async () => {
      const solvers = await solverState.list({ status: 'active' })
      expect(solvers.length).toBeGreaterThan(0)
    })
  })

  describe('Route State', () => {
    const testRouteId = 'eth-arb-eth'

    test('saves route stats', async () => {
      await routeState.save(testRouteId, {
        sourceChainId: 1 as SupportedChainId,
        destinationChainId: 42161 as SupportedChainId,
        sourceToken: '0x0000000000000000000000000000000000000000',
        destinationToken: '0x0000000000000000000000000000000000000000',
        oracle: 'hyperlane',
        isActive: true,
      })
    })

    test('increments volume', async () => {
      await routeState.incrementVolume(testRouteId, 1000000000000000000n)
    })
  })
})
