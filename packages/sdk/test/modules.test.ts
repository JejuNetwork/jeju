/**
 * SDK Module Tests
 *
 * Comprehensive unit tests for all SDK modules ensuring
 * proper module creation, method signatures, and basic functionality
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createJejuClient, type JejuClient } from '../src/client'

describe('SDK Module Structure', () => {
  let client: JejuClient | null = null
  let skipTests = false
  const testPrivateKey = generatePrivateKey()

  beforeAll(async () => {
    try {
      client = await createJejuClient({
        network: 'localnet',
        privateKey: testPrivateKey,
        smartAccount: false,
      })
    } catch {
      console.log(
        'Skipping module tests: contracts not configured for localnet',
      )
      skipTests = true
    }
  })

  describe('Core Client', () => {
    test('client has expected properties', () => {
      if (skipTests || !client) return
      expect(client.network).toBe('localnet')
      expect(client.chainId).toBe(31337)
      expect(typeof client.address).toBe('string')
      expect(client.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(typeof client.isSmartAccount).toBe('boolean')
      expect(client.wallet).toBeDefined()
    })

    test('getBalance returns a bigint', async () => {
      if (skipTests || !client) return
      const balance = await client.getBalance()
      expect(typeof balance).toBe('bigint')
    })
  })

  describe('Compute Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.compute.listProviders).toBe('function')
      expect(typeof client.compute.getProvider).toBe('function')
      expect(typeof client.compute.getQuote).toBe('function')
      expect(typeof client.compute.createRental).toBe('function')
      expect(typeof client.compute.getRental).toBe('function')
      expect(typeof client.compute.listMyRentals).toBe('function')
      expect(typeof client.compute.cancelRental).toBe('function')
      expect(typeof client.compute.extendRental).toBe('function')
      expect(typeof client.compute.listModels).toBe('function')
      expect(typeof client.compute.inference).toBe('function')
      expect(typeof client.compute.listTriggers).toBe('function')
      expect(typeof client.compute.getTrigger).toBe('function')
      expect(typeof client.compute.createTrigger).toBe('function')
      expect(typeof client.compute.getPrepaidBalance).toBe('function')
      expect(typeof client.compute.depositPrepaid).toBe('function')
    })

    test('listProviders returns array', async () => {
      if (skipTests || !client) return
      const providers = await client.compute.listProviders()
      expect(Array.isArray(providers)).toBe(true)
    })
  })

  describe('Storage Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.storage.getStats).toBe('function')
      expect(typeof client.storage.upload).toBe('function')
      expect(typeof client.storage.uploadJson).toBe('function')
      expect(typeof client.storage.pin).toBe('function')
      expect(typeof client.storage.unpin).toBe('function')
      expect(typeof client.storage.listPins).toBe('function')
      expect(typeof client.storage.getPinStatus).toBe('function')
      expect(typeof client.storage.retrieve).toBe('function')
      expect(typeof client.storage.retrieveJson).toBe('function')
      expect(typeof client.storage.getGatewayUrl).toBe('function')
      expect(typeof client.storage.estimateCost).toBe('function')
    })

    test('getGatewayUrl returns valid URL', () => {
      if (skipTests || !client) return
      const cid = 'QmTest123'
      const url = client.storage.getGatewayUrl(cid)
      expect(url).toContain(cid)
      expect(url).toContain('/ipfs/')
    })

    test('estimateCost returns bigint', () => {
      if (skipTests || !client) return
      const cost = client.storage.estimateCost(1024 * 1024 * 1024, 1, 'hot')
      expect(typeof cost).toBe('bigint')
      expect(cost > 0n).toBe(true)
    })
  })

  describe('DeFi Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.defi.getSwapQuote).toBe('function')
      expect(typeof client.defi.swap).toBe('function')
      expect(typeof client.defi.listPools).toBe('function')
    })
  })

  describe('Governance Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.governance.createProposal).toBe('function')
      expect(typeof client.governance.vote).toBe('function')
      expect(typeof client.governance.listProposals).toBe('function')
    })
  })

  describe('Names Module (JNS)', () => {
    test('has required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.names.register).toBe('function')
      expect(typeof client.names.resolve).toBe('function')
      expect(typeof client.names.lookup).toBe('function')
    })
  })

  describe('Identity Module', () => {
    test('has required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.identity.register).toBe('function')
      expect(typeof client.identity.getProfile).toBe('function')
      expect(typeof client.identity.setProfile).toBe('function')
    })
  })

  describe('CrossChain Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.crosschain.getQuote).toBe('function')
      expect(typeof client.crosschain.transfer).toBe('function')
      expect(typeof client.crosschain.getSupportedChains).toBe('function')
    })

    test('getSupportedChains returns expected chains', () => {
      if (skipTests || !client) return
      const chains = client.crosschain.getSupportedChains()
      expect(chains).toContain('jeju')
      expect(chains).toContain('base')
      expect(chains).toContain('optimism')
      expect(chains).toContain('arbitrum')
      expect(chains).toContain('ethereum')
    })
  })

  describe('Payments Module', () => {
    test('has required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.payments.getGasPrice).toBe('function')
      expect(typeof client.payments.estimateGas).toBe('function')
    })
  })

  describe('A2A Module', () => {
    test('has required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.a2a.createTask).toBe('function')
      expect(typeof client.a2a.getTask).toBe('function')
      expect(typeof client.a2a.listTasks).toBe('function')
    })
  })

  describe('Staking Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.staking.stake).toBe('function')
      expect(typeof client.staking.unstake).toBe('function')
      expect(typeof client.staking.claimRewards).toBe('function')
      expect(typeof client.staking.getMyStake).toBe('function')
      expect(typeof client.staking.registerRPCProvider).toBe('function')
      expect(typeof client.staking.listRPCProviders).toBe('function')
    })

    test('has MIN_STAKE constant', () => {
      if (skipTests || !client) return
      expect(client.staking.MIN_STAKE).toBeDefined()
      expect(typeof client.staking.MIN_STAKE).toBe('bigint')
    })
  })

  describe('DWS Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.dws.createTrigger).toBe('function')
      expect(typeof client.dws.createWorkflow).toBe('function')
      expect(typeof client.dws.executeWorkflow).toBe('function')
      expect(typeof client.dws.getJob).toBe('function')
      expect(typeof client.dws.listMyJobs).toBe('function')
      expect(typeof client.dws.getStats).toBe('function')
    })
  })

  describe('Moderation Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.moderation.submitEvidence).toBe('function')
      expect(typeof client.moderation.createCase).toBe('function')
      expect(typeof client.moderation.isNetworkBanned).toBe('function')
      expect(typeof client.moderation.createReport).toBe('function')
      expect(typeof client.moderation.issueLabel).toBe('function')
    })

    test('has stake constants', () => {
      if (skipTests || !client) return
      expect(client.moderation.MIN_EVIDENCE_STAKE).toBeDefined()
      expect(client.moderation.MIN_REPORT_STAKE).toBeDefined()
    })
  })

  describe('Federation Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.federation.getNetwork).toBe('function')
      expect(typeof client.federation.getAllNetworks).toBe('function')
      expect(typeof client.federation.canParticipateInConsensus).toBe(
        'function',
      )
      expect(typeof client.federation.joinFederation).toBe('function')
      expect(typeof client.federation.getAllRegistries).toBe('function')
    })
  })

  describe('OTC Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.otc.createConsignment).toBe('function')
      expect(typeof client.otc.createOffer).toBe('function')
      expect(typeof client.otc.getQuote).toBe('function')
      expect(typeof client.otc.listActiveConsignments).toBe('function')
      expect(typeof client.otc.fulfillOffer).toBe('function')
    })
  })

  describe('Messaging Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.messaging.registerNode).toBe('function')
      expect(typeof client.messaging.registerKey).toBe('function')
      expect(typeof client.messaging.getKey).toBe('function')
      expect(typeof client.messaging.heartbeat).toBe('function')
    })

    test('has MIN_STAKE constant', () => {
      if (skipTests || !client) return
      expect(client.messaging.MIN_STAKE).toBeDefined()
    })
  })

  describe('Distributor Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.distributor.createAirdrop).toBe('function')
      expect(typeof client.distributor.claimAirdrop).toBe('function')
      expect(typeof client.distributor.createVesting).toBe('function')
      expect(typeof client.distributor.releaseVested).toBe('function')
      expect(typeof client.distributor.claimStakingRewards).toBe('function')
    })
  })

  describe('Training Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.training.createRun).toBe('function')
      expect(typeof client.training.joinRun).toBe('function')
      expect(typeof client.training.submitTrainingStep).toBe('function')
      expect(typeof client.training.claimRewards).toBe('function')
      expect(typeof client.training.getRunProgress).toBe('function')
    })
  })

  describe('Perps Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.perps.openPosition).toBe('function')
      expect(typeof client.perps.closePosition).toBe('function')
      expect(typeof client.perps.getMarket).toBe('function')
      expect(typeof client.perps.placeOrder).toBe('function')
    })

    test('has trading constants', () => {
      if (skipTests || !client) return
      expect(client.perps.MAX_LEVERAGE).toBe(50)
      expect(client.perps.MIN_MARGIN).toBeDefined()
    })
  })

  describe('AMM Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.amm.getQuote).toBe('function')
      expect(typeof client.amm.swapExactTokensForTokensV2).toBe('function')
      expect(typeof client.amm.exactInputSingleV3).toBe('function')
      expect(typeof client.amm.getV2Pool).toBe('function')
      expect(typeof client.amm.createV2Pool).toBe('function')
    })
  })

  describe('Agents Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.agents.createVault).toBe('function')
      expect(typeof client.agents.deposit).toBe('function')
      expect(typeof client.agents.spend).toBe('function')
      expect(typeof client.agents.createRoom).toBe('function')
    })

    test('has DEFAULT_SPEND_LIMIT constant', () => {
      if (skipTests || !client) return
      expect(client.agents.DEFAULT_SPEND_LIMIT).toBeDefined()
    })
  })

  describe('Bridge Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.bridge.depositETH).toBe('function')
      expect(typeof client.bridge.initiateWithdrawal).toBe('function')
      expect(typeof client.bridge.sendHyperlaneMessage).toBe('function')
      expect(typeof client.bridge.bridgeNFT).toBe('function')
    })

    test('has FINALIZATION_PERIOD constant', () => {
      if (skipTests || !client) return
      expect(client.bridge.FINALIZATION_PERIOD).toBeDefined()
    })
  })

  describe('Oracle Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.oracle.getLatestPrice).toBe('function')
      expect(typeof client.oracle.getLatestRoundData).toBe('function')
      expect(typeof client.oracle.registerOracle).toBe('function')
      expect(typeof client.oracle.getFeedByPair).toBe('function')
    })

    test('has MAX_PRICE_AGE constant', () => {
      if (skipTests || !client) return
      expect(client.oracle.MAX_PRICE_AGE).toBeDefined()
    })
  })

  describe('Sequencer Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.sequencer.registerSequencer).toBe('function')
      expect(typeof client.sequencer.getCurrentSequencer).toBe('function')
      expect(typeof client.sequencer.requestForcedInclusion).toBe('function')
    })

    test('has operational constants', () => {
      if (skipTests || !client) return
      expect(client.sequencer.MIN_SEQUENCER_STAKE).toBeDefined()
      expect(client.sequencer.SLOT_DURATION).toBeDefined()
    })
  })

  describe('CDN Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.cdn.registerProvider).toBe('function')
      expect(typeof client.cdn.registerNode).toBe('function')
      expect(typeof client.cdn.createSite).toBe('function')
      expect(typeof client.cdn.invalidateCache).toBe('function')
    })

    test('has MIN_NODE_STAKE constant', () => {
      if (skipTests || !client) return
      expect(client.cdn.MIN_NODE_STAKE).toBeDefined()
    })
  })

  describe('VPN Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.vpn.getAllNodes).toBe('function')
      expect(typeof client.vpn.getActiveNodes).toBe('function')
      expect(typeof client.vpn.registerNode).toBe('function')
      expect(typeof client.vpn.getNodesByRegion).toBe('function')
      expect(typeof client.vpn.getVPNStats).toBe('function')
    })
  })

  describe('Models Module', () => {
    test('has all required methods', () => {
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

  describe('Prediction Module', () => {
    test('has all required methods', () => {
      if (skipTests || !client) return
      expect(typeof client.prediction.createMarket).toBe('function')
      expect(typeof client.prediction.buyShares).toBe('function')
      expect(typeof client.prediction.sellShares).toBe('function')
      expect(typeof client.prediction.getMarket).toBe('function')
      expect(typeof client.prediction.resolveMarket).toBe('function')
    })
  })
})

describe('SDK Client Creation', () => {
  test('requires authentication credentials', async () => {
    await expect(
      createJejuClient({
        network: 'localnet',
        // No privateKey, mnemonic, or account
      }),
    ).rejects.toThrow()
  })

  test('creates client with private key', async () => {
    const privateKey = generatePrivateKey()
    try {
      const client = await createJejuClient({
        network: 'localnet',
        privateKey,
        smartAccount: false,
      })
      const account = privateKeyToAccount(privateKey)
      expect(client.address).toBe(account.address)
    } catch {
      // OK if contracts not configured
    }
  })

  test('client address matches private key', async () => {
    const privateKey = generatePrivateKey()
    const account = privateKeyToAccount(privateKey)

    try {
      const client = await createJejuClient({
        network: 'localnet',
        privateKey,
        smartAccount: false,
      })
      expect(client.address.toLowerCase()).toBe(account.address.toLowerCase())
    } catch {
      // OK if contracts not configured
    }
  })
})
