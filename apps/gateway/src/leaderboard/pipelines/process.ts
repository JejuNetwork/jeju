/**
 * Contribution Processing Pipeline
 *
 * Calculates daily scores for contributors based on their activity.
 */

import { exec, initLeaderboardDB, query } from '../db.js'

export interface ProcessOptions {
  /** Specific repository to process */
  repository?: string
  /** Start date (YYYY-MM-DD) */
  after?: string
  /** End date (YYYY-MM-DD) */
  before?: string
  /** Number of days to process */
  days?: number
  /** Force recalculation */
  force?: boolean
  /** Enable verbose logging */
  verbose?: boolean
}

// Scoring weights
const WEIGHTS = {
  PR_OPENED: 50,
  PR_MERGED: 100,
  PR_REVIEW_APPROVED: 30,
  PR_REVIEW_CHANGES: 20,
  PR_REVIEW_COMMENT: 10,
  ISSUE_OPENED: 20,
  ISSUE_CLOSED: 10,
  COMMIT: 5,
  LINES_ADDED: 0.1,
  LINES_DELETED: 0.05,
}

interface DailyActivity {
  username: string
  date: string
  prsOpened: number
  prsMerged: number
  prReviewsApproved: number
  prReviewsChanges: number
  prReviewsComment: number
  issuesOpened: number
  issuesClosed: number
  commits: number
  linesAdded: number
  linesDeleted: number
}

/**
 * Run the processing pipeline
 */
export async function runProcess(options: ProcessOptions = {}): Promise<{
  daysProcessed: number
  usersProcessed: number
  scoresUpdated: number
}> {
  await initLeaderboardDB()

  const dateRange = calculateDateRange(options)

  console.log(
    `[Process] Processing contributions from ${dateRange.after || 'all'} to ${dateRange.before || 'now'}`,
  )

  // Get all dates in range that have activity
  const dates = await getActivityDates(dateRange, options.repository)
  console.log(`[Process] Found ${dates.length} days with activity`)

  let scoresUpdated = 0
  const usersProcessed = new Set<string>()

  for (const date of dates) {
    if (options.verbose) {
      console.log(`[Process] Processing ${date}...`)
    }

    // Get activity for each user on this date
    const activities = await getDailyActivities(date, options.repository)

    for (const activity of activities) {
      usersProcessed.add(activity.username)

      // Calculate scores
      const prScore = calculatePRScore(activity)
      const issueScore = calculateIssueScore(activity)
      const reviewScore = calculateReviewScore(activity)
      const commitScore = calculateCommitScore(activity)
      const totalScore = prScore + issueScore + reviewScore + commitScore

      // Store daily score
      const scoreId = `${activity.username}_${date}_day`
      const existing = await query<{ id: string }>(
        'SELECT id FROM user_daily_scores WHERE id = ?',
        [scoreId],
      )

      const now = new Date().toISOString()
      const metrics = JSON.stringify({
        prsOpened: activity.prsOpened,
        prsMerged: activity.prsMerged,
        reviews:
          activity.prReviewsApproved +
          activity.prReviewsChanges +
          activity.prReviewsComment,
        issuesOpened: activity.issuesOpened,
        commits: activity.commits,
        linesAdded: activity.linesAdded,
        linesDeleted: activity.linesDeleted,
      })

      if (existing.length > 0 && !options.force) {
        continue // Skip if already calculated
      }

      if (existing.length > 0) {
        await exec(
          `UPDATE user_daily_scores SET
            score = ?, pr_score = ?, issue_score = ?, review_score = ?, comment_score = ?,
            metrics = ?, last_updated = ?
           WHERE id = ?`,
          [
            totalScore,
            prScore,
            issueScore,
            reviewScore,
            commitScore,
            metrics,
            now,
            scoreId,
          ],
        )
      } else {
        await exec(
          `INSERT INTO user_daily_scores (
            id, username, date, score, pr_score, issue_score, review_score, comment_score,
            metrics, category, timestamp, last_updated
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'day', ?, ?)`,
          [
            scoreId,
            activity.username,
            date,
            totalScore,
            prScore,
            issueScore,
            reviewScore,
            commitScore,
            metrics,
            now,
            now,
          ],
        )
      }
      scoresUpdated++
    }
  }

  console.log(
    `[Process] Completed: ${dates.length} days, ${usersProcessed.size} users, ${scoresUpdated} scores`,
  )

  return {
    daysProcessed: dates.length,
    usersProcessed: usersProcessed.size,
    scoresUpdated,
  }
}

function calculateDateRange(options: ProcessOptions): {
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

  // Default: last 30 days
  const before = new Date()
  const after = new Date()
  after.setDate(after.getDate() - 30)
  return {
    after: after.toISOString().split('T')[0],
    before: before.toISOString().split('T')[0],
  }
}

async function getActivityDates(
  dateRange: { after?: string; before?: string },
  repository?: string,
): Promise<string[]> {
  const repoFilter = repository ? 'AND repository = ?' : ''
  const params: string[] = []

  if (dateRange.after) params.push(dateRange.after)
  if (dateRange.before) params.push(dateRange.before)
  if (repository) params.push(repository)

  // Get dates from PRs
  const prDates = await query<{ date: string }>(
    `SELECT DISTINCT DATE(created_at) as date FROM raw_pull_requests
     WHERE 1=1 ${dateRange.after ? 'AND DATE(created_at) >= ?' : ''} 
           ${dateRange.before ? 'AND DATE(created_at) <= ?' : ''} 
           ${repoFilter}`,
    params,
  )

  // Get dates from issues
  params.length = 0
  if (dateRange.after) params.push(dateRange.after)
  if (dateRange.before) params.push(dateRange.before)
  if (repository) params.push(repository)

  const issueDates = await query<{ date: string }>(
    `SELECT DISTINCT DATE(created_at) as date FROM raw_issues
     WHERE 1=1 ${dateRange.after ? 'AND DATE(created_at) >= ?' : ''} 
           ${dateRange.before ? 'AND DATE(created_at) <= ?' : ''} 
           ${repoFilter}`,
    params,
  )

  // Get dates from commits
  params.length = 0
  if (dateRange.after) params.push(dateRange.after)
  if (dateRange.before) params.push(dateRange.before)
  if (repository) params.push(repository)

  const commitDates = await query<{ date: string }>(
    `SELECT DISTINCT DATE(committed_date) as date FROM raw_commits
     WHERE 1=1 ${dateRange.after ? 'AND DATE(committed_date) >= ?' : ''} 
           ${dateRange.before ? 'AND DATE(committed_date) <= ?' : ''} 
           ${repoFilter}`,
    params,
  )

  const allDates = new Set([
    ...prDates.map((d) => d.date),
    ...issueDates.map((d) => d.date),
    ...commitDates.map((d) => d.date),
  ])

  return Array.from(allDates).sort()
}

async function getDailyActivities(
  date: string,
  repository?: string,
): Promise<DailyActivity[]> {
  const repoFilter = repository ? 'AND repository = ?' : ''
  const users = new Map<string, DailyActivity>()

  // Get PR activity
  const prParams = [date, date]
  if (repository) prParams.push(repository)

  const prActivity = await query<{
    author: string
    opened: number
    merged: number
    additions: number
    deletions: number
  }>(
    `SELECT author, 
            COUNT(*) as opened,
            SUM(CASE WHEN merged = 1 THEN 1 ELSE 0 END) as merged,
            SUM(additions) as additions,
            SUM(deletions) as deletions
     FROM raw_pull_requests
     WHERE DATE(created_at) = ? ${repoFilter}
     GROUP BY author`,
    [date, ...(repository ? [repository] : [])],
  )

  for (const pr of prActivity) {
    if (!users.has(pr.author)) {
      users.set(pr.author, createEmptyActivity(pr.author, date))
    }
    const activity = users.get(pr.author)
    if (!activity) continue
    activity.prsOpened = pr.opened
    activity.prsMerged = pr.merged
    activity.linesAdded += pr.additions
    activity.linesDeleted += pr.deletions
  }

  // Get issue activity
  const issueActivity = await query<{
    author: string
    opened: number
  }>(
    `SELECT author, COUNT(*) as opened
     FROM raw_issues
     WHERE DATE(created_at) = ? ${repoFilter}
     GROUP BY author`,
    [date, ...(repository ? [repository] : [])],
  )

  for (const issue of issueActivity) {
    if (!users.has(issue.author)) {
      users.set(issue.author, createEmptyActivity(issue.author, date))
    }
    const activity = users.get(issue.author)
    if (activity) activity.issuesOpened = issue.opened
  }

  // Get commit activity
  const commitActivity = await query<{
    author: string
    commits: number
    additions: number
    deletions: number
  }>(
    `SELECT author, COUNT(*) as commits,
            SUM(additions) as additions,
            SUM(deletions) as deletions
     FROM raw_commits
     WHERE author IS NOT NULL AND DATE(committed_date) = ? ${repoFilter}
     GROUP BY author`,
    [date, ...(repository ? [repository] : [])],
  )

  for (const commit of commitActivity) {
    if (!commit.author) continue
    if (!users.has(commit.author)) {
      users.set(commit.author, createEmptyActivity(commit.author, date))
    }
    const activity = users.get(commit.author)
    if (!activity) continue
    activity.commits = commit.commits
    activity.linesAdded += commit.additions
    activity.linesDeleted += commit.deletions
  }

  // Get review activity
  const reviewActivity = await query<{
    author: string
    approved: number
    changes: number
    commented: number
  }>(
    `SELECT author,
            SUM(CASE WHEN state = 'APPROVED' THEN 1 ELSE 0 END) as approved,
            SUM(CASE WHEN state = 'CHANGES_REQUESTED' THEN 1 ELSE 0 END) as changes,
            SUM(CASE WHEN state = 'COMMENTED' THEN 1 ELSE 0 END) as commented
     FROM pr_reviews
     WHERE author IS NOT NULL AND DATE(created_at) = ?
     GROUP BY author`,
    [date],
  )

  for (const review of reviewActivity) {
    if (!review.author) continue
    if (!users.has(review.author)) {
      users.set(review.author, createEmptyActivity(review.author, date))
    }
    const activity = users.get(review.author)
    if (!activity) continue
    activity.prReviewsApproved = review.approved
    activity.prReviewsChanges = review.changes
    activity.prReviewsComment = review.commented
  }

  return Array.from(users.values())
}

function createEmptyActivity(username: string, date: string): DailyActivity {
  return {
    username,
    date,
    prsOpened: 0,
    prsMerged: 0,
    prReviewsApproved: 0,
    prReviewsChanges: 0,
    prReviewsComment: 0,
    issuesOpened: 0,
    issuesClosed: 0,
    commits: 0,
    linesAdded: 0,
    linesDeleted: 0,
  }
}

function calculatePRScore(activity: DailyActivity): number {
  return (
    activity.prsOpened * WEIGHTS.PR_OPENED +
    activity.prsMerged * WEIGHTS.PR_MERGED +
    activity.linesAdded * WEIGHTS.LINES_ADDED +
    activity.linesDeleted * WEIGHTS.LINES_DELETED
  )
}

function calculateIssueScore(activity: DailyActivity): number {
  return (
    activity.issuesOpened * WEIGHTS.ISSUE_OPENED +
    activity.issuesClosed * WEIGHTS.ISSUE_CLOSED
  )
}

function calculateReviewScore(activity: DailyActivity): number {
  return (
    activity.prReviewsApproved * WEIGHTS.PR_REVIEW_APPROVED +
    activity.prReviewsChanges * WEIGHTS.PR_REVIEW_CHANGES +
    activity.prReviewsComment * WEIGHTS.PR_REVIEW_COMMENT
  )
}

function calculateCommitScore(activity: DailyActivity): number {
  return activity.commits * WEIGHTS.COMMIT
}
