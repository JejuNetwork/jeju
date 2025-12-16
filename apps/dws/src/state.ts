/**
 * Decentralized State Management for DWS
 * 
 * Persists compute jobs, storage pins, git repos, and package registrations to CovenantSQL.
 * Falls back to in-memory storage for localnet/testing.
 */

import { getCQL, type CQLClient } from '@jejunetwork/db';
import { getCacheClient, type CacheClient } from '@jejunetwork/shared';
import type { Address } from 'viem';

const CQL_DATABASE_ID = process.env.CQL_DATABASE_ID ?? 'dws';
const NETWORK = process.env.NETWORK ?? 'localnet';

let cqlClient: CQLClient | null = null;
let cacheClient: CacheClient | null = null;
let useFallback = false;
let initialized = false;

// In-memory fallback stores
const memoryComputeJobs = new Map<string, ComputeJobRow>();
const memoryStoragePins = new Map<string, StoragePinRow>();
const memoryGitRepos = new Map<string, GitRepoRow>();
const memoryPackages = new Map<string, PackageRow>();
const memoryApiListings = new Map<string, ApiListingRow>();
const memoryApiUserAccounts = new Map<string, ApiUserAccountRow>();

let cqlInitPromise: Promise<CQLClient | null> | null = null;

async function getCQLClient(): Promise<CQLClient | null> {
  if (useFallback) return null;
  
  // Use a singleton promise to prevent multiple concurrent initializations
  if (!cqlInitPromise) {
    cqlInitPromise = initCQLClient();
  }
  
  return cqlInitPromise;
}

async function initCQLClient(): Promise<CQLClient | null> {
  if (cqlClient) return cqlClient;
  
  try {
    cqlClient = getCQL({
      blockProducerEndpoint: process.env.CQL_BLOCK_PRODUCER_ENDPOINT ?? 'http://localhost:4300',
      databaseId: CQL_DATABASE_ID,
      timeout: 5000, // Reduce timeout for faster fallback
      debug: process.env.NODE_ENV !== 'production',
    });
    
    const healthy = await cqlClient.isHealthy();
    if (!healthy && (NETWORK === 'localnet' || NETWORK === 'Jeju')) {
      console.log('[DWS State] CQL unavailable, using in-memory fallback');
      useFallback = true;
      cqlClient = null;
      return null;
    }
    
    if (!healthy) {
      throw new Error(
        'DWS requires CovenantSQL for decentralized state.\n' +
        'Set CQL_BLOCK_PRODUCER_ENDPOINT or start: docker compose up -d'
      );
    }
    
    await ensureTablesExist();
    return cqlClient;
  } catch (error) {
    // On connection error, fall back to in-memory
    if (NETWORK === 'localnet' || NETWORK === 'Jeju') {
      console.log('[DWS State] CQL connection failed, using in-memory fallback');
      useFallback = true;
      cqlClient = null;
      return null;
    }
    throw error;
  }
}

function getCache(): CacheClient {
  if (!cacheClient) {
    cacheClient = getCacheClient('dws');
  }
  return cacheClient;
}

async function ensureTablesExist(): Promise<void> {
  if (!cqlClient) return;
  
  const tables = [
    `CREATE TABLE IF NOT EXISTS compute_jobs (
      job_id TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      shell TEXT NOT NULL DEFAULT 'bash',
      env TEXT NOT NULL DEFAULT '{}',
      working_dir TEXT,
      timeout INTEGER NOT NULL DEFAULT 300000,
      status TEXT NOT NULL DEFAULT 'queued',
      output TEXT DEFAULT '',
      exit_code INTEGER,
      submitted_by TEXT NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS storage_pins (
      cid TEXT PRIMARY KEY,
      name TEXT,
      size_bytes INTEGER NOT NULL,
      backend TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'hot',
      owner TEXT NOT NULL,
      permanent INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      expires_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS git_repos (
      repo_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      default_branch TEXT DEFAULT 'main',
      head_commit TEXT,
      is_public INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS packages (
      package_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      cid TEXT NOT NULL,
      owner TEXT NOT NULL,
      description TEXT,
      keywords TEXT DEFAULT '[]',
      dependencies TEXT DEFAULT '{}',
      downloads INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      UNIQUE(name, version)
    )`,
    `CREATE TABLE IF NOT EXISTS cron_triggers (
      trigger_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      schedule TEXT NOT NULL,
      webhook_url TEXT NOT NULL,
      owner TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_run INTEGER,
      next_run INTEGER,
      run_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS api_listings (
      listing_id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      seller TEXT NOT NULL,
      key_vault_id TEXT NOT NULL,
      price_per_request TEXT DEFAULT '0',
      limits TEXT DEFAULT '{}',
      access_control TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      total_requests INTEGER DEFAULT 0,
      total_revenue TEXT DEFAULT '0',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS api_user_accounts (
      address TEXT PRIMARY KEY,
      balance TEXT DEFAULT '0',
      total_spent TEXT DEFAULT '0',
      total_requests INTEGER DEFAULT 0,
      active_listings TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  ];
  
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_jobs_status ON compute_jobs(status)',
    'CREATE INDEX IF NOT EXISTS idx_jobs_submitter ON compute_jobs(submitted_by)',
    'CREATE INDEX IF NOT EXISTS idx_pins_owner ON storage_pins(owner)',
    'CREATE INDEX IF NOT EXISTS idx_repos_owner ON git_repos(owner)',
    'CREATE INDEX IF NOT EXISTS idx_packages_name ON packages(name)',
    'CREATE INDEX IF NOT EXISTS idx_packages_owner ON packages(owner)',
    'CREATE INDEX IF NOT EXISTS idx_triggers_owner ON cron_triggers(owner)',
    'CREATE INDEX IF NOT EXISTS idx_listings_seller ON api_listings(seller)',
    'CREATE INDEX IF NOT EXISTS idx_listings_provider ON api_listings(provider_id)',
  ];
  
  for (const ddl of tables) {
    await cqlClient.exec(ddl, [], CQL_DATABASE_ID);
  }
  
  for (const idx of indexes) {
    await cqlClient.exec(idx, [], CQL_DATABASE_ID).catch(() => {});
  }
  
  console.log('[DWS State] CovenantSQL tables ensured');
}

// Row types
interface ComputeJobRow {
  job_id: string;
  command: string;
  shell: string;
  env: string;
  working_dir: string | null;
  timeout: number;
  status: string;
  output: string;
  exit_code: number | null;
  submitted_by: string;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
}

interface StoragePinRow {
  cid: string;
  name: string | null;
  size_bytes: number;
  backend: string;
  tier: string;
  owner: string;
  permanent: number;
  created_at: number;
  expires_at: number | null;
}

interface GitRepoRow {
  repo_id: string;
  owner: string;
  name: string;
  description: string | null;
  default_branch: string;
  head_commit: string | null;
  is_public: number;
  created_at: number;
  updated_at: number;
}

interface PackageRow {
  package_id: string;
  name: string;
  version: string;
  cid: string;
  owner: string;
  description: string | null;
  keywords: string;
  dependencies: string;
  downloads: number;
  created_at: number;
}

interface ApiListingRow {
  listing_id: string;
  provider_id: string;
  seller: string;
  key_vault_id: string;
  price_per_request: string;
  limits: string;
  access_control: string;
  status: string;
  total_requests: number;
  total_revenue: string;
  created_at: number;
  updated_at: number;
}

interface ApiUserAccountRow {
  address: string;
  balance: string;
  total_spent: string;
  total_requests: number;
  active_listings: string;
  created_at: number;
  updated_at: number;
}

// Compute Job Operations
export const computeJobState = {
  async save(job: {
    jobId: string;
    command: string;
    shell: string;
    env: Record<string, string>;
    workingDir?: string;
    timeout: number;
    status: string;
    output: string;
    exitCode: number | null;
    submittedBy: Address;
    startedAt: number | null;
    completedAt: number | null;
  }): Promise<void> {
    const row: ComputeJobRow = {
      job_id: job.jobId,
      command: job.command,
      shell: job.shell,
      env: JSON.stringify(job.env),
      working_dir: job.workingDir ?? null,
      timeout: job.timeout,
      status: job.status,
      output: job.output,
      exit_code: job.exitCode,
      submitted_by: job.submittedBy.toLowerCase(),
      started_at: job.startedAt,
      completed_at: job.completedAt,
      created_at: Date.now(),
    };
    
    const client = await getCQLClient();
    if (client) {
      await client.exec(
        `INSERT INTO compute_jobs (job_id, command, shell, env, working_dir, timeout, status, output, exit_code, submitted_by, started_at, completed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET
         status = excluded.status, output = excluded.output, exit_code = excluded.exit_code,
         started_at = excluded.started_at, completed_at = excluded.completed_at`,
        [
          row.job_id, row.command, row.shell, row.env, row.working_dir, row.timeout,
          row.status, row.output, row.exit_code, row.submitted_by, row.started_at,
          row.completed_at, row.created_at,
        ],
        CQL_DATABASE_ID
      );
    } else {
      memoryComputeJobs.set(row.job_id, row);
    }
    
    // Invalidate cache (ignore errors - cache may not have the key)
    getCache().delete(`job:${row.job_id}`).catch(() => {});
  },
  
  async get(jobId: string): Promise<ComputeJobRow | null> {
    const client = await getCQLClient();
    if (client) {
      const result = await client.query<ComputeJobRow>(
        'SELECT * FROM compute_jobs WHERE job_id = ?',
        [jobId],
        CQL_DATABASE_ID
      );
      return result.rows[0] ?? null;
    }
    return memoryComputeJobs.get(jobId) ?? null;
  },
  
  async list(params?: { submittedBy?: string; status?: string; limit?: number }): Promise<ComputeJobRow[]> {
    const client = await getCQLClient();
    
    if (client) {
      const conditions: string[] = [];
      const values: Array<string | number> = [];
      
      if (params?.submittedBy) {
        conditions.push('submitted_by = ?');
        values.push(params.submittedBy.toLowerCase());
      }
      if (params?.status) {
        conditions.push('status = ?');
        values.push(params.status);
      }
      
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      values.push(params?.limit ?? 50);
      
      const result = await client.query<ComputeJobRow>(
        `SELECT * FROM compute_jobs ${where} ORDER BY created_at DESC LIMIT ?`,
        values,
        CQL_DATABASE_ID
      );
      return result.rows;
    }
    
    let rows = Array.from(memoryComputeJobs.values());
    if (params?.submittedBy) {
      rows = rows.filter(r => r.submitted_by === params.submittedBy!.toLowerCase());
    }
    if (params?.status) {
      rows = rows.filter(r => r.status === params.status);
    }
    rows.sort((a, b) => b.created_at - a.created_at);
    return rows.slice(0, params?.limit ?? 50);
  },
  
  async getQueued(): Promise<ComputeJobRow[]> {
    return this.list({ status: 'queued' });
  },
};

// Storage Pin Operations
export const storagePinState = {
  async save(pin: {
    cid: string;
    name?: string;
    sizeBytes: number;
    backend: string;
    tier: string;
    owner: Address;
    permanent?: boolean;
    expiresAt?: number;
  }): Promise<void> {
    const row: StoragePinRow = {
      cid: pin.cid,
      name: pin.name ?? null,
      size_bytes: pin.sizeBytes,
      backend: pin.backend,
      tier: pin.tier,
      owner: pin.owner.toLowerCase(),
      permanent: pin.permanent ? 1 : 0,
      created_at: Date.now(),
      expires_at: pin.expiresAt ?? null,
    };
    
    const client = await getCQLClient();
    if (client) {
      await client.exec(
        `INSERT INTO storage_pins (cid, name, size_bytes, backend, tier, owner, permanent, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(cid) DO UPDATE SET
         name = excluded.name, backend = excluded.backend, tier = excluded.tier`,
        [
          row.cid, row.name, row.size_bytes, row.backend, row.tier,
          row.owner, row.permanent, row.created_at, row.expires_at,
        ],
        CQL_DATABASE_ID
      );
    } else {
      memoryStoragePins.set(row.cid, row);
    }
  },
  
  async get(cid: string): Promise<StoragePinRow | null> {
    const client = await getCQLClient();
    if (client) {
      const result = await client.query<StoragePinRow>(
        'SELECT * FROM storage_pins WHERE cid = ?',
        [cid],
        CQL_DATABASE_ID
      );
      return result.rows[0] ?? null;
    }
    return memoryStoragePins.get(cid) ?? null;
  },
  
  async listByOwner(owner: Address): Promise<StoragePinRow[]> {
    const client = await getCQLClient();
    if (client) {
      const result = await client.query<StoragePinRow>(
        'SELECT * FROM storage_pins WHERE owner = ? ORDER BY created_at DESC',
        [owner.toLowerCase()],
        CQL_DATABASE_ID
      );
      return result.rows;
    }
    return Array.from(memoryStoragePins.values())
      .filter(r => r.owner === owner.toLowerCase())
      .sort((a, b) => b.created_at - a.created_at);
  },
  
  async delete(cid: string): Promise<boolean> {
    const client = await getCQLClient();
    if (client) {
      const result = await client.exec(
        'DELETE FROM storage_pins WHERE cid = ?',
        [cid],
        CQL_DATABASE_ID
      );
      return result.rowsAffected > 0;
    }
    return memoryStoragePins.delete(cid);
  },
};

// Git Repo Operations
export const gitRepoState = {
  async save(repo: {
    repoId: string;
    owner: Address;
    name: string;
    description?: string;
    defaultBranch?: string;
    headCommit?: string;
    isPublic?: boolean;
  }): Promise<void> {
    const now = Date.now();
    const row: GitRepoRow = {
      repo_id: repo.repoId,
      owner: repo.owner.toLowerCase(),
      name: repo.name,
      description: repo.description ?? null,
      default_branch: repo.defaultBranch ?? 'main',
      head_commit: repo.headCommit ?? null,
      is_public: repo.isPublic !== false ? 1 : 0,
      created_at: now,
      updated_at: now,
    };
    
    const client = await getCQLClient();
    if (client) {
      await client.exec(
        `INSERT INTO git_repos (repo_id, owner, name, description, default_branch, head_commit, is_public, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id) DO UPDATE SET
         description = excluded.description, head_commit = excluded.head_commit, updated_at = excluded.updated_at`,
        [
          row.repo_id, row.owner, row.name, row.description, row.default_branch,
          row.head_commit, row.is_public, row.created_at, row.updated_at,
        ],
        CQL_DATABASE_ID
      );
    } else {
      memoryGitRepos.set(row.repo_id, row);
    }
  },
  
  async get(repoId: string): Promise<GitRepoRow | null> {
    const client = await getCQLClient();
    if (client) {
      const result = await client.query<GitRepoRow>(
        'SELECT * FROM git_repos WHERE repo_id = ?',
        [repoId],
        CQL_DATABASE_ID
      );
      return result.rows[0] ?? null;
    }
    return memoryGitRepos.get(repoId) ?? null;
  },
  
  async listByOwner(owner: Address): Promise<GitRepoRow[]> {
    const client = await getCQLClient();
    if (client) {
      const result = await client.query<GitRepoRow>(
        'SELECT * FROM git_repos WHERE owner = ? ORDER BY updated_at DESC',
        [owner.toLowerCase()],
        CQL_DATABASE_ID
      );
      return result.rows;
    }
    return Array.from(memoryGitRepos.values())
      .filter(r => r.owner === owner.toLowerCase())
      .sort((a, b) => b.updated_at - a.updated_at);
  },
};

// Package Operations
export const packageState = {
  async save(pkg: {
    packageId: string;
    name: string;
    version: string;
    cid: string;
    owner: Address;
    description?: string;
    keywords?: string[];
    dependencies?: Record<string, string>;
  }): Promise<void> {
    const row: PackageRow = {
      package_id: pkg.packageId,
      name: pkg.name,
      version: pkg.version,
      cid: pkg.cid,
      owner: pkg.owner.toLowerCase(),
      description: pkg.description ?? null,
      keywords: JSON.stringify(pkg.keywords ?? []),
      dependencies: JSON.stringify(pkg.dependencies ?? {}),
      downloads: 0,
      created_at: Date.now(),
    };
    
    const client = await getCQLClient();
    if (client) {
      await client.exec(
        `INSERT INTO packages (package_id, name, version, cid, owner, description, keywords, dependencies, downloads, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name, version) DO UPDATE SET
         cid = excluded.cid, description = excluded.description, keywords = excluded.keywords, dependencies = excluded.dependencies`,
        [
          row.package_id, row.name, row.version, row.cid, row.owner,
          row.description, row.keywords, row.dependencies, row.downloads, row.created_at,
        ],
        CQL_DATABASE_ID
      );
    } else {
      memoryPackages.set(row.package_id, row);
    }
  },
  
  async get(name: string, version: string): Promise<PackageRow | null> {
    const client = await getCQLClient();
    if (client) {
      const result = await client.query<PackageRow>(
        'SELECT * FROM packages WHERE name = ? AND version = ?',
        [name, version],
        CQL_DATABASE_ID
      );
      return result.rows[0] ?? null;
    }
    return Array.from(memoryPackages.values()).find(
      p => p.name === name && p.version === version
    ) ?? null;
  },
  
  async getLatest(name: string): Promise<PackageRow | null> {
    const client = await getCQLClient();
    if (client) {
      const result = await client.query<PackageRow>(
        'SELECT * FROM packages WHERE name = ? ORDER BY created_at DESC LIMIT 1',
        [name],
        CQL_DATABASE_ID
      );
      return result.rows[0] ?? null;
    }
    return Array.from(memoryPackages.values())
      .filter(p => p.name === name)
      .sort((a, b) => b.created_at - a.created_at)[0] ?? null;
  },
  
  async incrementDownloads(name: string, version: string): Promise<void> {
    const client = await getCQLClient();
    if (client) {
      await client.exec(
        'UPDATE packages SET downloads = downloads + 1 WHERE name = ? AND version = ?',
        [name, version],
        CQL_DATABASE_ID
      );
    } else {
      const pkg = Array.from(memoryPackages.values()).find(
        p => p.name === name && p.version === version
      );
      if (pkg) pkg.downloads++;
    }
  },
};

// API Listing Operations
export const apiListingState = {
  async save(listing: {
    listingId: string;
    providerId: string;
    seller: Address;
    keyVaultId: string;
    pricePerRequest?: string;
    limits?: Record<string, number>;
    accessControl?: Record<string, string[]>;
    status?: string;
  }): Promise<void> {
    const now = Date.now();
    const row: ApiListingRow = {
      listing_id: listing.listingId,
      provider_id: listing.providerId,
      seller: listing.seller.toLowerCase(),
      key_vault_id: listing.keyVaultId,
      price_per_request: listing.pricePerRequest ?? '0',
      limits: JSON.stringify(listing.limits ?? {}),
      access_control: JSON.stringify(listing.accessControl ?? {}),
      status: listing.status ?? 'active',
      total_requests: 0,
      total_revenue: '0',
      created_at: now,
      updated_at: now,
    };
    
    const client = await getCQLClient();
    if (client) {
      await client.exec(
        `INSERT INTO api_listings (listing_id, provider_id, seller, key_vault_id, price_per_request, limits, access_control, status, total_requests, total_revenue, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(listing_id) DO UPDATE SET
         price_per_request = excluded.price_per_request, limits = excluded.limits, access_control = excluded.access_control, status = excluded.status, updated_at = excluded.updated_at`,
        [
          row.listing_id, row.provider_id, row.seller, row.key_vault_id,
          row.price_per_request, row.limits, row.access_control, row.status,
          row.total_requests, row.total_revenue, row.created_at, row.updated_at,
        ],
        CQL_DATABASE_ID
      );
    } else {
      memoryApiListings.set(row.listing_id, row);
    }
  },
  
  async get(listingId: string): Promise<ApiListingRow | null> {
    const client = await getCQLClient();
    if (client) {
      const result = await client.query<ApiListingRow>(
        'SELECT * FROM api_listings WHERE listing_id = ?',
        [listingId],
        CQL_DATABASE_ID
      );
      return result.rows[0] ?? null;
    }
    return memoryApiListings.get(listingId) ?? null;
  },
  
  async listBySeller(seller: Address): Promise<ApiListingRow[]> {
    const client = await getCQLClient();
    if (client) {
      const result = await client.query<ApiListingRow>(
        'SELECT * FROM api_listings WHERE seller = ? ORDER BY created_at DESC',
        [seller.toLowerCase()],
        CQL_DATABASE_ID
      );
      return result.rows;
    }
    return Array.from(memoryApiListings.values())
      .filter(r => r.seller === seller.toLowerCase())
      .sort((a, b) => b.created_at - a.created_at);
  },
  
  async incrementUsage(listingId: string, revenue: string): Promise<void> {
    const client = await getCQLClient();
    if (client) {
      await client.exec(
        `UPDATE api_listings SET total_requests = total_requests + 1, 
         total_revenue = CAST(CAST(total_revenue AS INTEGER) + ? AS TEXT), updated_at = ?
         WHERE listing_id = ?`,
        [parseInt(revenue), Date.now(), listingId],
        CQL_DATABASE_ID
      );
    } else {
      const listing = memoryApiListings.get(listingId);
      if (listing) {
        listing.total_requests++;
        listing.total_revenue = (BigInt(listing.total_revenue) + BigInt(revenue)).toString();
        listing.updated_at = Date.now();
      }
    }
  },
};

// API User Account Operations
export const apiUserAccountState = {
  async getOrCreate(address: Address): Promise<ApiUserAccountRow> {
    const addr = address.toLowerCase();
    const now = Date.now();
    
    const client = await getCQLClient();
    if (client) {
      const result = await client.query<ApiUserAccountRow>(
        'SELECT * FROM api_user_accounts WHERE address = ?',
        [addr],
        CQL_DATABASE_ID
      );
      
      if (result.rows[0]) return result.rows[0];
      
      const newAccount: ApiUserAccountRow = {
        address: addr,
        balance: '0',
        total_spent: '0',
        total_requests: 0,
        active_listings: '[]',
        created_at: now,
        updated_at: now,
      };
      
      await client.exec(
        `INSERT INTO api_user_accounts (address, balance, total_spent, total_requests, active_listings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [addr, '0', '0', 0, '[]', now, now],
        CQL_DATABASE_ID
      );
      
      return newAccount;
    }
    
    let account = memoryApiUserAccounts.get(addr);
    if (!account) {
      account = {
        address: addr,
        balance: '0',
        total_spent: '0',
        total_requests: 0,
        active_listings: '[]',
        created_at: now,
        updated_at: now,
      };
      memoryApiUserAccounts.set(addr, account);
    }
    return account;
  },
  
  async updateBalance(address: Address, delta: string): Promise<void> {
    const addr = address.toLowerCase();
    const now = Date.now();
    
    // Ensure account exists first
    await this.getOrCreate(address);
    
    const client = await getCQLClient();
    if (client) {
      await client.exec(
        `UPDATE api_user_accounts SET balance = CAST(CAST(balance AS INTEGER) + ? AS TEXT), updated_at = ?
         WHERE address = ?`,
        [parseInt(delta), now, addr],
        CQL_DATABASE_ID
      );
    } else {
      const account = memoryApiUserAccounts.get(addr);
      if (account) {
        account.balance = (BigInt(account.balance) + BigInt(delta)).toString();
        account.updated_at = now;
      }
    }
  },
  
  async recordRequest(address: Address, cost: string): Promise<void> {
    const addr = address.toLowerCase();
    const now = Date.now();
    
    const client = await getCQLClient();
    if (client) {
      await client.exec(
        `UPDATE api_user_accounts SET 
         total_requests = total_requests + 1,
         total_spent = CAST(CAST(total_spent AS INTEGER) + ? AS TEXT),
         balance = CAST(CAST(balance AS INTEGER) - ? AS TEXT),
         updated_at = ?
         WHERE address = ?`,
        [parseInt(cost), parseInt(cost), now, addr],
        CQL_DATABASE_ID
      );
    } else {
      const account = memoryApiUserAccounts.get(addr);
      if (account) {
        account.total_requests++;
        account.total_spent = (BigInt(account.total_spent) + BigInt(cost)).toString();
        account.balance = (BigInt(account.balance) - BigInt(cost)).toString();
        account.updated_at = now;
      }
    }
  },
};

// Initialize state
export async function initializeDWSState(): Promise<void> {
  if (initialized) return;
  await getCQLClient();
  initialized = true;
  console.log(`[DWS State] Initialized (${useFallback ? 'in-memory fallback' : 'CQL'})`);
}

// Get state mode
export function getStateMode(): 'cql' | 'memory' {
  return useFallback ? 'memory' : 'cql';
}
