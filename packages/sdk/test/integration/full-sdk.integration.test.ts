/**
 * Full SDK Integration Test Suite
 *
 * This file serves as the entry point for running all SDK integration tests.
 * It validates that all modules are correctly initialized and functional.
 *
 * Run with: bun run test:integration
 *
 * Prerequisites:
 *   - Local chain running (anvil or jeju dev)
 *   - Contracts deployed
 *   - Services running (optional for full tests)
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { createJejuClient, type JejuClient } from '../../src'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup'

describe('Full SDK Integration Tests', () => {
  let client: JejuClient
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>
  let skipTests = false

  beforeAll(async () => {
    console.log('\n═══════════════════════════════════════════════════════')
    console.log('  JEJU SDK Integration Test Suite')
    console.log('═══════════════════════════════════════════════════════\n')

    env = await setupTestEnvironment()

    if (!env.chainRunning) {
      console.log('\n⚠ WARNING: Chain not running')
      console.log('  Start with: jeju dev --localnet')
      console.log('  Or: anvil --port 9545')
      skipTests = true
      return
    }

    console.log(`\n✓ Chain running at ${env.rpcUrl}`)
    console.log(`  Contracts deployed: ${env.contractsDeployed}`)
    console.log(`  Services running: ${env.servicesRunning}`)

    const account = privateKeyToAccount(env.privateKey)
    client = await createJejuClient({
      account,
      network: 'localnet',
      rpcUrl: env.rpcUrl,
      smartAccount: false,
    })

    console.log(`\n✓ Client initialized for ${client.address}`)
    console.log('\n───────────────────────────────────────────────────────\n')
  })

  afterAll(async () => {
    console.log('\n───────────────────────────────────────────────────────')
    console.log('  Cleaning up...')
    await teardownTestEnvironment()
  })

  describe('Client Initialization', () => {
    test('client is created with all modules', () => {
      if (skipTests) return

      expect(client).toBeDefined()
      expect(client.address).toBeDefined()
      expect(client.network).toBe('localnet')
    })

    test('all core modules are present', () => {
      if (skipTests) return

      // Core modules
      expect(client.federation).toBeDefined()
      expect(client.staking).toBeDefined()
      expect(client.dws).toBeDefined()
      expect(client.moderation).toBeDefined()
      expect(client.governance).toBeDefined()
      expect(client.compute).toBeDefined()
      expect(client.storage).toBeDefined()
      expect(client.identity).toBeDefined()
    })

    test('all extended modules are present', () => {
      if (skipTests) return

      // Extended modules
      expect(client.perps).toBeDefined()
      expect(client.amm).toBeDefined()
      expect(client.agents).toBeDefined()
      expect(client.bridge).toBeDefined()
      expect(client.oracle).toBeDefined()
      expect(client.sequencer).toBeDefined()
      expect(client.cdn).toBeDefined()
      expect(client.vpn).toBeDefined()
      expect(client.otc).toBeDefined()
      expect(client.messaging).toBeDefined()
      expect(client.distributor).toBeDefined()
      expect(client.training).toBeDefined()
    })
  })

  describe('Module Method Validation', () => {
    test('federation has core methods', () => {
      if (skipTests) return
      expect(typeof client.federation.getAllNetworks).toBe('function')
      expect(typeof client.federation.getStakedNetworks).toBe('function')
      expect(typeof client.federation.getVerifiedNetworks).toBe('function')
      expect(typeof client.federation.joinFederation).toBe('function')
    })

    test('staking has core methods', () => {
      if (skipTests) return
      expect(typeof client.staking.stake).toBe('function')
      expect(typeof client.staking.unstake).toBe('function')
      expect(typeof client.staking.getMyStake).toBe('function')
      expect(typeof client.staking.listRPCProviders).toBe('function')
    })

    test('dws has core methods', () => {
      if (skipTests) return
      expect(typeof client.dws.createTrigger).toBe('function')
      expect(typeof client.dws.createWorkflow).toBe('function')
      expect(typeof client.dws.executeWorkflow).toBe('function')
      expect(typeof client.dws.getJob).toBe('function')
      expect(typeof client.dws.listMyJobs).toBe('function')
    })

    test('moderation has core methods', () => {
      if (skipTests) return
      expect(typeof client.moderation.submitEvidence).toBe('function')
      expect(typeof client.moderation.isAddressBanned).toBe('function')
      expect(typeof client.moderation.createReport).toBe('function')
    })

    test('perps has core methods', () => {
      if (skipTests) return
      expect(typeof client.perps.openPosition).toBe('function')
      expect(typeof client.perps.closePosition).toBe('function')
      expect(typeof client.perps.getAllMarkets).toBe('function')
    })

    test('amm has core methods', () => {
      if (skipTests) return
      expect(typeof client.amm.getQuote).toBe('function')
      expect(typeof client.amm.swapExactTokensForTokensV2).toBe('function')
      expect(typeof client.amm.exactInputSingleV3).toBe('function')
      expect(typeof client.amm.getV2Pool).toBe('function')
    })

    test('agents has core methods', () => {
      if (skipTests) return
      expect(typeof client.agents.createVault).toBe('function')
      expect(typeof client.agents.deposit).toBe('function')
      expect(typeof client.agents.spend).toBe('function')
      expect(typeof client.agents.createRoom).toBe('function')
    })

    test('bridge has core methods', () => {
      if (skipTests) return
      expect(typeof client.bridge.depositETH).toBe('function')
      expect(typeof client.bridge.initiateWithdrawal).toBe('function')
      expect(typeof client.bridge.sendHyperlaneMessage).toBe('function')
      expect(typeof client.bridge.bridgeNFT).toBe('function')
    })

    test('oracle has core methods', () => {
      if (skipTests) return
      expect(typeof client.oracle.getLatestPrice).toBe('function')
      expect(typeof client.oracle.getLatestRoundData).toBe('function')
      expect(typeof client.oracle.registerOracle).toBe('function')
      expect(typeof client.oracle.getFeedByPair).toBe('function')
    })

    test('sequencer has core methods', () => {
      if (skipTests) return
      expect(typeof client.sequencer.registerSequencer).toBe('function')
      expect(typeof client.sequencer.getCurrentSequencer).toBe('function')
      expect(typeof client.sequencer.requestForcedInclusion).toBe('function')
    })

    test('cdn has core methods', () => {
      if (skipTests) return
      expect(typeof client.cdn.registerProvider).toBe('function')
      expect(typeof client.cdn.registerNode).toBe('function')
      expect(typeof client.cdn.createSite).toBe('function')
      expect(typeof client.cdn.invalidateCache).toBe('function')
    })

    test('vpn has core methods', () => {
      if (skipTests) return
      expect(typeof client.vpn.registerNode).toBe('function')
      expect(typeof client.vpn.getAllNodes).toBe('function')
      expect(typeof client.vpn.getActiveNodes).toBe('function')
      expect(typeof client.vpn.getVPNStats).toBe('function')
    })

    test('otc has core methods', () => {
      if (skipTests) return
      expect(typeof client.otc.createConsignment).toBe('function')
      expect(typeof client.otc.createOffer).toBe('function')
      expect(typeof client.otc.listActiveConsignments).toBe('function')
      expect(typeof client.otc.fulfillOffer).toBe('function')
    })

    test('messaging has core methods', () => {
      if (skipTests) return
      expect(typeof client.messaging.registerNode).toBe('function')
      expect(typeof client.messaging.registerKey).toBe('function')
      expect(typeof client.messaging.getKey).toBe('function')
      expect(typeof client.messaging.heartbeat).toBe('function')
    })

    test('distributor has core methods', () => {
      if (skipTests) return
      expect(typeof client.distributor.createAirdrop).toBe('function')
      expect(typeof client.distributor.claimAirdrop).toBe('function')
      expect(typeof client.distributor.createVesting).toBe('function')
      expect(typeof client.distributor.releaseVested).toBe('function')
    })

    test('training has core methods', () => {
      if (skipTests) return
      expect(typeof client.training.createRun).toBe('function')
      expect(typeof client.training.joinRun).toBe('function')
      expect(typeof client.training.submitTrainingStep).toBe('function')
      expect(typeof client.training.getRunProgress).toBe('function')
    })
  })

  describe('Environment Status', () => {
    test('reports environment status', () => {
      if (skipTests) return

      console.log('\n  Environment Status:')
      console.log(`    Chain: ${env.chainRunning ? '✓' : '✗'}`)
      console.log(`    Contracts: ${env.contractsDeployed ? '✓' : '✗'}`)
      console.log(`    Services: ${env.servicesRunning ? '✓' : '✗'}`)

      expect(env).toBeDefined()
      expect(typeof env.chainRunning).toBe('boolean')
      expect(typeof env.contractsDeployed).toBe('boolean')
      expect(typeof env.servicesRunning).toBe('boolean')
    })
  })
})
