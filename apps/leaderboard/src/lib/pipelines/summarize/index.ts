/**
 * Pipeline for generating AI-powered summaries of contributor activity
 */
import { pipe, createStep, sequence } from "../types";
import {
  generateDailyContributorSummaries,
  generateMonthlyContributorSummaries,
  generateWeeklyContributorSummaries,
} from "./generateContributorSummary";
import { SummarizerPipelineContext, createSummarizerContext } from "./context";
import {
  generateDailyRepoSummaries,
  generateMonthlyRepoSummaries,
  generateWeeklyRepoSummaries,
} from "./generateRepoSummary";
import {
  generateDailyOverallSummaries,
  generateMonthlyOverallSummaries,
  generateWeeklyOverallSummaries,
} from "./generateOverallSummary";

export { type SummarizerPipelineContext, createSummarizerContext };

// Tier 1: Per-repository summaries
export const repositorySummariesPipeline = sequence(
  generateDailyRepoSummaries,
  generateWeeklyRepoSummaries,
  generateMonthlyRepoSummaries,
);

// Tier 2: Overall summaries (synthesizing per-repo summaries)
export const overallSummariesPipeline = sequence(
  generateDailyOverallSummaries,
  generateWeeklyOverallSummaries,
  generateMonthlyOverallSummaries,
);

// Existing Contributor Summaries Pipeline (can be run independently)
export const contributorSummariesPipeline = pipe(
  sequence(
    generateMonthlyContributorSummaries,
    generateWeeklyContributorSummaries,
    generateDailyContributorSummaries,
  ),
  createStep("Log Results", (results, context) => {
    const [monthly, weekly, daily] = results;
    context.logger?.info(
      `Generated ${monthly.length} monthly, ${weekly.length} weekly, and ${daily.length} daily contributor summaries.`,
    );
  }),
);
