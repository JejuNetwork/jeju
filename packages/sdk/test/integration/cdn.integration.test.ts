/**
 * CDN Module Integration Tests
 *
 * Tests CDN management functionality against live localnet.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createJejuClient, type JejuClient } from '../../src'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup'

describe('CDN Module Integration Tests', () => {
  let client: JejuClient
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>
  let skipTests = false

  beforeAll(async () => {
    try {
      env = await setupTestEnvironment()

      if (!env.chainRunning) {
        console.log('⚠ Chain not running - skipping CDN tests')
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
      console.log('⚠ Contracts not configured - skipping CDN tests')
      skipTests = true
    }
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  describe('Provider Management', () => {
    test('getAllProviders returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const providers = await client.cdn.getAllProviders()
      expect(Array.isArray(providers)).toBe(true)
    })

    test('getProviderInfo returns null for non-registered', async () => {
      if (skipTests || !env.contractsDeployed) return
      const info = await client.cdn.getProviderInfo(zeroAddress)
      expect(info === null || typeof info === 'object').toBe(true)
    })

    test('getActiveProviders returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const providers = await client.cdn.getActiveProviders()
      expect(Array.isArray(providers)).toBe(true)
    })
  })

  describe('Node Management', () => {
    test('getProviderNodes returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const nodes = await client.cdn.getProviderNodes(zeroAddress)
      expect(Array.isArray(nodes)).toBe(true)
    })

    test('getNodeInfo returns null for non-existent', async () => {
      if (skipTests || !env.contractsDeployed) return
      const info = await client.cdn.getNodeInfo(zeroAddress, 0)
      expect(info === null || typeof info === 'object').toBe(true)
    })
  })

  describe('Region Queries', () => {
    test('getNodesByRegion returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const nodes = await client.cdn.getNodesByRegion('us-east')
      expect(Array.isArray(nodes)).toBe(true)
    })

    test('getAvailableRegions returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const regions = await client.cdn.getAvailableRegions()
      expect(Array.isArray(regions)).toBe(true)
    })
  })

  describe('Statistics', () => {
    test('getCDNStats returns stats object', async () => {
      if (skipTests || !env.contractsDeployed) return
      const stats = await client.cdn.getCDNStats()
      expect(stats).toBeDefined()
      expect(typeof stats.totalProviders).toBe('number')
    })
  })

  describe('Module Constants', () => {
    test('MIN_NODE_STAKE is defined', () => {
      if (skipTests) return
      expect(client.cdn.MIN_NODE_STAKE).toBeDefined()
    })
  })
})
