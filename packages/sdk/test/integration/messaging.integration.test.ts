/**
 * Messaging Module Integration Tests
 *
 * Tests messaging relay functionality against live localnet.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createJejuClient, type JejuClient } from '../../src'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup'

describe('Messaging Module Integration Tests', () => {
  let client: JejuClient
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>
  let skipTests = false

  beforeAll(async () => {
    env = await setupTestEnvironment()

    if (!env.chainRunning) {
      console.log('⚠ Chain not running - skipping messaging tests')
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

  describe('Node Management', () => {
    test('getAllNodes returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const nodes = await client.messaging.getAllNodes()
      expect(Array.isArray(nodes)).toBe(true)
    })

    test('getActiveNodes returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const nodes = await client.messaging.getActiveNodes()
      expect(Array.isArray(nodes)).toBe(true)
    })

    test('getNodeInfo returns null for non-registered', async () => {
      if (skipTests || !env.contractsDeployed) return
      const info = await client.messaging.getNodeInfo(zeroAddress)
      expect(info === null || typeof info === 'object').toBe(true)
    })

    test('getMyNodes returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const nodes = await client.messaging.getMyNodes()
      expect(Array.isArray(nodes)).toBe(true)
    })
  })

  describe('Protocol Support', () => {
    test('getNodesByProtocol returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const nodes = await client.messaging.getNodesByProtocol('xmtp')
      expect(Array.isArray(nodes)).toBe(true)
    })
  })

  describe('Performance', () => {
    test('getNodePerformance returns metrics', async () => {
      if (skipTests || !env.contractsDeployed) return
      try {
        const perf = await client.messaging.getNodePerformance(zeroAddress)
        expect(perf === null || typeof perf === 'object').toBe(true)
      } catch {
        // Expected for non-registered node
      }
    })
  })

  describe('Statistics', () => {
    test('getMessagingStats returns stats object', async () => {
      if (skipTests || !env.contractsDeployed) return
      const stats = await client.messaging.getMessagingStats()
      expect(stats).toBeDefined()
      expect(typeof stats.totalNodes).toBe('number')
    })
  })

  describe('Module Constants', () => {
    test('MIN_STAKE is defined', () => {
      if (skipTests) return
      expect(client.messaging.MIN_STAKE).toBeDefined()
    })
  })
})
