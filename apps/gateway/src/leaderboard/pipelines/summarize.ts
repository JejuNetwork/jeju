/**
 * AI Summary Generation Pipeline
 *
 * Generates natural language summaries of contributor and repository activity.
 * Uses OpenRouter or compatible LLM API.
 */

import { DWSChatCompletionResponseSchema } from '../../lib/validation.js'
import { LEADERBOARD_CONFIG } from '../config.js'
import { exec, initLeaderboardDB, query } from '../db.js'

export interface SummarizeOptions {
  /** Summary type: 'contributor', 'repository', or 'overall' */
  type: 'contributor' | 'repository' | 'overall'
  /** Specific username or repository */
  target?: string
  /** Interval: 'day', 'week', or 'month' */
  interval?: 'day' | 'week' | 'month'
  /** Start date */
  after?: string
  /** End date */
  before?: string
  /** Force regeneration */
  force?: boolean
  /** Enable verbose logging */
  verbose?: boolean
}

interface ActivitySummary {
  username?: string
  repoId?: string
  interval: string
  date: string
  prs: number
  mergedPrs: number
  issues: number
  commits: number
  reviews: number
  score: number
  highlights: string[]
}

/**
 * Run the summarize pipeline
 */
export async function runSummarize(options: SummarizeOptions): Promise<{
  summariesGenerated: number
  tokensUsed: number
}> {
  await initLeaderboardDB()

  const apiKey = LEADERBOARD_CONFIG.llm.openRouterApiKey
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY required for summarization')
  }

  const dateRange = calculateDateRange(options)
  const interval = options.interval || 'week'

  console.log(
    `[Summarize] Generating ${options.type} summaries (${interval}) from ${dateRange.after} to ${dateRange.before}`,
  )

  let summariesGenerated = 0
  let tokensUsed = 0

  switch (options.type) {
    case 'contributor': {
      const contribResult = await generateContributorSummaries(
        apiKey,
        dateRange,
        interval,
        options,
      )
      summariesGenerated = contribResult.count
      tokensUsed = contribResult.tokens
      break
    }
    case 'repository': {
      const repoResult = await generateRepositorySummaries(
        apiKey,
        dateRange,
        interval,
        options,
      )
      summariesGenerated = repoResult.count
      tokensUsed = repoResult.tokens
      break
    }
    case 'overall': {
      const overallResult = await generateOverallSummaries(
        apiKey,
        dateRange,
        interval,
        options,
      )
      summariesGenerated = overallResult.count
      tokensUsed = overallResult.tokens
      break
    }
  }

  console.log(
    `[Summarize] Completed: ${summariesGenerated} summaries, ${tokensUsed} tokens`,
  )

  return { summariesGenerated, tokensUsed }
}

function calculateDateRange(options: SummarizeOptions): {
  after: string
  before: string
} {
  if (options.after && options.before) {
    return { after: options.after, before: options.before }
  }

  const before = new Date()
  const after = new Date()

  switch (options.interval) {
    case 'day':
      after.setDate(after.getDate() - 7)
      break
    case 'month':
      after.setMonth(after.getMonth() - 3)
      break
    default: // week
      after.setDate(after.getDate() - 30)
  }

  return {
    after: options.after || after.toISOString().split('T')[0],
    before: options.before || before.toISOString().split('T')[0],
  }
}

async function generateContributorSummaries(
  apiKey: string,
  dateRange: { after: string; before: string },
  interval: string,
  options: SummarizeOptions,
): Promise<{ count: number; tokens: number }> {
  // Get active contributors
  const contributors = options.target
    ? [{ username: options.target }]
    : await query<{ username: string }>(
        `SELECT DISTINCT username FROM user_daily_scores
         WHERE date >= ? AND date <= ?
         ORDER BY SUM(score) DESC
         LIMIT 50`,
        [dateRange.after, dateRange.before],
      )

  let count = 0
  let tokens = 0

  for (const contrib of contributors) {
    const activity = await getContributorActivity(
      contrib.username,
      dateRange,
      interval,
    )

    if (activity.score === 0) continue

    // Check if summary exists
    const summaryId = `${contrib.username}_${interval}_${dateRange.before}`
    const existing = await query<{ id: string }>(
      'SELECT id FROM user_summaries WHERE id = ?',
      [summaryId],
    )

    if (existing.length > 0 && !options.force) {
      if (options.verbose) {
        console.log(`[Summarize] Skipping ${contrib.username} (exists)`)
      }
      continue
    }

    // Generate summary
    const summary = await callLLM(
      apiKey,
      buildContributorPrompt(contrib.username, activity),
    )
    tokens += summary.tokens

    // Store summary
    const now = new Date().toISOString()
    if (existing.length > 0) {
      await exec(
        `UPDATE user_summaries SET summary = ?, last_updated = ? WHERE id = ?`,
        [summary.text, now, summaryId],
      )
    } else {
      await exec(
        `INSERT INTO user_summaries (id, username, interval_type, date, summary, last_updated)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          summaryId,
          contrib.username,
          interval,
          dateRange.before,
          summary.text,
          now,
        ],
      )
    }

    count++
    if (options.verbose) {
      console.log(`[Summarize] Generated summary for ${contrib.username}`)
    }
  }

  return { count, tokens }
}

async function generateRepositorySummaries(
  apiKey: string,
  dateRange: { after: string; before: string },
  interval: string,
  options: SummarizeOptions,
): Promise<{ count: number; tokens: number }> {
  const repositories = options.target
    ? await query<{ repo_id: string; owner: string; name: string }>(
        'SELECT repo_id, owner, name FROM repositories WHERE repo_id = ?',
        [options.target],
      )
    : await query<{ repo_id: string; owner: string; name: string }>(
        'SELECT repo_id, owner, name FROM repositories',
      )

  let count = 0
  let tokens = 0

  for (const repo of repositories) {
    const activity = await getRepoActivity(repo.repo_id, dateRange, interval)

    if (activity.prs === 0 && activity.commits === 0) continue

    const summaryId = `${repo.repo_id}_${interval}_${dateRange.before}`
    const existing = await query<{ id: string }>(
      'SELECT id FROM repo_summaries WHERE id = ?',
      [summaryId],
    )

    if (existing.length > 0 && !options.force) {
      continue
    }

    const summary = await callLLM(
      apiKey,
      buildRepoPrompt(repo.repo_id, activity),
    )
    tokens += summary.tokens

    const now = new Date().toISOString()
    if (existing.length > 0) {
      await exec(
        `UPDATE repo_summaries SET summary = ?, last_updated = ? WHERE id = ?`,
        [summary.text, now, summaryId],
      )
    } else {
      await exec(
        `INSERT INTO repo_summaries (id, repo_id, interval_type, date, summary, last_updated)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          summaryId,
          repo.repo_id,
          interval,
          dateRange.before,
          summary.text,
          now,
        ],
      )
    }

    count++
    if (options.verbose) {
      console.log(`[Summarize] Generated summary for ${repo.repo_id}`)
    }
  }

  return { count, tokens }
}

async function generateOverallSummaries(
  apiKey: string,
  dateRange: { after: string; before: string },
  interval: string,
  options: SummarizeOptions,
): Promise<{ count: number; tokens: number }> {
  const summaryId = `overall_${interval}_${dateRange.before}`
  const existing = await query<{ id: string }>(
    'SELECT id FROM overall_summaries WHERE id = ?',
    [summaryId],
  )

  if (existing.length > 0 && !options.force) {
    return { count: 0, tokens: 0 }
  }

  // Get overall stats
  const stats = await getOverallStats(dateRange)
  const topContribs = await getTopContributorsForSummary(dateRange, 10)

  const summary = await callLLM(
    apiKey,
    buildOverallPrompt(stats, topContribs, dateRange, interval),
  )

  const now = new Date().toISOString()
  if (existing.length > 0) {
    await exec(
      `UPDATE overall_summaries SET summary = ?, last_updated = ? WHERE id = ?`,
      [summary.text, now, summaryId],
    )
  } else {
    await exec(
      `INSERT INTO overall_summaries (id, interval_type, date, summary, last_updated)
       VALUES (?, ?, ?, ?, ?)`,
      [summaryId, interval, dateRange.before, summary.text, now],
    )
  }

  return { count: 1, tokens: summary.tokens }
}

async function getContributorActivity(
  username: string,
  dateRange: { after: string; before: string },
  interval: string,
): Promise<ActivitySummary> {
  const scores = await query<{
    total_score: number
    pr_score: number
    issue_score: number
    review_score: number
  }>(
    `SELECT 
      SUM(score) as total_score,
      SUM(pr_score) as pr_score,
      SUM(issue_score) as issue_score,
      SUM(review_score) as review_score
     FROM user_daily_scores
     WHERE username = ? AND date >= ? AND date <= ?`,
    [username, dateRange.after, dateRange.before],
  )

  const prs = await query<{ count: number; merged: number }>(
    `SELECT COUNT(*) as count, SUM(CASE WHEN merged = 1 THEN 1 ELSE 0 END) as merged
     FROM raw_pull_requests
     WHERE author = ? AND DATE(created_at) >= ? AND DATE(created_at) <= ?`,
    [username, dateRange.after, dateRange.before],
  )

  const commits = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM raw_commits
     WHERE author = ? AND DATE(committed_date) >= ? AND DATE(committed_date) <= ?`,
    [username, dateRange.after, dateRange.before],
  )

  return {
    username,
    interval,
    date: dateRange.before,
    prs: prs[0]?.count || 0,
    mergedPrs: prs[0]?.merged || 0,
    issues: 0,
    commits: commits[0]?.count || 0,
    reviews: 0,
    score: scores[0]?.total_score || 0,
    highlights: [],
  }
}

async function getRepoActivity(
  repoId: string,
  dateRange: { after: string; before: string },
  interval: string,
): Promise<ActivitySummary> {
  const prs = await query<{ count: number; merged: number }>(
    `SELECT COUNT(*) as count, SUM(CASE WHEN merged = 1 THEN 1 ELSE 0 END) as merged
     FROM raw_pull_requests
     WHERE repository = ? AND DATE(created_at) >= ? AND DATE(created_at) <= ?`,
    [repoId, dateRange.after, dateRange.before],
  )

  const issues = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM raw_issues
     WHERE repository = ? AND DATE(created_at) >= ? AND DATE(created_at) <= ?`,
    [repoId, dateRange.after, dateRange.before],
  )

  const commits = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM raw_commits
     WHERE repository = ? AND DATE(committed_date) >= ? AND DATE(committed_date) <= ?`,
    [repoId, dateRange.after, dateRange.before],
  )

  return {
    repoId,
    interval,
    date: dateRange.before,
    prs: prs[0]?.count || 0,
    mergedPrs: prs[0]?.merged || 0,
    issues: issues[0]?.count || 0,
    commits: commits[0]?.count || 0,
    reviews: 0,
    score: 0,
    highlights: [],
  }
}

async function getOverallStats(dateRange: {
  after: string
  before: string
}): Promise<{
  prs: number
  mergedPrs: number
  issues: number
  commits: number
  contributors: number
}> {
  const prs = await query<{ count: number; merged: number }>(
    `SELECT COUNT(*) as count, SUM(CASE WHEN merged = 1 THEN 1 ELSE 0 END) as merged
     FROM raw_pull_requests WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?`,
    [dateRange.after, dateRange.before],
  )

  const issues = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM raw_issues
     WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?`,
    [dateRange.after, dateRange.before],
  )

  const commits = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM raw_commits
     WHERE DATE(committed_date) >= ? AND DATE(committed_date) <= ?`,
    [dateRange.after, dateRange.before],
  )

  const contributors = await query<{ count: number }>(
    `SELECT COUNT(DISTINCT username) as count FROM user_daily_scores
     WHERE date >= ? AND date <= ?`,
    [dateRange.after, dateRange.before],
  )

  return {
    prs: prs[0]?.count || 0,
    mergedPrs: prs[0]?.merged || 0,
    issues: issues[0]?.count || 0,
    commits: commits[0]?.count || 0,
    contributors: contributors[0]?.count || 0,
  }
}

async function getTopContributorsForSummary(
  dateRange: { after: string; before: string },
  limit: number,
): Promise<Array<{ username: string; score: number }>> {
  const result = await query<{ username: string; total_score: number }>(
    `SELECT username, SUM(score) as total_score
     FROM user_daily_scores
     WHERE date >= ? AND date <= ?
     GROUP BY username
     ORDER BY total_score DESC
     LIMIT ?`,
    [dateRange.after, dateRange.before, limit],
  )

  return result.map((r) => ({
    username: r.username,
    score: Math.round(r.total_score),
  }))
}

function buildContributorPrompt(
  username: string,
  activity: ActivitySummary,
): string {
  return `Generate a brief, professional summary (2-3 sentences) of ${username}'s GitHub contributions for this ${activity.interval}:

Activity:
- Pull Requests: ${activity.prs} opened, ${activity.mergedPrs} merged
- Commits: ${activity.commits}
- Contribution Score: ${Math.round(activity.score)}

Write a natural summary highlighting their key contributions. Be specific but concise.`
}

function buildRepoPrompt(repoId: string, activity: ActivitySummary): string {
  return `Generate a brief summary (2-3 sentences) of development activity in ${repoId} for this ${activity.interval}:

Activity:
- Pull Requests: ${activity.prs} opened, ${activity.mergedPrs} merged
- Issues: ${activity.issues}
- Commits: ${activity.commits}

Write a professional summary of the repository's development progress.`
}

function buildOverallPrompt(
  stats: {
    prs: number
    mergedPrs: number
    issues: number
    commits: number
    contributors: number
  },
  topContribs: Array<{ username: string; score: number }>,
  dateRange: { after: string; before: string },
  _interval: string,
): string {
  const topList = topContribs
    .slice(0, 5)
    .map((c, i) => `${i + 1}. ${c.username} (${c.score} pts)`)
    .join('\n')

  return `Generate a summary (3-4 sentences) of overall project activity from ${dateRange.after} to ${dateRange.before}:

Activity:
- Pull Requests: ${stats.prs} opened, ${stats.mergedPrs} merged
- Issues: ${stats.issues}
- Commits: ${stats.commits}
- Active Contributors: ${stats.contributors}

Top Contributors:
${topList}

Write a professional summary highlighting the most significant developments and top contributors.`
}

async function callLLM(
  _apiKey: string,
  prompt: string,
): Promise<{ text: string; tokens: number }> {
  // Route through DWS compute for decentralized inference
  const dwsUrl = process.env.DWS_URL || 'http://localhost:4030'

  const response = await fetch(`${dwsUrl}/compute/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: LEADERBOARD_CONFIG.llm.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.7,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`DWS inference error: ${response.status} - ${error}`)
  }

  const rawData = await response.json()
  const parseResult = DWSChatCompletionResponseSchema.safeParse(rawData)
  if (!parseResult.success) {
    throw new Error(
      `DWS inference returned invalid response: ${parseResult.error.message}`,
    )
  }

  return {
    text: parseResult.data.choices[0]?.message?.content || '',
    tokens: parseResult.data.usage?.total_tokens || 0,
  }
}
