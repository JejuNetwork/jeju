/**
 * @fileoverview Autocrat Configuration
 *
 * Configuration management for the MEV bot system.
 * Loads from environment variables and provides defaults.
 */

import type { AutocratConfig, ChainConfig, StrategyConfig, ChainId } from './types';

// ============ Default Chain Configurations ============

const CHAIN_CONFIGS: Record<number, Omit<ChainConfig, 'rpcUrl' | 'wsUrl'>> = {
  // Ethereum Mainnet
  1: {
    chainId: 1 as ChainId,
    name: 'Ethereum',
    blockTime: 12000,
    isL2: false,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://etherscan.io',
  },
  // Arbitrum One
  42161: {
    chainId: 42161 as ChainId,
    name: 'Arbitrum One',
    blockTime: 250,
    isL2: true,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://arbiscan.io',
  },
  // Optimism
  10: {
    chainId: 10 as ChainId,
    name: 'Optimism',
    blockTime: 2000,
    isL2: true,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://optimistic.etherscan.io',
  },
  // Base
  8453: {
    chainId: 8453 as ChainId,
    name: 'Base',
    blockTime: 2000,
    isL2: true,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://basescan.org',
  },
  // BSC
  56: {
    chainId: 56 as ChainId,
    name: 'BNB Smart Chain',
    blockTime: 3000,
    isL2: false,
    nativeSymbol: 'BNB',
    explorerUrl: 'https://bscscan.com',
  },
  // Jeju Mainnet
  420691: {
    chainId: 420691 as ChainId,
    name: 'Jeju',
    blockTime: 200, // Flashblocks
    isL2: true,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://explorer.jeju.network',
  },
  // Jeju Testnet
  420690: {
    chainId: 420690 as ChainId,
    name: 'Jeju Testnet',
    blockTime: 200,
    isL2: true,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://testnet-explorer.jeju.network',
  },
  // Localnet
  1337: {
    chainId: 1337 as ChainId,
    name: 'Localnet',
    blockTime: 1000,
    isL2: false,
    nativeSymbol: 'ETH',
  },
  // Sepolia
  11155111: {
    chainId: 11155111 as ChainId,
    name: 'Sepolia',
    blockTime: 12000,
    isL2: false,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia.etherscan.io',
  },
  // Base Sepolia
  84532: {
    chainId: 84532 as ChainId,
    name: 'Base Sepolia',
    blockTime: 2000,
    isL2: true,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia.basescan.org',
  },
};

// ============ Default Strategy Configurations ============

const DEFAULT_STRATEGIES: StrategyConfig[] = [
  {
    type: 'DEX_ARBITRAGE',
    enabled: true,
    minProfitBps: 10, // 0.1%
    maxGasGwei: 100,
    maxSlippageBps: 50, // 0.5%
    cooldownMs: 100,
  },
  {
    type: 'CROSS_CHAIN_ARBITRAGE',
    enabled: true,
    minProfitBps: 50, // 0.5% (higher due to bridge costs)
    maxGasGwei: 100,
    maxSlippageBps: 100, // 1%
    cooldownMs: 5000,
  },
  {
    type: 'SANDWICH',
    enabled: true,
    minProfitBps: 5, // 0.05%
    maxGasGwei: 150,
    maxSlippageBps: 30,
    cooldownMs: 0, // No cooldown for sandwiches
  },
  {
    type: 'LIQUIDATION',
    enabled: true,
    minProfitBps: 100, // 1%
    maxGasGwei: 200,
    maxSlippageBps: 100,
    cooldownMs: 1000,
  },
  {
    type: 'SOLVER',
    enabled: true,
    minProfitBps: 5,
    maxGasGwei: 100,
    maxSlippageBps: 50,
    cooldownMs: 0,
  },
  {
    type: 'ORACLE_KEEPER',
    enabled: true,
    minProfitBps: 0, // Often break-even for protocol health
    maxGasGwei: 50,
    maxSlippageBps: 0,
    cooldownMs: 60000, // 1 minute
  },
];

// ============ Environment Variable Helpers ============

function getEnvString(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (isNaN(parsed)) throw new Error(`Invalid number for ${key}: ${value}`);
  return parsed;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

// ============ Configuration Builder ============

/**
 * Build chain configuration from environment
 */
function buildChainConfig(chainId: number): ChainConfig {
  const baseConfig = CHAIN_CONFIGS[chainId];
  if (!baseConfig) {
    throw new Error(`Unknown chain ID: ${chainId}`);
  }

  // Map chain ID to RPC env var name
  const rpcEnvKeys: Record<number, string> = {
    1: 'ETHEREUM_RPC_URL',
    42161: 'ARBITRUM_RPC_URL',
    10: 'OPTIMISM_RPC_URL',
    8453: 'BASE_RPC_URL',
    56: 'BSC_RPC_URL',
    420691: 'JEJU_RPC_URL',
    420690: 'JEJU_TESTNET_RPC_URL',
    1337: 'LOCALNET_RPC_URL',
    11155111: 'SEPOLIA_RPC_URL',
    84532: 'BASE_SEPOLIA_RPC_URL',
  };

  const rpcEnvKey = rpcEnvKeys[chainId] || `CHAIN_${chainId}_RPC_URL`;
  const wsEnvKey = rpcEnvKey.replace('RPC', 'WS');

  return {
    ...baseConfig,
    rpcUrl: getEnvString(rpcEnvKey, chainId === 1337 ? 'http://localhost:8545' : ''),
    wsUrl: process.env[wsEnvKey],
  };
}

/**
 * Get enabled chain IDs from environment
 */
function getEnabledChains(): number[] {
  const enabledStr = process.env.AUTOCRAT_ENABLED_CHAINS;
  if (enabledStr) {
    return enabledStr.split(',').map(s => parseInt(s.trim(), 10));
  }

  // Default: localnet + Jeju + testnets
  const isTestnet = process.env.NETWORK === 'testnet' || process.env.NODE_ENV === 'test';
  const isLocalnet = process.env.NETWORK === 'localnet' || process.env.NODE_ENV === 'development';

  if (isLocalnet) {
    return [1337];
  }

  if (isTestnet) {
    return [11155111, 84532, 420690]; // Sepolia, Base Sepolia, Jeju Testnet
  }

  // Production: all chains
  return [1, 42161, 10, 8453, 56, 420691];
}

/**
 * Build full autocrat configuration
 */
export function buildConfig(): AutocratConfig {
  const enabledChains = getEnabledChains();

  return {
    chains: enabledChains
      .map(chainId => {
        try {
          return buildChainConfig(chainId);
        } catch {
          console.warn(`Skipping chain ${chainId}: RPC not configured`);
          return null;
        }
      })
      .filter((c): c is ChainConfig => c !== null),

    primaryChainId: getEnvNumber('AUTOCRAT_PRIMARY_CHAIN', enabledChains[0] || 1337) as ChainId,

    privateKey: getEnvString('AUTOCRAT_PRIVATE_KEY'),
    treasuryAddress: getEnvString('AUTOCRAT_TREASURY', '0x0000000000000000000000000000000000000000'),

    strategies: DEFAULT_STRATEGIES.map(strategy => ({
      ...strategy,
      enabled: getEnvBoolean(`AUTOCRAT_STRATEGY_${strategy.type}_ENABLED`, strategy.enabled),
      minProfitBps: getEnvNumber(`AUTOCRAT_STRATEGY_${strategy.type}_MIN_PROFIT_BPS`, strategy.minProfitBps),
    })),

    minProfitUsd: getEnvNumber('AUTOCRAT_MIN_PROFIT_USD', 1),
    maxConcurrentExecutions: getEnvNumber('AUTOCRAT_MAX_CONCURRENT', 5),
    simulationTimeout: getEnvNumber('AUTOCRAT_SIMULATION_TIMEOUT', 5000),

    maxGasGwei: getEnvNumber('AUTOCRAT_MAX_GAS_GWEI', 100),
    gasPriceMultiplier: getEnvNumber('AUTOCRAT_GAS_MULTIPLIER', 1.1),

    metricsPort: getEnvNumber('AUTOCRAT_METRICS_PORT', 4051),
    logLevel: (process.env.AUTOCRAT_LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
  };
}

// ============ Contract Addresses ============

export interface ContractAddresses {
  treasury: string;
  blockBuilderMarketplace: string;
  xlpV2Factory: string;
  xlpV3Factory: string;
  xlpRouter: string;
  perpetualMarket: string;
  priceOracle: string;
  inputSettler: string;
  outputSettler: string;
  solverRegistry: string;
  identityRegistry: string;
  reputationRegistry: string;
}

/**
 * Get contract addresses for a chain
 * Addresses are loaded from environment variables or fallback to known deployments
 */
export function getContractAddresses(chainId: ChainId): Partial<ContractAddresses> {
  const addresses: Record<number, Partial<ContractAddresses>> = {
    1337: {
      // Localnet - deployed by bootstrap script, loaded from env
      treasury: process.env.AUTOCRAT_TREASURY_1337 || '',
      blockBuilderMarketplace: process.env.AUTOCRAT_BUILDER_MARKETPLACE_1337 || '',
      xlpV2Factory: process.env.XLP_V2_FACTORY_1337 || '',
      xlpV3Factory: process.env.XLP_V3_FACTORY_1337 || '',
      xlpRouter: process.env.XLP_ROUTER_1337 || '',
      perpetualMarket: process.env.PERPETUAL_MARKET_1337 || '',
      priceOracle: process.env.PRICE_ORACLE_1337 || '',
      inputSettler: process.env.OIF_INPUT_SETTLER_1337 || '',
      outputSettler: process.env.OIF_OUTPUT_SETTLER_1337 || '',
      solverRegistry: process.env.OIF_SOLVER_REGISTRY_1337 || '',
      identityRegistry: process.env.IDENTITY_REGISTRY_1337 || '',
      reputationRegistry: process.env.REPUTATION_REGISTRY_1337 || '',
    },
    420690: {
      // Jeju Testnet - from addresses.json
      identityRegistry: '0x759D602d8D2E4F1ccCa12E955420cC19e64a68bd',
      xlpRouter: process.env.XLP_ROUTER_420690 || '',
      perpetualMarket: process.env.PERPETUAL_MARKET_420690 || '',
    },
    84532: {
      // Base Sepolia - known deployments
      identityRegistry: '0x759D602d8D2E4F1ccCa12E955420cC19e64a68bd',
      inputSettler: '0x9bb59d0329FcCEdD99f1753D20AF50347Ad2eB75',
      outputSettler: '0xf7ef3C6a54dA3E03A96D23864e5865E7e3EBEcF5',
      solverRegistry: '0xecfE47302D941c8ce5B0009C0ac2E6D6ee2A42de',
    },
  };

  return addresses[chainId] || {};
}

// ============ Singleton Config ============

let _config: AutocratConfig | null = null;

export function getConfig(): AutocratConfig {
  if (!_config) {
    _config = buildConfig();
  }
  return _config;
}

export function resetConfig(): void {
  _config = null;
}
