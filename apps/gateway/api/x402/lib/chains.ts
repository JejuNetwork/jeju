import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnvAddress, ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'
import type { ChainConfig, TokenConfig } from './schemas'

export { ZERO_ADDRESS }

interface ContractsConfig {
  testnet?: {
    chainId: number
    payments?: { x402Facilitator?: string }
    tokens?: { usdc?: string }
  }
  mainnet?: {
    chainId: number
    payments?: { x402Facilitator?: string }
    tokens?: { usdc?: string }
  }
  external?: Record<
    string,
    {
      chainId: number
      rpcUrl?: string
      payments?: { x402Facilitator?: string }
      tokens?: { usdc?: string }
    }
  >
}

let contractsConfig: ContractsConfig = {}

function loadContractsConfig(): ContractsConfig {
  if (Object.keys(contractsConfig).length > 0) return contractsConfig

  const configPath = resolve(process.cwd(), 'packages/config/contracts.json')
  try {
    contractsConfig = JSON.parse(
      readFileSync(configPath, 'utf-8'),
    ) as ContractsConfig
  } catch {
    contractsConfig = {}
  }
  return contractsConfig
}

/** Nested config value type for safe traversal */
type ConfigValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | { [key: string]: ConfigValue }

/** Type guard to check if value is a traversable config object */
function isConfigObject(
  value: ConfigValue,
): value is { [key: string]: ConfigValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getEnvOrConfig(
  envKey: string,
  configPath: string[],
  defaultValue: string,
): string {
  // 1. Check environment variable
  const envValue = process.env[envKey]
  if (envValue) return envValue

  // 2. Check contracts.json
  const config = loadContractsConfig()
  let value: ConfigValue = config as ConfigValue
  for (const key of configPath) {
    if (!isConfigObject(value)) break
    value = value[key]
    if (value === undefined) break
  }
  if (typeof value === 'string' && value.length > 0) return value

  // 3. Return default
  return defaultValue
}

/** Get an address from env or config, with proper validation */
function getAddressEnvOrConfig(
  envKey: string,
  configPath: string[],
  defaultValue: Address = ZERO_ADDRESS,
): Address {
  const value = getEnvOrConfig(envKey, configPath, defaultValue)
  return parseEnvAddress(value, defaultValue)
}

function getRpcUrl(envKey: string, defaultUrl: string): string {
  const isProduction = process.env.NODE_ENV === 'production'
  const url = process.env[envKey]
  if (!url && isProduction) {
    throw new Error(`${envKey} must be set in production`)
  }
  return url || defaultUrl
}

export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  jeju: {
    chainId: 420691,
    name: 'Jeju',
    network: 'jeju',
    rpcUrl: getRpcUrl('JEJU_RPC_URL', 'http://127.0.0.1:6546'),
    blockExplorer: null,
    usdc: getAddressEnvOrConfig(
      'JEJU_USDC_ADDRESS',
      ['mainnet', 'tokens', 'usdc'],
      parseEnvAddress('0x0165878A594ca255338adfa4d48449f69242Eb8F'),
    ),
    facilitator: getAddressEnvOrConfig('X402_FACILITATOR_ADDRESS', [
      'mainnet',
      'payments',
      'x402Facilitator',
    ]),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  'jeju-testnet': {
    chainId: 420690,
    name: 'Jeju Testnet',
    network: 'jeju-testnet',
    rpcUrl: getRpcUrl(
      'JEJU_TESTNET_RPC_URL',
      'https://testnet-rpc.jejunetwork.org',
    ),
    blockExplorer: null,
    usdc: getAddressEnvOrConfig(
      'JEJU_TESTNET_USDC_ADDRESS',
      ['testnet', 'tokens', 'usdc'],
      parseEnvAddress('0x953F6516E5d2864cE7f13186B45dE418EA665EB2'),
    ),
    facilitator: getAddressEnvOrConfig('X402_TESTNET_FACILITATOR_ADDRESS', [
      'testnet',
      'payments',
      'x402Facilitator',
    ]),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  'base-sepolia': {
    chainId: 84532,
    name: 'Base Sepolia',
    network: 'base-sepolia',
    rpcUrl: getRpcUrl('BASE_SEPOLIA_RPC_URL', 'https://sepolia.base.org'),
    blockExplorer: 'https://sepolia.basescan.org',
    usdc: getAddressEnvOrConfig(
      'BASE_SEPOLIA_USDC_ADDRESS',
      ['external', 'baseSepolia', 'tokens', 'usdc'],
      parseEnvAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
    ),
    facilitator: getAddressEnvOrConfig(
      'X402_BASE_SEPOLIA_FACILITATOR_ADDRESS',
      ['external', 'baseSepolia', 'payments', 'x402Facilitator'],
    ),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  base: {
    chainId: 8453,
    name: 'Base',
    network: 'base',
    rpcUrl: getRpcUrl('BASE_RPC_URL', 'https://mainnet.base.org'),
    blockExplorer: 'https://basescan.org',
    usdc: getAddressEnvOrConfig(
      'BASE_USDC_ADDRESS',
      ['external', 'base', 'tokens', 'usdc'],
      parseEnvAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
    ),
    facilitator: getAddressEnvOrConfig('X402_BASE_FACILITATOR_ADDRESS', [
      'external',
      'base',
      'payments',
      'x402Facilitator',
    ]),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  sepolia: {
    chainId: 11155111,
    name: 'Sepolia',
    network: 'sepolia',
    rpcUrl: getRpcUrl(
      'SEPOLIA_RPC_URL',
      'https://ethereum-sepolia-rpc.publicnode.com',
    ),
    blockExplorer: 'https://sepolia.etherscan.io',
    usdc: getAddressEnvOrConfig(
      'SEPOLIA_USDC_ADDRESS',
      ['external', 'sepolia', 'tokens', 'usdc'],
      parseEnvAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'),
    ),
    facilitator: getAddressEnvOrConfig('X402_SEPOLIA_FACILITATOR_ADDRESS', [
      'external',
      'sepolia',
      'payments',
      'x402Facilitator',
    ]),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  ethereum: {
    chainId: 1,
    name: 'Ethereum',
    network: 'ethereum',
    rpcUrl: getRpcUrl('ETHEREUM_RPC_URL', 'https://eth.llamarpc.com'),
    blockExplorer: 'https://etherscan.io',
    usdc: getAddressEnvOrConfig(
      'ETHEREUM_USDC_ADDRESS',
      ['external', 'ethereum', 'tokens', 'usdc'],
      parseEnvAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    ),
    facilitator: getAddressEnvOrConfig('X402_ETHEREUM_FACILITATOR_ADDRESS', [
      'external',
      'ethereum',
      'payments',
      'x402Facilitator',
    ]),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  'arbitrum-sepolia': {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    network: 'arbitrum-sepolia',
    rpcUrl: getRpcUrl(
      'ARBITRUM_SEPOLIA_RPC_URL',
      'https://sepolia-rollup.arbitrum.io/rpc',
    ),
    blockExplorer: 'https://sepolia.arbiscan.io',
    usdc: getAddressEnvOrConfig(
      'ARBITRUM_SEPOLIA_USDC_ADDRESS',
      ['external', 'arbitrumSepolia', 'tokens', 'usdc'],
      parseEnvAddress('0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'),
    ),
    facilitator: getAddressEnvOrConfig(
      'X402_ARBITRUM_SEPOLIA_FACILITATOR_ADDRESS',
      ['external', 'arbitrumSepolia', 'payments', 'x402Facilitator'],
    ),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  arbitrum: {
    chainId: 42161,
    name: 'Arbitrum One',
    network: 'arbitrum',
    rpcUrl: getRpcUrl('ARBITRUM_RPC_URL', 'https://arb1.arbitrum.io/rpc'),
    blockExplorer: 'https://arbiscan.io',
    usdc: getAddressEnvOrConfig(
      'ARBITRUM_USDC_ADDRESS',
      ['external', 'arbitrum', 'tokens', 'usdc'],
      parseEnvAddress('0xaf88d065e77c8cC2239327C5EDb3A432268e5831'),
    ),
    facilitator: getAddressEnvOrConfig('X402_ARBITRUM_FACILITATOR_ADDRESS', [
      'external',
      'arbitrum',
      'payments',
      'x402Facilitator',
    ]),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  'optimism-sepolia': {
    chainId: 11155420,
    name: 'Optimism Sepolia',
    network: 'optimism-sepolia',
    rpcUrl: getRpcUrl(
      'OPTIMISM_SEPOLIA_RPC_URL',
      'https://sepolia.optimism.io',
    ),
    blockExplorer: 'https://sepolia-optimism.etherscan.io',
    usdc: getAddressEnvOrConfig(
      'OPTIMISM_SEPOLIA_USDC_ADDRESS',
      ['external', 'optimismSepolia', 'tokens', 'usdc'],
      parseEnvAddress('0x5fd84259d66Cd46123540766Be93DFE6D43130D7'),
    ),
    facilitator: getAddressEnvOrConfig(
      'X402_OPTIMISM_SEPOLIA_FACILITATOR_ADDRESS',
      ['external', 'optimismSepolia', 'payments', 'x402Facilitator'],
    ),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  optimism: {
    chainId: 10,
    name: 'Optimism',
    network: 'optimism',
    rpcUrl: getRpcUrl('OPTIMISM_RPC_URL', 'https://mainnet.optimism.io'),
    blockExplorer: 'https://optimistic.etherscan.io',
    usdc: getAddressEnvOrConfig(
      'OPTIMISM_USDC_ADDRESS',
      ['external', 'optimism', 'tokens', 'usdc'],
      parseEnvAddress('0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'),
    ),
    facilitator: getAddressEnvOrConfig('X402_OPTIMISM_FACILITATOR_ADDRESS', [
      'external',
      'optimism',
      'payments',
      'x402Facilitator',
    ]),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  'bsc-testnet': {
    chainId: 97,
    name: 'BSC Testnet',
    network: 'bsc-testnet',
    rpcUrl: getRpcUrl(
      'BSC_TESTNET_RPC_URL',
      'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    ),
    blockExplorer: 'https://testnet.bscscan.com',
    usdc: getAddressEnvOrConfig(
      'BSC_TESTNET_USDT_ADDRESS',
      ['external', 'bscTestnet', 'tokens', 'usdt'],
      parseEnvAddress('0x337610d27c682E347C9cD60BD4b3b107C9d34dDd'),
    ), // USDT on BSC testnet
    facilitator: getAddressEnvOrConfig('X402_BSC_TESTNET_FACILITATOR_ADDRESS', [
      'external',
      'bscTestnet',
      'payments',
      'x402Facilitator',
    ]),
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  },
  bsc: {
    chainId: 56,
    name: 'BNB Chain',
    network: 'bsc',
    rpcUrl: getRpcUrl('BSC_RPC_URL', 'https://bsc-dataseed.bnbchain.org'),
    blockExplorer: 'https://bscscan.com',
    usdc: getAddressEnvOrConfig(
      'BSC_USDC_ADDRESS',
      ['external', 'bsc', 'tokens', 'usdc'],
      parseEnvAddress('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'),
    ),
    facilitator: getAddressEnvOrConfig('X402_BSC_FACILITATOR_ADDRESS', [
      'external',
      'bsc',
      'payments',
      'x402Facilitator',
    ]),
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  },
}

export const CHAIN_ID_TO_NETWORK: Record<number, string> = Object.fromEntries(
  Object.entries(CHAIN_CONFIGS).map(([network, config]) => [
    config.chainId,
    network,
  ]),
)

export function getChainConfig(network: string): ChainConfig | undefined {
  return CHAIN_CONFIGS[network]
}

export function getTokenConfig(
  network: string,
  tokenAddress: Address,
): TokenConfig {
  const chain = CHAIN_CONFIGS[network]
  if (!chain)
    return {
      address: tokenAddress,
      symbol: 'UNKNOWN',
      decimals: 18,
      name: 'Unknown Token',
    }

  if (tokenAddress.toLowerCase() === chain.usdc.toLowerCase()) {
    return {
      address: tokenAddress,
      symbol: 'USDC',
      decimals: 6,
      name: 'USD Coin',
    }
  }

  if (tokenAddress === ZERO_ADDRESS) {
    return {
      address: tokenAddress,
      symbol: chain.nativeCurrency.symbol,
      decimals: chain.nativeCurrency.decimals,
      name: chain.nativeCurrency.name,
    }
  }

  return {
    address: tokenAddress,
    symbol: 'TOKEN',
    decimals: 18,
    name: 'ERC20 Token',
  }
}

export function getPrimaryNetwork(): string {
  return process.env.X402_PRIMARY_NETWORK || 'jeju'
}

export function getPrimaryChainConfig(): ChainConfig {
  const network = getPrimaryNetwork()
  const config = CHAIN_CONFIGS[network]
  if (!config) throw new Error(`Invalid primary network: ${network}`)
  return config
}
