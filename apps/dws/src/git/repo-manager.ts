/**
 * Git Repository Manager
 * Manages git repositories with on-chain registry integration
 */

import {
  type Address,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  type Hex,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import type { BackendManager } from '../storage/backends'
import { GitObjectStore } from './object-store'
import { decodeBytes32ToOid, encodeOidToBytes32 } from './oid-utils'
import type {
  Branch,
  ContributionEvent,
  CreateRepoRequest,
  CreateRepoResponse,
  GitRef,
  Repository,
} from './types'

// Type for repository data returned from contract
interface ContractRepoData {
  repoId: Hex
  owner: Address
  agentId: bigint
  name: string
  description: string
  jnsNode: Hex
  headCommitCid: Hex
  metadataCid: Hex
  createdAt: bigint
  updatedAt: bigint
  visibility: number
  archived: boolean
  starCount: bigint
  forkCount: bigint
  forkedFrom: Hex
}

// Type for branch data returned from contract
interface ContractBranchData {
  repoId: Hex
  name: string
  tipCommitCid: Hex
  lastPusher: Address
  updatedAt: bigint
  protected_: boolean
}

// RepoRegistry ABI (subset for our needs)
const REPO_REGISTRY_ABI = [
  // Events
  {
    type: 'event',
    name: 'RepositoryCreated',
    inputs: [
      { name: 'repoId', type: 'bytes32', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
    ],
  },
  // Functions
  {
    name: 'createRepository',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'jnsNode', type: 'bytes32' },
      { name: 'agentId', type: 'uint256' },
      { name: 'visibility', type: 'uint8' },
    ],
    outputs: [{ name: 'repoId', type: 'bytes32' }],
  },
  {
    name: 'pushBranch',
    type: 'function',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'branch', type: 'string' },
      { name: 'newCommitCid', type: 'bytes32' },
      { name: 'expectedOldCid', type: 'bytes32' },
      { name: 'commitCount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'getRepository',
    type: 'function',
    inputs: [{ name: 'repoId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'repoId', type: 'bytes32' },
          { name: 'owner', type: 'address' },
          { name: 'agentId', type: 'uint256' },
          { name: 'name', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'jnsNode', type: 'bytes32' },
          { name: 'headCommitCid', type: 'bytes32' },
          { name: 'metadataCid', type: 'bytes32' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'visibility', type: 'uint8' },
          { name: 'archived', type: 'bool' },
          { name: 'starCount', type: 'uint256' },
          { name: 'forkCount', type: 'uint256' },
          { name: 'forkedFrom', type: 'bytes32' },
        ],
      },
    ],
  },
  {
    name: 'getRepositoryByName',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'name', type: 'string' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'repoId', type: 'bytes32' },
          { name: 'owner', type: 'address' },
          { name: 'agentId', type: 'uint256' },
          { name: 'name', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'jnsNode', type: 'bytes32' },
          { name: 'headCommitCid', type: 'bytes32' },
          { name: 'metadataCid', type: 'bytes32' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'visibility', type: 'uint8' },
          { name: 'archived', type: 'bool' },
          { name: 'starCount', type: 'uint256' },
          { name: 'forkCount', type: 'uint256' },
          { name: 'forkedFrom', type: 'bytes32' },
        ],
      },
    ],
  },
  {
    name: 'getBranch',
    type: 'function',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'branch', type: 'string' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'repoId', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'tipCommitCid', type: 'bytes32' },
          { name: 'lastPusher', type: 'address' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'protected_', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'getBranches',
    type: 'function',
    inputs: [{ name: 'repoId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'repoId', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'tipCommitCid', type: 'bytes32' },
          { name: 'lastPusher', type: 'address' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'protected_', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'hasWriteAccess',
    type: 'function',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'user', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'hasReadAccess',
    type: 'function',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'user', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getUserRepositories',
    type: 'function',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  {
    name: 'getAllRepositories',
    type: 'function',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'repoId', type: 'bytes32' },
          { name: 'owner', type: 'address' },
          { name: 'agentId', type: 'uint256' },
          { name: 'name', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'jnsNode', type: 'bytes32' },
          { name: 'headCommitCid', type: 'bytes32' },
          { name: 'metadataCid', type: 'bytes32' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'visibility', type: 'uint8' },
          { name: 'archived', type: 'bool' },
          { name: 'starCount', type: 'uint256' },
          { name: 'forkCount', type: 'uint256' },
          { name: 'forkedFrom', type: 'bytes32' },
        ],
      },
    ],
  },
  {
    name: 'getRepositoryCount',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export interface RepoManagerConfig {
  rpcUrl: string
  repoRegistryAddress: Address
  privateKey?: Hex
}

export class GitRepoManager {
  private publicClient: PublicClient
  private walletClient: WalletClient | null = null
  private repoRegistryAddress: Address
  private objectStores: Map<string, GitObjectStore> = new Map() // repoId -> store
  private backend: BackendManager
  private contributionQueue: ContributionEvent[] = []

  constructor(config: RepoManagerConfig, backend: BackendManager) {
    this.backend = backend
    this.repoRegistryAddress = config.repoRegistryAddress

    const chain = {
      ...foundry,
      rpcUrls: {
        default: { http: [config.rpcUrl] },
      },
    }

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    })

    if (config.privateKey) {
      const account = privateKeyToAccount(config.privateKey)
      this.walletClient = createWalletClient({
        account,
        chain,
        transport: http(config.rpcUrl),
      })
    }
  }

  /**
   * Get or create object store for a repository
   */
  getObjectStore(repoId: Hex): GitObjectStore {
    let store = this.objectStores.get(repoId)
    if (!store) {
      store = new GitObjectStore(this.backend)
      this.objectStores.set(repoId, store)
    }
    return store
  }

  /**
   * Create a new repository
   */
  async createRepository(
    request: CreateRepoRequest,
    signer: Address,
  ): Promise<CreateRepoResponse> {
    // Input validation
    if (!this.walletClient) {
      throw new Error('Wallet not configured for write operations')
    }

    if (
      !signer ||
      typeof signer !== 'string' ||
      !/^0x[a-fA-F0-9]{40}$/.test(signer)
    ) {
      throw new Error('Invalid signer address')
    }

    if (!request.name || typeof request.name !== 'string') {
      throw new Error('Repository name is required')
    }

    if (request.name.length > 100) {
      throw new Error(
        'Repository name exceeds maximum length of 100 characters',
      )
    }

    // Validate repository name format (alphanumeric, hyphens, underscores, dots)
    if (!/^[a-z0-9._-]+$/i.test(request.name)) {
      throw new Error(
        `Invalid repository name format: ${request.name}. Only alphanumeric, dots, hyphens, and underscores allowed.`,
      )
    }

    if (request.description && request.description.length > 1000) {
      throw new Error(
        'Repository description exceeds maximum length of 1000 characters',
      )
    }

    const visibility = request.visibility === 'private' ? 1 : 0
    const agentId = request.agentId ? BigInt(request.agentId) : 0n

    let hash: Hex
    try {
      const { request: txRequest } = await this.publicClient.simulateContract({
        address: this.repoRegistryAddress,
        abi: REPO_REGISTRY_ABI,
        functionName: 'createRepository',
        args: [
          request.name,
          request.description || '',
          '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
          agentId,
          visibility,
        ],
        account: signer,
      })

      hash = await this.walletClient.writeContract(txRequest)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to create repository ${request.name}: ${errorMessage}`,
      )
    }

    let receipt: Awaited<
      ReturnType<typeof this.publicClient.waitForTransactionReceipt>
    >
    try {
      receipt = await this.publicClient.waitForTransactionReceipt({ hash })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to wait for repository creation transaction ${hash}: ${errorMessage}`,
      )
    }

    // Extract repoId from logs using event signature
    const repositoryCreatedEvent = receipt.logs.find((log) => {
      try {
        const decoded = decodeEventLog({
          abi: REPO_REGISTRY_ABI,
          data: log.data,
          topics: log.topics,
        })
        return decoded.eventName === 'RepositoryCreated'
      } catch {
        return false
      }
    })

    if (!repositoryCreatedEvent) {
      throw new Error(
        `RepositoryCreated event not found in transaction receipt ${hash}. Logs: ${receipt.logs.length}`,
      )
    }

    // Decode the event log - viem returns args based on the ABI structure
    const decoded = decodeEventLog({
      abi: REPO_REGISTRY_ABI,
      eventName: 'RepositoryCreated',
      data: repositoryCreatedEvent.data,
      topics: repositoryCreatedEvent.topics,
    })

    // Extract repoId from decoded args
    // viem returns args as an object or tuple depending on ABI type inference
    // Since TypeScript sees this as unknown[], access by index (repoId is first param)
    if (!decoded.args) {
      throw new Error(
        `Missing args in RepositoryCreated event from transaction ${hash}`,
      )
    }
    // The first arg is repoId (bytes32) - access as array since TS can't infer named props
    const repoIdValue = decoded.args[0]
    if (typeof repoIdValue !== 'string' || !repoIdValue.startsWith('0x')) {
      throw new Error(
        `Invalid repoId in RepositoryCreated event from transaction ${hash}`,
      )
    }
    const repoId = repoIdValue as Hex

    const baseUrl = process.env.DWS_BASE_URL || 'http://localhost:4030'
    return {
      repoId,
      name: request.name,
      owner: signer,
      cloneUrl: `${baseUrl}/git/${signer}/${request.name}`,
    }
  }

  /**
   * Get repository by ID
   */
  async getRepository(repoId: Hex): Promise<Repository | null> {
    let result: ContractRepoData | null = null
    try {
      result = (await this.publicClient.readContract({
        address: this.repoRegistryAddress,
        abi: REPO_REGISTRY_ABI,
        functionName: 'getRepository',
        args: [repoId],
      })) as ContractRepoData
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      console.error(
        `[Git Registry] Failed to read repository ${repoId}: ${errorMessage}`,
      )
      return null
    }

    if (!result || result.createdAt === 0n) {
      return null
    }

    return this.mapContractRepo(result)
  }

  /**
   * Get repository by owner and name
   */
  async getRepositoryByName(
    owner: Address,
    name: string,
  ): Promise<Repository | null> {
    let result: ContractRepoData | null = null
    try {
      result = (await this.publicClient.readContract({
        address: this.repoRegistryAddress,
        abi: REPO_REGISTRY_ABI,
        functionName: 'getRepositoryByName',
        args: [owner, name],
      })) as ContractRepoData
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      console.error(
        `[Git Registry] Failed to read repository ${owner}/${name}: ${errorMessage}`,
      )
      return null
    }

    if (!result || result.createdAt === 0n) {
      return null
    }

    return this.mapContractRepo(result)
  }

  /**
   * Get branches for a repository
   */
  async getBranches(repoId: Hex): Promise<Branch[]> {
    const result = (await this.publicClient.readContract({
      address: this.repoRegistryAddress,
      abi: REPO_REGISTRY_ABI,
      functionName: 'getBranches',
      args: [repoId],
    })) as ContractBranchData[]

    return result.map((b) => ({
      repoId: b.repoId,
      name: b.name,
      tipCommitCid: b.tipCommitCid,
      lastPusher: b.lastPusher,
      updatedAt: b.updatedAt,
      protected: b.protected_,
    }))
  }

  /**
   * Get a specific branch
   */
  async getBranch(repoId: Hex, branchName: string): Promise<Branch | null> {
    const result = (await this.publicClient.readContract({
      address: this.repoRegistryAddress,
      abi: REPO_REGISTRY_ABI,
      functionName: 'getBranch',
      args: [repoId, branchName],
    })) as ContractBranchData

    if (!result || result.updatedAt === 0n) {
      return null
    }

    return {
      repoId: result.repoId,
      name: result.name,
      tipCommitCid: result.tipCommitCid,
      lastPusher: result.lastPusher,
      updatedAt: result.updatedAt,
      protected: result.protected_,
    }
  }

  /**
   * Check if user has write access
   */
  async hasWriteAccess(repoId: Hex, user: Address): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.repoRegistryAddress,
      abi: REPO_REGISTRY_ABI,
      functionName: 'hasWriteAccess',
      args: [repoId, user],
    }) as Promise<boolean>
  }

  /**
   * Check if user has read access
   */
  async hasReadAccess(repoId: Hex, user: Address): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.repoRegistryAddress,
      abi: REPO_REGISTRY_ABI,
      functionName: 'hasReadAccess',
      args: [repoId, user],
    }) as Promise<boolean>
  }

  /**
   * Get user's repositories
   */
  async getUserRepositories(user: Address): Promise<Repository[]> {
    const repoIds = (await this.publicClient.readContract({
      address: this.repoRegistryAddress,
      abi: REPO_REGISTRY_ABI,
      functionName: 'getUserRepositories',
      args: [user],
    })) as Hex[]

    const repos: Repository[] = []
    for (const repoId of repoIds) {
      const repo = await this.getRepository(repoId)
      if (repo) {
        repos.push(repo)
      }
    }

    return repos
  }

  /**
   * Get all repositories with pagination
   */
  async getAllRepositories(
    offset: number,
    limit: number,
  ): Promise<Repository[]> {
    const result = (await this.publicClient.readContract({
      address: this.repoRegistryAddress,
      abi: REPO_REGISTRY_ABI,
      functionName: 'getAllRepositories',
      args: [BigInt(offset), BigInt(limit)],
    })) as ContractRepoData[]

    return result.map((r: ContractRepoData) => this.mapContractRepo(r))
  }

  /**
   * Get total repository count
   */
  async getRepositoryCount(): Promise<number> {
    const count = await this.publicClient.readContract({
      address: this.repoRegistryAddress,
      abi: REPO_REGISTRY_ABI,
      functionName: 'getRepositoryCount',
    })

    return Number(count)
  }

  /**
   * Push to a branch
   */
  async pushBranch(
    repoId: Hex,
    branch: string,
    newCommitOid: string,
    oldCommitOid: string | null,
    commitCount: number,
    pusher: Address,
  ): Promise<void> {
    // Input validation
    if (!this.walletClient) {
      throw new Error('Wallet not configured for write operations')
    }

    if (
      !repoId ||
      typeof repoId !== 'string' ||
      !/^0x[a-fA-F0-9]{64}$/.test(repoId)
    ) {
      throw new Error('Invalid repository ID')
    }

    if (!branch || typeof branch !== 'string') {
      throw new Error('Branch name is required')
    }

    if (branch.length > 255) {
      throw new Error('Branch name exceeds maximum length of 255 characters')
    }

    if (
      !newCommitOid ||
      typeof newCommitOid !== 'string' ||
      !/^[0-9a-f]{40}$/i.test(newCommitOid)
    ) {
      throw new Error(
        'Invalid Git OID format. Expected 40-character hex string.',
      )
    }

    if (oldCommitOid !== null && !/^[0-9a-f]{40}$/i.test(oldCommitOid)) {
      throw new Error(
        'Invalid old Git OID format. Expected 40-character hex string or null.',
      )
    }

    if (commitCount < 0 || commitCount > 1000) {
      throw new Error(
        `Invalid commit count: ${commitCount}. Must be between 0 and 1000.`,
      )
    }

    if (
      !pusher ||
      typeof pusher !== 'string' ||
      !/^0x[a-fA-F0-9]{40}$/.test(pusher)
    ) {
      throw new Error('Invalid pusher address')
    }

    // Convert OID to bytes32 (pad with zeros on the left)
    const newCommitCid = encodeOidToBytes32(newCommitOid)
    const oldCommitCid = oldCommitOid
      ? encodeOidToBytes32(oldCommitOid)
      : ('0x0000000000000000000000000000000000000000000000000000000000000000' as Hex)

    let hash: Hex
    try {
      const { request: txRequest } = await this.publicClient.simulateContract({
        address: this.repoRegistryAddress,
        abi: REPO_REGISTRY_ABI,
        functionName: 'pushBranch',
        args: [repoId, branch, newCommitCid, oldCommitCid, BigInt(commitCount)],
        account: pusher,
      })

      hash = await this.walletClient.writeContract(txRequest)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to push branch ${branch} to repository ${repoId}: ${errorMessage}`,
      )
    }

    try {
      await this.publicClient.waitForTransactionReceipt({ hash })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to wait for push transaction ${hash}: ${errorMessage}`,
      )
    }

    // Queue contribution event for leaderboard
    this.queueContribution({
      source: 'jeju-git',
      type: 'commit',
      repoId,
      author: pusher,
      timestamp: Date.now(),
      metadata: {
        branch,
        commitCount,
      },
    })
  }

  /**
   * Get refs for a repository (for git info/refs)
   */
  async getRefs(repoId: Hex): Promise<GitRef[]> {
    const branches = await this.getBranches(repoId)
    const refs: GitRef[] = []

    for (const branch of branches) {
      // Convert bytes32 CID back to OID
      const oid = decodeBytes32ToOid(branch.tipCommitCid)
      refs.push({
        name: `refs/heads/${branch.name}`,
        oid,
      })
    }

    // Add HEAD pointing to main branch
    const mainBranch = branches.find((b) => b.name === 'main')
    if (mainBranch) {
      refs.unshift({
        name: 'HEAD',
        oid: decodeBytes32ToOid(mainBranch.tipCommitCid),
        symbolic: 'refs/heads/main',
      })
    } else if (branches.length > 0) {
      refs.unshift({
        name: 'HEAD',
        oid: decodeBytes32ToOid(branches[0].tipCommitCid),
        symbolic: `refs/heads/${branches[0].name}`,
      })
    }

    return refs
  }

  /**
   * Queue a contribution event for leaderboard integration
   */
  private queueContribution(event: ContributionEvent): void {
    this.contributionQueue.push(event)
  }

  /**
   * Flush contribution events (for batch processing)
   */
  flushContributions(): ContributionEvent[] {
    const events = [...this.contributionQueue]
    this.contributionQueue = []
    return events
  }

  /**
   * Map contract response to Repository type
   */
  private mapContractRepo(result: {
    repoId: Hex
    owner: Address
    agentId: bigint
    name: string
    description: string
    jnsNode: Hex
    headCommitCid: Hex
    metadataCid: Hex
    createdAt: bigint
    updatedAt: bigint
    visibility: number
    archived: boolean
    starCount: bigint
    forkCount: bigint
    forkedFrom: Hex
  }): Repository {
    return {
      repoId: result.repoId,
      owner: result.owner,
      agentId: result.agentId,
      name: result.name,
      description: result.description,
      jnsNode: result.jnsNode,
      headCommitCid: result.headCommitCid,
      metadataCid: result.metadataCid,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      visibility: result.visibility as 0 | 1,
      archived: result.archived,
      starCount: result.starCount,
      forkCount: result.forkCount,
      forkedFrom: result.forkedFrom,
    }
  }
}
