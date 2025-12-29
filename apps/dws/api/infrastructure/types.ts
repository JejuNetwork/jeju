import {
  getIpfsApiUrl,
  getIpfsGatewayUrl,
  getL1RpcUrl,
} from '@jejunetwork/config'
import type { Address, Hex } from 'viem'

// Node Types - What capabilities a DWS node can provide

export type NodeCapability =
  | 'compute' // Can run workers/containers
  | 'storage' // Can store data (IPFS pin)
  | 'cdn' // Can serve cached content
  | 'gpu' // Has GPU for ML/training
  | 'tee' // Has TEE (Intel SGX/TDX, AMD SEV)
  | 'high-memory' // Has >64GB RAM
  | 'high-cpu' // Has >16 cores
  | 'ssd' // Has fast SSD storage
  | 'bandwidth' // Has high bandwidth (>1Gbps)
  | 'eqlite-bp' // EQLite Block Producer
  | 'eqlite-miner' // EQLite Miner (SQL storage)

export type TEEPlatform = 'intel_sgx' | 'intel_tdx' | 'amd_sev' | 'none'

export interface NodeSpecs {
  cpuCores: number
  memoryMb: number
  storageMb: number
  gpuType?: string
  gpuCount?: number
  gpuVramMb?: number
  bandwidthMbps: number
  teePlatform: TEEPlatform
}

export interface NodeConfig {
  // Identity
  agentId: bigint
  owner: Address
  endpoint: string

  // Registration
  registeredAt: number
  lastHeartbeat: number
  version: string

  // Capabilities
  capabilities: NodeCapability[]
  specs: NodeSpecs

  // Economics
  stakedAmount: bigint
  stakedToken: Address
  pricePerHour: bigint // In wei, for compute
  pricePerGb: bigint // In wei, for storage
  pricePerRequest: bigint // In wei, for x402

  // Status
  status: 'online' | 'busy' | 'draining' | 'offline'
  reputation: number // 0-100
  isBanned: boolean
  isSlashed: boolean

  // TEE Attestation
  attestation?: {
    quote: Hex
    measurement: Hex
    verifiedAt: number
    expiresAt: number
  }

  // Proof-of-Cloud Status
  pocStatus?: {
    /** Whether the node is verified in the cloud alliance registry */
    verified: boolean
    /** PoC verification level (1=human-supervised, 2=automated, 3=continuous) */
    level: 1 | 2 | 3 | null
    /** Salted hash of hardware ID */
    hardwareIdHash: Hex | null
    /** Cloud provider (e.g., "aws", "gcp", "azure") */
    cloudProvider: string | null
    /** Data center region */
    region: string | null
    /** Timestamp of last verification */
    lastVerifiedAt: number | null
    /** Verification expiry timestamp */
    expiresAt: number | null
    /** PoC reputation score (0-100) */
    score: number
  }

  // Current load
  activeWorkers: number
  activeJobs: number
  cpuUsage: number
  memoryUsage: number

  // EQLite-specific config (for eqlite-bp and eqlite-miner capabilities)
  eqlite?: {
    nodeId: Hex // EQLite NodeID (32 bytes)
    role: 'block_producer' | 'miner'
    rpcEndpoint: string // EQLite RPC endpoint
    p2pPort: number
    databaseCount?: number // For miners: number of hosted databases
    totalQueries?: number // Lifetime query count
    registryNodeId?: Hex // On-chain EQLiteRegistry node ID
  }
}

// Worker Types - What users deploy

export interface WorkerConfig {
  id: string
  name: string
  owner: Address

  // Code
  code: {
    cid: string // IPFS CID
    hash: Hex // Keccak256 of code
    entrypoint: string // Main file
    runtime: 'workerd' | 'bun' | 'docker'
  }

  // Resources
  resources: {
    memoryMb: number
    cpuMillis: number
    timeoutMs: number
    maxConcurrency: number
  }

  // Scaling
  scaling: {
    minInstances: number
    maxInstances: number
    targetConcurrency: number
    scaleToZero: boolean
    cooldownMs: number
  }

  // Requirements
  requirements: {
    teeRequired: boolean
    teePlatform?: TEEPlatform
    gpuRequired: boolean
    gpuType?: string
    regions?: string[]
    minNodeReputation?: number
    minNodeStake?: bigint
  }

  // Economics
  payment: {
    type: 'x402' | 'prepaid' | 'staked'
    budgetWei?: bigint
    maxPricePerRequest?: bigint
  }

  // Environment
  env: Record<string, string>
  secrets: string[] // KMS secret IDs
}

export interface DeployedWorker extends WorkerConfig {
  // Deployment state
  status:
    | 'pending'
    | 'deploying'
    | 'active'
    | 'scaling'
    | 'draining'
    | 'stopped'
    | 'failed'
  deployedAt: number
  updatedAt: number

  // Active instances
  instances: WorkerInstance[]

  // Metrics
  metrics: {
    totalInvocations: number
    totalErrors: number
    avgLatencyMs: number
    p95LatencyMs: number
    coldStarts: number
    totalCostWei: bigint
  }

  // On-chain registration
  onChain?: {
    workerId: bigint
    txHash: Hex
    registeredAt: number
  }
}

export interface WorkerInstance {
  id: string
  workerId: string
  nodeAgentId: bigint
  nodeEndpoint: string
  status: 'starting' | 'warm' | 'busy' | 'draining' | 'stopped'
  startedAt: number
  lastRequestAt: number
  activeRequests: number
  totalRequests: number
  errors: number
}

// Job Types - Long-running compute tasks

export interface JobConfig {
  id: string
  owner: Address

  // What to run
  image: string // Container image or IPFS CID
  command: string[]
  args: string[]
  env: Record<string, string>

  // Input/Output
  inputCid?: string
  outputPath?: string

  // Resources
  resources: {
    cpuCores: number
    memoryMb: number
    gpuType?: string
    gpuCount?: number
    timeoutMs: number
  }

  // Requirements
  requirements: {
    teeRequired: boolean
    teePlatform?: TEEPlatform
    minNodeReputation?: number
    minNodeStake?: bigint
  }

  // Payment
  payment: {
    maxBudgetWei: bigint
    token: Address
  }
}

export interface JobResult {
  id: string
  status:
    | 'pending'
    | 'assigned'
    | 'running'
    | 'completed'
    | 'failed'
    | 'timeout'

  // Assignment
  nodeAgentId?: bigint
  nodeEndpoint?: string

  // Timing
  submittedAt: number
  startedAt?: number
  completedAt?: number

  // Results
  exitCode?: number
  outputCid?: string
  logs?: string
  error?: string

  // TEE attestation
  attestation?: {
    quote: Hex
    measurement: Hex
    outputHash: Hex
    signature: Hex
  }

  // Cost
  costWei?: bigint
  txHash?: Hex
}

// Request Routing

export interface RoutingConfig {
  // How to select nodes
  strategy: 'latency' | 'round-robin' | 'stake-weighted' | 'reputation' | 'cost'

  // Filters
  requiredCapabilities: NodeCapability[]
  minReputation: number
  minStake: bigint
  preferredRegions: string[]
  excludeNodes: bigint[]

  // TEE requirements
  teeRequired: boolean
  teePlatform?: TEEPlatform
  verifyAttestation: boolean

  // Failover
  retryCount: number
  retryDelayMs: number
  failoverToAnyNode: boolean
}

export interface RouteResult {
  nodeAgentId: bigint
  nodeEndpoint: string
  latencyMs: number
  reputation: number
  stake: bigint
  attestationValid: boolean
}

// Economics

export interface PaymentConfig {
  // For x402
  x402: {
    enabled: boolean
    endpoint: string
    facilitatorAddress: Address
    defaultToken: Address
  }

  // For staking
  staking: {
    enabled: boolean
    minStake: bigint
    slashingEnabled: boolean
    slashingPercentage: number
  }

  // For prepaid
  prepaid: {
    enabled: boolean
    vaultAddress: Address
  }
}

export interface InvokePayment {
  type: 'x402' | 'prepaid' | 'free'

  // x402
  x402Header?: string

  // Prepaid
  prepaidVaultId?: string

  // Cost tracking
  estimatedCostWei: bigint
  actualCostWei?: bigint
}

// Network Configuration

export type NetworkEnvironment = 'localnet' | 'testnet' | 'mainnet'

export interface NetworkConfig {
  environment: NetworkEnvironment

  // Chain
  chainId: number
  rpcUrl: string

  // Contracts
  contracts: {
    identityRegistry: Address
    workerRegistry: Address
    paymentVault: Address
    x402Facilitator: Address
    stakingManager: Address
  }

  // Storage
  ipfs: {
    gateway: string
    apiUrl?: string
    pinningService?: string
  }

  // P2P
  p2p: {
    bootstrapNodes: string[]
    announceAddress?: string
  }

  // TEE
  tee: {
    collateralServiceUrl?: string
    allowedPlatforms: TEEPlatform[]
  }
}

export const NETWORK_CONFIGS: Record<NetworkEnvironment, NetworkConfig> = {
  localnet: {
    environment: 'localnet',
    chainId: 31337,
    rpcUrl: getL1RpcUrl(),
    contracts: {
      identityRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      workerRegistry: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
      paymentVault: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
      x402Facilitator: '0x0000000000000000000000000000000000000000',
      stakingManager: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    },
    ipfs: {
      gateway: getIpfsGatewayUrl(),
      apiUrl: getIpfsApiUrl(),
    },
    p2p: {
      bootstrapNodes: [],
    },
    tee: {
      allowedPlatforms: ['none'], // Allow non-TEE in localnet
    },
  },

  testnet: {
    environment: 'testnet',
    chainId: 84532, // Base Sepolia
    rpcUrl: 'https://sepolia.base.org',
    contracts: {
      identityRegistry: '0xaB3C2C6A93A88B8dC50a0C3C1DFd2d3bE0a62311',
      workerRegistry: '0x0000000000000000000000000000000000000000', // TBD
      paymentVault: '0x0000000000000000000000000000000000000000',
      x402Facilitator: '0x0000000000000000000000000000000000000000',
      stakingManager: '0x0000000000000000000000000000000000000000',
    },
    ipfs: {
      gateway: 'https://ipfs.io',
      pinningService: 'https://api.pinata.cloud',
    },
    p2p: {
      bootstrapNodes: [
        '/dns4/boot.testnet.jejunetwork.org/tcp/4001/p2p/12D3KooW...',
      ],
    },
    tee: {
      collateralServiceUrl: 'https://tee.testnet.jejunetwork.org',
      allowedPlatforms: ['intel_tdx', 'amd_sev', 'none'],
    },
  },

  mainnet: {
    environment: 'mainnet',
    chainId: 8453, // Base
    rpcUrl: 'https://mainnet.base.org',
    contracts: {
      identityRegistry: '0x0000000000000000000000000000000000000000', // TBD
      workerRegistry: '0x0000000000000000000000000000000000000000',
      paymentVault: '0x0000000000000000000000000000000000000000',
      x402Facilitator: '0x0000000000000000000000000000000000000000',
      stakingManager: '0x0000000000000000000000000000000000000000',
    },
    ipfs: {
      gateway: 'https://ipfs.io',
      pinningService: 'https://api.pinata.cloud',
    },
    p2p: {
      bootstrapNodes: ['/dns4/boot.jejunetwork.org/tcp/4001/p2p/12D3KooW...'],
    },
    tee: {
      collateralServiceUrl: 'https://tee.jejunetwork.org',
      allowedPlatforms: ['intel_tdx', 'amd_sev'], // No 'none' in mainnet
    },
  },
}

// Events - For P2P gossip and on-chain events

export type InfraEvent =
  | {
      type: 'node:registered'
      nodeAgentId: bigint
      endpoint: string
      capabilities: NodeCapability[]
    }
  | { type: 'node:offline'; nodeAgentId: bigint }
  | {
      type: 'node:slashed'
      nodeAgentId: bigint
      reason: string
      amount: bigint
    }
  | {
      type: 'node:poc_verified'
      nodeAgentId: bigint
      level: 1 | 2 | 3
      cloudProvider: string
      region: string
      hardwareIdHash: Hex
    }
  | {
      type: 'node:poc_failed'
      nodeAgentId: bigint
      reason: string
    }
  | {
      type: 'node:poc_expired'
      nodeAgentId: bigint
      hardwareIdHash: Hex
    }
  | {
      type: 'worker:deployed'
      workerId: string
      owner: Address
      codeCid: string
    }
  | { type: 'worker:scaled'; workerId: string; newInstances: number }
  | { type: 'worker:stopped'; workerId: string }
  | { type: 'job:submitted'; jobId: string; owner: Address }
  | { type: 'job:assigned'; jobId: string; nodeAgentId: bigint }
  | {
      type: 'job:completed'
      jobId: string
      outputCid?: string
      attestation?: Hex
    }
  | { type: 'job:failed'; jobId: string; error: string }
  | {
      type: 'payment:received'
      from: Address
      to: bigint
      amount: bigint
      token: Address
    }

export type InfraEventHandler = (event: InfraEvent) => void | Promise<void>
