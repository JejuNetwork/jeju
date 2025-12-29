import { getCurrentNetwork, isProductionEnv } from '@jejunetwork/config'
import { type EQLiteClient, getEQLite } from '@jejunetwork/db'
import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import type {
  Intent,
  IntentRoute,
  Solver,
  SupportedChainId,
} from '@jejunetwork/types'
import {
  AddressSchema,
  IntentInputSchema,
  IntentOutputSchema,
  isSupportedChainId,
  parseOptionalAddress,
  parseOptionalHex,
  SupportedChainIdSchema,
} from '@jejunetwork/types'
import { z } from 'zod'
import { CachedIntentSchema, CachedSolverSchema } from '../../lib/validation'

// Schemas for DB JSON columns
const IntentInputsSchema = z.array(IntentInputSchema)
const IntentOutputsSchema = z.array(IntentOutputSchema)
const SupportedChainsSchema = z.array(SupportedChainIdSchema)
const SupportedTokensSchema = z.record(z.string(), z.array(AddressSchema))

const EQLITE_DATABASE_ID = process.env.EQLITE_DATABASE_ID ?? 'gateway'

let eqliteClient: EQLiteClient | null = null
let cacheClient: CacheClient | null = null
let initialized = false

async function getEQLiteClient(): Promise<EQLiteClient> {
  if (!eqliteClient) {
    eqliteClient = getEQLite({
      databaseId: EQLITE_DATABASE_ID,
      timeout: 30000,
      debug: !isProductionEnv(),
    })

    const healthy = await eqliteClient.isHealthy()
    if (!healthy) {
      const network = getCurrentNetwork()
      throw new Error(
        `Gateway requires EQLite for decentralized state (network: ${network}).\n` +
          'Ensure EQLite is running: docker compose up -d eqlite',
      )
    }

    await ensureTablesExist()
  }

  return eqliteClient
}

function getCache(): CacheClient {
  if (!cacheClient) {
    cacheClient = getCacheClient('gateway')
  }
  return cacheClient
}

async function ensureTablesExist(): Promise<void> {
  if (!eqliteClient) return

  const tables = [
    `CREATE TABLE IF NOT EXISTS intents (
      intent_id TEXT PRIMARY KEY,
      user_address TEXT NOT NULL,
      nonce TEXT NOT NULL,
      source_chain_id INTEGER NOT NULL,
      open_deadline INTEGER NOT NULL,
      fill_deadline INTEGER NOT NULL,
      inputs TEXT NOT NULL,
      outputs TEXT NOT NULL,
      signature TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      solver TEXT,
      tx_hash TEXT,
      created_at INTEGER NOT NULL,
      filled_at INTEGER,
      cancelled_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS solvers (
      address TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      endpoint TEXT,
      supported_chains TEXT NOT NULL DEFAULT '[]',
      supported_tokens TEXT NOT NULL DEFAULT '{}',
      reputation INTEGER DEFAULT 0,
      total_fills INTEGER DEFAULT 0,
      successful_fills INTEGER DEFAULT 0,
      failed_fills INTEGER DEFAULT 0,
      success_rate REAL DEFAULT 0,
      total_volume_usd TEXT DEFAULT '0',
      total_fees_usd TEXT DEFAULT '0',
      staked_amount TEXT DEFAULT '0',
      status TEXT NOT NULL DEFAULT 'active',
      registered_at INTEGER NOT NULL,
      last_active_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS route_stats (
      route_id TEXT PRIMARY KEY,
      source_chain_id INTEGER NOT NULL,
      destination_chain_id INTEGER NOT NULL,
      source_token TEXT NOT NULL,
      destination_token TEXT NOT NULL,
      oracle TEXT NOT NULL,
      total_volume TEXT DEFAULT '0',
      total_intents INTEGER DEFAULT 0,
      avg_fee_percent INTEGER DEFAULT 50,
      avg_fill_time_seconds INTEGER DEFAULT 30,
      success_rate REAL DEFAULT 0,
      active_solvers INTEGER DEFAULT 0,
      total_liquidity TEXT DEFAULT '0',
      is_active INTEGER DEFAULT 1,
      last_updated INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS intent_events (
      id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      data TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS faucet_claims (
      address TEXT PRIMARY KEY,
      last_claim INTEGER NOT NULL,
      total_claims INTEGER DEFAULT 1
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
    `CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      address TEXT NOT NULL,
      name TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'FREE',
      created_at INTEGER NOT NULL,
      last_used_at INTEGER DEFAULT 0,
      request_count INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    )`,
  ]

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_intents_user ON intents(user_address)',
    'CREATE INDEX IF NOT EXISTS idx_intents_status ON intents(status)',
    'CREATE INDEX IF NOT EXISTS idx_intents_source_chain ON intents(source_chain_id)',
    'CREATE INDEX IF NOT EXISTS idx_intents_created ON intents(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_solvers_status ON solvers(status)',
    'CREATE INDEX IF NOT EXISTS idx_route_stats_chains ON route_stats(source_chain_id, destination_chain_id)',
    'CREATE INDEX IF NOT EXISTS idx_intent_events_intent ON intent_events(intent_id)',
    'CREATE INDEX IF NOT EXISTS idx_api_keys_address ON api_keys(address)',
    'CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)',
  ]

  for (const ddl of tables) {
    await eqliteClient.exec(ddl, [], EQLITE_DATABASE_ID)
  }

  for (const idx of indexes) {
    await eqliteClient.exec(idx, [], EQLITE_DATABASE_ID)
  }

  console.log('[Gateway State] EQLite tables ensured')
}

interface IntentRow {
  intent_id: string
  user_address: string
  nonce: string
  source_chain_id: number
  open_deadline: number
  fill_deadline: number
  inputs: string
  outputs: string
  signature: string | null
  status: string
  solver: string | null
  tx_hash: string | null
  created_at: number
  filled_at: number | null
  cancelled_at: number | null
}

interface SolverRow {
  address: string
  name: string
  endpoint: string | null
  supported_chains: string
  supported_tokens: string
  reputation: number
  total_fills: number
  successful_fills: number
  failed_fills: number
  success_rate: number
  total_volume_usd: string
  total_fees_usd: string
  staked_amount: string
  status: string
  registered_at: number
  last_active_at: number | null
}

function intentToRow(intent: Intent): IntentRow {
  return {
    intent_id: intent.intentId,
    user_address: intent.user.toLowerCase(),
    nonce: intent.nonce,
    source_chain_id: intent.sourceChainId,
    open_deadline: intent.openDeadline,
    fill_deadline: intent.fillDeadline,
    inputs: JSON.stringify(intent.inputs),
    outputs: JSON.stringify(intent.outputs),
    signature: intent.signature ?? null,
    status: intent.status,
    solver: intent.solver ?? null,
    tx_hash: intent.txHash ?? null,
    created_at: intent.createdAt ?? Date.now(),
    filled_at: intent.filledAt ?? null,
    cancelled_at: intent.cancelledAt ?? null,
  }
}

/** Valid intent statuses */
const INTENT_STATUSES = [
  'open',
  'pending',
  'filled',
  'expired',
  'cancelled',
  'failed',
] as const

/** Valid solver statuses */
const SOLVER_STATUSES = ['active', 'inactive', 'slashed', 'pending'] as const

/** Safely parse a chain ID from database */
function parseChainId(value: number): SupportedChainId {
  if (!isSupportedChainId(value as SupportedChainId)) {
    throw new Error(`Invalid chain ID in database: ${value}`)
  }
  return value as SupportedChainId
}

/** Safely parse intent status from database */
function parseIntentStatus(value: string): Intent['status'] {
  if ((INTENT_STATUSES as readonly string[]).includes(value)) {
    return value as Intent['status']
  }
  return 'open'
}

/** Safely parse solver status from database */
function parseSolverStatus(value: string): Solver['status'] {
  if ((SOLVER_STATUSES as readonly string[]).includes(value)) {
    return value as Solver['status']
  }
  return 'inactive'
}

function rowToIntent(row: IntentRow): Intent {
  const intentId = parseOptionalHex(row.intent_id)
  if (!intentId) throw new Error(`Invalid intent ID: ${row.intent_id}`)

  const user = parseOptionalAddress(row.user_address)
  if (!user) throw new Error(`Invalid user address in intent: ${row.intent_id}`)

  return {
    intentId,
    user,
    nonce: row.nonce,
    sourceChainId: parseChainId(row.source_chain_id),
    openDeadline: row.open_deadline,
    fillDeadline: row.fill_deadline,
    inputs: IntentInputsSchema.parse(JSON.parse(row.inputs)),
    outputs: IntentOutputsSchema.parse(JSON.parse(row.outputs)),
    signature: parseOptionalHex(row.signature) ?? '0x',
    status: parseIntentStatus(row.status),
    solver: parseOptionalAddress(row.solver),
    txHash: parseOptionalHex(row.tx_hash),
    createdAt: row.created_at,
    filledAt: row.filled_at ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
  }
}

function solverToRow(solver: Solver): SolverRow {
  return {
    address: solver.address.toLowerCase(),
    name: solver.name,
    endpoint: solver.endpoint ?? null,
    supported_chains: JSON.stringify(solver.supportedChains),
    supported_tokens: JSON.stringify(solver.supportedTokens),
    reputation: solver.reputation,
    total_fills: solver.totalFills,
    successful_fills: solver.successfulFills,
    failed_fills: solver.failedFills,
    success_rate: solver.successRate,
    total_volume_usd: solver.totalVolumeUsd,
    total_fees_usd: solver.totalFeesEarnedUsd,
    staked_amount: solver.stakedAmount,
    status: solver.status,
    registered_at: solver.registeredAt,
    last_active_at: solver.lastActiveAt ?? null,
  }
}

function rowToSolver(row: SolverRow): Solver {
  const address = parseOptionalAddress(row.address)
  if (!address) throw new Error(`Invalid solver address: ${row.address}`)

  return {
    address,
    name: row.name,
    endpoint: row.endpoint ?? '',
    supportedChains: SupportedChainsSchema.parse(
      JSON.parse(row.supported_chains),
    ),
    supportedTokens: SupportedTokensSchema.parse(
      JSON.parse(row.supported_tokens),
    ),
    liquidity: [],
    reputation: row.reputation,
    totalFills: row.total_fills,
    successfulFills: row.successful_fills,
    failedFills: row.failed_fills,
    successRate: row.success_rate,
    avgResponseMs: 0,
    avgFillTimeMs: 0,
    totalVolumeUsd: row.total_volume_usd,
    totalFeesEarnedUsd: row.total_fees_usd,
    stakedAmount: row.staked_amount,
    status: parseSolverStatus(row.status),
    registeredAt: row.registered_at,
    lastActiveAt: row.last_active_at ?? undefined,
  }
}

export const intentState = {
  async save(intent: Intent): Promise<void> {
    const row = intentToRow(intent)
    const cache = getCache()
    const client = await getEQLiteClient()

    await client.exec(
      `INSERT INTO intents (intent_id, user_address, nonce, source_chain_id, open_deadline, fill_deadline,
       inputs, outputs, signature, status, solver, tx_hash, created_at, filled_at, cancelled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(intent_id) DO UPDATE SET
       status = excluded.status, solver = excluded.solver, tx_hash = excluded.tx_hash,
       filled_at = excluded.filled_at, cancelled_at = excluded.cancelled_at`,
      [
        row.intent_id,
        row.user_address,
        row.nonce,
        row.source_chain_id,
        row.open_deadline,
        row.fill_deadline,
        row.inputs,
        row.outputs,
        row.signature,
        row.status,
        row.solver,
        row.tx_hash,
        row.created_at,
        row.filled_at,
        row.cancelled_at,
      ],
      EQLITE_DATABASE_ID,
    )

    await cache.delete(`intent:${row.intent_id}`)
  },

  async get(intentId: string): Promise<Intent | null> {
    const cache = getCache()
    const cached = await cache.get(`intent:${intentId}`)
    if (cached) {
      const parsed = CachedIntentSchema.safeParse(JSON.parse(cached))
      if (parsed.success) return parsed.data as Intent
    }

    const client = await getEQLiteClient()
    const result = await client.query<IntentRow>(
      'SELECT * FROM intents WHERE intent_id = ?',
      [intentId],
      EQLITE_DATABASE_ID,
    )
    const row = result.rows[0]
    if (row) {
      const intent = rowToIntent(row)
      await cache.set(`intent:${intentId}`, JSON.stringify(intent), 60)
      return intent
    }

    return null
  },

  async list(params?: {
    user?: string
    status?: string
    sourceChain?: number
    limit?: number
  }): Promise<Intent[]> {
    const client = await getEQLiteClient()
    const conditions: string[] = []
    const values: Array<string | number> = []

    if (params?.user) {
      conditions.push('user_address = ?')
      values.push(params.user.toLowerCase())
    }
    if (params?.status) {
      conditions.push('status = ?')
      values.push(params.status)
    }
    if (params?.sourceChain) {
      conditions.push('source_chain_id = ?')
      values.push(params.sourceChain)
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = params?.limit ?? 100
    values.push(limit)

    const result = await client.query<IntentRow>(
      `SELECT * FROM intents ${where} ORDER BY created_at DESC LIMIT ?`,
      values,
      EQLITE_DATABASE_ID,
    )

    return result.rows.map(rowToIntent)
  },

  async updateStatus(
    intentId: string,
    status: Intent['status'],
    updates?: {
      solver?: string
      txHash?: string
      filledAt?: number
      cancelledAt?: number
    },
  ): Promise<void> {
    const cache = getCache()
    const client = await getEQLiteClient()

    const sets = ['status = ?']
    const values: Array<string | number | null> = [status]

    if (updates?.solver) {
      sets.push('solver = ?')
      values.push(updates.solver)
    }
    if (updates?.txHash) {
      sets.push('tx_hash = ?')
      values.push(updates.txHash)
    }
    if (updates?.filledAt) {
      sets.push('filled_at = ?')
      values.push(updates.filledAt)
    }
    if (updates?.cancelledAt) {
      sets.push('cancelled_at = ?')
      values.push(updates.cancelledAt)
    }

    values.push(intentId)

    await client.exec(
      `UPDATE intents SET ${sets.join(', ')} WHERE intent_id = ?`,
      values,
      EQLITE_DATABASE_ID,
    )

    await cache.delete(`intent:${intentId}`)
  },

  async count(params?: { status?: string }): Promise<number> {
    const client = await getEQLiteClient()
    const where = params?.status ? 'WHERE status = ?' : ''
    const values = params?.status ? [params.status] : []

    const result = await client.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM intents ${where}`,
      values,
      EQLITE_DATABASE_ID,
    )

    return result.rows[0].count ?? 0
  },
}

export const solverState = {
  async save(solver: Solver): Promise<void> {
    const row = solverToRow(solver)
    const cache = getCache()
    const client = await getEQLiteClient()

    await client.exec(
      `INSERT INTO solvers (address, name, endpoint, supported_chains, supported_tokens,
       reputation, total_fills, successful_fills, failed_fills, success_rate,
       total_volume_usd, total_fees_usd, staked_amount, status, registered_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
       name = excluded.name, endpoint = excluded.endpoint, supported_chains = excluded.supported_chains,
       reputation = excluded.reputation, total_fills = excluded.total_fills,
       successful_fills = excluded.successful_fills, failed_fills = excluded.failed_fills,
       success_rate = excluded.success_rate, total_volume_usd = excluded.total_volume_usd,
       total_fees_usd = excluded.total_fees_usd, staked_amount = excluded.staked_amount,
       status = excluded.status, last_active_at = excluded.last_active_at`,
      [
        row.address,
        row.name,
        row.endpoint,
        row.supported_chains,
        row.supported_tokens,
        row.reputation,
        row.total_fills,
        row.successful_fills,
        row.failed_fills,
        row.success_rate,
        row.total_volume_usd,
        row.total_fees_usd,
        row.staked_amount,
        row.status,
        row.registered_at,
        row.last_active_at,
      ],
      EQLITE_DATABASE_ID,
    )

    await cache.delete(`solver:${row.address}`)
  },

  async get(address: string): Promise<Solver | null> {
    const addr = address.toLowerCase()
    const cache = getCache()
    const cached = await cache.get(`solver:${addr}`)
    if (cached) {
      const parsed = CachedSolverSchema.safeParse(JSON.parse(cached))
      if (parsed.success) return parsed.data as Solver
    }

    const client = await getEQLiteClient()
    const result = await client.query<SolverRow>(
      'SELECT * FROM solvers WHERE address = ?',
      [addr],
      EQLITE_DATABASE_ID,
    )
    const row = result.rows[0]
    if (row) {
      const solver = rowToSolver(row)
      await cache.set(`solver:${addr}`, JSON.stringify(solver), 300)
      return solver
    }

    return null
  },

  async list(params?: {
    status?: string
    minReputation?: number
  }): Promise<Solver[]> {
    const client = await getEQLiteClient()
    const conditions: string[] = []
    const values: Array<string | number> = []

    if (params?.status) {
      conditions.push('status = ?')
      values.push(params.status)
    }
    if (params?.minReputation !== undefined) {
      conditions.push('reputation >= ?')
      values.push(params.minReputation)
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const result = await client.query<SolverRow>(
      `SELECT * FROM solvers ${where} ORDER BY reputation DESC LIMIT 100`,
      values,
      EQLITE_DATABASE_ID,
    )

    return result.rows.map(rowToSolver)
  },
}

export const routeState = {
  async save(routeId: string, stats: Partial<IntentRoute>): Promise<void> {
    const client = await getEQLiteClient()
    const now = Date.now()

    await client.exec(
      `INSERT INTO route_stats (route_id, source_chain_id, destination_chain_id, source_token,
       destination_token, oracle, total_volume, total_intents, avg_fee_percent, avg_fill_time_seconds,
       success_rate, active_solvers, total_liquidity, is_active, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(route_id) DO UPDATE SET
       total_volume = excluded.total_volume, total_intents = excluded.total_intents,
       avg_fee_percent = excluded.avg_fee_percent, avg_fill_time_seconds = excluded.avg_fill_time_seconds,
       success_rate = excluded.success_rate, active_solvers = excluded.active_solvers,
       total_liquidity = excluded.total_liquidity, is_active = excluded.is_active,
       last_updated = excluded.last_updated`,
      [
        routeId,
        stats.sourceChainId ?? 0,
        stats.destinationChainId ?? 0,
        stats.sourceToken ?? '',
        stats.destinationToken ?? '',
        stats.oracle ?? 'custom',
        stats.totalVolume ?? '0',
        stats.totalIntents ?? 0,
        stats.avgFeePercent ?? 50,
        stats.avgFillTimeSeconds ?? 30,
        stats.successRate ?? 0,
        stats.activeSolvers ?? 0,
        stats.totalLiquidity ?? '0',
        stats.isActive ? 1 : 0,
        now,
      ],
      EQLITE_DATABASE_ID,
    )
  },

  async incrementVolume(routeId: string, amount: bigint): Promise<void> {
    const client = await getEQLiteClient()

    const result = await client.query<{ total_volume: string }>(
      'SELECT total_volume FROM route_stats WHERE route_id = ?',
      [routeId],
      EQLITE_DATABASE_ID,
    )

    const current = BigInt(result.rows[0].total_volume ?? '0')
    const newTotal = (current + amount).toString()

    await client.exec(
      'UPDATE route_stats SET total_volume = ?, total_intents = total_intents + 1, last_updated = ? WHERE route_id = ?',
      [newTotal, Date.now(), routeId],
      EQLITE_DATABASE_ID,
    )
  },
}

export const x402State = {
  async getCredits(address: string): Promise<bigint> {
    const addr = address.toLowerCase()
    const cache = getCache()
    const cached = await cache.get(`credits:${addr}`)
    if (cached) return BigInt(cached)

    const client = await getEQLiteClient()
    const result = await client.query<{ address: string; balance: string }>(
      'SELECT balance FROM x402_credits WHERE address = ?',
      [addr],
      EQLITE_DATABASE_ID,
    )
    const balance = result.rows[0].balance ?? '0'
    await cache.set(`credits:${addr}`, balance, 300)
    return BigInt(balance)
  },

  async addCredits(address: string, amount: bigint): Promise<void> {
    const addr = address.toLowerCase()
    const cache = getCache()
    const client = await getEQLiteClient()

    await client.exec(
      `INSERT INTO x402_credits (address, balance, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
       balance = CAST(CAST(balance AS INTEGER) + ? AS TEXT), updated_at = ?`,
      [addr, amount.toString(), Date.now(), amount.toString(), Date.now()],
      EQLITE_DATABASE_ID,
    )

    await cache.delete(`credits:${addr}`)
  },

  async deductCredits(address: string, amount: bigint): Promise<boolean> {
    const addr = address.toLowerCase()
    const current = await this.getCredits(addr)
    if (current < amount) return false

    const cache = getCache()
    const client = await getEQLiteClient()

    await client.exec(
      `UPDATE x402_credits SET balance = CAST(CAST(balance AS INTEGER) - ? AS TEXT), updated_at = ?
       WHERE address = ?`,
      [amount.toString(), Date.now(), addr],
      EQLITE_DATABASE_ID,
    )

    await cache.delete(`credits:${addr}`)
    return true
  },

  async isNonceUsed(nonce: string): Promise<boolean> {
    const client = await getEQLiteClient()
    const result = await client.query<{ nonce: string }>(
      'SELECT nonce FROM x402_nonces WHERE nonce = ?',
      [nonce],
      EQLITE_DATABASE_ID,
    )
    return result.rows.length > 0
  },

  async markNonceUsed(nonce: string): Promise<void> {
    const client = await getEQLiteClient()
    await client.exec(
      'INSERT INTO x402_nonces (nonce, used_at) VALUES (?, ?) ON CONFLICT DO NOTHING',
      [nonce, Date.now()],
      EQLITE_DATABASE_ID,
    )
  },
}

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
  async save(key: {
    id: string
    keyHash: string
    address: string
    name: string
    tier: string
    createdAt: number
  }): Promise<void> {
    const row: ApiKeyRow = {
      id: key.id,
      key_hash: key.keyHash,
      address: key.address.toLowerCase(),
      name: key.name,
      tier: key.tier,
      created_at: key.createdAt,
      last_used_at: 0,
      request_count: 0,
      is_active: 1,
    }

    const client = await getEQLiteClient()
    await client.exec(
      `INSERT INTO api_keys (id, key_hash, address, name, tier, created_at, last_used_at, request_count, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.key_hash,
        row.address,
        row.name,
        row.tier,
        row.created_at,
        row.last_used_at,
        row.request_count,
        row.is_active,
      ],
      EQLITE_DATABASE_ID,
    )
  },

  async getByHash(keyHash: string): Promise<ApiKeyRow | null> {
    const client = await getEQLiteClient()
    const result = await client.query<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1',
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

  async listByAddress(address: string): Promise<ApiKeyRow[]> {
    const addr = address.toLowerCase()
    const client = await getEQLiteClient()
    const result = await client.query<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE address = ? ORDER BY created_at DESC',
      [addr],
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

export const faucetState = {
  async getLastClaim(address: string): Promise<number | null> {
    const addr = address.toLowerCase()
    const cache = getCache()
    const cached = await cache.get(`faucet:${addr}`)
    if (cached) return parseInt(cached, 10)

    const client = await getEQLiteClient()
    const result = await client.query<{ address: string; last_claim: number }>(
      'SELECT last_claim FROM faucet_claims WHERE address = ?',
      [addr],
      EQLITE_DATABASE_ID,
    )
    if (result.rows[0]) {
      await cache.set(
        `faucet:${addr}`,
        result.rows[0].last_claim.toString(),
        3600,
      )
      return result.rows[0].last_claim
    }

    return null
  },

  async recordClaim(address: string): Promise<void> {
    const addr = address.toLowerCase()
    const now = Date.now()
    const cache = getCache()
    const client = await getEQLiteClient()

    await client.exec(
      `INSERT INTO faucet_claims (address, last_claim, total_claims)
       VALUES (?, ?, 1)
       ON CONFLICT(address) DO UPDATE SET last_claim = ?, total_claims = total_claims + 1`,
      [addr, now, now],
      EQLITE_DATABASE_ID,
    )

    await cache.set(`faucet:${addr}`, now.toString(), 3600)
  },
}

export async function initializeState(): Promise<void> {
  if (initialized) return
  await getEQLiteClient()
  initialized = true
  console.log('[Gateway State] Initialized with EQLite')
}

export function getStateMode(): 'eqlite' {
  return 'eqlite'
}
