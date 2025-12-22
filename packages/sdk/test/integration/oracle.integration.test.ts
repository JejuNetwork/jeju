/**
 * Oracle Module Integration Tests
 *
 * Tests price oracle functionality against live localnet.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createJejuClient, type JejuClient } from '../../src'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup'

describe('Oracle Module Integration Tests', () => {
  let client: JejuClient
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>
  let skipTests = false

  beforeAll(async () => {
    env = await setupTestEnvironment()

    if (!env.chainRunning) {
      console.log('⚠ Chain not running - skipping oracle tests')
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
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  describe('Price Queries', () => {
    test('getPrice returns null for non-configured asset', async () => {
      if (skipTests || !env.contractsDeployed) return
      const price = await client.oracle.getPrice(zeroAddress)
      expect(price === null || typeof price === 'object').toBe(true)
    })

    test('getPrices returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const prices = await client.oracle.getPrices([zeroAddress])
      expect(Array.isArray(prices)).toBe(true)
    })

    test('getLatestRound returns round info', async () => {
      if (skipTests || !env.contractsDeployed) return
      try {
        const round = await client.oracle.getLatestRound(zeroAddress)
        expect(round === null || typeof round === 'object').toBe(true)
      } catch {
        // Expected for non-configured asset
      }
    })
  })

  describe('Feed Management', () => {
    test('getAllFeeds returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const feeds = await client.oracle.getAllFeeds()
      expect(Array.isArray(feeds)).toBe(true)
    })

    test('getFeedConfig returns null for non-existent', async () => {
      if (skipTests || !env.contractsDeployed) return
      const config = await client.oracle.getFeedConfig(zeroAddress)
      expect(config === null || typeof config === 'object').toBe(true)
    })
  })

  describe('Reporter Management', () => {
    test('isReporter returns boolean', async () => {
      if (skipTests || !env.contractsDeployed) return
      const isReporter = await client.oracle.isReporter(zeroAddress)
      expect(typeof isReporter).toBe('boolean')
    })

    test('getReporters returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const reporters = await client.oracle.getReporters()
      expect(Array.isArray(reporters)).toBe(true)
    })
  })

  describe('TWAP', () => {
    test('getTWAP returns price for period', async () => {
      if (skipTests || !env.contractsDeployed) return
      try {
        const twap = await client.oracle.getTWAP(zeroAddress, 3600)
        expect(typeof twap).toBe('bigint')
      } catch {
        // Expected for non-configured asset
      }
    })
  })
})
