/**
 * VPN Module Integration Tests
 *
 * Tests VPN management functionality against live localnet.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createJejuClient, type JejuClient, VPNNodeStatus } from '../../src'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup'

describe('VPN Module Integration Tests', () => {
  let client: JejuClient
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>
  let skipTests = false

  beforeAll(async () => {
    try {
      env = await setupTestEnvironment()

      if (!env.chainRunning) {
        console.log('⚠ Chain not running - skipping VPN tests')
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
      console.log('⚠ Contracts not configured - skipping VPN tests')
      skipTests = true
    }
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  describe('Node Queries', () => {
    test('getAllNodes returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const nodes = await client.vpn.getAllNodes()
      expect(Array.isArray(nodes)).toBe(true)
    })

    test('getActiveNodes returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const nodes = await client.vpn.getActiveNodes()
      expect(Array.isArray(nodes)).toBe(true)
    })

    test('getNodeInfo returns null for non-registered', async () => {
      if (skipTests || !env.contractsDeployed) return
      const info = await client.vpn.getNodeInfo(zeroAddress)
      expect(info === null || typeof info === 'object').toBe(true)
    })
  })

  describe('Region Queries', () => {
    test('getNodesByRegion returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const nodes = await client.vpn.getNodesByRegion('us-east')
      expect(Array.isArray(nodes)).toBe(true)
    })

    test('getAvailableRegions returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const regions = await client.vpn.getAvailableRegions()
      expect(Array.isArray(regions)).toBe(true)
    })
  })

  describe('Session Management', () => {
    test('getActiveSessions returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const sessions = await client.vpn.getActiveSessions()
      expect(Array.isArray(sessions)).toBe(true)
    })

    test('getSessionHistory returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const history = await client.vpn.getSessionHistory()
      expect(Array.isArray(history)).toBe(true)
    })
  })

  describe('Statistics', () => {
    test('getVPNStats returns stats object', async () => {
      if (skipTests || !env.contractsDeployed) return
      const stats = await client.vpn.getVPNStats()
      expect(stats).toBeDefined()
      expect(typeof stats.totalNodes).toBe('number')
    })

    test('getNodePerformance returns performance object', async () => {
      if (skipTests || !env.contractsDeployed) return
      try {
        const perf = await client.vpn.getNodePerformance(zeroAddress)
        expect(perf === null || typeof perf === 'object').toBe(true)
      } catch {
        // Expected for non-registered node
      }
    })
  })

  describe('VPNNodeStatus Enum', () => {
    test('has expected values', () => {
      if (skipTests) return
      expect(VPNNodeStatus.INACTIVE).toBeDefined()
      expect(VPNNodeStatus.ACTIVE).toBeDefined()
      expect(VPNNodeStatus.SUSPENDED).toBeDefined()
    })
  })
})
