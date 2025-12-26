/** Contract Configuration - Browser-safe version */

<<<<<<< HEAD
=======
import { getContractAddress as getNetworkAddress, getDWSUrl as getConfigDWSUrl } from '@jejunetwork/config'
>>>>>>> cd08d238c04fc8f92037e4eb995e7cddc3863234
import type { Address } from 'viem'

// Static contract addresses loaded from JSON at build time
// This avoids using process.env which doesn't work in browsers
const CONTRACTS = {
  localnet: {
    chainId: 31337,
    registry: {
      identity: '0x99bbA657f2BbC93c02D617f8bA121cB8Fc104Acf',
      reputation: '0x0E801D84Fa97b50751Dbf25036d067dCf18858bF',
      validation: '0x8f86403A4DE0BB5791fa46B8e795C547942fE4Cf',
    },
    security: {
      bountyRegistry: '',
    },
    nodeStaking: {
      manager: '0x7bc06c482DEAd17c0e297aFbC32f6e63d3846650',
    },
    payments: {
      paymasterFactory: '0x5f3f1dBD7B74C6B46e8c44f98792A1dAf8d69154',
      priceOracle: '0x95401dc811bb5740090279Ba06cfA8fcF6113778',
      tokenRegistry: '0x1291Be112d480055DaFd8a610b7d1e203891C274',
    },
  },
  testnet: {
    chainId: 420690,
    registry: {
      identity: '',
      reputation: '',
      validation: '',
    },
    security: {
      bountyRegistry: '',
    },
    nodeStaking: {
      manager: '',
    },
    payments: {
      paymasterFactory: '',
      priceOracle: '',
      tokenRegistry: '',
    },
  },
  mainnet: {
    chainId: 420691,
    registry: {
      identity: '',
      reputation: '',
      validation: '',
    },
    security: {
      bountyRegistry: '',
    },
    nodeStaking: {
      manager: '',
    },
    payments: {
      paymasterFactory: '',
      priceOracle: '',
      tokenRegistry: '',
    },
  },
} as const

type NetworkType = 'localnet' | 'testnet' | 'mainnet'

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

function getNetwork(): NetworkType {
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

// Map of contract keys to their location in the CONTRACTS structure
type ContractMapping = {
  category: 'registry' | 'security' | 'nodeStaking' | 'payments'
  name: string
}

const CONTRACT_KEY_MAP: Record<string, ContractMapping> = {
  CONTRIBUTOR_REGISTRY: { category: 'registry', name: 'validation' },
  BOUNTY_REGISTRY: { category: 'security', name: 'bountyRegistry' },
  DAO_REGISTRY: { category: 'registry', name: 'validation' },
  IDENTITY_REGISTRY: { category: 'registry', name: 'identity' },
  bountyRegistry: { category: 'security', name: 'bountyRegistry' },
  daoRegistry: { category: 'registry', name: 'validation' },
  contributorRegistry: { category: 'registry', name: 'validation' },
  identityRegistry: { category: 'registry', name: 'identity' },
}

function getNetworkAddress(key: string, network: NetworkType): string | null {
  const mapping = CONTRACT_KEY_MAP[key]
  if (!mapping) return null

  const networkContracts = CONTRACTS[network]
  const category = networkContracts[mapping.category] as Record<string, string>
  const address = category[mapping.name]

  return address || null
}

export function getContractAddressSafe(name: string): Address | null {
  const network = getNetwork()
  const address = getNetworkAddress(name, network)

  // Return null if it's a zero address or empty
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
    return ZERO_ADDRESS // Not deployed
  },
  get paymentRequestRegistry(): Address {
    return ZERO_ADDRESS // Not deployed
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
