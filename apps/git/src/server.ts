/**
 * JejuGit Server - Decentralized Git Server
 * 
 * A fully decentralized Git server that stores repository data on IPFS/Arweave
 * with on-chain registry for discovery and verification.
 * 
 * Features:
 * - Git Smart HTTP Protocol support
 * - IPFS/Arweave storage backend (data permanence)
 * - JNS integration for human-readable repo names
 * - x402 payments for private repos
 * - ERC-8004 reputation integration
 * - Federation support (ActivityPub)
 * - Council/Deep Funding integration
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { mkdir, writeFile, readFile, readdir, stat, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Context } from 'hono';

export type StorageBackend = 'ipfs' | 'arweave' | 'hybrid';
export type RepoVisibility = 'public' | 'private' | 'internal';

export interface GitServerConfig {
  storageBackend: StorageBackend;
  ipfsUrl: string;
  arweaveUrl: string;
  privateKey?: string;
  paymentRecipient: string;
  tempDir: string;
  cacheEnabled: boolean;
  cacheTTL: number;
  federationEnabled: boolean;
  federationUrl?: string;
}

export interface Repository {
  id: string;
  name: string;
  owner: string;
  description?: string;
  visibility: RepoVisibility;
  defaultBranch: string;
  headCid: string;
  branches: Record<string, string>; // branch name -> commit CID
  tags: Record<string, string>; // tag name -> commit CID
  packCid?: string; // Full pack file CID
  storageBackend: StorageBackend;
  createdAt: number;
  updatedAt: number;
  pushedAt?: number;
  cloneCount: number;
  starCount: number;
  forkCount: number;
  forkedFrom?: string;
  reputationScore?: number;
  councilProposalId?: string;
  contributors: string[];
  topics: string[];
  license?: string;
  website?: string;
  verified: boolean;
}

export interface GitUser {
  address: string;
  username?: string;
  jnsName?: string;
  email?: string;
  publicKey?: string;
  repositories: string[];
  starredRepos: string[];
  balance: bigint;
  stakedAmount: bigint;
  tier: 'free' | 'basic' | 'pro' | 'unlimited';
  reputationScore: number;
  createdAt: number;
  lastActivity: number;
}

export interface Commit {
  sha: string;
  cid: string;
  message: string;
  author: { name: string; email: string; date: string };
  committer: { name: string; email: string; date: string };
  parents: string[];
  tree: string;
}

export interface GitReference {
  ref: string;
  sha: string;
  cid: string;
}

export interface Issue {
  id: string;
  repoId: string;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  author: string;
  assignees: string[];
  labels: string[];
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  comments: Array<{ author: string; body: string; createdAt: number }>;
  cid: string;
}

export interface PullRequest {
  id: string;
  repoId: string;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  author: string;
  sourceBranch: string;
  targetBranch: string;
  sourceRepo?: string;
  commits: string[];
  reviewers: string[];
  reviews: Array<{ author: string; state: 'approved' | 'changes_requested' | 'commented'; body?: string; createdAt: number }>;
  labels: string[];
  createdAt: number;
  updatedAt: number;
  mergedAt?: number;
  closedAt?: number;
  mergedBy?: string;
  cid: string;
}

interface CacheEntry {
  data: Buffer | string;
  timestamp: number;
}

export class JejuGitServer {
  private config: GitServerConfig;
  private repositories: Map<string, Repository> = new Map();
  private users: Map<string, GitUser> = new Map();
  private issues: Map<string, Issue> = new Map();
  private pullRequests: Map<string, PullRequest> = new Map();
  private cache: Map<string, CacheEntry> = new Map();
  private objectCache: Map<string, Buffer> = new Map(); // CID -> git object

  constructor(config: Partial<GitServerConfig> = {}) {
    this.config = {
      storageBackend: 'hybrid',
      ipfsUrl: process.env.IPFS_API_URL ?? 'http://localhost:5001',
      arweaveUrl: process.env.ARWEAVE_GATEWAY ?? 'https://arweave.net',
      privateKey: process.env.PRIVATE_KEY,
      paymentRecipient: process.env.GIT_PAYMENT_RECIPIENT ?? '0x0000000000000000000000000000000000000000',
      tempDir: join(tmpdir(), 'jejugit'),
      cacheEnabled: true,
      cacheTTL: 300000,
      federationEnabled: false,
      ...config,
    };
  }

  createRouter(): Hono {
    const app = new Hono();
    app.use('/*', cors());

    // API routes
    app.get('/api/v1/repos', async (c) => this.handleListRepos(c));
    app.get('/api/v1/repos/:owner/:repo', async (c) => this.handleGetRepo(c));
    app.post('/api/v1/repos', async (c) => this.handleCreateRepo(c));
    app.patch('/api/v1/repos/:owner/:repo', async (c) => this.handleUpdateRepo(c));
    app.delete('/api/v1/repos/:owner/:repo', async (c) => this.handleDeleteRepo(c));

    // Git operations
    app.get('/api/v1/repos/:owner/:repo/commits', async (c) => this.handleListCommits(c));
    app.get('/api/v1/repos/:owner/:repo/commits/:sha', async (c) => this.handleGetCommit(c));
    app.get('/api/v1/repos/:owner/:repo/branches', async (c) => this.handleListBranches(c));
    app.get('/api/v1/repos/:owner/:repo/tags', async (c) => this.handleListTags(c));
    app.get('/api/v1/repos/:owner/:repo/tree/:ref', async (c) => this.handleGetTree(c));
    app.get('/api/v1/repos/:owner/:repo/blob/:ref/*', async (c) => this.handleGetBlob(c));

    // Issues
    app.get('/api/v1/repos/:owner/:repo/issues', async (c) => this.handleListIssues(c));
    app.post('/api/v1/repos/:owner/:repo/issues', async (c) => this.handleCreateIssue(c));
    app.get('/api/v1/repos/:owner/:repo/issues/:number', async (c) => this.handleGetIssue(c));
    app.patch('/api/v1/repos/:owner/:repo/issues/:number', async (c) => this.handleUpdateIssue(c));

    // Pull Requests
    app.get('/api/v1/repos/:owner/:repo/pulls', async (c) => this.handleListPulls(c));
    app.post('/api/v1/repos/:owner/:repo/pulls', async (c) => this.handleCreatePull(c));
    app.get('/api/v1/repos/:owner/:repo/pulls/:number', async (c) => this.handleGetPull(c));
    app.patch('/api/v1/repos/:owner/:repo/pulls/:number', async (c) => this.handleUpdatePull(c));
    app.post('/api/v1/repos/:owner/:repo/pulls/:number/merge', async (c) => this.handleMergePull(c));

    // User operations
    app.get('/api/v1/users/:username', async (c) => this.handleGetUser(c));
    app.get('/api/v1/users/:username/repos', async (c) => this.handleUserRepos(c));

    // Stars and Forks
    app.post('/api/v1/repos/:owner/:repo/star', async (c) => this.handleStar(c));
    app.delete('/api/v1/repos/:owner/:repo/star', async (c) => this.handleUnstar(c));
    app.post('/api/v1/repos/:owner/:repo/fork', async (c) => this.handleFork(c));

    // Search
    app.get('/api/v1/search/repositories', async (c) => this.handleSearchRepos(c));
    app.get('/api/v1/search/code', async (c) => this.handleSearchCode(c));

    // Git Smart HTTP Protocol
    app.get('/:owner/:repo.git/info/refs', async (c) => this.handleInfoRefs(c));
    app.post('/:owner/:repo.git/git-upload-pack', async (c) => this.handleUploadPack(c));
    app.post('/:owner/:repo.git/git-receive-pack', async (c) => this.handleReceivePack(c));

    // Health check
    app.get('/api/v1/health', async (c) => this.handleHealth(c));

    // Federation
    if (this.config.federationEnabled) {
      app.get('/.well-known/nodeinfo', async (c) => this.handleNodeInfo(c));
      app.post('/inbox', async (c) => this.handleFederationInbox(c));
    }

    return app;
  }

  // Repository Management

  private async handleListRepos(c: Context): Promise<Response> {
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const perPage = parseInt(c.req.query('per_page') ?? '30', 10);
    const sort = c.req.query('sort') ?? 'updated';
    const visibility = c.req.query('visibility') as RepoVisibility | undefined;

    let repos = Array.from(this.repositories.values());

    // Filter by visibility
    if (visibility) {
      repos = repos.filter(r => r.visibility === visibility);
    } else {
      // Only show public repos by default
      repos = repos.filter(r => r.visibility === 'public');
    }

    // Sort
    if (sort === 'updated') {
      repos.sort((a, b) => b.updatedAt - a.updatedAt);
    } else if (sort === 'created') {
      repos.sort((a, b) => b.createdAt - a.createdAt);
    } else if (sort === 'stars') {
      repos.sort((a, b) => b.starCount - a.starCount);
    }

    // Paginate
    const start = (page - 1) * perPage;
    const paginatedRepos = repos.slice(start, start + perPage);

    return c.json({
      total_count: repos.length,
      items: paginatedRepos.map(r => this.formatRepo(r)),
    });
  }

  private async handleGetRepo(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const repoId = `${owner}/${repoName}`;

    const repo = this.repositories.get(repoId);
    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    // Check access for private repos
    if (repo.visibility === 'private') {
      const user = this.getUserFromRequest(c);
      if (!user || (repo.owner !== user && !repo.contributors.includes(user))) {
        return c.json({ error: 'Not authorized' }, 403);
      }
    }

    return c.json(this.formatRepo(repo));
  }

  private async handleCreateRepo(c: Context): Promise<Response> {
    const user = this.getUserFromRequest(c);
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const body = await c.req.json() as {
      name: string;
      description?: string;
      visibility?: RepoVisibility;
      defaultBranch?: string;
      topics?: string[];
      license?: string;
    };

    if (!body.name || !/^[a-zA-Z0-9._-]+$/.test(body.name)) {
      return c.json({ error: 'Invalid repository name' }, 400);
    }

    const repoId = `${user}/${body.name}`;
    if (this.repositories.has(repoId)) {
      return c.json({ error: 'Repository already exists' }, 409);
    }

    // Initialize empty repository
    const tempDir = join(this.config.tempDir, repoId);
    await mkdir(tempDir, { recursive: true });
    
    // Create bare git repository
    await this.execGit(tempDir, ['init', '--bare']);

    // Upload initial refs to storage
    const headCid = await this.uploadToStorage(Buffer.from('ref: refs/heads/main\n'), this.config.storageBackend);

    const repo: Repository = {
      id: repoId,
      name: body.name,
      owner: user,
      description: body.description,
      visibility: body.visibility ?? 'public',
      defaultBranch: body.defaultBranch ?? 'main',
      headCid,
      branches: {},
      tags: {},
      storageBackend: this.config.storageBackend,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cloneCount: 0,
      starCount: 0,
      forkCount: 0,
      contributors: [user],
      topics: body.topics ?? [],
      license: body.license,
      verified: false,
    };

    this.repositories.set(repoId, repo);

    // Update user's repos
    const userRecord = this.getOrCreateUser(user);
    userRecord.repositories.push(repoId);

    // Clean up temp dir
    await rm(tempDir, { recursive: true, force: true });

    return c.json(this.formatRepo(repo), 201);
  }

  private async handleUpdateRepo(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const repoId = `${owner}/${repoName}`;

    const repo = this.repositories.get(repoId);
    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const user = this.getUserFromRequest(c);
    if (repo.owner !== user) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    const body = await c.req.json() as {
      description?: string;
      visibility?: RepoVisibility;
      defaultBranch?: string;
      topics?: string[];
      website?: string;
    };

    if (body.description !== undefined) repo.description = body.description;
    if (body.visibility !== undefined) repo.visibility = body.visibility;
    if (body.defaultBranch !== undefined) repo.defaultBranch = body.defaultBranch;
    if (body.topics !== undefined) repo.topics = body.topics;
    if (body.website !== undefined) repo.website = body.website;
    repo.updatedAt = Date.now();

    return c.json(this.formatRepo(repo));
  }

  private async handleDeleteRepo(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const repoId = `${owner}/${repoName}`;

    const repo = this.repositories.get(repoId);
    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const user = this.getUserFromRequest(c);
    if (repo.owner !== user) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    // Note: We don't delete from IPFS/Arweave (data permanence)
    // Just remove from our index
    this.repositories.delete(repoId);

    const userRecord = this.users.get(user);
    if (userRecord) {
      userRecord.repositories = userRecord.repositories.filter(r => r !== repoId);
    }

    return c.json({ ok: true });
  }

  // Git Smart HTTP Protocol

  private async handleInfoRefs(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const repoId = `${owner}/${repoName}`;
    const service = c.req.query('service');

    const repo = this.repositories.get(repoId);
    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    // Check access
    if (repo.visibility === 'private') {
      const user = this.getUserFromRequest(c);
      if (!user || (repo.owner !== user && !repo.contributors.includes(user))) {
        return c.json({ error: 'Not authorized' }, 403);
      }
    }

    // Increment clone count for upload-pack
    if (service === 'git-upload-pack') {
      repo.cloneCount++;
    }

    // Build refs response
    const refs = this.buildRefsResponse(repo, service ?? 'git-upload-pack');
    
    c.header('Content-Type', `application/x-${service ?? 'git-upload-pack'}-advertisement`);
    c.header('Cache-Control', 'no-cache');
    
    return c.body(refs);
  }

  private async handleUploadPack(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const repoId = `${owner}/${repoName}`;

    const repo = this.repositories.get(repoId);
    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    // Check access
    if (repo.visibility === 'private') {
      const user = this.getUserFromRequest(c);
      if (!user || (repo.owner !== user && !repo.contributors.includes(user))) {
        return c.json({ error: 'Not authorized' }, 403);
      }
    }

    const body = await c.req.arrayBuffer();
    
    // Create temporary repo and run git-upload-pack
    const tempDir = await this.prepareRepoForPack(repo);
    const result = await this.runGitService(tempDir, 'upload-pack', Buffer.from(body));
    await rm(tempDir, { recursive: true, force: true });

    c.header('Content-Type', 'application/x-git-upload-pack-result');
    return c.body(result);
  }

  private async handleReceivePack(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const repoId = `${owner}/${repoName}`;

    const repo = this.repositories.get(repoId);
    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    // Check write access
    const user = this.getUserFromRequest(c);
    if (!user || (repo.owner !== user && !repo.contributors.includes(user))) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    const body = await c.req.arrayBuffer();

    // Create temporary repo and run git-receive-pack
    const tempDir = await this.prepareRepoForPack(repo);
    const result = await this.runGitService(tempDir, 'receive-pack', Buffer.from(body));

    // Extract new objects and upload to storage
    await this.syncRepoToStorage(tempDir, repo);
    
    await rm(tempDir, { recursive: true, force: true });

    repo.pushedAt = Date.now();
    repo.updatedAt = Date.now();

    // Add user to contributors if not already
    if (!repo.contributors.includes(user)) {
      repo.contributors.push(user);
    }

    c.header('Content-Type', 'application/x-git-receive-pack-result');
    return c.body(result);
  }

  // Issues

  private async handleListIssues(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const repoId = `${owner}/${repoName}`;
    const state = c.req.query('state') ?? 'open';

    const repo = this.repositories.get(repoId);
    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const issues = Array.from(this.issues.values())
      .filter(i => i.repoId === repoId && (state === 'all' || i.state === state))
      .sort((a, b) => b.createdAt - a.createdAt);

    return c.json(issues);
  }

  private async handleCreateIssue(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const repoId = `${owner}/${repoName}`;

    const repo = this.repositories.get(repoId);
    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const user = this.getUserFromRequest(c);
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const body = await c.req.json() as {
      title: string;
      body?: string;
      labels?: string[];
      assignees?: string[];
    };

    const issueNumber = Array.from(this.issues.values()).filter(i => i.repoId === repoId).length + 1;
    const issueId = `${repoId}#${issueNumber}`;

    const issue: Issue = {
      id: issueId,
      repoId,
      number: issueNumber,
      title: body.title,
      body: body.body ?? '',
      state: 'open',
      author: user,
      assignees: body.assignees ?? [],
      labels: body.labels ?? [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      comments: [],
      cid: '', // Will be set after storage
    };

    // Store issue data
    const issueData = Buffer.from(JSON.stringify(issue));
    issue.cid = await this.uploadToStorage(issueData, this.config.storageBackend);

    this.issues.set(issueId, issue);

    return c.json(issue, 201);
  }

  private async handleGetIssue(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const number = parseInt(c.req.param('number'), 10);
    const issueId = `${owner}/${repoName}#${number}`;

    const issue = this.issues.get(issueId);
    if (!issue) {
      return c.json({ error: 'Issue not found' }, 404);
    }

    return c.json(issue);
  }

  private async handleUpdateIssue(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const number = parseInt(c.req.param('number'), 10);
    const issueId = `${owner}/${repoName}#${number}`;

    const issue = this.issues.get(issueId);
    if (!issue) {
      return c.json({ error: 'Issue not found' }, 404);
    }

    const user = this.getUserFromRequest(c);
    const repo = this.repositories.get(issue.repoId);
    if (!user || (issue.author !== user && repo?.owner !== user)) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    const body = await c.req.json() as {
      title?: string;
      body?: string;
      state?: 'open' | 'closed';
      labels?: string[];
      assignees?: string[];
    };

    if (body.title !== undefined) issue.title = body.title;
    if (body.body !== undefined) issue.body = body.body;
    if (body.state !== undefined) {
      issue.state = body.state;
      if (body.state === 'closed') {
        issue.closedAt = Date.now();
      }
    }
    if (body.labels !== undefined) issue.labels = body.labels;
    if (body.assignees !== undefined) issue.assignees = body.assignees;
    issue.updatedAt = Date.now();

    // Update stored data
    const issueData = Buffer.from(JSON.stringify(issue));
    issue.cid = await this.uploadToStorage(issueData, this.config.storageBackend);

    return c.json(issue);
  }

  // Pull Requests

  private async handleListPulls(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const repoId = `${owner}/${repoName}`;
    const state = c.req.query('state') ?? 'open';

    const prs = Array.from(this.pullRequests.values())
      .filter(pr => pr.repoId === repoId && (state === 'all' || pr.state === state))
      .sort((a, b) => b.createdAt - a.createdAt);

    return c.json(prs);
  }

  private async handleCreatePull(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const repoId = `${owner}/${repoName}`;

    const repo = this.repositories.get(repoId);
    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const user = this.getUserFromRequest(c);
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const body = await c.req.json() as {
      title: string;
      body?: string;
      sourceBranch: string;
      targetBranch?: string;
      sourceRepo?: string;
    };

    const prNumber = Array.from(this.pullRequests.values()).filter(pr => pr.repoId === repoId).length + 1;
    const prId = `${repoId}!${prNumber}`;

    const pr: PullRequest = {
      id: prId,
      repoId,
      number: prNumber,
      title: body.title,
      body: body.body ?? '',
      state: 'open',
      author: user,
      sourceBranch: body.sourceBranch,
      targetBranch: body.targetBranch ?? repo.defaultBranch,
      sourceRepo: body.sourceRepo,
      commits: [],
      reviewers: [],
      reviews: [],
      labels: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cid: '',
    };

    const prData = Buffer.from(JSON.stringify(pr));
    pr.cid = await this.uploadToStorage(prData, this.config.storageBackend);

    this.pullRequests.set(prId, pr);

    return c.json(pr, 201);
  }

  private async handleGetPull(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const number = parseInt(c.req.param('number'), 10);
    const prId = `${owner}/${repoName}!${number}`;

    const pr = this.pullRequests.get(prId);
    if (!pr) {
      return c.json({ error: 'Pull request not found' }, 404);
    }

    return c.json(pr);
  }

  private async handleUpdatePull(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const number = parseInt(c.req.param('number'), 10);
    const prId = `${owner}/${repoName}!${number}`;

    const pr = this.pullRequests.get(prId);
    if (!pr) {
      return c.json({ error: 'Pull request not found' }, 404);
    }

    const user = this.getUserFromRequest(c);
    const repo = this.repositories.get(pr.repoId);
    if (!user || (pr.author !== user && repo?.owner !== user)) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    const body = await c.req.json() as {
      title?: string;
      body?: string;
      state?: 'open' | 'closed';
    };

    if (body.title !== undefined) pr.title = body.title;
    if (body.body !== undefined) pr.body = body.body;
    if (body.state !== undefined) {
      pr.state = body.state;
      if (body.state === 'closed') {
        pr.closedAt = Date.now();
      }
    }
    pr.updatedAt = Date.now();

    const prData = Buffer.from(JSON.stringify(pr));
    pr.cid = await this.uploadToStorage(prData, this.config.storageBackend);

    return c.json(pr);
  }

  private async handleMergePull(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const number = parseInt(c.req.param('number'), 10);
    const prId = `${owner}/${repoName}!${number}`;

    const pr = this.pullRequests.get(prId);
    if (!pr) {
      return c.json({ error: 'Pull request not found' }, 404);
    }

    const user = this.getUserFromRequest(c);
    const repo = this.repositories.get(pr.repoId);
    if (!user || repo?.owner !== user) {
      return c.json({ error: 'Not authorized to merge' }, 403);
    }

    // In a real implementation, this would perform the git merge
    pr.state = 'merged';
    pr.mergedAt = Date.now();
    pr.mergedBy = user;
    pr.updatedAt = Date.now();

    return c.json(pr);
  }

  // Search

  private async handleSearchRepos(c: Context): Promise<Response> {
    const q = c.req.query('q') ?? '';
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const perPage = parseInt(c.req.query('per_page') ?? '30', 10);

    const repos = Array.from(this.repositories.values())
      .filter(r => {
        if (r.visibility !== 'public') return false;
        const searchText = `${r.name} ${r.description ?? ''} ${r.topics.join(' ')}`.toLowerCase();
        return searchText.includes(q.toLowerCase());
      })
      .sort((a, b) => b.starCount - a.starCount);

    const start = (page - 1) * perPage;
    const paginatedRepos = repos.slice(start, start + perPage);

    return c.json({
      total_count: repos.length,
      items: paginatedRepos.map(r => this.formatRepo(r)),
    });
  }

  private async handleSearchCode(c: Context): Promise<Response> {
    // Simplified code search - would need full-text indexing in production
    return c.json({ total_count: 0, items: [] });
  }

  // Stars and Forks

  private async handleStar(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const repoId = `${owner}/${repoName}`;

    const repo = this.repositories.get(repoId);
    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const user = this.getUserFromRequest(c);
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const userRecord = this.getOrCreateUser(user);
    if (!userRecord.starredRepos.includes(repoId)) {
      userRecord.starredRepos.push(repoId);
      repo.starCount++;
    }

    return c.json({ starred: true });
  }

  private async handleUnstar(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const repoId = `${owner}/${repoName}`;

    const repo = this.repositories.get(repoId);
    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const user = this.getUserFromRequest(c);
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const userRecord = this.users.get(user);
    if (userRecord) {
      const idx = userRecord.starredRepos.indexOf(repoId);
      if (idx >= 0) {
        userRecord.starredRepos.splice(idx, 1);
        repo.starCount--;
      }
    }

    return c.json({ starred: false });
  }

  private async handleFork(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const repoId = `${owner}/${repoName}`;

    const repo = this.repositories.get(repoId);
    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const user = this.getUserFromRequest(c);
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const forkedRepoId = `${user}/${repoName}`;
    if (this.repositories.has(forkedRepoId)) {
      return c.json({ error: 'Fork already exists' }, 409);
    }

    const forkedRepo: Repository = {
      ...repo,
      id: forkedRepoId,
      owner: user,
      forkedFrom: repoId,
      starCount: 0,
      forkCount: 0,
      cloneCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contributors: [user],
    };

    this.repositories.set(forkedRepoId, forkedRepo);
    repo.forkCount++;

    const userRecord = this.getOrCreateUser(user);
    userRecord.repositories.push(forkedRepoId);

    return c.json(this.formatRepo(forkedRepo), 201);
  }

  // User operations

  private async handleGetUser(c: Context): Promise<Response> {
    const username = c.req.param('username');
    const user = this.users.get(username);
    
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({
      login: user.username ?? user.address,
      address: user.address,
      jns_name: user.jnsName,
      public_repos: user.repositories.filter(r => {
        const repo = this.repositories.get(r);
        return repo?.visibility === 'public';
      }).length,
      followers: 0,
      following: 0,
      reputation_score: user.reputationScore,
      created_at: new Date(user.createdAt).toISOString(),
    });
  }

  private async handleUserRepos(c: Context): Promise<Response> {
    const username = c.req.param('username');
    const user = this.users.get(username);
    
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const repos = user.repositories
      .map(id => this.repositories.get(id))
      .filter((r): r is Repository => r !== undefined && r.visibility === 'public')
      .map(r => this.formatRepo(r));

    return c.json(repos);
  }

  // Git operations helpers

  private async handleListCommits(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const repoId = `${owner}/${repoName}`;

    const repo = this.repositories.get(repoId);
    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    // Return stored commits - in production would traverse git history
    return c.json([]);
  }

  private async handleGetCommit(c: Context): Promise<Response> {
    return c.json({ error: 'Not implemented' }, 501);
  }

  private async handleListBranches(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const repoId = `${owner}/${repoName}`;

    const repo = this.repositories.get(repoId);
    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    return c.json(Object.entries(repo.branches).map(([name, sha]) => ({
      name,
      commit: { sha },
      protected: name === repo.defaultBranch,
    })));
  }

  private async handleListTags(c: Context): Promise<Response> {
    const owner = c.req.param('owner');
    const repoName = c.req.param('repo');
    const repoId = `${owner}/${repoName}`;

    const repo = this.repositories.get(repoId);
    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    return c.json(Object.entries(repo.tags).map(([name, sha]) => ({
      name,
      commit: { sha },
    })));
  }

  private async handleGetTree(c: Context): Promise<Response> {
    return c.json({ error: 'Not implemented' }, 501);
  }

  private async handleGetBlob(c: Context): Promise<Response> {
    return c.json({ error: 'Not implemented' }, 501);
  }

  // Health check

  private async handleHealth(c: Context): Promise<Response> {
    const ipfsHealthy = await this.checkStorageHealth('ipfs');
    const arweaveHealthy = await this.checkStorageHealth('arweave');

    return c.json({
      status: ipfsHealthy || arweaveHealthy ? 'healthy' : 'degraded',
      storageBackend: this.config.storageBackend,
      ipfs: ipfsHealthy,
      arweave: arweaveHealthy,
      totalRepositories: this.repositories.size,
      totalUsers: this.users.size,
      totalIssues: this.issues.size,
      totalPullRequests: this.pullRequests.size,
      federationEnabled: this.config.federationEnabled,
    });
  }

  // Federation

  private async handleNodeInfo(c: Context): Promise<Response> {
    return c.json({
      links: [{
        rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1',
        href: `${c.req.url.split('/.well-known')[0]}/nodeinfo/2.1`,
      }],
    });
  }

  private async handleFederationInbox(c: Context): Promise<Response> {
    // Handle ActivityPub messages for federation
    const activity = await c.req.json();
    console.log('[JejuGit] Received federation activity:', activity.type);
    return c.json({ ok: true });
  }

  // Helper methods

  private buildRefsResponse(repo: Repository, service: string): Buffer {
    const lines: string[] = [];
    
    // Service announcement
    const serviceLine = `# service=${service}\n`;
    lines.push(this.pktLine(serviceLine));
    lines.push('0000'); // flush-pkt
    
    // Capabilities
    const caps = 'multi_ack thin-pack side-band side-band-64k ofs-delta shallow deepen-since deepen-not deepen-relative no-progress include-tag multi_ack_detailed allow-tip-sha1-in-want allow-reachable-sha1-in-want no-done symref=HEAD:refs/heads/' + repo.defaultBranch + ' agent=jejugit/1.0';
    
    // HEAD ref
    const headSha = repo.branches[repo.defaultBranch] ?? '0000000000000000000000000000000000000000';
    lines.push(this.pktLine(`${headSha} HEAD\0${caps}\n`));
    
    // Branch refs
    for (const [name, sha] of Object.entries(repo.branches)) {
      lines.push(this.pktLine(`${sha} refs/heads/${name}\n`));
    }
    
    // Tag refs
    for (const [name, sha] of Object.entries(repo.tags)) {
      lines.push(this.pktLine(`${sha} refs/tags/${name}\n`));
    }
    
    lines.push('0000'); // flush-pkt
    
    return Buffer.from(lines.join(''));
  }

  private pktLine(data: string): string {
    const length = data.length + 4;
    return length.toString(16).padStart(4, '0') + data;
  }

  private async prepareRepoForPack(repo: Repository): Promise<string> {
    const tempDir = join(this.config.tempDir, repo.id, Date.now().toString());
    await mkdir(tempDir, { recursive: true });
    
    // Initialize bare repo
    await this.execGit(tempDir, ['init', '--bare']);
    
    // If we have stored pack, fetch it
    if (repo.packCid) {
      const packData = await this.fetchFromStorage(repo.packCid, repo.storageBackend);
      if (packData) {
        const packDir = join(tempDir, 'objects', 'pack');
        await mkdir(packDir, { recursive: true });
        await writeFile(join(packDir, 'pack.pack'), Buffer.from(packData));
      }
    }
    
    return tempDir;
  }

  private async runGitService(repoDir: string, service: 'upload-pack' | 'receive-pack', input: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const proc = spawn(`git-${service}`, ['--stateless-rpc', repoDir]);
      const chunks: Buffer[] = [];
      
      proc.stdout.on('data', (chunk) => chunks.push(chunk));
      proc.stderr.on('data', (data) => console.error(`[git-${service}]`, data.toString()));
      proc.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`git-${service} exited with code ${code}`));
        }
      });
      
      proc.stdin.write(input);
      proc.stdin.end();
    });
  }

  private async syncRepoToStorage(repoDir: string, repo: Repository): Promise<void> {
    // Read refs and update repo
    const headsDir = join(repoDir, 'refs', 'heads');
    const tagsDir = join(repoDir, 'refs', 'tags');
    
    try {
      const heads = await readdir(headsDir).catch(() => [] as string[]);
      for (const branch of heads) {
        const sha = (await readFile(join(headsDir, branch), 'utf-8')).trim();
        repo.branches[branch] = sha;
      }
    } catch {
      // No branches yet
    }

    try {
      const tags = await readdir(tagsDir).catch(() => [] as string[]);
      for (const tag of tags) {
        const sha = (await readFile(join(tagsDir, tag), 'utf-8')).trim();
        repo.tags[tag] = sha;
      }
    } catch {
      // No tags yet
    }
    
    // Pack objects and upload
    await this.execGit(repoDir, ['gc']);
    
    const packDir = join(repoDir, 'objects', 'pack');
    try {
      const files = await readdir(packDir);
      const packFile = files.find(f => f.endsWith('.pack'));
      if (packFile) {
        const packData = await readFile(join(packDir, packFile));
        repo.packCid = await this.uploadToStorage(packData, this.config.storageBackend);
      }
    } catch {
      // No pack file
    }
  }

  private async execGit(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, { cwd });
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      
      proc.stdout.on('data', (chunk) => chunks.push(chunk));
      proc.stderr.on('data', (chunk) => errChunks.push(chunk));
      proc.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks).toString());
        } else {
          reject(new Error(`git ${args.join(' ')} failed: ${Buffer.concat(errChunks).toString()}`));
        }
      });
    });
  }

  private async uploadToStorage(data: Buffer, backend: StorageBackend): Promise<string> {
    if (backend === 'hybrid') {
      const [ipfsCid, arweaveCid] = await Promise.all([
        this.uploadToIPFS(data).catch(() => null),
        this.uploadToArweave(data).catch(() => null),
      ]);
      return ipfsCid ?? arweaveCid ?? '';
    }
    
    if (backend === 'ipfs') {
      return this.uploadToIPFS(data);
    }
    
    return this.uploadToArweave(data);
  }

  private async uploadToIPFS(data: Buffer): Promise<string> {
    const formData = new FormData();
    formData.append('file', new Blob([data]));

    const response = await fetch(`${this.config.ipfsUrl}/api/v0/add`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`IPFS upload failed: ${await response.text()}`);
    }

    const result = await response.json() as { Hash: string };
    return result.Hash;
  }

  private async uploadToArweave(data: Buffer): Promise<string> {
    if (!this.config.privateKey) {
      throw new Error('Private key required for Arweave uploads');
    }

    const { default: Irys } = await import('@irys/sdk');
    const irys = new Irys({
      url: 'https://devnet.irys.xyz',
      token: 'ethereum',
      key: this.config.privateKey.replace('0x', ''),
    });
    await irys.ready();

    const response = await irys.upload(data);
    return response.id;
  }

  private async fetchFromStorage(cid: string, backend: StorageBackend): Promise<ArrayBuffer | null> {
    // Check cache first
    const cached = this.objectCache.get(cid);
    if (cached) return cached.buffer;

    if (backend === 'ipfs' || backend === 'hybrid') {
      const response = await fetch(`${this.config.ipfsUrl}/api/v0/cat?arg=${cid}`, {
        method: 'POST',
      }).catch(() => null);
      
      if (response?.ok) {
        const data = await response.arrayBuffer();
        this.objectCache.set(cid, Buffer.from(data));
        return data;
      }
    }

    if (backend === 'arweave' || backend === 'hybrid') {
      const response = await fetch(`${this.config.arweaveUrl}/${cid}`).catch(() => null);
      if (response?.ok) {
        const data = await response.arrayBuffer();
        this.objectCache.set(cid, Buffer.from(data));
        return data;
      }
    }

    return null;
  }

  private async checkStorageHealth(backend: 'ipfs' | 'arweave'): Promise<boolean> {
    if (backend === 'ipfs') {
      const response = await fetch(`${this.config.ipfsUrl}/api/v0/id`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);
      return response?.ok ?? false;
    }

    const response = await fetch(`${this.config.arweaveUrl}/info`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    return response?.ok ?? false;
  }

  private getUserFromRequest(c: Context): string | null {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return null;

    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    if (authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const [username] = decoded.split(':');
      return username;
    }

    return null;
  }

  private getOrCreateUser(address: string): GitUser {
    let user = this.users.get(address);
    if (!user) {
      user = {
        address,
        repositories: [],
        starredRepos: [],
        balance: 0n,
        stakedAmount: 0n,
        tier: 'free',
        reputationScore: 0,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      this.users.set(address, user);
    }
    return user;
  }

  private formatRepo(repo: Repository): object {
    return {
      id: repo.id,
      name: repo.name,
      full_name: repo.id,
      owner: { login: repo.owner },
      description: repo.description,
      private: repo.visibility !== 'public',
      visibility: repo.visibility,
      default_branch: repo.defaultBranch,
      clone_url: `/${repo.id}.git`,
      html_url: `/repos/${repo.id}`,
      stargazers_count: repo.starCount,
      forks_count: repo.forkCount,
      open_issues_count: Array.from(this.issues.values()).filter(i => i.repoId === repo.id && i.state === 'open').length,
      topics: repo.topics,
      license: repo.license ? { name: repo.license } : null,
      forked_from: repo.forkedFrom,
      created_at: new Date(repo.createdAt).toISOString(),
      updated_at: new Date(repo.updatedAt).toISOString(),
      pushed_at: repo.pushedAt ? new Date(repo.pushedAt).toISOString() : null,
      reputation_score: repo.reputationScore,
      council_proposal_id: repo.councilProposalId,
      verified: repo.verified,
      storage_backend: repo.storageBackend,
      head_cid: repo.headCid,
    };
  }

  // Public methods for integration

  getRepository(id: string): Repository | undefined {
    return this.repositories.get(id);
  }

  getRepositories(): Repository[] {
    return Array.from(this.repositories.values());
  }

  getUser(address: string): GitUser | undefined {
    return this.users.get(address);
  }

  setReputationScore(repoId: string, score: number): void {
    const repo = this.repositories.get(repoId);
    if (repo) {
      repo.reputationScore = score;
    }
  }

  linkToCouncilProposal(repoId: string, proposalId: string): void {
    const repo = this.repositories.get(repoId);
    if (repo) {
      repo.councilProposalId = proposalId;
    }
  }
}

export function createJejuGitServer(config?: Partial<GitServerConfig>): JejuGitServer {
  return new JejuGitServer(config);
}

export function createJejuGitRouter(config?: Partial<GitServerConfig>): Hono {
  const server = createJejuGitServer(config);
  return server.createRouter();
}
