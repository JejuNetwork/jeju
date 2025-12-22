/**
 * Shared utilities for CQL package
 */

import { z } from 'zod'

/**
 * SQL identifier pattern - only allows safe characters for table/column/index names.
 * Prevents SQL injection via identifier interpolation.
 *
 * Allowed: alphanumeric characters, underscores, starting with letter or underscore
 * Max length: 128 characters (standard SQL limit)
 */
const SQL_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/

/**
 * Validate a SQL identifier (table name, column name, index name).
 * Throws if the identifier contains unsafe characters.
 *
 * @param identifier - The identifier to validate
 * @param type - The type of identifier for error messages
 * @throws Error if the identifier is invalid
 */
export function validateSQLIdentifier(
  identifier: string,
  type: 'table' | 'column' | 'index' = 'table',
): string {
  if (!identifier || typeof identifier !== 'string') {
    throw new Error(`Invalid SQL ${type} name: must be a non-empty string`)
  }

  if (!SQL_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(
      `Invalid SQL ${type} name "${identifier}": must start with a letter or underscore, ` +
        `contain only alphanumeric characters and underscores, and be at most 128 characters`,
    )
  }

  const RESERVED_WORDS = new Set([
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'DROP',
    'CREATE',
    'ALTER',
    'TABLE',
    'INDEX',
    'FROM',
    'WHERE',
    'AND',
    'OR',
    'NOT',
    'NULL',
    'TRUE',
    'FALSE',
    'PRIMARY',
    'KEY',
    'FOREIGN',
    'REFERENCES',
    'UNIQUE',
    'CHECK',
    'DEFAULT',
    'CONSTRAINT',
    'CASCADE',
    'RESTRICT',
    'SET',
    'ADD',
    'COLUMN',
    'DATABASE',
  ])

  if (RESERVED_WORDS.has(identifier.toUpperCase())) {
    throw new Error(
      `Invalid SQL ${type} name "${identifier}": cannot use SQL reserved word`,
    )
  }

  return identifier
}

/**
 * Validate multiple SQL identifiers (e.g., column list).
 */
export function validateSQLIdentifiers(
  identifiers: string[],
  type: 'table' | 'column' | 'index' = 'column',
): string[] {
  return identifiers.map((id) => validateSQLIdentifier(id, type))
}

/**
 * SQL DEFAULT value pattern - only allows safe default values.
 * Prevents SQL injection via DEFAULT clause interpolation.
 *
 * Allowed patterns:
 * - Numeric literals: 0, 123, -456, 3.14, -0.5
 * - String literals: 'value', 'hello world' (properly quoted)
 * - Boolean: TRUE, FALSE
 * - NULL
 * - SQL functions: CURRENT_TIMESTAMP, CURRENT_DATE, CURRENT_TIME
 * - Expressions with simple parentheses: (expression)
 */
const SQL_DEFAULT_PATTERNS = [
  /^-?\d+(\.\d+)?$/, // Numeric: 0, 123, -456, 3.14
  /^'([^'\\]|\\'|'')*'$/, // String literals with escaped quotes
  /^(TRUE|FALSE|NULL)$/i, // Boolean and NULL
  /^CURRENT_(TIMESTAMP|DATE|TIME)$/i, // Date/time functions
  /^(datetime|date|time)\s*\(\s*'(now|localtime)'\s*\)$/i, // SQLite datetime functions
  /^\(\s*-?\d+(\.\d+)?\s*\)$/, // Parenthesized numbers
]

/**
 * Validate a SQL DEFAULT value to prevent injection.
 * Only allows safe literal values, not arbitrary expressions.
 *
 * @param value - The DEFAULT value to validate
 * @throws Error if the value is not a safe literal
 */
/**
 * Dangerous prototype pollution keys that should be stripped from database results
 */
const PROTOTYPE_POLLUTION_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
])

/**
 * Sanitize an object to prevent prototype pollution attacks.
 * Removes dangerous keys like __proto__, constructor, prototype.
 *
 * @param obj - The object to sanitize (typically a database row)
 * @returns A new object without dangerous keys
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = Object.create(null)

  for (const key of Object.keys(obj)) {
    if (!PROTOTYPE_POLLUTION_KEYS.has(key)) {
      result[key] = obj[key]
    }
  }

  return result as T
}

/**
 * Sanitize an array of objects to prevent prototype pollution attacks.
 *
 * @param rows - Array of database rows to sanitize
 * @returns A new array with sanitized objects
 */
export function sanitizeRows<T extends Record<string, unknown>>(
  rows: T[],
): T[] {
  return rows.map((row) => sanitizeObject(row))
}

export function validateSQLDefault(value: string): string {
  if (!value || typeof value !== 'string') {
    throw new Error('Invalid SQL DEFAULT value: must be a non-empty string')
  }

  const trimmed = value.trim()

  const isValid = SQL_DEFAULT_PATTERNS.some((pattern) => pattern.test(trimmed))

  if (!isValid) {
    throw new Error(
      `Invalid SQL DEFAULT value "${value}": must be a numeric literal, ` +
        `quoted string literal, TRUE/FALSE, NULL, or CURRENT_TIMESTAMP/DATE/TIME`,
    )
  }

  return trimmed
}

/**
 * Parse and validate a port number from an environment variable or default
 */
export function parsePort(
  envValue: string | undefined,
  defaultPort: number,
): number {
  if (!envValue) return defaultPort

  const parsed = parseInt(envValue, 10)
  const PortSchema = z.number().int().min(1).max(65535)
  return PortSchema.parse(parsed)
}

/**
 * Parse and validate a timeout value from an environment variable
 */
export function parseTimeout(
  envValue: string | undefined,
  defaultTimeout: number,
): number {
  if (!envValue) return defaultTimeout

  const parsed = parseInt(envValue, 10)
  const TimeoutSchema = z.number().int().positive()
  return TimeoutSchema.parse(parsed)
}

/**
 * Parse boolean from environment variable string
 */
export function parseBoolean(
  envValue: string | undefined,
  defaultValue: boolean,
): boolean {
  if (envValue === undefined) return defaultValue
  return envValue === 'true' || envValue === '1'
}
