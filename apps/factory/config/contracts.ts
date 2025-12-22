/**
 * Contract Addresses Configuration
 * 
 * Loads addresses from environment or uses localnet defaults.
 * For DWS deployment, addresses are read from on-chain registry.
 */

import type { Address } from 'viem';

export interface ContractAddresses {
  contributorRegistry: Address;
  paymentRequestRegistry: Address;
  deepFundingDistributor: Address;
  daoRegistry: Address;
  identityRegistry: Address;
  workAgreementRegistry: Address;
}

// Localnet default addresses (deterministic from anvil)
const LOCALNET_ADDRESSES: ContractAddresses = {
  contributorRegistry: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
  paymentRequestRegistry: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
  deepFundingDistributor: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
  daoRegistry: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  identityRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  workAgreementRegistry: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
};

// Testnet addresses (Jeju Testnet)
// NOTE: Jeju testnet has its own chain ID, not Base Sepolia
const TESTNET_ADDRESSES: ContractAddresses = {
  contributorRegistry: (process.env.NEXT_PUBLIC_CONTRIBUTOR_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
  paymentRequestRegistry: (process.env.NEXT_PUBLIC_PAYMENT_REQUEST_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
  deepFundingDistributor: (process.env.NEXT_PUBLIC_DEEP_FUNDING_DISTRIBUTOR || '0x0000000000000000000000000000000000000000') as Address,
  daoRegistry: (process.env.NEXT_PUBLIC_DAO_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
  identityRegistry: (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
  workAgreementRegistry: (process.env.NEXT_PUBLIC_WORK_AGREEMENT_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
};

// Mainnet addresses (Jeju Mainnet)
const MAINNET_ADDRESSES: ContractAddresses = {
  contributorRegistry: (process.env.NEXT_PUBLIC_CONTRIBUTOR_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
  paymentRequestRegistry: (process.env.NEXT_PUBLIC_PAYMENT_REQUEST_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
  deepFundingDistributor: (process.env.NEXT_PUBLIC_DEEP_FUNDING_DISTRIBUTOR || '0x0000000000000000000000000000000000000000') as Address,
  daoRegistry: (process.env.NEXT_PUBLIC_DAO_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
  identityRegistry: (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
  workAgreementRegistry: (process.env.NEXT_PUBLIC_WORK_AGREEMENT_REGISTRY || '0x0000000000000000000000000000000000000000') as Address,
};

// Jeju chain IDs - these should be defined in network config
const JEJU_TESTNET_CHAIN_ID = Number(process.env.NEXT_PUBLIC_JEJU_TESTNET_CHAIN_ID || 9999); // Placeholder
const JEJU_MAINNET_CHAIN_ID = Number(process.env.NEXT_PUBLIC_JEJU_MAINNET_CHAIN_ID || 10000); // Placeholder

export function getContractAddresses(): ContractAddresses {
  const chainId = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '31337', 10);
  
  switch (chainId) {
    case 31337: // Localnet (Anvil)
    case 1337:
      return LOCALNET_ADDRESSES;
    case JEJU_TESTNET_CHAIN_ID:
      return TESTNET_ADDRESSES;
    case JEJU_MAINNET_CHAIN_ID:
      return MAINNET_ADDRESSES;
    default:
      // For any unknown chain, use env vars or defaults
      return TESTNET_ADDRESSES;
  }
}

export function getRpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:6546';
}

export function getDwsUrl(): string {
  return process.env.NEXT_PUBLIC_DWS_URL || 'http://127.0.0.1:4030';
}

export function getChainId(): number {
  return parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '31337', 10);
}

/**
 * Get a specific contract address by name
 */
export function getContractAddress(name: keyof ContractAddresses): Address {
  return getContractAddresses()[name];
}

/**
 * Safely get a contract address - returns null if not configured (zero address)
 */
export function getContractAddressSafe(name: keyof ContractAddresses): Address | null {
  const address = getContractAddresses()[name];
  if (address === '0x0000000000000000000000000000000000000000') {
    return null;
  }
  return address;
}

// Export individual addresses for convenience
export const addresses = getContractAddresses();
export const rpcUrl = getRpcUrl();
export const dwsUrl = getDwsUrl();
export const chainId = getChainId();
