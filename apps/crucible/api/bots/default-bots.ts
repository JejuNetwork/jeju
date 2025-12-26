/**
 * Default Trading Bots Configuration
 *
 * Pre-configured MEV/arbitrage bots that initialize automatically.
 */

import { getExternalRpc, getRpcUrl } from '@jejunetwork/config'
import type { Address } from 'viem'
import type { TradingBotChain, TradingBotStrategy } from '../../lib/types'

export interface DefaultBotConfig {
  name: string
  description: string
  strategies: TradingBotStrategy[]
  chains: number[]
  initialFunding: string
}

export interface TradingBotOptions {
  agentId: bigint
  name: string
  strategies: TradingBotStrategy[]
  chains: TradingBotChain[]
  treasuryAddress?: Address
  privateKey: `0x${string}`
  maxConcurrentExecutions: number
  useFlashbots: boolean
  contractAddresses?: Record<string, Address>
}

// Helper to safely get external RPC with fallback
function safeGetExternalRpc(chain: string, fallback: string): string {
  try {
    return getExternalRpc(chain)
  } catch {
    return fallback
  }
}

// Default chain configurations - uses centralized config
export const DEFAULT_CHAINS: Record<string, TradingBotChain> = {
  mainnet: {
    chainId: 1,
    name: 'Ethereum',
    rpcUrl: safeGetExternalRpc('ethereum', 'https://eth.llamarpc.com'),
    blockTime: 12000,
    isL2: false,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://etherscan.io',
  },
  arbitrum: {
    chainId: 42161,
    name: 'Arbitrum One',
    rpcUrl: safeGetExternalRpc('arbitrum', 'https://arb1.arbitrum.io/rpc'),
    blockTime: 250,
    isL2: true,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://arbiscan.io',
  },
  optimism: {
    chainId: 10,
    name: 'Optimism',
    rpcUrl: safeGetExternalRpc('optimism', 'https://mainnet.optimism.io'),
    blockTime: 2000,
    isL2: true,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://optimistic.etherscan.io',
  },
  base: {
    chainId: 8453,
    name: 'Base',
    rpcUrl: safeGetExternalRpc('base', 'https://mainnet.base.org'),
    blockTime: 2000,
    isL2: true,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://basescan.org',
  },
  bsc: {
    chainId: 56,
    name: 'BNB Smart Chain',
    rpcUrl: safeGetExternalRpc('bsc', 'https://bsc-dataseed.binance.org'),
    blockTime: 3000,
    isL2: false,
    nativeSymbol: 'BNB',
    explorerUrl: 'https://bscscan.com',
  },
  jeju: {
    chainId: 420691,
    name: 'Network',
    rpcUrl: getRpcUrl('mainnet'),
    blockTime: 200,
    isL2: true,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://explorer.jejunetwork.org',
  },
  jejuTestnet: {
    chainId: 420690,
    name: 'Testnet',
    rpcUrl: getRpcUrl('testnet'),
    blockTime: 200,
    isL2: true,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://testnet-explorer.jejunetwork.org',
  },
  sepolia: {
    chainId: 11155111,
    name: 'Sepolia',
    rpcUrl: safeGetExternalRpc('sepolia', 'https://rpc.sepolia.org'),
    blockTime: 12000,
    isL2: false,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia.etherscan.io',
  },
  baseSepolia: {
    chainId: 84532,
    name: 'Base Sepolia',
    rpcUrl: safeGetExternalRpc('baseSepolia', 'https://sepolia.base.org'),
    blockTime: 2000,
    isL2: true,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia.basescan.org',
  },
  arbitrumSepolia: {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    rpcUrl: safeGetExternalRpc(
      'arbitrumSepolia',
      'https://sepolia-rollup.arbitrum.io/rpc',
    ),
    blockTime: 250,
    isL2: true,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia.arbiscan.io',
  },
  localnet: {
    chainId: 31337,
    name: 'Localnet',
    rpcUrl: getRpcUrl('localnet'),
    blockTime: 1000,
    isL2: false,
    nativeSymbol: 'ETH',
  },
}

// Default bot configurations
export const DEFAULT_BOTS: DefaultBotConfig[] = [
  {
    name: 'DEX Arbitrage Bot',
    description:
      'Detects and executes DEX arbitrage opportunities across pools',
    strategies: [
      {
        type: 'DEX_ARBITRAGE',
        enabled: true,
        minProfitBps: 10,
        maxGasGwei: 100,
        maxSlippageBps: 50,
      },
    ],
    chains: [1, 42161, 10, 8453, 56, 420691],
    initialFunding: '0.1',
  },
  {
    name: 'Sandwich Bot',
    description: 'Executes sandwich attacks on pending transactions',
    strategies: [
      {
        type: 'SANDWICH',
        enabled: true,
        minProfitBps: 50,
        maxGasGwei: 200,
        maxSlippageBps: 100,
      },
    ],
    chains: [1, 42161, 10, 8453],
    initialFunding: '0.2',
  },
  {
    name: 'Cross-Chain Arbitrage Bot',
    description: 'Arbitrages price differences across chains',
    strategies: [
      {
        type: 'CROSS_CHAIN_ARBITRAGE',
        enabled: true,
        minProfitBps: 50,
        maxGasGwei: 100,
        maxSlippageBps: 100,
      },
    ],
    chains: [1, 42161, 10, 8453, 56, 420691],
    initialFunding: '0.5',
  },
  {
    name: 'Liquidation Bot',
    description: 'Liquidates undercollateralized positions',
    strategies: [
      {
        type: 'LIQUIDATION',
        enabled: true,
        minProfitBps: 100,
        maxGasGwei: 150,
        maxSlippageBps: 50,
      },
    ],
    chains: [420691, 420690],
    initialFunding: '0.3',
  },
  {
    name: 'Oracle Keeper Bot',
    description: 'Keeps price oracles updated',
    strategies: [
      {
        type: 'ORACLE_KEEPER',
        enabled: true,
        minProfitBps: 0,
        maxGasGwei: 50,
        maxSlippageBps: 10,
      },
    ],
    chains: [1, 42161, 10, 8453, 56, 420691],
    initialFunding: '0.1',
  },
  {
    name: 'OIF Solver Bot',
    description: 'Solves Open Intents Framework intents',
    strategies: [
      {
        type: 'SOLVER',
        enabled: true,
        minProfitBps: 20,
        maxGasGwei: 100,
        maxSlippageBps: 50,
      },
    ],
    chains: [1, 42161, 10, 8453, 420691],
    initialFunding: '0.2',
  },
]

const TESTNET_CHAINS = new Set([420690, 11155111, 84532, 421614])

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
    return DEFAULT_BOTS.map((bot) => ({
      ...bot,
      chains: bot.chains.filter((c) => TESTNET_CHAINS.has(c)),
      initialFunding: (parseFloat(bot.initialFunding) * 0.1).toString(),
    }))
  }

  return DEFAULT_BOTS
}

const CHAIN_ID_TO_KEY: Record<number, keyof typeof DEFAULT_CHAINS> = {
  1: 'mainnet',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
  56: 'bsc',
  420691: 'jeju',
  420690: 'jejuTestnet',
  11155111: 'sepolia',
  84532: 'baseSepolia',
  421614: 'arbitrumSepolia',
  31337: 'localnet',
}

export function createTradingBotOptions(
  config: DefaultBotConfig,
  agentId: bigint,
  privateKey: `0x${string}`,
  network: 'localnet' | 'testnet' | 'mainnet',
  treasuryAddress?: Address,
): TradingBotOptions {
  const chains = config.chains
    .map((chainId) => {
      const key = CHAIN_ID_TO_KEY[chainId]
      return key ? DEFAULT_CHAINS[key] : undefined
    })
    .filter((c): c is TradingBotChain => c !== undefined)

  return {
    agentId,
    name: config.name,
    strategies: config.strategies,
    chains,
    treasuryAddress,
    privateKey,
    maxConcurrentExecutions: 5,
    useFlashbots: network !== 'localnet',
  }
}
