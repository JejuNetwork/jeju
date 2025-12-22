/**
 * @fileoverview Network Configuration
 * @module config/network
 * 
 * Network-specific utilities for checking availability and loading deployments.
 * Chain config loading is handled by the main index.ts module.
 * 
 * Key principles:
 * - JSON files store network configs (chain/*.json)
 * - Contract addresses stored per-network in deployments/
 * - Only actual secrets (private keys, API keys) need .env
 * - Everything works out of the box for local development
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ChainConfigSchema, NetworkSchema, type NetworkType, type ChainConfig } from './schemas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = join(__dirname, '..', '..');
const CONFIG_DIR = __dirname;
const DEPLOYMENTS_DIR = join(ROOT, 'packages', 'contracts', 'deployments');

// ============================================================================
// Types
// ============================================================================

export interface DeployedContracts {
  // Tokens
  elizaOS?: string;
  usdc?: string;
  weth?: string;
  
  // Core Infrastructure
  entryPoint?: string;
  creditManager?: string;
  serviceRegistry?: string;
  priceOracle?: string;
  
  // Paymaster System
  tokenRegistry?: string;
  paymasterFactory?: string;
  liquidityPaymaster?: string;
  multiTokenPaymaster?: string;
  
  // Registry System (ERC-8004)
  identityRegistry?: string;
  reputationRegistry?: string;
  validationRegistry?: string;
  
  // DeFi
  liquidityVault?: string;
  feeDistributor?: string;
  
  // Uniswap V4
  poolManager?: string;
  swapRouter?: string;
  positionManager?: string;
  quoterV4?: string;
  stateView?: string;
  
  // Node Staking
  nodeStakingManager?: string;
  nodePerformanceOracle?: string;
  
  // Moderation
  banManager?: string;
  reputationLabelManager?: string;
  reportingSystem?: string;
  
  // Compute Marketplace
  computeRegistry?: string;
  computeRental?: string;
  ledgerManager?: string;
  inferenceServing?: string;
  computeStaking?: string;
  
  // Governance
  registryGovernance?: string;
  futarchyGovernor?: string;
  
  // OIF (Open Intents Framework)
  solverRegistry?: string;
  inputSettler?: string;
  outputSettler?: string;
  oifOracle?: string;
  
  // Games
  bazaarMarketplace?: string;
  goldToken?: string;
  itemsNFT?: string;
  predimarket?: string;
  
  [key: string]: string | undefined;
}

export interface NetworkInfo {
  network: NetworkType;
  chain: ChainConfig;
  contracts: DeployedContracts;
  isAvailable: boolean;
  rpcReachable: boolean;
  hasBalance: boolean;
}

// ============================================================================
// Defaults
// ============================================================================

/** Default test accounts (Anvil/Foundry) - use for local development only */
export const TEST_ACCOUNTS = {
  DEPLOYER: {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  },
  USER_1: {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
  USER_2: {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  },
} as const;

/** L2 Predeploy addresses (same on all OP-Stack chains) */
export const L2_PREDEPLOYS = {
  L2CrossDomainMessenger: '0x4200000000000000000000000000000000000007',
  L2StandardBridge: '0x4200000000000000000000000000000000000010',
  L2ToL1MessagePasser: '0x4200000000000000000000000000000000000016',
  L2ERC721Bridge: '0x4200000000000000000000000000000000000014',
  GasPriceOracle: '0x420000000000000000000000000000000000000F',
  L1Block: '0x4200000000000000000000000000000000000015',
  WETH: '0x4200000000000000000000000000000000000006',
} as const;

/** Standard ERC-4337 EntryPoint */
export const ENTRYPOINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Load chain configuration from JSON file
 * Note: This is the canonical implementation - also exported from index.ts
 */
export function loadChainConfig(network: NetworkType): ChainConfig {
  const configPath = join(CONFIG_DIR, 'chain', `${network}.json`);
  
  if (!existsSync(configPath)) {
    throw new Error(`Chain config not found: ${configPath}`);
  }
  
  return ChainConfigSchema.parse(JSON.parse(readFileSync(configPath, 'utf-8')));
}

/**
 * Get chain config for current or specified network
 */
export function getChainConfig(network?: NetworkType): ChainConfig {
  return loadChainConfig(network ?? getCurrentNetwork());
}

/**
 * Load deployed contract addresses for a network
 */
export function loadDeployedContracts(network: NetworkType): DeployedContracts {
  const contracts: DeployedContracts = {
    weth: L2_PREDEPLOYS.WETH,
  };
  
  // Try to load from various deployment files
  const deploymentFiles = [
    join(DEPLOYMENTS_DIR, `${network}`, 'deployment.json'),
    join(DEPLOYMENTS_DIR, `${network}-complete.json`),
    join(DEPLOYMENTS_DIR, `${network}-addresses.json`),
    join(DEPLOYMENTS_DIR, network, 'liquidity-system.json'),
    join(DEPLOYMENTS_DIR, network, 'multi-token-system.json'),
    join(DEPLOYMENTS_DIR, `uniswap-v4-${network === 'mainnet' ? '420691' : network === 'testnet' ? '420690' : '1337'}.json`),
    join(DEPLOYMENTS_DIR, `bazaar-marketplace-${network === 'mainnet' ? '420691' : network === 'testnet' ? '420690' : '1337'}.json`),
    join(DEPLOYMENTS_DIR, `predimarket-${network === 'mainnet' ? '420691' : network === 'testnet' ? '420690' : '1337'}.json`),
    join(DEPLOYMENTS_DIR, `identity-system-${network === 'mainnet' ? '420691' : network === 'testnet' ? '420690' : '1337'}.json`),
  ];
  
  for (const file of deploymentFiles) {
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf-8')) as DeploymentFileData;
      Object.assign(contracts, flattenContracts(data));
    }
  }
  
  return contracts;
}

interface DeploymentFileData {
  [key: string]: string | { contracts: DeploymentFileData } | DeploymentFileData;
}

/**
 * Flatten nested contract structures
 */
function flattenContracts(data: DeploymentFileData): DeployedContracts {
  const result: DeployedContracts = {};
  
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && value.startsWith('0x')) {
      result[key] = value;
    } else if (typeof value === 'object' && value !== null && 'contracts' in value) {
      const nested = value as { contracts: DeploymentFileData };
      Object.assign(result, flattenContracts(nested.contracts));
    }
  }
  
  return result;
}

// ============================================================================
// Network Detection & Status
// ============================================================================

/**
 * Get the current network based on environment or default
 * Validates JEJU_NETWORK env var and throws on invalid values
 */
export function getCurrentNetwork(): NetworkType {
  const envNetwork = process.env.JEJU_NETWORK;
  
  // No env var set - default to localnet for development
  if (!envNetwork) return 'localnet';
  
  // Validate with Zod schema
  const result = NetworkSchema.safeParse(envNetwork);
  if (!result.success) {
    throw new Error(`Invalid JEJU_NETWORK: ${envNetwork}. Must be one of: localnet, testnet, mainnet`);
  }
  
  return result.data;
}

/**
 * Check if an RPC endpoint is reachable
 */
export async function checkRpcReachable(rpcUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) return false;
    
    const data = await response.json() as { result?: string };
    return data.result !== undefined;
  } catch {
    return false;
  }
}

/**
 * Check if an address has balance on a network
 */
export async function checkHasBalance(rpcUrl: string, address: string): Promise<boolean> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
        id: 1,
      }),
    });
    
    if (!response.ok) return false;
    
    const data = await response.json() as { result?: string };
    if (!data.result) return false;
    
    const balance = BigInt(data.result);
    return balance > BigInt(0);
  } catch {
    return false;
  }
}

/**
 * Get complete network info with availability status
 */
export async function getNetworkInfo(network: NetworkType): Promise<NetworkInfo> {
  const chain = loadChainConfig(network);
  const contracts = loadDeployedContracts(network);
  
  // Check RPC availability
  const rpcUrl = process.env[`JEJU_${network.toUpperCase()}_RPC_URL`] || chain.rpcUrl;
  const rpcReachable = await checkRpcReachable(rpcUrl);
  
  // Check if we have a funded account
  let hasBalance = false;
  if (rpcReachable) {
    const deployerAddress = process.env.DEPLOYER_ADDRESS || TEST_ACCOUNTS.DEPLOYER.address;
    hasBalance = await checkHasBalance(rpcUrl, deployerAddress);
  }
  
  return {
    network,
    chain,
    contracts,
    isAvailable: rpcReachable && hasBalance,
    rpcReachable,
    hasBalance,
  };
}

// ============================================================================
// Convenience Getters
// ============================================================================

/**
 * Get RPC URL for a network (with env override support)
 */
export function getRpcUrl(network?: NetworkType): string {
  const net = network || getCurrentNetwork();
  
  // Environment variable overrides
  const envUrl = process.env.JEJU_RPC_URL || process.env[`JEJU_${net.toUpperCase()}_RPC_URL`];
  if (envUrl) return envUrl;
  
  const chain = loadChainConfig(net);
  return chain.rpcUrl;
}

/**
 * Get chain ID for a network
 */
export function getChainId(network?: NetworkType): number {
  const net = network || getCurrentNetwork();
  const chain = loadChainConfig(net);
  return chain.chainId;
}

/**
 * Get a specific contract address
 */
export function getContractAddress(
  contractName: keyof DeployedContracts,
  network?: NetworkType
): string {
  const net = network || getCurrentNetwork();
  
  // Check environment variable first
  const envKey = `${String(contractName).replace(/([A-Z])/g, '_$1').toUpperCase()}_ADDRESS`;
  const envAddress = process.env[envKey];
  if (envAddress) return envAddress;
  
  // Load from deployment files
  const contracts = loadDeployedContracts(net);
  const address = contracts[contractName];
  
  if (!address) {
    throw new Error(
      `Contract ${contractName} not deployed on ${net}. ` +
      `Run deployment first or set ${envKey} environment variable.`
    );
  }
  
  return address;
}

/**
 * Get deployer configuration
 * For localnet, uses test accounts. For other networks, requires explicit env vars.
 */
export function getDeployerConfig(): { address: string; privateKey: string } {
  const network = getCurrentNetwork();
  
  // For localnet, allow test accounts as fallback
  if (network === 'localnet') {
    return {
      address: process.env.DEPLOYER_ADDRESS ?? TEST_ACCOUNTS.DEPLOYER.address,
      privateKey: process.env.DEPLOYER_PRIVATE_KEY ?? TEST_ACCOUNTS.DEPLOYER.privateKey,
    };
  }
  
  // For testnet/mainnet, require explicit configuration
  const address = process.env.DEPLOYER_ADDRESS;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  
  if (!address) {
    throw new Error(`DEPLOYER_ADDRESS required for ${network}. Test accounts only allowed on localnet.`);
  }
  if (!privateKey) {
    throw new Error(`DEPLOYER_PRIVATE_KEY required for ${network}. Test accounts only allowed on localnet.`);
  }
  
  return { address, privateKey };
}

// ============================================================================
// Exports
// ============================================================================

// Types are exported from ./schemas via index.ts 'export * from ./schemas'
