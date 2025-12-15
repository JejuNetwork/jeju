/**
 * Git Repository Manager
 * Manages git repositories with on-chain registry integration
 */

import { createPublicClient, createWalletClient, http, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import type { BackendManager } from '../storage/backends';
import { GitObjectStore } from './object-store';
import type {
  Repository,
  Branch,
  Collaborator,
  GitCommit,
  GitTree,
  GitBlob,
  GitRef,
  CreateRepoRequest,
  CreateRepoResponse,
  ContributionEvent,
} from './types';

// RepoRegistry ABI (subset for our needs)
const REPO_REGISTRY_ABI = [
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
] as const;

export interface RepoManagerConfig {
  rpcUrl: string;
  repoRegistryAddress: Address;
  privateKey?: Hex;
}

export class GitRepoManager {
  private publicClient: PublicClient;
  private walletClient: WalletClient | null = null;
  private repoRegistryAddress: Address;
  private objectStores: Map<string, GitObjectStore> = new Map(); // repoId -> store
  private backend: BackendManager;
  private contributionQueue: ContributionEvent[] = [];

  constructor(config: RepoManagerConfig, backend: BackendManager) {
    this.backend = backend;
    this.repoRegistryAddress = config.repoRegistryAddress;

    const chain = {
      ...foundry,
      rpcUrls: {
        default: { http: [config.rpcUrl] },
      },
    };

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });

    if (config.privateKey) {
      const account = privateKeyToAccount(config.privateKey);
      this.walletClient = createWalletClient({
        account,
        chain,
        transport: http(config.rpcUrl),
      });
    }
  }

  /**
   * Get or create object store for a repository
   */
  getObjectStore(repoId: Hex): GitObjectStore {
    let store = this.objectStores.get(repoId);
    if (!store) {
      store = new GitObjectStore(this.backend);
      this.objectStores.set(repoId, store);
    }
    return store;
  }

  /**
   * Create a new repository
   */
  async createRepository(request: CreateRepoRequest, signer: Address): Promise<CreateRepoResponse> {
    if (!this.walletClient) {
      throw new Error('Wallet not configured for write operations');
    }

    const visibility = request.visibility === 'private' ? 1 : 0;
    const agentId = request.agentId ? BigInt(request.agentId) : 0n;

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
    });

    const hash = await this.walletClient.writeContract(txRequest);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    // Extract repoId from logs (first topic of RepositoryCreated event)
    const repoId = receipt.logs[0]?.topics[1] as Hex;

    const baseUrl = process.env.DWS_BASE_URL || 'http://localhost:4030';
    return {
      repoId,
      name: request.name,
      owner: signer,
      cloneUrl: `${baseUrl}/git/${signer}/${request.name}`,
    };
  }

  /**
   * Get repository by ID
   */
  async getRepository(repoId: Hex): Promise<Repository | null> {
    const result = await this.publicClient.readContract({
      address: this.repoRegistryAddress,
      abi: REPO_REGISTRY_ABI,
      functionName: 'getRepository',
      args: [repoId],
    });

    if (!result || result.createdAt === 0n) {
      return null;
    }

    return this.mapContractRepo(result);
  }

  /**
   * Get repository by owner and name
   */
  async getRepositoryByName(owner: Address, name: string): Promise<Repository | null> {
    const result = await this.publicClient.readContract({
      address: this.repoRegistryAddress,
      abi: REPO_REGISTRY_ABI,
      functionName: 'getRepositoryByName',
      args: [owner, name],
    });

    if (!result || result.createdAt === 0n) {
      return null;
    }

    return this.mapContractRepo(result);
  }

  /**
   * Get branches for a repository
   */
  async getBranches(repoId: Hex): Promise<Branch[]> {
    const result = await this.publicClient.readContract({
      address: this.repoRegistryAddress,
      abi: REPO_REGISTRY_ABI,
      functionName: 'getBranches',
      args: [repoId],
    });

    return result.map((b) => ({
      repoId: b.repoId,
      name: b.name,
      tipCommitCid: b.tipCommitCid,
      lastPusher: b.lastPusher,
      updatedAt: b.updatedAt,
      protected: b.protected_,
    }));
  }

  /**
   * Get a specific branch
   */
  async getBranch(repoId: Hex, branchName: string): Promise<Branch | null> {
    const result = await this.publicClient.readContract({
      address: this.repoRegistryAddress,
      abi: REPO_REGISTRY_ABI,
      functionName: 'getBranch',
      args: [repoId, branchName],
    });

    if (!result || result.updatedAt === 0n) {
      return null;
    }

    return {
      repoId: result.repoId,
      name: result.name,
      tipCommitCid: result.tipCommitCid,
      lastPusher: result.lastPusher,
      updatedAt: result.updatedAt,
      protected: result.protected_,
    };
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
    });
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
    });
  }

  /**
   * Get user's repositories
   */
  async getUserRepositories(user: Address): Promise<Repository[]> {
    const repoIds = await this.publicClient.readContract({
      address: this.repoRegistryAddress,
      abi: REPO_REGISTRY_ABI,
      functionName: 'getUserRepositories',
      args: [user],
    });

    const repos: Repository[] = [];
    for (const repoId of repoIds) {
      const repo = await this.getRepository(repoId);
      if (repo) {
        repos.push(repo);
      }
    }

    return repos;
  }

  /**
   * Get all repositories with pagination
   */
  async getAllRepositories(offset: number, limit: number): Promise<Repository[]> {
    const result = await this.publicClient.readContract({
      address: this.repoRegistryAddress,
      abi: REPO_REGISTRY_ABI,
      functionName: 'getAllRepositories',
      args: [BigInt(offset), BigInt(limit)],
    });

    return result.map((r) => this.mapContractRepo(r));
  }

  /**
   * Get total repository count
   */
  async getRepositoryCount(): Promise<number> {
    const count = await this.publicClient.readContract({
      address: this.repoRegistryAddress,
      abi: REPO_REGISTRY_ABI,
      functionName: 'getRepositoryCount',
    });

    return Number(count);
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
    pusher: Address
  ): Promise<void> {
    if (!this.walletClient) {
      throw new Error('Wallet not configured for write operations');
    }

    // Convert OID to bytes32 (pad with zeros)
    const newCommitCid = `0x${newCommitOid.padEnd(64, '0')}` as Hex;
    const oldCommitCid = oldCommitOid
      ? (`0x${oldCommitOid.padEnd(64, '0')}` as Hex)
      : ('0x0000000000000000000000000000000000000000000000000000000000000000' as Hex);

    const { request: txRequest } = await this.publicClient.simulateContract({
      address: this.repoRegistryAddress,
      abi: REPO_REGISTRY_ABI,
      functionName: 'pushBranch',
      args: [repoId, branch, newCommitCid, oldCommitCid, BigInt(commitCount)],
      account: pusher,
    });

    const hash = await this.walletClient.writeContract(txRequest);
    await this.publicClient.waitForTransactionReceipt({ hash });

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
    });
  }

  /**
   * Get refs for a repository (for git info/refs)
   */
  async getRefs(repoId: Hex): Promise<GitRef[]> {
    const branches = await this.getBranches(repoId);
    const refs: GitRef[] = [];

    for (const branch of branches) {
      // Convert bytes32 CID back to OID (first 40 chars)
      const oid = branch.tipCommitCid.slice(2, 42);
      refs.push({
        name: `refs/heads/${branch.name}`,
        oid,
      });
    }

    // Add HEAD pointing to main branch
    const mainBranch = branches.find((b) => b.name === 'main');
    if (mainBranch) {
      refs.unshift({
        name: 'HEAD',
        oid: mainBranch.tipCommitCid.slice(2, 42),
        symbolic: 'refs/heads/main',
      });
    } else if (branches.length > 0) {
      refs.unshift({
        name: 'HEAD',
        oid: branches[0].tipCommitCid.slice(2, 42),
        symbolic: `refs/heads/${branches[0].name}`,
      });
    }

    return refs;
  }

  /**
   * Queue a contribution event for leaderboard integration
   */
  private queueContribution(event: ContributionEvent): void {
    this.contributionQueue.push(event);
  }

  /**
   * Flush contribution events (for batch processing)
   */
  flushContributions(): ContributionEvent[] {
    const events = [...this.contributionQueue];
    this.contributionQueue = [];
    return events;
  }

  /**
   * Map contract response to Repository type
   */
  private mapContractRepo(result: {
    repoId: Hex;
    owner: Address;
    agentId: bigint;
    name: string;
    description: string;
    jnsNode: Hex;
    headCommitCid: Hex;
    metadataCid: Hex;
    createdAt: bigint;
    updatedAt: bigint;
    visibility: number;
    archived: boolean;
    starCount: bigint;
    forkCount: bigint;
    forkedFrom: Hex;
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
    };
  }
}

