/**
 * CQL Migration System
 *
 * Schema migration utilities for CovenantSQL databases.
 * Supports versioned migrations with up/down capabilities.
 */

import type { CQLClient } from './client.js';
import type { Migration, MigrationResult } from './types.js';

// ============================================================================
// Migration Manager
// ============================================================================

export class MigrationManager {
  private client: CQLClient;
  private databaseId: string;
  private tableName: string;

  constructor(client: CQLClient, databaseId: string, tableName: string = '_migrations') {
    this.client = client;
    this.databaseId = databaseId;
    this.tableName = tableName;
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
      this.databaseId
    );
  }

  /**
   * Get current migration version
   */
  async getCurrentVersion(): Promise<number> {
    const result = await this.client.query<{ version: number }>(
      `SELECT MAX(version) as version FROM ${this.tableName}`,
      [],
      this.databaseId
    );

    return result.rows[0]?.version ?? 0;
  }

  /**
   * Get applied migrations
   */
  async getAppliedMigrations(): Promise<Migration[]> {
    const result = await this.client.query<{ version: number; name: string; applied_at: string }>(
      `SELECT version, name, applied_at FROM ${this.tableName} ORDER BY version`,
      [],
      this.databaseId
    );

    return result.rows.map((row) => ({
      version: row.version,
      name: row.name,
      up: '', // Not stored
      down: '', // Not stored
      appliedAt: new Date(row.applied_at).getTime(),
    }));
  }

  /**
   * Run pending migrations
   */
  async migrate(migrations: Migration[]): Promise<MigrationResult> {
    await this.initialize();

    const currentVersion = await this.getCurrentVersion();
    const pending = migrations
      .filter((m) => m.version > currentVersion)
      .sort((a, b) => a.version - b.version);

    const applied: string[] = [];

    for (const migration of pending) {
      console.log(`[CQL] Applying migration: ${migration.version} - ${migration.name}`);

      // Execute migration in transaction
      const conn = await this.client.connect(this.databaseId);
      const tx = await conn.beginTransaction();

      try {
        await tx.exec(migration.up, []);
        await tx.exec(
          `INSERT INTO ${this.tableName} (version, name) VALUES (?, ?)`,
          [migration.version, migration.name]
        );
        await tx.commit();
        applied.push(`${migration.version}: ${migration.name}`);
      } catch (error) {
        await tx.rollback();
        throw new Error(`Migration ${migration.version} failed: ${(error as Error).message}`);
      } finally {
        this.client.getPool(this.databaseId).release(conn);
      }
    }

    const newVersion = await this.getCurrentVersion();
    const stillPending = migrations
      .filter((m) => m.version > newVersion)
      .map((m) => `${m.version}: ${m.name}`);

    return {
      applied,
      currentVersion: newVersion,
      pending: stillPending,
    };
  }

  /**
   * Rollback last migration
   */
  async rollback(migrations: Migration[]): Promise<MigrationResult> {
    await this.initialize();

    const currentVersion = await this.getCurrentVersion();
    if (currentVersion === 0) {
      return {
        applied: [],
        currentVersion: 0,
        pending: migrations.map((m) => `${m.version}: ${m.name}`),
      };
    }

    const migration = migrations.find((m) => m.version === currentVersion);
    if (!migration) {
      throw new Error(`Migration ${currentVersion} not found in provided migrations`);
    }

    console.log(`[CQL] Rolling back migration: ${migration.version} - ${migration.name}`);

    const conn = await this.client.connect(this.databaseId);
    const tx = await conn.beginTransaction();

    try {
      await tx.exec(migration.down, []);
      await tx.exec(`DELETE FROM ${this.tableName} WHERE version = ?`, [migration.version]);
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw new Error(`Rollback ${migration.version} failed: ${(error as Error).message}`);
    } finally {
      this.client.getPool(this.databaseId).release(conn);
    }

    const newVersion = await this.getCurrentVersion();
    const pending = migrations
      .filter((m) => m.version > newVersion)
      .map((m) => `${m.version}: ${m.name}`);

    return {
      applied: [],
      currentVersion: newVersion,
      pending,
    };
  }

  /**
   * Rollback all migrations
   */
  async reset(migrations: Migration[]): Promise<MigrationResult> {
    let result = await this.rollback(migrations);

    while (result.currentVersion > 0) {
      result = await this.rollback(migrations);
    }

    return result;
  }
}

// ============================================================================
// Migration Helpers
// ============================================================================

/**
 * Define a migration
 */
export function defineMigration(
  version: number,
  name: string,
  up: string,
  down: string
): Migration {
  return { version, name, up, down };
}

/**
 * Create table migration helper
 */
export function createTable(
  tableName: string,
  columns: Array<{
    name: string;
    type: string;
    primaryKey?: boolean;
    autoIncrement?: boolean;
    notNull?: boolean;
    unique?: boolean;
    default?: string;
    references?: { table: string; column: string };
  }>
): { up: string; down: string } {
  const columnDefs = columns.map((col) => {
    let def = `${col.name} ${col.type}`;
    if (col.primaryKey) def += ' PRIMARY KEY';
    if (col.autoIncrement) def += ' AUTOINCREMENT';
    if (col.notNull) def += ' NOT NULL';
    if (col.unique) def += ' UNIQUE';
    if (col.default !== undefined) def += ` DEFAULT ${col.default}`;
    if (col.references) {
      def += ` REFERENCES ${col.references.table}(${col.references.column})`;
    }
    return def;
  });

  return {
    up: `CREATE TABLE ${tableName} (\n  ${columnDefs.join(',\n  ')}\n)`,
    down: `DROP TABLE IF EXISTS ${tableName}`,
  };
}

/**
 * Add column migration helper
 */
export function addColumn(
  tableName: string,
  columnName: string,
  columnType: string,
  options?: { notNull?: boolean; default?: string }
): { up: string; down: string } {
  let up = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`;
  if (options?.notNull) up += ' NOT NULL';
  if (options?.default !== undefined) up += ` DEFAULT ${options.default}`;

  return {
    up,
    down: `ALTER TABLE ${tableName} DROP COLUMN ${columnName}`,
  };
}

/**
 * Create index migration helper
 */
export function createIndex(
  indexName: string,
  tableName: string,
  columns: string[],
  unique?: boolean
): { up: string; down: string } {
  const uniqueClause = unique ? 'UNIQUE ' : '';
  return {
    up: `CREATE ${uniqueClause}INDEX ${indexName} ON ${tableName} (${columns.join(', ')})`,
    down: `DROP INDEX IF EXISTS ${indexName}`,
  };
}

// ============================================================================
// Factory
// ============================================================================

export function createMigrationManager(
  client: CQLClient,
  databaseId: string,
  tableName?: string
): MigrationManager {
  return new MigrationManager(client, databaseId, tableName);
}

