/**
 * Paymaster Integration for Indexer
 * Provides types and utilities for paymaster operations in the indexer
 */

export interface PaymasterInfo {
  address: string;
  name: string;
  symbol: string;
  entryPoint: string;
  tokenAddress: string;
  isActive: boolean;
}

export interface PaymasterConfig {
  network: string;
  paymasters: PaymasterInfo[];
}

/**
 * Get available paymasters for the current network
 * Note: This is a stub - actual implementation reads from deployment files
 */
export async function getAvailablePaymasters(): Promise<PaymasterInfo[]> {
  return [];
}

/**
 * Get the paymaster for a specific token
 */
export async function getPaymasterForToken(tokenAddress: string): Promise<PaymasterInfo | null> {
  const paymasters = await getAvailablePaymasters();
  return paymasters.find(p => p.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()) || null;
}

/**
 * Generate paymaster data for a transaction
 */
export function generatePaymasterData(paymasterAddress: string): string {
  return paymasterAddress;
}

/**
 * Load paymaster configuration from deployment files
 */
export async function loadPaymasterConfig(): Promise<PaymasterConfig> {
  return {
    network: process.env.NETWORK || 'localnet',
    paymasters: [],
  };
}

export const paymasterService = {
  getAvailablePaymasters,
  getPaymasterForToken,
  generatePaymasterData,
};
