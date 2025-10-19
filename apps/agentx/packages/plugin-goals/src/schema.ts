import { relations, sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  index,
  timestamp,
  boolean,
  jsonb,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Define the goals tables without schema namespace for better compatibility
// PGLite and some environments don't support PostgreSQL schemas

/**
 * Goals table - stores long-term achievable goals
 */
export const goalsTable = pgTable(
  'goals',
  {
    id: uuid('id').notNull().primaryKey(),
    agentId: uuid('agent_id').notNull(), // The agent managing this goal
    ownerType: text('owner_type').notNull(), // 'agent' or 'entity'
    ownerId: uuid('owner_id').notNull(), // Either agentId or entityId
    name: text('name').notNull(),
    description: text('description'),
    isCompleted: boolean('is_completed').default(false),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    metadata: jsonb('metadata').$type<Record<string, any>>().default({}).notNull(),
  },
  (table) => ({
    agentIdIndex: index('idx_goals_agent').on(table.agentId),
    ownerTypeIndex: index('idx_goals_owner_type').on(table.ownerType),
    ownerIdIndex: index('idx_goals_owner_id').on(table.ownerId),
    completedIndex: index('idx_goals_completed').on(table.isCompleted),
    createdAtIndex: index('idx_goals_created_at').on(table.createdAt),
  })
);

/**
 * Goal tags table - stores tags associated with goals
 */
export const goalTagsTable = pgTable(
  'goal_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goalsTable.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    goalIdIndex: index('idx_goal_tags_goal').on(table.goalId),
    tagIndex: index('idx_goal_tags_tag').on(table.tag),
    uniqueGoalTag: uniqueIndex('unique_goal_tag').on(table.goalId, table.tag),
  })
);

/**
 * Relations between tables
 */
export const goalRelations = relations(goalsTable, ({ many }) => ({
  tags: many(goalTagsTable),
}));

export const goalTagRelations = relations(goalTagsTable, ({ one }) => ({
  goal: one(goalsTable, {
    fields: [goalTagsTable.goalId],
    references: [goalsTable.id],
  }),
}));

/**
 * Export the complete schema for SQL plugin discovery
 */
export const goalSchemaExport = {
  goalsTable,
  goalTagsTable,
  // Also include the original structure for compatibility
  tables: {
    goals: goalsTable,
    goalTags: goalTagsTable,
  },
};

export default goalSchemaExport;
