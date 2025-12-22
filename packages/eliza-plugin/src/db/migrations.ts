/**
 * CQL Database Schema and Migrations for ElizaOS
 *
 * Minimal schema required for ElizaOS agents to function.
 * This is CQL-compatible SQL (standard SQL with some limitations).
 */

import { getCQL, type CQLClient } from '@jejunetwork/db';
import { logger } from '@elizaos/core';

/**
 * Core ElizaOS tables in CQL-compatible SQL
 */
export const CQL_SCHEMA = {
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
};

/**
 * Run all migrations to create the ElizaOS schema
 */
export async function runCQLMigrations(client?: CQLClient, databaseId?: string): Promise<void> {
  const cql = client ?? getCQL();
  const dbId = databaseId ?? process.env.CQL_DATABASE_ID ?? 'eliza';

  logger.info({ src: 'cql-migrations', databaseId: dbId }, 'Running CQL migrations');

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
  ] as const;

  for (const tableName of tableOrder) {
    const sql = CQL_SCHEMA[tableName];
    logger.debug({ src: 'cql-migrations', table: tableName }, 'Creating table');
    await cql.exec(sql, [], dbId);
  }

  // Create indexes
  for (const indexSql of CQL_SCHEMA.indexes) {
    await cql.exec(indexSql, [], dbId);
  }

  logger.info({ src: 'cql-migrations', databaseId: dbId }, 'CQL migrations completed');
}

/**
 * Check if migrations have been run
 */
export async function checkMigrationStatus(client?: CQLClient, databaseId?: string): Promise<boolean> {
  const cql = client ?? getCQL();
  const dbId = databaseId ?? process.env.CQL_DATABASE_ID ?? 'eliza';

  const result = await cql.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='agents'",
    [],
    dbId
  );

  return result.rows.length > 0;
}


