import { pipe, parallel, mapStep, createStep, sequence } from "../types";
import { generateTimeIntervals } from "../generateTimeIntervals";
import { fetchAndStorePullRequests } from "./storePullRequests";
import { fetchAndStoreIssues } from "./storeIssues";
import {
  updateRepositoryLastFetched,
  updateRepositoryMetadata,
} from "./mutations";
import { RepositoryConfig } from "@/lib/pipelines/pipelineConfig";
import { IngestionPipelineContext } from "./context";
import { TimeInterval, toDateString } from "@/lib/date-utils";
import { UTCDate } from "@date-fns/utc";
import { isNotNullOrUndefined } from "@/lib/typeHelpers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/data/db";
import { repositories } from "@/lib/data/schema";
import { fetchAndStoreCommits } from "./storeCommits";

/**
 * Process repository data for a specific time interval
 */
const ingestRepoDataForInterval = createStep(
  "ingest",
  async (
    {
      repository,
      interval,
    }: { repository: RepositoryConfig; interval: TimeInterval },
    context: IngestionPipelineContext,
  ) => {
    const { logger, force } = context;
    const { owner, name } = repository;
    const repoId = `${owner}/${name}`;

    const intervalLogger = logger?.child(
      `${interval.intervalType} - ${toDateString(interval.intervalStart)}`,
    );

    // Check if we need to skip this interval based on lastFetched
    if (!force) {
      const repoData = await db.query.repositories.findFirst({
        where: eq(repositories.repoId, repoId),
        columns: {
          lastFetchedAt: true,
        },
      });

      if (repoData?.lastFetchedAt) {
        const lastFetched = new UTCDate(repoData.lastFetchedAt);
        const intervalEnd = new UTCDate(interval.intervalEnd);

        if (lastFetched > intervalEnd) {
          intervalLogger?.info(
            `Skipping interval ${toDateString(interval.intervalStart)} - ${toDateString(interval.intervalEnd)} for ${repoId} as it was already fetched at ${lastFetched.toISOString()}`,
          );
          return {
            repository: repoId,
            prs: 0,
            issues: 0,
            skipped: true,
          };
        }
      }
    }

    // Update dateRange in context if we have an interval
    const processingContext = interval
      ? {
          ...context,
          logger: intervalLogger,
          dateRange: {
            startDate: toDateString(interval.intervalStart),
            endDate: toDateString(interval.intervalEnd),
          },
        }
      : context;

    try {
      // Record the ingestion timestamp
      const ingestionTimestamp = new UTCDate().toISOString();
      logger?.debug(
        `Created ingestion timestamp: ${ingestionTimestamp} for ${repoId}`,
      );

      // Process PRs and issues in parallel
      const [prResult, issueResult, commitResult] = await sequence(
        () => fetchAndStorePullRequests({ repository }, processingContext),
        () => fetchAndStoreIssues({ repository }, processingContext),
        () => fetchAndStoreCommits({ repository }, processingContext),
      )(null, processingContext);

      // Update repository last fetched timestamp
      await updateRepositoryLastFetched(repoId, ingestionTimestamp);

      logger?.info(
        `Completed ingestion for ${interval.intervalType} ${repoId}: ${prResult.count} PRs, ${issueResult.count} issues, ${commitResult.count} commits`,
        processingContext.dateRange,
      );

      return {
        repository: repoId,
        prs: prResult.count,
        issues: issueResult.count,
        commits: commitResult.count,
        skipped: false,
      };
    } catch (error) {
      logger?.error(`Error processing repository ${repoId}`, {
        error: String(error),
      });

      return {
        repository: repoId,
        prs: 0,
        issues: 0,
        commits: 0,
        skipped: false,
      };
    }
  },
);

/**
 * Ingest repository metadata (stars, forks, description) - runs once per repository
 */
const ingestRepoMetadata = createStep(
  "ingestRepoMetadata",
  async (
    { repository }: { repository: RepositoryConfig },
    context: IngestionPipelineContext,
  ) => {
    const { logger, github } = context;
    const { owner, name } = repository;
    const repoId = `${owner}/${name}`;

    try {
      const repoMetadata = await github.getRepo(owner, name);
      if (repoMetadata) {
        await updateRepositoryMetadata(repoId, {
          description: repoMetadata.description,
          stars: repoMetadata.stargazers_count,
          forks: repoMetadata.forks_count,
        });

        logger?.info(
          `Updated metadata for ${repoId}: ${repoMetadata.stargazers_count} stars, ${repoMetadata.forks_count} forks`,
        );

        return {
          repository: repoId,
          stars: repoMetadata.stargazers_count,
          forks: repoMetadata.forks_count,
          description: repoMetadata.description,
        };
      }

      return {
        repository: repoId,
        stars: 0,
        forks: 0,
        description: null,
      };
    } catch (error) {
      logger?.error(`Failed to fetch metadata for ${repoId}`, {
        error: String(error),
      });
      return {
        repository: repoId,
        stars: 0,
        forks: 0,
        description: null,
        error: String(error),
      };
    }
  },
);

export const ingestWeeklyGithubData = pipe(
  parallel(
    // Ingest repository metadata (once per repository)
    ingestRepoMetadata,
    // Ingest time-based data (PRs, issues, commits)
    pipe(
      generateTimeIntervals<{ repository: RepositoryConfig }>("week"),
      mapStep(ingestRepoDataForInterval),
      createStep("Filter null results", (results) => {
        return results.filter(isNotNullOrUndefined);
      }),
    ),
  ),
  createStep("Combine results", ([metadataResult, intervalResults]) => {
    return {
      metadata: metadataResult,
      intervals: intervalResults,
    };
  }),
);
