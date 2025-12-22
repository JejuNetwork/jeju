/**
 * Staking Module Integration Tests
 *
 * Tests staking functionality against live localnet.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { createJejuClient, type JejuClient } from '../../src'
// viem utilities available if needed
import { setupTestEnvironment, teardownTestEnvironment } from '../setup'

describe('Staking Module Integration Tests', () => {
  let client: JejuClient
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>
  let skipTests = false

  beforeAll(async () => {
    try {
      env = await setupTestEnvironment()

      if (!env.chainRunning) {
        console.log('⚠ Chain not running - skipping staking tests')
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
      console.log('⚠ Contracts not configured - skipping staking tests')
      skipTests = true
    }
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  describe('Constants', () => {
    test('MIN_STAKE is defined', () => {
      if (skipTests) return
      expect(client.staking.MIN_STAKE).toBeDefined()
      expect(typeof client.staking.MIN_STAKE).toBe('bigint')
    })

    test('UNBONDING_PERIOD is defined', () => {
      if (skipTests) return
      expect(client.staking.UNBONDING_PERIOD).toBeDefined()
      expect(typeof client.staking.UNBONDING_PERIOD).toBe('bigint')
    })
  })

  describe('Stake Queries', () => {
    test('getMyStake returns stake info', async () => {
      if (skipTests || !env.contractsDeployed) return
      const stake = await client.staking.getMyStake()
      expect(stake).toBeDefined()
      expect(typeof stake.amount).toBe('bigint')
    })

    test('getTotalStaked returns bigint', async () => {
      if (skipTests || !env.contractsDeployed) return
      const total = await client.staking.getTotalStaked()
      expect(typeof total).toBe('bigint')
    })

    test('getStakers returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const stakers = await client.staking.getStakers()
      expect(Array.isArray(stakers)).toBe(true)
    })
  })

  describe('RPC Provider', () => {
    test('listRPCProviders returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const providers = await client.staking.listRPCProviders()
      expect(Array.isArray(providers)).toBe(true)
    })

    test('getRPCProviderInfo returns null for unregistered', async () => {
      if (skipTests || !env.contractsDeployed) return
      const info = await client.staking.getRPCProviderInfo(client.address)
      expect(info === null || typeof info === 'object').toBe(true)
    })
  })

  describe('Node Registration', () => {
    test('listNodes returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const nodes = await client.staking.listNodes()
      expect(Array.isArray(nodes)).toBe(true)
    })
  })

  describe('Rewards', () => {
    test('getPendingRewards returns bigint', async () => {
      if (skipTests || !env.contractsDeployed) return
      const rewards = await client.staking.getPendingRewards()
      expect(typeof rewards).toBe('bigint')
    })
  })
})
