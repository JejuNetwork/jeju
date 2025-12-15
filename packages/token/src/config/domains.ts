import type { ChainId } from '../types';

// Hyperlane domain IDs
export const CHAIN_TO_DOMAIN: Record<ChainId, number> = {
  // EVM Mainnets
  1: 1, // Ethereum
  10: 10, // Optimism
  56: 56, // BSC
  137: 137, // Polygon
  8453: 8453, // Base
  42161: 42161, // Arbitrum
  43114: 43114, // Avalanche
  // EVM Testnets
  11155111: 11155111, // Sepolia
  84532: 84532, // Base Sepolia
  421614: 421614, // Arbitrum Sepolia
  420690: 420690, // Jeju Testnet
  // SVM
  'solana-mainnet': 1399811149,
  'solana-devnet': 1399811150,
};

export function getDomainId(chainId: ChainId): number {
  const domain = CHAIN_TO_DOMAIN[chainId];
  if (domain === undefined) {
    throw new Error(`Unknown domain for chain ${chainId}`);
  }
  return domain;
}
