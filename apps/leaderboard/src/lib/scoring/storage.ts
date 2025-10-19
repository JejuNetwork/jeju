import { db } from "@/lib/data/db";
import { users, userDailyScores } from "@/lib/data/schema";
import { eq, and, asc } from "drizzle-orm";
import { buildCommonWhereConditions } from "@/lib/pipelines/queryHelpers";
import { UTCDate } from "@date-fns/utc";
import { toDateString } from "../date-utils";
import { ScoreResult } from "./scoreCalculator";
import { UserScoreWithMetrics, UserScoreMetricsSchema } from "./types";
import { sql } from "drizzle-orm";

/**
 * Save daily score for a user
 * @param username - User's username
 * @param scoreData - Score data from scoring.ts
 * @param date - Optional date string (YYYY-MM-DD) - defaults to today
d * @returns Result of the insert operation
 */
export async function saveUserDailyScore(
  username: string,
  scoreData: ScoreResult,
  date?: string,
): Promise<void> {
  const scoreDate = date || toDateString(new UTCDate());
  const id = `${username}_${scoreDate}_day`;

  // Check if user exists
  const userExists = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.username, username))
    .get();

  if (!userExists) {
    console.warn(`User ${username} not found, cannot save daily score`);
    return;
  }

  // Insert or update daily score
  await db
    .insert(userDailyScores)
    .values({
      id,
      username,
      date: scoreDate,
      timestamp: new UTCDate().toISOString(),
      score: scoreData.totalScore,
      prScore: scoreData.prScore,
      issueScore: scoreData.issueScore,
      reviewScore: scoreData.reviewScore,
      commentScore: scoreData.commentScore,
      metrics: JSON.stringify(scoreData.metrics),
      category: "day",
    })
    .onConflictDoUpdate({
      target: userDailyScores.id,
      set: {
        timestamp: new UTCDate().toISOString(),
        score: scoreData.totalScore,
        prScore: scoreData.prScore,
        issueScore: scoreData.issueScore,
        reviewScore: scoreData.reviewScore,
        commentScore: scoreData.commentScore,
        metrics: JSON.stringify(scoreData.metrics),
        lastUpdated: sql`CURRENT_TIMESTAMP`,
      },
    })
    .run();
}

/**
 * Get daily scores for a user
 * @param username - User's username
 * @param startDate - Start date string (YYYY-MM-DD)
 * @param endDate - End date string (YYYY-MM-DD)
 * @param category - Optional category filter
 * @returns Array of daily score records with parsed metrics
 */
export async function getUserDailyScores(
  username: string,
  startDate?: string,
  endDate?: string,
): Promise<UserScoreWithMetrics[]> {
  // Start with the basic query condition for username
  const conditions = [
    eq(userDailyScores.username, username),
    eq(userDailyScores.category, "day"),
    ...buildCommonWhereConditions(
      { dateRange: { startDate, endDate } },
      userDailyScores,
      ["date"],
    ),
  ];
  // Execute the query with all conditions
  const results = await db
    .select()
    .from(userDailyScores)
    .where(and(...conditions))
    .orderBy(asc(userDailyScores.date))
    .all();

  // Parse the metrics JSON for each result
  return results.map((row) => {
    const data = JSON.parse(row.metrics);
    const metrics = UserScoreMetricsSchema.safeParse(data);
    if (!metrics.success) {
      console.log({ data });
      console.warn(
        `Error parsing score metrics for user ${row.username} on ${row.date}:`,
        metrics.error,
      );
    }
    return {
      ...row,
      prScore: Number(row.prScore || 0),
      issueScore: Number(row.issueScore || 0),
      reviewScore: Number(row.reviewScore || 0),
      commentScore: Number(row.commentScore || 0),
      category: row.category,
      metrics: metrics.success ? metrics.data : data,
    };
  });
}
