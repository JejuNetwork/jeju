import { createStep } from "../types";
import { ContributorPipelineContext } from "./context";
import { calculateContributorScore } from "@/lib/scoring/scoreCalculator";
import { TimeInterval, toDateString } from "@/lib/date-utils";
import { QueryParams } from "../queryHelpers";
import { getUserDailyScores, saveUserDailyScore } from "@/lib/scoring/storage";

/**
 * Calculate and save scores for a contributor within a time interval
 */
export const calculateUserScoreForInterval = createStep(
  "calculateScore",
  async (
    { username, interval }: { username: string; interval: TimeInterval },
    context: ContributorPipelineContext,
  ) => {
    const { logger, config, force } = context;

    const dateString = toDateString(interval.intervalStart);

    // Check if score already exists for this user/date/interval combination
    const existingScores = await getUserDailyScores(
      username,
      toDateString(interval.intervalStart),
      toDateString(interval.intervalEnd),
    );
    if (existingScores.length > 0 && !force) {
      logger?.debug(
        `Skipping ${username} for ${interval.intervalType} ${dateString} - score already exists (use --force to recalculate)`,
      );
      return null;
    }

    // Create query params for the interval
    const queryParams: QueryParams = {
      dateRange: {
        startDate: dateString,
        endDate: toDateString(interval.intervalEnd),
      },
    };

    logger?.debug(
      `${existingScores.length > 0 ? "Recalculating" : "Calculating"} scores for ${username} for ${interval.intervalType} ${dateString}`,
    );

    try {
      // Calculate contributor score using the scoring.ts utility
      const scoreResult = await calculateContributorScore(
        username,
        queryParams,
        config.scoring,
      );

      // Only save if there's actual score
      if (scoreResult.totalScore > 0) {
        // Save the calculated score to the database
        await saveUserDailyScore(username, scoreResult, dateString);

        logger?.debug(
          `Saved ${interval.intervalType} score for ${username}: ${scoreResult.totalScore}`,
          {
            prScore: scoreResult.prScore,
            issueScore: scoreResult.issueScore,
            reviewScore: scoreResult.reviewScore,
            commentScore: scoreResult.commentScore,
          },
        );

        return {
          username,
          intervalType: interval.intervalType,
          date: dateString,
          score: scoreResult.totalScore,
        };
      } else {
        logger?.debug(`Skipping save for ${username} - score is zero`);
        return null;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger?.error(`Failed to calculate score for ${username}`, {
        error: errorMessage,
        interval: dateString,
      });
      throw error;
    }
  },
);

/**
 * Process contributors for a single interval
 */
export const processContributorsForInterval = createStep(
  "contributorScores",
  async (
    data: {
      interval: TimeInterval;
      contributors: {
        username: string;
      }[];
    },
    context: ContributorPipelineContext,
  ) => {
    const { interval, contributors } = data;
    if (!contributors.length) {
      context.logger?.debug(
        `No contributors found for ${interval.intervalType} ${toDateString(interval.intervalStart)}`,
      );
      return null;
    }
    // Process each contributor
    const results = [];
    for (const contributor of contributors) {
      const result = await calculateUserScoreForInterval(
        { username: contributor.username, interval },
        context,
      );
      if (result) {
        results.push(result);
      }
    }

    // Summarize the results
    const validResults = results.filter(Boolean);
    context.logger?.info(
      `Saved scores for ${validResults.length}/${contributors.length} active contributors for ${interval.intervalType} ${toDateString(interval.intervalStart)}`,
    );

    return {
      interval,
      intervalType: interval.intervalType,
      date: toDateString(interval.intervalStart),
      processedCount: validResults.length,
      totalCount: contributors.length,
      activeCount: validResults.length,
      results: validResults,
    };
  },
);
