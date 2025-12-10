/**
 * Indexer Initialization
 * 
 * Loads network configuration and registers known contracts at startup.
 */

import { loadNetworkConfig, getContractAddressSet } from './network-config';
import { registerContract, ContractInfo } from './contract-events';

// Contract type mappings
const CONTRACT_TYPES: Record<string, ContractInfo['type']> = {
  // Infrastructure
  entryPoint: 'paymaster',
  priceOracle: 'oracle',
  serviceRegistry: 'cloud',
  creditManager: 'cloud',

  // Paymaster
  tokenRegistry: 'paymaster',
  paymasterFactory: 'paymaster',
  liquidityPaymaster: 'paymaster',
  multiTokenPaymaster: 'paymaster',

  // Registry
  identityRegistry: 'registry',
  reputationRegistry: 'registry',
  validationRegistry: 'registry',
  registryGovernance: 'registry',

  // DeFi
  liquidityVault: 'defi',
  feeDistributor: 'defi',
  poolManager: 'defi',
  swapRouter: 'defi',

  // Node Staking
  nodeStakingManager: 'node',
  nodePerformanceOracle: 'oracle',
  autoSlasher: 'node',
  multiOracleConsensus: 'oracle',

  // Moderation
  banManager: 'moderation',
  reputationLabelManager: 'moderation',
  reportingSystem: 'moderation',

  // Compute
  computeRegistry: 'cloud',
  computeRental: 'cloud',
  ledgerManager: 'cloud',
  inferenceServing: 'cloud',
  computeStaking: 'cloud',

  // Storage
  storageRegistry: 'cloud',
  storageMarket: 'cloud',
  storageLedger: 'cloud',

  // OIF
  solverRegistry: 'defi',
  inputSettler: 'defi',
  outputSettler: 'defi',
  oifOracle: 'oracle',

  // EIL
  l1StakeManager: 'defi',
  crossChainPaymaster: 'paymaster',

  // Games
  bazaarMarketplace: 'marketplace',
  goldToken: 'token',
  itemsNFT: 'game',
  predimarket: 'prediction',
  predictionOracle: 'oracle',
  playerTradeEscrow: 'marketplace',
  contest: 'game',

  // Tokens
  weth: 'token',
  usdc: 'token',
  elizaOS: 'token',
  jeju: 'token',

  // OTC
  otc: 'defi',
};

let initialized = false;

/**
 * Initialize the indexer with network configuration
 * Registers all known contract addresses for identification
 */
export function initializeIndexer(): void {
  if (initialized) return;

  const config = loadNetworkConfig();
  console.log(`Initializing indexer for network: ${config.network} (chainId: ${config.chainId})`);
  console.log(`RPC endpoint: ${config.rpcUrl}`);

  // Register all known contracts
  let registeredCount = 0;
  for (const [name, address] of Object.entries(config.contracts)) {
    if (address && typeof address === 'string') {
      const contractType = CONTRACT_TYPES[name] || 'token';
      registerContract({
        address,
        name,
        type: contractType,
        events: [], // Events are determined by event signatures
      });
      registeredCount++;
    }
  }

  console.log(`Registered ${registeredCount} known contracts`);

  // Log contract address set for debugging
  const addressSet = getContractAddressSet(config);
  if (addressSet.size > 0) {
    console.log(`Known contract addresses: ${Array.from(addressSet).slice(0, 5).join(', ')}${addressSet.size > 5 ? '...' : ''}`);
  }

  initialized = true;
}

/**
 * Get initialization status
 */
export function isInitialized(): boolean {
  return initialized;
}

// Auto-initialize on import
initializeIndexer();

