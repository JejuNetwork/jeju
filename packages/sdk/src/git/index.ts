/**
 * JejuGit SDK - Client for decentralized Git operations
 *
 * Provides TypeScript interface for:
 * - Repository management
 * - Git operations
 * - Issues and Pull Requests
 * - On-chain registry interaction
 */

import type { Address, Hex } from 'viem'
import { createWalletClient, http } from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import {
  GitBranchSchema,
  GitIssueSchema,
  GitPullRequestSchema,
  GitRepositoryListResponseSchema,
  GitRepositorySchema,
  GitSearchResponseSchema,
  GitTagSchema,
  GitUserSchema,
  HealthCheckResponseSchema,
} from '../shared/schemas'

export interface GitSDKConfig {
  rpcUrl: string
  gitServerUrl: string
  registryAddress?: Address
  privateKey?: Hex
}

export interface Repository {
  id: string
  name: string
  fullName: string
  owner: string
  description?: string
  visibility: 'public' | 'private' | 'internal'
  defaultBranch: string
  cloneUrl: string
  starCount: number
  forkCount: number
  topics: string[]
  createdAt: string
  updatedAt: string
  pushedAt?: string
  reputationScore?: number
  councilProposalId?: string
  verified: boolean
  headCid: string
}

export interface Issue {
  id: string
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  author: string
  assignees: string[]
  labels: string[]
  createdAt: string
  updatedAt: string
  comments: Array<{ author: string; body: string; createdAt: string }>
}

export interface PullRequest {
  id: string
  number: number
  title: string
  body: string
  state: 'open' | 'closed' | 'merged'
  author: string
  sourceBranch: string
  targetBranch: string
  reviewers: string[]
  createdAt: string
  updatedAt: string
  mergedAt?: string
  mergedBy?: string
}

export interface Branch {
  name: string
  sha: string
  protected: boolean
}

export interface Tag {
  name: string
  sha: string
}

export interface GitUser {
  login: string
  address: string
  jnsName?: string
  publicRepos: number
  reputationScore: number
  createdAt: string
}

const GIT_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'createRepository',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'visibility', type: 'uint8' },
      { name: 'defaultBranch', type: 'string' },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'forkRepository',
    inputs: [{ name: 'parentId', type: 'bytes32' }],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'starRepository',
    inputs: [{ name: 'repoId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unstarRepository',
    inputs: [{ name: 'repoId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'addContributor',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'contributor', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'removeContributor',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'contributor', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createIssue',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'title', type: 'string' },
      { name: 'cid', type: 'string' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'closeIssue',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'number', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createPullRequest',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'title', type: 'string' },
      { name: 'sourceBranch', type: 'string' },
      { name: 'targetBranch', type: 'string' },
      { name: 'cid', type: 'string' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'mergePullRequest',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'number', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'linkCouncilProposal',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'proposalId', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getRepository',
    inputs: [{ name: 'repoId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'description', type: 'string' },
          { name: 'visibility', type: 'uint8' },
          { name: 'defaultBranch', type: 'string' },
          { name: 'headCid', type: 'string' },
          { name: 'packCid', type: 'string' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'pushedAt', type: 'uint256' },
          { name: 'starCount', type: 'uint256' },
          { name: 'forkCount', type: 'uint256' },
          { name: 'cloneCount', type: 'uint256' },
          { name: 'forkedFrom', type: 'bytes32' },
          { name: 'reputationScore', type: 'uint256' },
          { name: 'councilProposalId', type: 'uint256' },
          { name: 'verified', type: 'bool' },
          { name: 'archived', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRepositoryByName',
    inputs: [{ name: 'fullName', type: 'string' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'description', type: 'string' },
          { name: 'visibility', type: 'uint8' },
          { name: 'defaultBranch', type: 'string' },
          { name: 'headCid', type: 'string' },
          { name: 'packCid', type: 'string' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'pushedAt', type: 'uint256' },
          { name: 'starCount', type: 'uint256' },
          { name: 'forkCount', type: 'uint256' },
          { name: 'cloneCount', type: 'uint256' },
          { name: 'forkedFrom', type: 'bytes32' },
          { name: 'reputationScore', type: 'uint256' },
          { name: 'councilProposalId', type: 'uint256' },
          { name: 'verified', type: 'bool' },
          { name: 'archived', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isContributor',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'user', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getUserRepositories',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getUserStars',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
] as const

export class JejuGitSDK {
  private config: GitSDKConfig
  private walletClient: ReturnType<typeof createWalletClient> | null = null
  private account: PrivateKeyAccount | null = null

  constructor(config: GitSDKConfig) {
    this.config = config

    if (config.privateKey) {
      this.account = privateKeyToAccount(config.privateKey)
      this.walletClient = createWalletClient({
        account: this.account,
        transport: http(config.rpcUrl),
      })
    }
  }

  // Repository Operations

  async listRepositories(options?: {
    page?: number
    perPage?: number
    sort?: 'updated' | 'created' | 'stars'
    visibility?: 'public' | 'private'
  }): Promise<{ total: number; items: Repository[] }> {
    const params = new URLSearchParams()
    if (options?.page) params.set('page', options.page.toString())
    if (options?.perPage) params.set('per_page', options.perPage.toString())
    if (options?.sort) params.set('sort', options.sort)
    if (options?.visibility) params.set('visibility', options.visibility)

    // DWS uses /git/repos endpoint
    const response = await fetch(
      `${this.config.gitServerUrl}/git/repos?${params}`,
    )
    if (!response.ok)
      throw new Error(`Failed to list repositories: ${response.statusText}`)

    const rawData: unknown = await response.json()
    const data = GitRepositoryListResponseSchema.parse(rawData)
    return { total: data.total, items: data.repositories }
  }

  async getRepository(owner: string, repo: string): Promise<Repository> {
    const response = await fetch(
      `${this.config.gitServerUrl}/git/repos/${owner}/${repo}`,
    )
    if (!response.ok)
      throw new Error(`Failed to get repository: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return GitRepositorySchema.parse(rawData)
  }

  async createRepository(
    options: {
      name: string
      description?: string
      visibility?: 'public' | 'private' | 'internal'
      defaultBranch?: string
      topics?: string[]
    },
    authToken: string,
  ): Promise<Repository> {
    const response = await fetch(`${this.config.gitServerUrl}/git/repos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': authToken, // DWS uses x-jeju-address header
      },
      body: JSON.stringify(options),
    })

    if (!response.ok)
      throw new Error(`Failed to create repository: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return GitRepositorySchema.parse(rawData)
  }

  async updateRepository(
    owner: string,
    repo: string,
    updates: {
      description?: string
      visibility?: 'public' | 'private' | 'internal'
      defaultBranch?: string
      topics?: string[]
    },
    authToken: string,
  ): Promise<Repository> {
    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/repos/${owner}/${repo}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(updates),
      },
    )

    if (!response.ok)
      throw new Error(`Failed to update repository: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return GitRepositorySchema.parse(rawData)
  }

  async deleteRepository(
    owner: string,
    repo: string,
    authToken: string,
  ): Promise<void> {
    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/repos/${owner}/${repo}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    )

    if (!response.ok)
      throw new Error(`Failed to delete repository: ${response.statusText}`)
  }

  async forkRepository(
    owner: string,
    repo: string,
    authToken: string,
  ): Promise<Repository> {
    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/repos/${owner}/${repo}/fork`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    )

    if (!response.ok)
      throw new Error(`Failed to fork repository: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return GitRepositorySchema.parse(rawData)
  }

  async starRepository(
    owner: string,
    repo: string,
    authToken: string,
  ): Promise<void> {
    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/repos/${owner}/${repo}/star`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    )

    if (!response.ok)
      throw new Error(`Failed to star repository: ${response.statusText}`)
  }

  async unstarRepository(
    owner: string,
    repo: string,
    authToken: string,
  ): Promise<void> {
    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/repos/${owner}/${repo}/star`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    )

    if (!response.ok)
      throw new Error(`Failed to unstar repository: ${response.statusText}`)
  }

  // Branch and Tag Operations

  async listBranches(owner: string, repo: string): Promise<Branch[]> {
    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/repos/${owner}/${repo}/branches`,
    )
    if (!response.ok)
      throw new Error(`Failed to list branches: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return z.array(GitBranchSchema).parse(rawData)
  }

  async listTags(owner: string, repo: string): Promise<Tag[]> {
    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/repos/${owner}/${repo}/tags`,
    )
    if (!response.ok)
      throw new Error(`Failed to list tags: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return z.array(GitTagSchema).parse(rawData)
  }

  // Issue Operations

  async listIssues(
    owner: string,
    repo: string,
    options?: {
      state?: 'open' | 'closed' | 'all'
      page?: number
      perPage?: number
    },
  ): Promise<Issue[]> {
    const params = new URLSearchParams()
    if (options?.state) params.set('state', options.state)
    if (options?.page) params.set('page', options.page.toString())
    if (options?.perPage) params.set('per_page', options.perPage.toString())

    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/repos/${owner}/${repo}/issues?${params}`,
    )
    if (!response.ok)
      throw new Error(`Failed to list issues: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return z.array(GitIssueSchema).parse(rawData)
  }

  async getIssue(owner: string, repo: string, number: number): Promise<Issue> {
    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/repos/${owner}/${repo}/issues/${number}`,
    )
    if (!response.ok)
      throw new Error(`Failed to get issue: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return GitIssueSchema.parse(rawData)
  }

  async createIssue(
    owner: string,
    repo: string,
    options: {
      title: string
      body?: string
      labels?: string[]
      assignees?: string[]
    },
    authToken: string,
  ): Promise<Issue> {
    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/repos/${owner}/${repo}/issues`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(options),
      },
    )

    if (!response.ok)
      throw new Error(`Failed to create issue: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return GitIssueSchema.parse(rawData)
  }

  async updateIssue(
    owner: string,
    repo: string,
    number: number,
    updates: {
      title?: string
      body?: string
      state?: 'open' | 'closed'
      labels?: string[]
    },
    authToken: string,
  ): Promise<Issue> {
    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/repos/${owner}/${repo}/issues/${number}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(updates),
      },
    )

    if (!response.ok)
      throw new Error(`Failed to update issue: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return GitIssueSchema.parse(rawData)
  }

  // Pull Request Operations

  async listPullRequests(
    owner: string,
    repo: string,
    options?: {
      state?: 'open' | 'closed' | 'all'
      page?: number
      perPage?: number
    },
  ): Promise<PullRequest[]> {
    const params = new URLSearchParams()
    if (options?.state) params.set('state', options.state)
    if (options?.page) params.set('page', options.page.toString())
    if (options?.perPage) params.set('per_page', options.perPage.toString())

    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/repos/${owner}/${repo}/pulls?${params}`,
    )
    if (!response.ok)
      throw new Error(`Failed to list pull requests: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return z.array(GitPullRequestSchema).parse(rawData)
  }

  async getPullRequest(
    owner: string,
    repo: string,
    number: number,
  ): Promise<PullRequest> {
    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/repos/${owner}/${repo}/pulls/${number}`,
    )
    if (!response.ok)
      throw new Error(`Failed to get pull request: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return GitPullRequestSchema.parse(rawData)
  }

  async createPullRequest(
    owner: string,
    repo: string,
    options: {
      title: string
      body?: string
      sourceBranch: string
      targetBranch?: string
    },
    authToken: string,
  ): Promise<PullRequest> {
    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/repos/${owner}/${repo}/pulls`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(options),
      },
    )

    if (!response.ok)
      throw new Error(`Failed to create pull request: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return GitPullRequestSchema.parse(rawData)
  }

  async mergePullRequest(
    owner: string,
    repo: string,
    number: number,
    authToken: string,
  ): Promise<PullRequest> {
    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/repos/${owner}/${repo}/pulls/${number}/merge`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    )

    if (!response.ok)
      throw new Error(`Failed to merge pull request: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return GitPullRequestSchema.parse(rawData)
  }

  // User Operations

  async getUser(username: string): Promise<GitUser> {
    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/users/${username}`,
    )
    if (!response.ok)
      throw new Error(`Failed to get user: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return GitUserSchema.parse(rawData)
  }

  async getUserRepositories(username: string): Promise<Repository[]> {
    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/users/${username}/repos`,
    )
    if (!response.ok)
      throw new Error(`Failed to get user repositories: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return z.array(GitRepositorySchema).parse(rawData)
  }

  // Search

  async searchRepositories(
    query: string,
    options?: {
      page?: number
      perPage?: number
    },
  ): Promise<{ total: number; items: Repository[] }> {
    const params = new URLSearchParams()
    params.set('q', query)
    if (options?.page) params.set('page', options.page.toString())
    if (options?.perPage) params.set('per_page', options.perPage.toString())

    const response = await fetch(
      `${this.config.gitServerUrl}/api/v1/search/repositories?${params}`,
    )
    if (!response.ok)
      throw new Error(`Failed to search repositories: ${response.statusText}`)

    const rawData: unknown = await response.json()
    const data = GitSearchResponseSchema.parse(rawData)
    return { total: data.total_count, items: data.items }
  }

  // On-chain operations (requires wallet)

  async createRepositoryOnChain(
    name: string,
    description: string,
    visibility: 0 | 1 | 2,
    defaultBranch: string,
  ): Promise<Hex> {
    if (!this.walletClient || !this.account || !this.config.registryAddress) {
      throw new Error(
        'Wallet client, account, and registry address required for on-chain operations',
      )
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.registryAddress,
      abi: GIT_REGISTRY_ABI,
      functionName: 'createRepository',
      args: [name, description, visibility, defaultBranch],
      account: this.account,
      chain: null,
    })

    return hash
  }

  async linkCouncilProposal(repoId: Hex, proposalId: bigint): Promise<Hex> {
    if (!this.walletClient || !this.account || !this.config.registryAddress) {
      throw new Error(
        'Wallet client, account, and registry address required for on-chain operations',
      )
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.registryAddress,
      abi: GIT_REGISTRY_ABI,
      functionName: 'linkCouncilProposal',
      args: [repoId, proposalId],
      account: this.account,
      chain: null,
    })

    return hash
  }

  // Health check

  async healthCheck(): Promise<{ status: string; service: string }> {
    const response = await fetch(`${this.config.gitServerUrl}/git/health`)
    if (!response.ok)
      throw new Error(`Health check failed: ${response.statusText}`)
    const rawData: unknown = await response.json()
    return HealthCheckResponseSchema.parse(rawData)
  }

  // Clone URL helper

  getCloneUrl(owner: string, repo: string): string {
    return `${this.config.gitServerUrl}/${owner}/${repo}.git`
  }
}

export function createJejuGitSDK(config: GitSDKConfig): JejuGitSDK {
  return new JejuGitSDK(config)
}

// Convenience function for default config
export function createDefaultGitSDK(): JejuGitSDK {
  return new JejuGitSDK({
    rpcUrl: process.env.JEJU_RPC_URL ?? 'http://127.0.0.1:6546',
    gitServerUrl: process.env.JEJUGIT_URL ?? 'http://localhost:4030/git',
    registryAddress: process.env.GIT_REGISTRY_ADDRESS as Address | undefined,
  })
}
