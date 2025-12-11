/**
 * A2A Server for Leaderboard
 * Agent-to-Agent protocol endpoint for querying leaderboard data
 * 
 * Returns REAL data from the database - not placeholder data
 */

import { NextRequest, NextResponse } from 'next/server';
import { corsHeadersFromRequest } from '@/lib/auth/cors';
import {
  checkRateLimit,
  getClientIdentifier,
  RATE_LIMITS,
  rateLimitExceededResponse,
} from '@/lib/auth/rateLimit';
import { db } from '@/lib/data/db-nextjs';
import { users, repositories, rawPullRequests, rawCommits, userDailyScores } from '@/lib/data/schema';
import { eq, sql, desc, and, gte } from 'drizzle-orm';
import { subDays } from 'date-fns';
import { UTCDate } from '@date-fns/utc';
import { toDateString } from '@/lib/date-utils';

export async function OPTIONS(request: NextRequest) {
  const corsHeaders = corsHeadersFromRequest(request);
  return new NextResponse(null, {
    headers: {
      ...corsHeaders,
      'Access-Control-Max-Age': '86400',
    },
  });
}

interface A2ADataPart {
  kind: string;
  data?: {
    skillId?: string;
    username?: string;
    repoId?: string;
    limit?: number;
  };
}

interface A2AMessage {
  messageId: string;
  parts: A2ADataPart[];
}

interface A2ARequestBody {
  jsonrpc: string;
  id: string | number;
  method: string;
  params?: {
    message?: A2AMessage;
  };
}

export async function POST(request: NextRequest) {
  const corsHeaders = corsHeadersFromRequest(request);

  // Rate limiting
  const clientId = getClientIdentifier(request);
  const rateLimit = checkRateLimit(`a2a:${clientId}`, RATE_LIMITS.general);
  if (!rateLimit.success) {
    return rateLimitExceededResponse(rateLimit, corsHeaders);
  }

  const body: A2ARequestBody = await request.json();

  if (body.method !== 'message/send') {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32601, message: 'Method not found' }
    }, { headers: corsHeaders });
  }

  const message = body.params?.message;
  if (!message) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'Invalid params' }
    }, { headers: corsHeaders });
  }

  const dataPart = message.parts.find((p) => p.kind === 'data');
  const skillId = dataPart?.data?.skillId;
  const params = dataPart?.data || {};

  let result: { message: string; data: Record<string, unknown> };

  switch (skillId) {
    case 'get-leaderboard':
      result = await handleGetLeaderboard(params.limit);
      break;
    case 'get-contributor-profile':
      result = await handleGetContributorProfile(params.username);
      break;
    case 'get-repo-stats':
      result = await handleGetRepoStats(params.repoId);
      break;
    default:
      result = { message: `Unknown skill: ${skillId}`, data: { error: 'Skill not found' } };
  }

  return NextResponse.json({
    jsonrpc: '2.0',
    id: body.id,
    result: {
      role: 'agent',
      parts: [{ kind: 'text', text: result.message }, { kind: 'data', data: result.data }],
      messageId: message.messageId,
      kind: 'message'
    }
  }, { headers: corsHeaders });
}

/**
 * Get top contributors from leaderboard
 */
async function handleGetLeaderboard(limit?: number): Promise<{ message: string; data: Record<string, unknown> }> {
  const topUsers = await db
    .select({
      username: users.username,
      avatarUrl: users.avatarUrl,
      totalScore: sql<number>`COALESCE(SUM(${userDailyScores.score}), 0)`.as('totalScore'),
    })
    .from(users)
    .leftJoin(userDailyScores, eq(users.username, userDailyScores.username))
    .where(eq(users.isBot, 0))
    .groupBy(users.username)
    .orderBy(desc(sql`totalScore`))
    .limit(limit || 10);

  const contributors = topUsers.map((user, index) => ({
    rank: index + 1,
    username: user.username,
    avatarUrl: user.avatarUrl,
    score: Math.round(user.totalScore || 0),
  }));

  return {
    message: `Top ${contributors.length} contributors on the Jeju Network leaderboard`,
    data: {
      contributors,
      totalContributors: contributors.length,
    },
  };
}

/**
 * Get contributor profile with stats
 */
async function handleGetContributorProfile(username?: string): Promise<{ message: string; data: Record<string, unknown> }> {
  if (!username) {
    return { message: 'Username required', data: { error: 'Missing username parameter' } };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
  });

  if (!user) {
    return { message: `User ${username} not found`, data: { error: 'User not found' } };
  }

  // Get score
  const scoreResult = await db
    .select({
      totalScore: sql<number>`COALESCE(SUM(${userDailyScores.score}), 0)`,
      prScore: sql<number>`COALESCE(SUM(${userDailyScores.prScore}), 0)`,
      issueScore: sql<number>`COALESCE(SUM(${userDailyScores.issueScore}), 0)`,
      reviewScore: sql<number>`COALESCE(SUM(${userDailyScores.reviewScore}), 0)`,
    })
    .from(userDailyScores)
    .where(eq(userDailyScores.username, username));

  // Get PR stats
  const prStats = await db
    .select({
      total: sql<number>`COUNT(*)`,
      merged: sql<number>`SUM(CASE WHEN ${rawPullRequests.merged} = 1 THEN 1 ELSE 0 END)`,
      additions: sql<number>`COALESCE(SUM(${rawPullRequests.additions}), 0)`,
      deletions: sql<number>`COALESCE(SUM(${rawPullRequests.deletions}), 0)`,
    })
    .from(rawPullRequests)
    .where(eq(rawPullRequests.author, username));

  // Get commit count
  const commitStats = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(rawCommits)
    .where(eq(rawCommits.author, username));

  const scores = scoreResult[0] || {};
  const prs = prStats[0] || {};
  const commits = commitStats[0] || {};

  return {
    message: `Profile for ${username}`,
    data: {
      profile: {
        username: user.username,
        avatarUrl: user.avatarUrl,
        score: Math.round(Number(scores.totalScore) || 0),
        breakdown: {
          prScore: Math.round(Number(scores.prScore) || 0),
          issueScore: Math.round(Number(scores.issueScore) || 0),
          reviewScore: Math.round(Number(scores.reviewScore) || 0),
        },
        stats: {
          totalPRs: Number(prs.total) || 0,
          mergedPRs: Number(prs.merged) || 0,
          linesAdded: Number(prs.additions) || 0,
          linesDeleted: Number(prs.deletions) || 0,
          totalCommits: Number(commits.total) || 0,
        },
      },
    },
  };
}

/**
 * Get repository statistics
 */
async function handleGetRepoStats(repoId?: string): Promise<{ message: string; data: Record<string, unknown> }> {
  const ninetyDaysAgo = toDateString(subDays(new UTCDate(), 90));

  // If specific repo requested
  if (repoId) {
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.repoId, repoId),
    });

    if (!repo) {
      return { message: `Repository ${repoId} not found`, data: { error: 'Repository not found' } };
    }

    const stats = await getRepoStatistics(repo.repoId, ninetyDaysAgo);
    return {
      message: `Statistics for ${repo.owner}/${repo.name}`,
      data: { stats },
    };
  }

  // Get all repos with stats
  const allRepos = await db.select().from(repositories);
  const repoStats = await Promise.all(
    allRepos.map(async (repo) => ({
      id: repo.repoId,
      name: repo.name,
      owner: repo.owner,
      ...(await getRepoStatistics(repo.repoId, ninetyDaysAgo)),
    }))
  );

  return {
    message: `Statistics for ${repoStats.length} repositories`,
    data: { 
      stats: repoStats,
      totalRepositories: repoStats.length,
    },
  };
}

async function getRepoStatistics(repoId: string, since: string) {
  const [prCount, commitCount, contributorCount] = await Promise.all([
    db.select({ count: sql<number>`COUNT(*)` })
      .from(rawPullRequests)
      .where(and(eq(rawPullRequests.repository, repoId), gte(rawPullRequests.createdAt, since))),
    db.select({ count: sql<number>`COUNT(*)` })
      .from(rawCommits)
      .where(and(eq(rawCommits.repository, repoId), gte(rawCommits.committedDate, since))),
    db.selectDistinct({ author: rawPullRequests.author })
      .from(rawPullRequests)
      .where(and(eq(rawPullRequests.repository, repoId), gte(rawPullRequests.createdAt, since))),
  ]);

  return {
    pullRequests: prCount[0]?.count || 0,
    commits: commitCount[0]?.count || 0,
    contributors: contributorCount.length,
    period: '90 days',
  };
}
