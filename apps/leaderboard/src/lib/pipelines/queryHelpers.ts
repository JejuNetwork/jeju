import { SQL, sql, or } from "drizzle-orm";
import { DateRange } from "../data/types";
import { AnySQLiteTable, SQLiteColumn } from "drizzle-orm/sqlite-core";
import { UTCDate } from "@date-fns/utc";
import { toDateString } from "@/lib/date-utils";

/**
 * Helper function to build date range conditions for different date fields
 */
function buildDateRangeConditions<T extends AnySQLiteTable>(
  dateRange: DateRange,
  table: T,
  dateFields: (keyof T)[],
): SQL[] {
  if (!dateRange) return [];

  const { startDate, endDate } = dateRange;
  let dateConditions: SQL[] = [];
  if (startDate && endDate) {
    // If startDate and endDate are the same, use equality
    if (startDate === endDate) {
      dateConditions = dateFields.map(
        (field) => sql`${table[field]} = ${startDate}`,
      );
    } else {
      // Otherwise use range with exclusive end date (<)
      dateConditions = dateFields.map(
        (field) =>
          sql`${table[field]} >= ${startDate} AND ${table[field]} < ${endDate}`,
      );
    }
  } else if (startDate) {
    dateConditions = dateFields.map(
      (field) => sql`${table[field]} >= ${startDate}`,
    );
  } else if (endDate) {
    dateConditions = dateFields.map(
      (field) => sql`${table[field]} < ${endDate}`,
    );
  }

  if (dateConditions.length === 0) {
    return [];
  }
  // At least one date field should match the range
  return [sql`(${or(...dateConditions)})`];
}

/**
 * Helper function to build common where conditions based on query params
 */
export function buildCommonWhereConditions<T extends AnySQLiteTable>(
  params: QueryParams,
  table: T,
  dateFields: (keyof T)[],
): SQL[] {
  const conditions: SQL[] = [];

  if (params.dateRange && dateFields.length > 0) {
    conditions.push(
      ...buildDateRangeConditions(params.dateRange, table, dateFields),
    );
  }

  if (params.repository && "repository" in table) {
    // Use properly parameterized sql query for repository
    conditions.push(sql`${table.repository} = ${params.repository}`);
  }

  return conditions;
}

/**
 * Get a date range for common time periods
 *
 * @param period - Time period identifier ('daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'all')
 * @returns DateRange object with startDate and endDate strings
 */
export function getDateRangeForPeriod(
  period: "all" | "daily" | "weekly" | "monthly" | "quarterly" | "yearly",
): DateRange {
  if (period === "all") {
    return {};
  }

  const now = new UTCDate();
  const endDate = toDateString(now);
  let startDate: UTCDate;

  switch (period) {
    case "daily":
      // Just today
      startDate = now;
      break;
    case "weekly":
      // Start of current week (considering Sunday as first day)
      const day = now.getDay(); // 0 for Sunday, 1 for Monday, etc.
      startDate = new UTCDate(now);
      startDate.setDate(now.getDate() - day);
      break;
    case "monthly":
      // Start of current month
      startDate = new UTCDate(now.getFullYear(), now.getMonth(), 1);
      break;
    case "quarterly":
      // Start of current quarter
      const month = now.getMonth();
      const quarterStartMonth = Math.floor(month / 3) * 3;
      startDate = new UTCDate(now.getFullYear(), quarterStartMonth, 1);
      break;
    case "yearly":
      // Start of current year
      startDate = new UTCDate(now.getFullYear(), 0, 1);
      break;
    default:
      startDate = now;
  }

  return {
    startDate: toDateString(startDate),
    endDate,
  };
}

/**
 * Format a period identifier for time-based aggregations
 *
 * @param dateColumn - Date column to format
 * @param period - Aggregation period type
 * @returns SQL expression for the formatted period
 */
export function formatPeriodLabel(
  dateColumn: SQLiteColumn,
  period: "daily" | "weekly" | "monthly" | "quarterly" | "yearly",
): SQL<string> {
  switch (period) {
    case "daily":
      // Cast the column to SQL directly for the daily case
      return sql<string>`${dateColumn}`;
    case "weekly":
      return sql<string>`strftime('%Y-W%W', ${dateColumn})`;
    case "monthly":
      return sql<string>`substr(${dateColumn}, 1, 7)`;
    case "quarterly":
      return sql<string>`
        substr(${dateColumn}, 1, 4) || '-Q' || 
        (cast(substr(${dateColumn}, 6, 2) as integer) + 2) / 3
      `;
    case "yearly":
      return sql<string>`substr(${dateColumn}, 1, 4)`;
    default:
      return sql<string>`${dateColumn}`;
  }
}

export interface PaginatedQueryParams extends QueryParams {
  // Pagination
  limit?: number;
  offset?: number;
}

/**
 * Standard query parameters used across different queries
 */
export interface QueryParams {
  dateRange?: DateRange;
  repository?: string;
}
