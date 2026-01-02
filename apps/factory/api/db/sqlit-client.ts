/**
 * SQLit HTTP Client for Workerd
 *
 * Workerd-compatible database client that uses SQLit HTTP API instead of bun:sqlite.
 * This file is used when running in workerd environment.
 */

import { getSQLitBlockProducerUrl } from '@jejunetwork/config'
import { z } from 'zod'

// =============================================================================
// SQLit HTTP Client
// =============================================================================

interface SQLitConfig {
  endpoint: string
  dbid: string
  timeout: number
}

interface SQLitQueryResponse {
  data?: {
    rows: Record<string, unknown>[] | null
  }
  status: string
  error?: string
  rowsAffected?: number
  lastInsertId?: string | number
}

class SQLitHttpClient {
  private readonly endpoint: string
  private readonly dbid: string
  private readonly timeout: number

  constructor(config: SQLitConfig) {
    this.endpoint = config.endpoint
    this.dbid = config.dbid
    this.timeout = config.timeout
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: (string | number | null)[] = [],
  ): Promise<T[]> {
    const formattedSql = this.formatSQL(sql, params)
    return this.fetch<T>('query', formattedSql)
  }

  async exec(
    sql: string,
    params: (string | number | null)[] = [],
  ): Promise<{ rowsAffected: number; lastInsertId: number | bigint }> {
    const formattedSql = this.formatSQL(sql, params)
    return this.fetchExec(formattedSql)
  }

  async execRaw(sql: string): Promise<void> {
    await this.fetch('exec', sql)
  }

  private formatSQL(sql: string, params: (string | number | null)[]): string {
    if (params.length === 0) return sql

    let paramIndex = 0
    return sql.replace(/\?/g, () => {
      const param = params[paramIndex++]
      if (param === null) return 'NULL'
      if (typeof param === 'string') return `'${param.replace(/'/g, "''")}'`
      if (typeof param === 'number') return String(param)
      return 'NULL'
    })
  }

  private async fetch<T>(method: 'query' | 'exec', sql: string): Promise<T[]> {
    const uri = `${this.endpoint}/v1/${method}`

    const response = await fetch(uri, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assoc: true,
        database: this.dbid,
        query: sql,
      }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`SQLit request failed: ${response.status}`)
    }

    const result: SQLitQueryResponse = await response.json()

    if (result.error) {
      throw new Error(result.error)
    }

    return (result.data?.rows as T[]) ?? []
  }

  private async fetchExec(
    sql: string,
  ): Promise<{ rowsAffected: number; lastInsertId: number | bigint }> {
    const uri = `${this.endpoint}/v1/exec`

    const response = await fetch(uri, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assoc: true,
        database: this.dbid,
        query: sql,
      }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`SQLit request failed: ${response.status}`)
    }

    const result: SQLitQueryResponse = await response.json()

    if (result.error) {
      throw new Error(result.error)
    }

    const rowsAffected = result.rowsAffected ?? 0
    const lastInsertId =
      result.lastInsertId !== undefined
        ? typeof result.lastInsertId === 'string'
          ? BigInt(result.lastInsertId)
          : result.lastInsertId
        : 0

    return { rowsAffected, lastInsertId }
  }
}

// =============================================================================
// Database Instance
// =============================================================================

let client: SQLitHttpClient | null = null

function getClient(): SQLitHttpClient {
  if (client) return client

  const endpoint = getSQLitBlockProducerUrl()
  const dbid = process.env.SQLIT_DATABASE_ID ?? 'factory'

  client = new SQLitHttpClient({
    endpoint,
    dbid,
    timeout: 30000,
  })

  return client
}

// =============================================================================
// Schemas
// =============================================================================

const BountyRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  reward: z.string(),
  currency: z.string(),
  status: z.enum(['open', 'in_progress', 'review', 'completed', 'cancelled']),
  creator: z.string(),
  deadline: z.number(),
  skills: z.string(),
  milestones: z.string().nullable(),
  submissions: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
})

const JobRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  company_logo: z.string().nullable(),
  type: z.enum(['full-time', 'part-time', 'contract', 'bounty']),
  remote: z.number(),
  location: z.string(),
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  salary_currency: z.string().nullable(),
  salary_period: z.string().nullable(),
  skills: z.string(),
  description: z.string(),
  applications: z.number(),
  status: z.string(),
  poster: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
})

const ProjectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(['active', 'archived', 'completed', 'on_hold']),
  visibility: z.enum(['public', 'private', 'internal']),
  owner: z.string(),
  members: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
})

const AgentRowSchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  owner: z.string(),
  name: z.string(),
  bot_type: z.string(),
  character_cid: z.string().nullable(),
  state_cid: z.string(),
  vault_address: z.string(),
  active: z.number(),
  registered_at: z.number(),
  last_executed_at: z.number(),
  execution_count: z.number(),
  capabilities: z.string(),
  specializations: z.string(),
  reputation: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
})

const LeaderboardRowSchema = z.object({
  address: z.string(),
  name: z.string(),
  avatar: z.string(),
  score: z.number(),
  contributions: z.number(),
  bounties_completed: z.number(),
  tier: z.enum(['bronze', 'silver', 'gold', 'diamond']),
  updated_at: z.number(),
})

// Export row types
export type BountyRow = z.infer<typeof BountyRowSchema>
export type JobRow = z.infer<typeof JobRowSchema>
export type ProjectRow = z.infer<typeof ProjectRowSchema>
export type AgentRow = z.infer<typeof AgentRowSchema>
export type LeaderboardRow = z.infer<typeof LeaderboardRowSchema>

// =============================================================================
// Helper Functions
// =============================================================================

function toJSON(data: unknown): string {
  return JSON.stringify(data)
}

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// =============================================================================
// Bounties (Async)
// =============================================================================

export async function listBountiesAsync(filter?: {
  status?: string
  skill?: string
  creator?: string
  page?: number
  limit?: number
}): Promise<{ bounties: BountyRow[]; total: number }> {
  const db = getClient()
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (filter?.status) {
    conditions.push('status = ?')
    params.push(filter.status)
  }
  if (filter?.creator) {
    conditions.push('creator = ?')
    params.push(filter.creator)
  }
  if (filter?.skill) {
    conditions.push('skills LIKE ?')
    params.push(`%${filter.skill}%`)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const page = filter?.page ?? 1
  const limit = filter?.limit ?? 20
  const offset = (page - 1) * limit

  const countResult = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM bounties ${whereClause}`,
    params,
  )
  const total = countResult[0]?.count ?? 0

  const rows = await db.query<BountyRow>(
    `SELECT * FROM bounties ${whereClause} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  )

  return { bounties: rows.map((r) => BountyRowSchema.parse(r)), total }
}

export async function getBountyAsync(id: string): Promise<BountyRow | null> {
  const db = getClient()
  const rows = await db.query<BountyRow>(
    'SELECT * FROM bounties WHERE id = ?',
    [id],
  )
  return rows[0] ? BountyRowSchema.parse(rows[0]) : null
}

export async function createBountyAsync(bounty: {
  title: string
  description: string
  reward: string
  currency: string
  skills: string[]
  deadline: number
  milestones?: Array<{
    name: string
    description: string
    reward: string
    currency: string
    deadline: number
  }>
  creator: string
}): Promise<BountyRow> {
  const db = getClient()
  const id = generateId('bounty')
  const now = Date.now()

  await db.exec(
    `INSERT INTO bounties (id, title, description, reward, currency, skills, deadline, milestones, creator, status, submissions, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, ?, ?)`,
    [
      id,
      bounty.title,
      bounty.description,
      bounty.reward,
      bounty.currency,
      toJSON(bounty.skills),
      bounty.deadline,
      bounty.milestones ? toJSON(bounty.milestones) : null,
      bounty.creator,
      now,
      now,
    ],
  )

  const created = await getBountyAsync(id)
  if (!created) throw new Error(`Failed to create bounty ${id}`)
  return created
}

// =============================================================================
// Jobs (Async)
// =============================================================================

export async function listJobsAsync(filter?: {
  type?: string
  remote?: boolean
  status?: string
  page?: number
  limit?: number
}): Promise<{ jobs: JobRow[]; total: number }> {
  const db = getClient()
  const conditions: string[] = ["status = 'open'"]
  const params: (string | number)[] = []

  if (filter?.type) {
    conditions.push('type = ?')
    params.push(filter.type)
  }
  if (filter?.remote !== undefined) {
    conditions.push('remote = ?')
    params.push(filter.remote ? 1 : 0)
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`
  const page = filter?.page ?? 1
  const limit = filter?.limit ?? 20
  const offset = (page - 1) * limit

  const countResult = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM jobs ${whereClause}`,
    params,
  )
  const total = countResult[0]?.count ?? 0

  const rows = await db.query<JobRow>(
    `SELECT * FROM jobs ${whereClause} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  )

  return { jobs: rows.map((r) => JobRowSchema.parse(r)), total }
}

export async function getJobAsync(id: string): Promise<JobRow | null> {
  const db = getClient()
  const rows = await db.query<JobRow>('SELECT * FROM jobs WHERE id = ?', [id])
  return rows[0] ? JobRowSchema.parse(rows[0]) : null
}

// =============================================================================
// Projects (Async)
// =============================================================================

export async function listProjectsAsync(filter?: {
  status?: string
  owner?: string
  page?: number
  limit?: number
}): Promise<{ projects: ProjectRow[]; total: number }> {
  const db = getClient()
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (filter?.status) {
    conditions.push('status = ?')
    params.push(filter.status)
  }
  if (filter?.owner) {
    conditions.push('owner = ?')
    params.push(filter.owner)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const page = filter?.page ?? 1
  const limit = filter?.limit ?? 20
  const offset = (page - 1) * limit

  const countResult = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM projects ${whereClause}`,
    params,
  )
  const total = countResult[0]?.count ?? 0

  const rows = await db.query<ProjectRow>(
    `SELECT * FROM projects ${whereClause} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  )

  return { projects: rows.map((r) => ProjectRowSchema.parse(r)), total }
}

export async function getProjectAsync(id: string): Promise<ProjectRow | null> {
  const db = getClient()
  const rows = await db.query<ProjectRow>(
    'SELECT * FROM projects WHERE id = ?',
    [id],
  )
  return rows[0] ? ProjectRowSchema.parse(rows[0]) : null
}

// =============================================================================
// Agents (Async)
// =============================================================================

export async function listAgentsAsync(filter?: {
  capability?: string
  active?: boolean
  owner?: string
}): Promise<AgentRow[]> {
  const db = getClient()
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (filter?.capability) {
    conditions.push('capabilities LIKE ?')
    params.push(`%${filter.capability}%`)
  }
  if (filter?.active !== undefined) {
    conditions.push('active = ?')
    params.push(filter.active ? 1 : 0)
  }
  if (filter?.owner) {
    conditions.push('owner = ?')
    params.push(filter.owner)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = await db.query<AgentRow>(
    `SELECT * FROM agents ${whereClause} ORDER BY reputation DESC, created_at DESC`,
    params,
  )

  return rows.map((r) => AgentRowSchema.parse(r))
}

export async function getAgentAsync(agentId: string): Promise<AgentRow | null> {
  const db = getClient()
  const rows = await db.query<AgentRow>(
    'SELECT * FROM agents WHERE agent_id = ?',
    [agentId],
  )
  return rows[0] ? AgentRowSchema.parse(rows[0]) : null
}

// =============================================================================
// Leaderboard (Async)
// =============================================================================

export async function getLeaderboardAsync(
  limit: number = 50,
): Promise<LeaderboardRow[]> {
  const db = getClient()
  const rows = await db.query<LeaderboardRow>(
    `SELECT * FROM leaderboard ORDER BY score DESC LIMIT ${limit}`,
  )
  return rows.map((r) => LeaderboardRowSchema.parse(r))
}

// =============================================================================
// Database Health
// =============================================================================

export async function checkDatabaseHealth(): Promise<{
  healthy: boolean
  latency: number
}> {
  const start = Date.now()
  try {
    const db = getClient()
    await db.query('SELECT 1')
    return { healthy: true, latency: Date.now() - start }
  } catch {
    return { healthy: false, latency: Date.now() - start }
  }
}
