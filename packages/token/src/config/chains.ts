import {
  getExternalRpc,
  getJejuHyperlaneIgp,
  getJejuHyperlaneMailbox,
  getRpcUrl as getJejuRpcUrl,
} from '@jejunetwork/config'
import type { ChainConfig, ChainId } from '../types'
import { chainConfigSchema, ValidationError } from '../validation'

// Default RPC URLs - can be overridden by environment variables
const DEFAULT_RPC_URLS = {
  ethereum: 'https://eth.llamarpc.com',
  optimism: 'https://mainnet.optimism.io',
  bsc: 'https://bsc-dataseed.binance.org',
  base: 'https://mainnet.base.org',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  polygon: 'https://polygon-rpc.com',
  avalanche: 'https://api.avax.network/ext/bc/C/rpc',
  solana: 'https://api.mainnet-beta.solana.com',
  sepolia: 'https://rpc.sepolia.org',
  baseSepolia: 'https://sepolia.base.org',
  arbitrumSepolia: 'https://sepolia-rollup.arbitrum.io/rpc',
  solanaDevnet: 'https://api.devnet.solana.com',
  jejuTestnet: 'https://testnet-rpc.jejunetwork.org',
} as const

function getRpcUrl(chainName: keyof typeof DEFAULT_RPC_URLS): string {
  // Try to get from config first
  const configRpc = getExternalRpc(chainName)
  if (configRpc) return configRpc
  return DEFAULT_RPC_URLS[chainName]
}

// Mainnet chains
export const ethereumMainnet: ChainConfig = {
  chainId: 1,
  chainType: 'evm',
  name: 'Ethereum Mainnet',
  rpcUrl: getRpcUrl('ethereum'),
  blockExplorerUrl: 'https://etherscan.io',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  hyperlaneMailbox: '0xc005dc82818d67AF737725bD4bf75435d065D239',
  hyperlaneIgp: '0x6f2756380FD49228ae25Aa7F2817993cB74Ecc56',
  isHomeChain: true,
  avgBlockTime: 12,
  uniswapV4PoolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
  dexRouter: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
}

export const optimism: ChainConfig = {
  chainId: 10,
  chainType: 'evm',
  name: 'Optimism',
  rpcUrl: getRpcUrl('optimism'),
  blockExplorerUrl: 'https://optimistic.etherscan.io',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  hyperlaneMailbox: '0xd4C1905BB1D26BC93DAC913e13CaCC278CdCC80D',
  hyperlaneIgp: '0xD8A76C4D91fCbB7Cc8eA795DFDF870E48368995C',
  isHomeChain: false,
  avgBlockTime: 2,
  uniswapV4PoolManager: '0x9a13F98Cb987694C9F086b1F5eB990EeA8264Ec3',
  dexRouter: '0xCb1355ff08Ab38bBCE60111F1bb2B784bE25D7e8',
}

export const bsc: ChainConfig = {
  chainId: 56,
  chainType: 'evm',
  name: 'BNB Smart Chain',
  rpcUrl: getRpcUrl('bsc'),
  blockExplorerUrl: 'https://bscscan.com',
  nativeCurrency: {
    name: 'BNB',
    symbol: 'BNB',
    decimals: 18,
  },
  hyperlaneMailbox: '0x2971b9Aec44bE4eb673DF1B88cDB57b96eefe8a4',
  hyperlaneIgp: '0x78E25e7f84416e69b9339B0A6336EB6EFfF6b451',
  isHomeChain: false,
  avgBlockTime: 3,
  dexRouter: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
}

export const base: ChainConfig = {
  chainId: 8453,
  chainType: 'evm',
  name: 'Base',
  rpcUrl: getRpcUrl('base'),
  blockExplorerUrl: 'https://basescan.org',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  hyperlaneMailbox: '0xeA87ae93Fa0019a82A727bfd3eBd1cFCa8f64f1D',
  hyperlaneIgp: '0xc3F23848Ed2e04C0c6d41bd7804fa8f89F940B94',
  isHomeChain: false,
  avgBlockTime: 2,
  uniswapV4PoolManager: '0x498581fF718922c3f8e6A244956aF099B2652b2b',
  dexRouter: '0x2626664c2603336E57B271c5C0b26F421741e481',
}

export const arbitrum: ChainConfig = {
  chainId: 42161,
  chainType: 'evm',
  name: 'Arbitrum One',
  rpcUrl: getRpcUrl('arbitrum'),
  blockExplorerUrl: 'https://arbiscan.io',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  hyperlaneMailbox: '0x979Ca5202784112f4738403dBec5D0F3B9daabB9',
  hyperlaneIgp: '0x3b6044acd6767f017e99318AA6Ef93b7B06A5a22',
  isHomeChain: false,
  avgBlockTime: 0.25,
  uniswapV4PoolManager: '0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32',
  dexRouter: '0x5E325eDA8064b456f4781070C0738d849c824258',
}

export const polygon: ChainConfig = {
  chainId: 137,
  chainType: 'evm',
  name: 'Polygon',
  rpcUrl: getRpcUrl('polygon'),
  blockExplorerUrl: 'https://polygonscan.com',
  nativeCurrency: {
    name: 'MATIC',
    symbol: 'MATIC',
    decimals: 18,
  },
  hyperlaneMailbox: '0x5d934f4e2f797775e53561bB72aca21ba36B96BB',
  hyperlaneIgp: '0x0071740Bf129b05C4684abfbBeD248D80971cce2',
  isHomeChain: false,
  avgBlockTime: 2,
  dexRouter: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
}

export const avalanche: ChainConfig = {
  chainId: 43114,
  chainType: 'evm',
  name: 'Avalanche C-Chain',
  rpcUrl: getRpcUrl('avalanche'),
  blockExplorerUrl: 'https://snowtrace.io',
  nativeCurrency: {
    name: 'AVAX',
    symbol: 'AVAX',
    decimals: 18,
  },
  hyperlaneMailbox: '0xFf06aFcaABaDDd1fb08371f9ccA15D73D51FeBD6',
  hyperlaneIgp: '0x95519ba800BBd0d34eeAE026fEc620AD978176C0',
  isHomeChain: false,
  avgBlockTime: 2,
  dexRouter: '0x60aE616a2155Ee3d9A68541Ba4544862310933d4',
}

export const solanaMainnet: ChainConfig = {
  chainId: 'solana-mainnet',
  chainType: 'solana',
  name: 'Solana Mainnet',
  rpcUrl: getRpcUrl('solana'),
  blockExplorerUrl: 'https://explorer.solana.com',
  nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
  hyperlaneMailbox: 'EitxJuv2iBjsg2d7jVy2LDC1e2zBrx4GB5Y9h2Ko3A9Y',
  hyperlaneIgp: 'Hs7KVBU67nBnWhDj4MWXdUCMJd6v5tQYNrVDRHhhmDPF',
  isHomeChain: false,
  avgBlockTime: 0.4,
  dexRouter: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
}

// Testnet chains
export const sepolia: ChainConfig = {
  chainId: 11155111,
  chainType: 'evm',
  name: 'Sepolia Testnet',
  rpcUrl: getRpcUrl('sepolia'),
  blockExplorerUrl: 'https://sepolia.etherscan.io',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  hyperlaneMailbox: '0xfFAEF09B3cd11D9b20d1a19bECca54EEC2884766',
  hyperlaneIgp: '0x6f2756380FD49228ae25Aa7F2817993cB74Ecc56',
  isHomeChain: true,
  avgBlockTime: 12,
  uniswapV4PoolManager: '0x8C4BcBE6b9eF47855f97E675296FA3F6fafa5F1A',
}

export const baseSepolia: ChainConfig = {
  chainId: 84532,
  chainType: 'evm',
  name: 'Base Sepolia',
  rpcUrl: getRpcUrl('baseSepolia'),
  blockExplorerUrl: 'https://sepolia.basescan.org',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  hyperlaneMailbox: '0x6966b0E55883d49BFB24539356a2f8A673E02039',
  hyperlaneIgp: '0x28B02B97a850872C4D33C3E024fab6499ad96564',
  isHomeChain: false,
  avgBlockTime: 2,
}

export const arbitrumSepolia: ChainConfig = {
  chainId: 421614,
  chainType: 'evm',
  name: 'Arbitrum Sepolia',
  rpcUrl: getRpcUrl('arbitrumSepolia'),
  blockExplorerUrl: 'https://sepolia.arbiscan.io',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  hyperlaneMailbox: '0x598facE78a4302f11E3de0bee1894Da0b2Cb71F8',
  hyperlaneIgp: '0x940F84B4a87F5c6b0F6b2Db2F8C83aa1dE64B22d',
  isHomeChain: false,
  avgBlockTime: 0.25,
}

export const solanaDevnet: ChainConfig = {
  chainId: 'solana-devnet',
  chainType: 'solana',
  name: 'Solana Devnet',
  rpcUrl: getRpcUrl('solanaDevnet'),
  blockExplorerUrl: 'https://explorer.solana.com?cluster=devnet',
  nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
  hyperlaneMailbox: 'E588QtVUvresuXq2KoNEwAmoifCzYGpRBdHByN9KQMbi',
  hyperlaneIgp: '3TJMcAhHRE7JN98URK7s5eeGfmVSvL4GAgegPq5K2nYg',
  isHomeChain: false,
  avgBlockTime: 0.4,
  dexRouter: 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',
}

export const MAINNET_CHAINS: ChainConfig[] = [
  ethereumMainnet,
  optimism,
  bsc,
  base,
  arbitrum,
  polygon,
  avalanche,
  solanaMainnet,
]

// Jeju Testnet (L2 on Sepolia) - For integration with Jeju Network
// Run `jeju token deploy:hyperlane --network testnet` to deploy Hyperlane
export const jejuTestnet: ChainConfig = {
  chainId: 420690,
  chainType: 'evm',
  name: 'Jeju Testnet',
  rpcUrl: getJejuRpcUrl('testnet'),
  blockExplorerUrl: 'https://testnet-explorer.jejunetwork.org',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  // Hyperlane addresses - require env var if custom deployment, otherwise use empty (not yet deployed)
  hyperlaneMailbox: getJejuHyperlaneMailbox(),
  hyperlaneIgp: getJejuHyperlaneIgp(),
  isHomeChain: false,
  avgBlockTime: 2,
  // Jeju uses Uniswap V4 (addresses from Jeju's config)
  uniswapV4PoolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
}

export const TESTNET_CHAINS: ChainConfig[] = [
  sepolia,
  baseSepolia,
  arbitrumSepolia,
  jejuTestnet,
  solanaDevnet,
]

export const ALL_CHAINS: ChainConfig[] = [...MAINNET_CHAINS, ...TESTNET_CHAINS]

export function getChainConfig(chainId: ChainId): ChainConfig {
  const chain = ALL_CHAINS.find((c) => c.chainId === chainId)
  if (!chain) {
    throw new Error(`Unknown chain ID: ${chainId}`)
  }
  return chain
}

export function getEVMChains(mainnetOnly = true): ChainConfig[] {
  const chains = mainnetOnly ? MAINNET_CHAINS : ALL_CHAINS
  return chains.filter((c) => c.chainType === 'evm')
}

export function getSolanaChains(mainnetOnly = true): ChainConfig[] {
  const chains = mainnetOnly ? MAINNET_CHAINS : ALL_CHAINS
  return chains.filter((c) => c.chainType === 'solana')
}

export function getHomeChain(mainnetOnly = true): ChainConfig {
  const chains = mainnetOnly ? MAINNET_CHAINS : ALL_CHAINS
  const home = chains.find((c) => c.isHomeChain)
  if (!home) {
    throw new Error('No home chain configured')
  }
  return home
}

export function validateChainConfig(config: ChainConfig): ChainConfig {
  const result = chainConfigSchema.safeParse(config)
  if (!result.success) {
    const errorMessages = result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ')
    throw new ValidationError(
      `Invalid chain config for ${config.name}: ${errorMessages}`,
      result.error.issues,
    )
  }
  // Safe to cast: we validated the input config which already has the correct ChainConfig type
  // Zod infers broader types but the validation ensures it matches ChainConfig
  return result.data as ChainConfig
}
