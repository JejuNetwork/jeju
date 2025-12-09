/**
 * @fileoverview OIF Configuration System
 * Centralized configuration for contract addresses and chain settings
 */

import type { Address } from 'viem';

// Supported chain IDs
export const SUPPORTED_CHAINS = [1, 11155111, 42161, 10, 420691, 420690] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAINS)[number];

// Chain information
export const CHAIN_INFO: Record<SupportedChainId, {
  name: string;
  shortName: string;
  rpcUrl: string;
  explorerUrl: string;
  isTestnet: boolean;
}> = {
  1: {
    name: 'Ethereum',
    shortName: 'ETH',
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    explorerUrl: 'https://etherscan.io',
    isTestnet: false,
  },
  11155111: {
    name: 'Sepolia',
    shortName: 'SEP',
    rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
    explorerUrl: 'https://sepolia.etherscan.io',
    isTestnet: true,
  },
  42161: {
    name: 'Arbitrum One',
    shortName: 'ARB',
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    explorerUrl: 'https://arbiscan.io',
    isTestnet: false,
  },
  10: {
    name: 'Optimism',
    shortName: 'OP',
    rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    explorerUrl: 'https://optimistic.etherscan.io',
    isTestnet: false,
  },
  420691: {
    name: 'Jeju',
    shortName: 'JEJU',
    rpcUrl: process.env.JEJU_RPC_URL || 'https://rpc.jeju.network',
    explorerUrl: 'https://explorer.jeju.network',
    isTestnet: false,
  },
  420690: {
    name: 'Jeju Testnet',
    shortName: 'JEJU-TEST',
    rpcUrl: process.env.JEJU_TESTNET_RPC_URL || 'https://testnet-rpc.jeju.network',
    explorerUrl: 'https://testnet-explorer.jeju.network',
    isTestnet: true,
  },
};

// Contract addresses per chain
export interface OIFChainContracts {
  inputSettler: Address;
  outputSettler: Address;
  oracle: Address;
}

// Load contract address from env or return undefined
function getContractAddress(envKey: string): Address | undefined {
  const addr = process.env[envKey];
  if (addr && addr.startsWith('0x') && addr.length === 42) {
    return addr as Address;
  }
  return undefined;
}

// Contract deployment addresses
export const OIF_CONTRACTS: Partial<Record<SupportedChainId, OIFChainContracts>> = {
  1: {
    inputSettler: getContractAddress('OIF_INPUT_SETTLER_1') || '0x0000000000000000000000000000000000000000',
    outputSettler: getContractAddress('OIF_OUTPUT_SETTLER_1') || '0x0000000000000000000000000000000000000000',
    oracle: getContractAddress('OIF_ORACLE_1') || '0x0000000000000000000000000000000000000000',
  },
  11155111: {
    inputSettler: getContractAddress('OIF_INPUT_SETTLER_11155111') || '0x0000000000000000000000000000000000000000',
    outputSettler: getContractAddress('OIF_OUTPUT_SETTLER_11155111') || '0x0000000000000000000000000000000000000000',
    oracle: getContractAddress('OIF_ORACLE_11155111') || '0x0000000000000000000000000000000000000000',
  },
  42161: {
    inputSettler: getContractAddress('OIF_INPUT_SETTLER_42161') || '0x0000000000000000000000000000000000000000',
    outputSettler: getContractAddress('OIF_OUTPUT_SETTLER_42161') || '0x0000000000000000000000000000000000000000',
    oracle: getContractAddress('OIF_ORACLE_42161') || '0x0000000000000000000000000000000000000000',
  },
  10: {
    inputSettler: getContractAddress('OIF_INPUT_SETTLER_10') || '0x0000000000000000000000000000000000000000',
    outputSettler: getContractAddress('OIF_OUTPUT_SETTLER_10') || '0x0000000000000000000000000000000000000000',
    oracle: getContractAddress('OIF_ORACLE_10') || '0x0000000000000000000000000000000000000000',
  },
  420691: {
    inputSettler: getContractAddress('OIF_INPUT_SETTLER_420691') || '0x0000000000000000000000000000000000000000',
    outputSettler: getContractAddress('OIF_OUTPUT_SETTLER_420691') || '0x0000000000000000000000000000000000000000',
    oracle: getContractAddress('OIF_ORACLE_420691') || '0x0000000000000000000000000000000000000000',
  },
  420690: {
    inputSettler: getContractAddress('OIF_INPUT_SETTLER_420690') || '0x0000000000000000000000000000000000000000',
    outputSettler: getContractAddress('OIF_OUTPUT_SETTLER_420690') || '0x0000000000000000000000000000000000000000',
    oracle: getContractAddress('OIF_ORACLE_420690') || '0x0000000000000000000000000000000000000000',
  },
};

// Solver Registry (single deployment, usually on L1)
export const SOLVER_REGISTRY_ADDRESS: Address = 
  getContractAddress('OIF_SOLVER_REGISTRY') || '0x0000000000000000000000000000000000000000';

// Aggregator configuration
export const AGGREGATOR_CONFIG = {
  port: Number(process.env.AGGREGATOR_PORT) || 4010,
  wsPort: Number(process.env.AGGREGATOR_WS_PORT) || 4012,
  indexerUrl: process.env.INDEXER_URL || 'http://127.0.0.1:4350/graphql',
  rateLimitRpm: Number(process.env.RATE_LIMIT_RPM) || 100,
};

// Solver configuration
export const SOLVER_CONFIG = {
  minProfitBps: Number(process.env.SOLVER_MIN_PROFIT_BPS) || 10,
  maxGasPriceGwei: Number(process.env.SOLVER_MAX_GAS_GWEI) || 100,
  maxExposureEth: process.env.SOLVER_MAX_EXPOSURE_ETH || '10',
  rebalanceIntervalMs: Number(process.env.SOLVER_REBALANCE_INTERVAL_MS) || 60000,
};

// Token addresses per chain
export const COMMON_TOKENS: Record<SupportedChainId, Record<string, Address>> = {
  1: {
    ETH: '0x0000000000000000000000000000000000000000',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },
  11155111: {
    ETH: '0x0000000000000000000000000000000000000000',
    WETH: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9', // Sepolia WETH
  },
  42161: {
    ETH: '0x0000000000000000000000000000000000000000',
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
  10: {
    ETH: '0x0000000000000000000000000000000000000000',
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  },
  420691: {
    ETH: '0x0000000000000000000000000000000000000000',
    WETH: '0x4200000000000000000000000000000000000006', // OP-Stack predeploy
  },
  420690: {
    ETH: '0x0000000000000000000000000000000000000000',
    WETH: '0x4200000000000000000000000000000000000006', // OP-Stack predeploy
  },
};

// Helper to get contracts for a chain
export function getChainContracts(chainId: SupportedChainId): OIFChainContracts | undefined {
  return OIF_CONTRACTS[chainId];
}

// Helper to check if chain is supported
export function isChainSupported(chainId: number): chainId is SupportedChainId {
  return SUPPORTED_CHAINS.includes(chainId as SupportedChainId);
}

// Helper to get RPC URL for chain
export function getChainRpcUrl(chainId: SupportedChainId): string {
  return CHAIN_INFO[chainId].rpcUrl;
}

// Export all config
export const OIF_CONFIG = {
  chains: CHAIN_INFO,
  contracts: OIF_CONTRACTS,
  solverRegistry: SOLVER_REGISTRY_ADDRESS,
  aggregator: AGGREGATOR_CONFIG,
  solver: SOLVER_CONFIG,
  tokens: COMMON_TOKENS,
};
