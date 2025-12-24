/**
 * Chain utilities for DWS services
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
export const jejuLocalnet: Chain = {
  id: 420690,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://localhost:6546'] } },
  testnet: true,
}

export const jeju: Chain = {
  id: 420691,
  name: 'Jeju',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.jejunetwork.org'] } },
  blockExplorers: {
    default: { name: 'Jeju Explorer', url: 'https://explorer.jejunetwork.org' },
  },
}

// All supported chains
export const CHAINS: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
  11155111: sepolia,
  84532: baseSepolia,
  421614: arbitrumSepolia,
  11155420: optimismSepolia,
  420690: jejuLocalnet,
  420691: jeju,
}

export function getChain(chainId: number): Chain | undefined {
  return CHAINS[chainId]
}

export function isChainSupported(chainId: number): boolean {
  return chainId in CHAINS
}

export function getMainnetChains(): Chain[] {
  return [mainnet, base, arbitrum, optimism, jeju]
}

export function getTestnetChains(): Chain[] {
  return [sepolia, baseSepolia, arbitrumSepolia, optimismSepolia, jejuLocalnet]
}

export function getRpcUrl(chainId: number): string {
  const envUrl = process.env[`RPC_URL_${chainId}`] || process.env.RPC_URL
  if (envUrl) return envUrl

  const chain = getChain(chainId)
  if (chain?.rpcUrls.default.http[0]) {
    return chain.rpcUrls.default.http[0]
  }

  return 'http://localhost:6546'
}
