/**
 * Chain Configuration for x402 Facilitator
 */

import type { Address } from 'viem';
import type { ChainConfig, TokenConfig } from './types';

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

function getRpcUrl(envKey: string, defaultUrl: string): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const url = process.env[envKey];
  if (!url && isProduction) {
    throw new Error(`${envKey} must be set in production`);
  }
  return url || defaultUrl;
}

function getUsdcAddress(envKey: string, defaultAddress: Address, network: string): Address {
  const isProduction = process.env.NODE_ENV === 'production';
  const address = process.env[envKey];
  if (!address && isProduction && network !== 'jeju-testnet') {
    throw new Error(`${envKey} must be set in production for ${network}`);
  }
  return (address || defaultAddress) as Address;
}

export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  jeju: {
    chainId: 420691,
    name: 'Jeju',
    network: 'jeju',
    rpcUrl: getRpcUrl('JEJU_RPC_URL', 'http://127.0.0.1:9545'),
    usdc: getUsdcAddress('JEJU_USDC_ADDRESS', '0x0165878A594ca255338adfa4d48449f69242Eb8F', 'jeju'),
    facilitator: (process.env.X402_FACILITATOR_ADDRESS || ZERO_ADDRESS) as Address,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  'jeju-testnet': {
    chainId: 420690,
    name: 'Jeju Testnet',
    network: 'jeju-testnet',
    rpcUrl: getRpcUrl('JEJU_TESTNET_RPC_URL', 'https://testnet-rpc.jeju.network'),
    usdc: ZERO_ADDRESS,
    facilitator: ZERO_ADDRESS,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  'base-sepolia': {
    chainId: 84532,
    name: 'Base Sepolia',
    network: 'base-sepolia',
    rpcUrl: getRpcUrl('BASE_SEPOLIA_RPC_URL', 'https://sepolia.base.org'),
    blockExplorer: 'https://sepolia.basescan.org',
    usdc: getUsdcAddress('BASE_SEPOLIA_USDC_ADDRESS', '0x036CbD53842c5426634e7929541eC2318f3dCF7e', 'base-sepolia'),
    facilitator: ZERO_ADDRESS,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  base: {
    chainId: 8453,
    name: 'Base',
    network: 'base',
    rpcUrl: getRpcUrl('BASE_RPC_URL', 'https://mainnet.base.org'),
    blockExplorer: 'https://basescan.org',
    usdc: getUsdcAddress('BASE_USDC_ADDRESS', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'base'),
    facilitator: ZERO_ADDRESS,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  sepolia: {
    chainId: 11155111,
    name: 'Sepolia',
    network: 'sepolia',
    rpcUrl: getRpcUrl('SEPOLIA_RPC_URL', 'https://ethereum-sepolia-rpc.publicnode.com'),
    blockExplorer: 'https://sepolia.etherscan.io',
    usdc: getUsdcAddress('SEPOLIA_USDC_ADDRESS', '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 'sepolia'),
    facilitator: ZERO_ADDRESS,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  ethereum: {
    chainId: 1,
    name: 'Ethereum',
    network: 'ethereum',
    rpcUrl: getRpcUrl('ETHEREUM_RPC_URL', 'https://eth.llamarpc.com'),
    blockExplorer: 'https://etherscan.io',
    usdc: getUsdcAddress('ETHEREUM_USDC_ADDRESS', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'ethereum'),
    facilitator: ZERO_ADDRESS,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
};

export const CHAIN_ID_TO_NETWORK: Record<number, string> = Object.fromEntries(
  Object.entries(CHAIN_CONFIGS).map(([network, config]) => [config.chainId, network])
);

export function getChainConfig(network: string): ChainConfig | undefined {
  return CHAIN_CONFIGS[network];
}

export function getTokenConfig(network: string, tokenAddress: Address): TokenConfig {
  const chain = CHAIN_CONFIGS[network];
  if (!chain) return { address: tokenAddress, symbol: 'UNKNOWN', decimals: 18, name: 'Unknown Token' };

  if (tokenAddress.toLowerCase() === chain.usdc.toLowerCase()) {
    return { address: tokenAddress, symbol: 'USDC', decimals: 6, name: 'USD Coin' };
  }

  if (tokenAddress === ZERO_ADDRESS) {
    return {
      address: tokenAddress,
      symbol: chain.nativeCurrency.symbol,
      decimals: chain.nativeCurrency.decimals,
      name: chain.nativeCurrency.name,
    };
  }

  return { address: tokenAddress, symbol: 'TOKEN', decimals: 18, name: 'ERC20 Token' };
}

export function getPrimaryNetwork(): string {
  return process.env.X402_PRIMARY_NETWORK || 'jeju';
}

export function getPrimaryChainConfig(): ChainConfig {
  const network = getPrimaryNetwork();
  const config = CHAIN_CONFIGS[network];
  if (!config) throw new Error(`Invalid primary network: ${network}`);
  return config;
}
