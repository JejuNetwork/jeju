import {
  getCurrentNetwork,
  getEQLiteMinerUrl,
  getEQLiteUrl,
} from '@jejunetwork/config'
import {
  type ExecResult,
  getEQLite,
  type QueryParam,
  type QueryResult,
  resetEQLite,
} from '@jejunetwork/db'
import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import type { Address } from 'viem'

const EQLITE_DATABASE_ID = process.env.EQLITE_DATABASE_ID ?? 'dws'

/**
 * Minimal interface for EQLite operations used by DWS state.
 * The test mock implements this interface with in-memory storage.
 */
interface MinimalEQLiteClient {
  isHealthy(): Promise<boolean>
  query<T>(
    sql: string,
    params: QueryParam[],
    dbId: string,
  ): Promise<QueryResult<T>>
  exec(sql: string, params: QueryParam[], dbId: string): Promise<ExecResult>
}

let eqliteClient: MinimalEQLiteClient | null = null
let cacheClient: CacheClient | null = null
let initialized = false
let initPromise: Promise<void> | null = null

// EQLite is always required - no in-memory fallback for serverless compatibility

async function getEQLiteClient(): Promise<MinimalEQLiteClient> {
  // Wait for initialization if in progress
  if (initPromise) {
    await initPromise
  }

  if (!eqliteClient) {
    // Reset any existing client to ensure fresh config
    resetEQLite()

    // Get URLs from centralized config (respects JEJU_NETWORK)
    const blockProducerEndpoint = getEQLiteUrl()
    const minerEndpoint = getEQLiteMinerUrl()

    eqliteClient = getEQLite({
      blockProducerEndpoint,
      minerEndpoint,
      databaseId: EQLITE_DATABASE_ID,
      timeout: 30000,
      debug: process.env.NODE_ENV !== 'production',
    })

    const healthy = await eqliteClient.isHealthy()
    if (!healthy) {
      eqliteClient = null
      const network = getCurrentNetwork()
      const message = `DWS requires EQLite for decentralized state (network: ${network}). Ensure EQLite is running: docker compose up -d eqlite`
      throw new Error(message)
    }

    await ensureTablesExist()
  }

  return eqliteClient
}

function getCache(): CacheClient {
  if (!cacheClient) {
    cacheClient = getCacheClient('dws')
  }
  return cacheClient
}

async function ensureTablesExist(): Promise<void> {
  if (!eqliteClient) return

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
    `CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT UNIQUE NOT NULL,
      address TEXT NOT NULL,
      name TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'FREE',
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL DEFAULT 0,
      request_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS x402_credits (
      address TEXT PRIMARY KEY,
      balance TEXT NOT NULL DEFAULT '0',
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS x402_nonces (
      nonce TEXT PRIMARY KEY,
      used_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS training_runs (
      run_id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      state INTEGER NOT NULL DEFAULT 0,
      clients INTEGER NOT NULL DEFAULT 0,
      step INTEGER NOT NULL DEFAULT 0,
      total_steps INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS training_nodes (
      address TEXT PRIMARY KEY,
      gpu_tier INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 100,
      latency_ms INTEGER NOT NULL DEFAULT 50,
      bandwidth_mbps INTEGER NOT NULL DEFAULT 1000,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_heartbeat INTEGER,
      created_at INTEGER NOT NULL
    )`,
  ]

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
    'CREATE INDEX IF NOT EXISTS idx_api_keys_address ON api_keys(address)',
    'CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)',
    'CREATE INDEX IF NOT EXISTS idx_training_runs_state ON training_runs(state)',
    'CREATE INDEX IF NOT EXISTS idx_training_nodes_active ON training_nodes(is_active)',
  ]

  for (const ddl of tables) {
    await eqliteClient.exec(ddl, [], EQLITE_DATABASE_ID)
  }

  for (const idx of indexes) {
    await eqliteClient.exec(idx, [], EQLITE_DATABASE_ID)
  }

  console.log('[DWS State] EQLite tables ensured')
}

// Row types
interface ComputeJobRow {
  job_id: string
  command: string
  shell: string
  env: string
  working_dir: string | null
  timeout: number
  status: string
  output: string
  exit_code: number | null
  submitted_by: string
  started_at: number | null
  completed_at: number | null
  created_at: number
}

interface StoragePinRow {
  cid: string
  name: string | null
  size_bytes: number
  backend: string
  tier: string
  owner: string
  permanent: number
  created_at: number
  expires_at: number | null
}

interface GitRepoRow {
  repo_id: string
  owner: string
  name: string
  description: string | null
  default_branch: string
  head_commit: string | null
  is_public: number
  created_at: number
  updated_at: number
}

interface PackageRow {
  package_id: string
  name: string
  version: string
  cid: string
  owner: string
  description: string | null
  keywords: string
  dependencies: string
  downloads: number
  created_at: number
}

interface ApiListingRow {
  listing_id: string
  provider_id: string
  seller: string
  key_vault_id: string
  price_per_request: string
  limits: string
  access_control: string
  status: string
  total_requests: number
  total_revenue: string
  created_at: number
  updated_at: number
}

interface ApiUserAccountRow {
  address: string
  balance: string
  total_spent: string
  total_requests: number
  active_listings: string
  created_at: number
  updated_at: number
}

// Compute Job Operations
export const computeJobState = {
  async save(job: {
    jobId: string
    command: string
    shell: string
    env: Record<string, string>
    workingDir?: string
    timeout: number
    status: string
    output: string
    exitCode: number | null
    submittedBy: Address
    startedAt: number | null
    completedAt: number | null
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
    }

    const client = await getEQLiteClient()
    await client.exec(
      `INSERT INTO compute_jobs (job_id, command, shell, env, working_dir, timeout, status, output, exit_code, submitted_by, started_at, completed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET
       status = excluded.status, output = excluded.output, exit_code = excluded.exit_code,
       started_at = excluded.started_at, completed_at = excluded.completed_at`,
      [
        row.job_id,
        row.command,
        row.shell,
        row.env,
        row.working_dir,
        row.timeout,
        row.status,
        row.output,
        row.exit_code,
        row.submitted_by,
        row.started_at,
        row.completed_at,
        row.created_at,
      ],
      EQLITE_DATABASE_ID,
    )

    await getCache().delete(`job:${row.job_id}`)
  },

  async get(jobId: string): Promise<ComputeJobRow | null> {
    const client = await getEQLiteClient()
    const result = await client.query<ComputeJobRow>(
      'SELECT * FROM compute_jobs WHERE job_id = ?',
      [jobId],
      EQLITE_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async list(params?: {
    submittedBy?: string
    status?: string
    limit?: number
  }): Promise<ComputeJobRow[]> {
    const client = await getEQLiteClient()
    const conditions: string[] = []
    const values: Array<string | number> = []

    if (params?.submittedBy) {
      conditions.push('submitted_by = ?')
      values.push(params.submittedBy.toLowerCase())
    }
    if (params?.status) {
      conditions.push('status = ?')
      values.push(params.status)
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    values.push(params?.limit ?? 50)

    const result = await client.query<ComputeJobRow>(
      `SELECT * FROM compute_jobs ${where} ORDER BY created_at DESC LIMIT ?`,
      values,
      EQLITE_DATABASE_ID,
    )
    return result.rows
  },

  async getQueued(): Promise<ComputeJobRow[]> {
    return this.list({ status: 'queued' })
  },
}

// Storage Pin Operations
export const storagePinState = {
  async save(pin: {
    cid: string
    name?: string
    sizeBytes: number
    backend: string
    tier: string
    owner: Address
    permanent?: boolean
    expiresAt?: number
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
    }

    const client = await getEQLiteClient()
    await client.exec(
      `INSERT INTO storage_pins (cid, name, size_bytes, backend, tier, owner, permanent, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cid) DO UPDATE SET
       name = excluded.name, backend = excluded.backend, tier = excluded.tier`,
      [
        row.cid,
        row.name,
        row.size_bytes,
        row.backend,
        row.tier,
        row.owner,
        row.permanent,
        row.created_at,
        row.expires_at,
      ],
      EQLITE_DATABASE_ID,
    )
  },

  async get(cid: string): Promise<StoragePinRow | null> {
    const client = await getEQLiteClient()
    const result = await client.query<StoragePinRow>(
      'SELECT * FROM storage_pins WHERE cid = ?',
      [cid],
      EQLITE_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async listByOwner(owner: Address): Promise<StoragePinRow[]> {
    const client = await getEQLiteClient()
    const result = await client.query<StoragePinRow>(
      'SELECT * FROM storage_pins WHERE owner = ? ORDER BY created_at DESC',
      [owner.toLowerCase()],
      EQLITE_DATABASE_ID,
    )
    return result.rows
  },

  async delete(cid: string): Promise<boolean> {
    const client = await getEQLiteClient()
    const result = await client.exec(
      'DELETE FROM storage_pins WHERE cid = ?',
      [cid],
      EQLITE_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },
}

// Git Repo Operations
export const gitRepoState = {
  async save(repo: {
    repoId: string
    owner: Address
    name: string
    description?: string
    defaultBranch?: string
    headCommit?: string
    isPublic?: boolean
  }): Promise<void> {
    const now = Date.now()
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
    }

    const client = await getEQLiteClient()
    await client.exec(
      `INSERT INTO git_repos (repo_id, owner, name, description, default_branch, head_commit, is_public, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo_id) DO UPDATE SET
       description = excluded.description, head_commit = excluded.head_commit, updated_at = excluded.updated_at`,
      [
        row.repo_id,
        row.owner,
        row.name,
        row.description,
        row.default_branch,
        row.head_commit,
        row.is_public,
        row.created_at,
        row.updated_at,
      ],
      EQLITE_DATABASE_ID,
    )
  },

  async get(repoId: string): Promise<GitRepoRow | null> {
    const client = await getEQLiteClient()
    const result = await client.query<GitRepoRow>(
      'SELECT * FROM git_repos WHERE repo_id = ?',
      [repoId],
      EQLITE_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async listByOwner(owner: Address): Promise<GitRepoRow[]> {
    const client = await getEQLiteClient()
    const result = await client.query<GitRepoRow>(
      'SELECT * FROM git_repos WHERE owner = ? ORDER BY updated_at DESC',
      [owner.toLowerCase()],
      EQLITE_DATABASE_ID,
    )
    return result.rows
  },
}

// Package Operations
export const packageState = {
  async save(pkg: {
    packageId: string
    name: string
    version: string
    cid: string
    owner: Address
    description?: string
    keywords?: string[]
    dependencies?: Record<string, string>
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
    }

    const client = await getEQLiteClient()
    await client.exec(
      `INSERT INTO packages (package_id, name, version, cid, owner, description, keywords, dependencies, downloads, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name, version) DO UPDATE SET
       cid = excluded.cid, description = excluded.description, keywords = excluded.keywords, dependencies = excluded.dependencies`,
      [
        row.package_id,
        row.name,
        row.version,
        row.cid,
        row.owner,
        row.description,
        row.keywords,
        row.dependencies,
        row.downloads,
        row.created_at,
      ],
      EQLITE_DATABASE_ID,
    )
  },

  async get(name: string, version: string): Promise<PackageRow | null> {
    const client = await getEQLiteClient()
    const result = await client.query<PackageRow>(
      'SELECT * FROM packages WHERE name = ? AND version = ?',
      [name, version],
      EQLITE_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async getLatest(name: string): Promise<PackageRow | null> {
    const client = await getEQLiteClient()
    const result = await client.query<PackageRow>(
      'SELECT * FROM packages WHERE name = ? ORDER BY created_at DESC LIMIT 1',
      [name],
      EQLITE_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async incrementDownloads(name: string, version: string): Promise<void> {
    const client = await getEQLiteClient()
    await client.exec(
      'UPDATE packages SET downloads = downloads + 1 WHERE name = ? AND version = ?',
      [name, version],
      EQLITE_DATABASE_ID,
    )
  },
}

// API Listing Operations
export const apiListingState = {
  async save(listing: {
    listingId: string
    providerId: string
    seller: Address
    keyVaultId: string
    pricePerRequest?: string
    limits?: {
      requestsPerSecond: number
      requestsPerMinute: number
      requestsPerDay: number
      requestsPerMonth: number
    }
    accessControl?: {
      allowedDomains: string[]
      blockedDomains: string[]
      allowedEndpoints: string[]
      blockedEndpoints: string[]
      allowedMethods: Array<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'>
    }
    status?: string
  }): Promise<void> {
    const now = Date.now()
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
    }

    const client = await getEQLiteClient()
    await client.exec(
      `INSERT INTO api_listings (listing_id, provider_id, seller, key_vault_id, price_per_request, limits, access_control, status, total_requests, total_revenue, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(listing_id) DO UPDATE SET
       price_per_request = excluded.price_per_request, limits = excluded.limits, access_control = excluded.access_control, status = excluded.status, updated_at = excluded.updated_at`,
      [
        row.listing_id,
        row.provider_id,
        row.seller,
        row.key_vault_id,
        row.price_per_request,
        row.limits,
        row.access_control,
        row.status,
        row.total_requests,
        row.total_revenue,
        row.created_at,
        row.updated_at,
      ],
      EQLITE_DATABASE_ID,
    )
  },

  async get(listingId: string): Promise<ApiListingRow | null> {
    const client = await getEQLiteClient()
    const result = await client.query<ApiListingRow>(
      'SELECT * FROM api_listings WHERE listing_id = ?',
      [listingId],
      EQLITE_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async listBySeller(seller: Address): Promise<ApiListingRow[]> {
    const client = await getEQLiteClient()
    const result = await client.query<ApiListingRow>(
      'SELECT * FROM api_listings WHERE seller = ? ORDER BY created_at DESC',
      [seller.toLowerCase()],
      EQLITE_DATABASE_ID,
    )
    return result.rows
  },

  async incrementUsage(listingId: string, revenue: string): Promise<void> {
    const client = await getEQLiteClient()
    await client.exec(
      `UPDATE api_listings SET total_requests = total_requests + 1,
       total_revenue = CAST(CAST(total_revenue AS INTEGER) + ? AS TEXT), updated_at = ?
       WHERE listing_id = ?`,
      [parseInt(revenue, 10), Date.now(), listingId],
      EQLITE_DATABASE_ID,
    )
  },

  async listAll(limit = 100): Promise<ApiListingRow[]> {
    const client = await getEQLiteClient()
    const result = await client.query<ApiListingRow>(
      'SELECT * FROM api_listings ORDER BY created_at DESC LIMIT ?',
      [limit],
      EQLITE_DATABASE_ID,
    )
    return result.rows
  },

  async listByProvider(providerId: string): Promise<ApiListingRow[]> {
    const client = await getEQLiteClient()
    const result = await client.query<ApiListingRow>(
      'SELECT * FROM api_listings WHERE provider_id = ? ORDER BY created_at DESC',
      [providerId],
      EQLITE_DATABASE_ID,
    )
    return result.rows
  },

  async listActive(): Promise<ApiListingRow[]> {
    const client = await getEQLiteClient()
    const result = await client.query<ApiListingRow>(
      `SELECT * FROM api_listings WHERE status = 'active' ORDER BY created_at DESC`,
      [],
      EQLITE_DATABASE_ID,
    )
    return result.rows
  },

  async getStats(): Promise<{
    totalListings: number
    activeListings: number
    totalRevenue: string
  }> {
    const client = await getEQLiteClient()
    const total = await client.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM api_listings',
      [],
      EQLITE_DATABASE_ID,
    )
    const active = await client.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM api_listings WHERE status = 'active'`,
      [],
      EQLITE_DATABASE_ID,
    )
    const revenue = await client.query<{ total: string }>(
      'SELECT COALESCE(SUM(CAST(total_revenue AS INTEGER)), 0) as total FROM api_listings',
      [],
      EQLITE_DATABASE_ID,
    )
    return {
      totalListings: total.rows[0].count ?? 0,
      activeListings: active.rows[0].count ?? 0,
      totalRevenue: revenue.rows[0].total ?? '0',
    }
  },
}

// API User Account Operations
export const apiUserAccountState = {
  async getOrCreate(address: Address): Promise<ApiUserAccountRow> {
    const addr = address.toLowerCase()
    const now = Date.now()
    const client = await getEQLiteClient()

    const result = await client.query<ApiUserAccountRow>(
      'SELECT * FROM api_user_accounts WHERE address = ?',
      [addr],
      EQLITE_DATABASE_ID,
    )

    if (result.rows[0]) return result.rows[0]

    const newAccount: ApiUserAccountRow = {
      address: addr,
      balance: '0',
      total_spent: '0',
      total_requests: 0,
      active_listings: '[]',
      created_at: now,
      updated_at: now,
    }

    await client.exec(
      `INSERT INTO api_user_accounts (address, balance, total_spent, total_requests, active_listings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [addr, '0', '0', 0, '[]', now, now],
      EQLITE_DATABASE_ID,
    )

    return newAccount
  },

  async updateBalance(address: Address, delta: string): Promise<void> {
    const addr = address.toLowerCase()
    const now = Date.now()

    // Get current balance
    const account = await this.getOrCreate(address)
    // Parse current balance handling scientific notation
    let currentBalance = 0n
    const balStr = String(account.balance)
    if (balStr.includes('e') || balStr.includes('E')) {
      currentBalance = BigInt(Math.round(parseFloat(balStr)))
    } else if (balStr && balStr !== '') {
      currentBalance = BigInt(balStr.split('.')[0])
    }

    // Calculate new balance
    const deltaValue = BigInt(delta)
    const newBalance = currentBalance + deltaValue

    const client = await getEQLiteClient()
    await client.exec(
      `UPDATE api_user_accounts SET balance = ?, updated_at = ? WHERE address = ?`,
      [newBalance.toString(), now, addr],
      EQLITE_DATABASE_ID,
    )
  },

  async recordRequest(address: Address, cost: string): Promise<void> {
    const addr = address.toLowerCase()
    const now = Date.now()
    const client = await getEQLiteClient()

    await client.exec(
      `UPDATE api_user_accounts SET
       total_requests = total_requests + 1,
       total_spent = CAST(CAST(total_spent AS INTEGER) + ? AS TEXT),
       balance = CAST(CAST(balance AS INTEGER) - ? AS TEXT),
       updated_at = ?
       WHERE address = ?`,
      [parseInt(cost, 10), parseInt(cost, 10), now, addr],
      EQLITE_DATABASE_ID,
    )
  },

  async listAll(limit = 100): Promise<ApiUserAccountRow[]> {
    const client = await getEQLiteClient()
    const result = await client.query<ApiUserAccountRow>(
      'SELECT * FROM api_user_accounts ORDER BY created_at DESC LIMIT ?',
      [limit],
      EQLITE_DATABASE_ID,
    )
    return result.rows
  },
}

// API Key State Operations (for RPC rate limiting)
interface ApiKeyRow {
  id: string
  key_hash: string
  address: string
  name: string
  tier: string
  created_at: number
  last_used_at: number
  request_count: number
  is_active: number
}

export const apiKeyState = {
  async save(record: {
    id: string
    keyHash: string
    address: string
    name: string
    tier: string
    createdAt: number
  }): Promise<void> {
    const client = await getEQLiteClient()
    await client.exec(
      `INSERT INTO api_keys (id, key_hash, address, name, tier, created_at, last_used_at, request_count, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1)`,
      [
        record.id,
        record.keyHash,
        record.address.toLowerCase(),
        record.name,
        record.tier,
        record.createdAt,
      ],
      EQLITE_DATABASE_ID,
    )
  },

  async getByHash(keyHash: string): Promise<ApiKeyRow | null> {
    const client = await getEQLiteClient()
    const result = await client.query<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE key_hash = ?',
      [keyHash],
      EQLITE_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async getById(id: string): Promise<ApiKeyRow | null> {
    const client = await getEQLiteClient()
    const result = await client.query<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE id = ?',
      [id],
      EQLITE_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async listByAddress(address: Address): Promise<ApiKeyRow[]> {
    const client = await getEQLiteClient()
    const result = await client.query<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE LOWER(address) = ? ORDER BY created_at DESC',
      [address.toLowerCase()],
      EQLITE_DATABASE_ID,
    )
    return result.rows
  },

  async recordUsage(keyHash: string): Promise<void> {
    const client = await getEQLiteClient()
    await client.exec(
      'UPDATE api_keys SET last_used_at = ?, request_count = request_count + 1 WHERE key_hash = ?',
      [Date.now(), keyHash],
      EQLITE_DATABASE_ID,
    )
  },

  async revoke(id: string): Promise<boolean> {
    const client = await getEQLiteClient()
    const result = await client.exec(
      'UPDATE api_keys SET is_active = 0 WHERE id = ?',
      [id],
      EQLITE_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },
}

// Training Run Row Type
interface TrainingRunRow {
  run_id: string
  model: string
  state: number
  clients: number
  step: number
  total_steps: number
  created_at: number
  updated_at: number
}

// Training Node Row Type
interface TrainingNodeRow {
  address: string
  gpu_tier: number
  score: number
  latency_ms: number
  bandwidth_mbps: number
  is_active: number
  last_heartbeat: number | null
  created_at: number
}

// Training State Operations
export const trainingState = {
  // Training Runs
  async saveRun(run: {
    runId: string
    model: string
    state: number
    clients: number
    step: number
    totalSteps: number
  }): Promise<void> {
    const client = await getEQLiteClient()
    const now = Date.now()
    await client.exec(
      `INSERT INTO training_runs (run_id, model, state, clients, step, total_steps, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
       state = ?, clients = ?, step = ?, updated_at = ?`,
      [
        run.runId,
        run.model,
        run.state,
        run.clients,
        run.step,
        run.totalSteps,
        now,
        now,
        run.state,
        run.clients,
        run.step,
        now,
      ],
      EQLITE_DATABASE_ID,
    )
  },

  async getRun(runId: string): Promise<TrainingRunRow | null> {
    const client = await getEQLiteClient()
    const result = await client.query<TrainingRunRow>(
      'SELECT * FROM training_runs WHERE run_id = ?',
      [runId],
      EQLITE_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async listRuns(
    status?: 'active' | 'completed' | 'paused',
  ): Promise<TrainingRunRow[]> {
    const client = await getEQLiteClient()
    let query = 'SELECT * FROM training_runs'
    const params: QueryParam[] = []

    if (status === 'active') {
      query += ' WHERE state >= 1 AND state <= 5'
    } else if (status === 'completed') {
      query += ' WHERE state = 6'
    } else if (status === 'paused') {
      query += ' WHERE state = 7'
    }

    query += ' ORDER BY created_at DESC'

    const result = await client.query<TrainingRunRow>(
      query,
      params,
      EQLITE_DATABASE_ID,
    )
    return result.rows
  },

  async deleteRun(runId: string): Promise<boolean> {
    const client = await getEQLiteClient()
    const result = await client.exec(
      'DELETE FROM training_runs WHERE run_id = ?',
      [runId],
      EQLITE_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },

  // Training Nodes
  async saveNode(node: {
    address: string
    gpuTier: number
    score?: number
    latencyMs?: number
    bandwidthMbps?: number
    isActive?: boolean
  }): Promise<void> {
    const client = await getEQLiteClient()
    const now = Date.now()
    const addr = node.address.toLowerCase()
    await client.exec(
      `INSERT INTO training_nodes (address, gpu_tier, score, latency_ms, bandwidth_mbps, is_active, last_heartbeat, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
       gpu_tier = ?, score = ?, latency_ms = ?, bandwidth_mbps = ?, is_active = ?, last_heartbeat = ?`,
      [
        addr,
        node.gpuTier,
        node.score ?? 100,
        node.latencyMs ?? 50,
        node.bandwidthMbps ?? 1000,
        node.isActive !== false ? 1 : 0,
        now,
        now,
        node.gpuTier,
        node.score ?? 100,
        node.latencyMs ?? 50,
        node.bandwidthMbps ?? 1000,
        node.isActive !== false ? 1 : 0,
        now,
      ],
      EQLITE_DATABASE_ID,
    )
  },

  async getNode(address: string): Promise<TrainingNodeRow | null> {
    const client = await getEQLiteClient()
    const result = await client.query<TrainingNodeRow>(
      'SELECT * FROM training_nodes WHERE address = ?',
      [address.toLowerCase()],
      EQLITE_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async listNodes(activeOnly = true): Promise<TrainingNodeRow[]> {
    const client = await getEQLiteClient()
    let query = 'SELECT * FROM training_nodes'
    if (activeOnly) {
      query += ' WHERE is_active = 1'
    }
    const result = await client.query<TrainingNodeRow>(
      query,
      [],
      EQLITE_DATABASE_ID,
    )
    return result.rows
  },

  async updateHeartbeat(address: string): Promise<boolean> {
    const client = await getEQLiteClient()
    const result = await client.exec(
      'UPDATE training_nodes SET last_heartbeat = ?, is_active = 1 WHERE address = ?',
      [Date.now(), address.toLowerCase()],
      EQLITE_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },

  async deleteNode(address: string): Promise<boolean> {
    const client = await getEQLiteClient()
    const result = await client.exec(
      'DELETE FROM training_nodes WHERE address = ?',
      [address.toLowerCase()],
      EQLITE_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },

  async getStats(): Promise<{
    totalNodes: number
    activeNodes: number
    totalRuns: number
    activeRuns: number
  }> {
    const client = await getEQLiteClient()

    const nodes = await client.query<{ total: number; active: number }>(
      'SELECT COUNT(*) as total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active FROM training_nodes',
      [],
      EQLITE_DATABASE_ID,
    )

    const runs = await client.query<{ total: number; active: number }>(
      'SELECT COUNT(*) as total, SUM(CASE WHEN state >= 1 AND state <= 5 THEN 1 ELSE 0 END) as active FROM training_runs',
      [],
      EQLITE_DATABASE_ID,
    )

    return {
      totalNodes: nodes.rows[0].total ?? 0,
      activeNodes: nodes.rows[0].active ?? 0,
      totalRuns: runs.rows[0].total ?? 0,
      activeRuns: runs.rows[0].active ?? 0,
    }
  },
}

// X402 Payment State Operations
export const x402State = {
  async getCredits(address: string): Promise<bigint> {
    const client = await getEQLiteClient()
    const result = await client.query<{ balance: string }>(
      'SELECT balance FROM x402_credits WHERE LOWER(address) = ?',
      [address.toLowerCase()],
      EQLITE_DATABASE_ID,
    )
    return result.rows[0] ? BigInt(result.rows[0].balance) : 0n
  },

  async addCredits(address: string, amount: bigint): Promise<void> {
    const addr = address.toLowerCase()
    const now = Date.now()
    const client = await getEQLiteClient()

    await client.exec(
      `INSERT INTO x402_credits (address, balance, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
       balance = CAST(CAST(balance AS INTEGER) + ? AS TEXT), updated_at = ?`,
      [addr, amount.toString(), now, amount.toString(), now],
      EQLITE_DATABASE_ID,
    )
  },

  async deductCredits(address: string, amount: bigint): Promise<boolean> {
    const current = await this.getCredits(address)
    if (current < amount) return false

    const addr = address.toLowerCase()
    const now = Date.now()
    const client = await getEQLiteClient()

    await client.exec(
      `UPDATE x402_credits SET balance = CAST(CAST(balance AS INTEGER) - ? AS TEXT), updated_at = ?
       WHERE LOWER(address) = ?`,
      [amount.toString(), now, addr],
      EQLITE_DATABASE_ID,
    )
    return true
  },

  async isNonceUsed(nonceKey: string): Promise<boolean> {
    const client = await getEQLiteClient()
    const result = await client.query<{ nonce: string }>(
      'SELECT nonce FROM x402_nonces WHERE nonce = ?',
      [nonceKey],
      EQLITE_DATABASE_ID,
    )
    return result.rows.length > 0
  },

  async markNonceUsed(nonceKey: string): Promise<void> {
    const client = await getEQLiteClient()
    await client.exec(
      'INSERT INTO x402_nonces (nonce, used_at) VALUES (?, ?) ON CONFLICT DO NOTHING',
      [nonceKey, Date.now()],
      EQLITE_DATABASE_ID,
    )
  },
}

// Track if we're in memory-only mode (no EQLite)
let memoryOnlyMode = false

// Initialize state - uses promise to prevent race conditions
export async function initializeDWSState(): Promise<void> {
  if (initialized) return

  // If initialization is already in progress, wait for it
  if (initPromise) {
    await initPromise
    return
  }

  // Start initialization and store the promise
  initPromise = (async () => {
    try {
      await getEQLiteClient()
      initialized = true
      console.log('[DWS State] Initialized with EQLite')
    } catch (error) {
      // For local development, allow running without EQLite
      if (process.env.NODE_ENV !== 'production') {
        memoryOnlyMode = true
        initialized = true
        console.warn(
          '[DWS State] EQLite unavailable - running in memory-only mode (local dev)',
        )
        console.warn(
          '[DWS State] Some features will be limited. Start EQLite for full functionality.',
        )
      } else {
        throw error
      }
    }
  })()

  try {
    await initPromise
  } finally {
    initPromise = null
  }
}

// Get state mode
export function getStateMode(): 'eqlite' | 'memory' {
  return memoryOnlyMode ? 'memory' : 'eqlite'
}
