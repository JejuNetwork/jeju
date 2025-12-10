/**
 * Storage App Configuration
 * 
 * Config-first architecture:
 * - Defaults based on network
 * - NEXT_PUBLIC_* env vars override at build time
 */
import { defineChain } from 'viem';

// Network selection
export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK || 'localnet') as 'localnet' | 'testnet' | 'mainnet';

// Chain configuration
export const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || getDefaultChainId());
export const RPC_URL = process.env.NEXT_PUBLIC_JEJU_RPC_URL || getDefaultRpcUrl();

// Storage API
export const STORAGE_API_URL = process.env.NEXT_PUBLIC_STORAGE_API_URL || getDefaultStorageApiUrl();

// Chain definition
export const jeju = defineChain({
  id: CHAIN_ID,
  name: getChainName(),
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: {
      name: 'Jeju Explorer',
      url: getDefaultExplorerUrl(),
      apiUrl: `${getDefaultExplorerUrl()}/api`,
    },
  },
  testnet: NETWORK !== 'mainnet',
});

// ============================================================================
// Default value getters
// ============================================================================

function getDefaultChainId(): string {
  switch (NETWORK) {
    case 'mainnet': return '420691';
    case 'testnet': return '420690';
    default: return '1337';
  }
}

function getDefaultRpcUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://rpc.jeju.network';
    case 'testnet': return 'https://testnet-rpc.jeju.network';
    default: return 'http://localhost:9545';
  }
}

function getDefaultStorageApiUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://storage.jeju.network';
    case 'testnet': return 'https://testnet-storage.jeju.network';
    default: return 'http://localhost:3100';
  }
}

function getDefaultExplorerUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://explorer.jeju.network';
    case 'testnet': return 'https://testnet-explorer.jeju.network';
    default: return 'http://localhost:4000';
  }
}

function getChainName(): string {
  switch (NETWORK) {
    case 'mainnet': return 'Jeju';
    case 'testnet': return 'Jeju Testnet';
    default: return 'Jeju Localnet';
  }
}
