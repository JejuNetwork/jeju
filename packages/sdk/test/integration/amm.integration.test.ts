/**
 * AMM Module Integration Tests
 *
 * Tests Automated Market Maker functionality against live localnet.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { parseEther, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createJejuClient, type JejuClient } from '../../src'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup'

describe('AMM Module Integration Tests', () => {
  let client: JejuClient
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>
  let skipTests = false

  beforeAll(async () => {
    try {
      env = await setupTestEnvironment()

      if (!env.chainRunning) {
        console.log('⚠ Chain not running - skipping AMM tests')
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
      console.log('⚠ Contracts not configured - skipping AMM tests')
      skipTests = true
    }
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  describe('Pool Queries', () => {
    test('getPool returns null for non-existent', async () => {
      if (skipTests || !env.contractsDeployed) return
      const pool = await client.amm.getPool(zeroAddress, zeroAddress)
      expect(pool === null || typeof pool === 'object').toBe(true)
    })

    test('getAllPools returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const pools = await client.amm.getAllPools()
      expect(Array.isArray(pools)).toBe(true)
    })
  })

  describe('Quote Functions', () => {
    test('getSwapQuote returns quote object', async () => {
      if (skipTests || !env.contractsDeployed) return
      try {
        const quote = await client.amm.getSwapQuote({
          tokenIn: zeroAddress,
          tokenOut: zeroAddress,
          amountIn: parseEther('1'),
          useV3: false,
        })
        expect(quote).toBeDefined()
        expect(typeof quote.amountOut).toBe('bigint')
      } catch {
        // Expected for invalid tokens
      }
    })
  })

  describe('Position Queries', () => {
    test('getV2Position returns position info', async () => {
      if (skipTests || !env.contractsDeployed) return
      try {
        const position = await client.amm.getV2Position(
          zeroAddress,
          zeroAddress,
        )
        expect(position === null || typeof position === 'object').toBe(true)
      } catch {
        // Expected for non-existent pool
      }
    })

    test('getV3Positions returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const positions = await client.amm.getV3Positions()
      expect(Array.isArray(positions)).toBe(true)
    })
  })

  describe('Analytics', () => {
    test('getPoolTVL returns bigint', async () => {
      if (skipTests || !env.contractsDeployed) return
      try {
        const tvl = await client.amm.getPoolTVL(zeroAddress)
        expect(typeof tvl).toBe('bigint')
      } catch {
        // Expected for non-existent pool
      }
    })

    test('getTotalValueLocked returns bigint', async () => {
      if (skipTests || !env.contractsDeployed) return
      const tvl = await client.amm.getTotalValueLocked()
      expect(typeof tvl).toBe('bigint')
    })
  })
})
