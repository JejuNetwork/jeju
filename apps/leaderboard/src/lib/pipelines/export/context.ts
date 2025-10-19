import { RepoPipelineContext } from "../types";

export interface RepositoryStatsPipelineContext extends RepoPipelineContext {
  outputDir: string;
  overwrite: boolean;
}

/**
 * Creates a repository stats export pipeline context
 */
export function createRepositoryStatsPipelineContext(params: {
  repoId?: string;
  dateRange?: RepositoryStatsPipelineContext["dateRange"];
  outputDir: string;
  logger?: RepositoryStatsPipelineContext["logger"];
  config: RepositoryStatsPipelineContext["config"];
  overwrite?: boolean;
}): RepositoryStatsPipelineContext {
  const {
    repoId,
    dateRange,
    outputDir,
    logger: parentLogger,
    config,
    overwrite = false,
  } = params;

  // Use parent logger if provided, creating a child logger for RepositoryStats
  const logger = parentLogger ? parentLogger.child("Export") : undefined;

  return {
    repoId,
    dateRange,
    outputDir,
    logger,
    config,
    overwrite,
  };
}
