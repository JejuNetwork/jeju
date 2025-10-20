/**
 * @fileoverview Chain configuration loader and utilities for Jeju network
 * @module config
 * 
 * Provides type-safe access to network configurations across localnet, testnet, and mainnet.
 * Configurations include RPC endpoints, contract addresses, chain parameters, and more.
 * 
 * @example Loading configuration
 * ```ts
 * import { getChainConfig, getRpcUrl } from './config';
 * 
 * // Load mainnet config
 * const mainnet = getChainConfig('mainnet');
 * console.log(mainnet.chainId); // 420691
 * 
 * // Get RPC URL (supports env var override)
 * const rpcUrl = getRpcUrl('testnet');
 * ```
 * 
 * @example Contract address lookup
 * ```ts
 * import { getContractAddress } from './config';
 * 
 * // Get L2 bridge address on mainnet
 * const bridge = getContractAddress('mainnet', 'l2', 'L2StandardBridge');
 * 
 * // Get L1 portal address on testnet
 * const portal = getContractAddress('testnet', 'l1', 'OptimismPortal');
 * ```
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ChainConfigSchema, type ChainConfig, type NetworkType, type BaseNetworks } from '../types/chain';

/** Base directory for all configuration files */
const CONFIG_DIR = __dirname;

/**
 * Loads and validates chain configuration for a specific network
 * 
 * @param network - Target network: 'localnet', 'testnet', or 'mainnet'
 * @returns Validated chain configuration object
 * @throws {Error} If config file not found or validation fails
 * 
 * @example
 * ```ts
 * const testnetConfig = loadChainConfig('testnet');
 * console.log(testnetConfig.chainId); // 420690
 * console.log(testnetConfig.rpcUrl); // https://testnet-rpc.jeju.network
 * ```
 */
export function loadChainConfig(network: NetworkType): ChainConfig {
  const configPath = resolve(CONFIG_DIR, `chain/${network}.json`);
  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  return ChainConfigSchema.parse(raw);
}

/**
 * Loads Base network configurations (Sepolia and Mainnet)
 * 
 * @returns Object containing Base Sepolia and Base Mainnet configurations
 * @throws {Error} If base-networks.json not found
 * 
 * @example
 * ```ts
 * const baseNetworks = loadBaseNetworks();
 * console.log(baseNetworks['base-mainnet'].chainId); // 8453
 * console.log(baseNetworks['base-sepolia'].chainId); // 84532
 * ```
 */
export function loadBaseNetworks(): BaseNetworks {
  const configPath = resolve(CONFIG_DIR, 'base-networks.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  return config;
}

/**
 * Gets chain configuration with environment variable override support
 * 
 * Priority:
 * 1. JEJU_NETWORK environment variable
 * 2. Provided network parameter
 * 3. Default to 'mainnet'
 * 
 * @param network - Optional network override
 * @returns Chain configuration for the selected network
 * 
 * @example
 * ```ts
 * // Use environment variable
 * process.env.JEJU_NETWORK = 'testnet';
 * const config = getChainConfig(); // Returns testnet config
 * 
 * // Or provide explicitly
 * const mainnetConfig = getChainConfig('mainnet');
 * ```
 */
export function getChainConfig(network?: NetworkType): ChainConfig {
  const env = process.env.JEJU_NETWORK as NetworkType || network || 'mainnet';
  return loadChainConfig(env);
}

/**
 * Gets a specific contract address from network configuration
 * 
 * @param network - Target network
 * @param layer - 'l1' for contracts on Base, 'l2' for contracts on Jeju
 * @param contractName - Name of the contract (e.g., 'OptimismPortal', 'L2StandardBridge')
 * @returns Contract address as checksummed hex string
 * @throws {Error} If contract not found in configuration
 * 
 * @example
 * ```ts
 * // Get L2 predeploy addresses (same across all networks)
 * const bridge = getContractAddress('mainnet', 'l2', 'L2StandardBridge');
 * // Returns: 0x4200000000000000000000000000000000000010
 * 
 * // Get L1 deployment addresses (network-specific)
 * const portal = getContractAddress('testnet', 'l1', 'OptimismPortal');
 * // Returns: 0x... (deployed address on Base Sepolia)
 * ```
 */
export function getContractAddress(
  network: NetworkType,
  layer: 'l1' | 'l2',
  contractName: string
): string {
  const config = loadChainConfig(network);
  const contracts = layer === 'l1' ? config.contracts.l1 : config.contracts.l2;
  const address = contracts[contractName as keyof typeof contracts];
  
  if (!address) {
    throw new Error(
      `Contract ${contractName} not found on ${layer} for ${network}. ` +
      `Make sure to deploy and update config/chain/${network}.json`
    );
  }
  
  return address;
}

/**
 * Gets Jeju RPC URL with environment variable override
 * 
 * @param network - Optional network (defaults to mainnet or JEJU_NETWORK env var)
 * @returns HTTP RPC endpoint URL
 * 
 * @example
 * ```ts
 * // Use config file
 * const rpcUrl = getRpcUrl('testnet');
 * // Returns: https://testnet-rpc.jeju.network
 * 
 * // Override with environment variable
 * process.env.JEJU_RPC_URL = 'http://localhost:9545';
 * const localRpc = getRpcUrl();
 * // Returns: http://localhost:9545
 * ```
 */
export function getRpcUrl(network?: NetworkType): string {
  const config = getChainConfig(network);
  return process.env.JEJU_RPC_URL || config.rpcUrl;
}

/**
 * Gets Jeju WebSocket URL with environment variable override
 * 
 * @param network - Optional network (defaults to mainnet or JEJU_NETWORK env var)
 * @returns WebSocket endpoint URL
 * 
 * @example
 * ```ts
 * const wsUrl = getWsUrl('mainnet');
 * // Returns: wss://ws.jeju.network
 * ```
 */
export function getWsUrl(network?: NetworkType): string {
  const config = getChainConfig(network);
  return process.env.JEJU_WS_URL || config.wsUrl;
}

/**
 * Gets block explorer URL with environment variable override
 * 
 * @param network - Optional network (defaults to mainnet or JEJU_NETWORK env var)
 * @returns Block explorer URL
 * 
 * @example
 * ```ts
 * const explorerUrl = getExplorerUrl('testnet');
 * // Returns: https://testnet-explorer.jeju.network
 * ```
 */
export function getExplorerUrl(network?: NetworkType): string {
  const config = getChainConfig(network);
  return process.env.JEJU_EXPLORER_URL || config.explorerUrl;
}

/**
 * Gets Base (L1) RPC URL with environment variable override
 * 
 * @param network - Optional network (defaults to mainnet or JEJU_NETWORK env var)
 * @returns HTTP RPC endpoint URL for the settlement layer (Base)
 * 
 * @example
 * ```ts
 * const l1Rpc = getL1RpcUrl('mainnet');
 * // Returns: https://mainnet.base.org
 * 
 * const l1TestnetRpc = getL1RpcUrl('testnet');
 * // Returns: https://sepolia.base.org
 * ```
 */
export function getL1RpcUrl(network?: NetworkType): string {
  const config = getChainConfig(network);
  return process.env.JEJU_L1_RPC_URL || config.l1RpcUrl;
}

export type { ChainConfig, NetworkType, BaseNetworks } from '../types/chain';


