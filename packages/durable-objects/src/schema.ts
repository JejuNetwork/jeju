/**
 * @jejunetwork/durable-objects - SQLit Schema
 *
 * Schema definitions for Durable Objects persistence.
 * All DO state is stored in these tables.
 *
 * Tables:
 * - do_locations: Tracks which pod hosts each DO instance
 * - do_state: Key-value storage for DO state
 * - do_alarms: Scheduled alarms for DOs
 */

import { getLogLevel } from '@jejunetwork/config'
import type { SQLitClient } from '@jejunetwork/db'
import pino from 'pino'

const log = pino({
  name: 'durable-objects:schema',
  level: getLogLevel(),
})

/**
 * SQL statements to create DO tables
 */
export const DO_SCHEMA = `
-- Durable Object instance location registry
-- Tracks which pod is hosting each DO instance
CREATE TABLE IF NOT EXISTS do_locations (
  key TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL,
  port INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_seen INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Index for finding all DOs on a specific pod
CREATE INDEX IF NOT EXISTS idx_do_locations_pod ON do_locations(pod_id);

-- Index for finding stale DOs by status and last_seen
CREATE INDEX IF NOT EXISTS idx_do_locations_status ON do_locations(status, last_seen);

-- Durable Object key-value storage
-- Each DO has its own namespace within this table
CREATE TABLE IF NOT EXISTS do_state (
  do_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (do_id, key)
);

-- Index for listing all keys in a DO
CREATE INDEX IF NOT EXISTS idx_do_state_do ON do_state(do_id);

-- Index for prefix queries within a DO
CREATE INDEX IF NOT EXISTS idx_do_state_key ON do_state(do_id, key);

-- Durable Object alarms
-- Each DO can have at most one alarm scheduled
CREATE TABLE IF NOT EXISTS do_alarms (
  do_id TEXT PRIMARY KEY,
  scheduled_time INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Index for finding due alarms
CREATE INDEX IF NOT EXISTS idx_do_alarms_time ON do_alarms(scheduled_time);
`

/**
 * Individual schema statements for incremental execution
 */
export const DO_SCHEMA_STATEMENTS = [
  // do_locations table
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

  // do_state table
  `CREATE TABLE IF NOT EXISTS do_state (
    do_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (do_id, key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_do_state_do ON do_state(do_id)`,
  `CREATE INDEX IF NOT EXISTS idx_do_state_key ON do_state(do_id, key)`,

  // do_alarms table
  `CREATE TABLE IF NOT EXISTS do_alarms (
    do_id TEXT PRIMARY KEY,
    scheduled_time INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_do_alarms_time ON do_alarms(scheduled_time)`,
]

/**
 * Initialize the DO schema in a SQLit database
 */
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

/**
 * Check if DO schema exists
 */
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

/**
 * Clean up old/stale data from DO tables
 */
export async function cleanupStaleDOData(
  sqlit: SQLitClient,
  databaseId: string,
  options: {
    /** Delete location entries not seen in this many ms (default: 5 min) */
    locationStaleMs?: number
    /** Delete alarm entries that are past due by this many ms (default: 1 hour) */
    alarmPastDueMs?: number
  } = {},
): Promise<{
  locationsDeleted: number
  alarmsDeleted: number
}> {
  const locationStaleMs = options.locationStaleMs ?? 5 * 60 * 1000
  const alarmPastDueMs = options.alarmPastDueMs ?? 60 * 60 * 1000

  const now = Date.now()

  // Delete stale locations
  const locationsResult = await sqlit.exec(
    `DELETE FROM do_locations WHERE status = 'evicted' OR (last_seen < ? AND status != 'active')`,
    [now - locationStaleMs],
    databaseId,
  )

  // Delete past-due alarms
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

/**
 * Get statistics about DO usage
 */
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
