import { pipe, mapStep, parallel, createStep } from "../types";
import { generateTimeIntervals } from "../generateTimeIntervals";
import { exportRepoStatsForInterval } from "./exportRepoStats";
import { getSelectedRepositories } from "../getSelectedRepositories";
import { isNotNullOrUndefined } from "@/lib/typeHelpers";
/**
 * Pipeline for generating repository stats
 */
const generateDailyRepoStats = pipe(
  generateTimeIntervals<{ repoId: string }>("day"),
  mapStep(exportRepoStatsForInterval),
);

const generateWeeklyRepoStats = pipe(
  generateTimeIntervals<{ repoId: string }>("week"),
  mapStep(exportRepoStatsForInterval),
);

const generateMonthlyRepoStats = pipe(
  generateTimeIntervals<{ repoId: string }>("month"),
  mapStep(exportRepoStatsForInterval),
);

export const generateRepositoryStats = pipe(
  getSelectedRepositories,
  mapStep(
    parallel(
      generateDailyRepoStats,
      generateWeeklyRepoStats,
      generateMonthlyRepoStats,
    ),
  ),
  createStep("Log Stats", (results, context) => {
    for (const repo of results) {
      const [daily, weekly, monthly] = repo;

      const dailyCount = daily.filter(isNotNullOrUndefined).length;
      const weeklyCount = weekly.filter(isNotNullOrUndefined).length;
      const monthlyCount = monthly.filter(isNotNullOrUndefined).length;
      context.logger?.info(`Exported ${dailyCount} daily stats`);
      context.logger?.info(`Exported ${weeklyCount} weekly stats`);
      context.logger?.info(`Exported ${monthlyCount} monthly stats`);
    }
  }),
);
