import { pipe, mapStep, createStep, sequence } from "../types";
import { calculateTags } from "./calculateTags";
import { fetchAllContributors } from "./fetchAllContributors";
import { generateTimeIntervals } from "../generateTimeIntervals";
import { processContributorsForInterval } from "./contributorScores";
import { getActiveContributorsInInterval } from "../getActiveContributors";
import { isNotNullOrUndefined } from "@/lib/typeHelpers";

/**
 * Process a single repository for tags
 */
export const processContributorTags = pipe(
  // Fetch all unique contributors from all repos
  fetchAllContributors,
  // Process each contributor in parallel
  mapStep(calculateTags),
  // Format the combined results
  createStep("logResults", (results, context) => {
    const totalContributors = results.filter(isNotNullOrUndefined).length;
    context.logger?.info(
      `Processed tags for ${totalContributors} contributors`,
    );
    return results;
  }),
);

export const processContributorScores = pipe(
  generateTimeIntervals("day"),
  mapStep(
    pipe(
      // Fetch only active contributors for this interval
      getActiveContributorsInInterval,
      // Process the active contributors for this interval
      processContributorsForInterval,
    ),
  ),
  createStep("logScoringResults", (intervals, context) => {
    const totalIntervals = intervals.length;
    const allUniqueContributors = intervals
      .filter(isNotNullOrUndefined)
      .flatMap((interval) => interval.results.map((r) => r.username));
    const uniqueContributors = [...new Set(allUniqueContributors)];
    context.logger?.info(
      `Processed scores for ${uniqueContributors.length} unique contributors over ${totalIntervals} days`,
    );
    return intervals;
  }),
);

/**
 * Pipeline for calculating all contributor data across repositories
 */
export const contributorsPipeline = sequence(
  processContributorTags,
  processContributorScores,
);
