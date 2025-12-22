/**
 * Contract addresses and configuration for Factory app
 */

import type { Address } from 'viem'

const DWS_URL =
  process.env.DWS_URL || process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4000'

/**
 * Get the DWS API URL
 */
export function getDwsUrl(): string {
  return DWS_URL
}

/**
 * Contract addresses for Factory features
 * These are placeholder addresses - update with actual deployed contract addresses
 */
export const addresses = {
  contributorRegistry: '0x0000000000000000000000000000000000000001' as Address,
  deepFundingDistributor: '0x0000000000000000000000000000000000000002' as Address,
  paymentRequestRegistry: '0x0000000000000000000000000000000000000003' as Address,
  bountyRegistry: '0x0000000000000000000000000000000000000004' as Address,
  daoRegistry: '0x0000000000000000000000000000000000000005' as Address,
  identityRegistry: '0x0000000000000000000000000000000000000006' as Address,
} as const

/**
 * Contract address mappings by name
 */
const CONTRACT_ADDRESSES: Record<string, Address> = {
  CONTRIBUTOR_REGISTRY: addresses.contributorRegistry,
  DEEP_FUNDING_DISTRIBUTOR: addresses.deepFundingDistributor,
  PAYMENT_REQUEST_REGISTRY: addresses.paymentRequestRegistry,
  BOUNTY_REGISTRY: addresses.bountyRegistry,
  DAO_REGISTRY: addresses.daoRegistry,
  IDENTITY_REGISTRY: addresses.identityRegistry,
  bountyRegistry: addresses.bountyRegistry,
  daoRegistry: addresses.daoRegistry,
}

/**
 * Get a contract address by name, returns null if not found
 */
export function getContractAddressSafe(name: string): Address | null {
  return CONTRACT_ADDRESSES[name] || null
}

/**
 * Get a contract address by name, throws if not found
 */
export function getContractAddress(name: string): Address {
  const address = CONTRACT_ADDRESSES[name]
  if (!address) {
    throw new Error(`Contract address not found for: ${name}`)
  }
  return address
}
