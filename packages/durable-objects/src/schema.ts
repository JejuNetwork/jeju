/**
 * @jejunetwork/durable-objects - SQLit Schema
 *
 * ROLLBACK PROCEDURE:
 * 1. Stop all DWS pods to prevent new DO operations
 * 2. Export existing data if needed: SELECT * FROM do_state/do_alarms/do_locations
 * 3. Drop tables in reverse order:
 *    DROP INDEX IF EXISTS idx_do_alarms_time;
 *    DROP TABLE IF EXISTS do_alarms;
 *    DROP INDEX IF EXISTS idx_do_state_key;
 *    DROP INDEX IF EXISTS idx_do_state_do;
 *    DROP TABLE IF EXISTS do_state;
 *    DROP INDEX IF EXISTS idx_do_locations_status;
 *    DROP INDEX IF EXISTS idx_do_locations_pod;
 *    DROP TABLE IF EXISTS do_locations;
 * 4. Restart pods - schema will be recreated on first request
 *
 * MIGRATION NOTES:
 * - All tables use IF NOT EXISTS, safe to re-run
 * - Schema is additive-only (no column drops)
 * - Data is preserved on schema updates
 */

import { getLogLevel } from '@jejunetwork/config'
import type { SQLitClient } from '@jejunetwork/db'
import pino from 'pino'

const log = pino({ name: 'durable-objects:schema', level: getLogLevel() })

export const DO_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS do_locations (
    key TEXT PRIMARY KEY,
    pod_id TEXT NOT NULL,
    port INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    last_seen INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_do_locations_pod ON do_locations(pod_id)`,
  `CREATE INDEX IF NOT EXISTS idx_do_locations_status ON do_locations(status, last_seen)`,
  `CREATE TABLE IF NOT EXISTS do_state (
    do_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (do_id, key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_do_state_do ON do_state(do_id)`,
  `CREATE INDEX IF NOT EXISTS idx_do_state_key ON do_state(do_id, key)`,
  `CREATE TABLE IF NOT EXISTS do_alarms (
    do_id TEXT PRIMARY KEY,
    scheduled_time INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_do_alarms_time ON do_alarms(scheduled_time)`,
]

export async function initializeDOSchema(
  sqlit: SQLitClient,
  databaseId: string,
): Promise<void> {
  log.info({ databaseId }, 'Initializing DO schema')
  for (const statement of DO_SCHEMA_STATEMENTS) {
    await sqlit.exec(statement, undefined, databaseId)
  }
  log.info({ databaseId }, 'DO schema initialized')
}

export async function isDOSchemaInitialized(
  sqlit: SQLitClient,
  databaseId: string,
): Promise<boolean> {
  const result = await sqlit.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='do_state'`,
    undefined,
    databaseId,
  )
  return result.rows.length > 0
}

const DO_ROLLBACK_STATEMENTS = [
  `DROP INDEX IF EXISTS idx_do_alarms_time`,
  `DROP TABLE IF EXISTS do_alarms`,
  `DROP INDEX IF EXISTS idx_do_state_key`,
  `DROP INDEX IF EXISTS idx_do_state_do`,
  `DROP TABLE IF EXISTS do_state`,
  `DROP INDEX IF EXISTS idx_do_locations_status`,
  `DROP INDEX IF EXISTS idx_do_locations_pod`,
  `DROP TABLE IF EXISTS do_locations`,
]

export async function rollbackDOSchema(
  sqlit: SQLitClient,
  databaseId: string,
): Promise<void> {
  log.warn({ databaseId }, 'Rolling back DO schema - ALL DATA WILL BE LOST')
  for (const statement of DO_ROLLBACK_STATEMENTS) {
    await sqlit.exec(statement, undefined, databaseId)
  }
  log.info({ databaseId }, 'DO schema rolled back')
}

export async function cleanupStaleDOData(
  sqlit: SQLitClient,
  databaseId: string,
  options: { locationStaleMs?: number; alarmPastDueMs?: number } = {},
): Promise<{ locationsDeleted: number; alarmsDeleted: number }> {
  const locationStaleMs = options.locationStaleMs ?? 5 * 60 * 1000
  const alarmPastDueMs = options.alarmPastDueMs ?? 60 * 60 * 1000
  const now = Date.now()

  const locationsResult = await sqlit.exec(
    `DELETE FROM do_locations WHERE status = 'evicted' OR (last_seen < ? AND status != 'active')`,
    [now - locationStaleMs],
    databaseId,
  )
  const alarmsResult = await sqlit.exec(
    `DELETE FROM do_alarms WHERE scheduled_time < ?`,
    [now - alarmPastDueMs],
    databaseId,
  )

  const result = {
    locationsDeleted: locationsResult.rowsAffected,
    alarmsDeleted: alarmsResult.rowsAffected,
  }
  log.info({ databaseId, ...result }, 'Cleaned up stale DO data')
  return result
}

export async function getDOStats(
  sqlit: SQLitClient,
  databaseId: string,
): Promise<{
  activeLocations: number
  totalStateEntries: number
  pendingAlarms: number
}> {
  const [locations, state, alarms] = await Promise.all([
    sqlit.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM do_locations WHERE status = 'active'`,
      undefined,
      databaseId,
    ),
    sqlit.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM do_state`,
      undefined,
      databaseId,
    ),
    sqlit.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM do_alarms WHERE scheduled_time > ?`,
      [Date.now()],
      databaseId,
    ),
  ])
  return {
    activeLocations: locations.rows[0]?.count ?? 0,
    totalStateEntries: state.rows[0]?.count ?? 0,
    pendingAlarms: alarms.rows[0]?.count ?? 0,
  }
}
