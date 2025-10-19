// Define our own TableSchema type to avoid import issues during build
interface TableSchema {
  name: string;
  pluginName: string;
  sql: string;
  dependencies?: string[];
  fallbackSql?: string;
}

/**
 * Todo plugin table definitions for the unified migration system
 */
export const TODO_TABLES: TableSchema[] = [
  {
    name: 'todos',
    pluginName: '@elizaos/plugin-todo',
    sql: `CREATE TABLE IF NOT EXISTS "todos" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "agent_id" UUID NOT NULL,
      "world_id" UUID NOT NULL,
      "room_id" UUID NOT NULL,
      "entity_id" UUID NOT NULL,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "type" TEXT NOT NULL,
      "priority" INTEGER DEFAULT 4,
      "is_urgent" BOOLEAN DEFAULT false,
      "is_completed" BOOLEAN DEFAULT false,
      "due_date" TIMESTAMP,
      "completed_at" TIMESTAMP,
      "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "metadata" JSONB DEFAULT '{}' NOT NULL
    )`,
    fallbackSql: `CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      world_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      priority INTEGER DEFAULT 4,
      is_urgent BOOLEAN DEFAULT false,
      is_completed BOOLEAN DEFAULT false,
      due_date TIMESTAMP,
      completed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT DEFAULT '{}' NOT NULL
    )`,
  },

  {
    name: 'todo_tags',
    pluginName: '@elizaos/plugin-todo',
    dependencies: ['todos'],
    sql: `CREATE TABLE IF NOT EXISTS "todo_tags" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "todo_id" UUID NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      "tag" TEXT NOT NULL,
      "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(todo_id, tag)
    )`,
    fallbackSql: `CREATE TABLE IF NOT EXISTS todo_tags (
      id TEXT PRIMARY KEY,
      todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(todo_id, tag)
    )`,
  },
];
