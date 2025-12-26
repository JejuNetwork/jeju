/** Contract Configuration */

import { getContractAddress as getNetworkAddress, getDWSUrl as getConfigDWSUrl } from '@jejunetwork/config'
import type { Address } from 'viem'

export function getDwsUrl(): string {
  if (typeof window === 'undefined') {
    return getConfigDWSUrl()
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
  return getConfigDWSUrl()
}

function getNetwork(): 'localnet' | 'testnet' | 'mainnet' {
  if (typeof window === 'undefined') return 'localnet'
  const hostname = window.location.hostname
  if (hostname.includes('testnet')) return 'testnet'
  if (
    hostname === 'factory.jejunetwork.org' ||
    hostname === 'factory.jeju.network'
  )
    return 'mainnet'
  return 'localnet'
}

// Map of contract keys to @jejunetwork/config contract names
const CONTRACT_KEY_MAP: Record<string, string> = {
  CONTRIBUTOR_REGISTRY: 'ContributorRegistry',
  DEEP_FUNDING_DISTRIBUTOR: 'DeepFundingDistributor',
  PAYMENT_REQUEST_REGISTRY: 'PaymentRequestRegistry',
  BOUNTY_REGISTRY: 'BountyRegistry',
  DAO_REGISTRY: 'DaoRegistry',
  IDENTITY_REGISTRY: 'IdentityRegistry',
  bountyRegistry: 'BountyRegistry',
  daoRegistry: 'DaoRegistry',
  contributorRegistry: 'ContributorRegistry',
  identityRegistry: 'IdentityRegistry',
}

export function getContractAddressSafe(name: string): Address | null {
  const contractName = CONTRACT_KEY_MAP[name]
  if (!contractName) return null

  const network = getNetwork()
  const address = getNetworkAddress(contractName, network)

  // Return null if it's a zero address (not deployed)
  if (!address || address === '0x0000000000000000000000000000000000000000') {
    return null
  }

  return address as Address
}

export function getContractAddress(name: string): Address {
  const address = getContractAddressSafe(name)
  if (!address) {
    throw new Error(`Contract address not found for: ${name}`)
  }
  return address
}

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

// Export addresses object for backwards compatibility
export const addresses = {
  get contributorRegistry(): Address {
    return getContractAddressSafe('CONTRIBUTOR_REGISTRY') ?? ZERO_ADDRESS
  },
  get deepFundingDistributor(): Address {
    return getContractAddressSafe('DEEP_FUNDING_DISTRIBUTOR') ?? ZERO_ADDRESS
  },
  get paymentRequestRegistry(): Address {
    return getContractAddressSafe('PAYMENT_REQUEST_REGISTRY') ?? ZERO_ADDRESS
  },
  get bountyRegistry(): Address {
    return getContractAddressSafe('BOUNTY_REGISTRY') ?? ZERO_ADDRESS
  },
  get daoRegistry(): Address {
    return getContractAddressSafe('DAO_REGISTRY') ?? ZERO_ADDRESS
  },
  get identityRegistry(): Address {
    return getContractAddressSafe('IDENTITY_REGISTRY') ?? ZERO_ADDRESS
  },
}
