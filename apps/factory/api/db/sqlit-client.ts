/**
 * Factory SQLit Database Client
 *
 * Uses distributed SQLit for DWS/workerd deployment.
 * All operations are async to work with the HTTP-based SQLit.
 */

import { getSQLitUrl } from '@jejunetwork/config'
import {
  createDatabaseService,
  type DatabaseService,
} from '@jejunetwork/shared'
import { z } from 'zod'
import { getFactoryConfig } from '../config'
import FACTORY_SCHEMA from './schema'

// Row Schemas (same as original)
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

// Export types
export type BountyRow = z.infer<typeof BountyRowSchema>
export type JobRow = z.infer<typeof JobRowSchema>
export type ProjectRow = z.infer<typeof ProjectRowSchema>
export type LeaderboardRow = z.infer<typeof LeaderboardRowSchema>

// Database service singleton
let db: DatabaseService | null = null
let initialized = false

/** Get the SQLit database service */
export function getDB(): DatabaseService {
  if (!db) {
    const config = getFactoryConfig()
    db = createDatabaseService({
      databaseId: config.sqlitDatabaseId,
      endpoint: config.sqlitEndpoint || getSQLitUrl(),
      timeout: 30000,
      debug: config.isDev,
    })
  }
  return db
}

/** Initialize database with schema */
export async function initDB(): Promise<DatabaseService> {
  const database = getDB()

  if (!initialized) {
    const healthy = await database.isHealthy()
    if (!healthy) {
      const config = getFactoryConfig()
      throw new Error(
        `SQLit database not available at ${config.sqlitEndpoint}. ` +
          'Ensure SQLit server is running.',
      )
    }

    // Execute schema - split by CREATE statements and run each
    const statements = FACTORY_SCHEMA.split(/;[\s]*(?=CREATE|--)/i)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('--'))

    for (const stmt of statements) {
      if (stmt.length > 5) {
        // Skip empty or trivial statements
        await database.exec(`${stmt};`)
      }
    }

    initialized = true
    console.log('[Factory SQLit] Database initialized')
  }

  return database
}

/** Close database connection */
export async function closeDB(): Promise<void> {
  if (db) {
    await db.close()
    db = null
    initialized = false
  }
}

// Utility functions
function toJSON(data: unknown): string {
  return JSON.stringify(data)
}

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// BOUNTIES
// ============================================================================

export async function listBounties(filter?: {
  status?: string
  skill?: string
  creator?: string
  search?: string
  page?: number
  limit?: number
}): Promise<{ bounties: BountyRow[]; total: number }> {
  const database = getDB()
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
  if (filter?.search) {
    conditions.push('(title LIKE ? OR description LIKE ?)')
    params.push(`%${filter.search}%`, `%${filter.search}%`)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const page = filter?.page ?? 1
  const limit = filter?.limit ?? 20
  const offset = (page - 1) * limit

  // Get count
  const countResult = await database.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM bounties ${whereClause}`,
    params,
  )
  const total = countResult.rows[0]?.count ?? 0

  // Get bounties
  const result = await database.query<BountyRow>(
    `SELECT * FROM bounties ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )

  return { bounties: result.rows.map((r) => BountyRowSchema.parse(r)), total }
}

export async function getBounty(id: string): Promise<BountyRow | null> {
  const database = getDB()
  const result = await database.query<BountyRow>(
    'SELECT * FROM bounties WHERE id = ?',
    [id],
  )
  return result.rows[0] ? BountyRowSchema.parse(result.rows[0]) : null
}

export async function createBounty(bounty: {
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
  const database = getDB()
  const id = generateId('bounty')
  const now = Date.now()

  await database.exec(
    `INSERT INTO bounties (id, title, description, reward, currency, skills, deadline, milestones, creator, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  const created = await getBounty(id)
  if (!created) throw new Error(`Failed to create bounty ${id}`)
  return created
}

export async function updateBountyStatus(
  id: string,
  status: string,
): Promise<boolean> {
  const database = getDB()
  const result = await database.exec(
    'UPDATE bounties SET status = ?, updated_at = ? WHERE id = ?',
    [status, Date.now(), id],
  )
  return result.rowsAffected > 0
}

export async function getBountyStats(): Promise<{
  openBounties: number
  totalValue: number
  completed: number
  avgPayout: number
}> {
  const database = getDB()
  const result = await database.query<{
    total: number
    open: number
    completed: number
    total_reward_value: number | null
  }>(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CAST(reward AS REAL)) as total_reward_value
    FROM bounties`,
  )

  const stats = result.rows[0]
  const totalValue = stats?.total_reward_value ?? 0
  const completedBounties = stats?.completed ?? 0
  const avgPayout = completedBounties > 0 ? totalValue / completedBounties : 0

  return {
    openBounties: stats?.open ?? 0,
    totalValue,
    completed: completedBounties,
    avgPayout,
  }
}

// ============================================================================
// JOBS
// ============================================================================

export async function listJobs(filter?: {
  type?: string
  remote?: boolean
  status?: string
  search?: string
  page?: number
  limit?: number
}): Promise<{ jobs: JobRow[]; total: number }> {
  const database = getDB()
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
  if (filter?.search) {
    conditions.push('(title LIKE ? OR description LIKE ? OR company LIKE ?)')
    params.push(
      `%${filter.search}%`,
      `%${filter.search}%`,
      `%${filter.search}%`,
    )
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`
  const page = filter?.page ?? 1
  const limit = filter?.limit ?? 20
  const offset = (page - 1) * limit

  const countResult = await database.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM jobs ${whereClause}`,
    params,
  )
  const total = countResult.rows[0]?.count ?? 0

  const result = await database.query<JobRow>(
    `SELECT * FROM jobs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )

  return { jobs: result.rows.map((r) => JobRowSchema.parse(r)), total }
}

export async function getJob(id: string): Promise<JobRow | null> {
  const database = getDB()
  const result = await database.query<JobRow>(
    'SELECT * FROM jobs WHERE id = ?',
    [id],
  )
  return result.rows[0] ? JobRowSchema.parse(result.rows[0]) : null
}

export async function createJob(job: {
  title: string
  company: string
  companyLogo?: string
  type: 'full-time' | 'part-time' | 'contract' | 'bounty'
  remote: boolean
  location: string
  salary?: { min: number; max: number; currency: string; period?: string }
  skills: string[]
  description: string
  poster: string
}): Promise<JobRow> {
  const database = getDB()
  const id = generateId('job')
  const now = Date.now()

  await database.exec(
    `INSERT INTO jobs (id, title, company, company_logo, type, remote, location, salary_min, salary_max, salary_currency, salary_period, skills, description, poster, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      job.title,
      job.company,
      job.companyLogo ?? null,
      job.type,
      job.remote ? 1 : 0,
      job.location,
      job.salary?.min ?? null,
      job.salary?.max ?? null,
      job.salary?.currency ?? null,
      job.salary?.period ?? null,
      toJSON(job.skills),
      job.description,
      job.poster,
      now,
      now,
    ],
  )

  const created = await getJob(id)
  if (!created) throw new Error(`Failed to create job ${id}`)
  return created
}

export async function getJobStats(): Promise<{
  totalJobs: number
  openJobs: number
  remoteJobs: number
  averageSalary: number
}> {
  const database = getDB()
  const result = await database.query<{
    total: number
    open: number
    remote: number
    avg_salary: number | null
  }>(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
      SUM(CASE WHEN remote = 1 THEN 1 ELSE 0 END) as remote,
      AVG(CASE WHEN salary_min IS NOT NULL AND salary_max IS NOT NULL THEN (salary_min + salary_max) / 2 ELSE NULL END) as avg_salary
    FROM jobs`,
  )

  const stats = result.rows[0]
  return {
    totalJobs: stats?.total ?? 0,
    openJobs: stats?.open ?? 0,
    remoteJobs: stats?.remote ?? 0,
    averageSalary: Math.round(stats?.avg_salary ?? 0),
  }
}

// ============================================================================
// PROJECTS
// ============================================================================

export async function listProjects(filter?: {
  status?: string
  owner?: string
  search?: string
  page?: number
  limit?: number
}): Promise<{ projects: ProjectRow[]; total: number }> {
  const database = getDB()
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
  if (filter?.search) {
    conditions.push('(name LIKE ? OR description LIKE ?)')
    params.push(`%${filter.search}%`, `%${filter.search}%`)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const page = filter?.page ?? 1
  const limit = filter?.limit ?? 20
  const offset = (page - 1) * limit

  const countResult = await database.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM projects ${whereClause}`,
    params,
  )
  const total = countResult.rows[0]?.count ?? 0

  const result = await database.query<ProjectRow>(
    `SELECT * FROM projects ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )

  return { projects: result.rows.map((r) => ProjectRowSchema.parse(r)), total }
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  const database = getDB()
  const result = await database.query<ProjectRow>(
    'SELECT * FROM projects WHERE id = ?',
    [id],
  )
  return result.rows[0] ? ProjectRowSchema.parse(result.rows[0]) : null
}

export async function createProject(project: {
  name: string
  description: string
  visibility: 'public' | 'private' | 'internal'
  owner: string
}): Promise<ProjectRow> {
  const database = getDB()
  const id = generateId('project')
  const now = Date.now()

  await database.exec(
    `INSERT INTO projects (id, name, description, visibility, owner, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      project.name,
      project.description,
      project.visibility,
      project.owner,
      now,
      now,
    ],
  )

  const created = await getProject(id)
  if (!created) throw new Error(`Failed to create project ${id}`)
  return created
}

// ============================================================================
// LEADERBOARD
// ============================================================================

export async function getLeaderboard(
  limit: number = 50,
): Promise<LeaderboardRow[]> {
  const database = getDB()
  const result = await database.query<LeaderboardRow>(
    'SELECT * FROM leaderboard ORDER BY score DESC LIMIT ?',
    [limit],
  )
  return result.rows.map((r) => LeaderboardRowSchema.parse(r))
}

export async function getLeaderboardEntry(
  address: string,
): Promise<LeaderboardRow | null> {
  const database = getDB()
  const result = await database.query<LeaderboardRow>(
    'SELECT * FROM leaderboard WHERE address = ?',
    [address],
  )
  return result.rows[0] ? LeaderboardRowSchema.parse(result.rows[0]) : null
}

export async function updateLeaderboardScore(
  address: string,
  updates: {
    name?: string
    avatar?: string
    scoreIncrement?: number
    contributionsIncrement?: number
    bountiesIncrement?: number
  },
): Promise<LeaderboardRow> {
  const database = getDB()
  const now = Date.now()
  const existing = await getLeaderboardEntry(address)

  if (!existing) {
    const name = updates.name ?? `${address.slice(0, 6)}...${address.slice(-4)}`
    const avatar =
      updates.avatar ??
      `https://api.dicebear.com/7.x/identicon/svg?seed=${address}`
    const score = updates.scoreIncrement ?? 0
    const contributions = updates.contributionsIncrement ?? 0
    const bounties = updates.bountiesIncrement ?? 0

    await database.exec(
      `INSERT INTO leaderboard (address, name, avatar, score, contributions, bounties_completed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [address, name, avatar, score, contributions, bounties, now],
    )
  } else {
    const sets: string[] = ['updated_at = ?']
    const params: (string | number)[] = [now]

    if (updates.name) {
      sets.push('name = ?')
      params.push(updates.name)
    }
    if (updates.avatar) {
      sets.push('avatar = ?')
      params.push(updates.avatar)
    }
    if (updates.scoreIncrement) {
      sets.push('score = score + ?')
      params.push(updates.scoreIncrement)
    }
    if (updates.contributionsIncrement) {
      sets.push('contributions = contributions + ?')
      params.push(updates.contributionsIncrement)
    }
    if (updates.bountiesIncrement) {
      sets.push('bounties_completed = bounties_completed + ?')
      params.push(updates.bountiesIncrement)
    }

    params.push(address)
    await database.exec(
      `UPDATE leaderboard SET ${sets.join(', ')} WHERE address = ?`,
      params,
    )

    // Update tier based on score
    const updated = await getLeaderboardEntry(address)
    if (updated) {
      let tier: string = 'bronze'
      if (updated.score >= 10000) tier = 'diamond'
      else if (updated.score >= 5000) tier = 'gold'
      else if (updated.score >= 1000) tier = 'silver'

      if (tier !== updated.tier) {
        await database.exec(
          'UPDATE leaderboard SET tier = ? WHERE address = ?',
          [tier, address],
        )
      }
    }
  }

  const entry = await getLeaderboardEntry(address)
  if (!entry) throw new Error(`Failed to get leaderboard entry ${address}`)
  return entry
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

export async function isHealthy(): Promise<boolean> {
  const database = getDB()
  return database.isHealthy()
}
