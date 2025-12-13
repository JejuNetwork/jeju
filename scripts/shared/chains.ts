/**
 * Shared chain configuration for OIF/EIL scripts
 */

export const PUBLIC_RPCS: Record<number, string> = {
  // Testnets
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
  84532: 'https://sepolia.base.org',
  421614: 'https://sepolia-rollup.arbitrum.io/rpc',
  11155420: 'https://sepolia.optimism.io',
  420690: 'https://testnet-rpc.jeju.network',
  // Mainnets
  1: 'https://eth.llamarpc.com',
  8453: 'https://mainnet.base.org',
  42161: 'https://arb1.arbitrum.io/rpc',
  10: 'https://mainnet.optimism.io',
  420691: 'https://rpc.jeju.network',
};

export const CHAIN_NAMES: Record<number, string> = {
  11155111: 'Sepolia',
  84532: 'Base Sepolia',
  421614: 'Arbitrum Sepolia',
  11155420: 'Optimism Sepolia',
  420690: 'Jeju Testnet',
  1: 'Ethereum',
  8453: 'Base',
  42161: 'Arbitrum One',
  10: 'OP Mainnet',
  420691: 'Jeju Mainnet',
};

export const TESTNET_CHAIN_IDS = [11155111, 84532, 421614, 11155420, 420690];
export const MAINNET_CHAIN_IDS = [1, 8453, 42161, 10, 420691];

export function getChainIds(network: 'testnet' | 'mainnet'): number[] {
  return network === 'testnet' ? TESTNET_CHAIN_IDS : MAINNET_CHAIN_IDS;
}

export function chainName(chainId: number): string {
  return CHAIN_NAMES[chainId] || `Chain ${chainId}`;
}

export function rpcUrl(chainId: number): string {
  const url = PUBLIC_RPCS[chainId];
  if (!url) throw new Error(`No RPC URL for chain ${chainId}`);
  return url;
}
