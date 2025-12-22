/**
 * SQL Query Builder Utilities
 *
 * Provides helpers for building parameterized SQL queries from
 * ORM-style where/order/limit options. Used by both @jejunetwork/db
 * adapters and @babylon/db for consistent SQL generation.
 *
 * @example
 * ```typescript
 * import { buildWhereClause, buildOrderByClause } from '@jejunetwork/db';
 *
 * const params: QueryParam[] = [];
 * const { sql: whereSQL, newOffset } = buildWhereClause(
 *   { name: 'Alice', age: { gte: 18 } },
 *   params
 * );
 * // whereSQL = '"name" = $1 AND "age" >= $2'
 * // params = ['Alice', 18]
 * ```
 */

import type { QueryParam } from './types.js'

// ============================================================================
// Where Clause Types
// ============================================================================

type WhereValue<T> =
  | T
  | {
      equals?: T
      not?: T | { equals?: T }
      in?: T[]
      notIn?: T[]
      lt?: T
      lte?: T
      gt?: T
      gte?: T
      contains?: string
      startsWith?: string
      endsWith?: string
      mode?: 'insensitive'
    }
  | null
  | undefined

export type WhereInput<TTable> = {
  [K in keyof TTable]?: WhereValue<TTable[K]>
} & {
  AND?: WhereInput<TTable> | WhereInput<TTable>[]
  OR?: WhereInput<TTable>[]
  NOT?: WhereInput<TTable> | WhereInput<TTable>[]
}

export type OrderByInput<TTable> = {
  [K in keyof TTable]?: 'asc' | 'desc'
}

// ============================================================================
// Where Clause Builder
// ============================================================================

export interface WhereClauseResult {
  sql: string
  newOffset: number
}

/**
 * Build a parameterized WHERE clause from a WhereInput object.
 *
 * Supports operators: equals, not, in, notIn, lt, lte, gt, gte, contains, startsWith, endsWith
 * Supports logical operators: AND, OR, NOT
 * Uses PostgreSQL-style $N placeholders
 *
 * @param where - WhereInput object specifying conditions
 * @param params - Array to accumulate query parameters (mutated)
 * @param paramOffset - Starting parameter index (default 0)
 * @returns Object with sql string and newOffset for chaining
 */
export function buildWhereClause(
  where: Record<string, unknown> | undefined,
  params: QueryParam[],
  paramOffset = 0,
): WhereClauseResult {
  if (!where) return { sql: '', newOffset: paramOffset }

  const conditions: string[] = []
  let offset = paramOffset

  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND') {
      const andConditions = Array.isArray(value) ? value : [value]
      const andClauses: string[] = []
      for (const w of andConditions) {
        const result = buildWhereClause(
          w as Record<string, unknown>,
          params,
          offset,
        )
        if (result.sql) {
          andClauses.push(`(${result.sql})`)
          offset = result.newOffset
        }
      }
      if (andClauses.length > 0) {
        conditions.push(`(${andClauses.join(' AND ')})`)
      }
      continue
    }

    if (key === 'OR') {
      const orConditions = value as Record<string, unknown>[]
      const orClauses: string[] = []
      for (const w of orConditions) {
        const result = buildWhereClause(w, params, offset)
        if (result.sql) {
          orClauses.push(`(${result.sql})`)
          offset = result.newOffset
        }
      }
      if (orClauses.length > 0) {
        conditions.push(`(${orClauses.join(' OR ')})`)
      }
      continue
    }

    if (key === 'NOT') {
      const result = buildWhereClause(
        value as Record<string, unknown>,
        params,
        offset,
      )
      if (result.sql) {
        conditions.push(`NOT (${result.sql})`)
        offset = result.newOffset
      }
      continue
    }

    if (value === null) {
      conditions.push(`"${key}" IS NULL`)
      continue
    }

    if (value === undefined) continue

    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      const ops = value as Record<string, unknown>

      if ('equals' in ops) {
        if (ops.equals === null) {
          conditions.push(`"${key}" IS NULL`)
        } else {
          offset++
          params.push(ops.equals as QueryParam)
          conditions.push(`"${key}" = $${offset}`)
        }
      }
      if ('not' in ops) {
        if (ops.not === null) {
          conditions.push(`"${key}" IS NOT NULL`)
        } else if (
          typeof ops.not === 'object' &&
          ops.not !== null &&
          'equals' in ops.not
        ) {
          const notEqualsValue = (ops.not as { equals: unknown }).equals
          offset++
          params.push(notEqualsValue as QueryParam)
          conditions.push(`"${key}" != $${offset}`)
        } else {
          offset++
          params.push(ops.not as QueryParam)
          conditions.push(`"${key}" != $${offset}`)
        }
      }
      if ('in' in ops && Array.isArray(ops.in)) {
        const placeholders = ops.in.map(() => {
          offset++
          return `$${offset}`
        })
        params.push(...(ops.in as QueryParam[]))
        conditions.push(`"${key}" IN (${placeholders.join(', ')})`)
      }
      if ('notIn' in ops && Array.isArray(ops.notIn)) {
        const placeholders = ops.notIn.map(() => {
          offset++
          return `$${offset}`
        })
        params.push(...(ops.notIn as QueryParam[]))
        conditions.push(`"${key}" NOT IN (${placeholders.join(', ')})`)
      }
      if ('lt' in ops) {
        offset++
        params.push(ops.lt as QueryParam)
        conditions.push(`"${key}" < $${offset}`)
      }
      if ('lte' in ops) {
        offset++
        params.push(ops.lte as QueryParam)
        conditions.push(`"${key}" <= $${offset}`)
      }
      if ('gt' in ops) {
        offset++
        params.push(ops.gt as QueryParam)
        conditions.push(`"${key}" > $${offset}`)
      }
      if ('gte' in ops) {
        offset++
        params.push(ops.gte as QueryParam)
        conditions.push(`"${key}" >= $${offset}`)
      }
      if ('contains' in ops) {
        const mode = (ops as { mode?: string }).mode
        offset++
        params.push(`%${ops.contains}%`)
        if (mode === 'insensitive') {
          conditions.push(`"${key}" ILIKE $${offset}`)
        } else {
          conditions.push(`"${key}" LIKE $${offset}`)
        }
      }
      if ('startsWith' in ops) {
        const mode = (ops as { mode?: string }).mode
        offset++
        params.push(`${ops.startsWith}%`)
        if (mode === 'insensitive') {
          conditions.push(`"${key}" ILIKE $${offset}`)
        } else {
          conditions.push(`"${key}" LIKE $${offset}`)
        }
      }
      if ('endsWith' in ops) {
        const mode = (ops as { mode?: string }).mode
        offset++
        params.push(`%${ops.endsWith}`)
        if (mode === 'insensitive') {
          conditions.push(`"${key}" ILIKE $${offset}`)
        } else {
          conditions.push(`"${key}" LIKE $${offset}`)
        }
      }
    } else {
      offset++
      params.push(value as QueryParam)
      conditions.push(`"${key}" = $${offset}`)
    }
  }

  return {
    sql: conditions.length > 0 ? conditions.join(' AND ') : '',
    newOffset: offset,
  }
}

// ============================================================================
// Order By Clause Builder
// ============================================================================

/**
 * Build an ORDER BY clause from an OrderByInput object.
 *
 * @param orderBy - Single or array of orderBy objects
 * @returns SQL ORDER BY clause (including " ORDER BY " prefix) or empty string
 */
export function buildOrderByClause(
  orderBy:
    | OrderByInput<Record<string, unknown>>
    | OrderByInput<Record<string, unknown>>[]
    | undefined,
): string {
  if (!orderBy) return ''

  const orders = Array.isArray(orderBy) ? orderBy : [orderBy]
  const clauses: string[] = []

  for (const order of orders) {
    for (const [key, direction] of Object.entries(order)) {
      clauses.push(`"${key}" ${direction?.toUpperCase() ?? 'ASC'}`)
    }
  }

  return clauses.length > 0 ? ` ORDER BY ${clauses.join(', ')}` : ''
}

// ============================================================================
// Query Param Conversion
// ============================================================================

type SQLValue =
  | string
  | number
  | boolean
  | null
  | bigint
  | Uint8Array
  | Date
  | Record<string, unknown>
  | unknown[]

/**
 * Convert a value to a QueryParam, handling special types like Date and JSON objects.
 */
export function toQueryParam(value: SQLValue): QueryParam {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value
  }

  if (value instanceof Uint8Array) {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  return JSON.stringify(value)
}
