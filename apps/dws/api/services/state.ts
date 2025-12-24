/**
 * State Management Service
 *
 * Provides persistent state storage for DWS services.
 * Uses SQLite for local storage with optional CovenantSQL for distributed state.
 */

import { Database } from 'bun:sqlite'
import type { Address } from 'viem'

// Types

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

interface X402CreditsRow {
  address: string
  balance: string
  updated_at: number
}

interface X402NonceRow {
  nonce_key: string
  used_at: number
}

// State Management

let db: Database | null = null

function getDb(): Database {
  if (!db)
    throw new Error('Database not initialized - call initializeState first')
  return db
}

export async function initializeState(): Promise<void> {
  if (db) return

  // Use in-memory database for testing, file for production
  const dbPath = process.env.DWS_STATE_DB ?? ':memory:'
  db = new Database(dbPath)

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT UNIQUE NOT NULL,
      address TEXT NOT NULL,
      name TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'FREE',
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL DEFAULT 0,
      request_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `)

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_api_keys_address ON api_keys(address)
  `)

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)
  `)

  // X402 payment tables
  db.run(`
    CREATE TABLE IF NOT EXISTS x402_credits (
      address TEXT PRIMARY KEY,
      balance TEXT NOT NULL DEFAULT '0',
      updated_at INTEGER NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS x402_nonces (
      nonce_key TEXT PRIMARY KEY,
      used_at INTEGER NOT NULL
    )
  `)
}

// API Key State

export const apiKeyState = {
  async save(record: {
    id: string
    keyHash: string
    address: string
    name: string
    tier: string
    createdAt: number
  }): Promise<void> {
    if (!db) await initializeState()

    getDb().run(
      `
      INSERT INTO api_keys (id, key_hash, address, name, tier, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      [
        record.id,
        record.keyHash,
        record.address,
        record.name,
        record.tier,
        record.createdAt,
      ],
    )
  },

  async getByHash(keyHash: string): Promise<ApiKeyRow | null> {
    if (!db) await initializeState()

    const row = getDb()
      .query<ApiKeyRow, [string]>(`
      SELECT * FROM api_keys WHERE key_hash = ?
    `)
      .get(keyHash)

    return row ?? null
  },

  async getById(id: string): Promise<ApiKeyRow | null> {
    if (!db) await initializeState()

    const row = getDb()
      .query<ApiKeyRow, [string]>(`
      SELECT * FROM api_keys WHERE id = ?
    `)
      .get(id)

    return row ?? null
  },

  async listByAddress(address: Address): Promise<ApiKeyRow[]> {
    if (!db) await initializeState()

    const rows = getDb()
      .query<ApiKeyRow, [string]>(`
      SELECT * FROM api_keys WHERE LOWER(address) = LOWER(?) ORDER BY created_at DESC
    `)
      .all(address)

    return rows
  },

  async recordUsage(keyHash: string): Promise<void> {
    if (!db) await initializeState()

    getDb().run(
      `
      UPDATE api_keys
      SET last_used_at = ?, request_count = request_count + 1
      WHERE key_hash = ?
    `,
      [Date.now(), keyHash],
    )
  },

  async revoke(id: string): Promise<boolean> {
    if (!db) await initializeState()

    const result = getDb().run(
      `
      UPDATE api_keys SET is_active = 0 WHERE id = ?
    `,
      [id],
    )

    return result.changes > 0
  },
}

// X402 Payment State

export const x402State = {
  async getCredits(address: string): Promise<bigint> {
    if (!db) await initializeState()

    const row = getDb()
      .query<X402CreditsRow, [string]>(`
      SELECT balance FROM x402_credits WHERE LOWER(address) = LOWER(?)
    `)
      .get(address)

    return row ? BigInt(row.balance) : 0n
  },

  async addCredits(address: string, amount: bigint): Promise<void> {
    if (!db) await initializeState()

    const current = await this.getCredits(address)
    const newBalance = (current + amount).toString()

    getDb().run(
      `
      INSERT INTO x402_credits (address, balance, updated_at)
      VALUES (LOWER(?), ?, ?)
      ON CONFLICT(address) DO UPDATE SET balance = ?, updated_at = ?
    `,
      [address, newBalance, Date.now(), newBalance, Date.now()],
    )
  },

  async deductCredits(address: string, amount: bigint): Promise<boolean> {
    if (!db) await initializeState()

    // Atomic deduction with balance check in single query to prevent race conditions
    const result = getDb().run(
      `
      UPDATE x402_credits
      SET balance = CAST(CAST(balance AS INTEGER) - ? AS TEXT), updated_at = ?
      WHERE LOWER(address) = LOWER(?)
        AND CAST(balance AS INTEGER) >= ?
    `,
      [amount.toString(), Date.now(), address, amount.toString()],
    )

    return result.changes > 0
  },

  async isNonceUsed(nonceKey: string): Promise<boolean> {
    if (!db) await initializeState()

    const row = getDb()
      .query<X402NonceRow, [string]>(`
      SELECT 1 FROM x402_nonces WHERE nonce_key = ?
    `)
      .get(nonceKey)

    return !!row
  },

  async markNonceUsed(nonceKey: string): Promise<void> {
    if (!db) await initializeState()

    getDb().run(
      `
      INSERT OR IGNORE INTO x402_nonces (nonce_key, used_at) VALUES (?, ?)
    `,
      [nonceKey, Date.now()],
    )
  },
}

// Compute Job State

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

async function ensureComputeJobsTable(): Promise<void> {
  if (!db) await initializeState()

  getDb().run(`
    CREATE TABLE IF NOT EXISTS compute_jobs (
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
    )
  `)
}

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
    startedAt: number | null
    completedAt: number | null
    submittedBy: string
  }): Promise<void> {
    await ensureComputeJobsTable()

    getDb().run(
      `
      INSERT INTO compute_jobs (job_id, command, shell, env, working_dir, timeout, status, output, exit_code, submitted_by, started_at, completed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        status = excluded.status,
        output = excluded.output,
        exit_code = excluded.exit_code,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at
    `,
      [
        job.jobId,
        job.command,
        job.shell,
        JSON.stringify(job.env),
        job.workingDir ?? null,
        job.timeout,
        job.status,
        job.output,
        job.exitCode,
        job.submittedBy,
        job.startedAt,
        job.completedAt,
        Date.now(),
      ],
    )
  },

  async get(jobId: string): Promise<ComputeJobRow | null> {
    await ensureComputeJobsTable()

    const row = getDb()
      .query<ComputeJobRow, [string]>(`
      SELECT * FROM compute_jobs WHERE job_id = ?
    `)
      .get(jobId)

    return row ?? null
  },

  async getQueued(): Promise<ComputeJobRow[]> {
    await ensureComputeJobsTable()

    return getDb()
      .query<ComputeJobRow, []>(`
      SELECT * FROM compute_jobs WHERE status = 'queued' ORDER BY created_at ASC
    `)
      .all()
  },

  async list(opts: {
    submittedBy?: string
    status?: string
    limit: number
  }): Promise<ComputeJobRow[]> {
    await ensureComputeJobsTable()

    let query = 'SELECT * FROM compute_jobs WHERE 1=1'
    const params: (string | number)[] = []

    if (opts.submittedBy) {
      query += ' AND LOWER(submitted_by) = LOWER(?)'
      params.push(opts.submittedBy)
    }
    if (opts.status) {
      query += ' AND status = ?'
      params.push(opts.status)
    }

    query += ' ORDER BY created_at DESC LIMIT ?'
    params.push(opts.limit)

    return getDb()
      .query<ComputeJobRow, typeof params>(query)
      .all(...params)
  },
}

// Cleanup

export function closeState(): void {
  if (db) {
    db.close()
    db = null
  }
}
