import { db } from "@/lib/data/db";
import { rawCommits } from "@/lib/data/schema";
import { IngestionPipelineContext } from "./context";
import { createStep } from "../types";
import { ensureUsersExist } from "./mutations";
import { RepositoryConfig } from "@/lib/pipelines/pipelineConfig";
import { RawCommitSchema } from "@/lib/data/types";
import { isNotNullOrUndefined } from "@/lib/typeHelpers";
import { z } from "zod";

type RawCommit = z.infer<typeof RawCommitSchema>;

export const fetchAndStoreCommits = createStep(
  "fetchAndStoreCommits",
  async (
    { repository }: { repository: RepositoryConfig },
    context: IngestionPipelineContext,
  ) => {
    const { owner, name } = repository;
    const { github, logger, dateRange } = context;
    const repoId = `${owner}/${name}`;
    let allCommits: RawCommit[] = [];
    try {
      allCommits = await github.fetchCommits(repository, {
        startDate: dateRange?.startDate,
        endDate: dateRange?.endDate,
      });
    } catch (e) {
      logger?.error(`Error fetching commits for ${repoId}`, {
        error: String(e),
      });
      return {
        count: 0,
        repoId,
      };
    }

    if (!allCommits || allCommits.length === 0) {
      return {
        count: 0,
        repoId,
      };
    }

    const users = new Map<string, { avatarUrl?: string }>();
    for (const commit of allCommits) {
      if (commit.author?.user?.login) {
        users.set(commit.author.user.login, {
          avatarUrl: commit.author.user.avatarUrl ?? undefined,
        });
      }
    }

    const botUsers = context.config.botUsers ?? [];
    if (users.size > 0) {
      await ensureUsersExist(users, botUsers);
    }

    const commitsToInsert = allCommits
      .map((commit) => {
        const author = commit.author?.user?.login || "unknown";
        if (botUsers.includes(author)) {
          return null;
        }

        return {
          oid: commit.oid,
          message: commit.message,
          messageHeadline: commit.messageHeadline,
          committedDate: commit.committedDate,
          authorName: commit.author?.name || "unknown",
          authorEmail: commit.author?.email || "unknown",
          authorDate: commit.author?.date || commit.committedDate,
          author: commit.author?.user?.login || "unknown",
          repository: repoId,
          additions: commit.additions,
          deletions: commit.deletions,
          changedFiles: commit.changedFiles,
          pullRequestId: null,
        };
      })
      .filter(isNotNullOrUndefined);

    if (commitsToInsert.length > 0) {
      await db
        .insert(rawCommits)
        .values(commitsToInsert)
        .onConflictDoNothing({ target: rawCommits.oid });
    }

    return {
      count: commitsToInsert.length,
      repoId,
    };
  },
);
