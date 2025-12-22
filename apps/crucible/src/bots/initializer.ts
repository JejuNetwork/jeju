/**
 * Bot Initializer
 *
 * Initializes default trading bots on startup
 */

import type { Address, PublicClient, WalletClient } from 'viem'
import { parseEther } from 'viem'
import type { AgentSDK } from '../sdk/agent'
import { createLogger, type Logger } from '../sdk/logger'
import type { CrucibleConfig } from '../types'
import {
  createTradingBotOptions,
  type DefaultBotConfig,
  getDefaultBotsForNetwork,
} from './default-bots'
import { TradingBot } from './trading-bot'

export interface BotInitializerConfig {
  crucibleConfig: CrucibleConfig
  agentSdk: AgentSDK
  publicClient: PublicClient
  walletClient: WalletClient
  treasuryAddress?: Address
  logger?: Logger
}

export class BotInitializer {
  private config: BotInitializerConfig
  private log: Logger
  private bots: Map<bigint, TradingBot> = new Map()

  constructor(config: BotInitializerConfig) {
    this.config = config
    this.log = config.logger ?? createLogger('BotInitializer')
  }

  async initializeDefaultBots(): Promise<Map<bigint, TradingBot>> {
    this.log.info('Initializing default bots', {
      network: this.config.crucibleConfig.network,
    })

    const defaultBots = getDefaultBotsForNetwork(
      this.config.crucibleConfig.network,
    )
    const initializedBots = new Map<bigint, TradingBot>()
    const privateKey = this.config.crucibleConfig.privateKey

    if (!privateKey) {
      this.log.warn('No private key configured, skipping bot initialization')
      return initializedBots
    }

    await Promise.allSettled(
      defaultBots.map(async (botConfig) => {
        const character = this.createBotCharacter(botConfig)
        const { agentId, vaultAddress } =
          await this.config.agentSdk.registerAgent(character, {
            initialFunding: parseEther(botConfig.initialFunding),
          })

        this.log.info('Bot agent registered', {
          name: botConfig.name,
          agentId: agentId.toString(),
          vaultAddress,
        })

        const botOptions = createTradingBotOptions(
          botConfig,
          agentId,
          privateKey,
          this.config.crucibleConfig.network,
          this.config.treasuryAddress,
        )

        const bot = new TradingBot(botOptions)
        await bot.initialize()
        await bot.start()

        initializedBots.set(agentId, bot)
        this.bots.set(agentId, bot)
        this.log.info('Bot initialized and started', {
          name: botConfig.name,
          agentId: agentId.toString(),
        })
      }),
    )

    this.log.info('Default bots initialization complete', {
      count: initializedBots.size,
    })
    return initializedBots
  }

  private createBotCharacter(botConfig: DefaultBotConfig) {
    return {
      id: `bot-${botConfig.name.toLowerCase().replace(/\s+/g, '-')}`,
      name: botConfig.name,
      description: botConfig.description,
      system: `You are ${botConfig.name}. ${botConfig.description}`,
      bio: [botConfig.description],
      messageExamples: [],
      topics: ['trading', 'arbitrage', 'mev'],
      adjectives: ['autonomous', 'efficient', 'profitable'],
      style: { all: [], chat: [], post: [] },
    }
  }

  getBot(agentId: bigint): TradingBot | undefined {
    return this.bots.get(agentId)
  }

  getAllBots(): TradingBot[] {
    return Array.from(this.bots.values())
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.bots.values()).map((bot) => bot.stop()),
    )
    this.bots.clear()
  }
}
