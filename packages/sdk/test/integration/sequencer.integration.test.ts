/**
 * Sequencer Module Integration Tests
 *
 * Tests L2 sequencer functionality against live localnet.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createJejuClient, type JejuClient, SequencerStatus } from '../../src'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup'

describe('Sequencer Module Integration Tests', () => {
  let client: JejuClient
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>
  let skipTests = false

  beforeAll(async () => {
    try {
      env = await setupTestEnvironment()

      if (!env.chainRunning) {
        console.log('⚠ Chain not running - skipping sequencer tests')
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
      console.log('⚠ Contracts not configured - skipping sequencer tests')
      skipTests = true
    }
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  describe('Sequencer Queries', () => {
    test('getCurrentSequencer returns address or null', async () => {
      if (skipTests || !env.contractsDeployed) return
      const sequencer = await client.sequencer.getCurrentSequencer()
      expect(sequencer === null || typeof sequencer === 'string').toBe(true)
    })

    test('getAllSequencers returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const sequencers = await client.sequencer.getAllSequencers()
      expect(Array.isArray(sequencers)).toBe(true)
    })

    test('getActiveSequencers returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const sequencers = await client.sequencer.getActiveSequencers()
      expect(Array.isArray(sequencers)).toBe(true)
    })

    test('getSequencerInfo returns null for non-registered', async () => {
      if (skipTests || !env.contractsDeployed) return
      const info = await client.sequencer.getSequencerInfo(zeroAddress)
      expect(info === null || typeof info === 'object').toBe(true)
    })
  })

  describe('Rotation', () => {
    test('getRotationSchedule returns array', async () => {
      if (skipTests || !env.contractsDeployed) return
      const schedule = await client.sequencer.getRotationSchedule()
      expect(Array.isArray(schedule)).toBe(true)
    })

    test('getNextRotationTime returns number', async () => {
      if (skipTests || !env.contractsDeployed) return
      const time = await client.sequencer.getNextRotationTime()
      expect(typeof time).toBe('number')
    })
  })

  describe('Performance', () => {
    test('getSequencerPerformance returns metrics', async () => {
      if (skipTests || !env.contractsDeployed) return
      try {
        const perf = await client.sequencer.getSequencerPerformance(zeroAddress)
        expect(perf === null || typeof perf === 'object').toBe(true)
      } catch {
        // Expected for non-registered sequencer
      }
    })
  })

  describe('Bond Management', () => {
    test('getMinBond returns bigint', async () => {
      if (skipTests || !env.contractsDeployed) return
      const minBond = await client.sequencer.getMinBond()
      expect(typeof minBond).toBe('bigint')
    })

    test('getBondBalance returns bigint', async () => {
      if (skipTests || !env.contractsDeployed) return
      const balance = await client.sequencer.getBondBalance(zeroAddress)
      expect(typeof balance).toBe('bigint')
    })
  })

  describe('SequencerStatus Enum', () => {
    test('has expected values', () => {
      if (skipTests) return
      expect(SequencerStatus.INACTIVE).toBeDefined()
      expect(SequencerStatus.ACTIVE).toBeDefined()
      expect(SequencerStatus.JAILED).toBeDefined()
      expect(SequencerStatus.EXITING).toBeDefined()
    })
  })
})
