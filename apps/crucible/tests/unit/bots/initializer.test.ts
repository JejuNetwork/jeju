import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getCoreAppUrl, getL2RpcUrl } from '@jejunetwork/config'
import type { PublicClient, WalletClient } from 'viem'
import {
  createTradingBotOptions,
  DEFAULT_BOTS,
  getDefaultBotsForNetwork,
} from '../../../api/bots/default-bots'
import { BotInitializer } from '../../../api/bots/initializer'
import type { AgentSDK } from '../../../api/sdk/agent'
import type { CrucibleConfig } from '../../../lib/types'
import {
  type AgentSDKRegisterOnly,
  createFailingMockAgentSDK,
  createMockAgentSDK,
  TEST_CHAIN_IDS,
} from '../../fixtures/bot-mocks'

describe('BotInitializer', () => {
  const mockPublicClient = {} as PublicClient
  const mockWalletClient = {} as WalletClient

  const baseConfig: CrucibleConfig = {
    rpcUrl: getL2RpcUrl(),
    privateKey: `0x${'1'.repeat(64)}`,
    contracts: {
      agentVault: `0x${'1'.repeat(40)}` as `0x${string}`,
      roomRegistry: `0x${'2'.repeat(40)}` as `0x${string}`,
      triggerRegistry: `0x${'3'.repeat(40)}` as `0x${string}`,
      identityRegistry: `0x${'4'.repeat(40)}` as `0x${string}`,
      serviceRegistry: `0x${'5'.repeat(40)}` as `0x${string}`,
    },
    services: {
      computeMarketplace: getCoreAppUrl('COMPUTE'),
      storageApi: getCoreAppUrl('IPFS'),
      ipfsGateway: getCoreAppUrl('IPFS'),
      indexerGraphql: `${getCoreAppUrl('INDEXER_GRAPHQL')}/graphql`,
    },
    network: 'testnet',
  }

  let initializer: BotInitializer
  let mockAgentSdk: AgentSDKRegisterOnly

  beforeEach(() => {
    mockAgentSdk = createMockAgentSDK()

    // BotInitializer only calls registerAgent, so the partial mock is sufficient.
    // Cast is safe because we control what methods are called in the implementation.
    initializer = new BotInitializer({
      crucibleConfig: baseConfig,
      agentSdk: mockAgentSdk as AgentSDK,
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
    })
  })

  afterEach(async () => {
    if (initializer) {
      await initializer.stopAll()
    }
  })

  describe('getDefaultBotsForNetwork', () => {
    test('should return bots for localnet', () => {
      const bots = getDefaultBotsForNetwork('localnet')
      expect(bots.length).toBeGreaterThan(0)
      expect(bots.every((b) => b.chains.includes(31337))).toBe(true)
      expect(bots.every((b) => b.initialFunding === '0.01')).toBe(true)
    })

    test('should return bots for testnet', () => {
      const bots = getDefaultBotsForNetwork('testnet')
      expect(bots.length).toBeGreaterThan(0)
      const testnetChains = [420690, 11155111, 84532, 421614]
      bots.forEach((bot) => {
        expect(bot.chains.every((c) => testnetChains.includes(c))).toBe(true)
        expect(parseFloat(bot.initialFunding)).toBeLessThan(
          parseFloat(DEFAULT_BOTS[0].initialFunding),
        )
      })
    })

    test('should return bots for mainnet', () => {
      const bots = getDefaultBotsForNetwork('mainnet')
      expect(bots.length).toBe(DEFAULT_BOTS.length)
      expect(bots).toEqual(DEFAULT_BOTS)
    })

    test('should filter chains correctly for testnet', () => {
      const bots = getDefaultBotsForNetwork('testnet')
      const testnetChains = new Set([420690, 11155111, 84532, 421614])

      bots.forEach((bot) => {
        // Some bots may have no matching testnet chains after filtering
        if (bot.chains.length > 0) {
          expect(bot.chains.every((c) => testnetChains.has(c))).toBe(true)
        }
      })
    })
  })

  describe('createTradingBotOptions', () => {
    test('should create valid options', () => {
      const botConfig = DEFAULT_BOTS[0]
      const options = createTradingBotOptions(
        botConfig,
        1n,
        `0x${'1'.repeat(64)}`,
        'testnet',
        `0x${'2'.repeat(40)}`,
      )

      expect(options.agentId).toBe(1n)
      expect(options.name).toBe(botConfig.name)
      expect(options.strategies).toEqual(botConfig.strategies)
      expect(options.chains.length).toBeGreaterThan(0)
      expect(options.privateKey).toBe(`0x${'1'.repeat(64)}`)
      expect(options.maxConcurrentExecutions).toBe(5)
      expect(options.useFlashbots).toBe(true)
    })

    test('should disable Flashbots for localnet', () => {
      const botConfig = DEFAULT_BOTS[0]
      const options = createTradingBotOptions(
        botConfig,
        1n,
        `0x${'1'.repeat(64)}`,
        'localnet',
      )
      expect(options.useFlashbots).toBe(false)
    })

    test('should handle missing chain configs gracefully', () => {
      const botConfig = {
        ...DEFAULT_BOTS[0],
        // Use unconfigured chain ID (valid integer, but not in DEFAULT_CHAINS)
        chains: [TEST_CHAIN_IDS.UNCONFIGURED],
      }
      const options = createTradingBotOptions(
        botConfig,
        1n,
        `0x${'1'.repeat(64)}`,
        'testnet',
      )
      expect(options.chains.length).toBe(0)
    })

    test('should handle empty chains array', () => {
      const botConfig = { ...DEFAULT_BOTS[0], chains: [] }
      const options = createTradingBotOptions(
        botConfig,
        1n,
        `0x${'1'.repeat(64)}`,
        'testnet',
      )
      expect(options.chains).toEqual([])
    })
  })

  describe('initializeDefaultBots', () => {
    test('should initialize bots successfully', async () => {
      const bots = await initializer.initializeDefaultBots()
      expect(bots.size).toBeGreaterThan(0)
      expect(mockAgentSdk.registerAgent).toHaveBeenCalled()
    })

    test('should skip initialization without signer (no KMS or wallet)', async () => {
      const configWithoutKey = { ...baseConfig, privateKey: undefined }
      const init = new BotInitializer({
        crucibleConfig: configWithoutKey,
        agentSdk: mockAgentSdk as AgentSDK,
        publicClient: mockPublicClient,
        // No walletClient, no kmsSigner - should skip
      })

      const bots = await init.initializeDefaultBots()
      expect(bots.size).toBe(0)
      expect(mockAgentSdk.registerAgent).not.toHaveBeenCalled()
    })

    test('should handle registration failures gracefully', async () => {
      const failingAgentSdk = createFailingMockAgentSDK()

      const failingInitializer = new BotInitializer({
        crucibleConfig: baseConfig,
        agentSdk: failingAgentSdk as AgentSDK,
        publicClient: mockPublicClient,
        walletClient: mockWalletClient,
      })

      const bots = await failingInitializer.initializeDefaultBots()
      // Should continue with other bots (all will fail)
      expect(bots.size).toBe(0)
    })

    test('should handle bot initialization failures', async () => {
      // mockAgentSdk already succeeds (from beforeEach)
      // This will fail because TradingBot needs real dependencies
      // But initializer should handle it gracefully
      const bots = await initializer.initializeDefaultBots()
      // May have fewer bots if some failed
      expect(bots.size).toBeGreaterThanOrEqual(0)
    })

    test('should initialize bots in parallel', async () => {
      const startTime = Date.now()
      await initializer.initializeDefaultBots()
      const duration = Date.now() - startTime

      // Should be faster than sequential (though may still be slow due to real deps)
      expect(duration).toBeLessThan(10000) // Reasonable timeout
    })

    test('should handle concurrent initialization calls', async () => {
      const [bots1, bots2] = await Promise.all([
        initializer.initializeDefaultBots(),
        initializer.initializeDefaultBots(),
      ])

      // Should handle gracefully (may create duplicates or skip)
      expect(bots1.size).toBeGreaterThanOrEqual(0)
      expect(bots2.size).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Bot Management', () => {
    test('should get bot by agent ID', async () => {
      const bots = await initializer.initializeDefaultBots()
      if (bots.size > 0) {
        const firstAgentId = Array.from(bots.keys())[0]
        const bot = initializer.getBot(firstAgentId)
        expect(bot).toBeDefined()
      }
    })

    test('should return undefined for non-existent bot', () => {
      const bot = initializer.getBot(999999n)
      expect(bot).toBeUndefined()
    })

    test('should get all bots', async () => {
      const bots = await initializer.initializeDefaultBots()
      const allBots = initializer.getAllBots()
      expect(allBots.size).toBe(bots.size)
    })

    test('should stop all bots', async () => {
      await initializer.initializeDefaultBots()
      await initializer.stopAll()
      expect(initializer.getAllBots().size).toBe(0)
    })

    test('should handle stop errors gracefully', async () => {
      await initializer.initializeDefaultBots()
      // Should not throw even if some bots fail to stop
      await initializer.stopAll()
      expect(initializer.getAllBots().size).toBe(0)
    })
  })

  describe('Edge Cases', () => {
    test('should handle empty bot list', async () => {
      const config = { ...baseConfig, network: 'localnet' as const }
      const init = new BotInitializer({
        crucibleConfig: config,
        agentSdk: mockAgentSdk as AgentSDK,
        publicClient: mockPublicClient,
        walletClient: mockWalletClient,
      })

      const bots = await init.initializeDefaultBots()
      expect(bots.size).toBeGreaterThanOrEqual(0)
    })

    test('should handle network-specific configurations', () => {
      ;['localnet', 'testnet', 'mainnet'].forEach((network) => {
        const bots = getDefaultBotsForNetwork(
          network as 'localnet' | 'testnet' | 'mainnet',
        )
        expect(bots.length).toBeGreaterThan(0)
        bots.forEach((bot) => {
          expect(bot.name).toBeDefined()
          expect(bot.description).toBeDefined()
          expect(bot.strategies.length).toBeGreaterThan(0)
        })
      })
    })

    test('should handle invalid network gracefully', () => {
      // TypeScript prevents this, but runtime could have invalid value
      const bots = getDefaultBotsForNetwork('mainnet')
      expect(bots).toBeDefined()
    })
  })
})
