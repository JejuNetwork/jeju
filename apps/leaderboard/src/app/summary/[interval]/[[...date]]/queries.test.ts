import { describe, expect, it, beforeEach } from "bun:test";
import { setupTestDb } from "@/__testing__/helpers/db";
import { getMetricsForInterval } from "./queries";
import { IntervalType } from "@/lib/date-utils";
import * as schema from "@/lib/data/schema";
import {
  generateMockUsers,
  generateMockPullRequests,
  generateMockIssues,
} from "@/__testing__/helpers/mock-data";
import { toDateString } from "@/lib/date-utils";

describe.each([
  {
    intervalType: "day" as IntervalType,
    date: "2024-07-15",
    seeder: async (db: ReturnType<typeof setupTestDb>, date: string) => {
      const users1 = generateMockUsers([{}, {}]);
      const users2 = generateMockUsers([{}, {}]);
      await db.insert(schema.users).values([...users1, ...users2]);
      const repo1PRs = [
        ...generateMockPullRequests(
          [
            { repository: "repo-1", author: users1[0].username },
            { repository: "repo-1", author: users1[0].username },
          ],
          date,
        ),
        ...generateMockPullRequests(
          [
            {
              repository: "repo-1",
              state: "MERGED",
              author: users1[1].username,
            },
          ],
          date,
        ),
      ];
      const issues = [
        ...generateMockIssues(
          [
            { repository: "repo-1", state: "OPEN" },
            { repository: "repo-1", state: "CLOSED" },
            { repository: "repo-2", state: "OPEN" },
          ],
          date,
        ),
      ];
      await db.insert(schema.rawPullRequests).values(repo1PRs);
      await db.insert(schema.rawIssues).values(issues);
      const repo2PRs = [
        ...generateMockPullRequests(
          [
            { repository: "repo-2", author: users2[0].username },
            {
              repository: "repo-2",
              state: "MERGED",
              author: users2[1].username,
            },
          ],
          date,
        ),
      ];

      await db.insert(schema.rawPullRequests).values(repo2PRs);
    },
    expectedMetrics: {
      pullRequests: { new: 5, merged: 2, total: 5 },
      issues: { new: 3, closed: 1, total: 3 },
      activeContributors: 4,
    },
  },
  {
    intervalType: "week" as IntervalType,
    date: "2024-07-14", // Start of a week
    seeder: async (
      db: ReturnType<typeof setupTestDb>,
      weekStartDate: string,
    ) => {
      const users = generateMockUsers([{}, {}]);
      await db.insert(schema.users).values(users);

      const prs = [
        ...generateMockPullRequests(
          [{ repository: "repo-A", author: users[0].username }],
          new Date(weekStartDate),
        ),
        ...generateMockPullRequests(
          [
            {
              repository: "repo-B",
              author: users[1].username,
              state: "MERGED",
            },
          ],
          new Date(
            new Date(weekStartDate).setDate(
              new Date(weekStartDate).getDate() + 2,
            ),
          ),
        ),
      ];

      await db.insert(schema.rawPullRequests).values(prs);
      await db.insert(schema.rawIssues).values([
        ...generateMockIssues(
          [
            {
              repository: "repo-A",
              state: "CLOSED",
              closedAt: toDateString(
                new Date(
                  new Date(weekStartDate).setDate(
                    new Date(weekStartDate).getDate() + 1,
                  ),
                ),
              ),
            },
          ],
          new Date(
            new Date(weekStartDate).setDate(
              new Date(weekStartDate).getDate() + 1,
            ),
          ),
        ),
      ]);
    },
    expectedMetrics: {
      pullRequests: { new: 2, merged: 1, total: 2 },
      issues: { new: 1, closed: 1, total: 1 },
      activeContributors: 2,
    },
  },
  {
    intervalType: "month" as IntervalType,
    date: "2024-07-01",
    seeder: async (
      db: ReturnType<typeof setupTestDb>,
      monthStartDate: string,
    ) => {
      const users = generateMockUsers([{}, {}]);
      await db.insert(schema.users).values(users);
      await db.insert(schema.rawPullRequests).values([
        ...generateMockPullRequests(
          [
            { repository: "repo-A", author: users[0].username },
            { repository: "repo-A", author: users[0].username },
          ],
          new Date(monthStartDate),
        ),
        ...generateMockPullRequests(
          [
            {
              repository: "repo-B",
              author: users[1].username,
              state: "MERGED",
            },
          ],
          new Date(new Date(monthStartDate).setDate(15)),
        ),
      ]);
    },
    expectedMetrics: {
      pullRequests: { new: 3, merged: 1, total: 3 },
      issues: { new: 0, closed: 0, total: 0 },
      activeContributors: 2,
    },
  },
])(
  "getMetricsForInterval for $intervalType",
  ({ intervalType, date, seeder, expectedMetrics }) => {
    let testDb: ReturnType<typeof setupTestDb>;

    beforeEach(async () => {
      testDb = setupTestDb();
      await seeder(testDb, date);
    });

    it("should correctly aggregate pull request metrics", async () => {
      const metrics = await getMetricsForInterval(date, intervalType, testDb);
      expect(metrics.pullRequests.new).toBe(expectedMetrics.pullRequests.new);
      expect(metrics.pullRequests.merged).toBe(
        expectedMetrics.pullRequests.merged,
      );
      expect(metrics.pullRequests.total).toBe(
        expectedMetrics.pullRequests.total,
      );
    });

    it("should correctly aggregate issue metrics", async () => {
      const metrics = await getMetricsForInterval(date, intervalType, testDb);
      expect(metrics.issues.new).toBe(expectedMetrics.issues.new);
      expect(metrics.issues.closed).toBe(expectedMetrics.issues.closed);
      expect(metrics.issues.total).toBe(expectedMetrics.issues.total);
    });

    it("should correctly count active contributors", async () => {
      const metrics = await getMetricsForInterval(date, intervalType, testDb);
      expect(metrics.activeContributors).toBe(
        expectedMetrics.activeContributors,
      );
    });
  },
);

describe("getMetricsForInterval edge cases", () => {
  let testDb: ReturnType<typeof setupTestDb>;

  beforeEach(async () => {
    testDb = setupTestDb();
  });

  it("should throw an error when an invalid date string is provided", async () => {
    const invalidDate = "2024-99-99";
    await expect(getMetricsForInterval(invalidDate, "day", testDb)).rejects.toThrow(
      "Invalid date format for day interval. Expected YYYY-MM-DD",
    );
  });

  it("should return zero for all metrics when no activity occurred in the interval", async () => {
    const metrics = await getMetricsForInterval("2000-01-01", "day", testDb);
    expect(metrics.pullRequests.new).toBe(0);
    expect(metrics.issues.total).toBe(0);
    expect(metrics.activeContributors).toBe(0);
  });
});
