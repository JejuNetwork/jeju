import { InferSelectModel } from "drizzle-orm";
import { z } from "zod";
import { userDailyScores } from "@/lib/data/schema";

/**
 * Time period options for aggregation queries
 */
export type AggregationPeriod =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export const UserScoreMetricsSchema = z.object({
  pullRequests: z.object({
    total: z.number(),
    merged: z.number(),
    open: z.number(),
    closed: z.number(),
  }),
  issues: z.object({
    total: z.number(),
    open: z.number(),
    closed: z.number(),
  }),
  reviews: z.object({
    total: z.number(),
    approved: z.number(),
    changesRequested: z.number(),
    commented: z.number(),
  }),
  comments: z.object({
    pullRequests: z.number(),
    issues: z.number(),
  }),
  codeChanges: z.object({
    additions: z.number(),
    deletions: z.number(),
    files: z.number(),
  }),
});

export type UserScoreMetrics = z.infer<typeof UserScoreMetricsSchema>;
/**
 * Interface for userDailyScores with typed metrics
 */

export type UserScoreWithMetrics = InferSelectModel<typeof userDailyScores> & {
  metrics: UserScoreMetrics;
};

export enum TagType {
  AREA = "AREA",
  ROLE = "ROLE",
  TECH = "TECH",
}
