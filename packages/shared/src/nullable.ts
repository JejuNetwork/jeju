/**
 * Nullable Utilities
 *
 * Helper functions for converting between undefined and null.
 * These help maintain consistent null semantics across the codebase:
 * - TypeScript/JavaScript uses `undefined` for missing values (optional properties, array access)
 * - SQL/databases use `null` for missing values
 * - APIs should return `null` for "no value" rather than `undefined`
 */

/**
 * Get first element of array as T | null.
 * Use instead of `arr[0] ?? null` to convert undefined (empty array) to null.
 *
 * @example
 * ```ts
 * const items = await db.query<User>(sql)
 * return first(items) // User | null
 * ```
 */
export function first<T>(arr: T[]): T | null {
  const item = arr[0]
  return item !== undefined ? item : null
}

/**
 * Get last element of array as T | null.
 *
 * @example
 * ```ts
 * const messages = await getMessages()
 * return last(messages) // Message | null
 * ```
 */
export function last<T>(arr: T[]): T | null {
  const item = arr[arr.length - 1]
  return item !== undefined ? item : null
}

/**
 * Convert undefined to null for any value.
 * Use for optional properties that need to be null in the return type.
 *
 * @example
 * ```ts
 * // Instead of: user.bio ?? null
 * return toNull(user.bio) // string | null
 * ```
 */
export function toNull<T>(value: T | undefined): T | null {
  return value !== undefined ? value : null
}

/**
 * Convert null to undefined for any value.
 * Use when interfacing with APIs that expect undefined for missing values.
 *
 * @example
 * ```ts
 * // Instead of: value === null ? undefined : value
 * return toUndefined(dbValue) // string | undefined
 * ```
 */
export function toUndefined<T>(value: T | null): T | undefined {
  return value !== null ? value : undefined
}

/**
 * Get value from Map as T | null.
 * Use instead of `map.get(key) ?? null`.
 *
 * @example
 * ```ts
 * const cache = new Map<string, User>()
 * return mapGet(cache, id) // User | null
 * ```
 */
export function mapGet<K, V>(map: Map<K, V>, key: K): V | null {
  const value = map.get(key)
  return value !== undefined ? value : null
}

/**
 * Check if value is null or undefined.
 */
export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

/**
 * Check if value is neither null nor undefined.
 */
export function isNotNullish<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

/**
 * Convert a value to Date.
 * Handles Date objects, ISO strings, and timestamps from DB results.
 * Useful for DB queries where Date columns may return as string/number.
 *
 * @example
 * ```ts
 * const row = await db.select().from(users).where(...)
 * return { ...row, createdAt: toDate(row.createdAt) }
 * ```
 */
export function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * Convert a nullable value to Date or null.
 * Handles Date objects, ISO strings, timestamps, and null/undefined.
 *
 * @example
 * ```ts
 * const row = await db.select().from(users).where(...)
 * return { ...row, deletedAt: toDateOrNull(row.deletedAt) }
 * ```
 */
export function toDateOrNull(
  value: Date | string | number | null | undefined,
): Date | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value : new Date(value)
}
