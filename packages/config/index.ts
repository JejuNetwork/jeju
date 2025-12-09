/**
 * @fileoverview Jeju Network Configuration
 * @module config
 * 
 * Unified configuration for the Jeju network.
 * 
 * Key Features:
 * - JSON-based network configs (no .env needed for most settings)
 * - Auto-loads contract deployments from deployment files
 * - Sensible defaults for local development
 * - Graceful fallbacks for unavailable networks
 * 
 * @example Quick Start
 * ```ts
 * import { getRpcUrl, getChainId, getContractAddress } from '@jejunetwork/config';
 * 
 * // Works immediately for localnet (no config needed)
 * const rpc = getRpcUrl(); // http://127.0.0.1:9545
 * const chainId = getChainId(); // 1337
 * 
 * // Get deployed contract addresses (auto-loaded from deployments/)
 * const registry = getContractAddress('identityRegistry');
 * ```
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ChainConfigSchema, type ChainConfig, type NetworkType } from '../types/src/chain';

// Re-export unified network config
export * from './network';
export * from './ports';

// Re-export types
export type { ChainConfig, NetworkType } from '../types/src/chain';

/** Base directory for all configuration files */
const CONFIG_DIR = __dirname;

/**
 * Loads and validates chain configuration for a specific network
 */
export function loadChainConfig(network: NetworkType): ChainConfig {
  const configPath = resolve(CONFIG_DIR, `chain/${network}.json`);
  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  return ChainConfigSchema.parse(raw);
}

/**
 * Gets chain configuration with environment variable override support
 */
export function getChainConfig(network?: NetworkType): ChainConfig {
  const env = process.env.JEJU_NETWORK as NetworkType || network || 'localnet';
  return loadChainConfig(env);
}

/**
 * Gets a specific L1/L2 bridge contract address from network configuration
 */
export function getBridgeContractAddress(
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
      `Make sure to deploy and update packages/config/chain/${network}.json`
    );
  }
  
  return address;
}

/**
 * Gets Jeju WebSocket URL with environment variable override
 */
export function getWsUrl(network?: NetworkType): string {
  const config = getChainConfig(network);
  return process.env.JEJU_WS_URL || config.wsUrl;
}

/**
 * Gets block explorer URL with environment variable override
 */
export function getExplorerUrl(network?: NetworkType): string {
  const config = getChainConfig(network);
  return process.env.JEJU_EXPLORER_URL || config.explorerUrl;
}

/**
 * Gets Ethereum (L1) RPC URL with environment variable override
 */
export function getL1RpcUrl(network?: NetworkType): string {
  const config = getChainConfig(network);
  return process.env.JEJU_L1_RPC_URL || config.l1RpcUrl;
}


