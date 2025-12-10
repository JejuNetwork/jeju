import type { Chain } from 'viem';
import { mainnet, arbitrum, optimism, sepolia, arbitrumSepolia, optimismSepolia, base, baseSepolia } from 'viem/chains';
import { RPC_URLS, EXPLORER_URLS, CHAINS as CHAIN_META } from '../config/networks.js';

// Jeju chain definitions
export const jejuTestnet: Chain = {
  id: 420690,
  name: CHAIN_META[420690].name,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URLS[420690]] } },
  blockExplorers: { default: { name: 'Jeju Explorer', url: EXPLORER_URLS[420690] } },
};

export const jejuMainnet: Chain = {
  id: 420691,
  name: CHAIN_META[420691].name,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URLS[420691]] } },
  blockExplorers: { default: { name: 'Jeju Explorer', url: EXPLORER_URLS[420691] } },
};

export const localnet: Chain = {
  id: 1337,
  name: CHAIN_META[1337].name,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URLS[1337]] } },
  blockExplorers: { default: { name: 'Local Explorer', url: EXPLORER_URLS[1337] } },
};

// All chains indexed by chain ID
export const CHAINS: Record<number, Chain> = {
  1: mainnet,
  42161: arbitrum,
  10: optimism,
  8453: base,
  11155111: sepolia,
  421614: arbitrumSepolia,
  11155420: optimismSepolia,
  84532: baseSepolia,
  420690: jejuTestnet,
  420691: jejuMainnet,
  1337: localnet,
};

export function getChain(chainId: number): Chain {
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`Unsupported chain: ${chainId}`);
  return chain;
}
