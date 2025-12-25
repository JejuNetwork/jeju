/** Trading bot operations */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  getChainId as getConfigChainId,
  getRpcUrl as getConfigRpcUrl,
  type NetworkType,
} from '@jejunetwork/config'
import { spawn } from 'bun'
import { Command } from 'commander'
import { getChainStatus } from '../lib/chain'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

const AVAILABLE_STRATEGIES = [
  'tfmm-rebalancer',
  'cross-chain-arbitrage',
  'funding-arb',
  'liquidation',
] as const

const BACKTEST_STRATEGIES = [
  'momentum',
  'mean-reversion',
  'volatility',
  'composite',
] as const

function getBotsDir(): string {
  const rootDir = findMonorepoRoot()
  return join(rootDir, 'packages/bots')
}

function getRpcUrl(network: string): string {
  const net = network as NetworkType
  return getConfigRpcUrl(net)
}

function getChainId(network: string): number {
  const net = network as NetworkType
  return getConfigChainId(net)
}

export const botsCommand = new Command('bots')
  .description('Trading bot operations')
  .addCommand(
    new Command('start')
      .description('Start trading bot with strategy')
      .option(
        '--strategy <name>',
        'Strategy name (tfmm-rebalancer, cross-chain-arbitrage, funding-arb, liquidation)',
        'tfmm-rebalancer',
      )
      .option('--config <path>', 'Path to config file')
      .option('--dry-run', 'Run in dry-run mode without executing trades')
      .option(
        '--network <network>',
        'Network: localnet, testnet, mainnet',
        'localnet',
      )
      .action(async (options) => {
        await startBot(options)
      }),
  )
  .addCommand(
    new Command('backtest')
      .description('Run backtest simulation')
      .option(
        '--strategy <name>',
        'Strategy: momentum, mean-reversion, volatility, composite',
        'composite',
      )
      .option('--start-date <date>', 'Start date (YYYY-MM-DD)', '2024-01-01')
      .option('--end-date <date>', 'End date (YYYY-MM-DD)', '2024-12-01')
      .option('--initial-capital <amount>', 'Initial capital in USD', '10000')
      .action(async (options) => {
        await runBacktest(options)
      }),
  )
  .addCommand(
    new Command('simulate')
      .description('Run portfolio simulation')
      .option('--config <path>', 'Path to simulation config file')
      .option('--blocks <count>', 'Number of blocks to simulate', '1000')
      .action(async (options) => {
        await runSimulation(options)
      }),
  )
  .addCommand(
    new Command('prices')
      .description('Fetch current prices')
      .option(
        '--tokens <list>',
        'Comma-separated token symbols',
        'ETH,BTC,USDC',
      )
      .action(async (options) => {
        await fetchPrices(options)
      }),
  )
  .addCommand(
    new Command('list')
      .description('List available strategies')
      .action(async () => {
        await listStrategies()
      }),
  )

async function startBot(options: {
  strategy: string
  config?: string
  dryRun?: boolean
  network: string
}): Promise<void> {
  logger.header('TRADING BOT')

  const botsDir = getBotsDir()
  if (!existsSync(botsDir)) {
    logger.error('Bots package not found at packages/bots')
    process.exit(1)
  }

  const validStrategies = AVAILABLE_STRATEGIES as readonly string[]
  if (!validStrategies.includes(options.strategy)) {
    logger.error(`Invalid strategy: ${options.strategy}`)
    logger.info(`Available strategies: ${AVAILABLE_STRATEGIES.join(', ')}`)
    process.exit(1)
  }

  const chain = await getChainStatus(
    options.network as 'localnet' | 'testnet' | 'mainnet',
  )
  if (!chain.running && options.network === 'localnet') {
    logger.warn('Chain not running. Start with: jeju dev')
    process.exit(1)
  }

  const rpcUrl = getRpcUrl(options.network)
  const privateKey = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY

  if (!privateKey) {
    logger.error(
      'PRIVATE_KEY or DEPLOYER_PRIVATE_KEY environment variable required',
    )
    process.exit(1)
  }

  logger.step('Starting trading bot...')
  logger.keyValue('Strategy', options.strategy)
  logger.keyValue('Network', options.network)
  logger.keyValue('RPC URL', rpcUrl)
  logger.keyValue('Dry Run', options.dryRun ? 'Yes' : 'No')
  if (options.config) {
    logger.keyValue('Config', options.config)
  }
  logger.newline()

  const chainId = getChainId(options.network)
  const args = [
    'run',
    'src/cli.ts',
    'start',
    chainId.toString(),
    rpcUrl,
    privateKey,
  ]

  const proc = spawn({
    cmd: ['bun', ...args],
    cwd: botsDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      RPC_URL: rpcUrl,
      PRIVATE_KEY: privateKey,
      DRY_RUN: options.dryRun ? '1' : '',
      BOT_STRATEGY: options.strategy,
    },
  })

  process.on('SIGINT', () => {
    proc.kill('SIGTERM')
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    proc.kill('SIGTERM')
    process.exit(0)
  })

  await proc.exited
}

async function runBacktest(options: {
  strategy: string
  startDate: string
  endDate: string
  initialCapital: string
}): Promise<void> {
  logger.header('BACKTEST SIMULATION')

  const botsDir = getBotsDir()
  if (!existsSync(botsDir)) {
    logger.error('Bots package not found at packages/bots')
    process.exit(1)
  }

  const validStrategies = BACKTEST_STRATEGIES as readonly string[]
  if (!validStrategies.includes(options.strategy)) {
    logger.error(`Invalid backtest strategy: ${options.strategy}`)
    logger.info(`Available strategies: ${BACKTEST_STRATEGIES.join(', ')}`)
    process.exit(1)
  }

  const startDate = new Date(options.startDate)
  const endDate = new Date(options.endDate)

  if (Number.isNaN(startDate.getTime())) {
    logger.error(`Invalid start date: ${options.startDate}`)
    process.exit(1)
  }

  if (Number.isNaN(endDate.getTime())) {
    logger.error(`Invalid end date: ${options.endDate}`)
    process.exit(1)
  }

  const initialCapital = parseFloat(options.initialCapital)
  if (Number.isNaN(initialCapital) || initialCapital <= 0) {
    logger.error(`Invalid initial capital: ${options.initialCapital}`)
    process.exit(1)
  }

  logger.keyValue('Strategy', options.strategy)
  logger.keyValue('Start Date', options.startDate)
  logger.keyValue('End Date', options.endDate)
  logger.keyValue('Initial Capital', `$${initialCapital.toLocaleString()}`)
  logger.newline()

  // Call packages/bots/src/cli.ts backtest
  const proc = spawn({
    cmd: [
      'bun',
      'run',
      'src/cli.ts',
      'backtest',
      options.strategy,
      options.startDate,
      options.endDate,
      options.initialCapital,
    ],
    cwd: botsDir,
    stdout: 'inherit',
    stderr: 'inherit',
  })

  await proc.exited
}

async function runSimulation(options: {
  config?: string
  blocks: string
}): Promise<void> {
  logger.header('PORTFOLIO SIMULATION')

  const botsDir = getBotsDir()
  if (!existsSync(botsDir)) {
    logger.error('Bots package not found at packages/bots')
    process.exit(1)
  }

  const blocks = parseInt(options.blocks, 10)
  if (Number.isNaN(blocks) || blocks <= 0) {
    logger.error(`Invalid blocks count: ${options.blocks}`)
    process.exit(1)
  }

  logger.keyValue('Blocks', blocks.toString())
  if (options.config) {
    logger.keyValue('Config', options.config)
  }
  logger.newline()

  // Call packages/bots/src/cli.ts simulate
  const proc = spawn({
    cmd: ['bun', 'run', 'src/cli.ts', 'simulate', options.blocks],
    cwd: botsDir,
    stdout: 'inherit',
    stderr: 'inherit',
  })

  await proc.exited
}

async function fetchPrices(options: { tokens: string }): Promise<void> {
  logger.header('PRICE FETCH')

  const botsDir = getBotsDir()
  if (!existsSync(botsDir)) {
    logger.error('Bots package not found at packages/bots')
    process.exit(1)
  }

  const tokens = options.tokens.split(',').map((t) => t.trim().toUpperCase())

  logger.keyValue('Tokens', tokens.join(', '))
  logger.newline()

  // Call packages/bots/src/cli.ts prices
  const proc = spawn({
    cmd: ['bun', 'run', 'src/cli.ts', 'prices', ...tokens],
    cwd: botsDir,
    stdout: 'inherit',
    stderr: 'inherit',
  })

  await proc.exited
}

async function listStrategies(): Promise<void> {
  logger.header('AVAILABLE STRATEGIES')

  logger.newline()
  logger.subheader('Trading Strategies')
  console.log('  tfmm-rebalancer       TFMM portfolio rebalancing')
  console.log('  cross-chain-arbitrage Cross-chain arbitrage opportunities')
  console.log('  funding-arb           Perpetuals funding rate arbitrage')
  console.log(
    '  liquidation           Liquidation bot for undercollateralized positions',
  )

  logger.newline()
  logger.subheader('Backtest Strategies')
  console.log('  momentum              Trend-following momentum strategy')
  console.log('  mean-reversion        Mean reversion strategy')
  console.log('  volatility            Volatility-based allocation')
  console.log('  composite             Combined multi-factor strategy')

  logger.newline()
  logger.info('Start a bot: jeju bots start --strategy <name>')
  logger.info('Run backtest: jeju bots backtest --strategy <name>')
}
