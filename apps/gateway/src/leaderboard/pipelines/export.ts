/**
 * Stats Export Pipeline
 * 
 * Exports repository and contributor stats to DWS storage.
 */

import { query, initLeaderboardDB } from '../db.js';
import { LEADERBOARD_CONFIG } from '../config.js';
import { createDWSSDK } from '@jejunetwork/dws/sdk';

export interface ExportOptions {
  /** Specific repository to export */
  repository?: string;
  /** Output directory */
  outputDir?: string;
  /** Upload to DWS storage */
  uploadToDWS?: boolean;
  /** Start date */
  after?: string;
  /** End date */
  before?: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

interface RepoStats {
  repoId: string;
  owner: string;
  name: string;
  period: { start: string; end: string };
  totalPRs: number;
  mergedPRs: number;
  totalIssues: number;
  closedIssues: number;
  totalCommits: number;
  contributors: number;
  linesAdded: number;
  linesDeleted: number;
  topContributors: Array<{ username: string; score: number }>;
}

interface LeaderboardExport {
  generatedAt: string;
  period: { start: string; end: string };
  repositories: RepoStats[];
  topContributors: Array<{
    rank: number;
    username: string;
    avatarUrl: string;
    totalScore: number;
    breakdown: {
      prScore: number;
      issueScore: number;
      reviewScore: number;
      commitScore: number;
    };
  }>;
}

/**
 * Run the export pipeline
 */
export async function runExport(options: ExportOptions = {}): Promise<{
  exported: number;
  uploadedToDWS: boolean;
  cid?: string;
}> {
  await initLeaderboardDB();

  const dateRange = calculateDateRange(options);
  console.log(`[Export] Generating stats from ${dateRange.after} to ${dateRange.before}`);

  // Get all repositories or specific one
  const repositories = options.repository
    ? await query<{ repo_id: string; owner: string; name: string }>(
        'SELECT repo_id, owner, name FROM repositories WHERE repo_id = ?',
        [options.repository]
      )
    : await query<{ repo_id: string; owner: string; name: string }>(
        'SELECT repo_id, owner, name FROM repositories'
      );

  const repoStats: RepoStats[] = [];

  for (const repo of repositories) {
    if (options.verbose) {
      console.log(`[Export] Processing ${repo.repo_id}...`);
    }

    const stats = await getRepoStats(repo.repo_id, repo.owner, repo.name, dateRange);
    repoStats.push(stats);
  }

  // Get top contributors
  const topContributors = await getTopContributors(dateRange, 100);

  const exportData: LeaderboardExport = {
    generatedAt: new Date().toISOString(),
    period: { start: dateRange.after, end: dateRange.before },
    repositories: repoStats,
    topContributors,
  };

  // Write to local file
  const outputDir = options.outputDir || LEADERBOARD_CONFIG.storage.dataDir;
  const filename = `leaderboard-${dateRange.after}-${dateRange.before}.json`;
  const filepath = `${outputDir}/${filename}`;

  await Bun.write(filepath, JSON.stringify(exportData, null, 2));
  console.log(`[Export] Written to ${filepath}`);

  // Upload to DWS if requested
  let cid: string | undefined;
  if (options.uploadToDWS) {
    const dws = createDWSSDK({
      baseUrl: LEADERBOARD_CONFIG.storage.dwsApiUrl,
    });

    const blob = new Blob([JSON.stringify(exportData)], { type: 'application/json' });
    const file = new File([blob], filename, { type: 'application/json' });
    const result = await dws.uploadFile(file, { filename, permanent: false });
    cid = result.cid;
    console.log(`[Export] Uploaded to DWS: ${cid}`);
  }

  console.log(`[Export] Completed: ${repoStats.length} repositories`);

  return {
    exported: repoStats.length,
    uploadedToDWS: Boolean(cid),
    cid,
  };
}

function calculateDateRange(options: ExportOptions): { after: string; before: string } {
  if (options.after && options.before) {
    return { after: options.after, before: options.before };
  }

  // Default: last 30 days
  const before = new Date();
  const after = new Date();
  after.setDate(after.getDate() - 30);
  
  return {
    after: options.after || after.toISOString().split('T')[0],
    before: options.before || before.toISOString().split('T')[0],
  };
}

async function getRepoStats(
  repoId: string,
  owner: string,
  name: string,
  dateRange: { after: string; before: string }
): Promise<RepoStats> {
  // PR stats
  const prStats = await query<{
    total: number;
    merged: number;
    additions: number;
    deletions: number;
  }>(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN merged = 1 THEN 1 ELSE 0 END) as merged,
      SUM(additions) as additions,
      SUM(deletions) as deletions
     FROM raw_pull_requests
     WHERE repository = ? AND DATE(created_at) >= ? AND DATE(created_at) <= ?`,
    [repoId, dateRange.after, dateRange.before]
  );

  // Issue stats
  const issueStats = await query<{ total: number; closed: number }>(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN state = 'CLOSED' THEN 1 ELSE 0 END) as closed
     FROM raw_issues
     WHERE repository = ? AND DATE(created_at) >= ? AND DATE(created_at) <= ?`,
    [repoId, dateRange.after, dateRange.before]
  );

  // Commit stats
  const commitStats = await query<{ total: number }>(
    `SELECT COUNT(*) as total FROM raw_commits
     WHERE repository = ? AND DATE(committed_date) >= ? AND DATE(committed_date) <= ?`,
    [repoId, dateRange.after, dateRange.before]
  );

  // Unique contributors
  const contributorCount = await query<{ count: number }>(
    `SELECT COUNT(DISTINCT author) as count FROM (
      SELECT author FROM raw_pull_requests WHERE repository = ? AND DATE(created_at) >= ? AND DATE(created_at) <= ?
      UNION ALL
      SELECT author FROM raw_issues WHERE repository = ? AND DATE(created_at) >= ? AND DATE(created_at) <= ?
      UNION ALL
      SELECT author FROM raw_commits WHERE repository = ? AND DATE(committed_date) >= ? AND DATE(committed_date) <= ? AND author IS NOT NULL
    )`,
    [repoId, dateRange.after, dateRange.before,
     repoId, dateRange.after, dateRange.before,
     repoId, dateRange.after, dateRange.before]
  );

  // Top contributors for this repo
  const topContribs = await query<{ username: string; total_score: number }>(
    `SELECT username, SUM(score) as total_score
     FROM user_daily_scores
     WHERE date >= ? AND date <= ?
     GROUP BY username
     ORDER BY total_score DESC
     LIMIT 10`,
    [dateRange.after, dateRange.before]
  );

  return {
    repoId,
    owner,
    name,
    period: { start: dateRange.after, end: dateRange.before },
    totalPRs: prStats[0]?.total || 0,
    mergedPRs: prStats[0]?.merged || 0,
    totalIssues: issueStats[0]?.total || 0,
    closedIssues: issueStats[0]?.closed || 0,
    totalCommits: commitStats[0]?.total || 0,
    contributors: contributorCount[0]?.count || 0,
    linesAdded: prStats[0]?.additions || 0,
    linesDeleted: prStats[0]?.deletions || 0,
    topContributors: topContribs.map(c => ({ username: c.username, score: Math.round(c.total_score) })),
  };
}

async function getTopContributors(
  dateRange: { after: string; before: string },
  limit: number
): Promise<Array<{
  rank: number;
  username: string;
  avatarUrl: string;
  totalScore: number;
  breakdown: {
    prScore: number;
    issueScore: number;
    reviewScore: number;
    commitScore: number;
  };
}>> {
  const contributors = await query<{
    username: string;
    avatar_url: string;
    total_score: number;
    pr_score: number;
    issue_score: number;
    review_score: number;
    commit_score: number;
  }>(
    `SELECT 
      u.username,
      u.avatar_url,
      COALESCE(SUM(s.score), 0) as total_score,
      COALESCE(SUM(s.pr_score), 0) as pr_score,
      COALESCE(SUM(s.issue_score), 0) as issue_score,
      COALESCE(SUM(s.review_score), 0) as review_score,
      COALESCE(SUM(s.comment_score), 0) as commit_score
     FROM users u
     LEFT JOIN user_daily_scores s ON u.username = s.username
       AND s.date >= ? AND s.date <= ?
     WHERE u.is_bot = 0
     GROUP BY u.username
     HAVING total_score > 0
     ORDER BY total_score DESC
     LIMIT ?`,
    [dateRange.after, dateRange.before, limit]
  );

  return contributors.map((c, i) => ({
    rank: i + 1,
    username: c.username,
    avatarUrl: c.avatar_url,
    totalScore: Math.round(c.total_score),
    breakdown: {
      prScore: Math.round(c.pr_score),
      issueScore: Math.round(c.issue_score),
      reviewScore: Math.round(c.review_score),
      commitScore: Math.round(c.commit_score),
    },
  }));
}



