import { createStep, RepoPipelineContext } from "./types";
import {
  IntervalType,
  TimeInterval,
  toDateString,
  generateTimeIntervalsForDateRange,
} from "@/lib/date-utils";
import { UTCDate } from "@date-fns/utc";
import { subDays } from "date-fns";

/**
 * Creates a pipeline step to generate time intervals for a repository with a specific interval type
 */
export const generateTimeIntervals = <TInput extends Record<string, unknown>>(
  intervalType: IntervalType,
) =>
  createStep<
    TInput,
    Array<TInput & { interval: TimeInterval }>,
    RepoPipelineContext
  >(
    "generateTimeIntervals",
    (input: TInput, { dateRange: dateRangeInput, logger, config }) => {
      const defaultStartDate = toDateString(subDays(new UTCDate(), 7));
      const dateRange = {
        startDate:
          dateRangeInput?.startDate ||
          config.contributionStartDate ||
          defaultStartDate,
        endDate: dateRangeInput?.endDate,
      };

      logger?.debug("Generating time intervals", {
        dateRange,
        intervalType,
      });

      const intervals = generateTimeIntervalsForDateRange(
        intervalType,
        dateRange,
      );

      logger?.debug(`Generated ${intervals.length} intervals`, {
        intervals: intervals.map((interval) => ({
          intervalStart: toDateString(interval.intervalStart),
          intervalEnd: toDateString(interval.intervalEnd),
        })),
      });

      return intervals.map((interval) => ({ ...input, interval }));
    },
  );
