import { describe, it, expect } from "bun:test";
import {
  calculateIntervalBoundaries,
  findAdjacentIntervals,
  getIntervalTypeFromDateRange,
  isValidDateString,
  IntervalType,
  parseIntervalDate,
} from "./date-utils";
import { UTCDate } from "@date-fns/utc";

describe("date-utils", () => {
  describe("parseIntervalDate", () => {
    const validCases = [
      ["day", "2024-01-15", "2024-01-15T00:00:00.000Z"],
      ["week", "2024-01-15", "2024-01-14T00:00:00.000Z"], // week starts on Sunday
      ["month", "2024-02", "2024-02-01T00:00:00.000Z"],
    ];

    it.each(validCases)(
      "should correctly parse valid %s interval: %s",
      (type, dateStr, expected) => {
        const result = parseIntervalDate(dateStr, type as IntervalType);
        expect(result?.intervalStart.toISOString()).toBe(expected);
      },
    );

    const invalidCases: [IntervalType, string][] = [
      ["day", "2024-1-15"],
      ["week", "2024-01-5"],
      ["month", "2024-2"],
      ["month", "2024/02"],
    ];

    it.each(invalidCases)(
      "should return null for invalid %s interval: %s",
      (type, dateStr) => {
        const result = parseIntervalDate(dateStr, type as IntervalType);
        expect(result).toBeNull();
      },
    );
  });

  describe("calculateIntervalBoundaries", () => {
    it('should calculate correct boundaries for a "day" interval', () => {
      const date = new UTCDate("2024-07-15T10:00:00.000Z");
      const { intervalStart, intervalEnd } = calculateIntervalBoundaries(
        date,
        "day",
      );
      expect(intervalStart.toISOString()).toBe("2024-07-15T00:00:00.000Z");
      expect(intervalEnd.toISOString()).toBe("2024-07-16T00:00:00.000Z");
    });

    it('should calculate correct boundaries for a "week" interval, starting on Sunday', () => {
      // Wednesday
      const date = new UTCDate("2024-07-17T10:00:00.000Z");
      const { intervalStart, intervalEnd } = calculateIntervalBoundaries(
        date,
        "week",
      );
      expect(intervalStart.toISOString()).toBe("2024-07-14T00:00:00.000Z"); // Sunday
      expect(intervalEnd.toISOString()).toBe("2024-07-21T00:00:00.000Z"); // Next Sunday
    });

    it('should calculate correct boundaries for a "month" interval, starting on the 1st', () => {
      const date = new UTCDate("2024-07-17T10:00:00.000Z");
      const { intervalStart, intervalEnd } = calculateIntervalBoundaries(
        date,
        "month",
      );
      expect(intervalStart.toISOString()).toBe("2024-07-01T00:00:00.000Z");
      expect(intervalEnd.toISOString()).toBe("2024-08-01T00:00:00.000Z");
    });

    it("should handle month boundaries at the end of a year", () => {
      const date = new UTCDate("2024-12-25T10:00:00.000Z");
      const { intervalStart, intervalEnd } = calculateIntervalBoundaries(
        date,
        "month",
      );
      expect(intervalStart.toISOString()).toBe("2024-12-01T00:00:00.000Z");
      expect(intervalEnd.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    });
  });

  describe("findAdjacentIntervals", () => {
    const latestDate = "2024-07-20";

    it("should find the correct previous and next day", () => {
      const currentInterval = {
        intervalStart: new UTCDate("2024-07-15"),
        intervalEnd: new UTCDate("2024-07-16"),
        intervalType: "day" as IntervalType,
      };
      const { prevDate, nextDate } = findAdjacentIntervals(
        currentInterval,
        latestDate,
      );
      expect(prevDate).toBe("2024-07-14");
      expect(nextDate).toBe("2024-07-16");
    });

    it("should return null for nextDate when at the end of the range", () => {
      const currentInterval = {
        intervalStart: new UTCDate("2024-07-20"),
        intervalEnd: new UTCDate("2024-07-21"),
        intervalType: "day" as IntervalType,
      };
      const { prevDate, nextDate } = findAdjacentIntervals(
        currentInterval,
        latestDate,
      );
      expect(prevDate).toBe("2024-07-19");
      expect(nextDate).toBeNull();
    });
  });

  describe("getIntervalTypeFromDateRange", () => {
    it('should return "day" for a 1-day difference', () => {
      const range = { startDate: "2024-01-01", endDate: "2024-01-02" };
      expect(getIntervalTypeFromDateRange(range)).toBe("day");
    });

    it('should return "week" for a 7-day difference', () => {
      const range = { startDate: "2024-01-01", endDate: "2024-01-08" };
      expect(getIntervalTypeFromDateRange(range)).toBe("week");
    });

    it('should return "month" for a 30-day difference', () => {
      const range = { startDate: "2024-01-01", endDate: "2024-01-31" };
      expect(getIntervalTypeFromDateRange(range)).toBe("month");
    });
  });

  describe("isValidDateString", () => {
    it("should return true for a valid YYYY-MM-DD string", () => {
      expect(isValidDateString("2024-07-15")).toBe(true);
    });

    it("should return false for malformed strings and invalid dates", () => {
      expect(isValidDateString("2024-02-30")).toBe(false);
      expect(isValidDateString("2024/07/15")).toBe(false);
      expect(isValidDateString("15-07-2024")).toBe(false);
    });
  });
});
