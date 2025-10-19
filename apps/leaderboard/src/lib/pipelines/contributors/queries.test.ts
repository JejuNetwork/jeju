import { describe, expect, it, beforeEach, mock } from "bun:test";
import { setupTestDb } from "@/__testing__/helpers/db";
import * as schema from "@/lib/data/schema";
import {
  generateMockUsers,
  generateMockPullRequests,
  generateMockIssues,
} from "@/__testing__/helpers/mock-data";
import {
  getContributorPRs,
  getContributorPRMetrics,
  getContributorIssueMetrics,
  getContributorReviewMetrics,
  getContributorCommentMetrics,
} from "./queries";

describe("Contributor Queries", () => {
  let db: ReturnType<typeof setupTestDb>;
  const testUser = { username: "test-user" };
  const baseDate = "2024-07-15";

  beforeEach(async () => {
    db = setupTestDb();
    mock.module("@/lib/data/db", () => ({ db }));
    await db.insert(schema.users).values(generateMockUsers([testUser]));
  });

  describe("getContributorPRs", () => {
    it("should fetch pull requests for a contributor", async () => {
      const prs = generateMockPullRequests([
        { author: testUser.username, createdAt: baseDate },
        { author: "another-user", createdAt: baseDate },
      ]);
      await db.insert(schema.rawPullRequests).values(prs);
      const result = await getContributorPRs(testUser.username);
      expect(result.length).toBe(1);
      expect(result[0].author).toBe(testUser.username);
    });
  });

  describe("getContributorPRMetrics", () => {
    it("should calculate correct PR metrics", async () => {
      const prs = generateMockPullRequests(
        [
          { author: testUser.username, state: "OPEN", additions: 100 },
          { author: testUser.username, state: "MERGED", additions: 50 },
          { author: testUser.username, state: "CLOSED", additions: 20 },
        ],
        baseDate,
      );
      await db.insert(schema.rawPullRequests).values(prs);
      const metrics = await getContributorPRMetrics(testUser.username);
      expect(metrics.total).toBe(3);
      expect(metrics.merged).toBe(1);
      expect(metrics.open).toBe(1);
      expect(metrics.closed).toBe(1);
      expect(metrics.additions).toBe(170);
    });
  });

  describe("getContributorIssueMetrics", () => {
    it("should calculate correct issue metrics", async () => {
      const issues = generateMockIssues(
        [
          { author: testUser.username, state: "OPEN" },
          { author: testUser.username, state: "CLOSED" },
        ],
        baseDate,
      );
      await db.insert(schema.rawIssues).values(issues);
      const metrics = await getContributorIssueMetrics(testUser.username);
      expect(metrics.total).toBe(2);
      expect(metrics.open).toBe(1);
      expect(metrics.closed).toBe(1);
    });
  });

  // NOTE: Review and Comment metrics will require more complex seeding
  // with PRs/Issues first, then reviews/comments linked to them.
  // This is a simplified test for now.

  describe("getContributorReviewMetrics", () => {
    it("should return zero metrics when no reviews", async () => {
      const metrics = await getContributorReviewMetrics(testUser.username);
      expect(metrics.total).toBe(0);
    });
  });

  describe("getContributorCommentMetrics", () => {
    it("should return zero metrics when no comments", async () => {
      const metrics = await getContributorCommentMetrics(testUser.username);
      expect(metrics.pullRequests).toBe(0);
      expect(metrics.issues).toBe(0);
    });
  });
});
