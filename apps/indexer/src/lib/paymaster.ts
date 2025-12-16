/**
 * Paymaster Integration for Indexer
 * Provides types and utilities for paymaster operations in the indexer
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

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

// Cache for loaded paymaster config
let cachedConfig: PaymasterConfig | null = null;
let configLoadedAt = 0;
const CONFIG_CACHE_TTL = 60_000; // 1 minute

/**
 * Get the deployment directory based on network
 */
function getDeploymentDir(): string {
  const network = process.env.NETWORK || 'localnet';
  // Check multiple possible deployment locations
  const possiblePaths = [
    join(process.cwd(), 'deployments', network),
    join(process.cwd(), '..', 'deployments', network),
    join(process.cwd(), '..', '..', 'deployments', network),
    join(process.cwd(), 'packages', 'contracts', 'deployments', network),
  ];
  
  for (const path of possiblePaths) {
    if (existsSync(path)) return path;
  }
  
  return possiblePaths[0]; // Default to first path
}

/**
 * Load paymaster configuration from deployment files
 */
export async function loadPaymasterConfig(): Promise<PaymasterConfig> {
  const now = Date.now();
  
  // Return cached config if still valid
  if (cachedConfig && (now - configLoadedAt) < CONFIG_CACHE_TTL) {
    return cachedConfig;
  }

  const network = process.env.NETWORK || 'localnet';
  const deploymentDir = getDeploymentDir();
  const paymasters: PaymasterInfo[] = [];

  // Try to load addresses.json from deployment directory
  const addressesPath = join(deploymentDir, 'addresses.json');
  
  if (existsSync(addressesPath)) {
    try {
      const addresses = JSON.parse(readFileSync(addressesPath, 'utf-8')) as Record<string, string>;
      
      // Look for paymaster-related contracts
      const paymasterContracts = [
        { key: 'MultiTokenPaymaster', name: 'Multi-Token Paymaster', symbol: 'MULTI' },
        { key: 'ServicePaymaster', name: 'Service Paymaster', symbol: 'SVC' },
        { key: 'CrossChainPaymaster', name: 'Cross-Chain Paymaster', symbol: 'XLP' },
        { key: 'NFTPaymaster', name: 'NFT Paymaster', symbol: 'NFT' },
      ];

      for (const pm of paymasterContracts) {
        const address = addresses[pm.key];
        if (address) {
          paymasters.push({
            address,
            name: pm.name,
            symbol: pm.symbol,
            entryPoint: addresses['EntryPoint'] || '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
            tokenAddress: addresses['USDC'] || addresses['MockUSDC'] || '',
            isActive: true,
          });
        }
      }
    } catch (error) {
      console.warn(`Failed to load paymaster addresses from ${addressesPath}:`, error);
    }
  }

  // Also check for individual paymaster deployment files
  const paymasterFiles = [
    'MultiTokenPaymaster.json',
    'ServicePaymaster.json', 
    'CrossChainPaymaster.json',
    'NFTPaymaster.json',
  ];

  for (const file of paymasterFiles) {
    const filePath = join(deploymentDir, file);
    if (existsSync(filePath)) {
      try {
        const deployment = JSON.parse(readFileSync(filePath, 'utf-8')) as {
          address: string;
          args?: string[];
          transactionHash?: string;
        };
        
        // Skip if already added from addresses.json
        if (paymasters.some(p => p.address.toLowerCase() === deployment.address.toLowerCase())) {
          continue;
        }

        const name = file.replace('.json', '').replace(/([A-Z])/g, ' $1').trim();
        paymasters.push({
          address: deployment.address,
          name,
          symbol: name.split(' ').map(w => w[0]).join(''),
          entryPoint: deployment.args?.[0] || '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
          tokenAddress: deployment.args?.[1] || '',
          isActive: true,
        });
      } catch (error) {
        console.warn(`Failed to load ${filePath}:`, error);
      }
    }
  }

  cachedConfig = { network, paymasters };
  configLoadedAt = now;
  
  return cachedConfig;
}

/**
 * Get available paymasters for the current network
 */
export async function getAvailablePaymasters(): Promise<PaymasterInfo[]> {
  const config = await loadPaymasterConfig();
  return config.paymasters.filter(p => p.isActive);
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
export function generatePaymasterData(paymasterAddress: string, tokenAddress?: string): string {
  // ERC-4337 paymaster data format
  // For simple paymasters, just the address is sufficient
  // For token-paying paymasters, include the token address
  if (tokenAddress) {
    // Pack paymaster address + token address for MultiTokenPaymaster
    return paymasterAddress + tokenAddress.slice(2);
  }
  return paymasterAddress;
}

/**
 * Clear the paymaster config cache
 */
export function clearPaymasterCache(): void {
  cachedConfig = null;
  configLoadedAt = 0;
}

export const paymasterService = {
  getAvailablePaymasters,
  getPaymasterForToken,
  generatePaymasterData,
  loadPaymasterConfig,
  clearPaymasterCache,
};
