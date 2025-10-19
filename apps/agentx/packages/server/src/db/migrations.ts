import { sql, eq } from 'drizzle-orm';
import { logger } from '@elizaos/core';
import { getDatabase } from './connection';
import {
  messageServerTable,
  channelTable,
  channelParticipantsTable,
  messageTable,
  serverAgentsTable,
} from './schema';

export async function runMigrations(): Promise<void> {
  logger.info('[MessageDB] Running database migrations...');

  const db = getDatabase();

  try {
    // Create message_servers table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS message_servers (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT,
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    logger.debug('[MessageDB] Created/verified message_servers table');

    // Create channels table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        server_id UUID NOT NULL REFERENCES message_servers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        source_type TEXT,
        source_id TEXT,
        topic TEXT,
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    logger.debug('[MessageDB] Created/verified channels table');

    // Create channel_participants table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS channel_participants (
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        PRIMARY KEY (channel_id, user_id)
      )
    `);
    logger.debug('[MessageDB] Created/verified channel_participants table');

    // Create central_messages table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS central_messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL,
        content TEXT NOT NULL,
        raw_message JSONB,
        in_reply_to_root_message_id TEXT REFERENCES central_messages(id) ON DELETE SET NULL,
        source_type TEXT,
        source_id TEXT,
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    logger.debug('[MessageDB] Created/verified central_messages table');

    // Create server_agents table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS server_agents (
        server_id UUID NOT NULL REFERENCES message_servers(id) ON DELETE CASCADE,
        agent_id UUID NOT NULL,
        PRIMARY KEY (server_id, agent_id)
      )
    `);
    logger.debug('[MessageDB] Created/verified server_agents table');

    // Create indexes for better performance
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_channels_server_id ON channels(server_id);
      CREATE INDEX IF NOT EXISTS idx_channel_participants_channel_id ON channel_participants(channel_id);
      CREATE INDEX IF NOT EXISTS idx_channel_participants_user_id ON channel_participants(user_id);
      CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON central_messages(channel_id);
      CREATE INDEX IF NOT EXISTS idx_messages_author_id ON central_messages(author_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON central_messages(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_server_agents_server_id ON server_agents(server_id);
      CREATE INDEX IF NOT EXISTS idx_server_agents_agent_id ON server_agents(agent_id);
    `);
    logger.debug('[MessageDB] Created/verified indexes');

    logger.success('[MessageDB] Database migrations completed successfully');
  } catch (error) {
    logger.error('[MessageDB] Failed to run migrations:', error);
    throw new Error(
      `Database migration failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
