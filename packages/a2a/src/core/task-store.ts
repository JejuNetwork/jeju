/**
 * Extended Task Store
 *
 * EQLite-backed task store implementation with tasks/list functionality
 * for full A2A protocol compliance. Provides filtering, pagination,
 * and task history management with persistent storage.
 *
 * @public
 */

import { type EQLiteClient, getEQLite } from '@jejunetwork/db'
import type { JsonValue } from '@jejunetwork/types'
import { z } from 'zod'
import type { Message, Task, TaskArtifact, TaskStore } from '../types/server'

// Recursive JsonValue schema
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

// Zod schemas for validating parsed JSON from database
const PartSchema = z.object({
  kind: z.enum(['text', 'data', 'file']),
  text: z.string().optional(),
  data: z.record(z.string(), JsonValueSchema).optional(),
  file: z
    .object({
      name: z.string(),
      mimeType: z.string(),
      bytes: z.string(),
    })
    .optional(),
})

const MessageSchema = z.object({
  role: z.enum(['user', 'agent']),
  messageId: z.string(),
  parts: z.array(PartSchema),
  kind: z.literal('message'),
})

const TaskArtifactSchema = z.object({
  artifactId: z.string(),
  name: z.string(),
  parts: z.array(PartSchema),
})

const HistorySchema = z.array(MessageSchema)
const ArtifactsSchema = z.array(TaskArtifactSchema)

// EQLite Database configuration
const A2A_TASKS_DATABASE_ID = 'a2a-tasks'
let eqliteClient: EQLiteClient | null = null

async function getEQLiteClient(): Promise<EQLiteClient> {
  if (!eqliteClient) {
    eqliteClient = getEQLite()
    await ensureTasksTable()
  }
  return eqliteClient
}

async function ensureTasksTable(): Promise<void> {
  if (!eqliteClient) return

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS a2a_tasks (
      id TEXT PRIMARY KEY,
      context_id TEXT NOT NULL,
      status_state TEXT NOT NULL,
      status_timestamp TEXT,
      status_message TEXT,
      history TEXT,
      artifacts TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `
  const createContextIndex = `
    CREATE INDEX IF NOT EXISTS idx_tasks_context_id ON a2a_tasks(context_id)
  `
  const createStatusIndex = `
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON a2a_tasks(status_state)
  `
  const createUpdatedIndex = `
    CREATE INDEX IF NOT EXISTS idx_tasks_updated ON a2a_tasks(updated_at DESC)
  `

  await eqliteClient.exec(createTableSQL, [], A2A_TASKS_DATABASE_ID)
  await eqliteClient.exec(createContextIndex, [], A2A_TASKS_DATABASE_ID)
  await eqliteClient.exec(createStatusIndex, [], A2A_TASKS_DATABASE_ID)
  await eqliteClient.exec(createUpdatedIndex, [], A2A_TASKS_DATABASE_ID)
}

// EQLite row type
interface TaskRow {
  id: string
  context_id: string
  status_state: string
  status_timestamp: string | null
  status_message: string | null
  history: string | null
  artifacts: string | null
  created_at: number
  updated_at: number
}

function rowToTask(row: TaskRow): Task {
  // Parse and validate history JSON with Zod schema
  let history: Message[] | undefined
  if (row.history) {
    const parsed = HistorySchema.safeParse(JSON.parse(row.history))
    if (parsed.success) {
      // Type assertion safe because Zod validated the structure
      history = parsed.data as Message[]
    } else {
      console.warn(
        `[A2A TaskStore] Invalid history JSON for task ${row.id}:`,
        parsed.error.message,
      )
    }
  }

  // Parse and validate artifacts JSON with Zod schema
  let artifacts: TaskArtifact[] | undefined
  if (row.artifacts) {
    const parsed = ArtifactsSchema.safeParse(JSON.parse(row.artifacts))
    if (parsed.success) {
      // Type assertion safe because Zod validated the structure
      artifacts = parsed.data as TaskArtifact[]
    } else {
      console.warn(
        `[A2A TaskStore] Invalid artifacts JSON for task ${row.id}:`,
        parsed.error.message,
      )
    }
  }

  return {
    kind: 'task',
    id: row.id,
    contextId: row.context_id,
    status: {
      state: row.status_state as Task['status']['state'],
      timestamp: row.status_timestamp ?? undefined,
      message: row.status_message ?? undefined,
    },
    history,
    artifacts,
  }
}

/**
 * Parameters for listing tasks
 */
export interface ListTasksParams {
  contextId?: string
  status?:
    | 'submitted'
    | 'working'
    | 'input-required'
    | 'auth-required'
    | 'completed'
    | 'failed'
    | 'canceled'
    | 'rejected'
  pageSize?: number
  pageToken?: string
  historyLength?: number
  includeArtifacts?: boolean
  lastUpdatedAfter?: number
}

/**
 * Result of listing tasks
 */
export interface ListTasksResult {
  tasks: Task[]
  totalSize: number
  pageSize: number
  nextPageToken: string
}

/**
 * EQLite-backed task store with list capability
 *
 * Provides task storage and retrieval with filtering, pagination, and
 * history management for A2A protocol compliance. All data is persisted
 * to EQLite for durability across restarts.
 */
export class ExtendedTaskStore implements TaskStore {
  /**
   * Save task to EQLite
   */
  async save(task: Task): Promise<void> {
    const client = await getEQLiteClient()
    const now = Date.now()

    // Check if task exists
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM a2a_tasks WHERE id = ?`,
      [task.id],
      A2A_TASKS_DATABASE_ID,
    )

    if (existing.rows.length > 0) {
      // Update existing task
      await client.exec(
        `UPDATE a2a_tasks SET
           context_id = ?,
           status_state = ?,
           status_timestamp = ?,
           status_message = ?,
           history = ?,
           artifacts = ?,
           updated_at = ?
         WHERE id = ?`,
        [
          task.contextId,
          task.status.state,
          task.status.timestamp ?? null,
          task.status.message ?? null,
          task.history ? JSON.stringify(task.history) : null,
          task.artifacts ? JSON.stringify(task.artifacts) : null,
          now,
          task.id,
        ],
        A2A_TASKS_DATABASE_ID,
      )
    } else {
      // Insert new task
      await client.exec(
        `INSERT INTO a2a_tasks (id, context_id, status_state, status_timestamp, status_message, history, artifacts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          task.id,
          task.contextId,
          task.status.state,
          task.status.timestamp ?? null,
          task.status.message ?? null,
          task.history ? JSON.stringify(task.history) : null,
          task.artifacts ? JSON.stringify(task.artifacts) : null,
          now,
          now,
        ],
        A2A_TASKS_DATABASE_ID,
      )
    }
  }

  /**
   * Load task from EQLite
   */
  async load(taskId: string): Promise<Task | undefined> {
    const client = await getEQLiteClient()

    const result = await client.query<TaskRow>(
      `SELECT * FROM a2a_tasks WHERE id = ?`,
      [taskId],
      A2A_TASKS_DATABASE_ID,
    )

    if (result.rows.length === 0) {
      return undefined
    }

    const row = result.rows[0]
    if (!row) return undefined

    return rowToTask(row)
  }

  /**
   * List tasks with filtering and pagination
   */
  async list(params: ListTasksParams = {}): Promise<ListTasksResult> {
    const client = await getEQLiteClient()

    // Build query with filters
    const conditions: string[] = []
    const queryParams: (string | number)[] = []

    if (params.contextId) {
      conditions.push('context_id = ?')
      queryParams.push(params.contextId)
    }

    if (params.status) {
      conditions.push('status_state = ?')
      queryParams.push(params.status)
    }

    if (params.lastUpdatedAfter !== undefined) {
      conditions.push('updated_at >= ?')
      queryParams.push(params.lastUpdatedAfter)
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Get total count
    const countResult = await client.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM a2a_tasks ${whereClause}`,
      queryParams,
      A2A_TASKS_DATABASE_ID,
    )
    const totalSize = countResult.rows[0].count ?? 0

    // Pagination
    const pageSize = Math.min(params.pageSize ?? 10, 100) // Max 100 per page
    const pageOffset = params.pageToken
      ? Number.parseInt(params.pageToken, 10)
      : 0

    // Get paginated results
    const result = await client.query<TaskRow>(
      `SELECT * FROM a2a_tasks ${whereClause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [...queryParams, pageSize, pageOffset],
      A2A_TASKS_DATABASE_ID,
    )

    // Process tasks
    const processedTasks = result.rows.map((row) => {
      const task = rowToTask(row)

      // Trim history if requested
      if (params.historyLength !== undefined && task.history) {
        task.history = task.history.slice(-params.historyLength)
      }

      // Remove artifacts if not requested
      if (params.includeArtifacts === false) {
        delete task.artifacts
      }

      return task
    })

    // Calculate next page token
    const hasMore = totalSize > pageOffset + pageSize
    const nextPageToken = hasMore ? String(pageOffset + pageSize) : ''

    return {
      tasks: processedTasks,
      totalSize,
      pageSize,
      nextPageToken,
    }
  }

  /**
   * Get all tasks (for debugging/admin)
   */
  async getAllTasks(): Promise<Task[]> {
    const client = await getEQLiteClient()

    const result = await client.query<TaskRow>(
      `SELECT * FROM a2a_tasks ORDER BY updated_at DESC`,
      [],
      A2A_TASKS_DATABASE_ID,
    )

    return result.rows.map(rowToTask)
  }

  /**
   * Clear all tasks (for testing)
   */
  async clear(): Promise<void> {
    const client = await getEQLiteClient()

    await client.exec(`DELETE FROM a2a_tasks`, [], A2A_TASKS_DATABASE_ID)
  }

  /**
   * Delete a specific task
   */
  async delete(taskId: string): Promise<boolean> {
    const client = await getEQLiteClient()

    const result = await client.exec(
      `DELETE FROM a2a_tasks WHERE id = ?`,
      [taskId],
      A2A_TASKS_DATABASE_ID,
    )

    return result.rowsAffected > 0
  }

  /**
   * Get tasks by context ID
   */
  async getByContextId(contextId: string): Promise<Task[]> {
    const client = await getEQLiteClient()

    const result = await client.query<TaskRow>(
      `SELECT * FROM a2a_tasks WHERE context_id = ? ORDER BY updated_at DESC`,
      [contextId],
      A2A_TASKS_DATABASE_ID,
    )

    return result.rows.map(rowToTask)
  }

  /**
   * Get task count
   */
  async count(): Promise<number> {
    const client = await getEQLiteClient()

    const result = await client.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM a2a_tasks`,
      [],
      A2A_TASKS_DATABASE_ID,
    )

    return result.rows[0].count ?? 0
  }

  /**
   * Clean up old completed/failed tasks (for maintenance)
   */
  async cleanup(olderThanMs: number): Promise<number> {
    const client = await getEQLiteClient()
    const cutoff = Date.now() - olderThanMs

    const result = await client.exec(
      `DELETE FROM a2a_tasks WHERE updated_at < ? AND status_state IN ('completed', 'failed', 'canceled', 'rejected')`,
      [cutoff],
      A2A_TASKS_DATABASE_ID,
    )

    return result.rowsAffected
  }
}
