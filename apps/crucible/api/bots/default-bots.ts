import type { Address } from 'viem'
import type {
  TradingBotChain,
  TradingBotStrategy,
} from '../../lib/types'
import type { TradingBotOptions } from './trading-bot'

/**
 * Configuration for a default trading bot.
 */
export interface DefaultBotConfig {
  name: string
  description: string
  strategies: TradingBotStrategy[]
  chains: number[]
  initialFunding: string
}

/**
 * Default chain configurations for various networks.
 */
export const DEFAULT_CHAINS: Record<
  string,
  {
    chainId: number
    name: string
    rpcUrl: string
    blockTime: number
    isL2: boolean
    nativeSymbol: string
  }
> = {
  mainnet: {
    chainId: 1,
    name: 'Ethereum',
    rpcUrl: 'https://eth.llamarpc.com',
    blockTime: 12000,
    isL2: false,
    nativeSymbol: 'ETH',
  },
  arbitrum: {
    chainId: 42161,
    name: 'Arbitrum',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    blockTime: 250,
    isL2: true,
    nativeSymbol: 'ETH',
  },
  optimism: {
    chainId: 10,
    name: 'Optimism',
    rpcUrl: 'https://mainnet.optimism.io',
    blockTime: 2000,
    isL2: true,
    nativeSymbol: 'ETH',
  },
  base: {
    chainId: 8453,
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    blockTime: 2000,
    isL2: true,
    nativeSymbol: 'ETH',
  },
  bsc: {
    chainId: 56,
    name: 'BNB Chain',
    rpcUrl: 'https://bsc-dataseed.binance.org',
    blockTime: 3000,
    isL2: false,
    nativeSymbol: 'BNB',
  },
  jeju: {
    chainId: 420691,
    name: 'Jeju Network',
    rpcUrl: 'https://rpc.jejunetwork.org',
    blockTime: 2000,
    isL2: true,
    nativeSymbol: 'JEJU',
  },
  jejuTestnet: {
    chainId: 420690,
    name: 'Jeju Testnet',
    rpcUrl: 'https://rpc.testnet.jejunetwork.org',
    blockTime: 2000,
    isL2: true,
    nativeSymbol: 'JEJU',
  },
}

/**
 * Default bot configurations for various trading strategies.
 */
export const DEFAULT_BOTS: DefaultBotConfig[] = [
  {
    name: 'DEX Arbitrage Bot',
    description: 'Arbitrage opportunities across DEXes',
    strategies: [
      {
        type: 'DEX_ARBITRAGE',
        enabled: true,
        minProfitBps: 50,
        maxGasGwei: 100,
        maxSlippageBps: 100,
      },
    ],
    chains: [1, 42161, 10, 8453, 56, 420691],
    initialFunding: '1.0',
  },
  {
    name: 'Sandwich Bot',
    description: 'MEV sandwich attacks',
    strategies: [
      {
        type: 'SANDWICH',
        enabled: true,
        minProfitBps: 100,
        maxGasGwei: 200,
        maxSlippageBps: 50,
      },
    ],
    chains: [1, 42161, 10, 8453],
    initialFunding: '2.0',
  },
  {
    name: 'Cross-Chain Arbitrage Bot',
    description: 'Arbitrage across different chains',
    strategies: [
      {
        type: 'CROSS_CHAIN_ARBITRAGE',
        enabled: true,
        minProfitBps: 200,
        maxGasGwei: 150,
        maxSlippageBps: 150,
      },
    ],
    chains: [1, 42161, 10, 8453, 56],
    initialFunding: '5.0',
  },
  {
    name: 'Liquidation Bot',
    description: 'Liquidation opportunities',
    strategies: [
      {
        type: 'LIQUIDATION',
        enabled: true,
        minProfitBps: 300,
        maxGasGwei: 300,
        maxSlippageBps: 200,
      },
    ],
    chains: [420691, 420690],
    initialFunding: '10.0',
  },
  {
    name: 'Oracle Keeper Bot',
    description: 'Oracle price updates',
    strategies: [
      {
        type: 'ORACLE_KEEPER',
        enabled: true,
        minProfitBps: 0,
        maxGasGwei: 50,
        maxSlippageBps: 0,
      },
    ],
    chains: [1, 42161, 10, 8453, 420691],
    initialFunding: '0.5',
  },
  {
    name: 'Solver Bot',
    description: 'Batch auction solving',
    strategies: [
      {
        type: 'SOLVER',
        enabled: true,
        minProfitBps: 25,
        maxGasGwei: 100,
        maxSlippageBps: 50,
      },
    ],
    chains: [1, 42161, 10, 8453],
    initialFunding: '3.0',
  },
]

/**
 * Get default bots filtered and configured for a specific network.
 */
export function getDefaultBotsForNetwork(
  network: 'localnet' | 'testnet' | 'mainnet',
): DefaultBotConfig[] {
  if (network === 'localnet') {
    return DEFAULT_BOTS.map((bot) => ({
      ...bot,
      chains: [31337],
      initialFunding: '0.01',
    }))
  }

  if (network === 'testnet') {
    const testnetChains = [420690, 11155111, 84532, 421614]
    return DEFAULT_BOTS.map((bot) => ({
      ...bot,
      chains: bot.chains.filter((chainId) =>
        testnetChains.includes(chainId),
      ),
      initialFunding: String(Math.max(0.01, parseFloat(bot.initialFunding) * 0.1)),
    }))
  }

  return DEFAULT_BOTS
}

/**
 * Create trading bot options from a default bot configuration.
 */
export function createTradingBotOptions(
  config: DefaultBotConfig,
  agentId: bigint,
  network: 'localnet' | 'testnet' | 'mainnet',
  treasuryAddress?: Address,
): TradingBotOptions {
  const chains: TradingBotChain[] = config.chains
    .map((chainId) => {
      const chainConfig = Object.values(DEFAULT_CHAINS).find(
        (c) => c.chainId === chainId,
      )
      if (!chainConfig) {
        return null
      }
      return {
        chainId: chainConfig.chainId,
        name: chainConfig.name,
        rpcUrl: chainConfig.rpcUrl,
        blockTime: chainConfig.blockTime,
        isL2: chainConfig.isL2,
        nativeSymbol: chainConfig.nativeSymbol,
      } as TradingBotChain
    })
    .filter((chain): chain is TradingBotChain => chain !== null)

  return {
    agentId,
    name: config.name,
    strategies: config.strategies,
    chains,
    maxConcurrentExecutions: 5,
    useFlashbots: network !== 'localnet',
    treasuryAddress,
  }
}
