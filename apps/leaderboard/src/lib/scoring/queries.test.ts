import { describe, expect, it, mock, beforeEach } from "bun:test";
import { setupTestDb } from "@/__testing__/helpers/db";
import {
  getScoresByTimePeriod,
  getUserAggregatedScore,
  getUserScoreTrend,
  getUserActivityHeatmaps,
  getTopUsersByScore,
} from "./queries";
import * as schema from "../data/schema";
import {
  generateMockUsers,
  generateMockUserDailyScores,
} from "@/__testing__/helpers/mock-data";
import { toDateString } from "@/lib/date-utils";
import { UTCDate } from "@date-fns/utc";

describe("Scoring queries", () => {
  let db: ReturnType<typeof setupTestDb>;

  beforeEach(() => {
    db = setupTestDb();
    mock.module("../data/db", () => ({ db }));
  });

  describe("getTopUsersByScore", () => {
    it("should return top users ordered descending by score", async () => {
      const users = generateMockUsers([{}, {}, {}]);
      await db.insert(schema.users).values(users);

      await db.insert(schema.userDailyScores).values(
        generateMockUserDailyScores([
          { username: users[0].username, score: 100 },
          { username: users[1].username, score: 200 },
          { username: users[2].username, score: 50 },
        ]),
      );

      const result = await getTopUsersByScore();
      expect(result.length).toBe(3);
      expect(result[0].username).toBe(users[1].username);
      expect(result[1].username).toBe(users[0].username);
      expect(result[2].username).toBe(users[2].username);
    });

    it("should respect the limit parameter when provided", async () => {
      const users = generateMockUsers([{}, {}]);
      await db.insert(schema.users).values(users);
      await db.insert(schema.userDailyScores).values(
        generateMockUserDailyScores([
          { username: users[0].username, score: 100 },
          { username: users[1].username, score: 200 },
        ]),
      );

      const result = await getTopUsersByScore(undefined, undefined, 1);
      expect(result.length).toBe(1);
      expect(result[0].username).toBe(users[1].username);
    });

    it("should filter users correctly by the given date range", async () => {
      const users = generateMockUsers([{}, {}]);
      await db.insert(schema.users).values(users);
      const today = new UTCDate();
      const yesterday = new UTCDate();
      yesterday.setDate(yesterday.getDate() - 1);

      await db
        .insert(schema.userDailyScores)
        .values([
          ...generateMockUserDailyScores(
            [{ username: users[0].username, score: 100 }],
            toDateString(today),
          ),
          ...generateMockUserDailyScores(
            [{ username: users[1].username, score: 200 }],
            toDateString(yesterday),
          ),
        ]);

      const result = await getTopUsersByScore(
        toDateString(today),
        toDateString(today),
      );
      expect(result.length).toBe(1);
      expect(result[0].username).toBe(users[0].username);
    });

    it("should exclude users that are flagged as bots", async () => {
      const users = generateMockUsers([{}, { isBot: 1 }]);
      await db.insert(schema.users).values(users);
      await db.insert(schema.userDailyScores).values(
        generateMockUserDailyScores([
          { username: users[0].username, score: 100 },
          { username: users[1].username, score: 500 }, // bot has higher score
        ]),
      );

      const result = await getTopUsersByScore();
      expect(result.length).toBe(1);
      expect(result[0].username).toBe(users[0].username);
    });

    it("should return an empty array if no user scores exist", async () => {
      const result = await getTopUsersByScore();
      expect(result.length).toBe(0);
    });
  });

  describe("getUserAggregatedScore", () => {
    it("should correctly sum all score types for a user in a date range", async () => {
      const user = generateMockUsers([{}])[0];
      await db.insert(schema.users).values([user]);
      await db.insert(schema.userDailyScores).values(
        generateMockUserDailyScores(
          [
            {
              username: user.username,
              score: 100,
              prScore: 50,
              issueScore: 20,
              reviewScore: 10,
              commentScore: 20,
              date: "2024-07-15",
            },
            {
              username: user.username,
              score: 50,
              prScore: 25,
              issueScore: 10,
              reviewScore: 5,
              commentScore: 10,
              date: "2024-07-16",
            },
          ],
          "2024-07-15",
        ),
      );

      const result = await getUserAggregatedScore(
        user.username,
        "2024-07-15",
        "2024-07-17",
        db,
      );
      expect(result.totalScore).toBe(150);
      expect(result.prScore).toBe(75);
      expect(result.issueScore).toBe(30);
      expect(result.reviewScore).toBe(15);
      expect(result.commentScore).toBe(30);
    });

    it("should return all zero scores for a user with no activity", async () => {
      const user = generateMockUsers([{}])[0];
      await db.insert(schema.users).values([user]);
      const result = await getUserAggregatedScore(
        user.username,
        "2024-07-15",
        "2024-07-16",
        db,
      );
      expect(result.totalScore).toBe(0);
      expect(result.prScore).toBe(0);
    });
  });

  describe("getScoresByTimePeriod", () => {
    it.each([["daily"], ["weekly"], ["monthly"]])(
      "should aggregate scores correctly for period: %s",
      async (period) => {
        const user = generateMockUsers([{}])[0];
        await db.insert(schema.users).values([user]);
        await db.insert(schema.userDailyScores).values(
          generateMockUserDailyScores([
            {
              username: user.username,
              score: 100,
              date: "2024-07-15",
            },
            {
              username: user.username,
              score: 50,
              date: "2024-07-16",
            },
          ]),
        );

        const result = await getScoresByTimePeriod(
          user.username,
          period as "daily" | "weekly" | "monthly",
          "2024-07-10",
          "2024-07-20",
          100,
          db,
        );

        if (period === "daily") {
          expect(result.length).toBe(2);
          expect(result[0].totalScore).toBe(100);
        } else {
          // weekly/monthly will be one entry
          expect(result.length).toBe(1);
          expect(result[0].totalScore).toBe(150);
        }
      },
    );
  });

  describe("getUserScoreTrend", () => {
    it("should calculate a running cumulative score correctly over the period", async () => {
      const user = generateMockUsers([{}])[0];
      await db.insert(schema.users).values([user]);
      await db.insert(schema.userDailyScores).values(
        generateMockUserDailyScores([
          { username: user.username, score: 100, date: "2024-07-15" },
          { username: user.username, score: 50, date: "2024-07-16" },
          { username: user.username, score: 75, date: "2024-07-17" },
        ]),
      );

      const result = await getUserScoreTrend(
        user.username,
        "daily",
        "2024-07-15",
        "2024-07-18",
        100,
        db,
      );
      expect(result.length).toBe(3);
      expect(result[0].cumulativeScore).toBe(100);
      expect(result[1].cumulativeScore).toBe(150);
      expect(result[2].cumulativeScore).toBe(225);
    });
  });

  describe("getUserActivityHeatmaps", () => {
    it("should return a value for every day in the range, even days with no activity", async () => {
      const user = generateMockUsers([{}])[0];
      await db.insert(schema.users).values([user]);
      await db.insert(schema.userDailyScores).values(
        generateMockUserDailyScores([
          {
            username: user.username,
            score: 100,
            date: "2024-07-15",
          },
        ]),
      );

      const result = await getUserActivityHeatmaps(
        user.username,
        "2024-07-14",
        "2024-07-16",
      );

      expect(result.length).toBe(3);
      expect(
        result.find((d: { date: string }) => d.date === "2024-07-14")?.value,
      ).toBe(0);
      expect(
        result.find((d: { date: string }) => d.date === "2024-07-15")?.value,
      ).toBe(100);
      expect(
        result.find((d: { date: string }) => d.date === "2024-07-16")?.value,
      ).toBe(0);
    });
  });
});
