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
  /** Architecture configuration for on-chain deployment */
  architecture?: {
    frontend?: boolean | { outputDir?: string }
    backend?: boolean | { outputDir?: string }
  }
  /** Populated by discoverApps with actual directory name */
  _folderName?: string
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
      name: 'Account #1',
      address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      privateKey:
        '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      role: 'user',
    },
    {
      name: 'Account #2',
      address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      privateKey:
        '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
      role: 'user',
    },
    {
      name: 'Account #3',
      address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
      privateKey:
        '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
      role: 'user',
    },
    {
      name: 'Account #4',
      address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
      privateKey:
        '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
      role: 'operator',
    },
  ],
} as const

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
  cql: CONFIG_INFRA_PORTS.CQL.DEFAULT,
  oracle: 4301,
  jns: 4302,
  ipfs: CONFIG_CORE_PORTS.IPFS_API.DEFAULT,
} as const

export const CHAIN_CONFIG = {
  localnet: {
    chainId: 1337,
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
