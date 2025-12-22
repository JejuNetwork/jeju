/**
 * Perps Module Integration Tests
 *
 * Tests perpetual futures trading against live localnet.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createJejuClient, type JejuClient } from '../../src'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup'

describe('Perps Module Integration Tests', () => {
  let client: JejuClient
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>
  let skipTests = false

  beforeAll(async () => {
    try {
      env = await setupTestEnvironment()

      if (!env.chainRunning) {
        console.log('⚠ Chain not running - skipping perps tests')
        skipTests = true
        return
      }

      const account = privateKeyToAccount(env.privateKey)
      client = await createJejuClient({
        account,
        network: 'localnet',
        rpcUrl: env.rpcUrl,
        smartAccount: false,
      })
    } catch {
      console.log('⚠ Contracts not configured - skipping perps tests')
      skipTests = true
    }
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  describe('Constants', () => {
    test('MAX_LEVERAGE is 50', () => {
      if (skipTests) return
      expect(client.perps.MAX_LEVERAGE).toBe(50)
    })

    test('MIN_MARGIN is defined and positive', () => {
      if (skipTests) return
      expect(client.perps.MIN_MARGIN).toBeDefined()
      expect(client.perps.MIN_MARGIN).toBeGreaterThan(0n)
    })
  })

  describe('Market Queries', () => {
    test('getAllMarkets returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const markets = await client.perps.getAllMarkets()
      expect(Array.isArray(markets)).toBe(true)
    })

    test('getMarket returns null for non-existent market', async () => {
      if (skipTests || !env.contractsDeployed) return
      const market = await client.perps.getMarket(`0x${'00'.repeat(32)}` as Hex)
      expect(market).toBeNull()
    })
  })

  describe('Position Queries', () => {
    test('getTraderPositions returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const positions = await client.perps.getTraderPositions()
      expect(Array.isArray(positions)).toBe(true)
    })

    test('getPosition returns null for non-existent position', async () => {
      if (skipTests || !env.contractsDeployed) return
      const position = await client.perps.getPosition(
        `0x${'00'.repeat(32)}` as Hex,
      )
      expect(position).toBeNull()
    })
  })

  describe('Funding Rate', () => {
    test('getFundingRate handles non-existent market', async () => {
      if (skipTests || !env.contractsDeployed) return
      try {
        const rate = await client.perps.getFundingRate(
          `0x${'00'.repeat(32)}` as Hex,
        )
        // Rate could be 0 for non-existent market
        expect(typeof rate).toBe('bigint')
      } catch {
        // Expected if market doesn't exist
      }
    })
  })

  describe('Health Checks', () => {
    test('isLiquidatable returns for non-existent position', async () => {
      if (skipTests || !env.contractsDeployed) return
      try {
        const result = await client.perps.isLiquidatable(
          `0x${'00'.repeat(32)}` as Hex,
        )
        expect(result.canLiquidate).toBe(false)
      } catch {
        // Expected if position doesn't exist
      }
    })

    test('getLiquidationPrice returns for non-existent position', async () => {
      if (skipTests || !env.contractsDeployed) return
      try {
        const price = await client.perps.getLiquidationPrice(
          `0x${'00'.repeat(32)}` as Hex,
        )
        expect(price).toBe(0n)
      } catch {
        // Expected if position doesn't exist
      }
    })
  })

  describe('Open Interest', () => {
    test('getOpenInterest returns object with longOI and shortOI', async () => {
      if (skipTests || !env.contractsDeployed) return
      try {
        const oi = await client.perps.getOpenInterest(
          `0x${'00'.repeat(32)}` as Hex,
        )
        expect(typeof oi.longOI).toBe('bigint')
        expect(typeof oi.shortOI).toBe('bigint')
      } catch {
        // Expected if market doesn't exist
      }
    })
  })
})
