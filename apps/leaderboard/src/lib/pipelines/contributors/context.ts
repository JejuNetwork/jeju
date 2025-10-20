import { RepoPipelineContext } from "../types";
import { PipelineConfig } from "../pipelineConfig";
import { Logger } from "@/lib/logger";

/**
 * Extended context for contributor pipelines
 */
export interface ContributorPipelineContext extends RepoPipelineContext {
  force?: boolean; // Whether to force recalculation of scores
}

/**
 * Create a context for contributor pipelines
 */
export function createContributorPipelineContext({
  repoId,
  logger,
  config,
  force = false,
}: {
  repoId?: string;
  logger?: Logger;
  config: PipelineConfig;
  force?: boolean;
}): ContributorPipelineContext {
  return {
    repoId,
    logger,
    config,
    force,
  };
}
