import type { Chain } from 'viem';
import { mainnet, arbitrum, optimism, sepolia, arbitrumSepolia, optimismSepolia } from 'viem/chains';
import { CHAIN_INFO, type SupportedChainId } from '../config/oif.js';

// Jeju chain definitions using canonical config
export const jejuTestnet: Chain = {
  id: 420690,
  name: CHAIN_INFO[420690].name,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [CHAIN_INFO[420690].rpcUrl] } },
  blockExplorers: { default: { name: 'Jeju Explorer', url: CHAIN_INFO[420690].explorerUrl } },
};

export const jejuMainnet: Chain = {
  id: 420691,
  name: CHAIN_INFO[420691].name,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [CHAIN_INFO[420691].rpcUrl] } },
  blockExplorers: { default: { name: 'Jeju Explorer', url: CHAIN_INFO[420691].explorerUrl } },
};

export const localnet: Chain = {
  id: 1337,
  name: CHAIN_INFO[1337].name,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [CHAIN_INFO[1337].rpcUrl] } },
  blockExplorers: { default: { name: 'Local Explorer', url: CHAIN_INFO[1337].explorerUrl } },
};

// All chains indexed by chain ID
export const CHAINS: Record<number, Chain> = {
  1: mainnet,
  42161: arbitrum,
  10: optimism,
  11155111: sepolia,
  421614: arbitrumSepolia,
  11155420: optimismSepolia,
  420690: jejuTestnet,
  420691: jejuMainnet,
  1337: localnet,
};

export function getChain(chainId: number): Chain {
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`Unsupported chain: ${chainId}`);
  return chain;
}

export function getRpcUrl(chainId: SupportedChainId): string {
  return CHAIN_INFO[chainId].rpcUrl;
}

export function getExplorerUrl(chainId: SupportedChainId): string {
  return CHAIN_INFO[chainId].explorerUrl;
}
