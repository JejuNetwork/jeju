/**
 * CLI type definitions
 */

import {
  CORE_PORTS as CONFIG_CORE_PORTS,
  INFRA_PORTS as CONFIG_INFRA_PORTS,
} from '@jejunetwork/config'

import type { NetworkType } from '@jejunetwork/types'
export type { NetworkType }

export interface CLIContext {
  network: NetworkType
  verbose: boolean
  ci: boolean
  rootDir: string
  configDir: string
  keysDir: string
}

export interface HealthCheckResult {
  name: string
  status: 'ok' | 'warn' | 'error'
  message: string
  details?: Record<string, string | number | boolean>
}

export interface KeyConfig {
  name: string
  address: string
  privateKey: string
  role?: string
}

export interface KeySet {
  network: NetworkType
  created: string
  keys: KeyConfig[]
  encrypted?: boolean
}

export interface TestPhase {
  name: string
  description: string
  command: string
  cwd?: string
  timeout?: number
  required?: boolean
}

export interface TestResult {
  name: string
  passed: boolean
  duration: number
  skipped?: boolean
  coverage?: number
  output?: string
}

export type TestMode =
  | 'unit'
  | 'integration'
  | 'e2e'
  | 'full'
  | 'infra'
  | 'smoke'

export interface CoverageReport {
  lines: { total: number; covered: number; percent: number }
  functions: { total: number; covered: number; percent: number }
  branches: { total: number; covered: number; percent: number }
  deadCode?: string[]
}

export interface DeploymentConfig {
  network: NetworkType
  contracts: boolean
  infrastructure: boolean
  apps: boolean
  dryRun: boolean
}

export interface AppTestConfig {
  unit?: {
    command?: string
    timeout?: number
  }
  e2e?: {
    command?: string
    config?: string
    timeout?: number
    requiresChain?: boolean
    requiresWallet?: boolean
  }
  integration?: {
    command?: string
    timeout?: number
    requiresChain?: boolean
    requiresServices?: boolean | string[]
  }
  services?: string[]
}

export interface AppManifest {
  name: string
  displayName?: string
  slug?: string // Folder name for path lookup
  version: string
  type: 'core' | 'vendor' | 'service' | 'app' | 'utility'
  description?: string
  commands?: {
    dev?: string
    build?: string
    test?: string
    start?: string
  }
  ports?: Record<string, number>
  dependencies?: string[] | Record<string, string | string[]>
  enabled?: boolean
  autoStart?: boolean
  tags?: string[]
  testing?: AppTestConfig
  /** JNS configuration for on-chain deployment */
  jns?: {
    name?: string
    description?: string
    url?: string
  }
  /** Architecture configuration for on-chain deployment */
  architecture?: {
    frontend?: boolean | { outputDir?: string }
    backend?: boolean | { outputDir?: string }
  }
  /** Decentralization configuration */
  decentralization?: {
    frontend?: {
      buildDir?: string
      jnsName?: string
      ipfs?: boolean
      arweave?: boolean
      spa?: boolean
      fallbackOrigins?: string[]
    }
    cdn?: {
      enabled?: boolean
      regions?: string[]
      cacheRules?: Array<{
        pattern: string
        ttl: number
        staleWhileRevalidate?: number
        immutable?: boolean
      }>
      apiCaching?: {
        enabled?: boolean
        defaultTtl?: number
        varyHeaders?: string[]
      }
      serviceWorker?: boolean
    }
  }
  /** Populated by discoverApps with actual directory name */
  _folderName?: string
  /** DAO governance configuration */
  dao?: DAOConfig
  /** Default environment variables for the app */
  defaultEnv?: Record<string, string>
  /** DWS deployment configuration */
  dws?: {
    frontend?: { outputDir?: string }
    backend?: { outputDir?: string }
  }
}

// ============ DAO Configuration Types ============

/** Director/Leader persona for DAO governance */
export interface DAODirectorConfig {
  name: string
  description: string
  personality: string
  traits: string[]
  voiceStyle?: string
  communicationTone?: string
  specialties?: string[]
  pfpCid?: string
}

/** Board member definition */
export interface DAOBoardMember {
  role: string
  description: string
  weight: number
  /** Address override for production - localnet uses anvil wallets */
  address?: string
  /** Agent ID if board member is an AI agent */
  agentId?: number
}

/** Governance parameters */
export interface DAOGovernanceParams {
  minQualityScore: number
  boardVotingPeriod: number
  gracePeriod: number
  minProposalStake: string
  quorumBps: number
}

/** Funding pool configuration */
export interface DAOFundingConfig {
  minStake: string
  maxStake: string
  epochDuration: number
  cooldownPeriod: number
  matchingMultiplier: number
  quadraticEnabled: boolean
  directorWeightCap: number
}

/** Fee category for DAO-controlled fees */
export interface DAOFeeCategory {
  description: string
  defaultBps: number
}

/** Fee configuration for DAO */
export interface DAOFeeConfig {
  type: 'protocol' | 'game' | 'service'
  controller: string
  categories: Record<string, DAOFeeCategory>
}

/** Package to seed into DAO funding */
export interface DAOSeededPackage {
  name: string
  description: string
  registry: 'npm' | 'foundry' | 'cargo' | 'pypi'
  fundingWeight: number
}

/** Repository to seed into DAO funding */
export interface DAOSeededRepo {
  name: string
  url: string
  description: string
  fundingWeight: number
}

/** DAO-to-DAO allocation for hierarchies and peer sharing */
export interface DAOAllocation {
  /** Target DAO identifier */
  targetDao: string
  /** Allocation type */
  type: 'deep-funding' | 'fee-share' | 'recurring' | 'one-time'
  /** Allocation amount in basis points (for fee-share) or wei (for payments) */
  amount: string
  /** Description of allocation purpose */
  description?: string
}

/** Network-specific deployment configuration */
export interface DAONetworkDeployment {
  autoSeed: boolean
  fundTreasury?: string
  fundMatching?: string
  requiresMultisig?: boolean
  /** Parent DAO to register under (for hierarchies) */
  parentDao?: string
  /** Peer DAOs to establish allocations with */
  peerAllocations?: DAOAllocation[]
}

/** Full DAO configuration in manifest */
export interface DAOConfig {
  /** Governance configuration */
  governance: {
    director: DAODirectorConfig
    board: {
      members: DAOBoardMember[]
    }
    parameters: DAOGovernanceParams
  }
  /** Funding pool configuration */
  funding: DAOFundingConfig
  /** Fee configuration */
  fees?: DAOFeeConfig
  /** Packages to seed */
  packages?: {
    seeded: DAOSeededPackage[]
  }
  /** Repositories to seed */
  repos?: {
    seeded: DAOSeededRepo[]
  }
  /** Network-specific deployment settings */
  deployment?: {
    localnet?: DAONetworkDeployment
    testnet?: DAONetworkDeployment
    mainnet?: DAONetworkDeployment
  }
}

/** Result of DAO deployment */
export interface DAODeploymentResult {
  network: NetworkType
  daoId: string
  name: string
  manifestCid: string
  contracts: {
    daoRegistry: string
    daoFunding: string
    board: string | null
    directorAgent: string
    treasury: string
    feeConfig?: string
  }
  board: {
    members: Array<{
      role: string
      address: string
      agentId: number
    }>
  }
  packageIds: string[]
  repoIds: string[]
  allocations?: DAOAllocation[]
  timestamp: number
  deployer: string
}

export const WELL_KNOWN_KEYS = {
  /** Anvil default accounts - prefunded with 10k ETH */
  dev: [
    {
      name: 'Account #0 (Deployer)',
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      privateKey:
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      role: 'deployer',
    },
    {
      name: 'Account #1 (Treasury Guardian)',
      address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      privateKey:
        '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      role: 'board-treasury',
    },
    {
      name: 'Account #2 (Code Guardian)',
      address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      privateKey:
        '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
      role: 'board-code',
    },
    {
      name: 'Account #3 (Community Guardian)',
      address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
      privateKey:
        '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
      role: 'board-community',
    },
    {
      name: 'Account #4 (Security Guardian)',
      address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
      privateKey:
        '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
      role: 'board-security',
    },
    {
      name: 'Account #5 (Director Agent)',
      address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
      privateKey:
        '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
      role: 'director-agent',
    },
    {
      name: 'Account #6 (User)',
      address: '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
      privateKey:
        '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
      role: 'user',
    },
    {
      name: 'Account #7 (User)',
      address: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
      privateKey:
        '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
      role: 'user',
    },
  ],
} as const

/** Get board member addresses for localnet from anvil wallets */
export function getDevBoardAddresses(): Record<string, string> {
  return {
    'Treasury Guardian': WELL_KNOWN_KEYS.dev[1].address,
    'Code Guardian': WELL_KNOWN_KEYS.dev[2].address,
    'Community Guardian': WELL_KNOWN_KEYS.dev[3].address,
    'Security Guardian': WELL_KNOWN_KEYS.dev[4].address,
  }
}

/** Get Director agent address for localnet */
export function getDevDirectorAddress(): string {
  return WELL_KNOWN_KEYS.dev[5].address
}

export const DEFAULT_PORTS = {
  l1Rpc: CONFIG_INFRA_PORTS.L1_RPC.DEFAULT,
  l2Rpc: CONFIG_INFRA_PORTS.L2_RPC.DEFAULT,
  l2Ws: CONFIG_INFRA_PORTS.L2_WS.DEFAULT,
  gateway: CONFIG_CORE_PORTS.GATEWAY.DEFAULT,
  bazaar: CONFIG_CORE_PORTS.BAZAAR.DEFAULT,
  compute: CONFIG_CORE_PORTS.COMPUTE.DEFAULT,
  wallet: 4015,
  indexerGraphQL: CONFIG_CORE_PORTS.INDEXER_GRAPHQL.DEFAULT,
  prometheus: CONFIG_INFRA_PORTS.PROMETHEUS.DEFAULT,
  grafana: CONFIG_INFRA_PORTS.GRAFANA.DEFAULT,
  kurtosisUI: CONFIG_INFRA_PORTS.KURTOSIS_UI.DEFAULT,
  inference: 4100,
  storage: 4101,
  cron: 4102,
  cvm: 4103,
  sqlit: CONFIG_INFRA_PORTS.SQLit.DEFAULT,
  oracle: 4301,
  jns: 4302,
  ipfs: CONFIG_CORE_PORTS.IPFS_API.DEFAULT,
  dws: CONFIG_CORE_PORTS.DWS_API.DEFAULT,
} as const

export const CHAIN_CONFIG = {
  localnet: {
    chainId: 31337,
    name: 'Network Localnet',
    rpcUrl: `http://127.0.0.1:${CONFIG_INFRA_PORTS.L2_RPC.DEFAULT}`,
  },
  testnet: {
    chainId: 420691,
    name: 'Testnet',
    rpcUrl: 'https://testnet-rpc.jejunetwork.org',
  },
  mainnet: {
    chainId: 42069,
    name: 'Network',
    rpcUrl: 'https://rpc.jejunetwork.org',
  },
} as const

export const DOMAIN_CONFIG = {
  domain: 'jejunetwork.org',
  localDomain: 'local.jejunetwork.org',
  local: {
    gateway: 'http://gateway.local.jejunetwork.org:8080',
    bazaar: 'http://bazaar.local.jejunetwork.org:8080',
    docs: 'http://docs.local.jejunetwork.org:8080',
    indexer: 'http://indexer.local.jejunetwork.org:8080',
    rpc: 'http://rpc.local.jejunetwork.org:8080',
    crucible: 'http://crucible.local.jejunetwork.org:8080',
  },
  testnet: {
    gateway: 'https://gateway.testnet.jejunetwork.org',
    bazaar: 'https://bazaar.testnet.jejunetwork.org',
    docs: 'https://docs.testnet.jejunetwork.org',
    rpc: 'https://testnet-rpc.jejunetwork.org',
    ws: 'wss://testnet-ws.jejunetwork.org',
    indexer: 'https://testnet-indexer.jejunetwork.org',
  },
  mainnet: {
    gateway: 'https://gateway.jejunetwork.org',
    bazaar: 'https://bazaar.jejunetwork.org',
    docs: 'https://docs.jejunetwork.org',
    rpc: 'https://rpc.jejunetwork.org',
    ws: 'wss://ws.jejunetwork.org',
    indexer: 'https://indexer.jejunetwork.org',
  },
} as const
