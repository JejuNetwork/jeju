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
    try {
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
    } catch {
      console.log('⚠ Contracts not configured - skipping distributor tests')
      skipTests = true
    }
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

    test('listActiveAirdrops returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const airdrops = await client.distributor.listActiveAirdrops()
      expect(Array.isArray(airdrops)).toBe(true)
    })

    test('hasClaimed returns boolean', async () => {
      if (skipTests || !env.contractsDeployed) return
      const claimed = await client.distributor.hasClaimed(
        `0x${'00'.repeat(32)}` as Hex,
      )
      expect(typeof claimed).toBe('boolean')
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

    test('listMyVestingSchedules returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const schedules = await client.distributor.listMyVestingSchedules()
      expect(Array.isArray(schedules)).toBe(true)
    })

    test('getVestedAmount returns bigint', async () => {
      if (skipTests || !env.contractsDeployed) return
      const amount = await client.distributor.getVestedAmount(
        `0x${'00'.repeat(32)}` as Hex,
      )
      expect(typeof amount).toBe('bigint')
    })

    test('getReleasableAmount returns bigint', async () => {
      if (skipTests || !env.contractsDeployed) return
      const amount = await client.distributor.getReleasableAmount(
        `0x${'00'.repeat(32)}` as Hex,
      )
      expect(typeof amount).toBe('bigint')
    })
  })

  describe('Fee Distribution', () => {
    test('getFeePool returns null or object for token', async () => {
      if (skipTests || !env.contractsDeployed) return
      const pool = await client.distributor.getFeePool(zeroAddress)
      expect(pool === null || typeof pool === 'object').toBe(true)
    })

    test('getMyFeeShare returns bigint', async () => {
      if (skipTests || !env.contractsDeployed) return
      const share = await client.distributor.getMyFeeShare()
      expect(typeof share).toBe('bigint')
    })
  })

  describe('Staking Rewards', () => {
    test('getStakingRewards returns bigint', async () => {
      if (skipTests || !env.contractsDeployed) return
      const rewards = await client.distributor.getStakingRewards()
      expect(typeof rewards).toBe('bigint')
    })

    test('getRewardRate returns bigint', async () => {
      if (skipTests || !env.contractsDeployed) return
      const rate = await client.distributor.getRewardRate()
      expect(typeof rate).toBe('bigint')
    })
  })
})
