/**
 * Factory SQLit Client
 *
 * Provides database operations using the decentralized SQLit network.
 * This replaces the local bun:sqlite implementation for production use.
 *
 * Features:
 * - Automatic connection pooling
 * - Network-aware configuration
 * - Fail-fast on connection errors
 * - Schema migration on initialization
 */

import { getSQLit, type SQLitClient } from '@jejunetwork/db'
import { isProductionEnv } from '@jejunetwork/config'
import { z } from 'zod'
import { getFactoryConfig } from '../config'
import FACTORY_SCHEMA from './schema'

// Re-export row schemas and types from the original client for compatibility
export {
  type BountyRow,
  type JobRow,
  type ProjectRow,
  type TaskRow,
  type IssueRow,
  type PullRequestRow,
  type DiscussionRow,
  type CIRunRow,
  type AgentRow,
  type ContainerRow,
  type ContainerInstanceRow,
  type DatasetRow,
  type ModelRow,
  type LeaderboardRow,
  type IssueCommentRow,
  type PRReviewRow,
  type DiscussionReplyRow,
  type RepoSettingsRow,
  type CollaboratorRow,
  type WebhookRow,
  type PackageSettingsRow,
  type MaintainerRow,
  type PackageTokenRow,
  type FidLinkRow,
  type FarcasterSignerRow,
  type ProjectChannelRow,
  type CastReactionRow,
} from './client'

let sqlitClient: SQLitClient | null = null
let initialized = false

const config = getFactoryConfig()
const DATABASE_ID = config.sqlitDatabaseId

/**
 * Get or create the SQLit client
 */
function getClient(): SQLitClient {
  if (!sqlitClient) {
    const factoryConfig = getFactoryConfig()

    sqlitClient = getSQLit({
      blockProducerEndpoint: factoryConfig.sqlitEndpoint,
      databaseId: factoryConfig.sqlitDatabaseId,
      privateKey: factoryConfig.sqlitPrivateKey,
      timeout: 30000,
      debug: !isProductionEnv(),
    })
  }
  return sqlitClient
}

/**
 * Initialize the SQLit database with schema
 */
export async function initSQLitDB(): Promise<SQLitClient> {
  const client = getClient()

  if (initialized) return client

  // Check health first
  const healthy = await client.isHealthy()
  if (!healthy) {
    throw new Error(
      `Factory requires SQLit for decentralized state.\n` +
        `Endpoint: ${config.sqlitEndpoint}\n` +
        'Ensure SQLit is running: jeju start sqlit',
    )
  }

  // Split schema into individual statements and execute
  const statements = FACTORY_SCHEMA.split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  for (const statement of statements) {
    await client.exec(`${statement};`, [], DATABASE_ID)
  }

  initialized = true
  console.log('[Factory SQLit] Initialized with decentralized database')

  return client
}

/**
 * Close the SQLit client
 */
export async function closeSQLitDB(): Promise<void> {
  if (sqlitClient) {
    await sqlitClient.close()
    sqlitClient = null
    initialized = false
  }
}

/**
 * Check if SQLit is healthy
 */
export async function isSQLitHealthy(): Promise<boolean> {
  const client = getClient()
  return client.isHealthy()
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Execute a query and return rows
 */
async function query<T>(
  sql: string,
  params: Array<string | number | null> = [],
): Promise<T[]> {
  const client = getClient()
  const result = await client.query<T>(sql, params, DATABASE_ID)
  return result.rows
}

/**
 * Execute a query and return a single row or null
 */
async function queryOne<T>(
  sql: string,
  params: Array<string | number | null> = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] ?? null
}

/**
 * Execute a write operation (INSERT, UPDATE, DELETE)
 */
async function exec(
  sql: string,
  params: Array<string | number | null> = [],
): Promise<{ rowsAffected: number }> {
  const client = getClient()
  const result = await client.exec(sql, params, DATABASE_ID)
  return { rowsAffected: result.rowsAffected }
}

/**
 * Generate a unique ID with prefix
 */
export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Convert value to JSON string
 */
function toJSON(data: unknown): string {
  return JSON.stringify(data)
}

// ============================================================================
// BOUNTIES
// ============================================================================

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
type BountyRow = z.infer<typeof BountyRowSchema>

export async function listBounties(filter?: {
  status?: string
  skill?: string
  creator?: string
  search?: string
  page?: number
  limit?: number
}): Promise<{ bounties: BountyRow[]; total: number }> {
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

  const countResult = await queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM bounties ${whereClause}`,
    params,
  )
  const total = countResult?.count ?? 0

  const bounties = await query<BountyRow>(
    `SELECT * FROM bounties ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )

  return { bounties: bounties.map((b) => BountyRowSchema.parse(b)), total }
}

export async function getBounty(id: string): Promise<BountyRow | null> {
  const row = await queryOne<BountyRow>(
    'SELECT * FROM bounties WHERE id = ?',
    [id],
  )
  return row ? BountyRowSchema.parse(row) : null
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
  const id = generateId('bounty')
  const now = Date.now()

  await exec(
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
  const result = await exec(
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
  const stats = await queryOne<{
    total: number
    open: number
    completed: number
    total_reward_value: number | null
  }>(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CAST(reward AS REAL)) as total_reward_value
    FROM bounties
  `)

  const totalValue = stats?.total_reward_value ?? 0
  const completedBounties = stats?.completed ?? 0
  const avgPayout = completedBounties > 0 ? totalValue / completedBounties : 0

  return {
    openBounties: stats?.open ?? 0,
    totalValue: totalValue,
    completed: completedBounties,
    avgPayout: avgPayout,
  }
}

// ============================================================================
// JOBS
// ============================================================================

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
type JobRow = z.infer<typeof JobRowSchema>

export async function listJobs(filter?: {
  type?: string
  remote?: boolean
  status?: string
  search?: string
  page?: number
  limit?: number
}): Promise<{ jobs: JobRow[]; total: number }> {
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

  const countResult = await queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM jobs ${whereClause}`,
    params,
  )
  const total = countResult?.count ?? 0

  const jobs = await query<JobRow>(
    `SELECT * FROM jobs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )

  return { jobs: jobs.map((j) => JobRowSchema.parse(j)), total }
}

export async function getJob(id: string): Promise<JobRow | null> {
  const row = await queryOne<JobRow>('SELECT * FROM jobs WHERE id = ?', [id])
  return row ? JobRowSchema.parse(row) : null
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
  const id = generateId('job')
  const now = Date.now()

  await exec(
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
  const stats = await queryOne<{
    total: number
    open: number
    remote: number
    avg_salary: number | null
  }>(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
      SUM(CASE WHEN remote = 1 THEN 1 ELSE 0 END) as remote,
      AVG(CASE WHEN salary_min IS NOT NULL AND salary_max IS NOT NULL THEN (salary_min + salary_max) / 2 ELSE NULL END) as avg_salary
    FROM jobs
  `)

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
type ProjectRow = z.infer<typeof ProjectRowSchema>

export async function listProjects(filter?: {
  status?: string
  owner?: string
  search?: string
  page?: number
  limit?: number
}): Promise<{ projects: ProjectRow[]; total: number }> {
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

  const countResult = await queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM projects ${whereClause}`,
    params,
  )
  const total = countResult?.count ?? 0

  const projects = await query<ProjectRow>(
    `SELECT * FROM projects ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )

  return { projects: projects.map((p) => ProjectRowSchema.parse(p)), total }
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  const row = await queryOne<ProjectRow>(
    'SELECT * FROM projects WHERE id = ?',
    [id],
  )
  return row ? ProjectRowSchema.parse(row) : null
}

export async function createProject(project: {
  name: string
  description: string
  visibility: 'public' | 'private' | 'internal'
  owner: string
}): Promise<ProjectRow> {
  const id = generateId('project')
  const now = Date.now()

  await exec(
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
// CI RUNS
// ============================================================================

const CIRunRowSchema = z.object({
  id: z.string(),
  workflow: z.string(),
  repo: z.string(),
  branch: z.string(),
  commit_sha: z.string(),
  commit_message: z.string(),
  author: z.string(),
  status: z.enum(['queued', 'running', 'success', 'failure', 'cancelled']),
  conclusion: z.string().nullable(),
  duration: z.number().nullable(),
  started_at: z.number(),
  completed_at: z.number().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
})
type CIRunRow = z.infer<typeof CIRunRowSchema>

export async function listCIRuns(filter?: {
  repo?: string
  status?: string
  branch?: string
  search?: string
  page?: number
  limit?: number
}): Promise<{ runs: CIRunRow[]; total: number }> {
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (filter?.repo) {
    conditions.push('repo = ?')
    params.push(filter.repo)
  }
  if (filter?.status) {
    conditions.push('status = ?')
    params.push(filter.status)
  }
  if (filter?.branch) {
    conditions.push('branch = ?')
    params.push(filter.branch)
  }
  if (filter?.search) {
    conditions.push('(workflow LIKE ? OR commit_message LIKE ?)')
    params.push(`%${filter.search}%`, `%${filter.search}%`)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const page = filter?.page ?? 1
  const limit = filter?.limit ?? 20
  const offset = (page - 1) * limit

  const countResult = await queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM ci_runs ${whereClause}`,
    params,
  )
  const total = countResult?.count ?? 0

  const runs = await query<CIRunRow>(
    `SELECT * FROM ci_runs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )

  return { runs: runs.map((r) => CIRunRowSchema.parse(r)), total }
}

export async function getCIRun(id: string): Promise<CIRunRow | null> {
  const row = await queryOne<CIRunRow>(
    'SELECT * FROM ci_runs WHERE id = ?',
    [id],
  )
  return row ? CIRunRowSchema.parse(row) : null
}

// ============================================================================
// AGENTS
// ============================================================================

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
type AgentRow = z.infer<typeof AgentRowSchema>

export async function listAgents(filter?: {
  capability?: string
  active?: boolean
  owner?: string
  search?: string
}): Promise<AgentRow[]> {
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
  if (filter?.search) {
    conditions.push('(name LIKE ? OR agent_id LIKE ?)')
    params.push(`%${filter.search}%`, `%${filter.search}%`)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const agents = await query<AgentRow>(
    `SELECT * FROM agents ${whereClause} ORDER BY reputation DESC, created_at DESC`,
    params,
  )

  return agents.map((a) => AgentRowSchema.parse(a))
}

export async function getAgent(agentId: string): Promise<AgentRow | null> {
  const row = await queryOne<AgentRow>(
    'SELECT * FROM agents WHERE agent_id = ?',
    [agentId],
  )
  return row ? AgentRowSchema.parse(row) : null
}

// ============================================================================
// CONTAINERS
// ============================================================================

const ContainerRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  tag: z.string(),
  digest: z.string(),
  size: z.number(),
  platform: z.string(),
  labels: z.string().nullable(),
  downloads: z.number(),
  owner: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
})
type ContainerRow = z.infer<typeof ContainerRowSchema>

export async function listContainers(filter?: {
  org?: string
  name?: string
  search?: string
}): Promise<ContainerRow[]> {
  const conditions: string[] = []
  const params: string[] = []

  if (filter?.org) {
    conditions.push('owner = ?')
    params.push(filter.org)
  }
  if (filter?.name) {
    conditions.push('name LIKE ?')
    params.push(`%${filter.name}%`)
  }
  if (filter?.search) {
    conditions.push('(name LIKE ? OR tag LIKE ?)')
    params.push(`%${filter.search}%`, `%${filter.search}%`)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const containers = await query<ContainerRow>(
    `SELECT * FROM containers ${whereClause} ORDER BY created_at DESC`,
    params,
  )

  return containers.map((c) => ContainerRowSchema.parse(c))
}

// ============================================================================
// MODELS
// ============================================================================

const ModelRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  organization: z.string(),
  type: z.enum(['llm', 'embedding', 'image', 'audio', 'multimodal', 'code']),
  description: z.string(),
  version: z.string(),
  file_uri: z.string(),
  downloads: z.number(),
  stars: z.number(),
  size: z.string().nullable(),
  license: z.string().nullable(),
  status: z.enum(['processing', 'ready', 'failed']),
  owner: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
})
type ModelRow = z.infer<typeof ModelRowSchema>

export async function listModels(filter?: {
  type?: string
  org?: string
  search?: string
}): Promise<ModelRow[]> {
  const conditions: string[] = []
  const params: string[] = []

  if (filter?.type) {
    conditions.push('type = ?')
    params.push(filter.type)
  }
  if (filter?.org) {
    conditions.push('organization = ?')
    params.push(filter.org)
  }
  if (filter?.search) {
    conditions.push('(name LIKE ? OR description LIKE ?)')
    params.push(`%${filter.search}%`, `%${filter.search}%`)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const models = await query<ModelRow>(
    `SELECT * FROM models ${whereClause} ORDER BY downloads DESC, created_at DESC`,
    params,
  )

  return models.map((m) => ModelRowSchema.parse(m))
}

export async function getModel(
  org: string,
  name: string,
): Promise<ModelRow | null> {
  const row = await queryOne<ModelRow>('SELECT * FROM models WHERE id = ?', [
    `${org}/${name}`,
  ])
  return row ? ModelRowSchema.parse(row) : null
}

// ============================================================================
// LEADERBOARD
// ============================================================================

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
type LeaderboardRow = z.infer<typeof LeaderboardRowSchema>

export async function getLeaderboard(limit: number = 50): Promise<LeaderboardRow[]> {
  const rows = await query<LeaderboardRow>(
    'SELECT * FROM leaderboard ORDER BY score DESC LIMIT ?',
    [limit],
  )
  return rows.map((r) => LeaderboardRowSchema.parse(r))
}

// ============================================================================
// ASYNC ALIASES FOR WORKERD WORKER
// ============================================================================

/**
 * Check database health for workerd
 */
export async function checkDatabaseHealth(): Promise<{
  healthy: boolean
  latencyMs?: number
  error?: string
}> {
  const start = Date.now()
  const healthy = await isSQLitHealthy()
  return {
    healthy,
    latencyMs: Date.now() - start,
    error: healthy ? undefined : 'SQLit connection failed',
  }
}

// Async aliases for functions that are already async
export const listBountiesAsync = listBounties
export const getBountyAsync = getBounty
export const createBountyAsync = createBounty
export const listJobsAsync = listJobs
export const getJobAsync = getJob
export const listProjectsAsync = listProjects
export const getProjectAsync = getProject
export const listAgentsAsync = listAgents
export const getAgentAsync = getAgent
export const getLeaderboardAsync = getLeaderboard
