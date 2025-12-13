import type { Address } from 'viem';
import { NETWORK, type NetworkId } from './networks.js';
import { ZERO_ADDRESS } from '../lib/contracts.js';

interface NetworkContracts {
  jejuToken: Address;
  identityRegistry: Address;
  banManager: Address;
  moderationMarketplace: Address;
  reportingSystem: Address;
  reputationLabelManager: Address;
  inputSettler: Address;
  outputSettler: Address;
  solverRegistry: Address;
  oifOracle: Address;
  xlpRouter: Address;
  liquidityAggregator: Address;
}

// Testnet/Localnet deployed addresses (deterministic)
const TESTNET_CONTRACTS: NetworkContracts = {
  jejuToken: '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address,
  identityRegistry: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as Address,
  banManager: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707' as Address,
  moderationMarketplace: '0x0165878A594ca255338adfa4d48449f69242Eb8F' as Address,
  reportingSystem: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853' as Address,
  reputationLabelManager: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6' as Address,
  inputSettler: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318' as Address,
  outputSettler: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788' as Address,
  solverRegistry: '0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0' as Address,
  oifOracle: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e' as Address,
  xlpRouter: '0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82' as Address,
  liquidityAggregator: '0x9A676e781A523b5d0C0e43731313A708CB607508' as Address,
};

// Mainnet addresses - update when deployed
const MAINNET_CONTRACTS: NetworkContracts = {
  jejuToken: ZERO_ADDRESS,
  identityRegistry: ZERO_ADDRESS,
  banManager: ZERO_ADDRESS,
  moderationMarketplace: ZERO_ADDRESS,
  reportingSystem: ZERO_ADDRESS,
  reputationLabelManager: ZERO_ADDRESS,
  inputSettler: ZERO_ADDRESS,
  outputSettler: ZERO_ADDRESS,
  solverRegistry: ZERO_ADDRESS,
  oifOracle: ZERO_ADDRESS,
  xlpRouter: ZERO_ADDRESS,
  liquidityAggregator: ZERO_ADDRESS,
};

const CONTRACTS_BY_NETWORK: Record<NetworkId, NetworkContracts> = {
  testnet: TESTNET_CONTRACTS,
  mainnet: MAINNET_CONTRACTS,
  localnet: TESTNET_CONTRACTS,
};

// Export individual addresses for server-side use
export const JEJU_TOKEN_ADDRESS = CONTRACTS_BY_NETWORK[NETWORK].jejuToken;
export const IDENTITY_REGISTRY_ADDRESS = CONTRACTS_BY_NETWORK[NETWORK].identityRegistry;
export const BAN_MANAGER_ADDRESS = CONTRACTS_BY_NETWORK[NETWORK].banManager;
export const MODERATION_MARKETPLACE_ADDRESS = CONTRACTS_BY_NETWORK[NETWORK].moderationMarketplace;
export const REPORTING_SYSTEM_ADDRESS = CONTRACTS_BY_NETWORK[NETWORK].reportingSystem;
export const REPUTATION_LABEL_MANAGER_ADDRESS = CONTRACTS_BY_NETWORK[NETWORK].reputationLabelManager;
export const INPUT_SETTLER_ADDRESS = CONTRACTS_BY_NETWORK[NETWORK].inputSettler;
export const OUTPUT_SETTLER_ADDRESS = CONTRACTS_BY_NETWORK[NETWORK].outputSettler;
export const SOLVER_REGISTRY_ADDRESS = CONTRACTS_BY_NETWORK[NETWORK].solverRegistry;
export const OIF_ORACLE_ADDRESS = CONTRACTS_BY_NETWORK[NETWORK].oifOracle;
export const XLP_ROUTER_ADDRESS = CONTRACTS_BY_NETWORK[NETWORK].xlpRouter;
export const LIQUIDITY_AGGREGATOR_ADDRESS = CONTRACTS_BY_NETWORK[NETWORK].liquidityAggregator;

export interface TokenConfig {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  priceUSD: number;
  logoUrl: string;
  hasPaymaster: boolean;
  bridged: boolean;
  originChain: 'jeju' | 'ethereum' | 'base';
  l1Address?: Address;
  hasBanEnforcement?: boolean;
  isPreferred?: boolean;
}

const TESTNET_TOKENS: TokenConfig[] = [
  {
    symbol: 'JEJU',
    name: 'Jeju',
    address: TESTNET_CONTRACTS.jejuToken,
    decimals: 18,
    priceUSD: 0.05,
    logoUrl: 'https://assets.jeju.network/jeju-logo.png',
    hasPaymaster: true,
    bridged: false,
    originChain: 'jeju',
    isPreferred: true,
    hasBanEnforcement: true,
  },
  {
    symbol: 'elizaOS',
    name: 'elizaOS Token',
    address: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as Address,
    decimals: 18,
    priceUSD: 0.10,
    logoUrl: 'https://assets.jeju.network/eliza-logo.png',
    hasPaymaster: true,
    bridged: false,
    originChain: 'jeju',
  },
  {
    symbol: 'CLANKER',
    name: 'tokenbot',
    address: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as Address,
    decimals: 18,
    priceUSD: 26.14,
    logoUrl: 'https://assets.coinmarketcap.com/clanker-logo.png',
    hasPaymaster: true,
    bridged: true,
    originChain: 'ethereum',
    l1Address: '0x1bc0c42215582d5a085795f4badbac3ff36d1bcb' as Address,
  },
  {
    symbol: 'VIRTUAL',
    name: 'Virtuals Protocol',
    address: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as Address,
    decimals: 18,
    priceUSD: 1.85,
    logoUrl: 'https://assets.virtuals.io/logo.png',
    hasPaymaster: true,
    bridged: true,
    originChain: 'ethereum',
    l1Address: '0x44ff8620b8cA30902395A7bD3F2407e1A091BF73' as Address,
  },
  {
    symbol: 'CLANKERMON',
    name: 'Clankermon',
    address: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9' as Address,
    decimals: 18,
    priceUSD: 0.15,
    logoUrl: 'https://assets.clankermon.xyz/logo.png',
    hasPaymaster: true,
    bridged: true,
    originChain: 'ethereum',
    l1Address: '0x1cDbB57b12f732cFb4DC06f690ACeF476485B2a5' as Address,
  },
];

const TOKENS_BY_NETWORK: Record<NetworkId, TokenConfig[]> = {
  testnet: TESTNET_TOKENS,
  mainnet: [],
  localnet: TESTNET_TOKENS,
};

export function getTokenConfigs(): TokenConfig[] {
  return TOKENS_BY_NETWORK[NETWORK];
}

export function getTokenBySymbol(symbol: string): TokenConfig | undefined {
  return getTokenConfigs().find(t => t.symbol.toLowerCase() === symbol.toLowerCase());
}

export function getTokenByAddress(address: string): TokenConfig | undefined {
  return getTokenConfigs().find(t => t.address.toLowerCase() === address.toLowerCase());
}
