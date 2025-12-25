/**
 * Generic type utilities and type-safe patterns for the codebase.
 *
 * These utilities reduce boilerplate and provide consistent type patterns.
 */

import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// Status Enum Pattern
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a status enum with Zod schema and type.
 * Use this to define consistent status types across the codebase.
 *
 * @example
 * const { Schema: OrderStatusSchema, Type: OrderStatus, values: ORDER_STATUSES } =
 *   createStatusEnum(['pending', 'processing', 'completed', 'failed'] as const)
 */
export function createStatusEnum<T extends readonly [string, ...string[]]>(
  values: T,
) {
  const Schema = z.enum(values)
  type Type = z.infer<typeof Schema>
  return {
    Schema,
    values,
    /** Check if a value is a valid status */
    is: (value: unknown): value is Type => Schema.safeParse(value).success,
  } as const
}

// ─────────────────────────────────────────────────────────────────────────────
// Result Type Pattern
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A discriminated union for success/error results.
 * Use instead of try/catch for type-safe error handling.
 */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E }

/** Create a success result */
export function ok<T>(data: T): Result<T, never> {
  return { success: true, data }
}

/** Create an error result */
export function err<E>(error: E): Result<never, E> {
  return { success: false, error }
}

/** Check if a result is successful */
export function isOk<T, E>(
  result: Result<T, E>,
): result is { success: true; data: T } {
  return result.success
}

/** Check if a result is an error */
export function isErr<T, E>(
  result: Result<T, E>,
): result is { success: false; error: E } {
  return !result.success
}

/** Unwrap a result or throw */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.success) return result.data
  throw result.error instanceof Error
    ? result.error
    : new Error(String(result.error))
}

/** Unwrap a result or return a default */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.success ? result.data : defaultValue
}

// ─────────────────────────────────────────────────────────────────────────────
// Branded Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a branded type for type-safe IDs and values.
 * Prevents mixing different string/number IDs at compile time.
 *
 * @example
 * type UserId = Brand<string, 'UserId'>
 * type PostId = Brand<string, 'PostId'>
 *
 * const userId: UserId = 'user_123' as UserId
 * const postId: PostId = 'post_456' as PostId
 * // userId = postId // ❌ Compile error!
 */
declare const __brand: unique symbol
export type Brand<T, B> = T & { [__brand]: B }

/** Create a branded value */
export function brand<T, B extends string>(value: T): Brand<T, B> {
  return value as Brand<T, B>
}

// Common branded types (prefixed with Branded to avoid conflicts)
export type BrandedEntityId = Brand<string, 'EntityId'>
export type BrandedSnowflake = Brand<string, 'Snowflake'>
export type BrandedCID = Brand<string, 'CID'>

// ─────────────────────────────────────────────────────────────────────────────
// Nullable/Optional Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Make all properties of T nullable */
export type Nullable<T> = { [K in keyof T]: T[K] | null }

/** Make all properties of T required and non-null */
export type NonNullableProps<T> = {
  [K in keyof T]: NonNullable<T[K]>
}

/** Extract only the required keys of T */
export type RequiredKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? never : K
}[keyof T]

/** Extract only the optional keys of T */
export type OptionalKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? K : never
}[keyof T]

// ─────────────────────────────────────────────────────────────────────────────
// Object Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Create a type with some properties made optional */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/** Create a type with some properties made required */
export type RequiredBy<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>

/** Create a type with all properties deeply partial */
export type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T

/** Create a type with all properties deeply readonly */
export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T

// ─────────────────────────────────────────────────────────────────────────────
// Type Guard Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a type guard from a Zod schema.
 * Use this when you need a type guard function for narrowing.
 *
 * @example
 * const isUser = createTypeGuard(UserSchema)
 * if (isUser(data)) {
 *   // data is typed as User
 * }
 */
export function createTypeGuard<T>(
  schema: z.ZodType<T>,
): (value: unknown) => value is T {
  return (value: unknown): value is T => schema.safeParse(value).success
}

/**
 * Create a type assertion from a Zod schema.
 * Throws if validation fails.
 *
 * @example
 * const assertUser = createTypeAssertion(UserSchema)
 * assertUser(data) // throws if invalid
 * // data is now typed as User
 */
export function createTypeAssertion<T>(
  schema: z.ZodType<T>,
  context?: string,
): (value: unknown) => asserts value is T {
  return (value: unknown): asserts value is T => {
    const result = schema.safeParse(value)
    if (!result.success) {
      const errors = result.error.issues.map((i) => i.message).join(', ')
      throw new Error(`${context ?? 'Validation'} failed: ${errors}`)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Async Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Extract the resolved type from a Promise */
export type Awaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T

/** A function that returns a Promise */
export type AsyncFn<TArgs extends unknown[], TReturn> = (
  ...args: TArgs
) => Promise<TReturn>

/** Make a sync function async */
export type Async<T extends (...args: unknown[]) => unknown> = (
  ...args: Parameters<T>
) => Promise<ReturnType<T>>

// ─────────────────────────────────────────────────────────────────────────────
// Callback and Disposable Types
// (EventHandler is exported from events.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Generic callback type */
export type Callback<T = void> = () => T | Promise<T>

/** Disposable resource pattern */
export interface Disposable {
  dispose(): void | Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Extract the element type from an array */
export type ArrayElement<T> = T extends readonly (infer E)[] ? E : never

/** Create a non-empty array type */
export type NonEmptyArray<T> = [T, ...T[]]

/** Check if array is non-empty (type guard) */
export function isNonEmpty<T>(arr: T[]): arr is NonEmptyArray<T> {
  return arr.length > 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Record Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Type-safe Object.keys */
export function typedKeys<T extends object>(obj: T): (keyof T)[] {
  return Object.keys(obj) as (keyof T)[]
}

/** Type-safe Object.entries */
export function typedEntries<T extends object>(
  obj: T,
): [keyof T, T[keyof T]][] {
  return Object.entries(obj) as [keyof T, T[keyof T]][]
}

/** Create a record from an array using a key extractor */
export function keyBy<T, K extends string | number>(
  array: T[],
  keyFn: (item: T) => K,
): Record<K, T> {
  return array.reduce(
    (acc, item) => {
      acc[keyFn(item)] = item
      return acc
    },
    {} as Record<K, T>,
  )
}

/** Group an array by a key */
export function groupBy<T, K extends string | number>(
  array: T[],
  keyFn: (item: T) => K,
): Record<K, T[]> {
  return array.reduce(
    (acc, item) => {
      const key = keyFn(item)
      if (!acc[key]) acc[key] = []
      acc[key].push(item)
      return acc
    },
    {} as Record<K, T[]>,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema Factory Utilities
// See packages/types/src/api.ts for createApiResponseSchema, createPaginatedResponseSchema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrap a value parse result with a default fallback.
 * Use when parsing optional configuration values.
 */
export function parseOrDefault<T>(
  schema: z.ZodType<T>,
  value: unknown,
  defaultValue: T,
): T {
  const result = schema.safeParse(value)
  return result.success ? result.data : defaultValue
}
