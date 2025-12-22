/**
 * GitHub Data Ingestion Pipeline
 *
 * Fetches PRs, issues, and commits from GitHub and stores in CQL database.
 * Uses DWS for large file exports.
 */

import { LEADERBOARD_CONFIG } from '../config.js'
import { exec, initLeaderboardDB, query } from '../db.js'

export interface IngestOptions {
  /** Specific repository (owner/name) to ingest */
  repository?: string
  /** Start date (YYYY-MM-DD) */
  after?: string
  /** End date (YYYY-MM-DD) */
  before?: string
  /** Number of days to look back */
  days?: number
  /** Force re-ingestion even if data exists */
  force?: boolean
  /** Enable verbose logging */
  verbose?: boolean
}

interface GitHubPullRequest {
  id: string
  number: number
  title: string
  body: string
  state: string
  merged: boolean
  author: { login: string }
  createdAt: string
  updatedAt: string
  closedAt: string | null
  mergedAt: string | null
  repository: { nameWithOwner: string }
  headRefOid: string
  baseRefOid: string
  additions: number
  deletions: number
  changedFiles: number
}

interface GitHubIssue {
  id: string
  number: number
  title: string
  body: string
  state: string
  locked: boolean
  author: { login: string }
  createdAt: string
  updatedAt: string
  closedAt: string | null
  repository: { nameWithOwner: string }
}

interface GitHubCommit {
  oid: string
  message: string
  messageHeadline: string
  committedDate: string
  author: {
    name: string
    email: string
    date: string
    user?: { login: string }
  }
  additions: number
  deletions: number
  changedFilesIfAvailable: number
}

/**
 * Run the ingestion pipeline
 */
export async function runIngest(options: IngestOptions = {}): Promise<{
  prs: number
  issues: number
  commits: number
  users: number
}> {
  await initLeaderboardDB()

  const token = LEADERBOARD_CONFIG.github.token
  if (!token) {
    throw new Error('GITHUB_TOKEN required for ingestion')
  }

  const repositories = options.repository
    ? [options.repository]
    : LEADERBOARD_CONFIG.github.repositories

  const dateRange = calculateDateRange(options)

  console.log(
    `[Ingest] Starting ingestion for ${repositories.length} repositories`,
  )
  console.log(
    `[Ingest] Date range: ${dateRange.after || 'all'} to ${dateRange.before || 'now'}`,
  )

  let totalPrs = 0
  let totalIssues = 0
  let totalCommits = 0
  const usersSet = new Set<string>()

  for (const repo of repositories) {
    const [owner, name] = repo.split('/')
    if (!owner || !name) {
      console.warn(`[Ingest] Invalid repository format: ${repo}, skipping`)
      continue
    }

    console.log(`[Ingest] Processing ${repo}...`)

    // Ensure repository exists
    await ensureRepository(owner, name)

    // Fetch and store data
    const prs = await fetchAndStorePullRequests(
      token,
      owner,
      name,
      dateRange,
      options.verbose,
    )
    const issues = await fetchAndStoreIssues(
      token,
      owner,
      name,
      dateRange,
      options.verbose,
    )
    const commits = await fetchAndStoreCommits(
      token,
      owner,
      name,
      dateRange,
      options.verbose,
    )

    totalPrs += prs.count
    totalIssues += issues.count
    totalCommits += commits.count

    prs.users.forEach((u) => usersSet.add(u))
    issues.users.forEach((u) => usersSet.add(u))
    commits.users.forEach((u) => usersSet.add(u))
  }

  console.log(
    `[Ingest] Completed: ${totalPrs} PRs, ${totalIssues} issues, ${totalCommits} commits`,
  )
  console.log(`[Ingest] Users: ${usersSet.size} unique contributors`)

  return {
    prs: totalPrs,
    issues: totalIssues,
    commits: totalCommits,
    users: usersSet.size,
  }
}

function calculateDateRange(options: IngestOptions): {
  after?: string
  before?: string
} {
  if (options.after || options.before) {
    return { after: options.after, before: options.before }
  }

  if (options.days) {
    const before = new Date()
    const after = new Date()
    after.setDate(after.getDate() - options.days)
    return {
      after: after.toISOString().split('T')[0],
      before: before.toISOString().split('T')[0],
    }
  }

  // Default: last 7 days
  const before = new Date()
  const after = new Date()
  after.setDate(after.getDate() - 7)
  return {
    after: after.toISOString().split('T')[0],
    before: before.toISOString().split('T')[0],
  }
}

async function ensureRepository(owner: string, name: string): Promise<void> {
  const repoId = `${owner}/${name}`
  const existing = await query<{ repo_id: string }>(
    'SELECT repo_id FROM repositories WHERE repo_id = ?',
    [repoId],
  )

  if (existing.length === 0) {
    await exec(
      `INSERT INTO repositories (repo_id, owner, name, last_updated)
       VALUES (?, ?, ?, ?)`,
      [repoId, owner, name, new Date().toISOString()],
    )
  }
}

async function fetchAndStorePullRequests(
  token: string,
  owner: string,
  name: string,
  dateRange: { after?: string; before?: string },
  verbose?: boolean,
): Promise<{ count: number; users: string[] }> {
  const repoId = `${owner}/${name}`
  const users: string[] = []
  let count = 0
  let cursor: string | null = null
  let hasNextPage = true

  while (hasNextPage) {
    const graphqlQuery = `
      query($owner: String!, $name: String!, $cursor: String) {
        repository(owner: $owner, name: $name) {
          pullRequests(first: 100, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
            pageInfo { hasNextPage, endCursor }
            nodes {
              id
              number
              title
              body
              state
              merged
              author { login }
              createdAt
              updatedAt
              closedAt
              mergedAt
              headRefOid
              baseRefOid
              additions
              deletions
              changedFiles
            }
          }
        }
      }
    `

    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: graphqlQuery,
        variables: { owner, name, cursor },
      }),
    })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const data = (await response.json()) as {
      data: {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: boolean; endCursor: string }
            nodes: GitHubPullRequest[]
          }
        }
      }
    }

    const prs = data.data.repository.pullRequests
    hasNextPage = prs.pageInfo.hasNextPage
    cursor = prs.pageInfo.endCursor

    for (const pr of prs.nodes) {
      if (!pr.author?.login) continue

      // Check date range
      const createdAt = pr.createdAt.split('T')[0]
      if (dateRange.after && createdAt < dateRange.after) {
        hasNextPage = false
        break
      }
      if (dateRange.before && createdAt > dateRange.before) continue

      // Ensure user exists
      await ensureUser(pr.author.login)
      users.push(pr.author.login)

      // Upsert PR
      const now = new Date().toISOString()
      await exec(
        `INSERT OR REPLACE INTO raw_pull_requests (
          id, number, title, body, state, merged, author, 
          created_at, updated_at, closed_at, merged_at, repository,
          head_ref_oid, base_ref_oid, additions, deletions, changed_files, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pr.id,
          pr.number,
          pr.title,
          pr.body || '',
          pr.state,
          pr.merged ? 1 : 0,
          pr.author.login,
          pr.createdAt,
          pr.updatedAt,
          pr.closedAt,
          pr.mergedAt,
          repoId,
          pr.headRefOid,
          pr.baseRefOid,
          pr.additions,
          pr.deletions,
          pr.changedFiles,
          now,
        ],
      )
      count++
    }

    if (verbose) {
      console.log(`[Ingest] Fetched ${count} PRs so far...`)
    }
  }

  return { count, users }
}

async function fetchAndStoreIssues(
  token: string,
  owner: string,
  name: string,
  dateRange: { after?: string; before?: string },
  verbose?: boolean,
): Promise<{ count: number; users: string[] }> {
  const repoId = `${owner}/${name}`
  const users: string[] = []
  let count = 0
  let cursor: string | null = null
  let hasNextPage = true

  while (hasNextPage) {
    const graphqlQuery = `
      query($owner: String!, $name: String!, $cursor: String) {
        repository(owner: $owner, name: $name) {
          issues(first: 100, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
            pageInfo { hasNextPage, endCursor }
            nodes {
              id
              number
              title
              body
              state
              locked
              author { login }
              createdAt
              updatedAt
              closedAt
            }
          }
        }
      }
    `

    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: graphqlQuery,
        variables: { owner, name, cursor },
      }),
    })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const data = (await response.json()) as {
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: boolean; endCursor: string }
            nodes: GitHubIssue[]
          }
        }
      }
    }

    const issues = data.data.repository.issues
    hasNextPage = issues.pageInfo.hasNextPage
    cursor = issues.pageInfo.endCursor

    for (const issue of issues.nodes) {
      if (!issue.author?.login) continue

      const createdAt = issue.createdAt.split('T')[0]
      if (dateRange.after && createdAt < dateRange.after) {
        hasNextPage = false
        break
      }
      if (dateRange.before && createdAt > dateRange.before) continue

      await ensureUser(issue.author.login)
      users.push(issue.author.login)

      const now = new Date().toISOString()
      await exec(
        `INSERT OR REPLACE INTO raw_issues (
          id, number, title, body, state, locked, author,
          created_at, updated_at, closed_at, repository, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          issue.id,
          issue.number,
          issue.title,
          issue.body || '',
          issue.state,
          issue.locked ? 1 : 0,
          issue.author.login,
          issue.createdAt,
          issue.updatedAt,
          issue.closedAt,
          repoId,
          now,
        ],
      )
      count++
    }

    if (verbose) {
      console.log(`[Ingest] Fetched ${count} issues so far...`)
    }
  }

  return { count, users }
}

async function fetchAndStoreCommits(
  token: string,
  owner: string,
  name: string,
  dateRange: { after?: string; before?: string },
  verbose?: boolean,
): Promise<{ count: number; users: string[] }> {
  const repoId = `${owner}/${name}`
  const users: string[] = []
  let count = 0
  let cursor: string | null = null
  let hasNextPage = true

  while (hasNextPage) {
    const graphqlQuery = `
      query($owner: String!, $name: String!, $cursor: String, $since: GitTimestamp) {
        repository(owner: $owner, name: $name) {
          defaultBranchRef {
            target {
              ... on Commit {
                history(first: 100, after: $cursor, since: $since) {
                  pageInfo { hasNextPage, endCursor }
                  nodes {
                    oid
                    message
                    messageHeadline
                    committedDate
                    additions
                    deletions
                    changedFilesIfAvailable
                    author {
                      name
                      email
                      date
                      user { login }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `

    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: graphqlQuery,
        variables: {
          owner,
          name,
          cursor,
          since: dateRange.after ? `${dateRange.after}T00:00:00Z` : null,
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const data = (await response.json()) as {
      data: {
        repository: {
          defaultBranchRef: {
            target: {
              history: {
                pageInfo: { hasNextPage: boolean; endCursor: string }
                nodes: GitHubCommit[]
              }
            }
          }
        }
      }
    }

    const history = data.data.repository?.defaultBranchRef?.target?.history
    if (!history) {
      hasNextPage = false
      break
    }

    hasNextPage = history.pageInfo.hasNextPage
    cursor = history.pageInfo.endCursor

    for (const commit of history.nodes) {
      const committedDate = commit.committedDate.split('T')[0]
      if (dateRange.before && committedDate > dateRange.before) continue

      const username = commit.author.user?.login
      if (username) {
        await ensureUser(username)
        users.push(username)
      }

      const now = new Date().toISOString()
      await exec(
        `INSERT OR REPLACE INTO raw_commits (
          oid, message, message_headline, committed_date,
          author_name, author_email, author_date, author, repository,
          additions, deletions, changed_files, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          commit.oid,
          commit.message,
          commit.messageHeadline,
          commit.committedDate,
          commit.author.name,
          commit.author.email,
          commit.author.date,
          username || null,
          repoId,
          commit.additions,
          commit.deletions,
          commit.changedFilesIfAvailable || 0,
          now,
        ],
      )
      count++
    }

    if (verbose) {
      console.log(`[Ingest] Fetched ${count} commits so far...`)
    }
  }

  return { count, users }
}

async function ensureUser(username: string): Promise<void> {
  const existing = await query<{ username: string }>(
    'SELECT username FROM users WHERE username = ?',
    [username],
  )

  if (existing.length === 0) {
    // Fetch avatar URL from GitHub - fail-fast on errors
    const response = await fetch(`https://api.github.com/users/${username}`)
    const avatarUrl = response.ok
      ? ((await response.json()) as { avatar_url: string }).avatar_url
      : ''

    await exec(
      `INSERT OR IGNORE INTO users (username, avatar_url, is_bot, last_updated)
       VALUES (?, ?, 0, ?)`,
      [username, avatarUrl, new Date().toISOString()],
    )
  }
}
