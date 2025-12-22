/**
 * Contract Addresses Configuration
 *
 * Loads addresses from environment or uses localnet defaults.
 * For DWS deployment, addresses are read from on-chain registry.
 */

import type { Address } from 'viem'

export interface ContractAddresses {
  contributorRegistry: Address
  paymentRequestRegistry: Address
  deepFundingDistributor: Address
  daoRegistry: Address
  identityRegistry: Address
  workAgreementRegistry: Address
}

// Localnet default addresses (deterministic from anvil)
const LOCALNET_ADDRESSES: ContractAddresses = {
  contributorRegistry: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
  paymentRequestRegistry: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
  deepFundingDistributor: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
  daoRegistry: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  identityRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  workAgreementRegistry: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
}

// Testnet addresses (Base Sepolia)
const TESTNET_ADDRESSES: ContractAddresses = {
  contributorRegistry: (process.env.NEXT_PUBLIC_CONTRIBUTOR_REGISTRY ||
    '0x0000000000000000000000000000000000000000') as Address,
  paymentRequestRegistry: (process.env.NEXT_PUBLIC_PAYMENT_REQUEST_REGISTRY ||
    '0x0000000000000000000000000000000000000000') as Address,
  deepFundingDistributor: (process.env.NEXT_PUBLIC_DEEP_FUNDING_DISTRIBUTOR ||
    '0x0000000000000000000000000000000000000000') as Address,
  daoRegistry: (process.env.NEXT_PUBLIC_DAO_REGISTRY ||
    '0x0000000000000000000000000000000000000000') as Address,
  identityRegistry: (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY ||
    '0x0000000000000000000000000000000000000000') as Address,
  workAgreementRegistry: (process.env.NEXT_PUBLIC_WORK_AGREEMENT_REGISTRY ||
    '0x0000000000000000000000000000000000000000') as Address,
}

// Mainnet addresses (Base)
const MAINNET_ADDRESSES: ContractAddresses = {
  contributorRegistry: (process.env.NEXT_PUBLIC_CONTRIBUTOR_REGISTRY ||
    '0x0000000000000000000000000000000000000000') as Address,
  paymentRequestRegistry: (process.env.NEXT_PUBLIC_PAYMENT_REQUEST_REGISTRY ||
    '0x0000000000000000000000000000000000000000') as Address,
  deepFundingDistributor: (process.env.NEXT_PUBLIC_DEEP_FUNDING_DISTRIBUTOR ||
    '0x0000000000000000000000000000000000000000') as Address,
  daoRegistry: (process.env.NEXT_PUBLIC_DAO_REGISTRY ||
    '0x0000000000000000000000000000000000000000') as Address,
  identityRegistry: (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY ||
    '0x0000000000000000000000000000000000000000') as Address,
  workAgreementRegistry: (process.env.NEXT_PUBLIC_WORK_AGREEMENT_REGISTRY ||
    '0x0000000000000000000000000000000000000000') as Address,
}

export function getContractAddresses(): ContractAddresses {
  const chainId = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '31337', 10)

  switch (chainId) {
    case 31337: // Localnet
    case 1337:
      return LOCALNET_ADDRESSES
    case 84532: // Base Sepolia
      return TESTNET_ADDRESSES
    case 8453: // Base
      return MAINNET_ADDRESSES
    default:
      return LOCALNET_ADDRESSES
  }
}

export function getRpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:8545'
}

export function getDwsUrl(): string {
  return process.env.NEXT_PUBLIC_DWS_URL || 'http://127.0.0.1:4030'
}

export function getChainId(): number {
  return parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '31337', 10)
}

// Export individual addresses for convenience
export const addresses = getContractAddresses()
export const rpcUrl = getRpcUrl()
export const dwsUrl = getDwsUrl()
export const chainId = getChainId()

// Extended contract addresses for other registries
type ExtendedContractKey =
  | keyof ContractAddresses
  | 'bountyRegistry'
  | 'modelRegistry'
  | 'guardianRegistry'
  | 'repoRegistry'
  | 'packageRegistry'
  | 'trainingCoordinator'
  | 'trainingRewards'
  | 'nodePerformanceOracle'

const EXTENDED_LOCALNET_ADDRESSES: Record<ExtendedContractKey, Address> = {
  ...LOCALNET_ADDRESSES,
  bountyRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  modelRegistry: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
  guardianRegistry: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
  repoRegistry: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
  packageRegistry: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e',
  trainingCoordinator: '0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0',
  trainingRewards: '0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82',
  nodePerformanceOracle: '0x9A676e781A523b5d0C0e43731313A708CB607508',
}

// Get a single contract address by key
export function getContractAddress(key: ExtendedContractKey): Address {
  const chainId = getChainId()
  if (chainId === 31337 || chainId === 1337) {
    return EXTENDED_LOCALNET_ADDRESSES[key]
  }
  // For testnet/mainnet, fall back to base addresses or zero address
  const baseAddresses = getContractAddresses()
  if (key in baseAddresses) {
    return baseAddresses[key as keyof ContractAddresses]
  }
  return '0x0000000000000000000000000000000000000000'
}

// Get a contract address safely (returns null if not configured)
export function getContractAddressSafe(
  key: ExtendedContractKey,
): Address | null {
  const address = getContractAddress(key)
  if (address === '0x0000000000000000000000000000000000000000') {
    return null
  }
  return address
}
