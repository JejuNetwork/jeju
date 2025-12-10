import { describe, expect, it, beforeEach, mock } from "bun:test";
import { setupTestDb } from "@/__testing__/helpers/db";
import { getActiveContributors } from "./getActiveContributors";
import * as schema from "../data/schema";
import {
  generateMockUsers,
  generateMockPullRequests,
  generateMockIssues,
} from "@/__testing__/helpers/mock-data";

describe("getActiveContributors", () => {
  let db: ReturnType<typeof setupTestDb>;

  beforeEach(() => {
    db = setupTestDb();
    mock.module("../data/db", () => ({ db }));
  });

  it("should return contributors with open PRs in the date range", async () => {
    const users = generateMockUsers([
      { username: "user-a" },
      { username: "user-b" },
    ]);
    await db.insert(schema.users).values(users);
    const prs = generateMockPullRequests([
      { author: "user-a", createdAt: "2024-07-15" },
      { author: "user-b", createdAt: "2024-07-10" }, // Outside range
    ]);
    await db.insert(schema.rawPullRequests).values(prs);

    const active = await getActiveContributors({
      dateRange: { startDate: "2024-07-15", endDate: "2024-07-16" },
    });

    expect(active.length).toBe(1);
    expect(active[0].username).toBe("user-a");
  });

  it("should return contributors with created issues in the date range", async () => {
    const users = generateMockUsers([{ username: "user-c" }]);
    await db.insert(schema.users).values(users);
    const issues = generateMockIssues([
      { author: "user-c", createdAt: "2024-07-15" },
    ]);
    await db.insert(schema.rawIssues).values(issues);

    const active = await getActiveContributors({
      dateRange: { startDate: "2024-07-15", endDate: "2024-07-16" },
    });

    expect(active.length).toBe(1);
    expect(active[0].username).toBe("user-c");
  });

  it("should not return users who are bots", async () => {
    const users = generateMockUsers([{ username: "bot-user", isBot: 1 }]);
    await db.insert(schema.users).values(users);
    const prs = generateMockPullRequests([
      { author: "bot-user", createdAt: "2024-07-15" },
    ]);
    await db.insert(schema.rawPullRequests).values(prs);

    const active = await getActiveContributors({
      dateRange: { startDate: "2024-07-15", endDate: "2024-07-16" },
    });

    expect(active.length).toBe(0);
  });

  it("should correctly deduplicate users with multiple activities", async () => {
    const users = generateMockUsers([{ username: "multi-active" }]);
    await db.insert(schema.users).values(users);
    const prs = generateMockPullRequests([
      { author: "multi-active", createdAt: "2024-07-15" },
    ]);
    const issues = generateMockIssues([
      { author: "multi-active", createdAt: "2024-07-15" },
    ]);
    await db.insert(schema.rawPullRequests).values(prs);
    await db.insert(schema.rawIssues).values(issues);

    const active = await getActiveContributors({
      dateRange: { startDate: "2024-07-15", endDate: "2024-07-16" },
    });

    expect(active.length).toBe(1);
    expect(active[0].username).toBe("multi-active");
  });
});
