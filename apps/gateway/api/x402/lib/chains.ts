import {
  getContract,
  getExternalContract,
  getExternalRpc,
  getRpcUrl,
} from '@jejunetwork/config'
import { parseEnvAddress, ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'
import type { ChainConfig, TokenConfig } from './schemas'

export { ZERO_ADDRESS }

/** Get an address from env or config, with proper validation */
function getAddressEnvOrConfig(
  envKey: string,
  configGetter: () => string,
  defaultValue: Address = ZERO_ADDRESS,
): Address {
  // 1. Check environment variable first
  const envValue = process.env[envKey]
  if (envValue) return parseEnvAddress(envValue, defaultValue)

  // 2. Try config getter (may throw if contract not configured)
  try {
    const configValue = configGetter()
    if (configValue) return parseEnvAddress(configValue, defaultValue)
  } catch {
    // Contract not configured, return default
  }

  // 3. Return default
  return defaultValue
}

function getEnvRpcUrl(envKey: string, defaultUrl: string): string {
  const isProduction = process.env.NODE_ENV === 'production'
  const url = process.env[envKey]
  if (!url && isProduction) {
    throw new Error(`${envKey} must be set in production`)
  }
  return url || defaultUrl
}

/** Safe getter that returns empty string if external contract doesn't exist */
function safeGetExternalContract(
  chain: string,
  category: 'payments' | 'tokens',
  name: string,
): string {
  try {
    return getExternalContract(chain, category, name)
  } catch {
    return ''
  }
}

export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  jeju: {
    chainId: 420691,
    name: 'Jeju',
    network: 'jeju',
    rpcUrl: getEnvRpcUrl('JEJU_RPC_URL', getRpcUrl('mainnet')),
    blockExplorer: null,
    usdc: getAddressEnvOrConfig(
      'JEJU_USDC_ADDRESS',
      () => getContract('tokens', 'usdc', 'mainnet'),
      parseEnvAddress('0x0165878A594ca255338adfa4d48449f69242Eb8F'),
    ),
    facilitator: getAddressEnvOrConfig('X402_FACILITATOR_ADDRESS', () =>
      getContract('payments', 'x402Facilitator', 'mainnet'),
    ),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  'jeju-testnet': {
    chainId: 420690,
    name: 'Jeju Testnet',
    network: 'jeju-testnet',
    rpcUrl: getEnvRpcUrl('JEJU_TESTNET_RPC_URL', getRpcUrl('testnet')),
    blockExplorer: null,
    usdc: getAddressEnvOrConfig(
      'JEJU_TESTNET_USDC_ADDRESS',
      () => getContract('tokens', 'usdc', 'testnet'),
      parseEnvAddress('0x953F6516E5d2864cE7f13186B45dE418EA665EB2'),
    ),
    facilitator: getAddressEnvOrConfig('X402_TESTNET_FACILITATOR_ADDRESS', () =>
      getContract('payments', 'x402Facilitator', 'testnet'),
    ),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  'base-sepolia': {
    chainId: 84532,
    name: 'Base Sepolia',
    network: 'base-sepolia',
    rpcUrl: getEnvRpcUrl(
      'BASE_SEPOLIA_RPC_URL',
      getExternalRpc('base-sepolia'),
    ),
    blockExplorer: 'https://sepolia.basescan.org',
    usdc: getAddressEnvOrConfig(
      'BASE_SEPOLIA_USDC_ADDRESS',
      () => safeGetExternalContract('base-sepolia', 'tokens', 'usdc'),
      parseEnvAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
    ),
    facilitator: getAddressEnvOrConfig(
      'X402_BASE_SEPOLIA_FACILITATOR_ADDRESS',
      () =>
        safeGetExternalContract('base-sepolia', 'payments', 'x402Facilitator'),
    ),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  base: {
    chainId: 8453,
    name: 'Base',
    network: 'base',
    rpcUrl: getEnvRpcUrl('BASE_RPC_URL', getExternalRpc('base')),
    blockExplorer: 'https://basescan.org',
    usdc: getAddressEnvOrConfig(
      'BASE_USDC_ADDRESS',
      () => safeGetExternalContract('base', 'tokens', 'usdc'),
      parseEnvAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
    ),
    facilitator: getAddressEnvOrConfig('X402_BASE_FACILITATOR_ADDRESS', () =>
      safeGetExternalContract('base', 'payments', 'x402Facilitator'),
    ),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  sepolia: {
    chainId: 11155111,
    name: 'Sepolia',
    network: 'sepolia',
    rpcUrl: getEnvRpcUrl('SEPOLIA_RPC_URL', getExternalRpc('sepolia')),
    blockExplorer: 'https://sepolia.etherscan.io',
    usdc: getAddressEnvOrConfig(
      'SEPOLIA_USDC_ADDRESS',
      () => safeGetExternalContract('sepolia', 'tokens', 'usdc'),
      parseEnvAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'),
    ),
    facilitator: getAddressEnvOrConfig('X402_SEPOLIA_FACILITATOR_ADDRESS', () =>
      safeGetExternalContract('sepolia', 'payments', 'x402Facilitator'),
    ),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  ethereum: {
    chainId: 1,
    name: 'Ethereum',
    network: 'ethereum',
    rpcUrl: getEnvRpcUrl('ETHEREUM_RPC_URL', getExternalRpc('ethereum')),
    blockExplorer: 'https://etherscan.io',
    usdc: getAddressEnvOrConfig(
      'ETHEREUM_USDC_ADDRESS',
      () => safeGetExternalContract('ethereum', 'tokens', 'usdc'),
      parseEnvAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    ),
    facilitator: getAddressEnvOrConfig(
      'X402_ETHEREUM_FACILITATOR_ADDRESS',
      () => safeGetExternalContract('ethereum', 'payments', 'x402Facilitator'),
    ),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  'arbitrum-sepolia': {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    network: 'arbitrum-sepolia',
    rpcUrl: getEnvRpcUrl(
      'ARBITRUM_SEPOLIA_RPC_URL',
      getExternalRpc('arbitrumSepolia'),
    ),
    blockExplorer: 'https://sepolia.arbiscan.io',
    usdc: getAddressEnvOrConfig(
      'ARBITRUM_SEPOLIA_USDC_ADDRESS',
      () => safeGetExternalContract('arbitrumSepolia', 'tokens', 'usdc'),
      parseEnvAddress('0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'),
    ),
    facilitator: getAddressEnvOrConfig(
      'X402_ARBITRUM_SEPOLIA_FACILITATOR_ADDRESS',
      () =>
        safeGetExternalContract(
          'arbitrumSepolia',
          'payments',
          'x402Facilitator',
        ),
    ),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  arbitrum: {
    chainId: 42161,
    name: 'Arbitrum One',
    network: 'arbitrum',
    rpcUrl: getEnvRpcUrl('ARBITRUM_RPC_URL', getExternalRpc('arbitrum')),
    blockExplorer: 'https://arbiscan.io',
    usdc: getAddressEnvOrConfig(
      'ARBITRUM_USDC_ADDRESS',
      () => safeGetExternalContract('arbitrum', 'tokens', 'usdc'),
      parseEnvAddress('0xaf88d065e77c8cC2239327C5EDb3A432268e5831'),
    ),
    facilitator: getAddressEnvOrConfig(
      'X402_ARBITRUM_FACILITATOR_ADDRESS',
      () => safeGetExternalContract('arbitrum', 'payments', 'x402Facilitator'),
    ),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  'optimism-sepolia': {
    chainId: 11155420,
    name: 'Optimism Sepolia',
    network: 'optimism-sepolia',
    rpcUrl: getEnvRpcUrl(
      'OPTIMISM_SEPOLIA_RPC_URL',
      getExternalRpc('optimismSepolia'),
    ),
    blockExplorer: 'https://sepolia-optimism.etherscan.io',
    usdc: getAddressEnvOrConfig(
      'OPTIMISM_SEPOLIA_USDC_ADDRESS',
      () => safeGetExternalContract('optimismSepolia', 'tokens', 'usdc'),
      parseEnvAddress('0x5fd84259d66Cd46123540766Be93DFE6D43130D7'),
    ),
    facilitator: getAddressEnvOrConfig(
      'X402_OPTIMISM_SEPOLIA_FACILITATOR_ADDRESS',
      () =>
        safeGetExternalContract(
          'optimismSepolia',
          'payments',
          'x402Facilitator',
        ),
    ),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  optimism: {
    chainId: 10,
    name: 'Optimism',
    network: 'optimism',
    rpcUrl: getEnvRpcUrl('OPTIMISM_RPC_URL', getExternalRpc('optimism')),
    blockExplorer: 'https://optimistic.etherscan.io',
    usdc: getAddressEnvOrConfig(
      'OPTIMISM_USDC_ADDRESS',
      () => safeGetExternalContract('optimism', 'tokens', 'usdc'),
      parseEnvAddress('0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'),
    ),
    facilitator: getAddressEnvOrConfig(
      'X402_OPTIMISM_FACILITATOR_ADDRESS',
      () => safeGetExternalContract('optimism', 'payments', 'x402Facilitator'),
    ),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  'bsc-testnet': {
    chainId: 97,
    name: 'BSC Testnet',
    network: 'bsc-testnet',
    rpcUrl: getEnvRpcUrl('BSC_TESTNET_RPC_URL', getExternalRpc('bscTestnet')),
    blockExplorer: 'https://testnet.bscscan.com',
    usdc: getAddressEnvOrConfig(
      'BSC_TESTNET_USDT_ADDRESS',
      () => safeGetExternalContract('bscTestnet', 'tokens', 'usdt'),
      parseEnvAddress('0x337610d27c682E347C9cD60BD4b3b107C9d34dDd'),
    ), // USDT on BSC testnet
    facilitator: getAddressEnvOrConfig(
      'X402_BSC_TESTNET_FACILITATOR_ADDRESS',
      () =>
        safeGetExternalContract('bscTestnet', 'payments', 'x402Facilitator'),
    ),
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  },
  bsc: {
    chainId: 56,
    name: 'BNB Chain',
    network: 'bsc',
    rpcUrl: getEnvRpcUrl('BSC_RPC_URL', getExternalRpc('bsc')),
    blockExplorer: 'https://bscscan.com',
    usdc: getAddressEnvOrConfig(
      'BSC_USDC_ADDRESS',
      () => safeGetExternalContract('bsc', 'tokens', 'usdc'),
      parseEnvAddress('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'),
    ),
    facilitator: getAddressEnvOrConfig('X402_BSC_FACILITATOR_ADDRESS', () =>
      safeGetExternalContract('bsc', 'payments', 'x402Facilitator'),
    ),
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
