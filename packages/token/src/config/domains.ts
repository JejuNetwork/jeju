import type { ChainId } from '../types';

/**
 * Hyperlane domain IDs for supported chains
 * Not all chains have Hyperlane deployments - getDomainId will throw for unsupported chains
 */
export const CHAIN_TO_DOMAIN: Partial<Record<ChainId, number>> = {
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
  11155420: 11155420, // Optimism Sepolia
  84532: 84532, // Base Sepolia
  421614: 421614, // Arbitrum Sepolia
  420690: 420690, // Jeju Testnet
  420691: 420691, // Jeju Mainnet
  // Local development (no Hyperlane, but domain ID = chain ID)
  1337: 1337, // Localnet
  31337: 31337, // Local EVM
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
