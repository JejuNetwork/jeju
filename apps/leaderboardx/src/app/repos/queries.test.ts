import { describe, expect, it, mock, beforeEach } from "bun:test";
import { setupTestDb } from "@/../src/__testing__/helpers/db";
import { getRepositories } from "./queries";
import * as schema from "@/lib/data/schema";
import {
  generateMockUsers,
  generateMockPullRequests,
  generateMockIssues,
  generateMockUserDailyScores,
  generateMockRepositories,
  generateMockCommits,
} from "@/../src/__testing__/helpers/mock-data";
import { UTCDate } from "@date-fns/utc";
import { subDays, format } from "date-fns";

describe("Repository queries", () => {
  describe("getRepositories", () => {
    let db: ReturnType<typeof setupTestDb>;
    const today = new UTCDate();
    const recentDate = subDays(today, 10);
    const oldDate = subDays(today, 100);

    beforeEach(async () => {
      db = setupTestDb();
      mock.module("@/lib/data/db", () => ({ db }));

      // Repositories
      await db.insert(schema.repositories).values(
        generateMockRepositories([
          {
            repoId: "test/repo-1",
            owner: "test",
            name: "repo-1",
            description: "First test repo",
            stars: 100,
          },
          {
            repoId: "test/repo-2",
            owner: "test",
            name: "repo-2",
            description: "Second test repo",
            stars: 50,
          },
        ]),
      );

      // Users
      const users = generateMockUsers([
        { username: "user1" },
        { username: "user2" },
        { username: "user3" },
      ]);
      await db.insert(schema.users).values(users);

      // Scores (for top contributors)
      const scores = generateMockUserDailyScores([
        { username: "user1", score: 100 },
        { username: "user2", score: 200 }, // top contributor
        { username: "user3", score: 50 },
      ]);
      await db.insert(schema.userDailyScores).values(scores);

      // Pull Requests
      const prs = generateMockPullRequests([
        // Repo 1
        {
          repository: "test/repo-1",
          author: "user1",
          state: "OPEN",
          createdAt: format(recentDate, "yyyy-MM-dd"),
        },
        {
          repository: "test/repo-1",
          author: "user2",
          state: "MERGED",
          merged: 1,
          createdAt: format(recentDate, "yyyy-MM-dd"),
        },
        {
          repository: "test/repo-1",
          author: "user1",
          state: "CLOSED",
          createdAt: format(oldDate, "yyyy-MM-dd"),
        }, // old PR, shouldn't count in contributors
        // Repo 2
        {
          repository: "test/repo-2",
          author: "user3",
          state: "OPEN",
          createdAt: format(recentDate, "yyyy-MM-dd"),
        },
      ]);
      await db.insert(schema.rawPullRequests).values(prs);

      // Issues
      const issues = generateMockIssues([
        // Repo 1
        {
          repository: "test/repo-1",
          author: "user3",
          state: "OPEN",
          createdAt: format(recentDate, "yyyy-MM-dd"),
        },
        {
          repository: "test/repo-1",
          author: "user2",
          state: "CLOSED",
          createdAt: format(recentDate, "yyyy-MM-dd"),
        },
        // Repo 2 - no issues
      ]);
      await db.insert(schema.rawIssues).values(issues);

      // Commits
      const commits = generateMockCommits([
        // Repo 1
        {
          repository: "test/repo-1",
          author: "user1",
          committedDate: format(recentDate, "yyyy-MM-dd"),
        },
        {
          repository: "test/repo-1",
          author: "user2",
          committedDate: format(recentDate, "yyyy-MM-dd"),
        },
        {
          repository: "test/repo-1",
          author: "user1",
          committedDate: format(oldDate, "yyyy-MM-dd"),
        }, // old commit
        // Repo 2
        {
          repository: "test/repo-2",
          author: "user3",
          committedDate: format(oldDate, "yyyy-MM-dd"),
        }, // old commit
      ]);
      await db.insert(schema.rawCommits).values(commits);
    });

    it("should return a list of repositories sorted by contributor count", async () => {
      const repositories = await getRepositories();

      expect(repositories.length).toBe(2);
      // repo-1 has 3 recent contributors (user1, user2, user3), repo-2 has 1 (user3)
      expect(repositories[0].id).toBe("test/repo-1");
      expect(repositories[1].id).toBe("test/repo-2");
    });

    it("should return comprehensive and correct stats for each repository", async () => {
      const repositories = await getRepositories();

      const repo1 = repositories.find((r) => r.id === "test/repo-1");
      expect(repo1).toBeDefined();

      // Basic info
      expect(repo1?.name).toBe("repo-1");
      expect(repo1?.owner).toBe("test");
      expect(repo1?.description).toBe("First test repo");
      expect(repo1?.stars).toBe(100);

      // Counts
      expect(repo1?.openIssues).toBe(1);
      expect(repo1?.openPullRequests).toBe(1);
      expect(repo1?.mergedPullRequests).toBe(1);
      expect(repo1?.totalPullRequests).toBe(3);
      expect(repo1?.totalIssues).toBe(2);
      expect(repo1?.totalCommits).toBe(2); // Only recent commits

      // Contributors
      // user1 (recent PR), user2 (recent PR), user3 (recent issue)
      expect(repo1?.totalContributors).toBe(3);
      expect(repo1?.topContributors.length).toBe(3);
      expect(repo1?.topContributors[0].username).toBe("user2"); // Highest score
      expect(repo1?.topContributors[1].username).toBe("user1");
      expect(repo1?.topContributors[2].username).toBe("user3");

      // Dates and Activity
      expect(repo1?.lastUpdated).toBe(format(recentDate, "yyyy-MM-dd"));
      expect(repo1?.weeklyCommitCounts.length).toBeGreaterThan(0);

      const repo2 = repositories.find((r) => r.id === "test/repo-2");
      expect(repo2).toBeDefined();

      // Basic info
      expect(repo2?.name).toBe("repo-2");
      expect(repo2?.stars).toBe(50);

      // Counts
      expect(repo2?.openIssues).toBe(0);
      expect(repo2?.openPullRequests).toBe(1);
      expect(repo2?.mergedPullRequests).toBe(0);
      expect(repo2?.totalPullRequests).toBe(1);
      expect(repo2?.totalIssues).toBe(0);
      expect(repo2?.totalCommits).toBe(0); // No recent commits

      // Contributors
      // user3 (recent PR)
      expect(repo2?.totalContributors).toBe(1);
      expect(repo2?.topContributors.length).toBe(1);
      expect(repo2?.topContributors[0].username).toBe("user3");

      // Dates and Activity
      expect(repo2?.lastUpdated).toBe(format(oldDate, "yyyy-MM-dd"));
      expect(repo2?.weeklyCommitCounts.length).toBeGreaterThan(0);
    });
  });
});
