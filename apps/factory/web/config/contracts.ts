/** Contract Configuration - Browser-safe version */

import type { Address } from 'viem'

// Contract addresses from packages/config/contracts.json
// Keep in sync with the central contracts.json file
const CONTRACTS = {
  localnet: {
    chainId: 31337,
    registry: {
      identity: '0x0165878a594ca255338adfa4d48449f69242eb8f',
      reputation: '0x68B1D87F95878fE05B998F19b66F4baba5De1aed',
      validation: '0x3Aa5ebB10DC797CAC828524e59A333d0A371443c',
      token: '0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44',
    },
    security: {
      // SecurityBountyRegistry - for security/bug bounty reports (encrypted submissions)
      bountyRegistry: '0x0B36Ef2cb78859C20c8C1380CeAdB75043aA92b3',
    },
    work: {
      // BountyRegistry - for general task bounties with escrow and milestones
      // TODO: Deploy work/BountyRegistry.sol and add address here
      workBountyRegistry: '',
    },
    dws: {
      storageManager: '0x610178da211fef7d417bc0e6fed39f05609ad788',
      workerRegistry: '0xb7f8bc63bbcad18155201308c8f3540b07f84f5e',
      cdnRegistry: '0xa51c1fc2f0d1a1b8494ed1fe312d7c3a78ed91c0',
      repoRegistry: '0x0dcd1bf9a1b36ce34237eeafef220932846bcd82',
      packageRegistry: '0x9a9f2ccfde556a7e9ff0848998aa4a0cfd8863ae',
      containerRegistry: '0xc6e7df5e7b4f2a278906862b61205850344d4e7d',
      gitRegistry: '0x959922be3caee4b8cd9a407cc3ac1c251c2007b1',
    },
    nodeStaking: {
      manager: '0xa00F03Ea2d0a6e4961CaAFcA61A78334049c1848',
      performanceOracle: '0x998D98e9480A8f52A5252Faf316d129765773294',
    },
    payments: {
      creditManager: '0x67d269191c92Caf3cD7723F116c85e6E9bf55933',
      universalPaymaster: '0x84eA74d481Ee0A5332c457a4d796187F6Ba67fEB',
      paymasterFactory: '0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f',
      feeConfig: '0x4c5859f0F772848b2D91F1D83E2Fe57935348029',
    },
    governance: {
      daoRegistry: '0x1291Be112d480055DaFd8a610b7d1e203891C274',
      daoFunding: '0x5f3f1dBD7B74C6B46e8c44f98792A1dAf8d69154',
      registryGovernance: '0x7E6C94173C264aaE66Bf36ce047b0Aef585C2181',
    },
    compute: {
      registry: '0x53AAfBd184086d72fA233AE83e1a7B1339B5415C',
      inferenceServing: '0x08A90aF9A6eBBe11c322AD9930CC58E122231B5A',
    },
  },
  testnet: {
    chainId: 420690,
    registry: {
      identity: '',
      reputation: '',
      validation: '',
      token: '',
    },
    security: {
      bountyRegistry: '',
    },
    work: {
      workBountyRegistry: '',
    },
    dws: {
      storageManager: '0xBEc49fA140aCaA83533fB00A2BB19bDdd0290f25',
      workerRegistry: '0xD84379CEae14AA33C123Af12424A37803F885889',
      cdnRegistry: '0x2B0d36FACD61B71CC05ab8F3D2355ec3631C0dd5',
      repoRegistry: '0xfbC22278A96299D91d41C453234d97b4F5Eb9B2d',
      packageRegistry: '0x46b142DD1E924FAb83eCc3c08e4D46E82f005e0E',
      containerRegistry: '',
      gitRegistry: '',
    },
    nodeStaking: {
      manager: '',
      performanceOracle: '',
    },
    payments: {
      creditManager: '',
      universalPaymaster: '',
      paymasterFactory: '',
      feeConfig: '',
    },
    governance: {
      daoRegistry: '',
      daoFunding: '',
      registryGovernance: '',
    },
    compute: {
      registry: '',
      inferenceServing: '',
    },
  },
  mainnet: {
    chainId: 420691,
    registry: {
      identity: '',
      reputation: '',
      validation: '',
      token: '',
    },
    security: {
      bountyRegistry: '',
    },
    work: {
      workBountyRegistry: '',
    },
    dws: {
      storageManager: '',
      workerRegistry: '',
      cdnRegistry: '',
      repoRegistry: '',
      packageRegistry: '',
      containerRegistry: '',
      gitRegistry: '',
    },
    nodeStaking: {
      manager: '',
      performanceOracle: '',
    },
    payments: {
      creditManager: '',
      universalPaymaster: '',
      paymasterFactory: '',
      feeConfig: '',
    },
    governance: {
      daoRegistry: '',
      daoFunding: '',
      registryGovernance: '',
    },
    compute: {
      registry: '',
      inferenceServing: '',
    },
  },
} as const

type NetworkType = 'localnet' | 'testnet' | 'mainnet'

const DWS_URLS = {
  localnet: 'http://dws.local.jejunetwork.org',
  testnet: 'https://dws.testnet.jejunetwork.org',
  mainnet: 'https://dws.jejunetwork.org',
} as const

export function getDwsUrl(): string {
  if (typeof window === 'undefined') {
    return DWS_URLS.localnet
  }
  const hostname = window.location.hostname
  if (hostname.includes('local.')) {
    return DWS_URLS.localnet
  }
  if (hostname.includes('testnet')) {
    return DWS_URLS.testnet
  }
  if (
    hostname === 'factory.jejunetwork.org' ||
    hostname === 'factory.jejunetwork.org'
  ) {
    return DWS_URLS.mainnet
  }
  return DWS_URLS.localnet
}

function getNetwork(): NetworkType {
  if (typeof window === 'undefined') return 'localnet'
  const hostname = window.location.hostname
  if (hostname.includes('testnet')) return 'testnet'
  if (
    hostname === 'factory.jejunetwork.org' ||
    hostname === 'factory.jejunetwork.org'
  )
    return 'mainnet'
  return 'localnet'
}

// Map of contract keys to their location in the CONTRACTS structure
type ContractCategory =
  | 'registry'
  | 'security'
  | 'work'
  | 'dws'
  | 'nodeStaking'
  | 'payments'
  | 'governance'
  | 'compute'

type ContractMapping = {
  category: ContractCategory
  name: string
}

const CONTRACT_KEY_MAP: Record<string, ContractMapping> = {
  // Registry contracts
  IDENTITY_REGISTRY: { category: 'registry', name: 'identity' },
  REPUTATION_REGISTRY: { category: 'registry', name: 'reputation' },
  VALIDATION_REGISTRY: { category: 'registry', name: 'validation' },
  TOKEN_REGISTRY: { category: 'registry', name: 'token' },
  identityRegistry: { category: 'registry', name: 'identity' },
  reputationRegistry: { category: 'registry', name: 'reputation' },
  validationRegistry: { category: 'registry', name: 'validation' },
  tokenRegistry: { category: 'registry', name: 'token' },

  // Security contracts (SecurityBountyRegistry - for bug bounties)
  SECURITY_BOUNTY_REGISTRY: { category: 'security', name: 'bountyRegistry' },
  securityBountyRegistry: { category: 'security', name: 'bountyRegistry' },

  // Work contracts (BountyRegistry - for general task bounties with escrow)
  BOUNTY_REGISTRY: { category: 'work', name: 'workBountyRegistry' },
  WORK_BOUNTY_REGISTRY: { category: 'work', name: 'workBountyRegistry' },
  bountyRegistry: { category: 'work', name: 'workBountyRegistry' },
  workBountyRegistry: { category: 'work', name: 'workBountyRegistry' },

  // DWS contracts
  STORAGE_MANAGER: { category: 'dws', name: 'storageManager' },
  WORKER_REGISTRY: { category: 'dws', name: 'workerRegistry' },
  CDN_REGISTRY: { category: 'dws', name: 'cdnRegistry' },
  REPO_REGISTRY: { category: 'dws', name: 'repoRegistry' },
  PACKAGE_REGISTRY: { category: 'dws', name: 'packageRegistry' },
  CONTAINER_REGISTRY: { category: 'dws', name: 'containerRegistry' },
  GIT_REGISTRY: { category: 'dws', name: 'gitRegistry' },
  storageManager: { category: 'dws', name: 'storageManager' },
  workerRegistry: { category: 'dws', name: 'workerRegistry' },
  cdnRegistry: { category: 'dws', name: 'cdnRegistry' },
  repoRegistry: { category: 'dws', name: 'repoRegistry' },
  packageRegistry: { category: 'dws', name: 'packageRegistry' },
  containerRegistry: { category: 'dws', name: 'containerRegistry' },
  gitRegistry: { category: 'dws', name: 'gitRegistry' },

  // Governance contracts
  DAO_REGISTRY: { category: 'governance', name: 'daoRegistry' },
  daoRegistry: { category: 'governance', name: 'daoRegistry' },
  daoFunding: { category: 'governance', name: 'daoFunding' },
  registryGovernance: { category: 'governance', name: 'registryGovernance' },

  // Compute contracts
  COMPUTE_REGISTRY: { category: 'compute', name: 'registry' },
  computeRegistry: { category: 'compute', name: 'registry' },
  inferenceServing: { category: 'compute', name: 'inferenceServing' },

  // Legacy mappings for backwards compatibility
  CONTRIBUTOR_REGISTRY: { category: 'registry', name: 'validation' },
  contributorRegistry: { category: 'registry', name: 'validation' },
}

function getNetworkAddress(key: string, network: NetworkType): string | null {
  const mapping = CONTRACT_KEY_MAP[key]
  if (!mapping) return null

  const networkContracts = CONTRACTS[network]
  const category = networkContracts[
    mapping.category as keyof typeof networkContracts
  ] as Record<string, string> | undefined
  if (!category) return null

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

// Export addresses object for backwards compatibility and easy access
export const addresses = {
  // Registry contracts
  get identityRegistry(): Address {
    return getContractAddressSafe('IDENTITY_REGISTRY') ?? ZERO_ADDRESS
  },
  get reputationRegistry(): Address {
    return getContractAddressSafe('REPUTATION_REGISTRY') ?? ZERO_ADDRESS
  },
  get validationRegistry(): Address {
    return getContractAddressSafe('VALIDATION_REGISTRY') ?? ZERO_ADDRESS
  },
  get contributorRegistry(): Address {
    return getContractAddressSafe('CONTRIBUTOR_REGISTRY') ?? ZERO_ADDRESS
  },

  // Security contracts
  get bountyRegistry(): Address {
    return getContractAddressSafe('BOUNTY_REGISTRY') ?? ZERO_ADDRESS
  },

  // DWS contracts
  get storageManager(): Address {
    return getContractAddressSafe('STORAGE_MANAGER') ?? ZERO_ADDRESS
  },
  get workerRegistry(): Address {
    return getContractAddressSafe('WORKER_REGISTRY') ?? ZERO_ADDRESS
  },
  get cdnRegistry(): Address {
    return getContractAddressSafe('CDN_REGISTRY') ?? ZERO_ADDRESS
  },
  get repoRegistry(): Address {
    return getContractAddressSafe('REPO_REGISTRY') ?? ZERO_ADDRESS
  },
  get packageRegistry(): Address {
    return getContractAddressSafe('PACKAGE_REGISTRY') ?? ZERO_ADDRESS
  },
  get containerRegistry(): Address {
    return getContractAddressSafe('CONTAINER_REGISTRY') ?? ZERO_ADDRESS
  },
  get gitRegistry(): Address {
    return getContractAddressSafe('GIT_REGISTRY') ?? ZERO_ADDRESS
  },

  // Governance contracts
  get daoRegistry(): Address {
    return getContractAddressSafe('DAO_REGISTRY') ?? ZERO_ADDRESS
  },

  // Compute contracts
  get computeRegistry(): Address {
    return getContractAddressSafe('COMPUTE_REGISTRY') ?? ZERO_ADDRESS
  },

  // Legacy/unused (kept for backwards compatibility)
  get deepFundingDistributor(): Address {
    return ZERO_ADDRESS
  },
  get paymentRequestRegistry(): Address {
    return ZERO_ADDRESS
  },
}
