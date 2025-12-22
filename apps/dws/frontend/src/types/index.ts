import type { Address } from 'viem'

export type ViewMode = 'consumer' | 'provider'

export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy'
  service: string
  version: string
  uptime: number
}

export interface DWSHealth {
  status: string
  service: string
  version: string
  uptime: number
  decentralized: {
    identityRegistry: Address
    registeredNodes: number
    connectedPeers: number
    frontendCid: string
    p2pEnabled: boolean
  }
  services: Record<string, { status: string }>
  backends: {
    available: string[]
    health: Record<string, boolean>
  }
}

export interface Container {
  executionId: string
  instanceId: string
  image: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  submittedAt: number
  startedAt: number | null
  metrics?: {
    durationMs: number
    wasColdStart: boolean
    cpuUsed: number
    memoryUsedMb: number
  }
}

export interface WorkerFunction {
  id: string
  name: string
  owner: Address
  runtime: 'bun' | 'node' | 'deno'
  handler: string
  codeCid: string
  memory: number
  timeout: number
  status: 'active' | 'inactive'
  version: number
  invocationCount: number
  avgDurationMs: number
  errorCount: number
  createdAt: number
  updatedAt: number
}

export interface ComputeJob {
  jobId: string
  command: string
  shell: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  output: string
  exitCode: number | null
  startedAt: number | null
  completedAt: number | null
  duration: number | null
}

export interface StorageBucket {
  name: string
  owner: Address
  region: string
  createdAt: number
  objectCount: number
  totalSize: number
  visibility: 'public' | 'private'
}

export interface StorageObject {
  key: string
  cid: string
  size: number
  contentType: string
  uploadedAt: number
  metadata: Record<string, string>
}

export interface Repository {
  repoId: string
  owner: Address
  name: string
  description: string
  visibility: 'public' | 'private'
  starCount: number
  forkCount: number
  createdAt: number
  updatedAt: number
  archived: boolean
  cloneUrl: string
}

export interface Package {
  id: string
  name: string
  version: string
  owner: Address
  description: string
  downloads: number
  createdAt: number
  updatedAt: number
  cid: string
}

export interface CIPipeline {
  id: string
  name: string
  repoId: string
  status: 'pending' | 'running' | 'success' | 'failed'
  triggeredAt: number
  completedAt: number | null
  steps: CIStep[]
}

export interface CIStep {
  name: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  durationMs: number | null
  output: string
}

export interface KMSKey {
  keyId: string
  publicKey: string
  address: Address
  threshold: number
  totalParties: number
  version: number
  createdAt: number
}

export interface Secret {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  expiresAt: number | null
}

export interface VPNSession {
  sessionId: string
  status: 'active' | 'expired' | 'terminated'
  startedAt: number
  expiresAt: number
  bytesTransferred: number
  requestCount: number
  proxy: {
    host: string
    port: number
    protocol: string
    region: string
    country: string
  }
}

export interface RPCChain {
  chainId: number
  name: string
  network: string
  symbol: string
  explorerUrl: string
  isTestnet: boolean
  providers: number
  avgLatency: number | null
}

export interface APIListing {
  id: string
  providerId: string
  seller: Address
  pricePerRequest: string
  active: boolean
  totalRequests: string
  totalRevenue: string
  rating: number
  createdAt: number
}

export interface APIProvider {
  id: string
  name: string
  description: string
  categories: string[]
  defaultPricePerRequest: string
  supportsStreaming: boolean
  configured: boolean
}

export interface TrainingRun {
  runId: string
  model: string
  state: number
  clients: number
  step: number
  totalSteps: number
  createdAt: number
}

export interface ComputeNode {
  id: string
  address: Address
  region: string
  zone: string
  status: 'online' | 'offline' | 'maintenance'
  resources: {
    totalCpu: number
    availableCpu: number
    totalMemoryMb: number
    availableMemoryMb: number
  }
  containers: number
  cachedImages: number
  reputation: number
  lastHeartbeat: number
}

export interface UserAccount {
  address: Address
  balance: string
  totalSpent: string
  totalRequests: string
  tier: 'free' | 'standard' | 'premium'
  agentId: number | null
  isBanned: boolean
}

export interface UsageStats {
  period: string
  compute: {
    jobs: number
    containerRuns: number
    workerInvocations: number
    cost: string
  }
  storage: {
    uploads: number
    downloads: number
    storedBytes: number
    cost: string
  }
  network: { rpcRequests: number; vpnSessions: number; cost: string }
  ai: { inferences: number; embeddings: number; cost: string }
  total: string
}

export interface ProviderStats {
  earnings: string
  pendingPayouts: string
  totalServed: number
  uptime: number
  reputation: number
  nodes: number
  activeListings: number
}
