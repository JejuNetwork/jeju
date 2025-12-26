/**
 * Factory Database Client
 *
 * Local SQLite database for development, CQL for production.
 * Provides type-safe query methods for all Factory entities.
 */

import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import FACTORY_SCHEMA from './schema'

// Schemas for row validation
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

const TaskRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
  assignee: z.string().nullable(),
  due_date: z.number().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
})

const IssueRowSchema = z.object({
  id: z.string(),
  number: z.number(),
  repo: z.string(),
  title: z.string(),
  body: z.string(),
  status: z.enum(['open', 'closed']),
  author: z.string(),
  labels: z.string(),
  assignees: z.string(),
  comments_count: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
})

const PullRequestRowSchema = z.object({
  id: z.string(),
  number: z.number(),
  repo: z.string(),
  title: z.string(),
  body: z.string(),
  status: z.enum(['open', 'closed', 'merged']),
  is_draft: z.number(),
  author: z.string(),
  source_branch: z.string(),
  target_branch: z.string(),
  labels: z.string(),
  reviewers: z.string(),
  commits: z.number(),
  additions: z.number(),
  deletions: z.number(),
  changed_files: z.number(),
  checks_passed: z.number(),
  checks_failed: z.number(),
  checks_pending: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
})

const DiscussionRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  author: z.string(),
  author_name: z.string(),
  author_avatar: z.string(),
  category: z.enum(['general', 'questions', 'announcements', 'show', 'ideas']),
  tags: z.string(),
  replies_count: z.number(),
  views: z.number(),
  likes: z.number(),
  is_pinned: z.number(),
  is_locked: z.number(),
  created_at: z.number(),
  last_reply_at: z.number(),
})

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

const ContainerInstanceRowSchema = z.object({
  id: z.string(),
  container_id: z.string(),
  name: z.string(),
  status: z.enum(['running', 'stopped', 'building', 'failed']),
  cpu: z.string(),
  memory: z.string(),
  gpu: z.string().nullable(),
  port: z.number().nullable(),
  endpoint: z.string().nullable(),
  owner: z.string(),
  started_at: z.number().nullable(),
  created_at: z.number(),
})

const DatasetRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  organization: z.string(),
  description: z.string(),
  type: z.enum(['text', 'code', 'image', 'audio', 'multimodal', 'tabular']),
  format: z.string(),
  size: z.string(),
  rows: z.number(),
  downloads: z.number(),
  stars: z.number(),
  license: z.string(),
  tags: z.string(),
  is_verified: z.number(),
  status: z.enum(['processing', 'ready', 'failed']),
  owner: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
})

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
export type TaskRow = z.infer<typeof TaskRowSchema>
export type IssueRow = z.infer<typeof IssueRowSchema>
export type PullRequestRow = z.infer<typeof PullRequestRowSchema>
export type DiscussionRow = z.infer<typeof DiscussionRowSchema>
export type CIRunRow = z.infer<typeof CIRunRowSchema>
export type AgentRow = z.infer<typeof AgentRowSchema>
export type ContainerRow = z.infer<typeof ContainerRowSchema>
export type ContainerInstanceRow = z.infer<typeof ContainerInstanceRowSchema>
export type DatasetRow = z.infer<typeof DatasetRowSchema>
export type ModelRow = z.infer<typeof ModelRowSchema>
export type LeaderboardRow = z.infer<typeof LeaderboardRowSchema>

// Database singleton
let db: Database | null = null
const DATA_DIR = process.env.FACTORY_DATA_DIR || join(process.cwd(), 'data')
const DB_PATH = join(DATA_DIR, 'factory.sqlite')

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
}

export function getDB(): Database {
  if (db) return db

  ensureDataDir()
  db = new Database(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')

  // Run schema
  db.exec(FACTORY_SCHEMA)

  return db
}

export function closeDB() {
  if (db) {
    db.close()
    db = null
  }
}

// Generic query helpers
function parseRows<T>(rows: unknown[], schema: z.ZodType<T>): T[] {
  return rows.map((row) => schema.parse(row))
}

function toJSON(data: unknown): string {
  return JSON.stringify(data)
}

// ID generation
export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Bounties
export function listBounties(filter?: {
  status?: string
  skill?: string
  creator?: string
  page?: number
  limit?: number
}): { bounties: BountyRow[]; total: number } {
  const db = getDB()
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

  const countResult = db
    .query<{ count: number }, (string | number)[]>(
      `SELECT COUNT(*) as count FROM bounties ${whereClause}`,
    )
    .get(...params)
  const total = countResult?.count ?? 0

  const rows = db
    .query<BountyRow, (string | number)[]>(
      `SELECT * FROM bounties ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)

  return { bounties: parseRows(rows, BountyRowSchema), total }
}

export function getBounty(id: string): BountyRow | null {
  const db = getDB()
  const row = db
    .query<BountyRow, [string]>('SELECT * FROM bounties WHERE id = ?')
    .get(id)
  return row ? BountyRowSchema.parse(row) : null
}

export function createBounty(bounty: {
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
}): BountyRow {
  const db = getDB()
  const id = generateId('bounty')
  const now = Date.now()

  db.run(
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

  const created = getBounty(id)
  if (!created) throw new Error(`Failed to create bounty ${id}`)
  return created
}

export function updateBountyStatus(id: string, status: string): boolean {
  const db = getDB()
  const result = db.run(
    'UPDATE bounties SET status = ?, updated_at = ? WHERE id = ?',
    [status, Date.now(), id],
  )
  return result.changes > 0
}

// Jobs
export function listJobs(filter?: {
  type?: string
  remote?: boolean
  status?: string
  page?: number
  limit?: number
}): { jobs: JobRow[]; total: number } {
  const db = getDB()
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

  const countResult = db
    .query<{ count: number }, (string | number)[]>(
      `SELECT COUNT(*) as count FROM jobs ${whereClause}`,
    )
    .get(...params)
  const total = countResult?.count ?? 0

  const rows = db
    .query<JobRow, (string | number)[]>(
      `SELECT * FROM jobs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)

  return { jobs: parseRows(rows, JobRowSchema), total }
}

export function getJob(id: string): JobRow | null {
  const db = getDB()
  const row = db
    .query<JobRow, [string]>('SELECT * FROM jobs WHERE id = ?')
    .get(id)
  return row ? JobRowSchema.parse(row) : null
}

export function createJob(job: {
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
}): JobRow {
  const db = getDB()
  const id = generateId('job')
  const now = Date.now()

  db.run(
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

  const created = getJob(id)
  if (!created) throw new Error(`Failed to create job ${id}`)
  return created
}

export function getJobStats(): {
  totalJobs: number
  openJobs: number
  remoteJobs: number
  averageSalary: number
} {
  const db = getDB()
  const stats = db
    .query<
      {
        total: number
        open: number
        remote: number
        avg_salary: number | null
      },
      []
    >(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
      SUM(CASE WHEN remote = 1 THEN 1 ELSE 0 END) as remote,
      AVG(CASE WHEN salary_min IS NOT NULL AND salary_max IS NOT NULL THEN (salary_min + salary_max) / 2 ELSE NULL END) as avg_salary
    FROM jobs
  `)
    .get()

  return {
    totalJobs: stats?.total ?? 0,
    openJobs: stats?.open ?? 0,
    remoteJobs: stats?.remote ?? 0,
    averageSalary: Math.round(stats?.avg_salary ?? 0),
  }
}

// Projects
export function listProjects(filter?: {
  status?: string
  owner?: string
  page?: number
  limit?: number
}): { projects: ProjectRow[]; total: number } {
  const db = getDB()
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

  const countResult = db
    .query<{ count: number }, (string | number)[]>(
      `SELECT COUNT(*) as count FROM projects ${whereClause}`,
    )
    .get(...params)
  const total = countResult?.count ?? 0

  const rows = db
    .query<ProjectRow, (string | number)[]>(
      `SELECT * FROM projects ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)

  return { projects: parseRows(rows, ProjectRowSchema), total }
}

export function getProject(id: string): ProjectRow | null {
  const db = getDB()
  const row = db
    .query<ProjectRow, [string]>('SELECT * FROM projects WHERE id = ?')
    .get(id)
  return row ? ProjectRowSchema.parse(row) : null
}

export function createProject(project: {
  name: string
  description: string
  visibility: 'public' | 'private' | 'internal'
  owner: string
}): ProjectRow {
  const db = getDB()
  const id = generateId('project')
  const now = Date.now()

  db.run(
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

  const created = getProject(id)
  if (!created) throw new Error(`Failed to create project ${id}`)
  return created
}

export function getProjectTasks(projectId: string): TaskRow[] {
  const db = getDB()
  const rows = db
    .query<TaskRow, [string]>(
      'SELECT * FROM project_tasks WHERE project_id = ? ORDER BY created_at DESC',
    )
    .all(projectId)
  return parseRows(rows, TaskRowSchema)
}

export function createTask(task: {
  projectId: string
  title: string
  assignee?: string
  dueDate?: number
}): TaskRow {
  const db = getDB()
  const id = generateId('task')
  const now = Date.now()

  db.run(
    `INSERT INTO project_tasks (id, project_id, title, assignee, due_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      task.projectId,
      task.title,
      task.assignee ?? null,
      task.dueDate ?? null,
      now,
      now,
    ],
  )

  const row = db
    .query<TaskRow, [string]>('SELECT * FROM project_tasks WHERE id = ?')
    .get(id)
  return TaskRowSchema.parse(row)
}

export function updateTask(
  id: string,
  updates: Partial<{
    title: string
    status: string
    assignee: string
    dueDate: number
  }>,
): TaskRow | null {
  const db = getDB()
  const sets: string[] = ['updated_at = ?']
  const params: (string | number | null)[] = [Date.now()]

  if (updates.title !== undefined) {
    sets.push('title = ?')
    params.push(updates.title)
  }
  if (updates.status !== undefined) {
    sets.push('status = ?')
    params.push(updates.status)
  }
  if (updates.assignee !== undefined) {
    sets.push('assignee = ?')
    params.push(updates.assignee)
  }
  if (updates.dueDate !== undefined) {
    sets.push('due_date = ?')
    params.push(updates.dueDate)
  }

  params.push(id)
  db.run(`UPDATE project_tasks SET ${sets.join(', ')} WHERE id = ?`, params)

  const row = db
    .query<TaskRow, [string]>('SELECT * FROM project_tasks WHERE id = ?')
    .get(id)
  return row ? TaskRowSchema.parse(row) : null
}

// Issues
export function getNextIssueNumber(repo: string): number {
  const db = getDB()
  const result = db
    .query<{ next_number: number }, [string]>(
      'SELECT next_number FROM issue_sequences WHERE repo = ?',
    )
    .get(repo)

  if (!result) {
    db.run('INSERT INTO issue_sequences (repo, next_number) VALUES (?, 2)', [
      repo,
    ])
    return 1
  }

  db.run(
    'UPDATE issue_sequences SET next_number = next_number + 1 WHERE repo = ?',
    [repo],
  )
  return result.next_number
}

export function listIssues(filter?: {
  repo?: string
  status?: string
  label?: string
  assignee?: string
  page?: number
  limit?: number
}): { issues: IssueRow[]; total: number } {
  const db = getDB()
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
  if (filter?.label) {
    conditions.push('labels LIKE ?')
    params.push(`%${filter.label}%`)
  }
  if (filter?.assignee) {
    conditions.push('assignees LIKE ?')
    params.push(`%${filter.assignee}%`)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const page = filter?.page ?? 1
  const limit = filter?.limit ?? 20
  const offset = (page - 1) * limit

  const countResult = db
    .query<{ count: number }, (string | number)[]>(
      `SELECT COUNT(*) as count FROM issues ${whereClause}`,
    )
    .get(...params)
  const total = countResult?.count ?? 0

  const rows = db
    .query<IssueRow, (string | number)[]>(
      `SELECT * FROM issues ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)

  return { issues: parseRows(rows, IssueRowSchema), total }
}

export function getIssue(id: string): IssueRow | null {
  const db = getDB()
  const row = db
    .query<IssueRow, [string]>('SELECT * FROM issues WHERE id = ?')
    .get(id)
  return row ? IssueRowSchema.parse(row) : null
}

export function getIssueByNumber(
  repo: string,
  number: number,
): IssueRow | null {
  const db = getDB()
  const row = db
    .query<IssueRow, [string, number]>(
      'SELECT * FROM issues WHERE repo = ? AND number = ?',
    )
    .get(repo, number)
  return row ? IssueRowSchema.parse(row) : null
}

export function createIssue(issue: {
  repo: string
  title: string
  body: string
  labels?: string[]
  assignees?: string[]
  author: string
}): IssueRow {
  const db = getDB()
  const id = generateId('issue')
  const number = getNextIssueNumber(issue.repo)
  const now = Date.now()

  db.run(
    `INSERT INTO issues (id, number, repo, title, body, labels, assignees, author, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      number,
      issue.repo,
      issue.title,
      issue.body,
      toJSON(issue.labels ?? []),
      toJSON(issue.assignees ?? []),
      issue.author,
      now,
      now,
    ],
  )

  const created = getIssue(id)
  if (!created) throw new Error(`Failed to create issue ${id}`)
  return created
}

// Issue Comments
const IssueCommentRowSchema = z.object({
  id: z.string(),
  issue_id: z.string(),
  author: z.string(),
  body: z.string(),
  created_at: z.number(),
})
export type IssueCommentRow = z.infer<typeof IssueCommentRowSchema>

export function getIssueComments(issueId: string): IssueCommentRow[] {
  const db = getDB()
  const rows = db
    .query<IssueCommentRow, [string]>(
      'SELECT * FROM issue_comments WHERE issue_id = ? ORDER BY created_at ASC',
    )
    .all(issueId)
  return rows.map((row) => IssueCommentRowSchema.parse(row))
}

export function createIssueComment(comment: {
  issueId: string
  author: string
  body: string
}): IssueCommentRow {
  const db = getDB()
  const id = generateId('comment')
  const now = Date.now()

  db.run(
    `INSERT INTO issue_comments (id, issue_id, author, body, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, comment.issueId, comment.author, comment.body, now],
  )

  // Update issue comment count
  db.run(
    'UPDATE issues SET comments_count = comments_count + 1, updated_at = ? WHERE id = ?',
    [now, comment.issueId],
  )

  const row = db
    .query<IssueCommentRow, [string]>(
      'SELECT * FROM issue_comments WHERE id = ?',
    )
    .get(id)
  return IssueCommentRowSchema.parse(row)
}

export function updateIssue(
  id: string,
  updates: {
    title?: string
    body?: string
    status?: 'open' | 'closed'
    labels?: string[]
    assignees?: string[]
  },
): IssueRow | null {
  const db = getDB()
  const now = Date.now()
  const sets: string[] = ['updated_at = ?']
  const params: (string | number)[] = [now]

  if (updates.title !== undefined) {
    sets.push('title = ?')
    params.push(updates.title)
  }
  if (updates.body !== undefined) {
    sets.push('body = ?')
    params.push(updates.body)
  }
  if (updates.status !== undefined) {
    sets.push('status = ?')
    params.push(updates.status)
  }
  if (updates.labels !== undefined) {
    sets.push('labels = ?')
    params.push(toJSON(updates.labels))
  }
  if (updates.assignees !== undefined) {
    sets.push('assignees = ?')
    params.push(toJSON(updates.assignees))
  }

  params.push(id)
  db.run(`UPDATE issues SET ${sets.join(', ')} WHERE id = ?`, params)

  return getIssue(id)
}

// Pull Requests
export function getNextPRNumber(repo: string): number {
  const db = getDB()
  const result = db
    .query<{ next_number: number }, [string]>(
      'SELECT next_number FROM pr_sequences WHERE repo = ?',
    )
    .get(repo)

  if (!result) {
    db.run('INSERT INTO pr_sequences (repo, next_number) VALUES (?, 2)', [repo])
    return 1
  }

  db.run(
    'UPDATE pr_sequences SET next_number = next_number + 1 WHERE repo = ?',
    [repo],
  )
  return result.next_number
}

export function listPullRequests(filter?: {
  repo?: string
  status?: string
  author?: string
  page?: number
  limit?: number
}): { pulls: PullRequestRow[]; total: number } {
  const db = getDB()
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
  if (filter?.author) {
    conditions.push('author = ?')
    params.push(filter.author)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const page = filter?.page ?? 1
  const limit = filter?.limit ?? 20
  const offset = (page - 1) * limit

  const countResult = db
    .query<{ count: number }, (string | number)[]>(
      `SELECT COUNT(*) as count FROM pull_requests ${whereClause}`,
    )
    .get(...params)
  const total = countResult?.count ?? 0

  const rows = db
    .query<PullRequestRow, (string | number)[]>(
      `SELECT * FROM pull_requests ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)

  return { pulls: parseRows(rows, PullRequestRowSchema), total }
}

export function getPullRequest(id: string): PullRequestRow | null {
  const db = getDB()
  const row = db
    .query<PullRequestRow, [string]>('SELECT * FROM pull_requests WHERE id = ?')
    .get(id)
  return row ? PullRequestRowSchema.parse(row) : null
}

export function getPullRequestByNumber(
  repo: string,
  number: number,
): PullRequestRow | null {
  const db = getDB()
  const row = db
    .query<PullRequestRow, [string, number]>(
      'SELECT * FROM pull_requests WHERE repo = ? AND number = ?',
    )
    .get(repo, number)
  return row ? PullRequestRowSchema.parse(row) : null
}

export function createPullRequest(pr: {
  repo: string
  title: string
  body: string
  sourceBranch: string
  targetBranch: string
  isDraft?: boolean
  author: string
}): PullRequestRow {
  const db = getDB()
  const id = generateId('pr')
  const number = getNextPRNumber(pr.repo)
  const now = Date.now()

  db.run(
    `INSERT INTO pull_requests (id, number, repo, title, body, source_branch, target_branch, is_draft, author, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      number,
      pr.repo,
      pr.title,
      pr.body,
      pr.sourceBranch,
      pr.targetBranch,
      pr.isDraft ? 1 : 0,
      pr.author,
      now,
      now,
    ],
  )

  const created = getPullRequest(id)
  if (!created) throw new Error(`Failed to create PR ${id}`)
  return created
}

// PR Reviews
const PRReviewRowSchema = z.object({
  id: z.string(),
  pr_id: z.string(),
  author: z.string(),
  state: z.enum(['approved', 'changes_requested', 'commented']),
  body: z.string(),
  submitted_at: z.number(),
})
export type PRReviewRow = z.infer<typeof PRReviewRowSchema>

export function getPRReviews(prId: string): PRReviewRow[] {
  const db = getDB()
  const rows = db
    .query<PRReviewRow, [string]>(
      'SELECT * FROM pr_reviews WHERE pr_id = ? ORDER BY submitted_at ASC',
    )
    .all(prId)
  return rows.map((row) => PRReviewRowSchema.parse(row))
}

export function createPRReview(review: {
  prId: string
  author: string
  state: 'approved' | 'changes_requested' | 'commented'
  body: string
}): PRReviewRow {
  const db = getDB()
  const id = generateId('review')
  const now = Date.now()

  db.run(
    `INSERT INTO pr_reviews (id, pr_id, author, state, body, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, review.prId, review.author, review.state, review.body, now],
  )

  const row = db
    .query<PRReviewRow, [string]>('SELECT * FROM pr_reviews WHERE id = ?')
    .get(id)
  return PRReviewRowSchema.parse(row)
}

export function mergePullRequest(id: string): boolean {
  const db = getDB()
  const now = Date.now()
  const result = db.run(
    'UPDATE pull_requests SET status = ?, merged_at = ?, updated_at = ? WHERE id = ?',
    ['merged', now, now, id],
  )
  return result.changes > 0
}

export function closePullRequest(id: string): boolean {
  const db = getDB()
  const now = Date.now()
  const result = db.run(
    'UPDATE pull_requests SET status = ?, updated_at = ? WHERE id = ?',
    ['closed', now, id],
  )
  return result.changes > 0
}

// Discussions
export function listDiscussions(filter?: {
  category?: string
  page?: number
  limit?: number
}): { discussions: DiscussionRow[]; total: number } {
  const db = getDB()
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (filter?.category) {
    conditions.push('category = ?')
    params.push(filter.category)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const page = filter?.page ?? 1
  const limit = filter?.limit ?? 20
  const offset = (page - 1) * limit

  const countResult = db
    .query<{ count: number }, (string | number)[]>(
      `SELECT COUNT(*) as count FROM discussions ${whereClause}`,
    )
    .get(...params)
  const total = countResult?.count ?? 0

  const rows = db
    .query<DiscussionRow, (string | number)[]>(
      `SELECT * FROM discussions ${whereClause} ORDER BY is_pinned DESC, last_reply_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)

  return { discussions: parseRows(rows, DiscussionRowSchema), total }
}

export function getDiscussion(id: string): DiscussionRow | null {
  const db = getDB()
  const row = db
    .query<DiscussionRow, [string]>('SELECT * FROM discussions WHERE id = ?')
    .get(id)
  return row ? DiscussionRowSchema.parse(row) : null
}

export function createDiscussion(discussion: {
  title: string
  content: string
  category: 'general' | 'questions' | 'announcements' | 'show' | 'ideas'
  tags?: string[]
  author: string
  authorName: string
  authorAvatar: string
}): DiscussionRow {
  const db = getDB()
  const id = generateId('discussion')
  const now = Date.now()

  db.run(
    `INSERT INTO discussions (id, title, content, category, tags, author, author_name, author_avatar, created_at, last_reply_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      discussion.title,
      discussion.content,
      discussion.category,
      toJSON(discussion.tags ?? []),
      discussion.author,
      discussion.authorName,
      discussion.authorAvatar,
      now,
      now,
    ],
  )

  const created = getDiscussion(id)
  if (!created) throw new Error(`Failed to create discussion ${id}`)
  return created
}

// Discussion Replies
const DiscussionReplyRowSchema = z.object({
  id: z.string(),
  discussion_id: z.string(),
  author: z.string(),
  author_name: z.string(),
  author_avatar: z.string(),
  content: z.string(),
  likes: z.number(),
  is_answer: z.number(),
  created_at: z.number(),
})
export type DiscussionReplyRow = z.infer<typeof DiscussionReplyRowSchema>

export function getDiscussionReplies(
  discussionId: string,
): DiscussionReplyRow[] {
  const db = getDB()
  const rows = db
    .query<DiscussionReplyRow, [string]>(
      'SELECT * FROM discussion_replies WHERE discussion_id = ? ORDER BY created_at ASC',
    )
    .all(discussionId)
  return rows.map((row) => DiscussionReplyRowSchema.parse(row))
}

export function createDiscussionReply(reply: {
  discussionId: string
  author: string
  authorName: string
  authorAvatar: string
  content: string
}): DiscussionReplyRow {
  const db = getDB()
  const id = generateId('reply')
  const now = Date.now()

  db.run(
    `INSERT INTO discussion_replies (id, discussion_id, author, author_name, author_avatar, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      reply.discussionId,
      reply.author,
      reply.authorName,
      reply.authorAvatar,
      reply.content,
      now,
    ],
  )

  // Update discussion reply count and last_reply_at
  db.run(
    'UPDATE discussions SET replies_count = replies_count + 1, last_reply_at = ? WHERE id = ?',
    [now, reply.discussionId],
  )

  const row = db
    .query<DiscussionReplyRow, [string]>(
      'SELECT * FROM discussion_replies WHERE id = ?',
    )
    .get(id)
  return DiscussionReplyRowSchema.parse(row)
}

// CI Runs
export function listCIRuns(filter?: {
  repo?: string
  status?: string
  branch?: string
  page?: number
  limit?: number
}): { runs: CIRunRow[]; total: number } {
  const db = getDB()
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

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const page = filter?.page ?? 1
  const limit = filter?.limit ?? 20
  const offset = (page - 1) * limit

  const countResult = db
    .query<{ count: number }, (string | number)[]>(
      `SELECT COUNT(*) as count FROM ci_runs ${whereClause}`,
    )
    .get(...params)
  const total = countResult?.count ?? 0

  const rows = db
    .query<CIRunRow, (string | number)[]>(
      `SELECT * FROM ci_runs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)

  return { runs: parseRows(rows, CIRunRowSchema), total }
}

export function getCIRun(id: string): CIRunRow | null {
  const db = getDB()
  const row = db
    .query<CIRunRow, [string]>('SELECT * FROM ci_runs WHERE id = ?')
    .get(id)
  return row ? CIRunRowSchema.parse(row) : null
}

export function createCIRun(run: {
  workflow: string
  repo: string
  branch: string
  commitSha?: string
  commitMessage?: string
  author?: string
}): CIRunRow {
  const db = getDB()
  const id = generateId('run')
  const now = Date.now()

  db.run(
    `INSERT INTO ci_runs (id, workflow, repo, branch, commit_sha, commit_message, author, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      run.workflow,
      run.repo,
      run.branch,
      run.commitSha ?? '',
      run.commitMessage ?? '',
      run.author ?? '',
      now,
      now,
      now,
    ],
  )

  const created = getCIRun(id)
  if (!created) throw new Error(`Failed to create CI run ${id}`)
  return created
}

// Agents
export function listAgents(filter?: {
  capability?: string
  active?: boolean
  owner?: string
}): AgentRow[] {
  const db = getDB()
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
  const rows = db
    .query<AgentRow, (string | number)[]>(
      `SELECT * FROM agents ${whereClause} ORDER BY reputation DESC, created_at DESC`,
    )
    .all(...params)

  return parseRows(rows, AgentRowSchema)
}

export function getAgent(agentId: string): AgentRow | null {
  const db = getDB()
  const row = db
    .query<AgentRow, [string]>('SELECT * FROM agents WHERE agent_id = ?')
    .get(agentId)
  return row ? AgentRowSchema.parse(row) : null
}

export function createAgent(agent: {
  agentId: string
  owner: string
  name: string
  botType: string
  characterCid?: string
  stateCid: string
  vaultAddress: string
  capabilities?: string[]
  specializations?: string[]
}): AgentRow {
  const db = getDB()
  const id = generateId('agent')
  const now = Date.now()

  db.run(
    `INSERT INTO agents (id, agent_id, owner, name, bot_type, character_cid, state_cid, vault_address, capabilities, specializations, registered_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      agent.agentId,
      agent.owner,
      agent.name,
      agent.botType,
      agent.characterCid ?? null,
      agent.stateCid,
      agent.vaultAddress,
      toJSON(agent.capabilities ?? []),
      toJSON(agent.specializations ?? []),
      now,
      now,
      now,
    ],
  )

  const created = getAgent(agent.agentId)
  if (!created) throw new Error(`Failed to create agent ${agent.agentId}`)
  return created
}

// Containers
export function listContainers(filter?: {
  org?: string
  name?: string
}): ContainerRow[] {
  const db = getDB()
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

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db
    .query<ContainerRow, string[]>(
      `SELECT * FROM containers ${whereClause} ORDER BY created_at DESC`,
    )
    .all(...params)

  return parseRows(rows, ContainerRowSchema)
}

export function createContainer(container: {
  name: string
  tag: string
  digest: string
  size: number
  platform: string
  labels?: Record<string, string>
  owner: string
}): ContainerRow {
  const db = getDB()
  const id = generateId('container')
  const now = Date.now()

  db.run(
    `INSERT INTO containers (id, name, tag, digest, size, platform, labels, owner, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      container.name,
      container.tag,
      container.digest,
      container.size,
      container.platform,
      container.labels ? toJSON(container.labels) : null,
      container.owner,
      now,
      now,
    ],
  )

  const row = db
    .query<ContainerRow, [string]>('SELECT * FROM containers WHERE id = ?')
    .get(id)
  return ContainerRowSchema.parse(row)
}

// Container Instances
export function listContainerInstances(filter?: {
  owner?: string
  status?: string
}): ContainerInstanceRow[] {
  const db = getDB()
  const conditions: string[] = []
  const params: string[] = []

  if (filter?.owner) {
    conditions.push('owner = ?')
    params.push(filter.owner)
  }
  if (filter?.status) {
    conditions.push('status = ?')
    params.push(filter.status)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db
    .query<ContainerInstanceRow, string[]>(
      `SELECT * FROM container_instances ${whereClause} ORDER BY created_at DESC`,
    )
    .all(...params)

  return parseRows(rows, ContainerInstanceRowSchema)
}

export function createContainerInstance(instance: {
  containerId: string
  name: string
  cpu: string
  memory: string
  gpu?: string
  owner: string
}): ContainerInstanceRow {
  const db = getDB()
  const id = generateId('instance')
  const now = Date.now()

  db.run(
    `INSERT INTO container_instances (id, container_id, name, cpu, memory, gpu, owner, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      instance.containerId,
      instance.name,
      instance.cpu,
      instance.memory,
      instance.gpu ?? null,
      instance.owner,
      now,
    ],
  )

  const row = db
    .query<ContainerInstanceRow, [string]>(
      'SELECT * FROM container_instances WHERE id = ?',
    )
    .get(id)
  return ContainerInstanceRowSchema.parse(row)
}

export function updateContainerInstanceStatus(
  id: string,
  status: string,
  endpoint?: string,
): boolean {
  const db = getDB()
  const now = Date.now()
  const result = db.run(
    `UPDATE container_instances SET status = ?, endpoint = ?, started_at = CASE WHEN status = 'running' THEN ? ELSE started_at END WHERE id = ?`,
    [status, endpoint ?? null, now, id],
  )
  return result.changes > 0
}

// Datasets
export function listDatasets(filter?: {
  type?: string
  org?: string
}): DatasetRow[] {
  const db = getDB()
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

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db
    .query<DatasetRow, string[]>(
      `SELECT * FROM datasets ${whereClause} ORDER BY downloads DESC, created_at DESC`,
    )
    .all(...params)

  return parseRows(rows, DatasetRowSchema)
}

export function createDataset(dataset: {
  name: string
  organization: string
  description: string
  type: 'text' | 'code' | 'image' | 'audio' | 'multimodal' | 'tabular'
  license: string
  owner: string
}): DatasetRow {
  const db = getDB()
  const id = generateId('dataset')
  const now = Date.now()

  db.run(
    `INSERT INTO datasets (id, name, organization, description, type, license, owner, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      dataset.name,
      dataset.organization,
      dataset.description,
      dataset.type,
      dataset.license,
      dataset.owner,
      now,
      now,
    ],
  )

  const row = db
    .query<DatasetRow, [string]>('SELECT * FROM datasets WHERE id = ?')
    .get(id)
  return DatasetRowSchema.parse(row)
}

// Models
export function listModels(filter?: {
  type?: string
  org?: string
}): ModelRow[] {
  const db = getDB()
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

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db
    .query<ModelRow, string[]>(
      `SELECT * FROM models ${whereClause} ORDER BY downloads DESC, created_at DESC`,
    )
    .all(...params)

  return parseRows(rows, ModelRowSchema)
}

export function getModel(org: string, name: string): ModelRow | null {
  const db = getDB()
  const row = db
    .query<ModelRow, [string]>('SELECT * FROM models WHERE id = ?')
    .get(`${org}/${name}`)
  return row ? ModelRowSchema.parse(row) : null
}

export function createModel(model: {
  name: string
  organization: string
  description: string
  type: 'llm' | 'embedding' | 'image' | 'audio' | 'multimodal' | 'code'
  fileUri: string
  owner: string
}): ModelRow {
  const db = getDB()
  const id = `${model.organization}/${model.name}`
  const now = Date.now()

  db.run(
    `INSERT INTO models (id, name, organization, description, type, file_uri, owner, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      model.name,
      model.organization,
      model.description,
      model.type,
      model.fileUri,
      model.owner,
      now,
      now,
    ],
  )

  const created = getModel(model.organization, model.name)
  if (!created)
    throw new Error(
      `Failed to create model ${model.organization}/${model.name}`,
    )
  return created
}

export function starModel(org: string, name: string): boolean {
  const db = getDB()
  const id = `${org}/${name}`
  const result = db.run(
    'UPDATE models SET stars = stars + 1, updated_at = ? WHERE id = ?',
    [Date.now(), id],
  )
  return result.changes > 0
}

// Leaderboard
export function getLeaderboard(limit: number = 50): LeaderboardRow[] {
  const db = getDB()
  const rows = db
    .query<LeaderboardRow, [number]>(
      'SELECT * FROM leaderboard ORDER BY score DESC LIMIT ?',
    )
    .all(limit)
  return parseRows(rows, LeaderboardRowSchema)
}

export function getLeaderboardEntry(address: string): LeaderboardRow | null {
  const db = getDB()
  const row = db
    .query<LeaderboardRow, [string]>(
      'SELECT * FROM leaderboard WHERE address = ?',
    )
    .get(address)
  return row ? LeaderboardRowSchema.parse(row) : null
}

export function updateLeaderboardScore(
  address: string,
  updates: {
    name?: string
    avatar?: string
    scoreIncrement?: number
    contributionsIncrement?: number
    bountiesIncrement?: number
  },
): LeaderboardRow {
  const db = getDB()
  const now = Date.now()

  // Check if entry exists
  const existing = getLeaderboardEntry(address)

  if (!existing) {
    // Create new entry
    const name = updates.name ?? `${address.slice(0, 6)}...${address.slice(-4)}`
    const avatar =
      updates.avatar ??
      `https://api.dicebear.com/7.x/identicon/svg?seed=${address}`
    const score = updates.scoreIncrement ?? 0
    const contributions = updates.contributionsIncrement ?? 0
    const bounties = updates.bountiesIncrement ?? 0

    db.run(
      `INSERT INTO leaderboard (address, name, avatar, score, contributions, bounties_completed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [address, name, avatar, score, contributions, bounties, now],
    )
  } else {
    // Update existing
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
    db.run(
      `UPDATE leaderboard SET ${sets.join(', ')} WHERE address = ?`,
      params,
    )

    // Update tier based on score
    const updated = getLeaderboardEntry(address)
    if (updated) {
      let tier: string = 'bronze'
      if (updated.score >= 10000) tier = 'diamond'
      else if (updated.score >= 5000) tier = 'gold'
      else if (updated.score >= 1000) tier = 'silver'

      if (tier !== updated.tier) {
        db.run('UPDATE leaderboard SET tier = ? WHERE address = ?', [
          tier,
          address,
        ])
      }
    }
  }

  const entry = getLeaderboardEntry(address)
  if (!entry) throw new Error(`Failed to get leaderboard entry ${address}`)
  return entry
}

// Repo Settings
const RepoSettingsRowSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  description: z.string().nullable(),
  visibility: z.enum(['public', 'private']),
  default_branch: z.string(),
  has_issues: z.number(),
  has_wiki: z.number(),
  has_discussions: z.number(),
  allow_merge_commit: z.number(),
  allow_squash_merge: z.number(),
  allow_rebase_merge: z.number(),
  delete_branch_on_merge: z.number(),
  archived: z.number(),
  updated_at: z.number(),
})

const CollaboratorRowSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  login: z.string(),
  avatar: z.string(),
  permission: z.enum(['read', 'write', 'admin']),
  created_at: z.number(),
})

const WebhookRowSchema = z.object({
  id: z.string(),
  owner: z.string(),
  repo: z.string(),
  url: z.string(),
  events: z.string(),
  active: z.number(),
  created_at: z.number(),
})

export type RepoSettingsRow = z.infer<typeof RepoSettingsRowSchema>
export type CollaboratorRow = z.infer<typeof CollaboratorRowSchema>
export type WebhookRow = z.infer<typeof WebhookRowSchema>

export function getRepoSettings(
  owner: string,
  repo: string,
): RepoSettingsRow | null {
  const db = getDB()
  const row = db
    .query<RepoSettingsRow, [string, string]>(
      'SELECT * FROM repo_settings WHERE owner = ? AND repo = ?',
    )
    .get(owner, repo)
  return row ? RepoSettingsRowSchema.parse(row) : null
}

export function upsertRepoSettings(
  owner: string,
  repo: string,
  settings: {
    description?: string
    visibility?: 'public' | 'private'
    defaultBranch?: string
    hasIssues?: boolean
    hasWiki?: boolean
    hasDiscussions?: boolean
    allowMergeCommit?: boolean
    allowSquashMerge?: boolean
    allowRebaseMerge?: boolean
    deleteBranchOnMerge?: boolean
    archived?: boolean
  },
): RepoSettingsRow {
  const db = getDB()
  const now = Date.now()
  const existing = getRepoSettings(owner, repo)

  if (!existing) {
    db.run(
      `INSERT INTO repo_settings (owner, repo, description, visibility, default_branch, has_issues, has_wiki, has_discussions, allow_merge_commit, allow_squash_merge, allow_rebase_merge, delete_branch_on_merge, archived, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        owner,
        repo,
        settings.description ?? null,
        settings.visibility ?? 'public',
        settings.defaultBranch ?? 'main',
        settings.hasIssues !== false ? 1 : 0,
        settings.hasWiki ? 1 : 0,
        settings.hasDiscussions !== false ? 1 : 0,
        settings.allowMergeCommit !== false ? 1 : 0,
        settings.allowSquashMerge !== false ? 1 : 0,
        settings.allowRebaseMerge !== false ? 1 : 0,
        settings.deleteBranchOnMerge ? 1 : 0,
        settings.archived ? 1 : 0,
        now,
      ],
    )
  } else {
    const sets: string[] = ['updated_at = ?']
    const params: (string | number | null)[] = [now]

    if (settings.description !== undefined) {
      sets.push('description = ?')
      params.push(settings.description)
    }
    if (settings.visibility !== undefined) {
      sets.push('visibility = ?')
      params.push(settings.visibility)
    }
    if (settings.defaultBranch !== undefined) {
      sets.push('default_branch = ?')
      params.push(settings.defaultBranch)
    }
    if (settings.hasIssues !== undefined) {
      sets.push('has_issues = ?')
      params.push(settings.hasIssues ? 1 : 0)
    }
    if (settings.hasWiki !== undefined) {
      sets.push('has_wiki = ?')
      params.push(settings.hasWiki ? 1 : 0)
    }
    if (settings.hasDiscussions !== undefined) {
      sets.push('has_discussions = ?')
      params.push(settings.hasDiscussions ? 1 : 0)
    }
    if (settings.allowMergeCommit !== undefined) {
      sets.push('allow_merge_commit = ?')
      params.push(settings.allowMergeCommit ? 1 : 0)
    }
    if (settings.allowSquashMerge !== undefined) {
      sets.push('allow_squash_merge = ?')
      params.push(settings.allowSquashMerge ? 1 : 0)
    }
    if (settings.allowRebaseMerge !== undefined) {
      sets.push('allow_rebase_merge = ?')
      params.push(settings.allowRebaseMerge ? 1 : 0)
    }
    if (settings.deleteBranchOnMerge !== undefined) {
      sets.push('delete_branch_on_merge = ?')
      params.push(settings.deleteBranchOnMerge ? 1 : 0)
    }
    if (settings.archived !== undefined) {
      sets.push('archived = ?')
      params.push(settings.archived ? 1 : 0)
    }

    params.push(owner, repo)
    db.run(
      `UPDATE repo_settings SET ${sets.join(', ')} WHERE owner = ? AND repo = ?`,
      params,
    )
  }

  const result = getRepoSettings(owner, repo)
  if (!result) throw new Error(`Failed to get repo settings ${owner}/${repo}`)
  return result
}

export function deleteRepoSettings(owner: string, repo: string): boolean {
  const db = getDB()
  // Delete collaborators and webhooks first
  db.run('DELETE FROM repo_collaborators WHERE owner = ? AND repo = ?', [
    owner,
    repo,
  ])
  db.run('DELETE FROM repo_webhooks WHERE owner = ? AND repo = ?', [
    owner,
    repo,
  ])
  // Delete settings
  const result = db.run(
    'DELETE FROM repo_settings WHERE owner = ? AND repo = ?',
    [owner, repo],
  )
  return result.changes > 0
}

export function getRepoCollaborators(
  owner: string,
  repo: string,
): CollaboratorRow[] {
  const db = getDB()
  const rows = db
    .query<CollaboratorRow, [string, string]>(
      'SELECT * FROM repo_collaborators WHERE owner = ? AND repo = ?',
    )
    .all(owner, repo)
  return parseRows(rows, CollaboratorRowSchema)
}

export function addRepoCollaborator(
  owner: string,
  repo: string,
  collaborator: {
    login: string
    avatar: string
    permission: 'read' | 'write' | 'admin'
  },
): CollaboratorRow {
  const db = getDB()
  const now = Date.now()

  db.run(
    `INSERT OR REPLACE INTO repo_collaborators (owner, repo, login, avatar, permission, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      owner,
      repo,
      collaborator.login,
      collaborator.avatar,
      collaborator.permission,
      now,
    ],
  )

  const row = db
    .query<CollaboratorRow, [string, string, string]>(
      'SELECT * FROM repo_collaborators WHERE owner = ? AND repo = ? AND login = ?',
    )
    .get(owner, repo, collaborator.login)
  return CollaboratorRowSchema.parse(row)
}

export function removeRepoCollaborator(
  owner: string,
  repo: string,
  login: string,
): boolean {
  const db = getDB()
  const result = db.run(
    'DELETE FROM repo_collaborators WHERE owner = ? AND repo = ? AND login = ?',
    [owner, repo, login],
  )
  return result.changes > 0
}

export function getRepoWebhooks(owner: string, repo: string): WebhookRow[] {
  const db = getDB()
  const rows = db
    .query<WebhookRow, [string, string]>(
      'SELECT * FROM repo_webhooks WHERE owner = ? AND repo = ?',
    )
    .all(owner, repo)
  return parseRows(rows, WebhookRowSchema)
}

export function addRepoWebhook(
  owner: string,
  repo: string,
  webhook: {
    url: string
    events: string[]
  },
): WebhookRow {
  const db = getDB()
  const id = generateId('webhook')
  const now = Date.now()

  db.run(
    `INSERT INTO repo_webhooks (id, owner, repo, url, events, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, owner, repo, webhook.url, toJSON(webhook.events), now],
  )

  const row = db
    .query<WebhookRow, [string]>('SELECT * FROM repo_webhooks WHERE id = ?')
    .get(id)
  return WebhookRowSchema.parse(row)
}

export function removeRepoWebhook(id: string): boolean {
  const db = getDB()
  const result = db.run('DELETE FROM repo_webhooks WHERE id = ?', [id])
  return result.changes > 0
}

// Package Settings
const PackageSettingsRowSchema = z.object({
  scope: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  visibility: z.enum(['public', 'private']),
  publish_enabled: z.number(),
  deprecated: z.number(),
  deprecation_message: z.string().nullable(),
  download_count: z.number(),
  updated_at: z.number(),
})

const MaintainerRowSchema = z.object({
  scope: z.string(),
  name: z.string(),
  login: z.string(),
  avatar: z.string(),
  role: z.enum(['owner', 'maintainer']),
  created_at: z.number(),
})

const PackageTokenRowSchema = z.object({
  id: z.string(),
  scope: z.string(),
  name: z.string(),
  token_name: z.string(),
  token_hash: z.string(),
  permissions: z.string(),
  expires_at: z.number().nullable(),
  last_used: z.number().nullable(),
  created_at: z.number(),
})

export type PackageSettingsRow = z.infer<typeof PackageSettingsRowSchema>
export type MaintainerRow = z.infer<typeof MaintainerRowSchema>
export type PackageTokenRow = z.infer<typeof PackageTokenRowSchema>

export function getPackageSettings(
  scope: string,
  name: string,
): PackageSettingsRow | null {
  const db = getDB()
  const row = db
    .query<PackageSettingsRow, [string, string]>(
      'SELECT * FROM package_settings WHERE scope = ? AND name = ?',
    )
    .get(scope, name)
  return row ? PackageSettingsRowSchema.parse(row) : null
}

export function upsertPackageSettings(
  scope: string,
  name: string,
  settings: {
    description?: string
    visibility?: 'public' | 'private'
    publishEnabled?: boolean
  },
): PackageSettingsRow {
  const db = getDB()
  const now = Date.now()
  const existing = getPackageSettings(scope, name)

  if (!existing) {
    db.run(
      `INSERT INTO package_settings (scope, name, description, visibility, publish_enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        scope,
        name,
        settings.description ?? null,
        settings.visibility ?? 'public',
        settings.publishEnabled !== false ? 1 : 0,
        now,
      ],
    )
  } else {
    const sets: string[] = ['updated_at = ?']
    const params: (string | number | null)[] = [now]

    if (settings.description !== undefined) {
      sets.push('description = ?')
      params.push(settings.description)
    }
    if (settings.visibility !== undefined) {
      sets.push('visibility = ?')
      params.push(settings.visibility)
    }
    if (settings.publishEnabled !== undefined) {
      sets.push('publish_enabled = ?')
      params.push(settings.publishEnabled ? 1 : 0)
    }

    params.push(scope, name)
    db.run(
      `UPDATE package_settings SET ${sets.join(', ')} WHERE scope = ? AND name = ?`,
      params,
    )
  }

  const result = getPackageSettings(scope, name)
  if (!result)
    throw new Error(`Failed to get package settings ${scope}/${name}`)
  return result
}

export function deprecatePackage(
  scope: string,
  name: string,
  message: string,
): boolean {
  const db = getDB()
  const result = db.run(
    'UPDATE package_settings SET deprecated = 1, deprecation_message = ?, updated_at = ? WHERE scope = ? AND name = ?',
    [message, Date.now(), scope, name],
  )
  return result.changes > 0
}

export function undeprecatePackage(scope: string, name: string): boolean {
  const db = getDB()
  const result = db.run(
    'UPDATE package_settings SET deprecated = 0, deprecation_message = NULL, updated_at = ? WHERE scope = ? AND name = ?',
    [Date.now(), scope, name],
  )
  return result.changes > 0
}

export function getPackageMaintainers(
  scope: string,
  name: string,
): MaintainerRow[] {
  const db = getDB()
  const rows = db
    .query<MaintainerRow, [string, string]>(
      'SELECT * FROM package_maintainers WHERE scope = ? AND name = ?',
    )
    .all(scope, name)
  return parseRows(rows, MaintainerRowSchema)
}

export function addPackageMaintainer(
  scope: string,
  name: string,
  maintainer: {
    login: string
    avatar: string
    role: 'owner' | 'maintainer'
  },
): MaintainerRow {
  const db = getDB()
  const now = Date.now()

  db.run(
    `INSERT OR REPLACE INTO package_maintainers (scope, name, login, avatar, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [scope, name, maintainer.login, maintainer.avatar, maintainer.role, now],
  )

  const row = db
    .query<MaintainerRow, [string, string, string]>(
      'SELECT * FROM package_maintainers WHERE scope = ? AND name = ? AND login = ?',
    )
    .get(scope, name, maintainer.login)
  return MaintainerRowSchema.parse(row)
}

export function removePackageMaintainer(
  scope: string,
  name: string,
  login: string,
): boolean {
  const db = getDB()
  const result = db.run(
    'DELETE FROM package_maintainers WHERE scope = ? AND name = ? AND login = ?',
    [scope, name, login],
  )
  return result.changes > 0
}

export function createPackageToken(
  scope: string,
  name: string,
  token: {
    tokenName: string
    permissions: string[]
    expiresAt?: number
  },
): { row: PackageTokenRow; plainToken: string } {
  const db = getDB()
  const id = generateId('token')
  const plainToken = `pkg_${id}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  const now = Date.now()

  // Hash the token using SHA-256
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(plainToken)
  const tokenHash = hasher.digest('hex')

  db.run(
    `INSERT INTO package_tokens (id, scope, name, token_name, token_hash, permissions, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      scope,
      name,
      token.tokenName,
      tokenHash,
      toJSON(token.permissions),
      token.expiresAt ?? null,
      now,
    ],
  )

  const row = db
    .query<PackageTokenRow, [string]>(
      'SELECT * FROM package_tokens WHERE id = ?',
    )
    .get(id)
  return { row: PackageTokenRowSchema.parse(row), plainToken }
}

export function revokePackageToken(id: string): boolean {
  const db = getDB()
  const result = db.run('DELETE FROM package_tokens WHERE id = ?', [id])
  return result.changes > 0
}

// ============================================================================
// FARCASTER MESSAGING
// ============================================================================

// FID Links
const FidLinkRowSchema = z.object({
  address: z.string(),
  fid: z.number(),
  username: z.string().nullable(),
  display_name: z.string().nullable(),
  pfp_url: z.string().nullable(),
  bio: z.string().nullable(),
  verified_at: z.number(),
  updated_at: z.number(),
})
export type FidLinkRow = z.infer<typeof FidLinkRowSchema>

export function getFidLink(address: string): FidLinkRow | null {
  const db = getDB()
  const row = db
    .query<FidLinkRow, [string]>(
      'SELECT * FROM fid_links WHERE address = ?',
    )
    .get(address.toLowerCase())
  return row ? FidLinkRowSchema.parse(row) : null
}

export function getFidLinkByFid(fid: number): FidLinkRow | null {
  const db = getDB()
  const row = db
    .query<FidLinkRow, [number]>(
      'SELECT * FROM fid_links WHERE fid = ?',
    )
    .get(fid)
  return row ? FidLinkRowSchema.parse(row) : null
}

export function createFidLink(link: {
  address: string
  fid: number
  username?: string
  displayName?: string
  pfpUrl?: string
  bio?: string
}): FidLinkRow {
  const db = getDB()
  const now = Date.now()

  db.run(
    `INSERT INTO fid_links (address, fid, username, display_name, pfp_url, bio, verified_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET
       fid = excluded.fid,
       username = excluded.username,
       display_name = excluded.display_name,
       pfp_url = excluded.pfp_url,
       bio = excluded.bio,
       updated_at = excluded.updated_at`,
    [
      link.address.toLowerCase(),
      link.fid,
      link.username ?? null,
      link.displayName ?? null,
      link.pfpUrl ?? null,
      link.bio ?? null,
      now,
      now,
    ],
  )

  const created = getFidLink(link.address)
  if (!created) throw new Error(`Failed to create FID link for ${link.address}`)
  return created
}

export function deleteFidLink(address: string): boolean {
  const db = getDB()
  const result = db.run('DELETE FROM fid_links WHERE address = ?', [address.toLowerCase()])
  return result.changes > 0
}

// Farcaster Signers
const FarcasterSignerRowSchema = z.object({
  id: z.string(),
  address: z.string(),
  fid: z.number(),
  signer_public_key: z.string(),
  encrypted_private_key: z.string(),
  encryption_iv: z.string(),
  key_state: z.enum(['pending', 'active', 'revoked']),
  deadline: z.number().nullable(),
  signature: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
})
export type FarcasterSignerRow = z.infer<typeof FarcasterSignerRowSchema>

export function getFarcasterSigner(address: string): FarcasterSignerRow | null {
  const db = getDB()
  const row = db
    .query<FarcasterSignerRow, [string]>(
      "SELECT * FROM farcaster_signers WHERE address = ? AND key_state = 'active' ORDER BY created_at DESC LIMIT 1",
    )
    .get(address.toLowerCase())
  return row ? FarcasterSignerRowSchema.parse(row) : null
}

export function getFarcasterSignerByPublicKey(publicKey: string): FarcasterSignerRow | null {
  const db = getDB()
  const row = db
    .query<FarcasterSignerRow, [string]>(
      'SELECT * FROM farcaster_signers WHERE signer_public_key = ?',
    )
    .get(publicKey)
  return row ? FarcasterSignerRowSchema.parse(row) : null
}

export function listFarcasterSigners(address: string): FarcasterSignerRow[] {
  const db = getDB()
  const rows = db
    .query<FarcasterSignerRow, [string]>(
      'SELECT * FROM farcaster_signers WHERE address = ? ORDER BY created_at DESC',
    )
    .all(address.toLowerCase())
  return rows.map((row) => FarcasterSignerRowSchema.parse(row))
}

export function createFarcasterSigner(signer: {
  address: string
  fid: number
  signerPublicKey: string
  encryptedPrivateKey: string
  encryptionIv: string
  deadline?: number
  signature?: string
}): FarcasterSignerRow {
  const db = getDB()
  const id = generateId('signer')
  const now = Date.now()

  db.run(
    `INSERT INTO farcaster_signers (id, address, fid, signer_public_key, encrypted_private_key, encryption_iv, key_state, deadline, signature, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    [
      id,
      signer.address.toLowerCase(),
      signer.fid,
      signer.signerPublicKey,
      signer.encryptedPrivateKey,
      signer.encryptionIv,
      signer.deadline ?? null,
      signer.signature ?? null,
      now,
      now,
    ],
  )

  const row = db
    .query<FarcasterSignerRow, [string]>(
      'SELECT * FROM farcaster_signers WHERE id = ?',
    )
    .get(id)
  return FarcasterSignerRowSchema.parse(row)
}

export function updateSignerState(
  id: string,
  state: 'pending' | 'active' | 'revoked',
): boolean {
  const db = getDB()
  const result = db.run(
    'UPDATE farcaster_signers SET key_state = ?, updated_at = ? WHERE id = ?',
    [state, Date.now(), id],
  )
  return result.changes > 0
}

export function activateSigner(publicKey: string, signature: string): boolean {
  const db = getDB()
  const result = db.run(
    "UPDATE farcaster_signers SET key_state = 'active', signature = ?, updated_at = ? WHERE signer_public_key = ?",
    [signature, Date.now(), publicKey],
  )
  return result.changes > 0
}

// Project Channels
const ProjectChannelRowSchema = z.object({
  project_id: z.string(),
  channel_id: z.string(),
  channel_url: z.string(),
  created_at: z.number(),
})
export type ProjectChannelRow = z.infer<typeof ProjectChannelRowSchema>

export function getProjectChannel(projectId: string): ProjectChannelRow | null {
  const db = getDB()
  const row = db
    .query<ProjectChannelRow, [string]>(
      'SELECT * FROM project_channels WHERE project_id = ?',
    )
    .get(projectId)
  return row ? ProjectChannelRowSchema.parse(row) : null
}

export function setProjectChannel(
  projectId: string,
  channelId: string,
  channelUrl: string,
): ProjectChannelRow {
  const db = getDB()
  const now = Date.now()

  db.run(
    `INSERT INTO project_channels (project_id, channel_id, channel_url, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       channel_url = excluded.channel_url`,
    [projectId, channelId, channelUrl, now],
  )

  const created = getProjectChannel(projectId)
  if (!created) throw new Error(`Failed to set channel for project ${projectId}`)
  return created
}

export function deleteProjectChannel(projectId: string): boolean {
  const db = getDB()
  const result = db.run('DELETE FROM project_channels WHERE project_id = ?', [projectId])
  return result.changes > 0
}

// Cast Reactions (local cache)
const CastReactionRowSchema = z.object({
  id: z.string(),
  address: z.string(),
  cast_hash: z.string(),
  cast_fid: z.number(),
  reaction_type: z.enum(['like', 'recast']),
  created_at: z.number(),
})
export type CastReactionRow = z.infer<typeof CastReactionRowSchema>

export function getCastReaction(
  address: string,
  castHash: string,
  reactionType: 'like' | 'recast',
): CastReactionRow | null {
  const db = getDB()
  const row = db
    .query<CastReactionRow, [string, string, string]>(
      'SELECT * FROM cast_reactions WHERE address = ? AND cast_hash = ? AND reaction_type = ?',
    )
    .get(address.toLowerCase(), castHash, reactionType)
  return row ? CastReactionRowSchema.parse(row) : null
}

export function getUserReactionsForCasts(
  address: string,
  castHashes: string[],
): CastReactionRow[] {
  if (castHashes.length === 0) return []
  const db = getDB()
  const placeholders = castHashes.map(() => '?').join(', ')
  const rows = db
    .query<CastReactionRow, string[]>(
      `SELECT * FROM cast_reactions WHERE address = ? AND cast_hash IN (${placeholders})`,
    )
    .all(address.toLowerCase(), ...castHashes)
  return rows.map((row) => CastReactionRowSchema.parse(row))
}

export function createCastReaction(reaction: {
  address: string
  castHash: string
  castFid: number
  reactionType: 'like' | 'recast'
}): CastReactionRow {
  const db = getDB()
  const id = generateId('reaction')
  const now = Date.now()

  db.run(
    `INSERT INTO cast_reactions (id, address, cast_hash, cast_fid, reaction_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(address, cast_hash, reaction_type) DO NOTHING`,
    [
      id,
      reaction.address.toLowerCase(),
      reaction.castHash,
      reaction.castFid,
      reaction.reactionType,
      now,
    ],
  )

  const row = getCastReaction(reaction.address, reaction.castHash, reaction.reactionType)
  if (!row) throw new Error('Failed to create cast reaction')
  return row
}

export function deleteCastReaction(
  address: string,
  castHash: string,
  reactionType: 'like' | 'recast',
): boolean {
  const db = getDB()
  const result = db.run(
    'DELETE FROM cast_reactions WHERE address = ? AND cast_hash = ? AND reaction_type = ?',
    [address.toLowerCase(), castHash, reactionType],
  )
  return result.changes > 0
}
