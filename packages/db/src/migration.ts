/**
 * EQLite Migration System
 *
 * Schema migration utilities for EQLite databases.
 * Supports versioned migrations with up/down capabilities.
 */

import { toError } from '@jejunetwork/types'
import type { EQLiteClient } from './client.js'
import type { Migration, MigrationResult } from './types.js'
import {
  validateColumnType,
  validateSQLDefault,
  validateSQLIdentifier,
  validateSQLIdentifiers,
} from './utils.js'

// Migration Manager

export class MigrationManager {
  private client: EQLiteClient
  private databaseId: string
  private tableName: string

  constructor(
    client: EQLiteClient,
    databaseId: string,
    tableName: string = '_migrations',
  ) {
    this.client = client
    this.databaseId = databaseId
    // Validate table name to prevent SQL injection
    this.tableName = validateSQLIdentifier(tableName, 'table')
  }

  /**
   * Initialize migration tracking table
   */
  async initialize(): Promise<void> {
    await this.client.exec(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      [],
      this.databaseId,
    )
  }

  /**
   * Get current migration version
   */
  async getCurrentVersion(): Promise<number> {
    const result = await this.client.query<{ version: number | null }>(
      `SELECT MAX(version) as version FROM ${this.tableName}`,
      [],
      this.databaseId,
    )

    // MAX() returns NULL if no rows exist, which is valid for empty migration table
    const firstRow = result.rows[0]
    if (!firstRow) return 0
    return firstRow.version ?? 0
  }

  /**
   * Get applied migrations
   */
  async getAppliedMigrations(): Promise<Migration[]> {
    const result = await this.client.query<{
      version: number
      name: string
      applied_at: string
    }>(
      `SELECT version, name, applied_at FROM ${this.tableName} ORDER BY version`,
      [],
      this.databaseId,
    )

    return result.rows.map((row) => ({
      version: row.version,
      name: row.name,
      up: '', // Not stored
      down: '', // Not stored
      appliedAt: new Date(row.applied_at).getTime(),
    }))
  }

  /**
   * Run pending migrations
   * Uses pessimistic locking to prevent TOCTOU race conditions
   */
  async migrate(migrations: Migration[]): Promise<MigrationResult> {
    await this.initialize()

    // Sort migrations by version for sequential application
    const sortedMigrations = [...migrations].sort(
      (a, b) => a.version - b.version,
    )
    const applied: string[] = []

    for (const migration of sortedMigrations) {
      // Execute migration in transaction with version check INSIDE the transaction
      // This prevents TOCTOU race conditions where two processes check version simultaneously
      const conn = await this.client.connect(this.databaseId)
      const tx = await conn.beginTransaction()

      try {
        // Check version INSIDE transaction to prevent race conditions
        const versionResult = await tx.query<{ version: number | null }>(
          `SELECT MAX(version) as version FROM ${this.tableName}`,
        )
        const currentVersion = versionResult.rows[0]?.version ?? 0

        // Skip if migration already applied
        if (migration.version <= currentVersion) {
          await tx.rollback()
          continue
        }

        console.log(
          `[EQLite] Applying migration: ${migration.version} - ${migration.name}`,
        )

        await tx.exec(migration.up, [])
        await tx.exec(
          `INSERT INTO ${this.tableName} (version, name) VALUES (?, ?)`,
          [migration.version, migration.name],
        )
        await tx.commit()
        applied.push(`${migration.version}: ${migration.name}`)
      } catch (error) {
        await tx.rollback()
        throw new Error(
          `Migration ${migration.version} failed: ${toError(error).message}`,
        )
      } finally {
        this.client.getPool(this.databaseId).release(conn)
      }
    }

    const newVersion = await this.getCurrentVersion()
    const stillPending = sortedMigrations
      .filter((m) => m.version > newVersion)
      .map((m) => `${m.version}: ${m.name}`)

    return {
      applied,
      currentVersion: newVersion,
      pending: stillPending,
    }
  }

  /**
   * Rollback last migration
   */
  async rollback(migrations: Migration[]): Promise<MigrationResult> {
    await this.initialize()

    const currentVersion = await this.getCurrentVersion()
    if (currentVersion === 0) {
      return {
        applied: [],
        currentVersion: 0,
        pending: migrations.map((m) => `${m.version}: ${m.name}`),
      }
    }

    const migration = migrations.find((m) => m.version === currentVersion)
    if (!migration) {
      throw new Error(
        `Migration ${currentVersion} not found in provided migrations`,
      )
    }

    console.log(
      `[EQLite] Rolling back migration: ${migration.version} - ${migration.name}`,
    )

    const conn = await this.client.connect(this.databaseId)
    const tx = await conn.beginTransaction()

    try {
      await tx.exec(migration.down, [])
      await tx.exec(`DELETE FROM ${this.tableName} WHERE version = ?`, [
        migration.version,
      ])
      await tx.commit()
    } catch (error) {
      await tx.rollback()
      throw new Error(
        `Rollback ${migration.version} failed: ${toError(error).message}`,
      )
    } finally {
      this.client.getPool(this.databaseId).release(conn)
    }

    const newVersion = await this.getCurrentVersion()
    const pending = migrations
      .filter((m) => m.version > newVersion)
      .map((m) => `${m.version}: ${m.name}`)

    return {
      applied: [],
      currentVersion: newVersion,
      pending,
    }
  }

  /**
   * Rollback all migrations
   */
  async reset(migrations: Migration[]): Promise<MigrationResult> {
    let result = await this.rollback(migrations)

    while (result.currentVersion > 0) {
      result = await this.rollback(migrations)
    }

    return result
  }
}

// Migration Helpers

/**
 * Define a migration
 */
export function defineMigration(
  version: number,
  name: string,
  up: string,
  down: string,
): Migration {
  return { version, name, up, down }
}

/**
 * Create table migration helper
 */
export function createTable(
  tableName: string,
  columns: Array<{
    name: string
    type: string
    primaryKey?: boolean
    autoIncrement?: boolean
    notNull?: boolean
    unique?: boolean
    default?: string
    references?: { table: string; column: string }
  }>,
): { up: string; down: string } {
  // Validate table name to prevent SQL injection
  const safeTableName = validateSQLIdentifier(tableName, 'table')

  const columnDefs = columns.map((col) => {
    // Validate column name and type
    const safeColName = validateSQLIdentifier(col.name, 'column')
    const safeColType = validateColumnType(col.type)
    let def = `${safeColName} ${safeColType}`
    if (col.primaryKey) def += ' PRIMARY KEY'
    if (col.autoIncrement) def += ' AUTOINCREMENT'
    if (col.notNull) def += ' NOT NULL'
    if (col.unique) def += ' UNIQUE'
    if (col.default !== undefined) {
      const safeDefault = validateSQLDefault(col.default)
      def += ` DEFAULT ${safeDefault}`
    }
    if (col.references) {
      // Validate foreign key references
      const safeRefTable = validateSQLIdentifier(col.references.table, 'table')
      const safeRefCol = validateSQLIdentifier(col.references.column, 'column')
      def += ` REFERENCES ${safeRefTable}(${safeRefCol})`
    }
    return def
  })

  return {
    up: `CREATE TABLE ${safeTableName} (\n  ${columnDefs.join(',\n  ')}\n)`,
    down: `DROP TABLE IF EXISTS ${safeTableName}`,
  }
}

/**
 * Add column migration helper
 */
export function addColumn(
  tableName: string,
  columnName: string,
  columnType: string,
  options?: { notNull?: boolean; default?: string },
): { up: string; down: string } {
  // Validate identifiers and type to prevent SQL injection
  const safeTableName = validateSQLIdentifier(tableName, 'table')
  const safeColumnName = validateSQLIdentifier(columnName, 'column')
  const safeColumnType = validateColumnType(columnType)

  let up = `ALTER TABLE ${safeTableName} ADD COLUMN ${safeColumnName} ${safeColumnType}`
  if (options?.notNull) up += ' NOT NULL'
  if (options?.default !== undefined) {
    // Validate DEFAULT value to prevent SQL injection
    const safeDefault = validateSQLDefault(options.default)
    up += ` DEFAULT ${safeDefault}`
  }

  return {
    up,
    down: `ALTER TABLE ${safeTableName} DROP COLUMN ${safeColumnName}`,
  }
}

/**
 * Create index migration helper
 */
export function createIndex(
  indexName: string,
  tableName: string,
  columns: string[],
  unique?: boolean,
): { up: string; down: string } {
  // Validate all identifiers to prevent SQL injection
  const safeIndexName = validateSQLIdentifier(indexName, 'index')
  const safeTableName = validateSQLIdentifier(tableName, 'table')
  const safeColumns = validateSQLIdentifiers(columns, 'column')

  const uniqueClause = unique ? 'UNIQUE ' : ''
  return {
    up: `CREATE ${uniqueClause}INDEX ${safeIndexName} ON ${safeTableName} (${safeColumns.join(', ')})`,
    down: `DROP INDEX IF EXISTS ${safeIndexName}`,
  }
}

// Legacy-compatible helpers

/** Schema definition for createTableMigration */
export interface TableSchema {
  name: string
  columns: Array<{
    name: string
    type: string
    nullable?: boolean
    default?: string | number | boolean | null
    unique?: boolean
    references?: { table: string; column: string }
  }>
  primaryKey: string[]
  indexes?: Array<{
    name: string
    columns: string[]
    unique?: boolean
  }>
}

/**
 * Create table migration helper (legacy compatible)
 * Returns a full Migration object with version and name
 */
export function createTableMigration(
  version: number,
  name: string,
  schema: TableSchema,
): Migration {
  const safeTableName = validateSQLIdentifier(schema.name, 'table')

  const columnDefs = schema.columns.map((col) => {
    const safeColName = validateSQLIdentifier(col.name, 'column')
    const safeColType = validateColumnType(col.type)
    let def = `${safeColName} ${safeColType}`
    if (!col.nullable) def += ' NOT NULL'
    if (col.unique) def += ' UNIQUE'
    if (col.default !== undefined && col.default !== null) {
      // Convert to string and validate
      const defaultStr =
        typeof col.default === 'string' ? col.default : String(col.default)
      const safeDefault = validateSQLDefault(defaultStr)
      def += ` DEFAULT ${safeDefault}`
    }
    if (col.references) {
      const safeRefTable = validateSQLIdentifier(col.references.table, 'table')
      const safeRefCol = validateSQLIdentifier(col.references.column, 'column')
      def += ` REFERENCES ${safeRefTable}(${safeRefCol})`
    }
    return def
  })

  const pkCols = schema.primaryKey.map((pk) =>
    validateSQLIdentifier(pk, 'column'),
  )
  const pk = pkCols.length > 0 ? `, PRIMARY KEY (${pkCols.join(', ')})` : ''

  const up = `CREATE TABLE IF NOT EXISTS ${safeTableName} (${columnDefs.join(', ')}${pk})`
  const down = `DROP TABLE IF EXISTS ${safeTableName}`

  return { version, name, up, down }
}

// Factory

export function createMigrationManager(
  client: EQLiteClient,
  databaseId: string,
  tableName?: string,
): MigrationManager {
  return new MigrationManager(client, databaseId, tableName)
}
