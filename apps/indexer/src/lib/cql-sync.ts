/**
 * CQL Sync Layer
 * 
 * STATUS: REFERENCE IMPLEMENTATION - Not wired into app entry point.
 * DEPENDENCY: Requires CovenantSQL service (not deployed).
 * 
 * Would sync indexer data from PostgreSQL to CovenantSQL for decentralized reads.
 */

import { CovenantSQLClient, type QueryResult } from '@jeju/cql';
import type { DataSource, EntityMetadata } from 'typeorm';

// ============================================================================
// Configuration
// ============================================================================

const CQL_ENABLED = process.env.CQL_SYNC_ENABLED === 'true';
const CQL_ENDPOINT = process.env.CQL_ENDPOINT ?? 'http://localhost:4020';
const CQL_DATABASE_ID = process.env.CQL_DATABASE_ID ?? 'indexer-sync';
const SYNC_INTERVAL_MS = parseInt(process.env.CQL_SYNC_INTERVAL ?? '30000');
const BATCH_SIZE = parseInt(process.env.CQL_SYNC_BATCH_SIZE ?? '1000');

// ============================================================================
// Sync State
// ============================================================================

interface SyncState {
  entity: string;
  lastSyncedId: string | null;
  lastSyncedAt: number;
  totalSynced: number;
}

const syncStates: Map<string, SyncState> = new Map();

// ============================================================================
// CQL Sync Service
// ============================================================================

export class CQLSyncService {
  private client: CovenantSQLClient;
  private dataSource: DataSource | null = null;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor() {
    this.client = new CovenantSQLClient({
      blockProducerEndpoint: CQL_ENDPOINT,
      databaseId: CQL_DATABASE_ID,
    });
  }

  async initialize(dataSource: DataSource): Promise<void> {
    if (!CQL_ENABLED) {
      console.log('[CQLSync] Disabled - set CQL_SYNC_ENABLED=true to enable');
      return;
    }

    this.dataSource = dataSource;

    // Create tables in CQL matching PostgreSQL schema
    await this.createCQLTables();

    // Load sync states
    await this.loadSyncStates();

    console.log('[CQLSync] Initialized');
  }

  async start(): Promise<void> {
    if (!CQL_ENABLED || this.running) return;

    this.running = true;
    console.log(`[CQLSync] Starting sync every ${SYNC_INTERVAL_MS}ms`);

    // Initial sync
    await this.sync();

    // Periodic sync
    this.syncInterval = setInterval(() => {
      this.sync().catch((err) => {
        console.error('[CQLSync] Sync error:', err);
      });
    }, SYNC_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.running = false;
    console.log('[CQLSync] Stopped');
  }

  async sync(): Promise<void> {
    if (!this.dataSource?.isInitialized) return;

    const entities = this.dataSource.entityMetadatas;

    for (const entity of entities) {
      await this.syncEntity(entity);
    }
  }

  private async syncEntity(meta: EntityMetadata): Promise<void> {
    if (!this.dataSource) return;

    const tableName = meta.tableName;
    const primaryColumns = meta.primaryColumns.map((c) => c.databaseName);

    if (primaryColumns.length === 0) {
      console.warn(`[CQLSync] Skipping ${tableName} - no primary key`);
      return;
    }

    const state = syncStates.get(tableName) ?? {
      entity: tableName,
      lastSyncedId: null,
      lastSyncedAt: 0,
      totalSynced: 0,
    };

    // Build query for new/updated records
    const repo = this.dataSource.getRepository(meta.target);
    const query = repo.createQueryBuilder(tableName);

    if (state.lastSyncedId) {
      query.where(`${tableName}.${primaryColumns[0]} > :lastId`, {
        lastId: state.lastSyncedId,
      });
    }

    query.orderBy(`${tableName}.${primaryColumns[0]}`, 'ASC').take(BATCH_SIZE);

    const records = await query.getMany();

    if (records.length === 0) return;

    // Sync to CQL
    for (const record of records) {
      await this.upsertToCQL(tableName, meta, record);
    }

    // Update sync state
    const lastRecord = records[records.length - 1] as Record<string, unknown>;
    const lastId = String(lastRecord[primaryColumns[0]]);
    state.lastSyncedId = lastId;
    state.lastSyncedAt = Date.now();
    state.totalSynced += records.length;
    syncStates.set(tableName, state);

    await this.saveSyncState(state);

    console.log(`[CQLSync] Synced ${records.length} records from ${tableName}`);
  }

  private async upsertToCQL(
    tableName: string,
    meta: EntityMetadata,
    record: Record<string, unknown>
  ): Promise<void> {
    const columns = meta.columns.map((c) => c.databaseName);
    const values = meta.columns.map((c) => {
      const value = record[c.propertyName];
      if (value === null || value === undefined) return 'NULL';
      if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      if (value instanceof Date) return `'${value.toISOString()}'`;
      if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
      return `'${String(value).replace(/'/g, "''")}'`;
    });

    const primaryCols = meta.primaryColumns.map((c) => c.databaseName);
    const updateSet = columns
      .filter((c) => !primaryCols.includes(c))
      .map((c, i) => `${c} = ${values[columns.indexOf(c)]}`)
      .join(', ');

    const sql = `
      INSERT INTO ${tableName} (${columns.join(', ')})
      VALUES (${values.join(', ')})
      ON CONFLICT (${primaryCols.join(', ')})
      DO UPDATE SET ${updateSet}
    `.trim();

    await this.client.exec(sql, undefined, CQL_DATABASE_ID);
  }

  private async createCQLTables(): Promise<void> {
    if (!this.dataSource) return;

    for (const meta of this.dataSource.entityMetadatas) {
      await this.createCQLTable(meta);
    }
  }

  private async createCQLTable(meta: EntityMetadata): Promise<void> {
    const columns = meta.columns.map((col) => {
      let type = 'TEXT';
      switch (col.type) {
        case 'int':
        case 'integer':
        case Number:
          type = 'INTEGER';
          break;
        case 'bigint':
          type = 'BIGINT';
          break;
        case 'boolean':
        case Boolean:
          type = 'BOOLEAN';
          break;
        case 'timestamp':
        case 'timestamp with time zone':
        case Date:
          type = 'TIMESTAMP';
          break;
        case 'numeric':
        case 'decimal':
          type = 'DECIMAL';
          break;
        case 'json':
        case 'jsonb':
          type = 'TEXT'; // CQL stores JSON as text
          break;
      }

      const nullable = col.isNullable ? '' : ' NOT NULL';
      return `${col.databaseName} ${type}${nullable}`;
    });

    const primaryCols = meta.primaryColumns.map((c) => c.databaseName);

    const sql = `
      CREATE TABLE IF NOT EXISTS ${meta.tableName} (
        ${columns.join(',\n        ')},
        PRIMARY KEY (${primaryCols.join(', ')})
      )
    `.trim();

    await this.client.exec(sql, undefined, CQL_DATABASE_ID).catch((err) => {
      console.warn(`[CQLSync] Table creation failed for ${meta.tableName}:`, err);
    });
  }

  private async loadSyncStates(): Promise<void> {
    const result = await this.client
      .query<SyncState>('SELECT * FROM _cql_sync_states', undefined, CQL_DATABASE_ID)
      .catch(() => ({ rows: [], rowCount: 0, columns: [], executionTime: 0, blockHeight: 0 }));

    for (const row of result.rows) {
      syncStates.set(row.entity, row);
    }
  }

  private async saveSyncState(state: SyncState): Promise<void> {
    const sql = `
      INSERT INTO _cql_sync_states (entity, last_synced_id, last_synced_at, total_synced)
      VALUES ('${state.entity}', '${state.lastSyncedId}', ${state.lastSyncedAt}, ${state.totalSynced})
      ON CONFLICT (entity)
      DO UPDATE SET last_synced_id = '${state.lastSyncedId}', 
                    last_synced_at = ${state.lastSyncedAt}, 
                    total_synced = ${state.totalSynced}
    `.trim();

    await this.client.exec(sql, undefined, CQL_DATABASE_ID).catch(() => {
      // Ignore - table may not exist yet
    });
  }

  async getCQLReadClient(): Promise<CovenantSQLClient> {
    return this.client;
  }

  async queryFromCQL<T>(sql: string): Promise<QueryResult<T>> {
    return this.client.query<T>(sql, undefined, CQL_DATABASE_ID);
  }

  getStats(): {
    enabled: boolean;
    running: boolean;
    entities: number;
    states: Record<string, SyncState>;
  } {
    return {
      enabled: CQL_ENABLED,
      running: this.running,
      entities: syncStates.size,
      states: Object.fromEntries(syncStates),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let cqlSyncService: CQLSyncService | null = null;

export function getCQLSync(): CQLSyncService {
  if (!cqlSyncService) {
    cqlSyncService = new CQLSyncService();
  }
  return cqlSyncService;
}

export function resetCQLSync(): void {
  if (cqlSyncService) {
    cqlSyncService.stop().catch(() => {});
    cqlSyncService = null;
  }
}

