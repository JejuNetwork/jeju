import { db } from "@/lib/data/db";
import {
  rawPullRequests,
  rawIssues,
  prReviews,
  rawCommits,
  users,
} from "@/lib/data/schema";
import { and, eq, inArray } from "drizzle-orm";
import { QueryParams, buildCommonWhereConditions } from "./queryHelpers";
import { TimeInterval, toDateString } from "../date-utils";
import { createStep, RepoPipelineContext } from "./types";

export async function getActiveContributors(params: QueryParams = {}) {
  // Find contributors with any activity in the time range
  const activeUsernames = new Set<string>();
  // PRs
  const prAuthorsConditions = buildCommonWhereConditions(
    params,
    rawPullRequests,
    ["createdAt", "updatedAt"],
  );

  const prAuthors = await db
    .select({ author: rawPullRequests.author })
    .from(rawPullRequests)
    .where(and(...prAuthorsConditions));

  prAuthors.forEach((author) => {
    if (author.author) activeUsernames.add(author.author);
  });

  // Issues
  const issueAuthorsConditions = buildCommonWhereConditions(params, rawIssues, [
    "createdAt",
  ]);
  const issueAuthors = await db
    .select({ author: rawIssues.author })
    .from(rawIssues)
    .where(and(...issueAuthorsConditions));

  issueAuthors.forEach((author) => {
    if (author.author) activeUsernames.add(author.author);
  });

  const reviewConditions = buildCommonWhereConditions(params, prReviews, [
    "createdAt",
  ]);
  // Reviews
  const reviewers = await db
    .select({ author: prReviews.author })
    .from(prReviews)
    .innerJoin(rawPullRequests, eq(prReviews.prId, rawPullRequests.id))
    .where(and(...reviewConditions));

  reviewers.forEach((reviewer) => {
    if (reviewer.author) activeUsernames.add(reviewer.author);
  });

  const commitConditions = buildCommonWhereConditions(params, rawCommits, [
    "committedDate",
  ]);
  // Commits
  const committers = await db
    .select({ author: rawCommits.author })
    .from(rawCommits)
    .where(and(...commitConditions));

  committers.forEach((committer) => {
    if (committer.author) activeUsernames.add(committer.author);
  });

  if (activeUsernames.size <= 0) {
    return [];
  }

  // Get contributor details
  const activeContributors = await db
    .select()
    .from(users)
    .where(
      and(
        inArray(users.username, Array.from(activeUsernames)),
        eq(users.isBot, 0),
      ),
    );

  return activeContributors;
}

export const getActiveContributorsInInterval = createStep(
  "getActiveContributors",
  async (
    { interval, repoId }: { interval: TimeInterval; repoId?: string },
    context: RepoPipelineContext,
  ) => {
    const { logger } = context;

    // Create query params for the interval
    const queryParams = {
      repository: repoId,
      dateRange: {
        startDate: toDateString(interval.intervalStart),
        endDate: toDateString(interval.intervalEnd),
      },
    };

    const contributors = await getActiveContributors(queryParams);
    logger?.debug(
      `Found ${contributors.length} active contributors for ${interval.intervalType} ${toDateString(interval.intervalStart)}`,
    );
    // Return the interval with active contributors for this time period
    return {
      interval,
      repoId,
      contributors,
    };
  },
);
