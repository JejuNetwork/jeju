/**
 * Score Weighting Utilities
 * 
 * Calculates weighted contributor scores for payment distribution:
 * - 50% all-time score
 * - 30% 6-month score
 * - 20% 1-month score
 * 
 * This rewards both long-term contributors and recent activity.
 */

import { db } from "../data/db";
import { userDailyScores } from "../data/schema";
import { sql, and, eq, inArray } from "drizzle-orm";
import { UTCDate } from "@date-fns/utc";
import { toDateString } from "../date-utils";
import { subMonths } from "date-fns";

export interface ContributorScore {
  username: string;
  allTimeScore: number;
  sixMonthScore: number;
  oneMonthScore: number;
  weightedScore: number;
  rank: number;
}

/**
 * Calculate weighted scores for all contributors
 * @param endDate End date for the scoring period (defaults to now)
 * @returns Array of contributor scores sorted by weighted score descending
 */
export async function calculateWeightedScores(
  endDate: Date | string = new Date(),
): Promise<ContributorScore[]> {
  const end = new UTCDate(endDate);
  const endDateStr = toDateString(end);
  
  // Calculate date ranges
  const sixMonthsAgo = subMonths(end, 6);
  const oneMonthAgo = subMonths(end, 1);
  
  const sixMonthStart = toDateString(sixMonthsAgo);
  const oneMonthStart = toDateString(oneMonthAgo);
  
  // Get all contributors
  const allContributors = await db
    .selectDistinct({ username: userDailyScores.username })
    .from(userDailyScores);
  
  const contributorScores: ContributorScore[] = [];
  
  for (const { username } of allContributors) {
    // All-time score (from beginning to endDate)
    const allTimeResult = await db
      .select({
        total: sql<number>`COALESCE(SUM(${userDailyScores.score}), 0)`,
      })
      .from(userDailyScores)
      .where(
        sql`${userDailyScores.username} = ${username} 
            AND ${userDailyScores.date} <= ${endDateStr}`,
      );
    
    const allTimeScore = allTimeResult[0]?.total || 0;
    
    // 6-month score
    const sixMonthResult = await db
      .select({
        total: sql<number>`COALESCE(SUM(${userDailyScores.score}), 0)`,
      })
      .from(userDailyScores)
      .where(
        sql`${userDailyScores.username} = ${username}
            AND ${userDailyScores.date} >= ${sixMonthStart}
            AND ${userDailyScores.date} <= ${endDateStr}`,
      );
    
    const sixMonthScore = sixMonthResult[0]?.total || 0;
    
    // 1-month score
    const oneMonthResult = await db
      .select({
        total: sql<number>`COALESCE(SUM(${userDailyScores.score}), 0)`,
      })
      .from(userDailyScores)
      .where(
        sql`${userDailyScores.username} = ${username}
            AND ${userDailyScores.date} >= ${oneMonthStart}
            AND ${userDailyScores.date} <= ${endDateStr}`,
      );
    
    const oneMonthScore = oneMonthResult[0]?.total || 0;
    
    // Calculate weighted score: 50% all-time + 30% 6-month + 20% 1-month
    const weightedScore =
      allTimeScore * 0.5 + sixMonthScore * 0.3 + oneMonthScore * 0.2;
    
    contributorScores.push({
      username,
      allTimeScore,
      sixMonthScore,
      oneMonthScore,
      weightedScore,
      rank: 0, // Will be set after sorting
    });
  }
  
  // Sort by weighted score descending
  contributorScores.sort((a, b) => b.weightedScore - a.weightedScore);
  
  // Assign ranks
  contributorScores.forEach((contributor, index) => {
    contributor.rank = index + 1;
  });
  
  return contributorScores;
}

/**
 * Convert scores to pro-rata shares (for smart contract)
 * @param scores Array of contributor scores
 * @param precision Number of decimal places for share precision (default 18 for wei)
 * @returns Object with contributors, shares, and total shares
 */
export function convertScoresToShares(
  scores: ContributorScore[],
  precision: number = 18,
): {
  contributors: string[];
  shares: bigint[];
  totalShares: bigint;
} {
  // Filter out zero scores
  const activeContributors = scores.filter((s) => s.weightedScore > 0);
  
  if (activeContributors.length === 0) {
    return {
      contributors: [],
      shares: [],
      totalShares: 0n,
    };
  }
  
  // Calculate total score
  const totalScore = activeContributors.reduce(
    (sum, c) => sum + c.weightedScore,
    0,
  );
  
  // Convert to BigInt shares (multiply by 10^precision for accuracy)
  const multiplier = 10n ** BigInt(precision);
  
  const contributors: string[] = [];
  const shares: bigint[] = [];
  let totalShares = 0n;
  
  for (const contributor of activeContributors) {
    // Calculate share as (score / totalScore) * multiplier
    // Use BigInt arithmetic for precision
    const scoreBI = BigInt(Math.floor(contributor.weightedScore * 1e18));
    const totalScoreBI = BigInt(Math.floor(totalScore * 1e18));
    const share = (scoreBI * multiplier) / totalScoreBI;
    
    contributors.push(contributor.username);
    shares.push(share);
    totalShares += share;
  }
  
  return {
    contributors,
    shares,
    totalShares,
  };
}

/**
 * Get wallet address for a username (from leaderboard database)
 * @param username GitHub username
 * @returns Primary wallet address or null
 */
export async function getContributorWalletAddress(
  username: string,
): Promise<string | null> {
  const walletResult = await db.query.walletAddresses.findFirst({
    where: (walletAddresses) =>
      and(
        eq(walletAddresses.userId, username),
        eq(walletAddresses.isPrimary, true),
        eq(walletAddresses.isActive, true),
      ),
    columns: {
      accountAddress: true,
    },
  });
  
  return walletResult?.accountAddress || null;
}

/**
 * Get wallet addresses for multiple contributors
 */
export async function getContributorWalletAddresses(
  usernames: string[],
): Promise<Map<string, string>> {
  const walletMap = new Map<string, string>();
  
  const wallets = await db.query.walletAddresses.findMany({
    where: (walletAddresses) =>
      and(
        inArray(walletAddresses.userId, usernames),
        eq(walletAddresses.isPrimary, true),
        eq(walletAddresses.isActive, true),
      ),
    columns: {
      userId: true,
      accountAddress: true,
    },
  });
  
  for (const wallet of wallets) {
    walletMap.set(wallet.userId, wallet.accountAddress);
  }
  
  return walletMap;
}

/**
 * Calculate score statistics for reporting
 */
export function calculateScoreStats(scores: ContributorScore[]): {
  totalContributors: number;
  totalScore: number;
  averageScore: number;
  medianScore: number;
  topContributor: ContributorScore | null;
} {
  if (scores.length === 0) {
    return {
      totalContributors: 0,
      totalScore: 0,
      averageScore: 0,
      medianScore: 0,
      topContributor: null,
    };
  }
  
  const totalScore = scores.reduce((sum, s) => sum + s.weightedScore, 0);
  const averageScore = totalScore / scores.length;
  
  // Calculate median
  const sorted = [...scores].sort((a, b) => a.weightedScore - b.weightedScore);
  const mid = Math.floor(sorted.length / 2);
  const medianScore =
    sorted.length % 2 === 0
      ? (sorted[mid - 1].weightedScore + sorted[mid].weightedScore) / 2
      : sorted[mid].weightedScore;
  
  return {
    totalContributors: scores.length,
    totalScore,
    averageScore,
    medianScore,
    topContributor: scores[0] || null,
  };
}


