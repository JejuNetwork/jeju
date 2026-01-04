import {
  getCurrentNetwork,
  getSQLitMinerUrl,
  getSQLitUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import {
  type ExecResult,
  getSQLit,
  type QueryParam,
  type QueryResult,
  resetSQLit,
} from '@jejunetwork/db'
import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import type { Address } from 'viem'

const SQLIT_DATABASE_ID = process.env.SQLIT_DATABASE_ID ?? 'dws'

/**
 * Minimal interface for SQLit operations used by DWS state.
 * The test mock implements this interface with in-memory storage.
 */
interface MinimalSQLitClient {
  isHealthy(): Promise<boolean>
  query<T>(
    sql: string,
    params: QueryParam[],
    dbId: string,
  ): Promise<QueryResult<T>>
  exec(sql: string, params: QueryParam[], dbId: string): Promise<ExecResult>
}

let sqlitClient: MinimalSQLitClient | null = null
let cacheClient: CacheClient | null = null
let initialized = false
let initPromise: Promise<void> | null = null

// SQLit is always required - no in-memory fallback for serverless compatibility

// In-memory storage for test mode
const memoryTables = new Map<string, Map<string, Record<string, unknown>>>()

// In-memory SQLit mock for test mode
function createMemorySQLitClient(): MinimalSQLitClient {
  return {
    async isHealthy() {
      return true
    },
    async query<T>(
      sql: string,
      params: QueryParam[],
      _dbId: string,
    ): Promise<QueryResult<T>> {
      // Parse simple SELECT queries for test mode
      const table = sql.match(/FROM\s+(\w+)/i)?.[1]
      if (!table) {
        return {
          rows: [],
          rowCount: 0,
          columns: [],
          executionTime: 0,
          blockHeight: 0,
        }
      }

      const tableData = memoryTables.get(table) ?? new Map()
      const rows = Array.from(tableData.values())

      // Basic WHERE clause support
      const whereMatch = sql.match(/WHERE\s+(LOWER\()?(\w+)\)?\s*=\s*\?/i)
      if (whereMatch && params.length > 0) {
        const field = whereMatch[2]
        const value = String(params[0]).toLowerCase()
        const filtered = rows.filter(
          (r) => String(r[field]).toLowerCase() === value,
        )
        return {
          rows: filtered as T[],
          rowCount: filtered.length,
          columns: [],
          executionTime: 0,
          blockHeight: 0,
        }
      }

      return {
        rows: rows as T[],
        rowCount: rows.length,
        columns: [],
        executionTime: 0,
        blockHeight: 0,
      }
    },
    async exec(
      sql: string,
      params: QueryParam[],
      _dbId: string,
    ): Promise<ExecResult> {
      // Parse INSERT/REPLACE/UPDATE/DELETE for test mode
      const insertMatch = sql.match(
        /INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+(\w+)/i,
      )
      if (insertMatch) {
        const table = insertMatch[1]
        if (!memoryTables.has(table)) memoryTables.set(table, new Map())
        const tableData = memoryTables.get(table)
        // Use first param as ID
        const id = String(params[0])
        const record: Record<string, unknown> = {}
        // Extract columns from SQL
        const colsMatch = sql.match(/\(([^)]+)\)\s*VALUES/i)
        if (colsMatch) {
          const cols = colsMatch[1].split(',').map((c) => c.trim())
          cols.forEach((col, i) => {
            record[col] = params[i]
          })
        }
        tableData?.set(id, record)
        return {
          rowsAffected: 1,
          txHash:
            '0x0000000000000000000000000000000000000000000000000000000000000000',
          blockHeight: 0,
          gasUsed: 0n,
        }
      }

      const deleteMatch = sql.match(
        /DELETE\s+FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?/i,
      )
      if (deleteMatch && params.length > 0) {
        const table = deleteMatch[1]
        const tableData = memoryTables.get(table)
        if (tableData) {
          const id = String(params[0])
          tableData.delete(id)
        }
        return {
          rowsAffected: 1,
          txHash:
            '0x0000000000000000000000000000000000000000000000000000000000000000',
          blockHeight: 0,
          gasUsed: 0n,
        }
      }

      return {
        rowsAffected: 0,
        txHash:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        blockHeight: 0,
        gasUsed: 0n,
      }
    },
  }
}

async function getSQLitClient(): Promise<MinimalSQLitClient> {
  // Wait for initialization if in progress
  if (initPromise) {
    await initPromise
  }

  // If in memory-only mode (test mode), return a mock client
  if (memoryOnlyMode) {
    if (!sqlitClient) {
      sqlitClient = createMemorySQLitClient()
    }
    return sqlitClient
  }

  if (!sqlitClient) {
    // Reset any existing client to ensure fresh config
    resetSQLit()

    // Get URLs from centralized config (respects JEJU_NETWORK)
    const blockProducerEndpoint = getSQLitUrl()
    const minerEndpoint = getSQLitMinerUrl()

    sqlitClient = getSQLit({
      blockProducerEndpoint,
      minerEndpoint,
      databaseId: SQLIT_DATABASE_ID,
      timeout: 30000,
      debug: !isProductionEnv(),
    })

    const healthy = await sqlitClient.isHealthy()
    if (!healthy) {
      sqlitClient = null
      const network = getCurrentNetwork()
      const message = `DWS requires SQLit for decentralized state (network: ${network}). Ensure SQLit is running: docker compose up -d sqlit`
      throw new Error(message)
    }

    await ensureTablesExist()
  }

  return sqlitClient
}

function getCache(): CacheClient {
  if (!cacheClient) {
    cacheClient = getCacheClient('dws')
  }
  return cacheClient
}

async function ensureTablesExist(): Promise<void> {
  if (!sqlitClient) return

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
    `CREATE TABLE IF NOT EXISTS bot_deployments (
      bot_id TEXT PRIMARY KEY,
      bot_type TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      container_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      deployed_at INTEGER NOT NULL,
      last_heartbeat INTEGER NOT NULL,
      config TEXT NOT NULL,
      metrics TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS external_chain_nodes (
      chain TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      endpoint TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'unknown',
      block_height INTEGER NOT NULL DEFAULT 0,
      last_block_time INTEGER,
      peers INTEGER NOT NULL DEFAULT 0,
      registered_at INTEGER NOT NULL,
      last_heartbeat INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS deployed_apps (
      name TEXT PRIMARY KEY,
      jns_name TEXT NOT NULL,
      frontend_cid TEXT,
      static_files TEXT,
      backend_worker_id TEXT,
      backend_endpoint TEXT,
      api_paths TEXT NOT NULL DEFAULT '[]',
      spa INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      deployed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS dws_workers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner TEXT NOT NULL,
      runtime TEXT NOT NULL DEFAULT 'bun',
      handler TEXT NOT NULL DEFAULT 'index.handler',
      code_cid TEXT NOT NULL,
      memory INTEGER NOT NULL DEFAULT 256,
      timeout INTEGER NOT NULL DEFAULT 30000,
      env TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      version INTEGER NOT NULL DEFAULT 1,
      invocation_count INTEGER NOT NULL DEFAULT 0,
      avg_duration_ms INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS dws_worker_versions (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      code_cid TEXT NOT NULL,
      runtime TEXT NOT NULL,
      handler TEXT NOT NULL,
      memory INTEGER NOT NULL,
      timeout INTEGER NOT NULL,
      env TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(worker_id, version),
      FOREIGN KEY (worker_id) REFERENCES dws_workers(id)
    )`,
    `CREATE TABLE IF NOT EXISTS cli_secrets (
      id TEXT PRIMARY KEY,
      app_name TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'all',
      owner TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(app_name, key)
    )`,
    `CREATE TABLE IF NOT EXISTS cli_previews (
      preview_id TEXT PRIMARY KEY,
      app_name TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      preview_url TEXT NOT NULL,
      api_url TEXT,
      owner TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS jns_domains (
      name TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      content_cid TEXT,
      worker_id TEXT,
      registered_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      ttl INTEGER NOT NULL DEFAULT 300
    )`,
    `CREATE TABLE IF NOT EXISTS credit_transactions (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      type TEXT NOT NULL,
      amount TEXT NOT NULL,
      balance_after TEXT NOT NULL,
      tx_hash TEXT,
      description TEXT,
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
    'CREATE INDEX IF NOT EXISTS idx_bot_deployments_owner ON bot_deployments(owner)',
    'CREATE INDEX IF NOT EXISTS idx_bot_deployments_status ON bot_deployments(status)',
    'CREATE INDEX IF NOT EXISTS idx_external_nodes_active ON external_chain_nodes(is_active)',
    'CREATE INDEX IF NOT EXISTS idx_deployed_apps_enabled ON deployed_apps(enabled)',
    'CREATE INDEX IF NOT EXISTS idx_dws_workers_owner ON dws_workers(owner)',
    'CREATE INDEX IF NOT EXISTS idx_dws_workers_name ON dws_workers(name)',
    'CREATE INDEX IF NOT EXISTS idx_dws_workers_status ON dws_workers(status)',
    'CREATE INDEX IF NOT EXISTS idx_dws_worker_versions_worker ON dws_worker_versions(worker_id)',
    'CREATE INDEX IF NOT EXISTS idx_cli_secrets_app ON cli_secrets(app_name)',
    'CREATE INDEX IF NOT EXISTS idx_cli_secrets_owner ON cli_secrets(owner)',
    'CREATE INDEX IF NOT EXISTS idx_cli_previews_owner ON cli_previews(owner)',
    'CREATE INDEX IF NOT EXISTS idx_cli_previews_app ON cli_previews(app_name)',
    'CREATE INDEX IF NOT EXISTS idx_cli_previews_status ON cli_previews(status)',
    'CREATE INDEX IF NOT EXISTS idx_jns_domains_owner ON jns_domains(owner)',
    'CREATE INDEX IF NOT EXISTS idx_credit_txns_owner ON credit_transactions(owner)',
    'CREATE INDEX IF NOT EXISTS idx_credit_txns_created ON credit_transactions(created_at)',
  ]

  for (const ddl of tables) {
    await sqlitClient.exec(ddl, [], SQLIT_DATABASE_ID)
  }

  for (const idx of indexes) {
    await sqlitClient.exec(idx, [], SQLIT_DATABASE_ID)
  }

  console.log('[DWS State] SQLit tables ensured')
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

    // Use memory store in memory-only mode
    if (memoryOnlyMode) {
      memoryStores.computeJobs.set(row.job_id, row)
      return
    }

    try {
      const client = await getSQLitClient()
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
        SQLIT_DATABASE_ID,
      )

      await getCache().delete(`job:${row.job_id}`)
    } catch (error) {
      // SQLit failed - log error and save to memory store
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error(
        `[DWS State] SQLit save failed for job ${row.job_id}: ${errorMsg}`,
      )
      memoryStores.computeJobs.set(row.job_id, row)
    }
  },

  async get(jobId: string): Promise<ComputeJobRow | null> {
    // Use memory store in memory-only mode
    if (memoryOnlyMode) {
      return memoryStores.computeJobs.get(jobId) ?? null
    }

    try {
      const client = await getSQLitClient()
      const result = await client.query<ComputeJobRow>(
        'SELECT * FROM compute_jobs WHERE job_id = ?',
        [jobId],
        SQLIT_DATABASE_ID,
      )
      return result.rows[0] ?? null
    } catch (error) {
      // SQLit failed - log error and use memory store
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error(
        `[DWS State] SQLit get failed for job ${jobId}: ${errorMsg}`,
      )
      return memoryStores.computeJobs.get(jobId) ?? null
    }
  },

  async list(params?: {
    submittedBy?: string
    status?: string
    limit?: number
  }): Promise<ComputeJobRow[]> {
    // Return from memory store in memory-only mode or when SQLit fails
    if (memoryOnlyMode) {
      let jobs = Array.from(memoryStores.computeJobs.values())
      if (params?.submittedBy) {
        jobs = jobs.filter(
          (j) => j.submitted_by === params.submittedBy?.toLowerCase(),
        )
      }
      if (params?.status) {
        jobs = jobs.filter((j) => j.status === params.status)
      }
      jobs.sort((a, b) => b.created_at - a.created_at)
      return jobs.slice(0, params?.limit ?? 50)
    }

    try {
      const client = await getSQLitClient()
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
        SQLIT_DATABASE_ID,
      )
      return result.rows
    } catch (error) {
      // SQLit failed - log error and return from memory store
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error(`[DWS State] SQLit list jobs failed: ${errorMsg}`)
      let jobs = Array.from(memoryStores.computeJobs.values())
      if (params?.submittedBy) {
        jobs = jobs.filter(
          (j) => j.submitted_by === params.submittedBy?.toLowerCase(),
        )
      }
      if (params?.status) {
        jobs = jobs.filter((j) => j.status === params.status)
      }
      jobs.sort((a, b) => b.created_at - a.created_at)
      return jobs.slice(0, params?.limit ?? 50)
    }
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

    const client = await getSQLitClient()
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
      SQLIT_DATABASE_ID,
    )
  },

  async get(cid: string): Promise<StoragePinRow | null> {
    const client = await getSQLitClient()
    const result = await client.query<StoragePinRow>(
      'SELECT * FROM storage_pins WHERE cid = ?',
      [cid],
      SQLIT_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async listByOwner(owner: Address): Promise<StoragePinRow[]> {
    const client = await getSQLitClient()
    const result = await client.query<StoragePinRow>(
      'SELECT * FROM storage_pins WHERE owner = ? ORDER BY created_at DESC',
      [owner.toLowerCase()],
      SQLIT_DATABASE_ID,
    )
    return result.rows
  },

  async delete(cid: string): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.exec(
      'DELETE FROM storage_pins WHERE cid = ?',
      [cid],
      SQLIT_DATABASE_ID,
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

    const client = await getSQLitClient()
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
      SQLIT_DATABASE_ID,
    )
  },

  async get(repoId: string): Promise<GitRepoRow | null> {
    const client = await getSQLitClient()
    const result = await client.query<GitRepoRow>(
      'SELECT * FROM git_repos WHERE repo_id = ?',
      [repoId],
      SQLIT_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async listByOwner(owner: Address): Promise<GitRepoRow[]> {
    const client = await getSQLitClient()
    const result = await client.query<GitRepoRow>(
      'SELECT * FROM git_repos WHERE owner = ? ORDER BY updated_at DESC',
      [owner.toLowerCase()],
      SQLIT_DATABASE_ID,
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

    const client = await getSQLitClient()
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
      SQLIT_DATABASE_ID,
    )
  },

  async get(name: string, version: string): Promise<PackageRow | null> {
    const client = await getSQLitClient()
    const result = await client.query<PackageRow>(
      'SELECT * FROM packages WHERE name = ? AND version = ?',
      [name, version],
      SQLIT_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async getLatest(name: string): Promise<PackageRow | null> {
    const client = await getSQLitClient()
    const result = await client.query<PackageRow>(
      'SELECT * FROM packages WHERE name = ? ORDER BY created_at DESC LIMIT 1',
      [name],
      SQLIT_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async incrementDownloads(name: string, version: string): Promise<void> {
    const client = await getSQLitClient()
    await client.exec(
      'UPDATE packages SET downloads = downloads + 1 WHERE name = ? AND version = ?',
      [name, version],
      SQLIT_DATABASE_ID,
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

    const client = await getSQLitClient()
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
      SQLIT_DATABASE_ID,
    )
  },

  async get(listingId: string): Promise<ApiListingRow | null> {
    const client = await getSQLitClient()
    const result = await client.query<ApiListingRow>(
      'SELECT * FROM api_listings WHERE listing_id = ?',
      [listingId],
      SQLIT_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async listBySeller(seller: Address): Promise<ApiListingRow[]> {
    const client = await getSQLitClient()
    const result = await client.query<ApiListingRow>(
      'SELECT * FROM api_listings WHERE seller = ? ORDER BY created_at DESC',
      [seller.toLowerCase()],
      SQLIT_DATABASE_ID,
    )
    return result.rows
  },

  async incrementUsage(listingId: string, revenue: string): Promise<void> {
    const client = await getSQLitClient()
    await client.exec(
      `UPDATE api_listings SET total_requests = total_requests + 1,
       total_revenue = CAST(CAST(total_revenue AS INTEGER) + ? AS TEXT), updated_at = ?
       WHERE listing_id = ?`,
      [parseInt(revenue, 10), Date.now(), listingId],
      SQLIT_DATABASE_ID,
    )
  },

  async listAll(limit = 100): Promise<ApiListingRow[]> {
    const client = await getSQLitClient()
    const result = await client.query<ApiListingRow>(
      'SELECT * FROM api_listings ORDER BY created_at DESC LIMIT ?',
      [limit],
      SQLIT_DATABASE_ID,
    )
    return result.rows
  },

  async listByProvider(providerId: string): Promise<ApiListingRow[]> {
    const client = await getSQLitClient()
    const result = await client.query<ApiListingRow>(
      'SELECT * FROM api_listings WHERE provider_id = ? ORDER BY created_at DESC',
      [providerId],
      SQLIT_DATABASE_ID,
    )
    return result.rows
  },

  async listActive(): Promise<ApiListingRow[]> {
    const client = await getSQLitClient()
    const result = await client.query<ApiListingRow>(
      `SELECT * FROM api_listings WHERE status = 'active' ORDER BY created_at DESC`,
      [],
      SQLIT_DATABASE_ID,
    )
    return result.rows
  },

  async getStats(): Promise<{
    totalListings: number
    activeListings: number
    totalRevenue: string
  }> {
    const client = await getSQLitClient()
    const total = await client.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM api_listings',
      [],
      SQLIT_DATABASE_ID,
    )
    const active = await client.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM api_listings WHERE status = 'active'`,
      [],
      SQLIT_DATABASE_ID,
    )
    const revenue = await client.query<{ total: string }>(
      'SELECT COALESCE(SUM(CAST(total_revenue AS INTEGER)), 0) as total FROM api_listings',
      [],
      SQLIT_DATABASE_ID,
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

    // Use memory store in memory-only mode
    if (memoryOnlyMode) {
      const existing = memoryStores.apiUserAccounts.get(addr)
      if (existing) return existing

      const newAccount: ApiUserAccountRow = {
        address: addr,
        balance: '0',
        total_spent: '0',
        total_requests: 0,
        active_listings: '[]',
        created_at: now,
        updated_at: now,
      }
      memoryStores.apiUserAccounts.set(addr, newAccount)
      return newAccount
    }

    try {
      const client = await getSQLitClient()

      const result = await client.query<ApiUserAccountRow>(
        'SELECT * FROM api_user_accounts WHERE address = ?',
        [addr],
        SQLIT_DATABASE_ID,
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
        SQLIT_DATABASE_ID,
      )

      return newAccount
    } catch (error) {
      // SQLit failed - log error and use memory store
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error(
        `[DWS State] SQLit getOrCreate user failed for ${addr}: ${errorMsg}`,
      )
      const existing = memoryStores.apiUserAccounts.get(addr)
      if (existing) return existing

      const newAccount: ApiUserAccountRow = {
        address: addr,
        balance: '0',
        total_spent: '0',
        total_requests: 0,
        active_listings: '[]',
        created_at: now,
        updated_at: now,
      }
      memoryStores.apiUserAccounts.set(addr, newAccount)
      return newAccount
    }
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

    const client = await getSQLitClient()
    await client.exec(
      `UPDATE api_user_accounts SET balance = ?, updated_at = ? WHERE address = ?`,
      [newBalance.toString(), now, addr],
      SQLIT_DATABASE_ID,
    )
  },

  async recordRequest(address: Address, cost: string): Promise<void> {
    const addr = address.toLowerCase()
    const now = Date.now()
    const client = await getSQLitClient()

    await client.exec(
      `UPDATE api_user_accounts SET
       total_requests = total_requests + 1,
       total_spent = CAST(CAST(total_spent AS INTEGER) + ? AS TEXT),
       balance = CAST(CAST(balance AS INTEGER) - ? AS TEXT),
       updated_at = ?
       WHERE address = ?`,
      [parseInt(cost, 10), parseInt(cost, 10), now, addr],
      SQLIT_DATABASE_ID,
    )
  },

  async listAll(limit = 100): Promise<ApiUserAccountRow[]> {
    const client = await getSQLitClient()
    const result = await client.query<ApiUserAccountRow>(
      'SELECT * FROM api_user_accounts ORDER BY created_at DESC LIMIT ?',
      [limit],
      SQLIT_DATABASE_ID,
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
    const client = await getSQLitClient()
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
      SQLIT_DATABASE_ID,
    )
  },

  async getByHash(keyHash: string): Promise<ApiKeyRow | null> {
    const client = await getSQLitClient()
    const result = await client.query<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE key_hash = ?',
      [keyHash],
      SQLIT_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async getById(id: string): Promise<ApiKeyRow | null> {
    const client = await getSQLitClient()
    const result = await client.query<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE id = ?',
      [id],
      SQLIT_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async listByAddress(address: Address): Promise<ApiKeyRow[]> {
    const client = await getSQLitClient()
    const result = await client.query<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE LOWER(address) = ? ORDER BY created_at DESC',
      [address.toLowerCase()],
      SQLIT_DATABASE_ID,
    )
    return result.rows
  },

  async recordUsage(keyHash: string): Promise<void> {
    const client = await getSQLitClient()
    await client.exec(
      'UPDATE api_keys SET last_used_at = ?, request_count = request_count + 1 WHERE key_hash = ?',
      [Date.now(), keyHash],
      SQLIT_DATABASE_ID,
    )
  },

  async revoke(id: string): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.exec(
      'UPDATE api_keys SET is_active = 0 WHERE id = ?',
      [id],
      SQLIT_DATABASE_ID,
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
    const client = await getSQLitClient()
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
      SQLIT_DATABASE_ID,
    )
  },

  async getRun(runId: string): Promise<TrainingRunRow | null> {
    const client = await getSQLitClient()
    const result = await client.query<TrainingRunRow>(
      'SELECT * FROM training_runs WHERE run_id = ?',
      [runId],
      SQLIT_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async listRuns(
    status?: 'active' | 'completed' | 'paused',
  ): Promise<TrainingRunRow[]> {
    const client = await getSQLitClient()
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
      SQLIT_DATABASE_ID,
    )
    return result.rows
  },

  async deleteRun(runId: string): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.exec(
      'DELETE FROM training_runs WHERE run_id = ?',
      [runId],
      SQLIT_DATABASE_ID,
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
    const client = await getSQLitClient()
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
      SQLIT_DATABASE_ID,
    )
  },

  async getNode(address: string): Promise<TrainingNodeRow | null> {
    const client = await getSQLitClient()
    const result = await client.query<TrainingNodeRow>(
      'SELECT * FROM training_nodes WHERE address = ?',
      [address.toLowerCase()],
      SQLIT_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async listNodes(activeOnly = true): Promise<TrainingNodeRow[]> {
    const client = await getSQLitClient()
    let query = 'SELECT * FROM training_nodes'
    if (activeOnly) {
      query += ' WHERE is_active = 1'
    }
    const result = await client.query<TrainingNodeRow>(
      query,
      [],
      SQLIT_DATABASE_ID,
    )
    return result.rows
  },

  async updateHeartbeat(address: string): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.exec(
      'UPDATE training_nodes SET last_heartbeat = ?, is_active = 1 WHERE address = ?',
      [Date.now(), address.toLowerCase()],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },

  async deleteNode(address: string): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.exec(
      'DELETE FROM training_nodes WHERE address = ?',
      [address.toLowerCase()],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },

  async getStats(): Promise<{
    totalNodes: number
    activeNodes: number
    totalRuns: number
    activeRuns: number
  }> {
    const client = await getSQLitClient()

    const nodes = await client.query<{ total: number; active: number }>(
      'SELECT COUNT(*) as total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active FROM training_nodes',
      [],
      SQLIT_DATABASE_ID,
    )

    const runs = await client.query<{ total: number; active: number }>(
      'SELECT COUNT(*) as total, SUM(CASE WHEN state >= 1 AND state <= 5 THEN 1 ELSE 0 END) as active FROM training_runs',
      [],
      SQLIT_DATABASE_ID,
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
    const client = await getSQLitClient()
    const result = await client.query<{ balance: string }>(
      'SELECT balance FROM x402_credits WHERE LOWER(address) = ?',
      [address.toLowerCase()],
      SQLIT_DATABASE_ID,
    )
    return result.rows[0] ? BigInt(result.rows[0].balance) : 0n
  },

  async addCredits(address: string, amount: bigint): Promise<void> {
    const addr = address.toLowerCase()
    const now = Date.now()
    const client = await getSQLitClient()

    await client.exec(
      `INSERT INTO x402_credits (address, balance, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
       balance = CAST(CAST(balance AS INTEGER) + ? AS TEXT), updated_at = ?`,
      [addr, amount.toString(), now, amount.toString(), now],
      SQLIT_DATABASE_ID,
    )
  },

  async deductCredits(address: string, amount: bigint): Promise<boolean> {
    const current = await this.getCredits(address)
    if (current < amount) return false

    const addr = address.toLowerCase()
    const now = Date.now()
    const client = await getSQLitClient()

    await client.exec(
      `UPDATE x402_credits SET balance = CAST(CAST(balance AS INTEGER) - ? AS TEXT), updated_at = ?
       WHERE LOWER(address) = ?`,
      [amount.toString(), now, addr],
      SQLIT_DATABASE_ID,
    )
    return true
  },

  async isNonceUsed(nonceKey: string): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.query<{ nonce: string }>(
      'SELECT nonce FROM x402_nonces WHERE nonce = ?',
      [nonceKey],
      SQLIT_DATABASE_ID,
    )
    return result.rows.length > 0
  },

  async markNonceUsed(nonceKey: string): Promise<void> {
    const client = await getSQLitClient()
    await client.exec(
      'INSERT INTO x402_nonces (nonce, used_at) VALUES (?, ?) ON CONFLICT DO NOTHING',
      [nonceKey, Date.now()],
      SQLIT_DATABASE_ID,
    )
  },
}

// Bot Deployment Row Type
interface BotDeploymentRow {
  bot_id: string
  bot_type: string
  name: string
  status: string
  container_id: string
  owner: string
  wallet_address: string
  deployed_at: number
  last_heartbeat: number
  config: string
  metrics: string
  created_at: number
}

// Bot Deployment State Operations
export const botDeploymentState = {
  async save(bot: {
    botId: string
    botType: string
    name: string
    status: string
    containerId: string
    owner: Address
    walletAddress: Address
    deployedAt: number
    lastHeartbeat: number
    config: Record<string, unknown>
    metrics: Record<string, unknown>
  }): Promise<void> {
    const client = await getSQLitClient()
    const now = Date.now()
    await client.exec(
      `INSERT INTO bot_deployments (bot_id, bot_type, name, status, container_id, owner, wallet_address, deployed_at, last_heartbeat, config, metrics, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(bot_id) DO UPDATE SET
       status = ?, last_heartbeat = ?, metrics = ?`,
      [
        bot.botId,
        bot.botType,
        bot.name,
        bot.status,
        bot.containerId,
        bot.owner.toLowerCase(),
        bot.walletAddress.toLowerCase(),
        bot.deployedAt,
        bot.lastHeartbeat,
        JSON.stringify(bot.config),
        JSON.stringify(bot.metrics),
        now,
        bot.status,
        bot.lastHeartbeat,
        JSON.stringify(bot.metrics),
      ],
      SQLIT_DATABASE_ID,
    )
  },

  async get(botId: string): Promise<BotDeploymentRow | null> {
    const client = await getSQLitClient()
    const result = await client.query<BotDeploymentRow>(
      'SELECT * FROM bot_deployments WHERE bot_id = ?',
      [botId],
      SQLIT_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async listByOwner(owner: Address): Promise<BotDeploymentRow[]> {
    const client = await getSQLitClient()
    const result = await client.query<BotDeploymentRow>(
      'SELECT * FROM bot_deployments WHERE owner = ? ORDER BY created_at DESC',
      [owner.toLowerCase()],
      SQLIT_DATABASE_ID,
    )
    return result.rows
  },

  async listAll(limit = 100): Promise<BotDeploymentRow[]> {
    const client = await getSQLitClient()
    const result = await client.query<BotDeploymentRow>(
      'SELECT * FROM bot_deployments ORDER BY created_at DESC LIMIT ?',
      [limit],
      SQLIT_DATABASE_ID,
    )
    return result.rows
  },

  async listByStatus(status: string): Promise<BotDeploymentRow[]> {
    const client = await getSQLitClient()
    const result = await client.query<BotDeploymentRow>(
      'SELECT * FROM bot_deployments WHERE status = ? ORDER BY created_at DESC',
      [status],
      SQLIT_DATABASE_ID,
    )
    return result.rows
  },

  async updateStatus(botId: string, status: string): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.exec(
      'UPDATE bot_deployments SET status = ?, last_heartbeat = ? WHERE bot_id = ?',
      [status, Date.now(), botId],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },

  async updateHeartbeat(botId: string): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.exec(
      'UPDATE bot_deployments SET last_heartbeat = ? WHERE bot_id = ?',
      [Date.now(), botId],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },

  async updateMetrics(
    botId: string,
    metrics: Record<string, unknown>,
  ): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.exec(
      'UPDATE bot_deployments SET metrics = ?, last_heartbeat = ? WHERE bot_id = ?',
      [JSON.stringify(metrics), Date.now(), botId],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },

  async delete(botId: string): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.exec(
      'DELETE FROM bot_deployments WHERE bot_id = ?',
      [botId],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },
}

// External Chain Node Row Type
interface ExternalChainNodeRow {
  chain: string
  node_id: string
  status: string
  endpoint: string
  chain_id: number
  sync_status: string
  block_height: number
  last_block_time: number | null
  peers: number
  registered_at: number
  last_heartbeat: number
  is_active: number
}

// External Chain Node State Operations
export const externalChainNodeState = {
  async save(node: {
    chain: string
    nodeId: string
    status: string
    endpoint: string
    chainId: number
    syncStatus: string
    blockHeight: number
    lastBlockTime: number | null
    peers: number
    registeredAt: number
    lastHeartbeat: number
    isActive: boolean
  }): Promise<void> {
    const client = await getSQLitClient()
    await client.exec(
      `INSERT INTO external_chain_nodes (chain, node_id, status, endpoint, chain_id, sync_status, block_height, last_block_time, peers, registered_at, last_heartbeat, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chain) DO UPDATE SET
       status = ?, endpoint = ?, sync_status = ?, block_height = ?, last_block_time = ?, peers = ?, last_heartbeat = ?, is_active = ?`,
      [
        node.chain,
        node.nodeId,
        node.status,
        node.endpoint,
        node.chainId,
        node.syncStatus,
        node.blockHeight,
        node.lastBlockTime,
        node.peers,
        node.registeredAt,
        node.lastHeartbeat,
        node.isActive ? 1 : 0,
        node.status,
        node.endpoint,
        node.syncStatus,
        node.blockHeight,
        node.lastBlockTime,
        node.peers,
        node.lastHeartbeat,
        node.isActive ? 1 : 0,
      ],
      SQLIT_DATABASE_ID,
    )
  },

  async get(chain: string): Promise<ExternalChainNodeRow | null> {
    const client = await getSQLitClient()
    const result = await client.query<ExternalChainNodeRow>(
      'SELECT * FROM external_chain_nodes WHERE chain = ?',
      [chain],
      SQLIT_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async listAll(): Promise<ExternalChainNodeRow[]> {
    const client = await getSQLitClient()
    const result = await client.query<ExternalChainNodeRow>(
      'SELECT * FROM external_chain_nodes ORDER BY chain',
      [],
      SQLIT_DATABASE_ID,
    )
    return result.rows
  },

  async listActive(): Promise<ExternalChainNodeRow[]> {
    const client = await getSQLitClient()
    const result = await client.query<ExternalChainNodeRow>(
      'SELECT * FROM external_chain_nodes WHERE is_active = 1 ORDER BY chain',
      [],
      SQLIT_DATABASE_ID,
    )
    return result.rows
  },

  async updateStatus(chain: string, status: string): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.exec(
      'UPDATE external_chain_nodes SET status = ?, last_heartbeat = ? WHERE chain = ?',
      [status, Date.now(), chain],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },

  async updateSyncStatus(
    chain: string,
    syncStatus: string,
    blockHeight: number,
    lastBlockTime: number,
    peers: number,
  ): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.exec(
      'UPDATE external_chain_nodes SET sync_status = ?, block_height = ?, last_block_time = ?, peers = ?, last_heartbeat = ? WHERE chain = ?',
      [syncStatus, blockHeight, lastBlockTime, peers, Date.now(), chain],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },

  async delete(chain: string): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.exec(
      'DELETE FROM external_chain_nodes WHERE chain = ?',
      [chain],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },
}

// Deployed App Row Type
interface DeployedAppRow {
  name: string
  jns_name: string
  frontend_cid: string | null
  static_files: string | null
  backend_worker_id: string | null
  backend_endpoint: string | null
  api_paths: string
  spa: number
  enabled: number
  deployed_at: number
  updated_at: number
}

// Deployed App State Operations
export const deployedAppState = {
  async save(app: {
    name: string
    jnsName: string
    frontendCid: string | null
    staticFiles: Record<string, string> | null
    backendWorkerId: string | null
    backendEndpoint: string | null
    apiPaths: string[]
    spa: boolean
    enabled: boolean
  }): Promise<void> {
    const client = await getSQLitClient()
    const now = Date.now()

    // Check if app exists to preserve deployedAt
    const existing = await this.get(app.name)

    const row: DeployedAppRow = {
      name: app.name,
      jns_name: app.jnsName,
      frontend_cid: app.frontendCid,
      static_files: app.staticFiles ? JSON.stringify(app.staticFiles) : null,
      backend_worker_id: app.backendWorkerId,
      backend_endpoint: app.backendEndpoint,
      api_paths: JSON.stringify(app.apiPaths),
      spa: app.spa ? 1 : 0,
      enabled: app.enabled ? 1 : 0,
      deployed_at: existing?.deployed_at ?? now,
      updated_at: now,
    }

    await client.exec(
      `INSERT INTO deployed_apps (name, jns_name, frontend_cid, static_files, backend_worker_id, backend_endpoint, api_paths, spa, enabled, deployed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
       jns_name = excluded.jns_name,
       frontend_cid = excluded.frontend_cid,
       static_files = excluded.static_files,
       backend_worker_id = excluded.backend_worker_id,
       backend_endpoint = excluded.backend_endpoint,
       api_paths = excluded.api_paths,
       spa = excluded.spa,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
      [
        row.name,
        row.jns_name,
        row.frontend_cid,
        row.static_files,
        row.backend_worker_id,
        row.backend_endpoint,
        row.api_paths,
        row.spa,
        row.enabled,
        row.deployed_at,
        row.updated_at,
      ],
      SQLIT_DATABASE_ID,
    )

    console.log(
      `[DeployedAppState] Saved app: ${app.name} (frontend: ${app.frontendCid ?? 'none'}, staticFiles: ${app.staticFiles ? Object.keys(app.staticFiles).length : 0}, backend: ${app.backendWorkerId ?? app.backendEndpoint ?? 'none'})`,
    )
  },

  async get(name: string): Promise<DeployedAppRow | null> {
    const client = await getSQLitClient()
    const result = await client.query<DeployedAppRow>(
      'SELECT * FROM deployed_apps WHERE name = ?',
      [name],
      SQLIT_DATABASE_ID,
    )
    return result.rows[0] ?? null
  },

  async listAll(): Promise<DeployedAppRow[]> {
    const client = await getSQLitClient()
    const result = await client.query<DeployedAppRow>(
      'SELECT * FROM deployed_apps ORDER BY updated_at DESC',
      [],
      SQLIT_DATABASE_ID,
    )
    return result.rows
  },

  async listEnabled(): Promise<DeployedAppRow[]> {
    const client = await getSQLitClient()
    const result = await client.query<DeployedAppRow>(
      'SELECT * FROM deployed_apps WHERE enabled = 1 ORDER BY updated_at DESC',
      [],
      SQLIT_DATABASE_ID,
    )
    return result.rows
  },

  async delete(name: string): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.exec(
      'DELETE FROM deployed_apps WHERE name = ?',
      [name],
      SQLIT_DATABASE_ID,
    )

    if (result.rowsAffected > 0) {
      console.log(`[DeployedAppState] Deleted app: ${name}`)
    }

    return result.rowsAffected > 0
  },

  async setEnabled(name: string, enabled: boolean): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.exec(
      'UPDATE deployed_apps SET enabled = ?, updated_at = ? WHERE name = ?',
      [enabled ? 1 : 0, Date.now(), name],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },
}

// Worker state types and management
interface DWSWorkerRow {
  id: string
  name: string
  owner: string
  runtime: string
  handler: string
  code_cid: string
  memory: number
  timeout: number
  env: string
  status: string
  version: number
  invocation_count: number
  avg_duration_ms: number
  error_count: number
  created_at: number
  updated_at: number
}

export interface DWSWorker {
  id: string
  name: string
  owner: string
  runtime: 'bun' | 'node' | 'deno'
  handler: string
  codeCid: string
  memory: number
  timeout: number
  env: Record<string, string>
  status: 'active' | 'inactive' | 'error'
  version: number
  invocationCount: number
  avgDurationMs: number
  errorCount: number
  createdAt: number
  updatedAt: number
}

function rowToWorker(row: DWSWorkerRow): DWSWorker {
  return {
    id: row.id,
    name: row.name,
    owner: row.owner,
    runtime: row.runtime as 'bun' | 'node' | 'deno',
    handler: row.handler,
    codeCid: row.code_cid,
    memory: row.memory,
    timeout: row.timeout,
    env: JSON.parse(row.env),
    status: row.status as 'active' | 'inactive' | 'error',
    version: row.version,
    invocationCount: row.invocation_count,
    avgDurationMs: row.avg_duration_ms,
    errorCount: row.error_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const dwsWorkerState = {
  async save(worker: DWSWorker): Promise<void> {
    const client = await getSQLitClient()
    const now = Date.now()

    await client.exec(
      `INSERT OR REPLACE INTO dws_workers (
        id, name, owner, runtime, handler, code_cid, memory, timeout, env,
        status, version, invocation_count, avg_duration_ms, error_count,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        worker.id,
        worker.name,
        worker.owner,
        worker.runtime,
        worker.handler,
        worker.codeCid,
        worker.memory,
        worker.timeout,
        JSON.stringify(worker.env),
        worker.status,
        worker.version,
        worker.invocationCount,
        worker.avgDurationMs,
        worker.errorCount,
        worker.createdAt ?? now,
        now,
      ],
      SQLIT_DATABASE_ID,
    )

    console.log(
      `[DWSWorkerState] Saved worker: ${worker.name} (${worker.id}) - codeCid: ${worker.codeCid}`,
    )
  },

  async get(id: string): Promise<DWSWorker | null> {
    const client = await getSQLitClient()
    const result = await client.query<DWSWorkerRow>(
      'SELECT * FROM dws_workers WHERE id = ?',
      [id],
      SQLIT_DATABASE_ID,
    )
    const row = result.rows[0]
    return row ? rowToWorker(row) : null
  },

  async getByName(name: string): Promise<DWSWorker | null> {
    const client = await getSQLitClient()
    const result = await client.query<DWSWorkerRow>(
      'SELECT * FROM dws_workers WHERE name = ? ORDER BY updated_at DESC LIMIT 1',
      [name],
      SQLIT_DATABASE_ID,
    )
    const row = result.rows[0]
    return row ? rowToWorker(row) : null
  },

  async getByCid(codeCid: string): Promise<DWSWorker | null> {
    const client = await getSQLitClient()
    const result = await client.query<DWSWorkerRow>(
      'SELECT * FROM dws_workers WHERE code_cid = ? ORDER BY updated_at DESC LIMIT 1',
      [codeCid],
      SQLIT_DATABASE_ID,
    )
    const row = result.rows[0]
    return row ? rowToWorker(row) : null
  },

  async listAll(): Promise<DWSWorker[]> {
    const client = await getSQLitClient()
    const result = await client.query<DWSWorkerRow>(
      'SELECT * FROM dws_workers ORDER BY updated_at DESC',
      [],
      SQLIT_DATABASE_ID,
    )
    return result.rows.map(rowToWorker)
  },

  async listByOwner(owner: string): Promise<DWSWorker[]> {
    const client = await getSQLitClient()
    const result = await client.query<DWSWorkerRow>(
      'SELECT * FROM dws_workers WHERE owner = ? ORDER BY updated_at DESC',
      [owner],
      SQLIT_DATABASE_ID,
    )
    return result.rows.map(rowToWorker)
  },

  async listActive(): Promise<DWSWorker[]> {
    const client = await getSQLitClient()
    const result = await client.query<DWSWorkerRow>(
      "SELECT * FROM dws_workers WHERE status = 'active' ORDER BY updated_at DESC",
      [],
      SQLIT_DATABASE_ID,
    )
    return result.rows.map(rowToWorker)
  },

  async delete(id: string): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.exec(
      'DELETE FROM dws_workers WHERE id = ?',
      [id],
      SQLIT_DATABASE_ID,
    )

    if (result.rowsAffected > 0) {
      console.log(`[DWSWorkerState] Deleted worker: ${id}`)
    }

    return result.rowsAffected > 0
  },

  async updateStatus(
    id: string,
    status: 'active' | 'inactive' | 'error',
  ): Promise<boolean> {
    const client = await getSQLitClient()
    const result = await client.exec(
      'UPDATE dws_workers SET status = ?, updated_at = ? WHERE id = ?',
      [status, Date.now(), id],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },

  async recordInvocation(
    id: string,
    durationMs: number,
    isError: boolean,
  ): Promise<void> {
    const client = await getSQLitClient()
    const worker = await this.get(id)
    if (!worker) return

    const newCount = worker.invocationCount + 1
    const newAvg = Math.round(
      (worker.avgDurationMs * worker.invocationCount + durationMs) / newCount,
    )
    const newErrors = isError ? worker.errorCount + 1 : worker.errorCount

    await client.exec(
      `UPDATE dws_workers SET
        invocation_count = ?, avg_duration_ms = ?, error_count = ?, updated_at = ?
      WHERE id = ?`,
      [newCount, newAvg, newErrors, Date.now(), id],
      SQLIT_DATABASE_ID,
    )
  },
}

// ============================================================================
// Worker Version History State
// ============================================================================

export interface WorkerVersion {
  id: string
  workerId: string
  version: number
  codeCid: string
  runtime: string
  handler: string
  memory: number
  timeout: number
  env: string
  createdAt: number
}

interface WorkerVersionRow {
  id: string
  worker_id: string
  version: number
  code_cid: string
  runtime: string
  handler: string
  memory: number
  timeout: number
  env: string
  created_at: number
}

function rowToWorkerVersion(row: WorkerVersionRow): WorkerVersion {
  return {
    id: row.id,
    workerId: row.worker_id,
    version: row.version,
    codeCid: row.code_cid,
    runtime: row.runtime,
    handler: row.handler,
    memory: row.memory,
    timeout: row.timeout,
    env: row.env,
    createdAt: row.created_at,
  }
}

// In-memory store for worker versions (memory-only mode fallback)
const workerVersionsMemory = new Map<string, WorkerVersion>()

export const workerVersionState = {
  async saveVersion(worker: DWSWorker): Promise<WorkerVersion> {
    const now = Date.now()
    const versionId = `${worker.id}:v${worker.version}`
    const version: WorkerVersion = {
      id: versionId,
      workerId: worker.id,
      version: worker.version,
      codeCid: worker.codeCid,
      runtime: worker.runtime,
      handler: worker.handler,
      memory: worker.memory,
      timeout: worker.timeout,
      env: JSON.stringify(worker.env),
      createdAt: now,
    }

    if (memoryOnlyMode) {
      workerVersionsMemory.set(versionId, version)
      return version
    }

    const client = await getSQLitClient()
    await client.exec(
      `INSERT OR REPLACE INTO dws_worker_versions (
        id, worker_id, version, code_cid, runtime, handler, memory, timeout, env, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        versionId,
        worker.id,
        worker.version,
        worker.codeCid,
        worker.runtime,
        worker.handler,
        worker.memory,
        worker.timeout,
        JSON.stringify(worker.env),
        now,
      ],
      SQLIT_DATABASE_ID,
    )

    return version
  },

  async getVersion(
    workerId: string,
    version: number,
  ): Promise<WorkerVersion | null> {
    const versionId = `${workerId}:v${version}`

    if (memoryOnlyMode) {
      return workerVersionsMemory.get(versionId) ?? null
    }

    const client = await getSQLitClient()
    const result = await client.query<WorkerVersionRow>(
      'SELECT * FROM dws_worker_versions WHERE worker_id = ? AND version = ?',
      [workerId, version],
      SQLIT_DATABASE_ID,
    )
    const row = result.rows[0]
    return row ? rowToWorkerVersion(row) : null
  },

  async listVersions(workerId: string): Promise<WorkerVersion[]> {
    if (memoryOnlyMode) {
      return Array.from(workerVersionsMemory.values())
        .filter((v) => v.workerId === workerId)
        .sort((a, b) => b.version - a.version)
    }

    const client = await getSQLitClient()
    const result = await client.query<WorkerVersionRow>(
      'SELECT * FROM dws_worker_versions WHERE worker_id = ? ORDER BY version DESC',
      [workerId],
      SQLIT_DATABASE_ID,
    )
    return result.rows.map(rowToWorkerVersion)
  },

  async getLatestVersion(workerId: string): Promise<WorkerVersion | null> {
    const versions = await this.listVersions(workerId)
    return versions[0] ?? null
  },
}

// ============================================================================
// CLI Secrets State
// ============================================================================

export interface CLISecret {
  id: string
  appName: string
  key: string
  value: string
  scope: 'production' | 'preview' | 'development' | 'all'
  owner: string
  createdAt: number
  updatedAt: number
}

interface CLISecretRow {
  id: string
  app_name: string
  key: string
  value: string
  scope: string
  owner: string
  created_at: number
  updated_at: number
}

function rowToSecret(row: CLISecretRow): CLISecret {
  return {
    id: row.id,
    appName: row.app_name,
    key: row.key,
    value: row.value,
    scope: row.scope as CLISecret['scope'],
    owner: row.owner,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const cliSecretState = {
  async set(
    appName: string,
    key: string,
    value: string,
    scope: CLISecret['scope'],
    owner: string,
  ): Promise<CLISecret> {
    const now = Date.now()
    const id = `${appName}:${key}`
    const secret: CLISecret = {
      id,
      appName,
      key,
      value,
      scope,
      owner,
      createdAt: now,
      updatedAt: now,
    }

    if (memoryOnlyMode) {
      memoryStores.cliSecrets.set(id, secret)
      return secret
    }

    const client = await getSQLitClient()
    await client.exec(
      `INSERT OR REPLACE INTO cli_secrets (id, app_name, key, value, scope, owner, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, appName, key, value, scope, owner, now, now],
      SQLIT_DATABASE_ID,
    )

    return secret
  },

  async get(appName: string, key: string): Promise<CLISecret | null> {
    const id = `${appName}:${key}`

    if (memoryOnlyMode) {
      return memoryStores.cliSecrets.get(id) ?? null
    }

    const client = await getSQLitClient()
    const result = await client.query<CLISecretRow>(
      'SELECT * FROM cli_secrets WHERE app_name = ? AND key = ?',
      [appName, key],
      SQLIT_DATABASE_ID,
    )
    const row = result.rows[0]
    return row ? rowToSecret(row) : null
  },

  async listByApp(appName: string, owner: string): Promise<CLISecret[]> {
    if (memoryOnlyMode) {
      return Array.from(memoryStores.cliSecrets.values()).filter(
        (s) =>
          s.appName === appName &&
          s.owner.toLowerCase() === owner.toLowerCase(),
      )
    }

    const client = await getSQLitClient()
    const result = await client.query<CLISecretRow>(
      'SELECT * FROM cli_secrets WHERE app_name = ? AND owner = ? ORDER BY key',
      [appName, owner],
      SQLIT_DATABASE_ID,
    )
    return result.rows.map(rowToSecret)
  },

  async delete(appName: string, key: string): Promise<boolean> {
    const id = `${appName}:${key}`

    if (memoryOnlyMode) {
      return memoryStores.cliSecrets.delete(id)
    }

    const client = await getSQLitClient()
    const result = await client.exec(
      'DELETE FROM cli_secrets WHERE app_name = ? AND key = ?',
      [appName, key],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },
}

// ============================================================================
// CLI Preview Deployments State
// ============================================================================

export interface CLIPreview {
  previewId: string
  appName: string
  branchName: string
  commitSha: string
  status: 'pending' | 'building' | 'deploying' | 'active' | 'sleeping' | 'error'
  previewUrl: string
  apiUrl: string | null
  owner: string
  createdAt: number
  updatedAt: number
  expiresAt: number
}

interface CLIPreviewRow {
  preview_id: string
  app_name: string
  branch_name: string
  commit_sha: string
  status: string
  preview_url: string
  api_url: string | null
  owner: string
  created_at: number
  updated_at: number
  expires_at: number
}

function rowToPreview(row: CLIPreviewRow): CLIPreview {
  return {
    previewId: row.preview_id,
    appName: row.app_name,
    branchName: row.branch_name,
    commitSha: row.commit_sha,
    status: row.status as CLIPreview['status'],
    previewUrl: row.preview_url,
    apiUrl: row.api_url,
    owner: row.owner,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  }
}

export const cliPreviewState = {
  async create(
    preview: Omit<CLIPreview, 'createdAt' | 'updatedAt'>,
  ): Promise<CLIPreview> {
    const now = Date.now()
    const fullPreview: CLIPreview = {
      ...preview,
      createdAt: now,
      updatedAt: now,
    }

    if (memoryOnlyMode) {
      memoryStores.cliPreviews.set(preview.previewId, fullPreview)
      return fullPreview
    }

    const client = await getSQLitClient()
    await client.exec(
      `INSERT INTO cli_previews (
        preview_id, app_name, branch_name, commit_sha, status, preview_url, api_url,
        owner, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        preview.previewId,
        preview.appName,
        preview.branchName,
        preview.commitSha,
        preview.status,
        preview.previewUrl,
        preview.apiUrl,
        preview.owner,
        now,
        now,
        preview.expiresAt,
      ],
      SQLIT_DATABASE_ID,
    )

    return fullPreview
  },

  async get(previewId: string): Promise<CLIPreview | null> {
    if (memoryOnlyMode) {
      return memoryStores.cliPreviews.get(previewId) ?? null
    }

    const client = await getSQLitClient()
    const result = await client.query<CLIPreviewRow>(
      'SELECT * FROM cli_previews WHERE preview_id = ?',
      [previewId],
      SQLIT_DATABASE_ID,
    )
    const row = result.rows[0]
    return row ? rowToPreview(row) : null
  },

  async listByOwner(owner: string): Promise<CLIPreview[]> {
    if (memoryOnlyMode) {
      return Array.from(memoryStores.cliPreviews.values())
        .filter((p) => p.owner.toLowerCase() === owner.toLowerCase())
        .sort((a, b) => b.createdAt - a.createdAt)
    }

    const client = await getSQLitClient()
    const result = await client.query<CLIPreviewRow>(
      'SELECT * FROM cli_previews WHERE owner = ? ORDER BY created_at DESC',
      [owner],
      SQLIT_DATABASE_ID,
    )
    return result.rows.map(rowToPreview)
  },

  async updateStatus(
    previewId: string,
    status: CLIPreview['status'],
  ): Promise<boolean> {
    if (memoryOnlyMode) {
      const preview = memoryStores.cliPreviews.get(previewId)
      if (preview) {
        preview.status = status
        preview.updatedAt = Date.now()
        return true
      }
      return false
    }

    const client = await getSQLitClient()
    const result = await client.exec(
      'UPDATE cli_previews SET status = ?, updated_at = ? WHERE preview_id = ?',
      [status, Date.now(), previewId],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },

  async delete(previewId: string): Promise<boolean> {
    if (memoryOnlyMode) {
      return memoryStores.cliPreviews.delete(previewId)
    }

    const client = await getSQLitClient()
    const result = await client.exec(
      'DELETE FROM cli_previews WHERE preview_id = ?',
      [previewId],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },
}

// ============================================================================
// JNS Domains State
// ============================================================================

export interface JNSDomain {
  name: string
  owner: string
  contentCid: string | null
  workerId: string | null
  registeredAt: number
  expiresAt: number
  ttl: number
}

interface JNSDomainRow {
  name: string
  owner: string
  content_cid: string | null
  worker_id: string | null
  registered_at: number
  expires_at: number
  ttl: number
}

function rowToDomain(row: JNSDomainRow): JNSDomain {
  return {
    name: row.name,
    owner: row.owner,
    contentCid: row.content_cid,
    workerId: row.worker_id,
    registeredAt: row.registered_at,
    expiresAt: row.expires_at,
    ttl: row.ttl,
  }
}

export const jnsDomainState = {
  async register(domain: Omit<JNSDomain, 'registeredAt'>): Promise<JNSDomain> {
    const now = Date.now()
    const fullDomain: JNSDomain = { ...domain, registeredAt: now }

    if (memoryOnlyMode) {
      memoryStores.jnsDomains.set(domain.name, fullDomain)
      return fullDomain
    }

    const client = await getSQLitClient()
    await client.exec(
      `INSERT INTO jns_domains (name, owner, content_cid, worker_id, registered_at, expires_at, ttl)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        domain.name,
        domain.owner,
        domain.contentCid,
        domain.workerId,
        now,
        domain.expiresAt,
        domain.ttl,
      ],
      SQLIT_DATABASE_ID,
    )

    return fullDomain
  },

  async get(name: string): Promise<JNSDomain | null> {
    if (memoryOnlyMode) {
      return memoryStores.jnsDomains.get(name) ?? null
    }

    const client = await getSQLitClient()
    const result = await client.query<JNSDomainRow>(
      'SELECT * FROM jns_domains WHERE name = ?',
      [name],
      SQLIT_DATABASE_ID,
    )
    const row = result.rows[0]
    return row ? rowToDomain(row) : null
  },

  async listByOwner(owner: string): Promise<JNSDomain[]> {
    if (memoryOnlyMode) {
      return Array.from(memoryStores.jnsDomains.values())
        .filter((d) => d.owner.toLowerCase() === owner.toLowerCase())
        .sort((a, b) => a.name.localeCompare(b.name))
    }

    const client = await getSQLitClient()
    const result = await client.query<JNSDomainRow>(
      'SELECT * FROM jns_domains WHERE owner = ? ORDER BY name',
      [owner],
      SQLIT_DATABASE_ID,
    )
    return result.rows.map(rowToDomain)
  },

  async setContent(name: string, contentCid: string): Promise<boolean> {
    if (memoryOnlyMode) {
      const domain = memoryStores.jnsDomains.get(name)
      if (domain) {
        domain.contentCid = contentCid
        return true
      }
      return false
    }

    const client = await getSQLitClient()
    const result = await client.exec(
      'UPDATE jns_domains SET content_cid = ? WHERE name = ?',
      [contentCid, name],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },

  async linkWorker(name: string, workerId: string): Promise<boolean> {
    if (memoryOnlyMode) {
      const domain = memoryStores.jnsDomains.get(name)
      if (domain) {
        domain.workerId = workerId
        return true
      }
      return false
    }

    const client = await getSQLitClient()
    const result = await client.exec(
      'UPDATE jns_domains SET worker_id = ? WHERE name = ?',
      [workerId, name],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },

  async transfer(name: string, newOwner: string): Promise<boolean> {
    if (memoryOnlyMode) {
      const domain = memoryStores.jnsDomains.get(name)
      if (domain) {
        domain.owner = newOwner
        return true
      }
      return false
    }

    const client = await getSQLitClient()
    const result = await client.exec(
      'UPDATE jns_domains SET owner = ? WHERE name = ?',
      [newOwner, name],
      SQLIT_DATABASE_ID,
    )
    return result.rowsAffected > 0
  },

  async isAvailable(name: string): Promise<boolean> {
    const domain = await this.get(name)
    if (!domain) return true
    // Domain is available if expired
    return domain.expiresAt < Date.now()
  },
}

// ============================================================================
// Credit Transaction State
// ============================================================================

export interface CreditTransaction {
  id: string
  owner: string
  type: 'topup' | 'usage' | 'refund' | 'adjustment'
  amount: string
  balanceAfter: string
  txHash: string | null
  description: string | null
  createdAt: number
}

interface CreditTransactionRow {
  id: string
  owner: string
  type: string
  amount: string
  balance_after: string
  tx_hash: string | null
  description: string | null
  created_at: number
}

function rowToCreditTransaction(row: CreditTransactionRow): CreditTransaction {
  return {
    id: row.id,
    owner: row.owner,
    type: row.type as CreditTransaction['type'],
    amount: row.amount,
    balanceAfter: row.balance_after,
    txHash: row.tx_hash,
    description: row.description,
    createdAt: row.created_at,
  }
}

// In-memory store for credit transactions (memory-only mode fallback)
const creditTransactionsMemory = new Map<string, CreditTransaction>()

export const creditTransactionState = {
  async record(
    owner: string,
    type: CreditTransaction['type'],
    amount: bigint,
    balanceAfter: bigint,
    txHash?: string,
    description?: string,
  ): Promise<CreditTransaction> {
    const now = Date.now()
    const id = `txn_${now}_${Math.random().toString(36).slice(2, 10)}`
    const txn: CreditTransaction = {
      id,
      owner,
      type,
      amount: amount.toString(),
      balanceAfter: balanceAfter.toString(),
      txHash: txHash ?? null,
      description: description ?? null,
      createdAt: now,
    }

    if (memoryOnlyMode) {
      creditTransactionsMemory.set(id, txn)
      return txn
    }

    const client = await getSQLitClient()
    await client.exec(
      `INSERT INTO credit_transactions (id, owner, type, amount, balance_after, tx_hash, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        owner,
        type,
        txn.amount,
        txn.balanceAfter,
        txn.txHash,
        txn.description,
        now,
      ],
      SQLIT_DATABASE_ID,
    )

    return txn
  },

  async listByOwner(
    owner: string,
    limit: number = 100,
  ): Promise<CreditTransaction[]> {
    if (memoryOnlyMode) {
      return Array.from(creditTransactionsMemory.values())
        .filter((t) => t.owner.toLowerCase() === owner.toLowerCase())
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit)
    }

    const client = await getSQLitClient()
    const result = await client.query<CreditTransactionRow>(
      'SELECT * FROM credit_transactions WHERE owner = ? ORDER BY created_at DESC LIMIT ?',
      [owner, limit],
      SQLIT_DATABASE_ID,
    )
    return result.rows.map(rowToCreditTransaction)
  },

  async getByTxHash(txHash: string): Promise<CreditTransaction | null> {
    if (memoryOnlyMode) {
      return (
        Array.from(creditTransactionsMemory.values()).find(
          (t) => t.txHash === txHash,
        ) ?? null
      )
    }

    const client = await getSQLitClient()
    const result = await client.query<CreditTransactionRow>(
      'SELECT * FROM credit_transactions WHERE tx_hash = ?',
      [txHash],
      SQLIT_DATABASE_ID,
    )
    const row = result.rows[0]
    return row ? rowToCreditTransaction(row) : null
  },
}

// Track if we're in memory-only mode (no SQLit)
// Allow memory-only mode when testing (DWS_TEST_MODE=1) or explicitly requested
const memoryOnlyMode = process.env.DWS_TEST_MODE === '1'

// In-memory stores for when SQLit is unavailable
const memoryStores = {
  computeJobs: new Map<string, ComputeJobRow>(),
  apiUserAccounts: new Map<string, ApiUserAccountRow>(),
  cliSecrets: new Map<string, CLISecret>(),
  cliPreviews: new Map<string, CLIPreview>(),
  jnsDomains: new Map<string, JNSDomain>(),
}

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
    // If test mode, use memory-only without trying SQLit
    if (memoryOnlyMode) {
      initialized = true
      console.log('[DWS State] Running in test mode - memory-only persistence')
      return
    }

    try {
      await getSQLitClient()
      initialized = true
      console.log('[DWS State] Initialized with SQLit - persistence enabled')
    } catch (error) {
      // Log the actual error for debugging
      const errorMsg = error instanceof Error ? error.message : String(error)
      const network = getCurrentNetwork()
      const sqlitUrl = getSQLitUrl()
      const sqlitMinerUrl = getSQLitMinerUrl()

      console.error('')
      console.error(
        '╔═══════════════════════════════════════════════════════════════╗',
      )
      console.error(
        '║  ERROR: SQLit connection failed - DWS cannot start           ║',
      )
      console.error(
        '╠═══════════════════════════════════════════════════════════════╣',
      )
      console.error(`║  Network: ${network.padEnd(52)}║`)
      console.error(
        `║  SQLit URL: ${(sqlitUrl ?? 'not configured').slice(0, 49).padEnd(49)}║`,
      )
      console.error(
        `║  Miner URL: ${(sqlitMinerUrl ?? 'not configured').slice(0, 49).padEnd(49)}║`,
      )
      console.error(`║  Error: ${errorMsg.slice(0, 52).padEnd(52)}║`)
      console.error(
        '║                                                               ║',
      )
      console.error(
        '║  SQLit is REQUIRED for decentralized state persistence.      ║',
      )
      console.error(
        '║  Memory-only mode is NOT allowed - no fallbacks, no LARP.    ║',
      )
      console.error(
        '║                                                               ║',
      )
      console.error(
        '║  TO FIX (choose one):                                        ║',
      )
      console.error(
        '║                                                               ║',
      )
      console.error(
        '║  1. Start SQLit with Docker:                                 ║',
      )
      console.error(
        '║     cd packages/sqlit && docker compose up -d sqlit_bp_0     ║',
      )
      console.error(
        '║                                                               ║',
      )
      console.error(
        '║  2. Start SQLit adapter (simpler):                           ║',
      )
      console.error(
        '║     cd packages/sqlit/adapter && bun run server.ts           ║',
      )
      console.error(
        '║                                                               ║',
      )
      console.error(
        '║  3. Build and run native SQLit:                              ║',
      )
      console.error(
        '║     cd packages/sqlit && make bin/sqlitd                     ║',
      )
      console.error(
        '║     ./bin/sqlitd -config config-minimal.yaml                 ║',
      )
      console.error(
        '║                                                               ║',
      )
      console.error(
        '║  4. Start full local stack (recommended):                    ║',
      )
      console.error(
        '║     bun run apps/dws/scripts/local-stack.ts                  ║',
      )
      console.error(
        '╚═══════════════════════════════════════════════════════════════╝',
      )
      console.error('')

      // FAIL HARD - no fallback to memory mode
      throw new Error(
        `SQLit connection failed: ${errorMsg}. See above for resolution steps.`,
      )
    }
  })()

  try {
    await initPromise
  } finally {
    initPromise = null
  }
}

/**
 * Check if DWS is running in degraded mode (no persistence)
 * Use this to fail fast when persistence is required
 */
export function isDegradedMode(): boolean {
  return memoryOnlyMode
}

// Get state mode
export function getStateMode(): 'sqlit' | 'memory' {
  return memoryOnlyMode ? 'memory' : 'sqlit'
}
