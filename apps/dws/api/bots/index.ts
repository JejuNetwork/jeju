import { getCurrentNetwork, type NetworkType } from '@jejunetwork/config'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'
import { getExternalRPCNodeService } from '../external-chains'

export const BotTypeSchema = z.enum([
  'DEX_ARBITRAGE',
  'SANDWICH',
  'LIQUIDATION',
  'ORACLE_KEEPER',
  'CROSS_CHAIN_ARBITRAGE',
  'OIF_SOLVER',
])
export type BotType = z.infer<typeof BotTypeSchema>

export const BotStatusSchema = z.enum([
  'pending',
  'deploying',
  'running',
  'paused',
  'stopped',
  'error',
])
export type BotStatus = z.infer<typeof BotStatusSchema>

export interface BotConfig {
  type: BotType
  name: string
  description: string
  enabled: boolean
  chains: number[] // Chain IDs to operate on
  strategies: BotStrategy[]
  initialFunding: bigint
  maxPositionSize: bigint
  minProfitBps: number
  maxGasGwei: number
  maxSlippageBps: number
  cooldownMs: number
  teeRequired: boolean
}

export interface BotStrategy {
  type: BotType
  enabled: boolean
  params: Record<string, number | string | boolean>
}

export interface BotInstance {
  botId: Hex
  type: BotType
  name: string
  status: BotStatus
  containerId: string
  owner: Address
  walletAddress: Address
  deployedAt: number
  lastHeartbeat: number
  metrics: BotMetrics
  config: BotConfig
}

export interface BotMetrics {
  uptime: number
  totalTrades: number
  successfulTrades: number
  totalVolume: bigint
  totalProfit: bigint
  gasSpent: bigint
  lastTradeAt: number
}

// ============================================================================
// Bot Configurations
// ============================================================================

const DEFAULT_BOT_CONFIGS: Record<
  BotType,
  Omit<BotConfig, 'initialFunding'>
> = {
  DEX_ARBITRAGE: {
    type: 'DEX_ARBITRAGE',
    name: 'DEX Arbitrage Bot',
    description:
      'Detects and executes DEX arbitrage opportunities across pools',
    enabled: true,
    chains: [1, 42161, 10, 8453], // ETH, ARB, OP, BASE
    strategies: [
      {
        type: 'DEX_ARBITRAGE',
        enabled: true,
        params: {
          minProfitBps: 10,
          maxGasGwei: 100,
          maxSlippageBps: 50,
        },
      },
    ],
    maxPositionSize: BigInt('1000000000000000000'), // 1 ETH
    minProfitBps: 10,
    maxGasGwei: 100,
    maxSlippageBps: 50,
    cooldownMs: 1000,
    teeRequired: false,
  },
  SANDWICH: {
    type: 'SANDWICH',
    name: 'Sandwich Bot',
    description: 'Executes sandwich attacks on pending transactions',
    enabled: true,
    chains: [1, 42161, 10, 8453],
    strategies: [
      {
        type: 'SANDWICH',
        enabled: true,
        params: {
          minProfitBps: 50,
          maxGasGwei: 200,
          mempool: true,
        },
      },
    ],
    maxPositionSize: BigInt('5000000000000000000'), // 5 ETH
    minProfitBps: 50,
    maxGasGwei: 200,
    maxSlippageBps: 100,
    cooldownMs: 500,
    teeRequired: false,
  },
  LIQUIDATION: {
    type: 'LIQUIDATION',
    name: 'Liquidation Bot',
    description:
      'Liquidates undercollateralized positions on lending protocols',
    enabled: true,
    chains: [1, 42161, 10, 8453],
    strategies: [
      {
        type: 'LIQUIDATION',
        enabled: true,
        params: {
          protocols: 'aave,compound,morpho',
          minProfitBps: 100,
          flashLoanEnabled: true,
        },
      },
    ],
    maxPositionSize: BigInt('10000000000000000000'), // 10 ETH
    minProfitBps: 100,
    maxGasGwei: 150,
    maxSlippageBps: 50,
    cooldownMs: 5000,
    teeRequired: false,
  },
  ORACLE_KEEPER: {
    type: 'ORACLE_KEEPER',
    name: 'Oracle Keeper Bot',
    description: 'Keeps price oracles updated for protocols',
    enabled: true,
    chains: [1, 42161, 10, 8453],
    strategies: [
      {
        type: 'ORACLE_KEEPER',
        enabled: true,
        params: {
          deviationThresholdBps: 50,
          heartbeatSeconds: 3600,
        },
      },
    ],
    maxPositionSize: BigInt('100000000000000000'), // 0.1 ETH
    minProfitBps: 0, // Keeper rewards
    maxGasGwei: 50,
    maxSlippageBps: 10,
    cooldownMs: 60000,
    teeRequired: false,
  },
  CROSS_CHAIN_ARBITRAGE: {
    type: 'CROSS_CHAIN_ARBITRAGE',
    name: 'Cross-Chain Arbitrage Bot',
    description: 'Arbitrages price differences across chains',
    enabled: true,
    chains: [1, 42161, 10, 8453],
    strategies: [
      {
        type: 'CROSS_CHAIN_ARBITRAGE',
        enabled: true,
        params: {
          minProfitBps: 50,
          bridgeProtocols: 'across,stargate,hop',
        },
      },
    ],
    maxPositionSize: BigInt('2000000000000000000'), // 2 ETH
    minProfitBps: 50,
    maxGasGwei: 100,
    maxSlippageBps: 100,
    cooldownMs: 30000,
    teeRequired: false,
  },
  OIF_SOLVER: {
    type: 'OIF_SOLVER',
    name: 'OIF Solver Bot',
    description: 'Solves Open Intent Framework intents',
    enabled: true,
    chains: [1, 42161, 10, 8453],
    strategies: [
      {
        type: 'OIF_SOLVER',
        enabled: true,
        params: {
          minProfitBps: 5,
          maxConcurrent: 10,
        },
      },
    ],
    maxPositionSize: BigInt('5000000000000000000'), // 5 ETH
    minProfitBps: 5,
    maxGasGwei: 100,
    maxSlippageBps: 30,
    cooldownMs: 1000,
    teeRequired: false,
  },
}

// Container images for each bot type
const BOT_IMAGES: Record<BotType, string> = {
  DEX_ARBITRAGE: 'ghcr.io/jejunetwork/crucible-bot:latest',
  SANDWICH: 'ghcr.io/jejunetwork/crucible-bot:latest',
  LIQUIDATION: 'ghcr.io/jejunetwork/crucible-bot:latest',
  ORACLE_KEEPER: 'ghcr.io/jejunetwork/crucible-bot:latest',
  CROSS_CHAIN_ARBITRAGE: 'ghcr.io/jejunetwork/crucible-bot:latest',
  OIF_SOLVER: 'ghcr.io/jejunetwork/crucible-bot:latest',
}

// ============================================================================
// Bot Deployment Service
// ============================================================================

export class BotDeploymentService {
  private bots: Map<string, BotInstance> = new Map()
  private network: NetworkType
  private heartbeatIntervals: Map<string, Timer> = new Map()
  private initialized = false

  constructor() {
    this.network = getCurrentNetwork()
  }

  /**
   * Initialize the bot deployment service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    console.log('[BotDeployment] Initializing...')
    console.log(`[BotDeployment] Network: ${this.network}`)

    // Load existing bot state
    await this.loadBotState()

    this.initialized = true
    console.log('[BotDeployment] Initialized')
  }

  /**
   * Deploy a new bot
   */
  async deployBot(
    type: BotType,
    owner: Address,
    options?: Partial<BotConfig>,
  ): Promise<BotInstance> {
    // Verify RPC nodes are available
    const rpcService = getExternalRPCNodeService()
    if (!rpcService.areEVMNodesReady()) {
      throw new Error(
        'EVM RPC nodes not ready. Cannot deploy bot without price feeds.',
      )
    }

    const defaultConfig = DEFAULT_BOT_CONFIGS[type]
    const config: BotConfig = {
      ...defaultConfig,
      ...options,
      initialFunding: options?.initialFunding ?? BigInt('100000000000000000'), // 0.1 ETH default
    }

    const botId = this.generateBotId(type, owner)
    const containerName = `jeju-bot-${type.toLowerCase()}-${botId.slice(0, 8)}`

    console.log(`[BotDeployment] Deploying ${type} bot...`)
    console.log(`[BotDeployment] Container: ${containerName}`)
    console.log(`[BotDeployment] Owner: ${owner}`)

    // Check if bot already exists
    const existingBot = this.bots.get(botId)
    if (existingBot && existingBot.status !== 'stopped') {
      console.log(`[BotDeployment] Bot already exists: ${botId}`)
      return existingBot
    }

    // Generate bot wallet (in production, use TEE-derived key)
    const walletAddress = this.deriveWalletAddress(botId)

    // Create bot instance
    const bot: BotInstance = {
      botId,
      type,
      name: config.name,
      status: 'deploying',
      containerId: containerName,
      owner,
      walletAddress,
      deployedAt: Date.now(),
      lastHeartbeat: Date.now(),
      metrics: {
        uptime: 0,
        totalTrades: 0,
        successfulTrades: 0,
        totalVolume: 0n,
        totalProfit: 0n,
        gasSpent: 0n,
        lastTradeAt: 0,
      },
      config,
    }

    this.bots.set(botId, bot)

    // Deploy container
    await this.deployContainer(bot)

    // Wait for bot to be ready
    await this.waitForBotReady(bot)

    // Start heartbeat
    this.startHeartbeat(bot)

    return bot
  }

  /**
   * Deploy the bot container
   */
  private async deployContainer(bot: BotInstance): Promise<void> {
    const { spawn } = await import('bun')

    // Get RPC endpoints for bot
    const rpcService = getExternalRPCNodeService()
    const rpcEndpoints: Record<string, string> = {}

    for (const chainId of bot.config.chains) {
      const endpoint = rpcService.getRpcEndpointByChainId(chainId)
      if (endpoint) {
        rpcEndpoints[`RPC_URL_${chainId}`] = endpoint
      }
    }

    // Build docker command
    const args: string[] = ['run', '-d', '--name', bot.containerId]

    // Environment variables
    args.push('-e', `BOT_TYPE=${bot.type}`)
    args.push('-e', `BOT_ID=${bot.botId}`)
    args.push('-e', `OWNER_ADDRESS=${bot.owner}`)
    args.push('-e', `WALLET_ADDRESS=${bot.walletAddress}`)
    args.push('-e', `NETWORK=${this.network}`)
    args.push('-e', `MIN_PROFIT_BPS=${bot.config.minProfitBps}`)
    args.push('-e', `MAX_GAS_GWEI=${bot.config.maxGasGwei}`)
    args.push('-e', `MAX_SLIPPAGE_BPS=${bot.config.maxSlippageBps}`)
    args.push('-e', `COOLDOWN_MS=${bot.config.cooldownMs}`)
    args.push('-e', `CHAINS=${bot.config.chains.join(',')}`)

    // Add RPC endpoints
    for (const [key, value] of Object.entries(rpcEndpoints)) {
      args.push('-e', `${key}=${value}`)
    }

    // Resource limits
    args.push('--memory', '2g')
    args.push('--cpus', '2')

    // Network mode - use host for mempool access
    if (bot.type === 'SANDWICH') {
      args.push('--network', 'host')
    }

    // Image
    args.push(BOT_IMAGES[bot.type])

    // Command
    args.push('bun', 'run', 'bot', '--type', bot.type.toLowerCase())

    console.log(
      `[BotDeployment] Starting container: docker ${args.slice(0, 10).join(' ')}...`,
    )

    // Check if container exists first
    const checkProc = spawn([
      'docker',
      'ps',
      '-aq',
      '-f',
      `name=${bot.containerId}`,
    ])
    const checkOutput = await new Response(checkProc.stdout).text()

    if (checkOutput.trim()) {
      // Container exists - remove and recreate
      console.log(`[BotDeployment] Removing existing container...`)
      const rmProc = spawn(['docker', 'rm', '-f', bot.containerId])
      await rmProc.exited
    }

    // Create and start new container
    const proc = spawn(['docker', ...args])
    const exitCode = await proc.exited

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      bot.status = 'error'
      throw new Error(`Failed to start bot container: ${stderr}`)
    }
  }

  /**
   * Wait for bot to be ready
   */
  private async waitForBotReady(
    bot: BotInstance,
    timeoutMs = 60_000,
  ): Promise<void> {
    const startTime = Date.now()
    const pollInterval = 2000

    console.log(`[BotDeployment] Waiting for ${bot.type} bot to be ready...`)

    while (Date.now() - startTime < timeoutMs) {
      const healthy = await this.checkBotHealth(bot)
      if (healthy) {
        bot.status = 'running'
        console.log(`[BotDeployment] ${bot.type} bot is running`)
        return
      }

      await Bun.sleep(pollInterval)
    }

    bot.status = 'error'
    throw new Error(
      `Bot ${bot.type} failed to become ready within ${timeoutMs}ms`,
    )
  }

  /**
   * Check if a bot is healthy
   */
  private async checkBotHealth(bot: BotInstance): Promise<boolean> {
    const { spawn } = await import('bun')

    // Check if container is running
    const proc = spawn([
      'docker',
      'inspect',
      '-f',
      '{{.State.Running}}',
      bot.containerId,
    ])
    const output = await new Response(proc.stdout).text()

    return output.trim() === 'true'
  }

  /**
   * Start periodic heartbeat for a bot
   */
  private startHeartbeat(bot: BotInstance): void {
    const interval = setInterval(async () => {
      const healthy = await this.checkBotHealth(bot)
      bot.lastHeartbeat = Date.now()

      if (healthy && bot.status === 'error') {
        bot.status = 'running'
        console.log(`[BotDeployment] ${bot.type} bot recovered`)
      } else if (!healthy && bot.status === 'running') {
        bot.status = 'error'
        console.warn(`[BotDeployment] ${bot.type} bot became unhealthy`)
      }

      // Update metrics
      if (healthy) {
        bot.metrics.uptime = Date.now() - bot.deployedAt
      }
    }, 30_000) // Every 30 seconds

    this.heartbeatIntervals.set(bot.botId, interval)
  }

  /**
   * Stop a bot
   */
  async stopBot(botId: Hex): Promise<void> {
    const bot = this.bots.get(botId)
    if (!bot) return

    // Clear heartbeat
    const interval = this.heartbeatIntervals.get(botId)
    if (interval) {
      clearInterval(interval)
      this.heartbeatIntervals.delete(botId)
    }

    // Stop container
    const { spawn } = await import('bun')
    const proc = spawn(['docker', 'stop', bot.containerId])
    await proc.exited

    bot.status = 'stopped'
    console.log(`[BotDeployment] Stopped ${bot.type} bot`)
  }

  /**
   * Pause a bot
   */
  async pauseBot(botId: Hex): Promise<void> {
    const bot = this.bots.get(botId)
    if (!bot) return

    const { spawn } = await import('bun')
    const proc = spawn(['docker', 'pause', bot.containerId])
    await proc.exited

    bot.status = 'paused'
    console.log(`[BotDeployment] Paused ${bot.type} bot`)
  }

  /**
   * Resume a paused bot
   */
  async resumeBot(botId: Hex): Promise<void> {
    const bot = this.bots.get(botId)
    if (!bot || bot.status !== 'paused') return

    const { spawn } = await import('bun')
    const proc = spawn(['docker', 'unpause', bot.containerId])
    await proc.exited

    bot.status = 'running'
    console.log(`[BotDeployment] Resumed ${bot.type} bot`)
  }

  /**
   * Get a bot by ID
   */
  getBot(botId: Hex): BotInstance | null {
    return this.bots.get(botId) ?? null
  }

  /**
   * Get all bots for an owner
   */
  getBotsByOwner(owner: Address): BotInstance[] {
    return Array.from(this.bots.values()).filter((b) => b.owner === owner)
  }

  /**
   * Get all running bots
   */
  getRunningBots(): BotInstance[] {
    return Array.from(this.bots.values()).filter((b) => b.status === 'running')
  }

  /**
   * Get bot metrics
   */
  getMetrics(botId: Hex): BotMetrics | null {
    return this.bots.get(botId)?.metrics ?? null
  }

  /**
   * Deploy all default bots for the Jeju treasury
   */
  async deployDefaultBots(treasuryAddress: Address): Promise<BotInstance[]> {
    const results: BotInstance[] = []

    for (const type of Object.keys(DEFAULT_BOT_CONFIGS) as BotType[]) {
      const bot = await this.deployBot(type, treasuryAddress)
      results.push(bot)
    }

    return results
  }

  /**
   * Generate a unique bot ID
   */
  private generateBotId(type: BotType, owner: Address): Hex {
    return keccak256(toBytes(`${type}:${owner}:${this.network}:${Date.now()}`))
  }

  /**
   * Derive a wallet address for the bot
   * In production, this would use TEE key derivation
   */
  private deriveWalletAddress(botId: Hex): Address {
    const hash = keccak256(toBytes(`wallet:${botId}`))
    return `0x${hash.slice(-40)}` as Address
  }

  /**
   * Load bot state from persistent storage
   */
  private async loadBotState(): Promise<void> {
    // TODO: Load from EQLite or on-chain registry
    // For now, bots are ephemeral
  }

  /**
   * Shutdown all bots
   */
  async shutdown(): Promise<void> {
    console.log('[BotDeployment] Shutting down...')

    for (const botId of this.bots.keys()) {
      await this.stopBot(botId as Hex)
    }

    this.bots.clear()
    this.heartbeatIntervals.clear()
    this.initialized = false
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: BotDeploymentService | null = null

export function getBotDeploymentService(): BotDeploymentService {
  if (!instance) {
    instance = new BotDeploymentService()
  }
  return instance
}

export async function initializeBotDeployment(): Promise<BotDeploymentService> {
  const service = getBotDeploymentService()
  await service.initialize()
  return service
}

// Export for direct use
export const botDeployment = {
  get: getBotDeploymentService,
  init: initializeBotDeployment,
}
