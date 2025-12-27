/** DWS Client */

import { getContract, getDWSUrl, getRpcUrl } from '@jejunetwork/config'
import { identityRegistryAbi } from '@jejunetwork/contracts'
import { isValidAddress } from '@jejunetwork/types'
import { type Address, createPublicClient, http } from 'viem'

const DWS_TAG = 'dws'
const FALLBACK_DWS_URL = process.env.DWS_URL || getDWSUrl()

const ZERO_ADDR: Address = '0x0000000000000000000000000000000000000000'

function getRegistryAddress(configAddress?: Address): Address {
  if (configAddress) return configAddress
  const envAddress = process.env.IDENTITY_REGISTRY_ADDRESS
  if (envAddress && isValidAddress(envAddress)) return envAddress
  return (getContract('registry', 'identity') || ZERO_ADDR) as Address
}

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

class DWSClient {
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
    const rpcUrl = config?.rpcUrl ?? process.env.RPC_URL ?? getRpcUrl()
    this.registryAddress = getRegistryAddress(config?.identityRegistryAddress)

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

    const agentIds = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: identityRegistryAbi,
      functionName: 'getAgentsByTag',
      args: [DWS_TAG],
    })

    this.nodes.clear()

    for (const agentId of agentIds) {
      const agentResult = await this.publicClient.readContract({
        address: this.registryAddress,
        abi: identityRegistryAbi,
        functionName: 'getAgent',
        args: [agentId],
      })

      const endpoint = await this.publicClient.readContract({
        address: this.registryAddress,
        abi: identityRegistryAbi,
        functionName: 'getA2AEndpoint',
        args: [agentId],
      })

      if (agentResult && endpoint && !agentResult.isBanned) {
        const start = Date.now()
        const healthy = await this.pingNode(endpoint)

        if (healthy) {
          this.nodes.set(agentId.toString(), {
            agentId,
            endpoint,
            stake: agentResult.stakedAmount,
            isBanned: agentResult.isBanned,
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
    })
    return response.ok
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

    return sorted[0].endpoint ?? FALLBACK_DWS_URL
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const baseUrl = await this.getBestNode()
    const url = `${baseUrl}${path}`

    const response = await fetch(url, options)

    if (!response.ok) {
      throw new Error(`DWS request failed: ${path}`)
    }

    return response.json()
  }

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

  async getRepoCommits(
    owner: string,
    name: string,
    ref = 'main',
  ): Promise<
    Array<{
      sha: string
      message: string
      author: string
      authorEmail: string
      date: number
    }>
  > {
    return this.request(`/git/repos/${owner}/${name}/commits?ref=${ref}`)
  }

  async getRepoBranches(
    owner: string,
    name: string,
  ): Promise<
    Array<{
      name: string
      sha: string
      isDefault: boolean
      isProtected: boolean
    }>
  > {
    return this.request(`/git/repos/${owner}/${name}/branches`)
  }

  async starRepository(owner: string, name: string): Promise<void> {
    await this.request(`/git/repos/${owner}/${name}/star`, { method: 'POST' })
  }

  async forkRepository(
    owner: string,
    name: string,
    newOwner: string,
  ): Promise<Repository> {
    return this.request<Repository>(`/git/repos/${owner}/${name}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newOwner }),
    })
  }

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

  async inference(params: {
    modelId: string
    prompt: string
    maxTokens?: number
    temperature?: number
  }): Promise<{
    output: string
    usage: { promptTokens: number; completionTokens: number }
    model: string
    temperature: number
  }> {
    const response = await this.request<{
      output: string
      usage: { promptTokens: number; completionTokens: number }
      model: string
      temperature: number
    }>('/inference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: params.modelId,
        prompt: params.prompt,
        max_tokens: params.maxTokens ?? 256,
        temperature: params.temperature ?? 0.7,
      }),
    })
    return response
  }
}

export const dwsClient = new DWSClient()
export const dwsService = dwsClient
