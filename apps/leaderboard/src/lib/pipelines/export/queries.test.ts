import { describe, expect, it, mock, beforeEach } from "bun:test";
import { setupTestDb } from "@/__testing__/helpers/db";
import {
  generateMockPullRequests,
  generateMockIssues,
  generateMockIssueComments,
  generateMockUsers,
  generateMockUserDailyScores,
  generateMockPullRequestFiles,
} from "@/__testing__/helpers/mock-data";
import {
  getTopPullRequests,
  getTopIssues,
  getTopContributors,
  getRepoMetrics,
} from "./queries";
import * as schema from "@/lib/data/schema";
import { toDateString } from "@/lib/date-utils";
import { UTCDate } from "@date-fns/utc";

describe("Export queries", () => {
  let db: ReturnType<typeof setupTestDb>;

  beforeEach(() => {
    db = setupTestDb();
    mock.module("@/lib/data/db", () => ({ db }));
  });

  describe("getTopPullRequests", () => {
    it("should return top pull requests ordered by additions", async () => {
      const prs = generateMockPullRequests([
        { repository: "test-repo", additions: 200 },
        { repository: "test-repo", additions: 100 },
        { repository: "test-repo", additions: 50 },
      ]);
      await db.insert(schema.rawPullRequests).values(prs);

      const result = await getTopPullRequests({ repository: "test-repo" });
      expect(result.length).toBe(3);
      expect(result[0].id).toBe(prs[0].id);
      expect(result[1].id).toBe(prs[1].id);
      expect(result[2].id).toBe(prs[2].id);
    });

    it("should respect the limit parameter", async () => {
      const prs = generateMockPullRequests([
        { repository: "test-repo", additions: 200 },
        { repository: "test-repo", additions: 100 },
        { repository: "test-repo", additions: 50 },
      ]);
      await db.insert(schema.rawPullRequests).values(prs);

      const result = await getTopPullRequests({ repository: "test-repo" }, 1);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(prs[0].id);
    });
  });

  describe("getTopIssues", () => {
    it("should return top issues ordered by comment count", async () => {
      const issues = generateMockIssues([{}, {}]);
      const issue1 = issues[0];
      const issue2 = issues[1];

      await db.insert(schema.rawIssues).values(issues);
      await db
        .insert(schema.issueComments)
        .values(generateMockIssueComments([{ issueId: issue1.id }]));
      await db
        .insert(schema.issueComments)
        .values(
          generateMockIssueComments([
            { issueId: issue2.id },
            { issueId: issue2.id },
          ]),
        );

      const result = await getTopIssues();
      expect(result.length).toBe(2);
      expect(result[0].id).toBe(issue2.id);
      expect(result[0].commentCount).toBe(2);
      expect(result[1].id).toBe(issue1.id);
      expect(result[1].commentCount).toBe(1);
    });

    it("should return an empty array when no data exists in the database", async () => {
      const result = await getTopIssues();
      expect(result).toEqual([]);
    });
  });

  describe("getTopContributors", () => {
    it("should return top contributors ordered by total score", async () => {
      const testUsers = generateMockUsers([{}, {}]);
      const user1 = testUsers[0];
      const user2 = testUsers[1];

      await db.insert(schema.users).values(testUsers);
      await db.insert(schema.userDailyScores).values(
        generateMockUserDailyScores([
          { username: user1.username, score: 100 },
          { username: user2.username, score: 50 },
        ]),
      );

      const result = await getTopContributors();
      expect(result.length).toBe(2);
      expect(result[0].username).toBe(user1.username);
      expect(result[0].totalScore).toBe(100);
      expect(result[1].username).toBe(user2.username);
      expect(result[1].totalScore).toBe(50);
    });

    it("should return contributors with a null summary if no summary exists for the interval", async () => {
      const testUsers = generateMockUsers([{}]);
      await db.insert(schema.users).values(testUsers);
      await db.insert(schema.userDailyScores).values(
        generateMockUserDailyScores(
          [
            {
              username: testUsers[0].username,
              score: 100,
            },
          ],
          "2024-01-15",
        ),
      );
      const result = await getTopContributors(
        {
          dateRange: { startDate: "2024-01-01", endDate: "2024-01-31" },
        },
        1,
      );
      expect(result.length).toBe(1);
      expect(result[0].summary).toBeNull();
    });
  });

  describe("getRepoMetrics", () => {
    const today = new UTCDate();
    const tomorrow = new UTCDate(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dateRange = {
      startDate: toDateString(today),
      endDate: toDateString(tomorrow),
    };
    const users = generateMockUsers([{}, {}]);
    const repoAPRs = generateMockPullRequests(
      [
        { repository: "repo-A", author: users[0].username },
        { repository: "repo-A", author: users[0].username },
      ],
      dateRange.startDate,
    );
    const repoBPRs = generateMockPullRequests(
      [
        { repository: "repo-B", author: users[1].username },
        { repository: "repo-B", author: users[1].username },
        { repository: "repo-B", author: users[1].username },
      ],
      dateRange.startDate,
    );

    const files = generateMockPullRequestFiles([
      {
        prId: repoAPRs[0].id,
        additions: 100,
        deletions: 20,
        path: "src/lib/tests/index.ts",
      },
    ]);

    it("should return correct pull request metrics", async () => {
      const allPRs = [
        ...repoAPRs,
        ...repoBPRs,
        ...generateMockPullRequests(
          [
            {
              repository: "repo-A",
              author: users[0].username,
              state: "MERGED",
            },
          ],
          dateRange.startDate,
        ),
      ];
      await db.insert(schema.rawPullRequests).values(allPRs);
      await db.insert(schema.rawPullRequestFiles).values(files);

      const metrics = await getRepoMetrics({ dateRange });
      expect(metrics.pullRequests.newPRs.length).toBe(6);
      expect(metrics.pullRequests.mergedPRs.length).toBe(1);
    });

    it("should return correct issue metrics", async () => {
      const issues = generateMockIssues(
        [
          {
            repository: "repo-A",
            state: "CLOSED",
          },
          {
            repository: "repo-B",
          },
          {
            repository: "repo-B",
          },
          {
            repository: "repo-A",
            createdAt: toDateString(
              new UTCDate(dateRange.startDate).setDate(
                new UTCDate(dateRange.startDate).getDate() - 1,
              ),
            ),
          },
        ],
        dateRange.startDate,
      );

      await db.insert(schema.rawIssues).values(issues);

      const metrics = await getRepoMetrics({ dateRange });
      expect(metrics.issues.newIssues.length).toBe(3);
      expect(metrics.issues.closedIssues.length).toBe(1);
    });

    it("should count unique contributors", async () => {
      await db.insert(schema.users).values(users);

      let metrics = await getRepoMetrics({ dateRange });
      expect(metrics.uniqueContributors).toBe(0); // no contributions yet
      expect(metrics.topContributors.length).toBe(0); // no scores yet

      await db
        .insert(schema.rawPullRequests)
        .values([...repoAPRs, ...repoBPRs]);
      metrics = await getRepoMetrics({ dateRange });
      expect(metrics.uniqueContributors).toBe(2);
      expect(metrics.topContributors.length).toBe(0); // no scores yet

      await db
        .insert(schema.userDailyScores)
        .values(generateMockUserDailyScores([{ username: users[0].username }]));

      metrics = await getRepoMetrics({ dateRange });
      expect(metrics.uniqueContributors).toBe(2);
      expect(metrics.topContributors.length).toBe(1);
    });

    it("should calculate code changes correctly", async () => {
      const mergedPRs = generateMockPullRequests(
        [
          {
            repository: "repo-A",
            author: users[0].username,
            state: "MERGED",
          },
        ],
        dateRange.startDate,
      );
      await db
        .insert(schema.rawPullRequests)
        .values([...repoAPRs, ...mergedPRs]);
      const files = generateMockPullRequestFiles([
        {
          prId: mergedPRs[0].id,
          additions: 100,
          deletions: 20,
          path: "src/client/index.ts",
        },
      ]);
      await db.insert(schema.rawPullRequestFiles).values(files);

      const metrics = await getRepoMetrics({ dateRange });
      expect(metrics.codeChanges.additions).toBe(100);
      expect(metrics.codeChanges.deletions).toBe(20);
      expect(metrics.codeChanges.files).toBe(1);
      expect(metrics.codeChanges.commitCount).toBe(0);
    });

    it("should calculate focus areas correctly", async () => {
      const mergedPRs = generateMockPullRequests(
        [
          {
            repository: "repo-A",
            author: users[0].username,
            state: "MERGED",
          },
        ],
        dateRange.startDate,
      );
      await db
        .insert(schema.rawPullRequests)
        .values([...repoAPRs, ...mergedPRs]);
      const files = generateMockPullRequestFiles([
        {
          prId: mergedPRs[0].id,
          additions: 100,
          deletions: 20,
          path: "src/lib/tests/index.ts",
        },
      ]);

      await db.insert(schema.rawPullRequestFiles).values(files);

      const metrics = await getRepoMetrics({ dateRange });
      expect(metrics.focusAreas.length).toBe(1);
      expect(metrics.focusAreas[0].area).toBe("src/lib");
    });

    it("should calculate completed items correctly", async () => {
      const mergedPRs = generateMockPullRequests(
        [
          {
            repository: "repo-A",
            author: users[0].username,
            state: "MERGED",
          },
          {
            repository: "repo-A",
            author: users[0].username,
            state: "MERGED",
          },
          {
            repository: "repo-A",
            author: users[0].username,
            state: "MERGED",
          },
        ],
        dateRange.startDate,
      );
      await db
        .insert(schema.rawPullRequests)
        .values([...repoAPRs, ...mergedPRs]);

      const metrics = await getRepoMetrics({ dateRange });
      expect(metrics.completedItems.length).toBe(3);
    });

    it("should return zero metrics for a date range with no activity", async () => {
      const emptyRange = {
        startDate: "2000-01-01",
        endDate: "2000-01-02",
      };
      const metrics = await getRepoMetrics({ dateRange: emptyRange });
      expect(metrics.pullRequests.newPRs.length).toBe(0);
      expect(metrics.issues.newIssues.length).toBe(0);
      expect(metrics.uniqueContributors).toBe(0);
    });

    it("should filter metrics by a specific repository when the repository parameter is provided", async () => {
      await db.insert(schema.rawPullRequests).values([
        ...repoAPRs,
        ...repoBPRs,
        ...generateMockPullRequests(
          [
            {
              repository: "repo-B",
              author: users[0].username,
              state: "MERGED",
            },
          ],
          dateRange.startDate,
        ),
      ]);
      await db.insert(schema.users).values(users);
      const metrics = await getRepoMetrics({
        dateRange,
        repository: "repo-A",
      });
      expect(metrics.pullRequests.newPRs.length).toBe(2);
      expect(metrics.uniqueContributors).toBe(1);
      expect(metrics.pullRequests.mergedPRs.length).toBe(0);
    });
  });
});
