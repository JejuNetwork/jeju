/**
 * Shared configuration for OAuth3 infrastructure
 */

import type { Address } from 'viem';

export type NetworkType = 'localnet' | 'testnet' | 'mainnet';

export const CHAIN_IDS = {
  localnet: 420691,
  testnet: 420690,
  mainnet: 420692,
} as const;

export const DEFAULT_RPC = 'http://localhost:9545';
export const DEFAULT_IPFS_API = 'http://localhost:5001/api/v0';
export const DEFAULT_IPFS_GATEWAY = 'http://localhost:8080/ipfs';

// Localnet addresses (from local anvil deployment)
const LOCALNET_CONTRACTS = {
  jnsRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address,
  jnsResolver: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as Address,
  appRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as Address,
  identityRegistry: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707' as Address,
  teeVerifier: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as Address,
} as const;

// Testnet addresses (Base Sepolia deployment)
const TESTNET_CONTRACTS = {
  jnsRegistry: '0x4B0897b0513fdC7C541B6d9D7E929C4e5364D2dB' as Address,
  jnsResolver: '0x14dc79964da2C08b23698B3D3cc7Ca32193d9955' as Address,
  appRegistry: '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f' as Address,
  identityRegistry: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720' as Address,
  teeVerifier: '0xBcd4042DE499D14e55001CcbB24a551F3b954096' as Address,
} as const;

// Mainnet addresses (Base mainnet deployment - NOT YET DEPLOYED)
const MAINNET_CONTRACTS = {
  jnsRegistry: '0x0000000000000000000000000000000000000000' as Address,
  jnsResolver: '0x0000000000000000000000000000000000000000' as Address,
  appRegistry: '0x0000000000000000000000000000000000000000' as Address,
  identityRegistry: '0x0000000000000000000000000000000000000000' as Address,
  teeVerifier: '0x0000000000000000000000000000000000000000' as Address,
} as const;

export const CONTRACTS = {
  localnet: LOCALNET_CONTRACTS,
  testnet: TESTNET_CONTRACTS,
  mainnet: MAINNET_CONTRACTS,
} as const;

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
export const MIN_STAKE = BigInt(1e18); // 1 ETH
export const ATTESTATION_VALIDITY_MS = 24 * 60 * 60 * 1000; // 24 hours
export const CACHE_EXPIRY_MS = 60000; // 1 minute

export function getNetworkType(chainId: number): NetworkType {
  if (chainId === CHAIN_IDS.localnet) return 'localnet';
  if (chainId === CHAIN_IDS.testnet) return 'testnet';
  return 'mainnet';
}

export function getContracts(chainId: number) {
  const network = getNetworkType(chainId);
  const contracts = CONTRACTS[network];
  
  // Fail fast if mainnet contracts not deployed
  if (network === 'mainnet' && contracts.jnsRegistry === ZERO_ADDRESS) {
    throw new Error('Mainnet contracts not yet deployed. Use testnet or localnet.');
  }
  
  return contracts;
}
