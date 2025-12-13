/**
 * CovenantSQL Adapter for Leaderboard App
 * 
 * Replaces SQLite with decentralized CovenantSQL database.
 * Supports both CovenantSQL (production) and in-memory (development).
 */

import {
  CovenantSQLClient,
  createCovenantSQLClient,
  getCovenantSQLClient,
  MigrationManager,
  createTableMigration,
  type TableSchema,
} from '@jeju/shared/db';

// ============================================================================
// Types (from existing schema)
// ============================================================================

export interface Contributor {
  id: number;
  username: string;
  avatarUrl: string | null;
  name: string | null;
  score: number;
  walletAddress: string | null;
  walletVerified: boolean;
  agentId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PullRequest {
  id: number;
  githubId: number;
  repositoryId: number;
  authorId: number;
  title: string;
  url: string;
  state: string;
  merged: boolean;
  additions: number;
  deletions: number;
  complexity: number;
  impact: number;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
}

export interface Repository {
  id: number;
  githubId: number;
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WalletLink {
  id: number;
  contributorId: number;
  walletAddress: string;
  signature: string;
  message: string;
  verified: boolean;
  createdAt: string;
}

// ============================================================================
// Schemas
// ============================================================================

const CONTRIBUTORS_SCHEMA: TableSchema = {
  name: 'contributors',
  columns: [
    { name: 'id', type: 'INTEGER', nullable: false },
    { name: 'username', type: 'TEXT', nullable: false, unique: true },
    { name: 'avatar_url', type: 'TEXT', nullable: true },
    { name: 'name', type: 'TEXT', nullable: true },
    { name: 'score', type: 'INTEGER', nullable: false, default: 0 },
    { name: 'wallet_address', type: 'TEXT', nullable: true },
    { name: 'wallet_verified', type: 'BOOLEAN', nullable: false, default: false },
    { name: 'agent_id', type: 'BIGINT', nullable: true },
    { name: 'created_at', type: 'TIMESTAMP', nullable: false },
    { name: 'updated_at', type: 'TIMESTAMP', nullable: false },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_contributors_username', columns: ['username'], unique: true },
    { name: 'idx_contributors_score', columns: ['score'] },
    { name: 'idx_contributors_wallet', columns: ['wallet_address'] },
  ],
  consistency: 'strong',
};

const REPOSITORIES_SCHEMA: TableSchema = {
  name: 'repositories',
  columns: [
    { name: 'id', type: 'INTEGER', nullable: false },
    { name: 'github_id', type: 'BIGINT', nullable: false, unique: true },
    { name: 'name', type: 'TEXT', nullable: false },
    { name: 'full_name', type: 'TEXT', nullable: false },
    { name: 'url', type: 'TEXT', nullable: false },
    { name: 'description', type: 'TEXT', nullable: true },
    { name: 'stars', type: 'INTEGER', nullable: false, default: 0 },
    { name: 'forks', type: 'INTEGER', nullable: false, default: 0 },
    { name: 'open_issues', type: 'INTEGER', nullable: false, default: 0 },
    { name: 'language', type: 'TEXT', nullable: true },
    { name: 'created_at', type: 'TIMESTAMP', nullable: false },
    { name: 'updated_at', type: 'TIMESTAMP', nullable: false },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_repositories_github_id', columns: ['github_id'], unique: true },
    { name: 'idx_repositories_full_name', columns: ['full_name'] },
  ],
  consistency: 'eventual',
};

const PULL_REQUESTS_SCHEMA: TableSchema = {
  name: 'pull_requests',
  columns: [
    { name: 'id', type: 'INTEGER', nullable: false },
    { name: 'github_id', type: 'BIGINT', nullable: false, unique: true },
    { name: 'repository_id', type: 'INTEGER', nullable: false },
    { name: 'author_id', type: 'INTEGER', nullable: false },
    { name: 'title', type: 'TEXT', nullable: false },
    { name: 'url', type: 'TEXT', nullable: false },
    { name: 'state', type: 'TEXT', nullable: false },
    { name: 'merged', type: 'BOOLEAN', nullable: false, default: false },
    { name: 'additions', type: 'INTEGER', nullable: false, default: 0 },
    { name: 'deletions', type: 'INTEGER', nullable: false, default: 0 },
    { name: 'complexity', type: 'INTEGER', nullable: false, default: 0 },
    { name: 'impact', type: 'INTEGER', nullable: false, default: 0 },
    { name: 'created_at', type: 'TIMESTAMP', nullable: false },
    { name: 'merged_at', type: 'TIMESTAMP', nullable: true },
    { name: 'closed_at', type: 'TIMESTAMP', nullable: true },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_prs_github_id', columns: ['github_id'], unique: true },
    { name: 'idx_prs_author', columns: ['author_id'] },
    { name: 'idx_prs_repo', columns: ['repository_id'] },
    { name: 'idx_prs_merged_at', columns: ['merged_at'] },
  ],
  consistency: 'eventual',
};

const WALLET_LINKS_SCHEMA: TableSchema = {
  name: 'wallet_links',
  columns: [
    { name: 'id', type: 'INTEGER', nullable: false },
    { name: 'contributor_id', type: 'INTEGER', nullable: false },
    { name: 'wallet_address', type: 'TEXT', nullable: false },
    { name: 'signature', type: 'TEXT', nullable: false },
    { name: 'message', type: 'TEXT', nullable: false },
    { name: 'verified', type: 'BOOLEAN', nullable: false, default: false },
    { name: 'created_at', type: 'TIMESTAMP', nullable: false },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_wallet_links_contributor', columns: ['contributor_id'] },
    { name: 'idx_wallet_links_address', columns: ['wallet_address'] },
  ],
  consistency: 'strong',
};

// ============================================================================
// CovenantSQL Database Adapter
// ============================================================================

export class CovenantLeaderboardDB {
  private client: CovenantSQLClient | null = null;
  private inMemoryContributors: Map<number, Contributor> = new Map();
  private inMemoryRepos: Map<number, Repository> = new Map();
  private inMemoryPRs: Map<number, PullRequest> = new Map();
  private nextId = 1;
  private mode: 'covenant' | 'memory';

  constructor(mode: 'covenant' | 'memory' = 'memory') {
    this.mode = mode;
  }

  async initialize(): Promise<void> {
    if (this.mode === 'covenant') {
      this.client = getCovenantSQLClient();
      await this.client.initialize();
      await this.runMigrations();
    }
    console.log(`[LeaderboardDB] Initialized in ${this.mode} mode`);
  }

  private async runMigrations(): Promise<void> {
    if (!this.client) return;

    const migrationManager = new MigrationManager(this.client);
    migrationManager.register([
      createTableMigration(1, 'create_contributors', CONTRIBUTORS_SCHEMA),
      createTableMigration(2, 'create_repositories', REPOSITORIES_SCHEMA),
      createTableMigration(3, 'create_pull_requests', PULL_REQUESTS_SCHEMA),
      createTableMigration(4, 'create_wallet_links', WALLET_LINKS_SCHEMA),
    ]);

    const results = await migrationManager.up();
    for (const result of results) {
      console.log(`[LeaderboardDB] Migration ${result.name}: ${result.success ? 'OK' : 'FAILED'} (${result.duration}ms)`);
    }
  }

  // ============================================================================
  // Contributor Operations
  // ============================================================================

  async getContributor(id: number): Promise<Contributor | null> {
    if (this.mode === 'memory') {
      return this.inMemoryContributors.get(id) ?? null;
    }

    const result = await this.client!.selectOne<Record<string, unknown>>(
      'contributors',
      'id = $1',
      [id]
    );

    return result ? this.mapRowToContributor(result) : null;
  }

  async getContributorByUsername(username: string): Promise<Contributor | null> {
    if (this.mode === 'memory') {
      for (const c of this.inMemoryContributors.values()) {
        if (c.username === username) return c;
      }
      return null;
    }

    const result = await this.client!.selectOne<Record<string, unknown>>(
      'contributors',
      'username = $1',
      [username]
    );

    return result ? this.mapRowToContributor(result) : null;
  }

  async getTopContributors(limit = 100): Promise<Contributor[]> {
    if (this.mode === 'memory') {
      return Array.from(this.inMemoryContributors.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    }

    const rows = await this.client!.select<Record<string, unknown>>('contributors', {
      orderBy: 'score DESC',
      limit,
      consistency: 'eventual',
    });

    return rows.map(r => this.mapRowToContributor(r));
  }

  async upsertContributor(data: Omit<Contributor, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contributor> {
    const now = new Date().toISOString();
    const existing = await this.getContributorByUsername(data.username);

    if (existing) {
      // Update
      if (this.mode === 'memory') {
        const updated = { ...existing, ...data, updatedAt: now };
        this.inMemoryContributors.set(existing.id, updated);
        return updated;
      }

      await this.client!.update('contributors', {
        avatar_url: data.avatarUrl,
        name: data.name,
        score: data.score,
        wallet_address: data.walletAddress,
        wallet_verified: data.walletVerified,
        agent_id: data.agentId,
        updated_at: now,
      }, 'id = $1', [existing.id]);

      return { ...existing, ...data, updatedAt: now };
    } else {
      // Insert
      const id = this.mode === 'memory' ? this.nextId++ : 0;
      const contributor: Contributor = {
        id,
        ...data,
        createdAt: now,
        updatedAt: now,
      };

      if (this.mode === 'memory') {
        this.inMemoryContributors.set(id, contributor);
      } else {
        await this.client!.insert('contributors', {
          username: data.username,
          avatar_url: data.avatarUrl,
          name: data.name,
          score: data.score,
          wallet_address: data.walletAddress,
          wallet_verified: data.walletVerified,
          agent_id: data.agentId,
          created_at: now,
          updated_at: now,
        });
      }

      return contributor;
    }
  }

  async updateContributorScore(id: number, score: number): Promise<void> {
    const now = new Date().toISOString();

    if (this.mode === 'memory') {
      const contributor = this.inMemoryContributors.get(id);
      if (contributor) {
        this.inMemoryContributors.set(id, { ...contributor, score, updatedAt: now });
      }
      return;
    }

    await this.client!.update('contributors', { score, updated_at: now }, 'id = $1', [id]);
  }

  // ============================================================================
  // Repository Operations
  // ============================================================================

  async getRepository(id: number): Promise<Repository | null> {
    if (this.mode === 'memory') {
      return this.inMemoryRepos.get(id) ?? null;
    }

    const result = await this.client!.selectOne<Record<string, unknown>>(
      'repositories',
      'id = $1',
      [id],
      { consistency: 'eventual' }
    );

    return result ? this.mapRowToRepository(result) : null;
  }

  async upsertRepository(data: Omit<Repository, 'id' | 'createdAt' | 'updatedAt'>): Promise<Repository> {
    const now = new Date().toISOString();

    if (this.mode === 'memory') {
      for (const repo of this.inMemoryRepos.values()) {
        if (repo.githubId === data.githubId) {
          const updated = { ...repo, ...data, updatedAt: now };
          this.inMemoryRepos.set(repo.id, updated);
          return updated;
        }
      }

      const id = this.nextId++;
      const repository: Repository = { id, ...data, createdAt: now, updatedAt: now };
      this.inMemoryRepos.set(id, repository);
      return repository;
    }

    const existing = await this.client!.selectOne<Record<string, unknown>>(
      'repositories',
      'github_id = $1',
      [data.githubId]
    );

    if (existing) {
      await this.client!.update('repositories', {
        name: data.name,
        full_name: data.fullName,
        url: data.url,
        description: data.description,
        stars: data.stars,
        forks: data.forks,
        open_issues: data.openIssues,
        language: data.language,
        updated_at: now,
      }, 'github_id = $1', [data.githubId]);

      return this.mapRowToRepository({ ...existing, ...data, updated_at: now });
    }

    await this.client!.insert('repositories', {
      github_id: data.githubId,
      name: data.name,
      full_name: data.fullName,
      url: data.url,
      description: data.description,
      stars: data.stars,
      forks: data.forks,
      open_issues: data.openIssues,
      language: data.language,
      created_at: now,
      updated_at: now,
    });

    return { id: 0, ...data, createdAt: now, updatedAt: now };
  }

  // ============================================================================
  // Pull Request Operations
  // ============================================================================

  async getPullRequest(id: number): Promise<PullRequest | null> {
    if (this.mode === 'memory') {
      return this.inMemoryPRs.get(id) ?? null;
    }

    const result = await this.client!.selectOne<Record<string, unknown>>(
      'pull_requests',
      'id = $1',
      [id],
      { consistency: 'eventual' }
    );

    return result ? this.mapRowToPullRequest(result) : null;
  }

  async getContributorPullRequests(authorId: number, limit = 50): Promise<PullRequest[]> {
    if (this.mode === 'memory') {
      return Array.from(this.inMemoryPRs.values())
        .filter(pr => pr.authorId === authorId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);
    }

    const rows = await this.client!.select<Record<string, unknown>>('pull_requests', {
      where: 'author_id = $1',
      whereParams: [authorId],
      orderBy: 'created_at DESC',
      limit,
      consistency: 'eventual',
    });

    return rows.map(r => this.mapRowToPullRequest(r));
  }

  async upsertPullRequest(data: Omit<PullRequest, 'id'>): Promise<PullRequest> {
    if (this.mode === 'memory') {
      for (const pr of this.inMemoryPRs.values()) {
        if (pr.githubId === data.githubId) {
          const updated = { ...pr, ...data };
          this.inMemoryPRs.set(pr.id, updated);
          return updated;
        }
      }

      const id = this.nextId++;
      const pullRequest: PullRequest = { id, ...data };
      this.inMemoryPRs.set(id, pullRequest);
      return pullRequest;
    }

    const existing = await this.client!.selectOne<Record<string, unknown>>(
      'pull_requests',
      'github_id = $1',
      [data.githubId]
    );

    if (existing) {
      await this.client!.update('pull_requests', {
        title: data.title,
        state: data.state,
        merged: data.merged,
        additions: data.additions,
        deletions: data.deletions,
        complexity: data.complexity,
        impact: data.impact,
        merged_at: data.mergedAt,
        closed_at: data.closedAt,
      }, 'github_id = $1', [data.githubId]);

      return this.mapRowToPullRequest({ ...existing, ...data });
    }

    await this.client!.insert('pull_requests', {
      github_id: data.githubId,
      repository_id: data.repositoryId,
      author_id: data.authorId,
      title: data.title,
      url: data.url,
      state: data.state,
      merged: data.merged,
      additions: data.additions,
      deletions: data.deletions,
      complexity: data.complexity,
      impact: data.impact,
      created_at: data.createdAt,
      merged_at: data.mergedAt,
      closed_at: data.closedAt,
    });

    return { id: 0, ...data };
  }

  // ============================================================================
  // Stats Operations
  // ============================================================================

  async getLeaderboardStats(): Promise<{ totalContributors: number; totalPRs: number; totalRepositories: number }> {
    if (this.mode === 'memory') {
      return {
        totalContributors: this.inMemoryContributors.size,
        totalPRs: this.inMemoryPRs.size,
        totalRepositories: this.inMemoryRepos.size,
      };
    }

    const [contributors, prs, repos] = await Promise.all([
      this.client!.count('contributors'),
      this.client!.count('pull_requests'),
      this.client!.count('repositories'),
    ]);

    return {
      totalContributors: contributors,
      totalPRs: prs,
      totalRepositories: repos,
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private mapRowToContributor(row: Record<string, unknown>): Contributor {
    return {
      id: row.id as number,
      username: row.username as string,
      avatarUrl: row.avatar_url as string | null,
      name: row.name as string | null,
      score: row.score as number,
      walletAddress: row.wallet_address as string | null,
      walletVerified: row.wallet_verified as boolean,
      agentId: row.agent_id as number | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private mapRowToRepository(row: Record<string, unknown>): Repository {
    return {
      id: row.id as number,
      githubId: row.github_id as number,
      name: row.name as string,
      fullName: row.full_name as string,
      url: row.url as string,
      description: row.description as string | null,
      stars: row.stars as number,
      forks: row.forks as number,
      openIssues: row.open_issues as number,
      language: row.language as string | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private mapRowToPullRequest(row: Record<string, unknown>): PullRequest {
    return {
      id: row.id as number,
      githubId: row.github_id as number,
      repositoryId: row.repository_id as number,
      authorId: row.author_id as number,
      title: row.title as string,
      url: row.url as string,
      state: row.state as string,
      merged: row.merged as boolean,
      additions: row.additions as number,
      deletions: row.deletions as number,
      complexity: row.complexity as number,
      impact: row.impact as number,
      createdAt: row.created_at as string,
      mergedAt: row.merged_at as string | null,
      closedAt: row.closed_at as string | null,
    };
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let globalDB: CovenantLeaderboardDB | null = null;

export function getLeaderboardDB(): CovenantLeaderboardDB {
  if (globalDB) return globalDB;

  const mode = process.env.COVENANTSQL_NODES ? 'covenant' : 'memory';
  globalDB = new CovenantLeaderboardDB(mode);

  return globalDB;
}

export async function initializeLeaderboardDB(): Promise<CovenantLeaderboardDB> {
  const db = getLeaderboardDB();
  await db.initialize();
  return db;
}

export function resetLeaderboardDB(): void {
  globalDB = null;
}

