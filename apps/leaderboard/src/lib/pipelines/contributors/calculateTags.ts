import { getContributorPRs } from "./queries";
import { createStep } from "../types";
import { db } from "@/lib/data/db";
import { tags, userTagScores } from "@/lib/data/schema";
import { ContributorPipelineContext } from "./context";
import { UTCDate } from "@date-fns/utc";
import { calculateLevelStats } from "@/lib/skillsHelpers";
// --- Tag processors ---
/**
 * Calculate expertise areas for a contributor
 */

export const calculateTags = createStep(
  "calculateTags",
  async (
    { username }: { username: string },
    { config, dateRange, logger }: ContributorPipelineContext,
  ) => {
    // Fetch data
    const contributorPRs = await getContributorPRs(username, {
      dateRange,
    });

    // Skip if no PRs found
    if (contributorPRs.length === 0) {
      logger?.debug(`${username}: No PRs found, skipping tag calculation`);
      return null;
    }

    // Extract file paths and titles
    const filePaths = contributorPRs.flatMap((pr) =>
      pr.files ? pr.files.map((f) => f.path as string) : [],
    );
    const prTitles = contributorPRs.map((pr) => pr.title || "").filter(Boolean);
    logger?.info(
      `${username}: Processing ${filePaths.length} files and ${prTitles.length} PR titles`,
    );

    // Calculate tags based on config
    const allTags = [
      ...config.tags.area,
      ...config.tags.role,
      ...config.tags.tech,
    ];
    const tagScores: Record<string, { score: number; category: string }> = {};

    // Apply tag rules to file paths and PR titles
    for (const rule of allTags) {
      let score = 0;

      // Check file paths for matches
      if (rule.category === "AREA" || rule.category === "TECH") {
        for (const pattern of rule.patterns) {
          for (const filePath of filePaths) {
            if (filePath.toLowerCase().includes(pattern.toLowerCase())) {
              score += rule.weight;
            }
          }
        }
      }

      // Check PR titles for matches
      if (rule.category === "ROLE" || rule.category === "TECH") {
        for (const pattern of rule.patterns) {
          for (const title of prTitles) {
            if (title.toLowerCase().includes(pattern.toLowerCase())) {
              score += rule.weight;
            }
          }
        }
      }

      if (score > 0) {
        logger?.trace(`Tag ${rule.name} scored ${score} points`);
        tagScores[rule.name] = {
          score,
          category: rule.category,
        };
      }
    }

    // Calculate levels and progress for each tag
    const expertiseAreas = Object.entries(tagScores)
      .map(([tag, { score, category }]) => {
        const { level, progress, xpToNextLevel } = calculateLevelStats(score);

        // Store in database
        storeTagScore(
          username,
          tag,
          category,
          score,
          level,
          progress,
          xpToNextLevel,
        );

        return {
          tag,
          category,
          score,
          level,
          progress,
        };
      })
      .sort((a, b) => b.score - a.score);
    // Log summary of expertise areas
    const topAreas = expertiseAreas
      .slice(0, 3)
      .map((area) => `${area.tag} (${area.score})`)
      .join(", ");

    logger?.info(`${username} has ${expertiseAreas.length} expertise areas.`, {
      topAreas,
    });

    const stats = {
      tagCount: expertiseAreas.length,
      numPrsProcessed: prTitles.length,
      topAreas,
    };
    return stats;
  },
);

/**
 * Store tag score in the database
 */
export async function storeTagScore(
  username: string,
  tag: string,
  category: string,
  score: number,
  level: number,
  progress: number,
  pointsToNext: number,
): Promise<void> {
  // Ensure tag exists in database
  await db
    .insert(tags)
    .values({
      name: tag,
      category,
      description: "",
      createdAt: new UTCDate().toISOString(),
      lastUpdated: new UTCDate().toISOString(),
    })
    .onConflictDoNothing({
      target: tags.name,
    });

  // Store user tag score
  await db
    .insert(userTagScores)
    .values({
      id: `${username}_${tag}`,
      username,
      tag,
      score,
      level,
      progress,
      pointsToNext,
    })
    .onConflictDoUpdate({
      target: userTagScores.id,
      set: {
        score,
        level,
        progress,
        pointsToNext,
      },
    });
}
