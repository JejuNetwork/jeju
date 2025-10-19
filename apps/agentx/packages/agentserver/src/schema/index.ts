import { pgTable, text, jsonb, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Message servers table
export const messageServerTable = pgTable('message_servers', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { mode: 'date' })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

// Channels table
export const channelTable = pgTable('channels', {
  id: uuid('id').primaryKey(),
  serverId: uuid('server_id').notNull(), // References message_servers
  name: text('name').notNull(),
  type: text('type').notNull(),
  sourceType: text('source_type'),
  sourceId: text('source_id'),
  topic: text('topic'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { mode: 'date' })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

// Central messages table
export const messageTable = pgTable('central_messages', {
  id: text('id').primaryKey(),
  channelId: uuid('channel_id').notNull(), // References channels
  authorId: text('author_id').notNull(),
  content: text('content').notNull(),
  rawMessage: jsonb('raw_message'),
  inReplyToRootMessageId: text('in_reply_to_root_message_id'),
  sourceType: text('source_type'),
  sourceId: text('source_id'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { mode: 'date' })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

// Channel participants table
export const channelParticipantsTable = pgTable('channel_participants', {
  channelId: uuid('channel_id').notNull(), // References channels
  userId: text('user_id').notNull(),
});

// Server agents table
export const serverAgentsTable = pgTable('server_agents', {
  serverId: uuid('server_id').notNull(), // References message_servers
  agentId: uuid('agent_id').notNull(),
});
