import type { Address } from 'viem';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

export const NETWORK = (import.meta.env.VITE_NETWORK || 'localnet') as 'localnet' | 'testnet' | 'mainnet';
export const CHAIN_ID = parseInt(import.meta.env.VITE_CHAIN_ID || getDefaultChainId());
export const RPC_URL = import.meta.env.VITE_RPC_URL || getDefaultRpcUrl();
export const DWS_API_URL = import.meta.env.VITE_DWS_API_URL || getDefaultDwsApiUrl();
export const OAUTH3_AGENT_URL = import.meta.env.VITE_OAUTH3_AGENT_URL || getDefaultOAuth3AgentUrl();
export const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID';

export const CONTRACTS = {
  identityRegistry: (import.meta.env.VITE_IDENTITY_REGISTRY_ADDRESS || ZERO_ADDRESS) as Address,
  banManager: (import.meta.env.VITE_BAN_MANAGER_ADDRESS || ZERO_ADDRESS) as Address,
  moderationMarketplace: (import.meta.env.VITE_MODERATION_MARKETPLACE_ADDRESS || ZERO_ADDRESS) as Address,
  reportingSystem: (import.meta.env.VITE_REPORTING_SYSTEM_ADDRESS || ZERO_ADDRESS) as Address,
  computeRegistry: (import.meta.env.VITE_COMPUTE_REGISTRY_ADDRESS || ZERO_ADDRESS) as Address,
  fileStorageManager: (import.meta.env.VITE_FILE_STORAGE_MANAGER_ADDRESS || ZERO_ADDRESS) as Address,
  jnsRegistry: (import.meta.env.VITE_JNS_REGISTRY || ZERO_ADDRESS) as Address,
  jnsResolver: (import.meta.env.VITE_JNS_RESOLVER || ZERO_ADDRESS) as Address,
  x402Facilitator: (import.meta.env.VITE_X402_FACILITATOR_ADDRESS || ZERO_ADDRESS) as Address,
} as const;

function getDefaultChainId(): string {
  switch (NETWORK) {
    case 'mainnet': return '420691';
    case 'testnet': return '420690';
    default: return '1337';
  }
}

function getDefaultRpcUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://rpc.jejunetwork.org';
    case 'testnet': return 'https://testnet-rpc.jejunetwork.org';
    default: return 'http://127.0.0.1:9545';
  }
}

function getDefaultDwsApiUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://dws.jejunetwork.org';
    case 'testnet': return 'https://testnet-dws.jejunetwork.org';
    default: return 'http://127.0.0.1:4030';
  }
}

function getDefaultOAuth3AgentUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://auth.jejunetwork.org';
    case 'testnet': return 'https://testnet-auth.jejunetwork.org';
    default: return 'http://127.0.0.1:4200';
  }
}

export const API_ENDPOINTS = {
  health: '/health',
  storage: '/storage',
  compute: '/compute',
  containers: '/containers',
  workers: '/workers',
  cdn: '/cdn',
  git: '/git',
  pkg: '/pkg',
  ci: '/ci',
  kms: '/kms',
  vpn: '/vpn',
  rpc: '/rpc',
  api: '/api',
  oauth3: '/oauth3',
  rlaif: '/rlaif',
  scraping: '/scraping',
} as const;


