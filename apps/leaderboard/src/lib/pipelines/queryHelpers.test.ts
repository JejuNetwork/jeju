import { describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import Database from "bun:sqlite";
import { and } from "drizzle-orm";
import {
  buildCommonWhereConditions,
  getDateRangeForPeriod,
  formatPeriodLabel,
} from "./queryHelpers";
import { rawPullRequests } from "../data/schema";
import { toDateString } from "../date-utils";
import { UTCDate } from "@date-fns/utc";
import {
  startOfWeek,
  startOfMonth,
  startOfQuarter,
  startOfYear,
} from "date-fns";

// Create a dummy db instance to use the SQL compiler
const db = drizzle(new Database(":memory:"));

describe("buildCommonWhereConditions", () => {
  it("should return an empty array if no params are provided", () => {
    const conditions = buildCommonWhereConditions({}, rawPullRequests, [
      "createdAt",
    ]);
    expect(conditions).toEqual([]);
  });

  it("should build date range conditions", () => {
    const dateRange = { startDate: "2024-01-01", endDate: "2024-01-31" };
    const conditions = buildCommonWhereConditions(
      { dateRange },
      rawPullRequests,
      ["createdAt"],
    );
    expect(conditions.length).toBe(1);

    const query = db.select().from(rawPullRequests).where(conditions[0]);
    const { sql: querySql, params } = query.toSQL();

    expect(querySql).toMatch(
      /where \("raw_pull_requests"\."created_at" >= \? and "raw_pull_requests"\."created_at" < \?\)/i,
    );
    expect(params).toEqual(["2024-01-01", "2024-01-31"]);
  });

  it("should build repository condition", () => {
    const repository = "test-repo";
    const conditions = buildCommonWhereConditions(
      { repository },
      rawPullRequests,
      [],
    );
    expect(conditions.length).toBe(1);

    const query = db.select().from(rawPullRequests).where(conditions[0]);
    const { sql: querySql, params } = query.toSQL();

    expect(querySql).toMatch(/where "raw_pull_requests"\."repository" = \?/i);
    expect(params).toEqual([repository]);
  });

  it("should build both date range and repository conditions", () => {
    const dateRange = { startDate: "2024-01-01", endDate: "2024-01-31" };
    const repository = "test-repo";
    const conditions = buildCommonWhereConditions(
      { dateRange, repository },
      rawPullRequests,
      ["createdAt"],
    );
    expect(conditions.length).toBe(2);

    const query = db
      .select()
      .from(rawPullRequests)
      .where(and(...conditions));
    const { sql: querySql, params } = query.toSQL();

    expect(querySql).toMatch(
      /where \(\("raw_pull_requests"\."created_at" >= \? and "raw_pull_requests"\."created_at" < \?\) and "raw_pull_requests"\."repository" = \?\)/i,
    );
    expect(params).toEqual(["2024-01-01", "2024-01-31", "test-repo"]);
  });
});

describe("getDateRangeForPeriod", () => {
  it("should return an empty object for 'all'", () => {
    const range = getDateRangeForPeriod("all");
    expect(range).toEqual({});
  });

  it("should return the correct range for 'daily'", () => {
    const today = new UTCDate();
    const range = getDateRangeForPeriod("daily");
    expect(range.startDate).toBe(toDateString(today));
    expect(range.endDate).toBe(toDateString(today));
  });

  it("should return the correct range for 'weekly'", () => {
    const today = new UTCDate();
    const start = startOfWeek(today);
    const range = getDateRangeForPeriod("weekly");
    expect(range.startDate).toBe(toDateString(start));
    expect(range.endDate).toBe(toDateString(today));
  });

  it("should return the correct range for 'monthly'", () => {
    const today = new UTCDate();
    const start = startOfMonth(today);
    const range = getDateRangeForPeriod("monthly");
    expect(range.startDate).toBe(toDateString(start));
    expect(range.endDate).toBe(toDateString(today));
  });

  it("should return the correct range for 'quarterly'", () => {
    const today = new UTCDate();
    const start = startOfQuarter(today);
    const range = getDateRangeForPeriod("quarterly");
    expect(range.startDate).toBe(toDateString(start));
    expect(range.endDate).toBe(toDateString(today));
  });

  it("should return the correct range for 'yearly'", () => {
    const today = new UTCDate();
    const start = startOfYear(today);
    const range = getDateRangeForPeriod("yearly");
    expect(range.startDate).toBe(toDateString(start));
    expect(range.endDate).toBe(toDateString(today));
  });
});

describe("formatPeriodLabel", () => {
  it("should format daily period", () => {
    const query = formatPeriodLabel(rawPullRequests.createdAt, "daily");
    const { sql: querySql } = db
      .select({ f: query })
      .from(rawPullRequests)
      .toSQL();
    expect(querySql).toBe('select "created_at" from "raw_pull_requests"');
  });

  it("should format weekly period", () => {
    const query = formatPeriodLabel(rawPullRequests.createdAt, "weekly");
    const { sql: querySql } = db
      .select({ f: query })
      .from(rawPullRequests)
      .toSQL();
    expect(querySql).toBe(
      'select strftime(\'%Y-W%W\', "created_at") from "raw_pull_requests"',
    );
  });

  it("should format monthly period", () => {
    const query = formatPeriodLabel(rawPullRequests.createdAt, "monthly");
    const { sql: querySql } = db
      .select({ f: query })
      .from(rawPullRequests)
      .toSQL();
    expect(querySql).toBe(
      'select substr("created_at", 1, 7) from "raw_pull_requests"',
    );
  });

  it("should format quarterly period", () => {
    const query = formatPeriodLabel(rawPullRequests.createdAt, "quarterly");
    const { sql: querySql } = db
      .select({ f: query })
      .from(rawPullRequests)
      .toSQL();
    expect(querySql.replace(/\s+/g, " ")).toBe(
      'select substr("created_at", 1, 4) || \'-Q\' || (cast(substr("created_at", 6, 2) as integer) + 2) / 3 from "raw_pull_requests"',
    );
  });

  it("should format yearly period", () => {
    const query = formatPeriodLabel(rawPullRequests.createdAt, "yearly");
    const { sql: querySql } = db
      .select({ f: query })
      .from(rawPullRequests)
      .toSQL();
    expect(querySql).toBe(
      'select substr("created_at", 1, 4) from "raw_pull_requests"',
    );
  });
});
