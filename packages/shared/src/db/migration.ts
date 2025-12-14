/**
 * CovenantSQL Migration System
 * 
 * Handles schema migrations for decentralized database:
 * - Version tracking
 * - Up/down migrations
 * - Rollback support
 * - Data migration helpers
 */

import type { CovenantSQLClient, TableSchema, ConsistencyLevel } from './covenant-sql';

// ============================================================================
// Types
// ============================================================================

export interface Migration {
  version: number;
  name: string;
  up: (client: CovenantSQLClient) => Promise<void>;
  down: (client: CovenantSQLClient) => Promise<void>;
}

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: string;
  checksum: string;
}

export interface MigrationResult {
  version: number;
  name: string;
  success: boolean;
  duration: number;
  error?: string;
}

// ============================================================================
// Migration Manager
// ============================================================================

export class MigrationManager {
  private client: CovenantSQLClient;
  private migrations: Migration[] = [];
  private tableName = '_migrations';

  constructor(client: CovenantSQLClient) {
    this.client = client;
  }

  /**
   * Register migrations
   */
  register(migrations: Migration[]): void {
    this.migrations = migrations.sort((a, b) => a.version - b.version);
  }

  /**
   * Initialize migrations table
   */
  async initialize(): Promise<void> {
    const schema: TableSchema = {
      name: this.tableName,
      columns: [
        { name: 'version', type: 'INTEGER', nullable: false },
        { name: 'name', type: 'TEXT', nullable: false },
        { name: 'applied_at', type: 'TIMESTAMP', nullable: false },
        { name: 'checksum', type: 'TEXT', nullable: false },
      ],
      primaryKey: ['version'],
    };

    await this.client.createTable(schema);
  }

  /**
   * Get current version
   */
  async getCurrentVersion(): Promise<number> {
    const result = await this.client.query<{ version: number }>(
      `SELECT MAX(version) as version FROM ${this.tableName}`,
      [],
      { consistency: 'strong' }
    );
    return result.rows[0]?.version ?? 0;
  }

  /**
   * Get pending migrations
   */
  async getPending(): Promise<Migration[]> {
    const currentVersion = await this.getCurrentVersion();
    return this.migrations.filter(m => m.version > currentVersion);
  }

  /**
   * Get applied migrations
   */
  async getApplied(): Promise<MigrationRecord[]> {
    return this.client.select<MigrationRecord>(this.tableName, {
      orderBy: 'version DESC',
      consistency: 'strong',
    });
  }

  /**
   * Run all pending migrations
   */
  async up(): Promise<MigrationResult[]> {
    await this.initialize();
    const pending = await this.getPending();
    const results: MigrationResult[] = [];

    for (const migration of pending) {
      const result = await this.runMigration(migration, 'up');
      results.push(result);

      if (!result.success) {
        break; // Stop on first failure
      }
    }

    return results;
  }

  /**
   * Rollback last migration
   */
  async down(): Promise<MigrationResult | null> {
    const applied = await this.getApplied();
    if (applied.length === 0) {
      return null;
    }

    const lastVersion = applied[0].version;
    const migration = this.migrations.find(m => m.version === lastVersion);
    if (!migration) {
      throw new Error(`Migration version ${lastVersion} not found`);
    }

    return this.runMigration(migration, 'down');
  }

  /**
   * Rollback to specific version
   */
  async rollbackTo(targetVersion: number): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];
    const currentVersion = await this.getCurrentVersion();

    if (targetVersion >= currentVersion) {
      return results;
    }

    const toRollback = this.migrations
      .filter(m => m.version > targetVersion && m.version <= currentVersion)
      .sort((a, b) => b.version - a.version);

    for (const migration of toRollback) {
      const result = await this.runMigration(migration, 'down');
      results.push(result);

      if (!result.success) {
        break;
      }
    }

    return results;
  }

  /**
   * Run specific migration
   */
  private async runMigration(
    migration: Migration,
    direction: 'up' | 'down'
  ): Promise<MigrationResult> {
    const startTime = Date.now();
    const tx = await this.client.beginTransaction('strong');

    try {
      if (direction === 'up') {
        await migration.up(this.client);
        await this.client.insert(this.tableName, {
          version: migration.version,
          name: migration.name,
          applied_at: new Date().toISOString(),
          checksum: this.computeChecksum(migration),
        });
      } else {
        await migration.down(this.client);
        await this.client.delete(
          this.tableName,
          'version = $1',
          [migration.version]
        );
      }

      await tx.commit();

      return {
        version: migration.version,
        name: migration.name,
        success: true,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      await tx.rollback();

      return {
        version: migration.version,
        name: migration.name,
        success: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private computeChecksum(migration: Migration): string {
    const content = `${migration.version}:${migration.name}:${migration.up.toString()}:${migration.down.toString()}`;
    // Simple hash for checksum
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}

// ============================================================================
// Migration Helpers
// ============================================================================

/**
 * Create a migration
 */
export function createMigration(
  version: number,
  name: string,
  up: (client: CovenantSQLClient) => Promise<void>,
  down: (client: CovenantSQLClient) => Promise<void>
): Migration {
  return { version, name, up, down };
}

/**
 * Create table migration helper
 */
export function createTableMigration(
  version: number,
  name: string,
  schema: TableSchema
): Migration {
  return {
    version,
    name,
    up: async (client) => {
      await client.createTable(schema);
    },
    down: async (client) => {
      await client.dropTable(schema.name);
    },
  };
}

/**
 * Add column migration helper
 */
export function addColumnMigration(
  version: number,
  name: string,
  table: string,
  column: string,
  type: string,
  options: { nullable?: boolean; default?: unknown } = {}
): Migration {
  const nullable = options.nullable ? '' : ' NOT NULL';
  const defaultVal = options.default !== undefined ? ` DEFAULT ${options.default}` : '';

  return {
    version,
    name,
    up: async (client) => {
      await client.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}${nullable}${defaultVal}`);
    },
    down: async (client) => {
      await client.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    },
  };
}

/**
 * Create index migration helper
 */
export function createIndexMigration(
  version: number,
  name: string,
  table: string,
  indexName: string,
  columns: string[],
  unique = false
): Migration {
  const uniqueStr = unique ? 'UNIQUE ' : '';

  return {
    version,
    name,
    up: async (client) => {
      await client.query(`CREATE ${uniqueStr}INDEX ${indexName} ON ${table} (${columns.join(', ')})`);
    },
    down: async (client) => {
      await client.query(`DROP INDEX ${indexName}`);
    },
  };
}

/**
 * Data migration helper with batching
 */
export async function migrateData<T extends Record<string, unknown>>(
  client: CovenantSQLClient,
  sourceTable: string,
  targetTable: string,
  transform: (row: T) => Record<string, unknown>,
  options: {
    batchSize?: number;
    where?: string;
    whereParams?: unknown[];
    consistency?: ConsistencyLevel;
  } = {}
): Promise<{ migrated: number; failed: number }> {
  const batchSize = options.batchSize ?? 1000;
  let offset = 0;
  let migrated = 0;
  let failed = 0;

  while (true) {
    const rows = await client.select<T>(sourceTable, {
      where: options.where,
      whereParams: options.whereParams,
      limit: batchSize,
      offset,
      consistency: options.consistency ?? 'eventual',
    });

    if (rows.length === 0) break;

    const transformed = rows.map(row => {
      try {
        return transform(row);
      } catch {
        failed++;
        return null;
      }
    }).filter((r): r is Record<string, unknown> => r !== null);

    if (transformed.length > 0) {
      await client.insert(targetTable, transformed, { consistency: 'strong' });
      migrated += transformed.length;
    }

    offset += batchSize;
  }

  return { migrated, failed };
}

