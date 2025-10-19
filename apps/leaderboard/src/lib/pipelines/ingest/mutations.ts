import { db } from "@/lib/data/db";
import {
  repositories,
  users,
  labels,
  pullRequestLabels,
  issueLabels,
} from "@/lib/data/schema";
import { UTCDate } from "@date-fns/utc";
import { eq, sql } from "drizzle-orm";

/**
 * Update a repository's last fetched timestamp
 */
export async function updateRepositoryLastFetched(
  repoId: string,
  timestamp: string,
) {
  await db
    .update(repositories)
    .set({
      lastFetchedAt: timestamp,
      lastUpdated: new UTCDate().toISOString(),
    })
    .where(eq(repositories.repoId, repoId));
}

/**
 * Update repository metadata (description, stars, forks)
 */
export async function updateRepositoryMetadata(
  repoId: string,
  metadata: {
    description?: string | null;
    stars?: number;
    forks?: number;
  },
) {
  await db
    .update(repositories)
    .set({
      description: sql`COALESCE(${metadata.description}, ${repositories.description})`,
      stars: metadata.stars ?? sql`${repositories.stars}`,
      forks: metadata.forks ?? sql`${repositories.forks}`,
      lastUpdated: new UTCDate().toISOString(),
    })
    .where(eq(repositories.repoId, repoId));
}

/**
 * Ensure users exist in the database
 */
export async function ensureUsersExist(
  userData: Map<string, { avatarUrl?: string }>,
  botUsers?: string[],
) {
  // Filter out unknown or empty usernames
  const validUsers = Array.from(userData.entries())
    .filter(([username]) => username && username !== "unknown")
    .map(([username, { avatarUrl }]) => ({
      username,
      avatarUrl: avatarUrl || "",
      isBot: botUsers?.includes(username) ? 1 : 0,
      lastUpdated: new UTCDate().toISOString(),
    }));

  if (validUsers.length === 0) return;

  await db
    .insert(users)
    .values(validUsers)
    .onConflictDoUpdate({
      target: users.username,
      set: {
        avatarUrl: sql`COALESCE(excluded.avatar_url, ${users.avatarUrl})`,
        isBot: sql`excluded.is_bot`,
      },
    });
}

/**
 * Ensure labels exist in the database
 */
export async function ensureLabelsExist(
  labelData: Array<{
    id: string;
    name: string;
    color: string;
    description?: string | null;
  }>,
): Promise<Map<string, string>> {
  if (labelData.length === 0) return new Map();

  const labelsToInsert = labelData.map((label) => ({
    id: label.id,
    name: label.name,
    color: label.color,
    description: label.description || "",
    lastUpdated: new UTCDate().toISOString(),
  }));

  await db
    .insert(labels)
    .values(labelsToInsert)
    .onConflictDoUpdate({
      target: labels.id,
      set: {
        name: sql`excluded.name`,
        color: sql`excluded.color`,
        description: sql`excluded.description`,
      },
    });

  return new Map(labelData.map((label) => [label.id, label.name]));
}

/**
 * Store pull request to label relationships
 */
export async function storePRLabels(prId: string, labelIds: string[]) {
  if (labelIds.length === 0) return;

  const relationships = labelIds.map((labelId) => ({
    prId,
    labelId,
    lastUpdated: new UTCDate().toISOString(),
  }));

  await db
    .insert(pullRequestLabels)
    .values(relationships)
    .onConflictDoNothing({
      target: [pullRequestLabels.prId, pullRequestLabels.labelId],
    });
}

/**
 * Store issue to label relationships
 */
export async function storeIssueLabels(issueId: string, labelIds: string[]) {
  if (labelIds.length === 0) return;

  const relationships = labelIds.map((labelId) => ({
    issueId,
    labelId,
    lastUpdated: new UTCDate().toISOString(),
  }));

  await db
    .insert(issueLabels)
    .values(relationships)
    .onConflictDoNothing({
      target: [issueLabels.issueId, issueLabels.labelId],
    });
}
