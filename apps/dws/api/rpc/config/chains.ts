/**
 * RPC Chain Configuration for DWS
 * Defines supported chains for RPC gateway functionality
 */

import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  type Chain,
  mainnet,
  optimism,
  optimismSepolia,
  sepolia,
} from 'viem/chains'

// Jeju custom chains
const jejuLocalnet: Chain = {
  id: 420690,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://localhost:6546'] } },
  testnet: true,
}

const jeju: Chain = {
  id: 420691,
  name: 'Jeju',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.jejunetwork.org'] } },
  blockExplorers: {
    default: { name: 'Jeju Explorer', url: 'https://explorer.jejunetwork.org' },
  },
}

export interface ChainConfig {
  chainId: number
  name: string
  shortName: string
  isTestnet: boolean
  rpcUrl: string
}

// All supported chains with their configurations
const chainData: Array<{
  chain: Chain
  shortName: string
  isTestnet: boolean
}> = [
  { chain: mainnet, shortName: 'eth', isTestnet: false },
  { chain: base, shortName: 'base', isTestnet: false },
  { chain: arbitrum, shortName: 'arb', isTestnet: false },
  { chain: optimism, shortName: 'op', isTestnet: false },
  { chain: jeju, shortName: 'jeju', isTestnet: false },
  { chain: sepolia, shortName: 'sep', isTestnet: true },
  { chain: baseSepolia, shortName: 'base-sep', isTestnet: true },
  { chain: arbitrumSepolia, shortName: 'arb-sep', isTestnet: true },
  { chain: optimismSepolia, shortName: 'op-sep', isTestnet: true },
  { chain: jejuLocalnet, shortName: 'jeju-local', isTestnet: true },
]

export const CHAINS: Record<number, ChainConfig> = Object.fromEntries(
  chainData.map(({ chain, shortName, isTestnet }) => [
    chain.id,
    {
      chainId: chain.id,
      name: chain.name,
      shortName,
      isTestnet,
      rpcUrl: chain.rpcUrls.default.http[0],
    },
  ]),
)

export function getChain(chainId: number): ChainConfig | undefined {
  return CHAINS[chainId]
}

export function isChainSupported(chainId: number): boolean {
  return chainId in CHAINS
}

export function getMainnetChains(): ChainConfig[] {
  return Object.values(CHAINS).filter((c) => !c.isTestnet)
}

export function getTestnetChains(): ChainConfig[] {
  return Object.values(CHAINS).filter((c) => c.isTestnet)
}
