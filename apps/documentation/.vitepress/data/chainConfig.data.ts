/**
 * VitePress data loader for chain configurations
 * Provides build-time loading of chain configs for documentation components
 */

import mainnet from '@jejunetwork/config/chain/mainnet.json' with { type: 'json' };
import testnet from '@jejunetwork/config/chain/testnet.json' with { type: 'json' };

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
    l2: Record<string, string>;
    l1: Record<string, string>;
  };
}

export interface ChainConfigs {
  mainnet: ChainConfig;
  testnet: ChainConfig;
}

export default {
  load(): ChainConfigs {
    return {
      mainnet: mainnet as ChainConfig,
      testnet: testnet as ChainConfig,
    };
  },
};
