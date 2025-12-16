/**
 * Git Social Features
 * Stars, Forks, and User profiles
 */

import type { Address, Hex } from 'viem';
import type { BackendManager } from '../storage/backends';
import type {
  GitUser,
  Star,
  Fork,
  UserTier,
  ContributionEvent,
  Repository,
} from './types';
import type { GitRepoManager } from './repo-manager';

export interface SocialManagerConfig {
  backend: BackendManager;
  repoManager: GitRepoManager;
}

interface UserIndex {
  users: Map<Address, GitUser>;
  stars: Map<Hex, Address[]>; // repoId -> users who starred
  userStars: Map<Address, Hex[]>; // user -> repos they starred
}

export class SocialManager {
  private backend: BackendManager;
  private repoManager: GitRepoManager;
  private userCache: Map<Address, GitUser> = new Map();
  private starsCache: Map<Hex, Set<Address>> = new Map(); // repoId -> stargazers
  private userStarsCache: Map<Address, Set<Hex>> = new Map(); // user -> starred repos
  private forksCache: Map<Hex, Fork[]> = new Map(); // repoId -> forks

  constructor(config: SocialManagerConfig) {
    this.backend = config.backend;
    this.repoManager = config.repoManager;
  }

  // ============ User Management ============

  /**
   * Get or create a user profile
   */
  async getUser(address: Address): Promise<GitUser> {
    const normalized = address.toLowerCase() as Address;
    const cached = this.userCache.get(normalized);
    if (cached) return cached;

    // Create default user
    const user: GitUser = {
      address: normalized,
      repositories: [],
      starredRepos: [],
      balance: 0n,
      stakedAmount: 0n,
      tier: 'free',
      reputationScore: 0,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.userCache.set(normalized, user);
    return user;
  }

  /**
   * Update user profile
   */
  async updateUser(
    address: Address,
    updates: Partial<Pick<GitUser, 'username' | 'jnsName' | 'email' | 'avatarUrl' | 'bio' | 'company' | 'location' | 'website' | 'twitter' | 'github'>>
  ): Promise<GitUser> {
    const user = await this.getUser(address);
    Object.assign(user, updates);
    user.lastActivity = Date.now();
    
    // Persist user data
    const userBuffer = Buffer.from(JSON.stringify(user));
    await this.backend.upload(userBuffer, {
      filename: `user-${address}.json`,
    });

    return user;
  }

  /**
   * Get user by username or JNS name
   */
  async getUserByName(name: string): Promise<GitUser | null> {
    for (const user of this.userCache.values()) {
      if (user.username === name || user.jnsName === name) {
        return user;
      }
    }
    return null;
  }

  /**
   * Get user's repositories
   */
  async getUserRepositories(address: Address): Promise<Repository[]> {
    const repos = await this.repoManager.getUserRepositories(address);
    return repos;
  }

  /**
   * Get user's activity stats
   */
  async getUserStats(address: Address): Promise<{
    repositories: number;
    stars: number;
    followers: number;
    following: number;
    totalCommits: number;
    totalPRs: number;
    totalIssues: number;
  }> {
    const user = await this.getUser(address);
    const userStars = this.userStarsCache.get(address.toLowerCase() as Address) || new Set();
    
    return {
      repositories: user.repositories.length,
      stars: userStars.size,
      followers: 0, // Would need follower tracking
      following: 0, // Would need following tracking
      totalCommits: user.totalCommits || 0,
      totalPRs: user.totalPRs || 0,
      totalIssues: user.totalIssues || 0,
    };
  }

  // ============ Stars ============

  /**
   * Star a repository
   */
  async starRepo(
    repoId: Hex,
    user: Address
  ): Promise<{ starred: boolean; starCount: number; contributionEvent: ContributionEvent }> {
    const normalized = user.toLowerCase() as Address;
    
    // Get or create repo stars set
    let repoStars = this.starsCache.get(repoId);
    if (!repoStars) {
      repoStars = new Set();
      this.starsCache.set(repoId, repoStars);
    }

    // Get or create user stars set
    let userStars = this.userStarsCache.get(normalized);
    if (!userStars) {
      userStars = new Set();
      this.userStarsCache.set(normalized, userStars);
    }

    // Check if already starred
    if (repoStars.has(normalized)) {
      return {
        starred: true,
        starCount: repoStars.size,
        contributionEvent: {
          source: 'jeju-git',
          type: 'star',
          repoId,
          author: normalized,
          timestamp: Date.now(),
          metadata: {},
        },
      };
    }

    // Add star
    repoStars.add(normalized);
    userStars.add(repoId);

    // Update user profile
    const userProfile = await this.getUser(normalized);
    if (!userProfile.starredRepos.includes(repoId)) {
      userProfile.starredRepos.push(repoId);
    }
    userProfile.lastActivity = Date.now();

    // Create contribution event
    const contributionEvent: ContributionEvent = {
      source: 'jeju-git',
      type: 'star',
      repoId,
      author: normalized,
      timestamp: Date.now(),
      metadata: {},
    };

    return {
      starred: true,
      starCount: repoStars.size,
      contributionEvent,
    };
  }

  /**
   * Unstar a repository
   */
  async unstarRepo(repoId: Hex, user: Address): Promise<{ starred: boolean; starCount: number }> {
    const normalized = user.toLowerCase() as Address;
    
    const repoStars = this.starsCache.get(repoId);
    const userStars = this.userStarsCache.get(normalized);

    if (repoStars) {
      repoStars.delete(normalized);
    }
    if (userStars) {
      userStars.delete(repoId);
    }

    // Update user profile
    const userProfile = this.userCache.get(normalized);
    if (userProfile) {
      userProfile.starredRepos = userProfile.starredRepos.filter(r => r !== repoId);
    }

    return {
      starred: false,
      starCount: repoStars?.size || 0,
    };
  }

  /**
   * Check if user has starred a repo
   */
  hasStarred(repoId: Hex, user: Address): boolean {
    const normalized = user.toLowerCase() as Address;
    const repoStars = this.starsCache.get(repoId);
    return repoStars?.has(normalized) || false;
  }

  /**
   * Get stargazers for a repo
   */
  async getStargazers(
    repoId: Hex,
    options: { page?: number; perPage?: number } = {}
  ): Promise<{ users: GitUser[]; total: number }> {
    const repoStars = this.starsCache.get(repoId);
    if (!repoStars || repoStars.size === 0) {
      return { users: [], total: 0 };
    }

    const page = options.page || 1;
    const perPage = options.perPage || 30;
    const allStargazers = Array.from(repoStars);
    const start = (page - 1) * perPage;
    const paginatedAddresses = allStargazers.slice(start, start + perPage);

    const users: GitUser[] = [];
    for (const address of paginatedAddresses) {
      const user = await this.getUser(address);
      users.push(user);
    }

    return { users, total: allStargazers.length };
  }

  /**
   * Get repos starred by a user
   */
  async getStarredRepos(
    user: Address,
    options: { page?: number; perPage?: number } = {}
  ): Promise<{ repos: Repository[]; total: number }> {
    const normalized = user.toLowerCase() as Address;
    const userStars = this.userStarsCache.get(normalized);
    if (!userStars || userStars.size === 0) {
      return { repos: [], total: 0 };
    }

    const page = options.page || 1;
    const perPage = options.perPage || 30;
    const allRepoIds = Array.from(userStars);
    const start = (page - 1) * perPage;
    const paginatedRepoIds = allRepoIds.slice(start, start + perPage);

    const repos: Repository[] = [];
    for (const repoId of paginatedRepoIds) {
      const repo = await this.repoManager.getRepository(repoId);
      if (repo) repos.push(repo);
    }

    return { repos, total: allRepoIds.length };
  }

  /**
   * Get star count for a repo
   */
  getStarCount(repoId: Hex): number {
    return this.starsCache.get(repoId)?.size || 0;
  }

  // ============ Forks ============

  /**
   * Fork a repository
   */
  async forkRepo(
    originalRepoId: Hex,
    forker: Address,
    options: { name?: string } = {}
  ): Promise<{ fork: Fork; repo: Repository; contributionEvent: ContributionEvent }> {
    const original = await this.repoManager.getRepository(originalRepoId);
    if (!original) {
      throw new Error('Original repository not found');
    }

    // Check if user already has a fork
    const existingForks = this.forksCache.get(originalRepoId) || [];
    const userFork = existingForks.find(f => f.forkedBy.toLowerCase() === forker.toLowerCase());
    if (userFork) {
      throw new Error('You already have a fork of this repository');
    }

    // Create new repository as fork
    const forkName = options.name || original.name;
    const result = await this.repoManager.createRepository(
      {
        name: forkName,
        description: `Fork of ${original.owner}/${original.name}`,
        visibility: original.visibility === 0 ? 'public' : 'private',
      },
      forker
    );

    const fork: Fork = {
      originalRepoId,
      forkedRepoId: result.repoId,
      forkedBy: forker,
      forkedAt: Date.now(),
    };

    // Update forks cache
    if (!this.forksCache.has(originalRepoId)) {
      this.forksCache.set(originalRepoId, []);
    }
    this.forksCache.get(originalRepoId)?.push(fork);

    // Update user profile
    const userProfile = await this.getUser(forker);
    if (!userProfile.repositories.includes(result.repoId)) {
      userProfile.repositories.push(result.repoId);
    }

    // Get the created repo
    const forkedRepo = await this.repoManager.getRepository(result.repoId);
    if (!forkedRepo) {
      throw new Error('Failed to create fork');
    }

    // Create contribution event
    const contributionEvent: ContributionEvent = {
      source: 'jeju-git',
      type: 'fork',
      repoId: originalRepoId,
      author: forker,
      timestamp: Date.now(),
      metadata: {},
    };

    return { fork, repo: forkedRepo, contributionEvent };
  }

  /**
   * Get forks of a repository
   */
  async getForks(
    repoId: Hex,
    options: { page?: number; perPage?: number } = {}
  ): Promise<{ forks: Array<Fork & { repo: Repository }>; total: number }> {
    const allForks = this.forksCache.get(repoId) || [];
    
    const page = options.page || 1;
    const perPage = options.perPage || 30;
    const start = (page - 1) * perPage;
    const paginatedForks = allForks.slice(start, start + perPage);

    const forksWithRepos: Array<Fork & { repo: Repository }> = [];
    for (const fork of paginatedForks) {
      const repo = await this.repoManager.getRepository(fork.forkedRepoId);
      if (repo) {
        forksWithRepos.push({ ...fork, repo });
      }
    }

    return { forks: forksWithRepos, total: allForks.length };
  }

  /**
   * Get fork count for a repo
   */
  getForkCount(repoId: Hex): number {
    return this.forksCache.get(repoId)?.length || 0;
  }

  /**
   * Check if repo is a fork
   */
  async getParentRepo(repoId: Hex): Promise<Repository | null> {
    // Search for this repo in fork lists
    for (const [parentId, forks] of this.forksCache) {
      const fork = forks.find(f => f.forkedRepoId === repoId);
      if (fork) {
        return this.repoManager.getRepository(parentId);
      }
    }
    return null;
  }

  // ============ Tier Management ============

  /**
   * Get user tier
   */
  async getUserTier(address: Address): Promise<UserTier> {
    const user = await this.getUser(address);
    return user.tier;
  }

  /**
   * Upgrade user tier (would typically involve payment)
   */
  async upgradeTier(address: Address, newTier: UserTier): Promise<GitUser> {
    const user = await this.getUser(address);
    user.tier = newTier;
    return user;
  }

  /**
   * Get tier features
   */
  getTierFeatures(tier: UserTier): {
    privateRepos: number;
    storageGB: number;
    collaboratorsPerRepo: number;
    ciMinutesPerMonth: number;
    largePushSizeMB: number;
  } {
    const features = {
      free: { privateRepos: 0, storageGB: 1, collaboratorsPerRepo: 3, ciMinutesPerMonth: 500, largePushSizeMB: 50 },
      basic: { privateRepos: 5, storageGB: 5, collaboratorsPerRepo: 10, ciMinutesPerMonth: 2000, largePushSizeMB: 100 },
      pro: { privateRepos: 50, storageGB: 50, collaboratorsPerRepo: 50, ciMinutesPerMonth: 10000, largePushSizeMB: 500 },
      unlimited: { privateRepos: -1, storageGB: 1000, collaboratorsPerRepo: -1, ciMinutesPerMonth: -1, largePushSizeMB: 2000 },
    };
    return features[tier];
  }

  // ============ Persistence ============

  /**
   * Export social data for a repo
   */
  async exportRepoSocialData(repoId: Hex): Promise<{
    stars: Address[];
    forks: Fork[];
  }> {
    return {
      stars: Array.from(this.starsCache.get(repoId) || []),
      forks: this.forksCache.get(repoId) || [],
    };
  }

  /**
   * Import social data for a repo
   */
  async importRepoSocialData(
    repoId: Hex,
    data: { stars: Address[]; forks: Fork[] }
  ): Promise<void> {
    this.starsCache.set(repoId, new Set(data.stars));
    this.forksCache.set(repoId, data.forks);

    // Update user caches
    for (const address of data.stars) {
      let userStars = this.userStarsCache.get(address);
      if (!userStars) {
        userStars = new Set();
        this.userStarsCache.set(address, userStars);
      }
      userStars.add(repoId);
    }
  }
}

