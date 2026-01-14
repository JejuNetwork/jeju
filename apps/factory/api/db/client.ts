/**
 * Factory Database Client
 *
 * This module provides the database interface for Factory.
 * In workerd/DWS environment, it uses SQLit (distributed database).
 * In local Bun environment, it falls back to bun:sqlite for development.
 *
 * All public functions are async to ensure workerd compatibility.
 */

export {
  // Types
  type BountyRow,
  closeDB,
  createBounty,
  createJob,
  createProject,
  generateId,
  getBounty,
  getBountyStats,
  getDB,
  getJob,
  getJobStats,
  // Leaderboard
  getLeaderboard,
  getLeaderboardEntry,
  getProject,
  // Core functions
  initDB,
  isHealthy,
  type JobRow,
  type LeaderboardRow,
  // Bounties
  listBounties,
  // Jobs
  listJobs,
  // Projects
  listProjects,
  type ProjectRow,
  updateBountyStatus,
  updateLeaderboardScore,
} from './sqlit-client'

// Re-export remaining types and functions that need to be implemented
// These are stubs that will be filled in as needed

import { z } from 'zod'
import { generateId, getDB } from './sqlit-client'

// Additional row schemas for complete API coverage
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

// Export local row types (Bounty, Job, Project, Leaderboard are re-exported from sqlit-client)
export type TaskRow = z.infer<typeof TaskRowSchema>
export type IssueRow = z.infer<typeof IssueRowSchema>
export type PullRequestRow = z.infer<typeof PullRequestRowSchema>
export type DiscussionRow = z.infer<typeof DiscussionRowSchema>
export type CIRunRow = z.infer<typeof CIRunRowSchema>
export type AgentRow = z.infer<typeof AgentRowSchema>
export type ContainerRow = z.infer<typeof ContainerRowSchema>
export type DatasetRow = z.infer<typeof DatasetRowSchema>
export type ModelRow = z.infer<typeof ModelRowSchema>

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

// Export types
export type TaskRow = z.infer<typeof TaskRowSchema>
export type IssueRow = z.infer<typeof IssueRowSchema>
export type PullRequestRow = z.infer<typeof PullRequestRowSchema>
export type DiscussionRow = z.infer<typeof DiscussionRowSchema>
export type CIRunRow = z.infer<typeof CIRunRowSchema>
export type AgentRow = z.infer<typeof AgentRowSchema>
export type ContainerRow = z.infer<typeof ContainerRowSchema>
export type DatasetRow = z.infer<typeof DatasetRowSchema>
export type ModelRow = z.infer<typeof ModelRowSchema>
export type RepoSettingsRow = z.infer<typeof RepoSettingsRowSchema>
export type CollaboratorRow = z.infer<typeof CollaboratorRowSchema>
export type WebhookRow = z.infer<typeof WebhookRowSchema>
export type PackageSettingsRow = z.infer<typeof PackageSettingsRowSchema>
export type FidLinkRow = z.infer<typeof FidLinkRowSchema>
export type FarcasterSignerRow = z.infer<typeof FarcasterSignerRowSchema>
export type ContainerInstanceRow = z.infer<typeof ContainerInstanceRowSchema>
export type IssueCommentRow = {
  id: string
  issue_id: string
  author: string
  body: string
  created_at: number
}
export type PRReviewRow = {
  id: string
  pr_id: string
  author: string
  state: 'approved' | 'changes_requested' | 'commented'
  body: string
  submitted_at: number
}
export type DiscussionReplyRow = {
  id: string
  discussion_id: string
  author: string
  author_name: string
  author_avatar: string
  content: string
  likes: number
  is_answer: number
  created_at: number
}
export type MaintainerRow = {
  scope: string
  name: string
  login: string
  avatar: string
  role: 'owner' | 'maintainer'
  created_at: number
}
export type PackageTokenRow = {
  id: string
  scope: string
  name: string
  token_name: string
  token_hash: string
  permissions: string
  expires_at: number | null
  last_used: number | null
  created_at: number
}
export type CastReactionRow = {
  id: string
  address: string
  cast_hash: string
  cast_fid: number
  reaction_type: 'like' | 'recast'
  created_at: number
}
export type ProjectChannelRow = {
  project_id: string
  channel_id: string
  channel_url: string
  created_at: number
}

// Helper to convert to JSON string
function toJSON(data: unknown): string {
  return JSON.stringify(data)
}

// ============================================================================
// TASKS
// ============================================================================

export async function getProjectTasks(projectId: string): Promise<TaskRow[]> {
  const database = getDB()
  const result = await database.query<TaskRow>(
    'SELECT * FROM project_tasks WHERE project_id = ? ORDER BY created_at DESC',
    [projectId],
  )
  return result.rows.map((r) => TaskRowSchema.parse(r))
}

export async function createTask(task: {
  projectId: string
  title: string
  assignee?: string
  dueDate?: number
}): Promise<TaskRow> {
  const database = getDB()
  const id = generateId('task')
  const now = Date.now()

  await database.exec(
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

  const result = await database.query<TaskRow>(
    'SELECT * FROM project_tasks WHERE id = ?',
    [id],
  )
  return TaskRowSchema.parse(result.rows[0])
}

export async function updateTask(
  id: string,
  updates: Partial<{
    title: string
    status: string
    assignee: string
    dueDate: number
  }>,
): Promise<TaskRow | null> {
  const database = getDB()
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
  await database.exec(
    `UPDATE project_tasks SET ${sets.join(', ')} WHERE id = ?`,
    params,
  )

  const result = await database.query<TaskRow>(
    'SELECT * FROM project_tasks WHERE id = ?',
    [id],
  )
  return result.rows[0] ? TaskRowSchema.parse(result.rows[0]) : null
}

// ============================================================================
// ISSUES
// ============================================================================

export async function getNextIssueNumber(repo: string): Promise<number> {
  const database = getDB()
  const result = await database.query<{ next_number: number }>(
    'SELECT next_number FROM issue_sequences WHERE repo = ?',
    [repo],
  )

  if (!result.rows[0]) {
    await database.exec(
      'INSERT INTO issue_sequences (repo, next_number) VALUES (?, 2)',
      [repo],
    )
    return 1
  }

  await database.exec(
    'UPDATE issue_sequences SET next_number = next_number + 1 WHERE repo = ?',
    [repo],
  )
  return result.rows[0].next_number
}

export async function listIssues(filter?: {
  repo?: string
  status?: string
  label?: string
  assignee?: string
  page?: number
  limit?: number
}): Promise<{ issues: IssueRow[]; total: number }> {
  const database = getDB()
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

  const countResult = await database.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM issues ${whereClause}`,
    params,
  )
  const total = countResult.rows[0]?.count ?? 0

  const result = await database.query<IssueRow>(
    `SELECT * FROM issues ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )

  return { issues: result.rows.map((r) => IssueRowSchema.parse(r)), total }
}

export async function getIssue(id: string): Promise<IssueRow | null> {
  const database = getDB()
  const result = await database.query<IssueRow>(
    'SELECT * FROM issues WHERE id = ?',
    [id],
  )
  return result.rows[0] ? IssueRowSchema.parse(result.rows[0]) : null
}

export async function getIssueByNumber(
  repo: string,
  number: number,
): Promise<IssueRow | null> {
  const database = getDB()
  const result = await database.query<IssueRow>(
    'SELECT * FROM issues WHERE repo = ? AND number = ?',
    [repo, number],
  )
  return result.rows[0] ? IssueRowSchema.parse(result.rows[0]) : null
}

export async function createIssue(issue: {
  repo: string
  title: string
  body: string
  labels?: string[]
  assignees?: string[]
  author: string
}): Promise<IssueRow> {
  const database = getDB()
  const id = generateId('issue')
  const number = await getNextIssueNumber(issue.repo)
  const now = Date.now()

  await database.exec(
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

  const created = await getIssue(id)
  if (!created) throw new Error(`Failed to create issue ${id}`)
  return created
}

export async function getIssueComments(
  issueId: string,
): Promise<IssueCommentRow[]> {
  const database = getDB()
  const result = await database.query<IssueCommentRow>(
    'SELECT * FROM issue_comments WHERE issue_id = ? ORDER BY created_at ASC',
    [issueId],
  )
  return result.rows
}

export async function createIssueComment(comment: {
  issueId: string
  author: string
  body: string
}): Promise<IssueCommentRow> {
  const database = getDB()
  const id = generateId('comment')
  const now = Date.now()

  await database.exec(
    `INSERT INTO issue_comments (id, issue_id, author, body, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, comment.issueId, comment.author, comment.body, now],
  )

  await database.exec(
    'UPDATE issues SET comments_count = comments_count + 1, updated_at = ? WHERE id = ?',
    [now, comment.issueId],
  )

  const result = await database.query<IssueCommentRow>(
    'SELECT * FROM issue_comments WHERE id = ?',
    [id],
  )
  return result.rows[0]
}

export async function updateIssue(
  id: string,
  updates: {
    title?: string
    body?: string
    status?: 'open' | 'closed'
    labels?: string[]
    assignees?: string[]
  },
): Promise<IssueRow | null> {
  const database = getDB()
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
  await database.exec(
    `UPDATE issues SET ${sets.join(', ')} WHERE id = ?`,
    params,
  )

  return getIssue(id)
}

// ============================================================================
// PULL REQUESTS
// ============================================================================

export async function getNextPRNumber(repo: string): Promise<number> {
  const database = getDB()
  const result = await database.query<{ next_number: number }>(
    'SELECT next_number FROM pr_sequences WHERE repo = ?',
    [repo],
  )

  if (!result.rows[0]) {
    await database.exec(
      'INSERT INTO pr_sequences (repo, next_number) VALUES (?, 2)',
      [repo],
    )
    return 1
  }

  await database.exec(
    'UPDATE pr_sequences SET next_number = next_number + 1 WHERE repo = ?',
    [repo],
  )
  return result.rows[0].next_number
}

export async function listPullRequests(filter?: {
  repo?: string
  status?: string
  author?: string
  page?: number
  limit?: number
}): Promise<{ pulls: PullRequestRow[]; total: number }> {
  const database = getDB()
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

  const countResult = await database.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM pull_requests ${whereClause}`,
    params,
  )
  const total = countResult.rows[0]?.count ?? 0

  const result = await database.query<PullRequestRow>(
    `SELECT * FROM pull_requests ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )

  return { pulls: result.rows.map((r) => PullRequestRowSchema.parse(r)), total }
}

export async function getPullRequest(
  id: string,
): Promise<PullRequestRow | null> {
  const database = getDB()
  const result = await database.query<PullRequestRow>(
    'SELECT * FROM pull_requests WHERE id = ?',
    [id],
  )
  return result.rows[0] ? PullRequestRowSchema.parse(result.rows[0]) : null
}

export async function getPullRequestByNumber(
  repo: string,
  number: number,
): Promise<PullRequestRow | null> {
  const database = getDB()
  const result = await database.query<PullRequestRow>(
    'SELECT * FROM pull_requests WHERE repo = ? AND number = ?',
    [repo, number],
  )
  return result.rows[0] ? PullRequestRowSchema.parse(result.rows[0]) : null
}

export async function createPullRequest(pr: {
  repo: string
  title: string
  body: string
  sourceBranch: string
  targetBranch: string
  isDraft?: boolean
  author: string
}): Promise<PullRequestRow> {
  const database = getDB()
  const id = generateId('pr')
  const number = await getNextPRNumber(pr.repo)
  const now = Date.now()

  await database.exec(
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

  const created = await getPullRequest(id)
  if (!created) throw new Error(`Failed to create PR ${id}`)
  return created
}

export async function getPRReviews(prId: string): Promise<PRReviewRow[]> {
  const database = getDB()
  const result = await database.query<PRReviewRow>(
    'SELECT * FROM pr_reviews WHERE pr_id = ? ORDER BY submitted_at ASC',
    [prId],
  )
  return result.rows
}

export async function createPRReview(review: {
  prId: string
  author: string
  state: 'approved' | 'changes_requested' | 'commented'
  body: string
}): Promise<PRReviewRow> {
  const database = getDB()
  const id = generateId('review')
  const now = Date.now()

  await database.exec(
    `INSERT INTO pr_reviews (id, pr_id, author, state, body, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, review.prId, review.author, review.state, review.body, now],
  )

  const result = await database.query<PRReviewRow>(
    'SELECT * FROM pr_reviews WHERE id = ?',
    [id],
  )
  return result.rows[0]
}

export async function mergePullRequest(id: string): Promise<boolean> {
  const database = getDB()
  const now = Date.now()
  const result = await database.exec(
    'UPDATE pull_requests SET status = ?, updated_at = ? WHERE id = ?',
    ['merged', now, id],
  )
  return result.rowsAffected > 0
}

export async function closePullRequest(id: string): Promise<boolean> {
  const database = getDB()
  const now = Date.now()
  const result = await database.exec(
    'UPDATE pull_requests SET status = ?, updated_at = ? WHERE id = ?',
    ['closed', now, id],
  )
  return result.rowsAffected > 0
}

// ============================================================================
// DISCUSSIONS
// ============================================================================

export async function listDiscussions(filter?: {
  category?: string
  page?: number
  limit?: number
}): Promise<{ discussions: DiscussionRow[]; total: number }> {
  const database = getDB()
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

  const countResult = await database.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM discussions ${whereClause}`,
    params,
  )
  const total = countResult.rows[0]?.count ?? 0

  const result = await database.query<DiscussionRow>(
    `SELECT * FROM discussions ${whereClause} ORDER BY is_pinned DESC, last_reply_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )

  return {
    discussions: result.rows.map((r) => DiscussionRowSchema.parse(r)),
    total,
  }
}

export async function getDiscussion(id: string): Promise<DiscussionRow | null> {
  const database = getDB()
  const result = await database.query<DiscussionRow>(
    'SELECT * FROM discussions WHERE id = ?',
    [id],
  )
  return result.rows[0] ? DiscussionRowSchema.parse(result.rows[0]) : null
}

export async function createDiscussion(discussion: {
  title: string
  content: string
  category: 'general' | 'questions' | 'announcements' | 'show' | 'ideas'
  tags?: string[]
  author: string
  authorName: string
  authorAvatar: string
}): Promise<DiscussionRow> {
  const database = getDB()
  const id = generateId('discussion')
  const now = Date.now()

  await database.exec(
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

  const created = await getDiscussion(id)
  if (!created) throw new Error(`Failed to create discussion ${id}`)
  return created
}

export async function getDiscussionReplies(
  discussionId: string,
): Promise<DiscussionReplyRow[]> {
  const database = getDB()
  const result = await database.query<DiscussionReplyRow>(
    'SELECT * FROM discussion_replies WHERE discussion_id = ? ORDER BY created_at ASC',
    [discussionId],
  )
  return result.rows
}

export async function createDiscussionReply(reply: {
  discussionId: string
  author: string
  authorName: string
  authorAvatar: string
  content: string
}): Promise<DiscussionReplyRow> {
  const database = getDB()
  const id = generateId('reply')
  const now = Date.now()

  await database.exec(
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

  await database.exec(
    'UPDATE discussions SET replies_count = replies_count + 1, last_reply_at = ? WHERE id = ?',
    [now, reply.discussionId],
  )

  const result = await database.query<DiscussionReplyRow>(
    'SELECT * FROM discussion_replies WHERE id = ?',
    [id],
  )
  return result.rows[0]
}

// ============================================================================
// CI RUNS
// ============================================================================

export async function listCIRuns(filter?: {
  repo?: string
  status?: string
  branch?: string
  page?: number
  limit?: number
}): Promise<{ runs: CIRunRow[]; total: number }> {
  const database = getDB()
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

  const countResult = await database.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM ci_runs ${whereClause}`,
    params,
  )
  const total = countResult.rows[0]?.count ?? 0

  const result = await database.query<CIRunRow>(
    `SELECT * FROM ci_runs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )

  return { runs: result.rows.map((r) => CIRunRowSchema.parse(r)), total }
}

export async function getCIRun(id: string): Promise<CIRunRow | null> {
  const database = getDB()
  const result = await database.query<CIRunRow>(
    'SELECT * FROM ci_runs WHERE id = ?',
    [id],
  )
  return result.rows[0] ? CIRunRowSchema.parse(result.rows[0]) : null
}

export async function createCIRun(run: {
  workflow: string
  repo: string
  branch: string
  commitSha?: string
  commitMessage?: string
  author?: string
}): Promise<CIRunRow> {
  const database = getDB()
  const id = generateId('run')
  const now = Date.now()

  await database.exec(
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

  const created = await getCIRun(id)
  if (!created) throw new Error(`Failed to create CI run ${id}`)
  return created
}

// ============================================================================
// AGENTS
// ============================================================================

export async function listAgents(filter?: {
  capability?: string
  active?: boolean
  owner?: string
}): Promise<AgentRow[]> {
  const database = getDB()
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
  const result = await database.query<AgentRow>(
    `SELECT * FROM agents ${whereClause} ORDER BY reputation DESC, created_at DESC`,
    params,
  )

  return result.rows.map((r) => AgentRowSchema.parse(r))
}

export async function getAgent(agentId: string): Promise<AgentRow | null> {
  const database = getDB()
  const result = await database.query<AgentRow>(
    'SELECT * FROM agents WHERE agent_id = ?',
    [agentId],
  )
  return result.rows[0] ? AgentRowSchema.parse(result.rows[0]) : null
}

export async function createAgent(agent: {
  agentId: string
  owner: string
  name: string
  botType: string
  characterCid?: string
  stateCid: string
  vaultAddress: string
  capabilities?: string[]
  specializations?: string[]
}): Promise<AgentRow> {
  const database = getDB()
  const id = generateId('agent')
  const now = Date.now()

  await database.exec(
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

  const created = await getAgent(agent.agentId)
  if (!created) throw new Error(`Failed to create agent ${agent.agentId}`)
  return created
}

// ============================================================================
// CONTAINERS
// ============================================================================

export async function listContainers(filter?: {
  org?: string
  name?: string
}): Promise<ContainerRow[]> {
  const database = getDB()
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
  const result = await database.query<ContainerRow>(
    `SELECT * FROM containers ${whereClause} ORDER BY created_at DESC`,
    params,
  )

  return result.rows.map((r) => ContainerRowSchema.parse(r))
}

export async function createContainer(container: {
  name: string
  tag: string
  digest: string
  size: number
  platform: string
  labels?: Record<string, string>
  owner: string
}): Promise<ContainerRow> {
  const database = getDB()
  const id = generateId('container')
  const now = Date.now()

  await database.exec(
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

  const result = await database.query<ContainerRow>(
    'SELECT * FROM containers WHERE id = ?',
    [id],
  )
  return ContainerRowSchema.parse(result.rows[0])
}

export async function getContainerInstance(
  id: string,
): Promise<ContainerInstanceRow | null> {
  const database = getDB()
  const result = await database.query<ContainerInstanceRow>(
    'SELECT * FROM container_instances WHERE id = ?',
    [id],
  )
  if (result.rows.length === 0) {
    return null
  }
  return ContainerInstanceRowSchema.parse(result.rows[0])
}

export async function listContainerInstances(filter?: {
  owner?: string
  status?: string
}): Promise<ContainerInstanceRow[]> {
  const database = getDB()
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
  const result = await database.query<ContainerInstanceRow>(
    `SELECT * FROM container_instances ${whereClause} ORDER BY created_at DESC`,
    params,
  )

  return result.rows.map((r) => ContainerInstanceRowSchema.parse(r))
}

export async function createContainerInstance(instance: {
  containerId: string
  name: string
  cpu: string
  memory: string
  gpu?: string
  owner: string
}): Promise<ContainerInstanceRow> {
  const database = getDB()
  const id = generateId('instance')
  const now = Date.now()

  await database.exec(
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

  const result = await database.query<ContainerInstanceRow>(
    'SELECT * FROM container_instances WHERE id = ?',
    [id],
  )
  return ContainerInstanceRowSchema.parse(result.rows[0])
}

export async function updateContainerInstanceStatus(
  id: string,
  status: string,
  endpoint?: string,
): Promise<boolean> {
  const database = getDB()
  const now = Date.now()
  const result = await database.exec(
    `UPDATE container_instances SET status = ?, endpoint = ?, started_at = CASE WHEN status = 'running' THEN ? ELSE started_at END WHERE id = ?`,
    [status, endpoint ?? null, now, id],
  )
  return result.rowsAffected > 0
}

// ============================================================================
// DATASETS
// ============================================================================

export async function listDatasets(filter?: {
  type?: string
  org?: string
}): Promise<DatasetRow[]> {
  const database = getDB()
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
  const result = await database.query<DatasetRow>(
    `SELECT * FROM datasets ${whereClause} ORDER BY downloads DESC, created_at DESC`,
    params,
  )

  return result.rows.map((r) => DatasetRowSchema.parse(r))
}

export async function createDataset(dataset: {
  name: string
  organization: string
  description: string
  type: 'text' | 'code' | 'image' | 'audio' | 'multimodal' | 'tabular'
  license: string
  owner: string
}): Promise<DatasetRow> {
  const database = getDB()
  const id = generateId('dataset')
  const now = Date.now()

  await database.exec(
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

  const result = await database.query<DatasetRow>(
    'SELECT * FROM datasets WHERE id = ?',
    [id],
  )
  return DatasetRowSchema.parse(result.rows[0])
}

// ============================================================================
// MODELS
// ============================================================================

export async function listModels(filter?: {
  type?: string
  org?: string
}): Promise<ModelRow[]> {
  const database = getDB()
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
  const result = await database.query<ModelRow>(
    `SELECT * FROM models ${whereClause} ORDER BY downloads DESC, created_at DESC`,
    params,
  )

  return result.rows.map((r) => ModelRowSchema.parse(r))
}

export async function getModel(
  org: string,
  name: string,
): Promise<ModelRow | null> {
  const database = getDB()
  const result = await database.query<ModelRow>(
    'SELECT * FROM models WHERE id = ?',
    [`${org}/${name}`],
  )
  return result.rows[0] ? ModelRowSchema.parse(result.rows[0]) : null
}

export async function createModel(model: {
  name: string
  organization: string
  description: string
  type: 'llm' | 'embedding' | 'image' | 'audio' | 'multimodal' | 'code'
  fileUri: string
  owner: string
}): Promise<ModelRow> {
  const database = getDB()
  const id = `${model.organization}/${model.name}`
  const now = Date.now()

  await database.exec(
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

  const created = await getModel(model.organization, model.name)
  if (!created)
    throw new Error(
      `Failed to create model ${model.organization}/${model.name}`,
    )
  return created
}

export async function starModel(org: string, name: string): Promise<boolean> {
  const database = getDB()
  const id = `${org}/${name}`
  const result = await database.exec(
    'UPDATE models SET stars = stars + 1, updated_at = ? WHERE id = ?',
    [Date.now(), id],
  )
  return result.rowsAffected > 0
}

// ============================================================================
// REPO SETTINGS
// ============================================================================

export async function getRepoSettings(
  owner: string,
  repo: string,
): Promise<RepoSettingsRow | null> {
  const database = getDB()
  const result = await database.query<RepoSettingsRow>(
    'SELECT * FROM repo_settings WHERE owner = ? AND repo = ?',
    [owner, repo],
  )
  return result.rows[0] ? RepoSettingsRowSchema.parse(result.rows[0]) : null
}

export async function upsertRepoSettings(
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
): Promise<RepoSettingsRow> {
  const database = getDB()
  const now = Date.now()
  const existing = await getRepoSettings(owner, repo)

  if (!existing) {
    await database.exec(
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
    await database.exec(
      `UPDATE repo_settings SET ${sets.join(', ')} WHERE owner = ? AND repo = ?`,
      params,
    )
  }

  const result = await getRepoSettings(owner, repo)
  if (!result) throw new Error(`Failed to get repo settings ${owner}/${repo}`)
  return result
}

export async function deleteRepoSettings(
  owner: string,
  repo: string,
): Promise<boolean> {
  const database = getDB()
  await database.exec(
    'DELETE FROM repo_collaborators WHERE owner = ? AND repo = ?',
    [owner, repo],
  )
  await database.exec(
    'DELETE FROM repo_webhooks WHERE owner = ? AND repo = ?',
    [owner, repo],
  )
  const result = await database.exec(
    'DELETE FROM repo_settings WHERE owner = ? AND repo = ?',
    [owner, repo],
  )
  return result.rowsAffected > 0
}

export async function getRepoCollaborators(
  owner: string,
  repo: string,
): Promise<CollaboratorRow[]> {
  const database = getDB()
  const result = await database.query<CollaboratorRow>(
    'SELECT * FROM repo_collaborators WHERE owner = ? AND repo = ?',
    [owner, repo],
  )
  return result.rows.map((r) => CollaboratorRowSchema.parse(r))
}

export async function addRepoCollaborator(
  owner: string,
  repo: string,
  collaborator: {
    login: string
    avatar: string
    permission: 'read' | 'write' | 'admin'
  },
): Promise<CollaboratorRow> {
  const database = getDB()
  const now = Date.now()

  await database.exec(
    `INSERT INTO repo_collaborators (owner, repo, login, avatar, permission, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner, repo, login) DO UPDATE SET avatar = excluded.avatar, permission = excluded.permission`,
    [
      owner,
      repo,
      collaborator.login,
      collaborator.avatar,
      collaborator.permission,
      now,
    ],
  )

  const result = await database.query<CollaboratorRow>(
    'SELECT * FROM repo_collaborators WHERE owner = ? AND repo = ? AND login = ?',
    [owner, repo, collaborator.login],
  )
  return CollaboratorRowSchema.parse(result.rows[0])
}

export async function removeRepoCollaborator(
  owner: string,
  repo: string,
  login: string,
): Promise<boolean> {
  const database = getDB()
  const result = await database.exec(
    'DELETE FROM repo_collaborators WHERE owner = ? AND repo = ? AND login = ?',
    [owner, repo, login],
  )
  return result.rowsAffected > 0
}

export async function getRepoWebhooks(
  owner: string,
  repo: string,
): Promise<WebhookRow[]> {
  const database = getDB()
  const result = await database.query<WebhookRow>(
    'SELECT * FROM repo_webhooks WHERE owner = ? AND repo = ?',
    [owner, repo],
  )
  return result.rows.map((r) => WebhookRowSchema.parse(r))
}

export async function addRepoWebhook(
  owner: string,
  repo: string,
  webhook: { url: string; events: string[] },
): Promise<WebhookRow> {
  const database = getDB()
  const id = generateId('webhook')
  const now = Date.now()

  await database.exec(
    `INSERT INTO repo_webhooks (id, owner, repo, url, events, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, owner, repo, webhook.url, toJSON(webhook.events), now],
  )

  const result = await database.query<WebhookRow>(
    'SELECT * FROM repo_webhooks WHERE id = ?',
    [id],
  )
  return WebhookRowSchema.parse(result.rows[0])
}

export async function removeRepoWebhook(id: string): Promise<boolean> {
  const database = getDB()
  const result = await database.exec('DELETE FROM repo_webhooks WHERE id = ?', [
    id,
  ])
  return result.rowsAffected > 0
}

// ============================================================================
// PACKAGE SETTINGS
// ============================================================================

export async function getPackageSettings(
  scope: string,
  name: string,
): Promise<PackageSettingsRow | null> {
  const database = getDB()
  const result = await database.query<PackageSettingsRow>(
    'SELECT * FROM package_settings WHERE scope = ? AND name = ?',
    [scope, name],
  )
  return result.rows[0] ? PackageSettingsRowSchema.parse(result.rows[0]) : null
}

export async function upsertPackageSettings(
  scope: string,
  name: string,
  settings: {
    description?: string
    visibility?: 'public' | 'private'
    publishEnabled?: boolean
  },
): Promise<PackageSettingsRow> {
  const database = getDB()
  const now = Date.now()
  const existing = await getPackageSettings(scope, name)

  if (!existing) {
    await database.exec(
      `INSERT INTO package_settings (scope, name, description, visibility, publish_enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
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
    await database.exec(
      `UPDATE package_settings SET ${sets.join(', ')} WHERE scope = ? AND name = ?`,
      params,
    )
  }

  const result = await getPackageSettings(scope, name)
  if (!result)
    throw new Error(`Failed to get package settings ${scope}/${name}`)
  return result
}

export async function deprecatePackage(
  scope: string,
  name: string,
  message: string,
): Promise<boolean> {
  const database = getDB()
  const result = await database.exec(
    'UPDATE package_settings SET deprecated = 1, deprecation_message = ?, updated_at = ? WHERE scope = ? AND name = ?',
    [message, Date.now(), scope, name],
  )
  return result.rowsAffected > 0
}

export async function undeprecatePackage(
  scope: string,
  name: string,
): Promise<boolean> {
  const database = getDB()
  const result = await database.exec(
    'UPDATE package_settings SET deprecated = 0, deprecation_message = NULL, updated_at = ? WHERE scope = ? AND name = ?',
    [Date.now(), scope, name],
  )
  return result.rowsAffected > 0
}

export async function getPackageMaintainers(
  scope: string,
  name: string,
): Promise<MaintainerRow[]> {
  const database = getDB()
  const result = await database.query<MaintainerRow>(
    'SELECT * FROM package_maintainers WHERE scope = ? AND name = ?',
    [scope, name],
  )
  return result.rows
}

export async function addPackageMaintainer(
  scope: string,
  name: string,
  maintainer: { login: string; avatar: string; role: 'owner' | 'maintainer' },
): Promise<MaintainerRow> {
  const database = getDB()
  const now = Date.now()

  await database.exec(
    `INSERT INTO package_maintainers (scope, name, login, avatar, role, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, name, login) DO UPDATE SET avatar = excluded.avatar, role = excluded.role`,
    [scope, name, maintainer.login, maintainer.avatar, maintainer.role, now],
  )

  const result = await database.query<MaintainerRow>(
    'SELECT * FROM package_maintainers WHERE scope = ? AND name = ? AND login = ?',
    [scope, name, maintainer.login],
  )
  return result.rows[0]
}

export async function removePackageMaintainer(
  scope: string,
  name: string,
  login: string,
): Promise<boolean> {
  const database = getDB()
  const result = await database.exec(
    'DELETE FROM package_maintainers WHERE scope = ? AND name = ? AND login = ?',
    [scope, name, login],
  )
  return result.rowsAffected > 0
}

export async function createPackageToken(
  scope: string,
  name: string,
  token: { tokenName: string; permissions: string[]; expiresAt?: number },
): Promise<{ row: PackageTokenRow; plainToken: string }> {
  const database = getDB()
  const id = generateId('token')
  const now = Date.now()
  const plainToken = `pkg_${id}_${Math.random().toString(36).slice(2)}`

  // Simple hash for demo - in production use proper crypto
  const tokenHash = `sha256:${Buffer.from(plainToken).toString('base64')}`

  await database.exec(
    `INSERT INTO package_tokens (id, scope, name, token_name, token_hash, permissions, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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

  const result = await database.query<PackageTokenRow>(
    'SELECT * FROM package_tokens WHERE id = ?',
    [id],
  )
  return { row: result.rows[0], plainToken }
}

export async function revokePackageToken(id: string): Promise<boolean> {
  const database = getDB()
  const result = await database.exec(
    'DELETE FROM package_tokens WHERE id = ?',
    [id],
  )
  return result.rowsAffected > 0
}

// ============================================================================
// FARCASTER
// ============================================================================

export async function getFidLink(address: string): Promise<FidLinkRow | null> {
  const database = getDB()
  const result = await database.query<FidLinkRow>(
    'SELECT * FROM fid_links WHERE address = ?',
    [address.toLowerCase()],
  )
  return result.rows[0] ? FidLinkRowSchema.parse(result.rows[0]) : null
}

export async function getFidLinkByFid(fid: number): Promise<FidLinkRow | null> {
  const database = getDB()
  const result = await database.query<FidLinkRow>(
    'SELECT * FROM fid_links WHERE fid = ?',
    [fid],
  )
  return result.rows[0] ? FidLinkRowSchema.parse(result.rows[0]) : null
}

export async function createFidLink(link: {
  address: string
  fid: number
  username?: string
  displayName?: string
  pfpUrl?: string
  bio?: string
}): Promise<FidLinkRow> {
  const database = getDB()
  const now = Date.now()

  await database.exec(
    `INSERT INTO fid_links (address, fid, username, display_name, pfp_url, bio, verified_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET fid = excluded.fid, username = excluded.username, display_name = excluded.display_name, pfp_url = excluded.pfp_url, bio = excluded.bio, updated_at = excluded.updated_at`,
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

  const created = await getFidLink(link.address)
  if (!created) throw new Error(`Failed to create FID link for ${link.address}`)
  return created
}

export async function deleteFidLink(address: string): Promise<boolean> {
  const database = getDB()
  const result = await database.exec(
    'DELETE FROM fid_links WHERE address = ?',
    [address.toLowerCase()],
  )
  return result.rowsAffected > 0
}

export async function getFarcasterSigner(
  address: string,
): Promise<FarcasterSignerRow | null> {
  const database = getDB()
  const result = await database.query<FarcasterSignerRow>(
    "SELECT * FROM farcaster_signers WHERE address = ? AND key_state = 'active' ORDER BY created_at DESC LIMIT 1",
    [address.toLowerCase()],
  )
  return result.rows[0] ? FarcasterSignerRowSchema.parse(result.rows[0]) : null
}

export async function getFarcasterSignerByPublicKey(
  publicKey: string,
): Promise<FarcasterSignerRow | null> {
  const database = getDB()
  const result = await database.query<FarcasterSignerRow>(
    'SELECT * FROM farcaster_signers WHERE signer_public_key = ?',
    [publicKey],
  )
  return result.rows[0] ? FarcasterSignerRowSchema.parse(result.rows[0]) : null
}

export async function listFarcasterSigners(
  address: string,
): Promise<FarcasterSignerRow[]> {
  const database = getDB()
  const result = await database.query<FarcasterSignerRow>(
    'SELECT * FROM farcaster_signers WHERE address = ? ORDER BY created_at DESC',
    [address.toLowerCase()],
  )
  return result.rows.map((r) => FarcasterSignerRowSchema.parse(r))
}

export async function createFarcasterSigner(signer: {
  address: string
  fid: number
  signerPublicKey: string
  encryptedPrivateKey: string
  encryptionIv: string
  deadline?: number
  signature?: string
}): Promise<FarcasterSignerRow> {
  const database = getDB()
  const id = generateId('signer')
  const now = Date.now()

  await database.exec(
    `INSERT INTO farcaster_signers (id, address, fid, signer_public_key, encrypted_private_key, encryption_iv, key_state, deadline, signature, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
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

  const result = await database.query<FarcasterSignerRow>(
    'SELECT * FROM farcaster_signers WHERE id = ?',
    [id],
  )
  return FarcasterSignerRowSchema.parse(result.rows[0])
}

export async function updateSignerState(
  id: string,
  state: 'pending' | 'active' | 'revoked',
): Promise<boolean> {
  const database = getDB()
  const result = await database.exec(
    'UPDATE farcaster_signers SET key_state = ?, updated_at = ? WHERE id = ?',
    [state, Date.now(), id],
  )
  return result.rowsAffected > 0
}

export async function activateSigner(
  publicKey: string,
  signature: string,
): Promise<boolean> {
  const database = getDB()
  const result = await database.exec(
    "UPDATE farcaster_signers SET key_state = 'active', signature = ?, updated_at = ? WHERE signer_public_key = ?",
    [signature, Date.now(), publicKey],
  )
  return result.rowsAffected > 0
}

export async function getProjectChannel(
  projectId: string,
): Promise<ProjectChannelRow | null> {
  const database = getDB()
  const result = await database.query<ProjectChannelRow>(
    'SELECT * FROM project_channels WHERE project_id = ?',
    [projectId],
  )
  return result.rows[0] ?? null
}

export async function setProjectChannel(
  projectId: string,
  channelId: string,
  channelUrl: string,
): Promise<ProjectChannelRow> {
  const database = getDB()
  const now = Date.now()

  await database.exec(
    `INSERT INTO project_channels (project_id, channel_id, channel_url, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET channel_id = excluded.channel_id, channel_url = excluded.channel_url`,
    [projectId, channelId, channelUrl, now],
  )

  const created = await getProjectChannel(projectId)
  if (!created)
    throw new Error(`Failed to set channel for project ${projectId}`)
  return created
}

export async function deleteProjectChannel(
  projectId: string,
): Promise<boolean> {
  const database = getDB()
  const result = await database.exec(
    'DELETE FROM project_channels WHERE project_id = ?',
    [projectId],
  )
  return result.rowsAffected > 0
}

export async function getCastReaction(
  address: string,
  castHash: string,
  reactionType: 'like' | 'recast',
): Promise<CastReactionRow | null> {
  const database = getDB()
  const result = await database.query<CastReactionRow>(
    'SELECT * FROM cast_reactions WHERE address = ? AND cast_hash = ? AND reaction_type = ?',
    [address.toLowerCase(), castHash, reactionType],
  )
  return result.rows[0] ?? null
}

export async function getUserReactionsForCasts(
  address: string,
  castHashes: string[],
): Promise<CastReactionRow[]> {
  if (castHashes.length === 0) return []
  const database = getDB()
  const placeholders = castHashes.map(() => '?').join(', ')
  const result = await database.query<CastReactionRow>(
    `SELECT * FROM cast_reactions WHERE address = ? AND cast_hash IN (${placeholders})`,
    [address.toLowerCase(), ...castHashes],
  )
  return result.rows
}

export async function createCastReaction(reaction: {
  address: string
  castHash: string
  castFid: number
  reactionType: 'like' | 'recast'
}): Promise<CastReactionRow> {
  const database = getDB()
  const id = generateId('reaction')
  const now = Date.now()

  await database.exec(
    `INSERT INTO cast_reactions (id, address, cast_hash, cast_fid, reaction_type, created_at) VALUES (?, ?, ?, ?, ?, ?)
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

  const row = await getCastReaction(
    reaction.address,
    reaction.castHash,
    reaction.reactionType,
  )
  if (!row) throw new Error('Failed to create cast reaction')
  return row
}

export async function deleteCastReaction(
  address: string,
  castHash: string,
  reactionType: 'like' | 'recast',
): Promise<boolean> {
  const database = getDB()
  const result = await database.exec(
    'DELETE FROM cast_reactions WHERE address = ? AND cast_hash = ? AND reaction_type = ?',
    [address.toLowerCase(), castHash, reactionType],
  )
  return result.rowsAffected > 0
}

// Sync compatibility aliases (for routes that haven't been updated yet)
export function closeDBSync() {
  console.warn(
    '[Factory] closeDBSync is deprecated - use async closeDB instead',
  )
}
