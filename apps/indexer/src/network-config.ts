/**
 * Network Configuration for Jeju Indexer
 * 
 * Loads deployed contract addresses from the contracts package based on network.
 * Supports localnet (1337), testnet (420690), and mainnet (420691).
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export type NetworkType = 'localnet' | 'testnet' | 'mainnet';

export interface NetworkConfig {
  network: NetworkType;
  chainId: number;
  rpcUrl: string;
  contracts: ContractAddresses;
}

export interface ContractAddresses {
  // Infrastructure
  entryPoint: string | null;
  priceOracle: string | null;
  serviceRegistry: string | null;
  creditManager: string | null;

  // Paymaster System
  tokenRegistry: string | null;
  paymasterFactory: string | null;
  liquidityPaymaster: string | null;
  multiTokenPaymaster: string | null;

  // Identity Registry (ERC-8004)
  identityRegistry: string | null;
  reputationRegistry: string | null;
  validationRegistry: string | null;
  registryGovernance: string | null;

  // DeFi
  liquidityVault: string | null;
  feeDistributor: string | null;
  poolManager: string | null;
  swapRouter: string | null;

  // Node Staking
  nodeStakingManager: string | null;
  nodePerformanceOracle: string | null;
  autoSlasher: string | null;
  multiOracleConsensus: string | null;

  // Moderation
  banManager: string | null;
  reputationLabelManager: string | null;
  reportingSystem: string | null;

  // Compute
  computeRegistry: string | null;
  computeRental: string | null;
  ledgerManager: string | null;
  inferenceServing: string | null;
  computeStaking: string | null;

  // OIF (Open Intents Framework)
  solverRegistry: string | null;
  inputSettler: string | null;
  outputSettler: string | null;
  oifOracle: string | null;

  // EIL (Ethereum Interop Layer)
  l1StakeManager: string | null;
  crossChainPaymaster: string | null;

  // Games
  bazaarMarketplace: string | null;
  goldToken: string | null;
  itemsNFT: string | null;
  predimarket: string | null;
  predictionOracle: string | null;
  playerTradeEscrow: string | null;
  contest: string | null;

  // Tokens
  weth: string | null;
  usdc: string | null;
  elizaOS: string | null;
  jeju: string | null;

  // OTC
  otc: string | null;
}

const CHAIN_IDS: Record<NetworkType, number> = {
  localnet: 1337,
  testnet: 420690,
  mainnet: 420691,
};

const DEFAULT_RPC: Record<NetworkType, string> = {
  localnet: 'http://localhost:9545',
  testnet: 'https://testnet-rpc.jeju.network',
  mainnet: 'https://rpc.jeju.network',
};

function loadJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) {
    return null;
  }
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content) as T;
}

function getDeploymentsPath(): string {
  // Try multiple paths to find the contracts package
  const possiblePaths = [
    join(process.cwd(), '..', '..', 'packages', 'contracts', 'deployments'),
    join(process.cwd(), 'packages', 'contracts', 'deployments'),
    join(__dirname, '..', '..', '..', '..', 'packages', 'contracts', 'deployments'),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  // Default fallback
  return join(process.cwd(), 'packages', 'contracts', 'deployments');
}

function loadDeploymentFile<T>(deploymentsPath: string, filename: string): T | null {
  return loadJsonFile<T>(join(deploymentsPath, filename));
}

function loadNetworkDeployment<T>(deploymentsPath: string, network: NetworkType, filename: string): T | null {
  return loadJsonFile<T>(join(deploymentsPath, network, filename));
}

export function getNetworkFromEnv(): NetworkType {
  const chainId = process.env.CHAIN_ID;
  const networkEnv = process.env.NETWORK;

  if (networkEnv) {
    if (networkEnv === 'localnet' || networkEnv === 'testnet' || networkEnv === 'mainnet') {
      return networkEnv;
    }
  }

  if (chainId) {
    const id = parseInt(chainId);
    if (id === 1337) return 'localnet';
    if (id === 420690) return 'testnet';
    if (id === 420691) return 'mainnet';
  }

  // Default to localnet
  return 'localnet';
}

interface NetworkDeployment {
  tokens?: { weth?: string; usdc?: string; elizaOS?: string; jeju?: string };
  infrastructure?: { entryPoint?: string; priceOracle?: string; serviceRegistry?: string; creditManager?: string };
  paymaster?: { tokenRegistry?: string; paymasterFactory?: string; liquidityPaymaster?: string; multiTokenPaymaster?: string };
  registry?: { identityRegistry?: string; reputationRegistry?: string; validationRegistry?: string; registryGovernance?: string };
  defi?: { liquidityVault?: string; feeDistributor?: string; poolManager?: string; swapRouter?: string };
  nodeStaking?: { nodeStakingManager?: string; nodePerformanceOracle?: string; autoSlasher?: string; multiOracleConsensus?: string };
  moderation?: { banManager?: string; reputationLabelManager?: string; reportingSystem?: string };
  compute?: { computeRegistry?: string; computeRental?: string; ledgerManager?: string; inferenceServing?: string; computeStaking?: string };
  oif?: { solverRegistry?: string; inputSettler?: string; outputSettler?: string; oracle?: string };
  games?: { bazaarMarketplace?: string; goldToken?: string; itemsNFT?: string; predimarket?: string };
}

interface IdentitySystemDeployment {
  identityRegistry?: string;
  reputationRegistry?: string;
  validationRegistry?: string;
  serviceRegistry?: string;
  creditManager?: string;
  cloudReputationProvider?: string;
  usdc?: string;
  elizaOS?: string;
  jeju?: string;
}

interface PaymasterSystemDeployment {
  tokenRegistry?: string;
  priceOracle?: string;
  paymasterFactory?: string;
  entryPoint?: string;
}

interface MultiTokenSystemDeployment {
  oracle?: string;
  entryPoint?: string;
  token?: string;
  vault?: string;
  distributor?: string;
  paymaster?: string;
  elizaOS?: string;
  CLANKER?: string;
  VIRTUAL?: string;
  CLANKERMON?: string;
}

interface PredimarketDeployment {
  elizaOSToken?: string;
  predictionOracle?: string;
  predimarket?: string;
  marketFactory?: string;
}

interface BazaarDeployment {
  marketplace?: string;
  goldToken?: string;
  usdcToken?: string;
}

interface EILDeployment {
  l1StakeManager?: string;
  crossChainPaymaster?: string;
  entryPoint?: string;
}

export function loadNetworkConfig(network?: NetworkType): NetworkConfig {
  const net = network || getNetworkFromEnv();
  const deploymentsPath = getDeploymentsPath();
  const chainId = CHAIN_IDS[net];

  // Initialize empty addresses
  const contracts: ContractAddresses = {
    entryPoint: null,
    priceOracle: null,
    serviceRegistry: null,
    creditManager: null,
    tokenRegistry: null,
    paymasterFactory: null,
    liquidityPaymaster: null,
    multiTokenPaymaster: null,
    identityRegistry: null,
    reputationRegistry: null,
    validationRegistry: null,
    registryGovernance: null,
    liquidityVault: null,
    feeDistributor: null,
    poolManager: null,
    swapRouter: null,
    nodeStakingManager: null,
    nodePerformanceOracle: null,
    autoSlasher: null,
    multiOracleConsensus: null,
    banManager: null,
    reputationLabelManager: null,
    reportingSystem: null,
    computeRegistry: null,
    computeRental: null,
    ledgerManager: null,
    inferenceServing: null,
    computeStaking: null,
    solverRegistry: null,
    inputSettler: null,
    outputSettler: null,
    oifOracle: null,
    l1StakeManager: null,
    crossChainPaymaster: null,
    bazaarMarketplace: null,
    goldToken: null,
    itemsNFT: null,
    predimarket: null,
    predictionOracle: null,
    playerTradeEscrow: null,
    contest: null,
    weth: '0x4200000000000000000000000000000000000006', // Standard OP Stack WETH
    usdc: null,
    elizaOS: null,
    jeju: null,
    otc: null,
  };

  // Load main deployment file
  const mainDeployment = loadNetworkDeployment<NetworkDeployment>(deploymentsPath, net, 'deployment.json');
  if (mainDeployment) {
    // Infrastructure
    contracts.entryPoint = mainDeployment.infrastructure?.entryPoint || null;
    contracts.priceOracle = mainDeployment.infrastructure?.priceOracle || null;
    contracts.serviceRegistry = mainDeployment.infrastructure?.serviceRegistry || null;
    contracts.creditManager = mainDeployment.infrastructure?.creditManager || null;

    // Paymaster
    contracts.tokenRegistry = mainDeployment.paymaster?.tokenRegistry || null;
    contracts.paymasterFactory = mainDeployment.paymaster?.paymasterFactory || null;
    contracts.liquidityPaymaster = mainDeployment.paymaster?.liquidityPaymaster || null;
    contracts.multiTokenPaymaster = mainDeployment.paymaster?.multiTokenPaymaster || null;

    // Registry
    contracts.identityRegistry = mainDeployment.registry?.identityRegistry || null;
    contracts.reputationRegistry = mainDeployment.registry?.reputationRegistry || null;
    contracts.validationRegistry = mainDeployment.registry?.validationRegistry || null;
    contracts.registryGovernance = mainDeployment.registry?.registryGovernance || null;

    // DeFi
    contracts.liquidityVault = mainDeployment.defi?.liquidityVault || null;
    contracts.feeDistributor = mainDeployment.defi?.feeDistributor || null;
    contracts.poolManager = mainDeployment.defi?.poolManager || null;
    contracts.swapRouter = mainDeployment.defi?.swapRouter || null;

    // Node Staking
    contracts.nodeStakingManager = mainDeployment.nodeStaking?.nodeStakingManager || null;
    contracts.nodePerformanceOracle = mainDeployment.nodeStaking?.nodePerformanceOracle || null;
    contracts.autoSlasher = mainDeployment.nodeStaking?.autoSlasher || null;
    contracts.multiOracleConsensus = mainDeployment.nodeStaking?.multiOracleConsensus || null;

    // Moderation
    contracts.banManager = mainDeployment.moderation?.banManager || null;
    contracts.reputationLabelManager = mainDeployment.moderation?.reputationLabelManager || null;
    contracts.reportingSystem = mainDeployment.moderation?.reportingSystem || null;

    // Compute
    contracts.computeRegistry = mainDeployment.compute?.computeRegistry || null;
    contracts.computeRental = mainDeployment.compute?.computeRental || null;
    contracts.ledgerManager = mainDeployment.compute?.ledgerManager || null;
    contracts.inferenceServing = mainDeployment.compute?.inferenceServing || null;
    contracts.computeStaking = mainDeployment.compute?.computeStaking || null;

    // OIF
    contracts.solverRegistry = mainDeployment.oif?.solverRegistry || null;
    contracts.inputSettler = mainDeployment.oif?.inputSettler || null;
    contracts.outputSettler = mainDeployment.oif?.outputSettler || null;
    contracts.oifOracle = mainDeployment.oif?.oracle || null;

    // Games
    contracts.bazaarMarketplace = mainDeployment.games?.bazaarMarketplace || null;
    contracts.goldToken = mainDeployment.games?.goldToken || null;
    contracts.itemsNFT = mainDeployment.games?.itemsNFT || null;
    contracts.predimarket = mainDeployment.games?.predimarket || null;

    // Tokens
    contracts.weth = mainDeployment.tokens?.weth || contracts.weth;
    contracts.usdc = mainDeployment.tokens?.usdc || null;
    contracts.elizaOS = mainDeployment.tokens?.elizaOS || null;
    contracts.jeju = mainDeployment.tokens?.jeju || null;
  }

  // Load additional deployment files for localnet
  if (net === 'localnet') {
    // Identity system
    const identitySystem = loadDeploymentFile<IdentitySystemDeployment>(deploymentsPath, 'identity-system-1337.json');
    if (identitySystem) {
      contracts.identityRegistry = identitySystem.identityRegistry || contracts.identityRegistry;
      contracts.reputationRegistry = identitySystem.reputationRegistry || contracts.reputationRegistry;
      contracts.validationRegistry = identitySystem.validationRegistry || contracts.validationRegistry;
      contracts.serviceRegistry = identitySystem.serviceRegistry || contracts.serviceRegistry;
      contracts.creditManager = identitySystem.creditManager || contracts.creditManager;
      contracts.usdc = identitySystem.usdc || contracts.usdc;
      contracts.elizaOS = identitySystem.elizaOS || contracts.elizaOS;
      contracts.jeju = identitySystem.jeju || contracts.jeju;
    }

    // Localnet addresses (alternative file)
    const localnetAddresses = loadDeploymentFile<IdentitySystemDeployment>(deploymentsPath, 'localnet-addresses.json');
    if (localnetAddresses) {
      contracts.identityRegistry = localnetAddresses.identityRegistry || contracts.identityRegistry;
      contracts.reputationRegistry = localnetAddresses.reputationRegistry || contracts.reputationRegistry;
      contracts.validationRegistry = localnetAddresses.validationRegistry || contracts.validationRegistry;
      contracts.serviceRegistry = localnetAddresses.serviceRegistry || contracts.serviceRegistry;
      contracts.creditManager = localnetAddresses.creditManager || contracts.creditManager;
      contracts.usdc = localnetAddresses.usdc || contracts.usdc;
      contracts.elizaOS = localnetAddresses.elizaOS || contracts.elizaOS;
      contracts.jeju = localnetAddresses.jeju || contracts.jeju;
    }

    // JEJU Token deployment (localnet subfolder)
    interface JejuTokenDeployment {
      jejuToken?: string;
      banManager?: string;
    }
    const jejuTokenDeployment = loadNetworkDeployment<JejuTokenDeployment>(deploymentsPath, 'localnet', 'jeju-token.json');
    if (jejuTokenDeployment) {
      contracts.jeju = jejuTokenDeployment.jejuToken || contracts.jeju;
      contracts.banManager = jejuTokenDeployment.banManager || contracts.banManager;
    }

    // Paymaster system
    const paymasterSystem = loadDeploymentFile<PaymasterSystemDeployment>(deploymentsPath, 'paymaster-system-localnet.json');
    if (paymasterSystem) {
      contracts.tokenRegistry = paymasterSystem.tokenRegistry || contracts.tokenRegistry;
      contracts.priceOracle = paymasterSystem.priceOracle || contracts.priceOracle;
      contracts.paymasterFactory = paymasterSystem.paymasterFactory || contracts.paymasterFactory;
      contracts.entryPoint = paymasterSystem.entryPoint || contracts.entryPoint;
    }

    // Liquidity system (localnet subfolder)
    interface LiquiditySystemDeployment {
      elizaOS?: string;
      entryPoint?: string;
      feeDistributor?: string;
      identityRegistry?: string;
      liquidityVault?: string;
      paymaster?: string;
      priceOracle?: string;
      reputationRegistry?: string;
      validationRegistry?: string;
    }
    const liquiditySystem = loadNetworkDeployment<LiquiditySystemDeployment>(deploymentsPath, 'localnet', 'liquidity-system.json');
    if (liquiditySystem) {
      contracts.elizaOS = liquiditySystem.elizaOS || contracts.elizaOS;
      contracts.entryPoint = liquiditySystem.entryPoint || contracts.entryPoint;
      contracts.feeDistributor = liquiditySystem.feeDistributor || contracts.feeDistributor;
      contracts.identityRegistry = liquiditySystem.identityRegistry || contracts.identityRegistry;
      contracts.liquidityVault = liquiditySystem.liquidityVault || contracts.liquidityVault;
      contracts.liquidityPaymaster = liquiditySystem.paymaster || contracts.liquidityPaymaster;
      contracts.priceOracle = liquiditySystem.priceOracle || contracts.priceOracle;
      contracts.reputationRegistry = liquiditySystem.reputationRegistry || contracts.reputationRegistry;
      contracts.validationRegistry = liquiditySystem.validationRegistry || contracts.validationRegistry;
    }

    // Multi-token system (localnet subfolder)
    interface LocalnetMultiTokenDeployment {
      clanker_distributor?: string;
      clanker_paymaster?: string;
      clanker_token?: string;
      clanker_vault?: string;
      clankermon_distributor?: string;
      clankermon_paymaster?: string;
      clankermon_token?: string;
      clankermon_vault?: string;
      elizaOS_distributor?: string;
      elizaOS_paymaster?: string;
      elizaOS_token?: string;
      elizaOS_vault?: string;
      entryPoint?: string;
      oracle?: string;
      virtual_distributor?: string;
      virtual_paymaster?: string;
      virtual_token?: string;
      virtual_vault?: string;
    }
    const localnetMultiToken = loadNetworkDeployment<LocalnetMultiTokenDeployment>(deploymentsPath, 'localnet', 'multi-token-system.json');
    if (localnetMultiToken) {
      contracts.entryPoint = localnetMultiToken.entryPoint || contracts.entryPoint;
      contracts.priceOracle = localnetMultiToken.oracle || contracts.priceOracle;
      contracts.elizaOS = localnetMultiToken.elizaOS_token || contracts.elizaOS;
      // Store multi-token paymasters in a map for reference
    }

    // Multi-token system (root level - 1337 chain)
    const multiTokenSystem = loadDeploymentFile<MultiTokenSystemDeployment>(deploymentsPath, 'multi-token-system-1337.json');
    if (multiTokenSystem) {
      contracts.priceOracle = multiTokenSystem.oracle || contracts.priceOracle;
      contracts.liquidityVault = multiTokenSystem.vault || contracts.liquidityVault;
      contracts.feeDistributor = multiTokenSystem.distributor || contracts.feeDistributor;
      contracts.liquidityPaymaster = multiTokenSystem.paymaster || contracts.liquidityPaymaster;
      contracts.elizaOS = multiTokenSystem.elizaOS || contracts.elizaOS;
    }

    // Predimarket
    const predimarket = loadDeploymentFile<PredimarketDeployment>(deploymentsPath, 'predimarket-1337.json');
    if (predimarket) {
      contracts.predimarket = predimarket.predimarket || contracts.predimarket;
      contracts.predictionOracle = predimarket.predictionOracle || contracts.predictionOracle;
      contracts.elizaOS = predimarket.elizaOSToken || contracts.elizaOS;
    }

    // Bazaar
    const bazaar = loadDeploymentFile<BazaarDeployment>(deploymentsPath, 'bazaar-marketplace-1337.json');
    if (bazaar) {
      contracts.bazaarMarketplace = bazaar.marketplace || contracts.bazaarMarketplace;
      contracts.goldToken = bazaar.goldToken || contracts.goldToken;
    }

    // EIL
    const eil = loadDeploymentFile<EILDeployment>(deploymentsPath, 'eil-localnet.json');
    if (eil) {
      contracts.l1StakeManager = eil.l1StakeManager || contracts.l1StakeManager;
      contracts.crossChainPaymaster = eil.crossChainPaymaster || contracts.crossChainPaymaster;
    }
  }

  // Load EIL for testnet
  if (net === 'testnet') {
    const eil = loadDeploymentFile<EILDeployment>(deploymentsPath, 'eil-testnet.json');
    if (eil) {
      contracts.l1StakeManager = eil.l1StakeManager || contracts.l1StakeManager;
      contracts.crossChainPaymaster = eil.crossChainPaymaster || contracts.crossChainPaymaster;
    }
  }

  return {
    network: net,
    chainId,
    rpcUrl: process.env.RPC_ETH_HTTP || DEFAULT_RPC[net],
    contracts,
  };
}

// Contract addresses for quick lookup - set of all non-null addresses
export function getContractAddressSet(config: NetworkConfig): Set<string> {
  const addresses = new Set<string>();
  for (const [, value] of Object.entries(config.contracts)) {
    if (value && typeof value === 'string') {
      addresses.add(value.toLowerCase());
    }
  }
  return addresses;
}

// Map contract address to name
export function getContractName(config: NetworkConfig, address: string): string | null {
  const lowerAddress = address.toLowerCase();
  for (const [name, value] of Object.entries(config.contracts)) {
    if (value && typeof value === 'string' && value.toLowerCase() === lowerAddress) {
      return name;
    }
  }
  return null;
}

// Singleton instance
let _networkConfig: NetworkConfig | null = null;

export function getNetworkConfig(): NetworkConfig {
  if (!_networkConfig) {
    _networkConfig = loadNetworkConfig();
  }
  return _networkConfig;
}

// Re-export for convenience
export { registerContract, getContractInfo, ContractInfo } from './contract-events';

