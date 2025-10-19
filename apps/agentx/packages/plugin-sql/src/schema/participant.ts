import { pgTable, text, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { entityTable } from './entity';
import { roomTable } from './room';
import { agentTable } from './agent';
import { sql } from 'drizzle-orm';

export const participantTable = pgTable(
  'participants',
  {
    id: uuid('id')
      .notNull()
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    entityId: uuid('entity_id').references(() => entityTable.id, {
      onDelete: 'cascade',
    }),
    roomId: uuid('room_id').references(() => roomTable.id, {
      onDelete: 'cascade',
    }),
    agentId: uuid('agent_id').references(() => agentTable.id, {
      onDelete: 'cascade',
    }),
    roomState: text('room_state'),
  },
  (table) => ({
    // Indexes for faster queries
    entityIdx: index('participant_entity_idx').on(table.entityId),
    roomIdx: index('participant_room_idx').on(table.roomId),
    agentIdx: index('participant_agent_idx').on(table.agentId),
    // Index for finding participants in a room
    roomEntityIdx: index('participant_room_entity_idx').on(table.roomId, table.entityId),
    // Index for finding all rooms a participant is in
    entityRoomIdx: index('participant_entity_room_idx').on(table.entityId, table.roomId),
  })
);

export type Participant = typeof participantTable.$inferSelect;
export type NewParticipant = typeof participantTable.$inferInsert;

export const participantRelations = {
  room: roomTable,
  entity: entityTable,
  agent: agentTable,
};
