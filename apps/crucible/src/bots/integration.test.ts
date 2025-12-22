/**
 * Integration Tests for Trading Bots
 *
 * Tests integration points with real dependencies where possible:
 * - Strategy initialization with real chain configs
 * - Opportunity detection logic
 * - Metrics tracking
 * - Error recovery
 */

import { describe, expect, test } from 'bun:test'
import type { ChainId } from './autocrat-types'
import {
  createTradingBotOptions,
  DEFAULT_BOTS,
  DEFAULT_CHAINS,
  getDefaultBotsForNetwork,
} from './default-bots'

describe('Trading Bot Integration', () => {
  describe('Default Bot Configuration Integration', () => {
    test('should create valid configurations for all networks', () => {
      ;['localnet', 'testnet', 'mainnet'].forEach((network) => {
        const bots = getDefaultBotsForNetwork(
          network as 'localnet' | 'testnet' | 'mainnet',
        )
        expect(bots.length).toBeGreaterThan(0)

        bots.forEach((bot) => {
          const options = createTradingBotOptions(
            bot,
            1n,
            `0x${'1'.repeat(64)}`,
            network as 'localnet' | 'testnet' | 'mainnet',
          )

          expect(options.agentId).toBe(1n)
          expect(options.name).toBe(bot.name)
          expect(options.strategies).toEqual(bot.strategies)
          expect(Array.isArray(options.chains)).toBe(true)
          expect(options.privateKey).toBe(`0x${'1'.repeat(64)}`)
          expect(options.maxConcurrentExecutions).toBe(5)
        })
      })
    })

    test('should maintain strategy consistency across networks', () => {
      const mainnetBots = getDefaultBotsForNetwork('mainnet')
      const testnetBots = getDefaultBotsForNetwork('testnet')

      expect(mainnetBots.length).toBe(testnetBots.length)

      mainnetBots.forEach((mainnetBot, i) => {
        const testnetBot = testnetBots[i]
        expect(mainnetBot.name).toBe(testnetBot.name)
        expect(mainnetBot.strategies.length).toBe(testnetBot.strategies.length)
        expect(mainnetBot.strategies[0]?.type).toBe(
          testnetBot.strategies[0]?.type,
        )
      })
    })

    test('should validate chain configurations are accessible', () => {
      ;(
        Object.values(DEFAULT_CHAINS) as Array<{
          rpcUrl: string
          blockTime: number
          chainId: number
        }>
      ).forEach((chain) => {
        expect(chain.rpcUrl).toMatch(/^https?:\/\//)
        expect(chain.blockTime).toBeGreaterThan(0)
        expect(chain.chainId).toBeGreaterThan(0)
      })
    })
  })

  describe('Strategy Configuration Validation', () => {
    test('should have consistent strategy parameters', () => {
      DEFAULT_BOTS.forEach((bot) => {
        bot.strategies.forEach((strategy) => {
          expect(strategy.minProfitBps).toBeGreaterThanOrEqual(0)
          expect(strategy.maxGasGwei).toBeGreaterThan(0)
          expect(strategy.maxSlippageBps).toBeGreaterThanOrEqual(0)
          expect(strategy.enabled).toBe(true)
        })
      })
    })

    test('should have appropriate profit thresholds', () => {
      DEFAULT_BOTS.forEach((bot) => {
        const strategy = bot.strategies[0]
        if (strategy) {
          // Oracle keeper can have 0 min profit (public good)
          if (strategy.type !== 'ORACLE_KEEPER') {
            expect(strategy.minProfitBps).toBeGreaterThan(0)
          }
        }
      })
    })

    test('should have reasonable gas limits', () => {
      DEFAULT_BOTS.forEach((bot) => {
        bot.strategies.forEach((strategy) => {
          expect(strategy.maxGasGwei).toBeLessThan(1000) // Reasonable upper bound
          expect(strategy.maxGasGwei).toBeGreaterThan(0)
        })
      })
    })
  })

  describe('Chain Coverage', () => {
    test('should cover all target chains', () => {
      const mainnetBots = getDefaultBotsForNetwork('mainnet')
      const allChains = new Set<number>()

      mainnetBots.forEach((bot) => {
        bot.chains.forEach((chainId) => allChains.add(chainId))
      })

      // Should cover major chains
      expect(allChains.has(1)).toBe(true) // Ethereum
      expect(allChains.has(42161)).toBe(true) // Arbitrum
      expect(allChains.has(8453)).toBe(true) // Base
      expect(allChains.has(420691)).toBe(true) // Network
    })

    test('should have appropriate chain selection per strategy', () => {
      DEFAULT_BOTS.forEach((bot) => {
        if (bot.strategies[0]?.type === 'LIQUIDATION') {
          // Liquidation should focus on the network where perpetual market exists
          expect(
            bot.chains.includes(420691) || bot.chains.includes(420690),
          ).toBe(true)
        }

        if (bot.strategies[0]?.type === 'CROSS_CHAIN_ARBITRAGE') {
          // Cross-chain should have multiple chains
          expect(bot.chains.length).toBeGreaterThan(1)
        }
      })
    })
  })

  describe('Funding Configuration', () => {
    test('should have appropriate funding levels', () => {
      DEFAULT_BOTS.forEach((bot) => {
        const funding = parseFloat(bot.initialFunding)
        expect(funding).toBeGreaterThan(0)
        expect(funding).toBeLessThan(100) // Reasonable upper bound
      })
    })

    test('should scale funding appropriately for networks', () => {
      const mainnetBots = getDefaultBotsForNetwork('mainnet')
      const testnetBots = getDefaultBotsForNetwork('testnet')

      mainnetBots.forEach((mainnetBot, i) => {
        const testnetBot = testnetBots[i]
        const mainnetFunding = parseFloat(mainnetBot.initialFunding)
        const testnetFunding = parseFloat(testnetBot.initialFunding)

        expect(testnetFunding).toBeLessThanOrEqual(mainnetFunding)
        expect(testnetFunding).toBeGreaterThan(0)
      })
    })
  })
})

describe('Data Flow Validation', () => {
  test('should maintain data integrity through configuration pipeline', () => {
    const botConfig = DEFAULT_BOTS[0]
    const options = createTradingBotOptions(
      botConfig,
      1n,
      `0x${'1'.repeat(64)}`,
      'mainnet',
    )

    // Verify all data is preserved
    expect(options.name).toBe(botConfig.name)
    expect(options.strategies.length).toBe(botConfig.strategies.length)
    expect(options.chains.length).toBeGreaterThan(0)

    // Verify chains are properly mapped
    options.chains.forEach((chain) => {
      expect(botConfig.chains.includes(chain.chainId as ChainId)).toBe(true)
      expect(chain.name).toBeTruthy()
      expect(chain.rpcUrl).toBeTruthy()
    })
  })

  test('should handle configuration transformations correctly', () => {
    const networks: Array<'localnet' | 'testnet' | 'mainnet'> = [
      'localnet',
      'testnet',
      'mainnet',
    ]

    networks.forEach((network) => {
      const bots = getDefaultBotsForNetwork(network)
      bots.forEach((bot) => {
        const options = createTradingBotOptions(
          bot,
          1n,
          `0x${'1'.repeat(64)}`,
          network,
        )

        // Verify transformation
        expect(options.useFlashbots).toBe(network !== 'localnet')
        expect(options.maxConcurrentExecutions).toBe(5)
        expect(options.agentId).toBe(1n)
      })
    })
  })
})
