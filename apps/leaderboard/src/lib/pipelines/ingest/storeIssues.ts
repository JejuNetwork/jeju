import { db } from "@/lib/data/db";
import {
  rawIssues,
  issueComments,
  issueReactions,
  issueCommentReactions,
} from "@/lib/data/schema";
import { sql } from "drizzle-orm";
import {
  ensureUsersExist,
  ensureLabelsExist,
  storeIssueLabels,
} from "./mutations";
import { createStep } from "../types";
import { IngestionPipelineContext } from "./context";
import { RepositoryConfig } from "@/lib/pipelines/pipelineConfig";

/**
 * Step to fetch and store issues for a repository
 */
export const fetchAndStoreIssues = createStep(
  "Issues",
  async (
    { repository }: { repository: RepositoryConfig },
    context: IngestionPipelineContext,
  ) => {
    const { github, logger, dateRange } = context;
    const { owner, name } = repository;
    const repoId = `${owner}/${name}`;

    logger?.info(`Starting issue ingestion for ${repoId}`);

    try {
      // Fetch issues from GitHub
      const options = {
        startDate: dateRange?.startDate,
        endDate: dateRange?.endDate,
      };

      const issues = await github.fetchIssues(repository, options);
      logger?.info(`Fetched ${issues.length} issues for ${repoId}`);

      // Filter out undefined values
      const validIssues = issues.filter(
        (issue): issue is NonNullable<typeof issue> => issue !== undefined,
      );

      if (validIssues.length === 0) {
        logger?.info(
          `No issues found for ${repoId} in the specified date range`,
        );
        return { repository, count: 0 };
      }

      // Collect all users that need to be created/updated
      const userData = new Map<string, { avatarUrl?: string }>();
      for (const issue of validIssues) {
        // Issue author
        if (issue.author?.login) {
          userData.set(issue.author.login, {
            avatarUrl: issue.author.avatarUrl || undefined,
          });
        }

        // Comment authors
        issue.comments?.nodes?.forEach((comment) => {
          if (comment.author?.login) {
            userData.set(comment.author.login, {
              avatarUrl: comment.author.avatarUrl || undefined,
            });
          }
        });

        // Reaction users
        issue.reactions?.nodes?.forEach((reaction) => {
          if (reaction.user?.login) {
            userData.set(reaction.user.login, {
              avatarUrl: reaction.user.avatarUrl || undefined,
            });
          }
        });

        // Comment reaction users
        issue.comments?.nodes?.forEach((comment) => {
          comment.reactions?.nodes?.forEach((reaction) => {
            if (reaction.user?.login) {
              userData.set(reaction.user.login, {
                avatarUrl: reaction.user.avatarUrl || undefined,
              });
            }
          });
        });
      }

      // Ensure all users exist in a single batch operation
      await ensureUsersExist(userData, context.config.botUsers);

      // Process all labels first
      const allLabels = validIssues.flatMap(
        (issue) => issue.labels?.nodes || [],
      );
      await ensureLabelsExist(allLabels);

      // Batch insert issues
      if (validIssues.length > 0) {
        const issuesToInsert = validIssues.map((issue) => ({
          id: issue.id,
          number: issue.number,
          title: issue.title,
          body: issue.body ?? "",
          state: issue.state,
          locked: issue.locked ? 1 : 0,
          author: issue.author?.login || "unknown",
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
          closedAt: issue.closedAt || null,
          repository: repoId,
        }));

        await db
          .insert(rawIssues)
          .values(issuesToInsert)
          .onConflictDoUpdate({
            target: rawIssues.id,
            set: {
              state: sql`excluded.state`,
              locked: sql`excluded.locked`,
              updatedAt: sql`excluded.updated_at`,
              closedAt: sql`excluded.closed_at`,
            },
          });

        // Store Issue-Label relationships
        for (const issue of validIssues) {
          const labelIds = issue.labels?.nodes?.map((label) => label.id) || [];
          await storeIssueLabels(issue.id, labelIds);
        }
      }

      // Batch insert issue reactions
      let totalReactions = 0;
      for (const issue of validIssues) {
        if (issue.reactions?.nodes?.length) {
          totalReactions += issue.reactions.nodes.length;
          const reactionsToInsert = issue.reactions.nodes.map((reaction) => ({
            id: reaction.id,
            issueId: issue.id,
            content: reaction.content,
            createdAt: reaction.createdAt,
            user: reaction.user?.login || "unknown",
          }));

          await db
            .insert(issueReactions)
            .values(reactionsToInsert)
            .onConflictDoUpdate({
              target: [issueReactions.id],
              set: {
                user: sql`excluded.user`,
              },
            });
        }
      }
      logger?.debug(`Processed ${totalReactions} issue reactions`);

      // Batch insert issue comments and their reactions
      let totalComments = 0;
      let totalCommentReactions = 0;
      for (const issue of validIssues) {
        if (issue.comments?.nodes?.length) {
          totalComments += issue.comments.nodes.length;
          const commentsToInsert = issue.comments.nodes.map((comment) => ({
            id: comment.id,
            issueId: issue.id,
            body: comment.body ?? "",
            createdAt: comment.createdAt || issue.updatedAt,
            updatedAt: comment.updatedAt || issue.updatedAt,
            author: comment.author?.login || "unknown",
          }));

          await db
            .insert(issueComments)
            .values(commentsToInsert)
            .onConflictDoUpdate({
              target: [issueComments.id],
              set: {
                body: sql`excluded.body`,
                updatedAt: sql`excluded.updated_at`,
              },
            });

          // Process reactions on comments
          for (const comment of issue.comments.nodes) {
            if (comment.reactions?.nodes?.length) {
              totalCommentReactions += comment.reactions.nodes.length;
              const commentReactionsToInsert = comment.reactions.nodes.map(
                (reaction) => ({
                  id: reaction.id,
                  commentId: comment.id,
                  content: reaction.content,
                  createdAt: reaction.createdAt,
                  user: reaction.user?.login || "unknown",
                }),
              );

              await db
                .insert(issueCommentReactions)
                .values(commentReactionsToInsert)
                .onConflictDoUpdate({
                  target: [issueCommentReactions.id],
                  set: {
                    user: sql`excluded.user`,
                  },
                });
            }
          }
        }
      }
      logger?.debug(
        `Processed ${totalComments} issue comments with ${totalCommentReactions} reactions`,
      );

      logger?.info(
        `Successfully stored ${validIssues.length} issues, ${totalReactions} reactions, ${totalComments} comments, and ${totalCommentReactions} comment reactions for ${repoId}`,
      );
      return { repository, count: validIssues.length };
    } catch (error) {
      logger?.error(`Error fetching issues for ${repoId}`, {
        error: String(error),
      });
      throw new Error(
        `Failed to fetch issues: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
);
