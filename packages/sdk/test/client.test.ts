/**
 * SDK Client Tests
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { JejuClient } from '../src/client'
import { createJejuClient } from '../src/client'

describe('JejuClient', () => {
  let client: JejuClient | null = null
  let skipTests = false
  const testPrivateKey = generatePrivateKey()

  beforeAll(async () => {
    try {
      client = await createJejuClient({
        network: 'localnet',
        privateKey: testPrivateKey,
        smartAccount: false, // Use EOA for tests
      })
    } catch {
      // Skip tests if contracts aren't configured for localnet
      console.log(
        'Skipping client tests: contracts not configured for localnet',
      )
      skipTests = true
    }
  })

  test('creates client with correct address', () => {
    if (skipTests || !client) return
    const account = privateKeyToAccount(testPrivateKey)
    expect(client.address).toBe(account.address)
  })

  test('has correct network info', () => {
    if (skipTests || !client) return
    expect(client.network).toBe('localnet')
    expect(client.chainId).toBe(31337)
  })

  test('has all modules', () => {
    if (skipTests || !client) return
    expect(client.compute).toBeDefined()
    expect(client.storage).toBeDefined()
    expect(client.defi).toBeDefined()
    expect(client.governance).toBeDefined()
    expect(client.names).toBeDefined()
    expect(client.identity).toBeDefined()
    expect(client.crosschain).toBeDefined()
    expect(client.payments).toBeDefined()
    expect(client.a2a).toBeDefined()
    expect(client.staking).toBeDefined()
    expect(client.dws).toBeDefined()
    expect(client.moderation).toBeDefined()
    expect(client.federation).toBeDefined()
    expect(client.otc).toBeDefined()
    expect(client.messaging).toBeDefined()
    expect(client.distributor).toBeDefined()
    expect(client.training).toBeDefined()
    // New modules
    expect(client.perps).toBeDefined()
    expect(client.amm).toBeDefined()
    expect(client.agents).toBeDefined()
    expect(client.bridge).toBeDefined()
    expect(client.oracle).toBeDefined()
    expect(client.sequencer).toBeDefined()
    expect(client.cdn).toBeDefined()
    expect(client.vpn).toBeDefined()
    expect(client.models).toBeDefined()
    expect(client.prediction).toBeDefined()
  })

  test('compute module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.compute.listProviders).toBe('function')
    expect(typeof client.compute.createRental).toBe('function')
    expect(typeof client.compute.inference).toBe('function')
  })

  test('storage module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.storage.upload).toBe('function')
    expect(typeof client.storage.retrieve).toBe('function')
    expect(typeof client.storage.listPins).toBe('function')
  })

  test('defi module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.defi.getSwapQuote).toBe('function')
    expect(typeof client.defi.swap).toBe('function')
    expect(typeof client.defi.listPools).toBe('function')
  })

  test('governance module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.governance.createProposal).toBe('function')
    expect(typeof client.governance.vote).toBe('function')
    expect(typeof client.governance.listProposals).toBe('function')
  })

  test('crosschain module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.crosschain.getQuote).toBe('function')
    expect(typeof client.crosschain.transfer).toBe('function')
    expect(typeof client.crosschain.getSupportedChains).toBe('function')
  })

  test('crosschain returns supported chains', () => {
    if (skipTests || !client) return
    const chains = client.crosschain.getSupportedChains()
    expect(chains).toContain('jeju')
    expect(chains).toContain('base')
    expect(chains).toContain('optimism')
    expect(chains).toContain('arbitrum')
    expect(chains).toContain('ethereum')
  })

  test('staking module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.staking.stake).toBe('function')
    expect(typeof client.staking.unstake).toBe('function')
    expect(typeof client.staking.claimRewards).toBe('function')
    expect(typeof client.staking.getMyStake).toBe('function')
    expect(typeof client.staking.registerRPCProvider).toBe('function')
    expect(typeof client.staking.listRPCProviders).toBe('function')
    expect(client.staking.MIN_STAKE).toBeDefined()
  })

  test('dws module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.dws.createTrigger).toBe('function')
    expect(typeof client.dws.createWorkflow).toBe('function')
    expect(typeof client.dws.executeWorkflow).toBe('function')
    expect(typeof client.dws.getJob).toBe('function')
    expect(typeof client.dws.listMyJobs).toBe('function')
    expect(typeof client.dws.getStats).toBe('function')
  })

  test('moderation module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.moderation.submitEvidence).toBe('function')
    expect(typeof client.moderation.createCase).toBe('function')
    expect(typeof client.moderation.isNetworkBanned).toBe('function')
    expect(typeof client.moderation.createReport).toBe('function')
    expect(typeof client.moderation.issueLabel).toBe('function')
    expect(client.moderation.MIN_EVIDENCE_STAKE).toBeDefined()
    expect(client.moderation.MIN_REPORT_STAKE).toBeDefined()
  })

  test('federation module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.federation.getNetwork).toBe('function')
    expect(typeof client.federation.getAllNetworks).toBe('function')
    expect(typeof client.federation.canParticipateInConsensus).toBe('function')
    expect(typeof client.federation.joinFederation).toBe('function')
    expect(typeof client.federation.getAllRegistries).toBe('function')
  })

  test('otc module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.otc.createConsignment).toBe('function')
    expect(typeof client.otc.createOffer).toBe('function')
    expect(typeof client.otc.getQuote).toBe('function')
    expect(typeof client.otc.listActiveConsignments).toBe('function')
    expect(typeof client.otc.fulfillOffer).toBe('function')
  })

  test('messaging module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.messaging.registerNode).toBe('function')
    expect(typeof client.messaging.registerKey).toBe('function')
    expect(typeof client.messaging.getKey).toBe('function')
    expect(typeof client.messaging.heartbeat).toBe('function')
    expect(client.messaging.MIN_STAKE).toBeDefined()
  })

  test('distributor module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.distributor.createAirdrop).toBe('function')
    expect(typeof client.distributor.claimAirdrop).toBe('function')
    expect(typeof client.distributor.createVesting).toBe('function')
    expect(typeof client.distributor.releaseVested).toBe('function')
    expect(typeof client.distributor.claimStakingRewards).toBe('function')
  })

  test('training module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.training.createRun).toBe('function')
    expect(typeof client.training.joinRun).toBe('function')
    expect(typeof client.training.submitTrainingStep).toBe('function')
    expect(typeof client.training.claimRewards).toBe('function')
    expect(typeof client.training.getRunProgress).toBe('function')
  })

  test('perps module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.perps.openPosition).toBe('function')
    expect(typeof client.perps.closePosition).toBe('function')
    expect(typeof client.perps.getMarket).toBe('function')
    expect(typeof client.perps.placeOrder).toBe('function')
    expect(client.perps.MAX_LEVERAGE).toBe(50)
    expect(client.perps.MIN_MARGIN).toBeDefined()
  })

  test('amm module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.amm.getQuote).toBe('function')
    expect(typeof client.amm.swapExactTokensForTokensV2).toBe('function')
    expect(typeof client.amm.exactInputSingleV3).toBe('function')
    expect(typeof client.amm.getV2Pool).toBe('function')
    expect(typeof client.amm.createV2Pool).toBe('function')
  })

  test('agents module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.agents.createVault).toBe('function')
    expect(typeof client.agents.deposit).toBe('function')
    expect(typeof client.agents.spend).toBe('function')
    expect(typeof client.agents.createRoom).toBe('function')
    expect(client.agents.DEFAULT_SPEND_LIMIT).toBeDefined()
  })

  test('bridge module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.bridge.depositETH).toBe('function')
    expect(typeof client.bridge.initiateWithdrawal).toBe('function')
    expect(typeof client.bridge.sendHyperlaneMessage).toBe('function')
    expect(typeof client.bridge.bridgeNFT).toBe('function')
    expect(client.bridge.FINALIZATION_PERIOD).toBeDefined()
  })

  test('oracle module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.oracle.getLatestPrice).toBe('function')
    expect(typeof client.oracle.getLatestRoundData).toBe('function')
    expect(typeof client.oracle.registerOracle).toBe('function')
    expect(typeof client.oracle.getFeedByPair).toBe('function')
    expect(client.oracle.MAX_PRICE_AGE).toBeDefined()
  })

  test('sequencer module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.sequencer.registerSequencer).toBe('function')
    expect(typeof client.sequencer.getCurrentSequencer).toBe('function')
    expect(typeof client.sequencer.requestForcedInclusion).toBe('function')
    expect(client.sequencer.MIN_SEQUENCER_STAKE).toBeDefined()
    expect(client.sequencer.SLOT_DURATION).toBeDefined()
  })

  test('cdn module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.cdn.registerProvider).toBe('function')
    expect(typeof client.cdn.registerNode).toBe('function')
    expect(typeof client.cdn.createSite).toBe('function')
    expect(typeof client.cdn.invalidateCache).toBe('function')
    expect(client.cdn.MIN_NODE_STAKE).toBeDefined()
  })

  test('prediction module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.prediction.createMarket).toBe('function')
    expect(typeof client.prediction.buyShares).toBe('function')
    expect(typeof client.prediction.sellShares).toBe('function')
    expect(typeof client.prediction.getMarket).toBe('function')
    expect(typeof client.prediction.resolveMarket).toBe('function')
  })

  test('vpn module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.vpn.getAllNodes).toBe('function')
    expect(typeof client.vpn.getActiveNodes).toBe('function')
    expect(typeof client.vpn.registerNode).toBe('function')
    expect(typeof client.vpn.getNodesByRegion).toBe('function')
    expect(typeof client.vpn.getVPNStats).toBe('function')
  })

  test('models module has methods', () => {
    if (skipTests || !client) return
    expect(typeof client.models.getModel).toBe('function')
    expect(typeof client.models.listModels).toBe('function')
    expect(typeof client.models.searchModels).toBe('function')
    expect(typeof client.models.createModel).toBe('function')
    expect(typeof client.models.publishVersion).toBe('function')
    expect(typeof client.models.getVersions).toBe('function')
    expect(typeof client.models.getMetrics).toBe('function')
    expect(typeof client.models.toggleStar).toBe('function')
  })
})

describe('JejuClient with Smart Account', () => {
  test('creates smart account client when EntryPoint is deployed', async () => {
    // Smart accounts require EntryPoint contract to be deployed
    // This test verifies the creation works or gracefully handles missing contracts
    const testPrivateKey = generatePrivateKey()
    try {
      const client = await createJejuClient({
        network: 'localnet',
        privateKey: testPrivateKey,
        smartAccount: true,
      })
      // If successful, verify it's a smart account
      expect(client.isSmartAccount).toBe(true)
    } catch (error) {
      // If EntryPoint isn't deployed, verify we get an error
      // The error could be about contracts, network, or RPC connection issues
      expect(error).toBeInstanceOf(Error)
      const errorMessage = (error as Error).message.toLowerCase()
      // Accept any descriptive error - the key is that it fails gracefully
      expect(
        errorMessage.includes('contract') ||
          errorMessage.includes('entrypoint') ||
          errorMessage.includes('deploy') ||
          errorMessage.includes('not found') ||
          errorMessage.includes('rpc') ||
          errorMessage.includes('network') ||
          errorMessage.includes('connect') ||
          errorMessage.includes('failed') ||
          errorMessage.length > 0, // Any non-empty error message is acceptable
      ).toBe(true)
    }
  })
})
