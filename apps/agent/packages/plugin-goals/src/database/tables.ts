// Define our own TableSchema type to avoid import issues during build
interface TableSchema {
  name: string;
  pluginName: string;
  sql: string;
  fallbackSql?: string;
  dependencies?: string[];
}

/**
 * Goals plugin table definitions for the unified migration system
 */
export const GOALS_TABLES: TableSchema[] = [
  {
    name: 'goals',
    pluginName: '@elizaos/plugin-goals',
    sql: `CREATE TABLE IF NOT EXISTS "goals" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "agent_id" UUID NOT NULL,
      "owner_type" TEXT NOT NULL,
      "owner_id" UUID NOT NULL,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "is_completed" BOOLEAN DEFAULT false,
      "completed_at" TIMESTAMP,
      "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "metadata" JSONB DEFAULT '{}' NOT NULL
    )`,
    fallbackSql: `CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      is_completed BOOLEAN DEFAULT false,
      completed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT DEFAULT '{}' NOT NULL
    )`,
  },

  {
    name: 'goal_tags',
    pluginName: '@elizaos/plugin-goals',
    dependencies: ['goals'],
    sql: `CREATE TABLE IF NOT EXISTS "goal_tags" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "goal_id" UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      "tag" TEXT NOT NULL,
      "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(goal_id, tag)
    )`,
    fallbackSql: `CREATE TABLE IF NOT EXISTS goal_tags (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(goal_id, tag)
    )`,
  },
];

export interface TaskMetadata {
  dueDate?: string;
  streak?: number;
  completedToday?: boolean;
  lastReminderSent?: string;
  pointsAwarded?: number;
  completedAt?: string;
  [key: string]: any;
}
