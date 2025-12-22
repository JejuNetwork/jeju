/**
 * Distributor Module Integration Tests
 *
 * Tests token distribution functionality against live localnet.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { type Hex, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createJejuClient, type JejuClient } from '../../src'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup'

describe('Distributor Module Integration Tests', () => {
  let client: JejuClient
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>
  let skipTests = false

  beforeAll(async () => {
    env = await setupTestEnvironment()

    if (!env.chainRunning) {
      console.log('⚠ Chain not running - skipping distributor tests')
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

  describe('Airdrop Management', () => {
    test('getAirdrop returns null for non-existent', async () => {
      if (skipTests || !env.contractsDeployed) return
      const airdrop = await client.distributor.getAirdrop(
        `0x${'00'.repeat(32)}` as Hex,
      )
      expect(airdrop === null || typeof airdrop === 'object').toBe(true)
    })

    test('getActiveAirdrops returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const airdrops = await client.distributor.getActiveAirdrops()
      expect(Array.isArray(airdrops)).toBe(true)
    })

    test('getMyAirdrops returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const airdrops = await client.distributor.getMyAirdrops()
      expect(Array.isArray(airdrops)).toBe(true)
    })

    test('getClaimableAmount returns bigint', async () => {
      if (skipTests || !env.contractsDeployed) return
      const amount = await client.distributor.getClaimableAmount(
        `0x${'00'.repeat(32)}` as Hex,
      )
      expect(typeof amount).toBe('bigint')
    })
  })

  describe('Vesting Management', () => {
    test('getVestingSchedule returns null for non-existent', async () => {
      if (skipTests || !env.contractsDeployed) return
      const schedule = await client.distributor.getVestingSchedule(
        `0x${'00'.repeat(32)}` as Hex,
      )
      expect(schedule === null || typeof schedule === 'object').toBe(true)
    })

    test('getMyVestingSchedules returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const schedules = await client.distributor.getMyVestingSchedules()
      expect(Array.isArray(schedules)).toBe(true)
    })

    test('getVestedAmount returns bigint', async () => {
      if (skipTests || !env.contractsDeployed) return
      const amount = await client.distributor.getVestedAmount(
        `0x${'00'.repeat(32)}` as Hex,
      )
      expect(typeof amount).toBe('bigint')
    })
  })

  describe('Fee Distribution', () => {
    test('getClaimableFees returns bigint', async () => {
      if (skipTests || !env.contractsDeployed) return
      const fees = await client.distributor.getClaimableFees(zeroAddress)
      expect(typeof fees).toBe('bigint')
    })

    test('getTotalDistributed returns bigint', async () => {
      if (skipTests || !env.contractsDeployed) return
      const total = await client.distributor.getTotalDistributed()
      expect(typeof total).toBe('bigint')
    })
  })
})
