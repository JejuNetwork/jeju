import { describe, expect, it, beforeEach, mock } from "bun:test";
import { setupTestDb } from "@/__testing__/helpers/db";
import * as schema from "@/lib/data/schema";
import {
  generateMockUsers,
  generateMockPullRequests,
  generateMockIssues,
  generateMockReviews,
  generateMockPRComments,
  generateMockIssueComments,
  generateMockCommits,
  generateMockPullRequestFiles,
  generateMockUserSummaries,
  generateMockRepoSummaries,
} from "@/__testing__/helpers/mock-data";
import {
  getContributorMetrics,
  getContributorSummariesForInterval,
  getRepoSummariesForInterval,
  getActiveReposInInterval,
  getAllRepoSummariesForInterval,
} from "./queries";
import { toDateString } from "@/lib/date-utils";
import { UTCDate } from "@date-fns/utc";

describe("Summarize Queries", () => {
  let db: ReturnType<typeof setupTestDb>;
  const testUser = { username: "test-user" };
  const testRepo = { id: "test-repo" };
  const baseDate = "2024-07-15";
  const interval = {
    intervalType: "day" as const,
    intervalStart: new UTCDate(baseDate),
    intervalEnd: new UTCDate("2024-07-16"),
  };

  beforeEach(async () => {
    db = setupTestDb();
    mock.module("@/lib/data/db", () => ({ db }));
    await db.insert(schema.users).values(generateMockUsers([testUser]));
  });

  describe("getContributorMetrics", () => {
    it("should calculate correct metrics for a contributor", async () => {
      const prs = generateMockPullRequests(
        [
          {
            id: "pr1",
            author: testUser.username,
            state: "MERGED",
            additions: 100,
            deletions: 20,
            mergedAt: "2024-07-15T12:00:00Z",
            createdAt: "2024-07-15T10:00:00Z",
          },
          { author: testUser.username, state: "OPEN", additions: 50 },
        ],
        baseDate,
      );
      await db.insert(schema.rawPullRequests).values(prs);

      await db.insert(schema.rawIssues).values(
        generateMockIssues(
          [
            { author: testUser.username, state: "OPEN" },
            { author: testUser.username, state: "CLOSED" },
          ],
          baseDate,
        ),
      );

      await db.insert(schema.prReviews).values(
        generateMockReviews(
          [
            { author: testUser.username, state: "APPROVED" },
            { author: testUser.username, state: "CHANGES_REQUESTED" },
            { author: testUser.username, state: "COMMENTED" },
          ],
          baseDate,
        ),
      );

      await db
        .insert(schema.prComments)
        .values(
          generateMockPRComments([{ author: testUser.username }], baseDate),
        );

      await db
        .insert(schema.issueComments)
        .values(
          generateMockIssueComments([{ author: testUser.username }], baseDate),
        );

      await db.insert(schema.rawCommits).values(
        generateMockCommits(
          [
            {
              author: testUser.username,
              additions: 10,
              deletions: 5,
              changedFiles: 1,
              message: "feat: new feature",
            },
          ],
          baseDate,
        ),
      );

      await db.insert(schema.rawPullRequestFiles).values(
        generateMockPullRequestFiles([
          { prId: "pr1", path: "src/index.ts" },
          { prId: "pr1", path: "src/index.test.ts" },
          { prId: "pr1", path: "README.md" },
          { prId: "pr1", path: "package.json" },
        ]),
      );

      const metrics = await getContributorMetrics({
        username: testUser.username,
        dateRange: { startDate: baseDate, endDate: "2024-07-16" },
      });

      // Pull Request Metrics
      expect(metrics.pullRequests.total).toBe(2);
      expect(metrics.pullRequests.merged).toBe(1);
      expect(metrics.pullRequests.open).toBe(1);
      expect(metrics.pullRequests.metrics.avgAdditions).toBe(100);
      expect(metrics.pullRequests.metrics.avgDeletions).toBe(20);
      expect(metrics.pullRequests.metrics.avgTimeToMerge).toBe(2);

      // Issue Metrics
      expect(metrics.issues.total).toBe(2);
      expect(metrics.issues.opened).toBe(2);
      expect(metrics.issues.closed).toBe(1);

      // Review Metrics
      expect(metrics.reviews.total).toBe(3);
      expect(metrics.reviews.approved).toBe(1);
      expect(metrics.reviews.changesRequested).toBe(1);
      expect(metrics.reviews.commented).toBe(1);

      // Comment Metrics
      expect(metrics.comments.prComments).toBe(1);
      expect(metrics.comments.issueComments).toBe(1);
      expect(metrics.comments.total).toBe(2);

      // Code Change Metrics
      expect(metrics.codeChanges.additions).toBe(10);
      expect(metrics.codeChanges.deletions).toBe(5);
      expect(metrics.codeChanges.files).toBe(1);
      expect(metrics.codeChanges.commitCount).toBe(1);
      expect(metrics.codeChanges.commitTypes.feature).toBe(1);

      // File Type Analysis
      expect(metrics.pullRequests.fileTypes.code).toBe(1);
      expect(metrics.pullRequests.fileTypes.tests).toBe(1);
      expect(metrics.pullRequests.fileTypes.docs).toBe(1);
      expect(metrics.pullRequests.fileTypes.config).toBe(1);

      // Activity Pattern
      expect(metrics.activityPattern.daysActive).toBe(1);
    });
  });

  describe("getContributorSummariesForInterval", () => {
    it("should retrieve summaries for given usernames and interval", async () => {
      await db.insert(schema.userSummaries).values(
        generateMockUserSummaries([
          {
            username: testUser.username,
            date: toDateString(interval.intervalStart),
            intervalType: "day",
            summary: "test summary",
          },
        ]),
      );
      const summaries = await getContributorSummariesForInterval(
        [testUser.username],
        interval,
      );
      expect(summaries.get(testUser.username)).toBe("test summary");
    });
  });

  describe("getRepoSummariesForInterval", () => {
    it("should retrieve daily summaries for a repo within an interval", async () => {
      await db.insert(schema.repoSummaries).values(
        generateMockRepoSummaries([
          {
            repoId: testRepo.id,
            date: "2024-07-15",
            intervalType: "day",
            summary: "daily summary",
          },
        ]),
      );
      const summaries = await getRepoSummariesForInterval(
        testRepo.id,
        interval,
      );
      expect(summaries.length).toBe(1);
      expect(summaries[0].summary).toBe("daily summary");
    });
  });

  describe("getActiveReposInInterval", () => {
    it("should find repos with PR activity in the interval", async () => {
      await db
        .insert(schema.rawPullRequests)
        .values(
          generateMockPullRequests(
            [{ repository: testRepo.id, createdAt: baseDate }],
            baseDate,
          ),
        );
      const activeRepos = await getActiveReposInInterval(interval);
      expect(activeRepos).toContain(testRepo.id);
    });
  });

  describe("getAllRepoSummariesForInterval", () => {
    it("should retrieve all repo summaries for a specific interval", async () => {
      await db.insert(schema.repoSummaries).values(
        generateMockRepoSummaries([
          {
            repoId: testRepo.id,
            date: toDateString(interval.intervalStart),
            intervalType: "day",
            summary: "repo summary",
          },
        ]),
      );
      const summaries = await getAllRepoSummariesForInterval(interval);
      expect(summaries.length).toBe(1);
      expect(summaries[0].summary).toBe("repo summary");
    });
  });
});
