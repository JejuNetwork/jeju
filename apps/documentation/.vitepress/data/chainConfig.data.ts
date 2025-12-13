/**
 * @fileoverview VitePress data loader for Jeju chain configurations
 * @module documentation/.vitepress/data/chainConfig.data
 * 
 * Provides build-time loading of chain configurations for documentation components.
 * VitePress data loaders run at build time and make configuration data available
 * to Vue components without needing to re-read files at runtime.
 * 
 * @see {@link https://vitepress.dev/guide/data-loading VitePress Data Loading}
 * 
 * @example Usage in Vue component
 * ```vue
 * <script setup lang="ts">
 * import { data as chainConfigs } from '../../data/chainConfig.data';
 * 
 * const mainnetConfig = chainConfigs.mainnet;
 * console.log(mainnetConfig.chainId); // 420691
 * </script>
 * ```
 */

import mainnet from '@jejunetwork/config/chain/mainnet.json' with { type: 'json' };
import testnet from '@jejunetwork/config/chain/testnet.json' with { type: 'json' };

/**
 * Chain configuration interface matching the JSON structure
 * 
 * @interface ChainConfig
 * @property {number} chainId - Chain ID of the Jeju network
 * @property {number} networkId - Network ID (usually same as chainId)
 * @property {string} name - Human-readable network name
 * @property {string} rpcUrl - HTTP RPC endpoint URL
 * @property {string} wsUrl - WebSocket RPC endpoint URL
 * @property {string} explorerUrl - Block explorer URL
 * @property {number} l1ChainId - Settlement layer (Base) chain ID
 * @property {string} l1RpcUrl - Base RPC endpoint URL
 * @property {string} l1Name - Settlement layer network name
 * @property {boolean} flashblocksEnabled - Whether Flashblocks are enabled
 * @property {number} flashblocksSubBlockTime - Sub-block time in milliseconds (200ms)
 * @property {number} blockTime - Full block time in milliseconds (2000ms)
 */
export interface ChainConfig {
  chainId: number;
  networkId: number;
  name: string;
  rpcUrl: string;
  wsUrl: string;
  explorerUrl: string;
  l1ChainId: number;
  l1RpcUrl: string;
  l1Name: string;
  flashblocksEnabled: boolean;
  flashblocksSubBlockTime: number;
  blockTime: number;
  gasToken: {
    name: string;
    symbol: string;
    decimals: number;
  };
  contracts: {
    /** L2 contracts deployed on Jeju (predeploys at fixed addresses) */
    l2: Record<string, string>;
    /** L1 contracts deployed on Base (deployment-specific addresses) */
    l1: Record<string, string>;
  };
}

/**
 * Container for both mainnet and testnet configurations
 * 
 * @interface ChainConfigs
 * @property {ChainConfig} mainnet - Jeju Mainnet configuration
 * @property {ChainConfig} testnet - Jeju Testnet configuration
 */
export interface ChainConfigs {
  mainnet: ChainConfig;
  testnet: ChainConfig;
}

/**
 * VitePress data loader export
 * 
 * This object is exported as default and VitePress calls the `load()` function
 * at build time to load configuration data. The result is made available to
 * Vue components as a reactive data source.
 * 
 * @see {@link ContractAddresses.vue} - Uses this data to display contract addresses
 * @see {@link NetworkInfo.vue} - Uses this data to display network information
 */
export default {
  /**
   * Loads chain configurations from JSON files at build time
   * 
   * @returns {ChainConfigs} Object containing mainnet and testnet configurations
   */
  load(): ChainConfigs {
    return {
      mainnet: mainnet as ChainConfig,
      testnet: testnet as ChainConfig,
    };
  },
};
