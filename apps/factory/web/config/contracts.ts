/** Contract Configuration */

import type { Address } from 'viem'

export function getDwsUrl(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:4030'
  }
  const hostname = window.location.hostname
  if (hostname.includes('local.')) {
    return 'http://dws.local.jejunetwork.org'
  }
  if (hostname.includes('testnet')) {
    return 'https://dws.testnet.jejunetwork.org'
  }
  if (
    hostname === 'factory.jejunetwork.org' ||
    hostname === 'factory.jeju.network'
  ) {
    return 'https://dws.jejunetwork.org'
  }
  return 'http://localhost:4030'
}

// Define contract addresses with explicit Address type
// These are placeholder addresses for local development
const CONTRIBUTOR_REGISTRY: Address =
  '0x0000000000000000000000000000000000000001'
const DEEP_FUNDING_DISTRIBUTOR: Address =
  '0x0000000000000000000000000000000000000002'
const PAYMENT_REQUEST_REGISTRY: Address =
  '0x0000000000000000000000000000000000000003'
const BOUNTY_REGISTRY: Address = '0x0000000000000000000000000000000000000004'
const DAO_REGISTRY: Address = '0x0000000000000000000000000000000000000005'
const IDENTITY_REGISTRY: Address = '0x0000000000000000000000000000000000000006'

export const addresses = {
  contributorRegistry: CONTRIBUTOR_REGISTRY,
  deepFundingDistributor: DEEP_FUNDING_DISTRIBUTOR,
  paymentRequestRegistry: PAYMENT_REQUEST_REGISTRY,
  bountyRegistry: BOUNTY_REGISTRY,
  daoRegistry: DAO_REGISTRY,
  identityRegistry: IDENTITY_REGISTRY,
}

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

export function getContractAddressSafe(name: string): Address | null {
  return CONTRACT_ADDRESSES[name] || null
}

export function getContractAddress(name: string): Address {
  const address = CONTRACT_ADDRESSES[name]
  if (!address) {
    throw new Error(`Contract address not found for: ${name}`)
  }
  return address
}
