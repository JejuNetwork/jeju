/**
 * DWS (Decentralized Web Services) Client
 *
 * Fully decentralized integration with DWS:
 * - Node discovery via ERC-8004 IdentityRegistry
 * - Automatic failover to healthy nodes
 * - Wallet-authenticated requests
 */

import { getCoreAppUrl } from '@jejunetwork/config/ports'
import { type Address, createPublicClient, http } from 'viem'

const DWS_TAG = 'dws'
const FALLBACK_DWS_URL = process.env.DWS_URL || getCoreAppUrl('DWS_API')

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'getAgentsByTag',
    type: 'function',
    inputs: [{ name: 'tag', type: 'string' }],
    outputs: [{ name: 'agentIds', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getA2AEndpoint',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'endpoint', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'getAgent',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'owner', type: 'address' },
          { name: 'tier', type: 'uint8' },
          { name: 'stakedToken', type: 'address' },
          { name: 'stakedAmount', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastActivityAt', type: 'uint256' },
          { name: 'isBanned', type: 'bool' },
          { name: 'isSlashed', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

export interface DWSNode {
  agentId: bigint
  endpoint: string
  stake: bigint
  isBanned: boolean
  latency?: number
  capabilities: string[]
}

export interface Repository {
  id: string
  name: string
  description?: string
  owner: string
  isPrivate: boolean
  defaultBranch: string
  stars: number
  forks: number
  openIssues: number
  openPRs: number
  cloneUrl: string
  sshUrl: string
  createdAt: number
  updatedAt: number
}

export interface Package {
  name: string
  version: string
  description?: string
  author: string
  license: string
  downloads: number
  dependencies?: Record<string, string>
  publishedAt: number
}

class DecentralizedDWSClient {
  private publicClient: ReturnType<typeof createPublicClient> | null = null
  private registryAddress: Address | null = null
  private nodes: Map<string, DWSNode> = new Map()
  private lastNodeRefresh = 0
  private nodeRefreshInterval = 60000
  private initialized = false

  async initialize(config?: {
    rpcUrl?: string
    identityRegistryAddress?: Address
  }): Promise<void> {
    const rpcUrl =
      config?.rpcUrl || process.env.RPC_URL || 'http://localhost:6546'
    this.registryAddress = (config?.identityRegistryAddress ||
      process.env.IDENTITY_REGISTRY_ADDRESS ||
      '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9') as Address

    this.publicClient = createPublicClient({
      transport: http(rpcUrl),
    })

    await this.discoverNodes()
    this.initialized = true
  }

  async discoverNodes(): Promise<void> {
    if (!this.publicClient || !this.registryAddress) {
      return
    }

    const agentIds = await this.publicClient
      .readContract({
        address: this.registryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'getAgentsByTag',
        args: [DWS_TAG],
      })
      .catch(() => [] as bigint[])

    this.nodes.clear()

    for (const agentId of agentIds) {
      const [agent, endpoint] = (await Promise.all([
        this.publicClient
          .readContract({
            address: this.registryAddress,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: 'getAgent',
            args: [agentId],
          })
          .catch(() => null),
        this.publicClient
          .readContract({
            address: this.registryAddress,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: 'getA2AEndpoint',
            args: [agentId],
          })
          .catch(() => ''),
      ])) as [
        { agentId: bigint; stakedAmount: bigint; isBanned: boolean } | null,
        string,
      ]

      if (agent && endpoint && !agent.isBanned) {
        const start = Date.now()
        const healthy = await this.pingNode(endpoint)

        if (healthy) {
          this.nodes.set(agentId.toString(), {
            agentId,
            endpoint,
            stake: agent.stakedAmount,
            isBanned: agent.isBanned,
            latency: Date.now() - start,
            capabilities: [DWS_TAG],
          })
        }
      }
    }

    this.lastNodeRefresh = Date.now()
  }

  private async pingNode(endpoint: string): Promise<boolean> {
    const response = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)
    return response?.ok ?? false
  }

  async getBestNode(): Promise<string> {
    if (Date.now() - this.lastNodeRefresh > this.nodeRefreshInterval) {
      await this.discoverNodes()
    }

    if (this.nodes.size === 0) {
      return FALLBACK_DWS_URL
    }

    const sorted = Array.from(this.nodes.values()).sort((a, b) => {
      const latencyDiff = (a.latency ?? Infinity) - (b.latency ?? Infinity)
      if (Math.abs(latencyDiff) < 50) {
        return Number(b.stake - a.stake)
      }
      return latencyDiff
    })

    return sorted[0]?.endpoint ?? FALLBACK_DWS_URL
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const baseUrl = await this.getBestNode()
    const url = `${baseUrl}${path}`

    let response = await fetch(url, options).catch(() => null)

    if (!response?.ok && this.nodes.size > 1) {
      const nodes = Array.from(this.nodes.values())
      for (const node of nodes) {
        if (node.endpoint === baseUrl) continue
        const failoverUrl = `${node.endpoint}${path}`
        response = await fetch(failoverUrl, options).catch(() => null)
        if (response?.ok) break
      }
    }

    if (!response?.ok) {
      throw new Error(`DWS request failed: ${path}`)
    }

    return response.json()
  }

  // Git Operations
  async listRepositories(owner?: string): Promise<Repository[]> {
    const params = owner ? `?owner=${owner}` : ''
    return this.request<Repository[]>(`/git/repos${params}`)
  }

  async getRepository(owner: string, name: string): Promise<Repository> {
    return this.request<Repository>(`/git/repos/${owner}/${name}`)
  }

  async createRepository(params: {
    name: string
    description?: string
    isPrivate?: boolean
  }): Promise<Repository> {
    return this.request<Repository>('/git/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
  }

  async getRepoFiles(
    owner: string,
    name: string,
    path = '',
    ref = 'main',
  ): Promise<
    Array<{ path: string; type: 'file' | 'dir'; size?: number; sha: string }>
  > {
    return this.request(
      `/git/repos/${owner}/${name}/contents/${encodeURIComponent(path)}?ref=${ref}`,
    )
  }

  async getFileContent(
    owner: string,
    name: string,
    path: string,
    ref = 'main',
  ): Promise<string> {
    const baseUrl = await this.getBestNode()
    const response = await fetch(
      `${baseUrl}/git/repos/${owner}/${name}/raw/${encodeURIComponent(path)}?ref=${ref}`,
    )
    if (!response.ok) throw new Error('Failed to fetch file content')
    return response.text()
  }

  // Package Operations
  async searchPackages(query: string): Promise<Package[]> {
    return this.request<Package[]>(`/pkg/search?q=${encodeURIComponent(query)}`)
  }

  async getPackage(name: string, version?: string): Promise<Package> {
    const versionPart = version ? `/${version}` : ''
    return this.request<Package>(
      `/pkg/${encodeURIComponent(name)}${versionPart}`,
    )
  }

  async publishPackage(
    tarball: Blob,
    metadata: { name: string; version: string; description?: string },
  ): Promise<Package> {
    const baseUrl = await this.getBestNode()
    const formData = new FormData()
    formData.append('tarball', tarball)
    formData.append('metadata', JSON.stringify(metadata))

    const response = await fetch(`${baseUrl}/pkg`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) throw new Error('Failed to publish package')
    return response.json()
  }

  isInitialized(): boolean {
    return this.initialized
  }
}

export const dwsClient = new DecentralizedDWSClient()
