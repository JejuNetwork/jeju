/**
 * SQLit Database Schema and Migrations for ElizaOS
 *
 * Minimal schema required for ElizaOS agents to function.
 * This is SQLit-compatible SQL (standard SQL with some limitations).
 */

import { logger } from '@elizaos/core'
import { getSQLitDatabaseId } from '@jejunetwork/config'
import { type SQLitClient, getSQLit } from '@jejunetwork/db'

/**
 * Core ElizaOS tables in SQLit-compatible SQL
 */
export const SQLIT_SCHEMA = {
  // Agents table - stores agent configurations
  agents: `
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      details TEXT,
      settings TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    )
  `,

  // Entities table - users, agents, and other actors
  entities: `
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      names TEXT,
      metadata TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `,

  // Worlds table - servers, organizations, contexts
  worlds: `
    CREATE TABLE IF NOT EXISTS worlds (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT,
      server_id TEXT,
      metadata TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `,

  // Rooms table - conversations, channels
  rooms: `
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      world_id TEXT,
      name TEXT,
      source TEXT DEFAULT 'api',
      type TEXT DEFAULT 'DM',
      channel_id TEXT,
      metadata TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (world_id) REFERENCES worlds(id)
    )
  `,

  // Participants table - who is in each room
  participants: `
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      UNIQUE (room_id, entity_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id),
      FOREIGN KEY (entity_id) REFERENCES entities(id)
    )
  `,

  // Memories table - messages, facts, knowledge
  memories: `
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      agent_id TEXT,
      room_id TEXT NOT NULL,
      world_id TEXT,
      content TEXT NOT NULL,
      embedding TEXT,
      unique_hash TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (entity_id) REFERENCES entities(id),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    )
  `,

  // Components table - entity state/attributes
  components: `
    CREATE TABLE IF NOT EXISTS components (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      world_id TEXT,
      source_entity_id TEXT,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (entity_id) REFERENCES entities(id)
    )
  `,

  // Relationships table - connections between entities
  relationships: `
    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      source_entity_id TEXT NOT NULL,
      target_entity_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (source_entity_id) REFERENCES entities(id),
      FOREIGN KEY (target_entity_id) REFERENCES entities(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `,

  // Cache table - temporary key-value storage
  cache: `
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      expires_at INTEGER,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `,

  // Logs table - audit/debug logs
  logs: `
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      type TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (entity_id) REFERENCES entities(id),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    )
  `,

  // Tasks table - scheduled/queued tasks
  tasks: `
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      room_id TEXT,
      world_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      tags TEXT,
      metadata TEXT,
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    )
  `,

  // Indexes for common queries
  indexes: [
    'CREATE INDEX IF NOT EXISTS idx_memories_room ON memories(room_id)',
    'CREATE INDEX IF NOT EXISTS idx_memories_entity ON memories(entity_id)',
    'CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_participants_room ON participants(room_id)',
    'CREATE INDEX IF NOT EXISTS idx_participants_entity ON participants(entity_id)',
    'CREATE INDEX IF NOT EXISTS idx_entities_agent ON entities(agent_id)',
    'CREATE INDEX IF NOT EXISTS idx_rooms_world ON rooms(world_id)',
    'CREATE INDEX IF NOT EXISTS idx_cache_agent ON cache(agent_id)',
    'CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at)',
  ],

  // Vector search table (powered by sqlite-vec)
  // This is a vec0 virtual table for fast KNN similarity search
  memory_embeddings: `
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
      embedding float[1536],
      +memory_id TEXT,
      +room_id TEXT,
      +entity_id TEXT,
      +agent_id TEXT
    )
  `,
}

/**
 * Run all migrations to create the ElizaOS schema
 */
export async function runSQLitMigrations(
  client?: SQLitClient,
  databaseId?: string,
): Promise<void> {
  const sqlit = client ?? getSQLit()
  const dbId = databaseId ?? getSQLitDatabaseId() ?? 'eliza'

  logger.info(
    { src: 'sqlit-migrations', databaseId: dbId },
    'Running SQLit migrations',
  )

  // Create tables in order (respecting foreign keys)
  const tableOrder = [
    'agents',
    'entities',
    'worlds',
    'rooms',
    'participants',
    'memories',
    'components',
    'relationships',
    'cache',
    'logs',
    'tasks',
  ] as const

  for (const tableName of tableOrder) {
    const sql = SQLIT_SCHEMA[tableName]
    logger.debug(
      { src: 'sqlit-migrations', table: tableName },
      'Creating table',
    )
    await sqlit.exec(sql, [], dbId)
  }

  // Create indexes
  for (const indexSql of SQLIT_SCHEMA.indexes) {
    await sqlit.exec(indexSql, [], dbId)
  }

  // Create vector search table (sqlite-vec)
  // This may fail if sqlite-vec is not loaded, which is OK for non-production
  try {
    await sqlit.exec(SQLIT_SCHEMA.memory_embeddings, [], dbId)
    logger.info(
      { src: 'sqlit-migrations', databaseId: dbId },
      'Vector search table created (sqlite-vec)',
    )
  } catch (error) {
    logger.warn(
      { src: 'sqlit-migrations', databaseId: dbId, error },
      'Vector search table creation failed - sqlite-vec may not be loaded',
    )
  }

  logger.info(
    { src: 'sqlit-migrations', databaseId: dbId },
    'SQLit migrations completed',
  )
}

/**
 * Check if migrations have been run
 */
export async function checkMigrationStatus(
  client?: SQLitClient,
  databaseId?: string,
): Promise<boolean> {
  const sqlit = client ?? getSQLit()
  const dbId = databaseId ?? getSQLitDatabaseId() ?? 'eliza'

  const result = await sqlit.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='agents'",
    [],
    dbId,
  )

  return result.rows.length > 0
}
