import {
  getEQLiteBlockProducerUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import { type EQLiteClient, getEQLite } from '@jejunetwork/db'
import { expectAddress } from '@jejunetwork/types'
import type { Address } from 'viem'
import {
  type CreateTodoInput,
  expectPriority,
  type Todo,
  type UpdateTodoInput,
} from '../../lib/schemas'

const DATABASE_ID = process.env.EQLITE_DATABASE_ID || 'todo-experimental'

let dbClient: EQLiteClient | null = null

export function getDatabase(): EQLiteClient {
  if (!dbClient) {
    dbClient = getEQLite({
      blockProducerEndpoint:
        process.env.EQLITE_BLOCK_PRODUCER_ENDPOINT ||
        getEQLiteBlockProducerUrl(),
      databaseId: DATABASE_ID,
      timeout: 30000,
      debug: !isProductionEnv(),
    })
  }
  return dbClient
}

export interface TodoRow {
  id: string
  title: string
  description: string
  completed: number
  priority: string
  due_date: number | null
  created_at: number
  updated_at: number
  owner: string
  encrypted_data: string | null
  attachment_cid: string | null
}

function rowToTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    completed: row.completed === 1,
    priority: expectPriority(row.priority, `Todo ${row.id} priority`),
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    owner: expectAddress(row.owner, `Todo ${row.id} owner`),
    encryptedData: row.encrypted_data,
    attachmentCid: row.attachment_cid,
  }
}

export class TodoRepository {
  private db: EQLiteClient

  constructor() {
    this.db = getDatabase()
  }

  // Default pagination limits to prevent DoS
  private static readonly DEFAULT_LIMIT = 100
  private static readonly MAX_LIMIT = 500

  async listByOwner(
    owner: Address,
    options?: {
      completed?: boolean
      priority?: 'low' | 'medium' | 'high'
      search?: string
      limit?: number
      offset?: number
    },
  ): Promise<Todo[]> {
    // Apply pagination limits (DoS prevention)
    const limit = Math.min(
      options?.limit ?? TodoRepository.DEFAULT_LIMIT,
      TodoRepository.MAX_LIMIT,
    )
    const offset = Math.max(options?.offset ?? 0, 0)

    let sql = 'SELECT * FROM todos WHERE owner = ?'
    const params: Array<string | number> = [owner.toLowerCase()]

    if (options?.completed !== undefined) {
      sql += ' AND completed = ?'
      params.push(options.completed ? 1 : 0)
    }

    if (options?.priority) {
      sql += ' AND priority = ?'
      params.push(options.priority)
    }

    if (options?.search) {
      sql += ' AND (title LIKE ? OR description LIKE ?)'
      params.push(`%${options.search}%`, `%${options.search}%`)
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const result = await this.db.query<TodoRow>(sql, params)
    return result.rows.map(rowToTodo)
  }

  async getById(id: string, owner: Address): Promise<Todo | null> {
    const result = await this.db.query<TodoRow>(
      'SELECT * FROM todos WHERE id = ? AND owner = ?',
      [id, owner.toLowerCase()],
    )

    if (result.rows.length === 0) return null
    return rowToTodo(result.rows[0])
  }

  async create(owner: Address, input: CreateTodoInput): Promise<Todo> {
    const id = `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()

    const row: TodoRow = {
      id,
      title: input.title,
      description: input.description !== undefined ? input.description : '',
      completed: 0,
      priority: input.priority !== undefined ? input.priority : 'medium',
      due_date: input.dueDate !== undefined ? input.dueDate : null,
      created_at: now,
      updated_at: now,
      owner: owner.toLowerCase(),
      encrypted_data: null,
      attachment_cid: null,
    }

    await this.db.exec(
      `INSERT INTO todos (id, title, description, completed, priority, due_date, created_at, updated_at, owner, encrypted_data, attachment_cid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.title,
        row.description,
        0,
        row.priority,
        row.due_date,
        now,
        now,
        owner.toLowerCase(),
        null,
        null,
      ],
    )

    return rowToTodo(row)
  }

  async update(
    id: string,
    owner: Address,
    input: UpdateTodoInput,
  ): Promise<Todo | null> {
    const existing = await this.getById(id, owner)
    if (!existing) return null

    const updates: string[] = []
    const params: Array<string | number | null> = []

    if (input.title !== undefined) {
      updates.push('title = ?')
      params.push(input.title)
    }

    if (input.description !== undefined) {
      updates.push('description = ?')
      params.push(input.description)
    }

    if (input.completed !== undefined) {
      updates.push('completed = ?')
      params.push(input.completed ? 1 : 0)
    }

    if (input.priority !== undefined) {
      updates.push('priority = ?')
      params.push(input.priority)
    }

    if (input.dueDate !== undefined) {
      updates.push('due_date = ?')
      params.push(input.dueDate)
    }

    if (updates.length === 0) return existing

    const now = Date.now()
    updates.push('updated_at = ?')
    params.push(now)

    params.push(id, owner.toLowerCase())

    await this.db.exec(
      `UPDATE todos SET ${updates.join(', ')} WHERE id = ? AND owner = ?`,
      params,
    )

    return this.getById(id, owner)
  }

  async delete(id: string, owner: Address): Promise<boolean> {
    const result = await this.db.exec(
      'DELETE FROM todos WHERE id = ? AND owner = ?',
      [id, owner.toLowerCase()],
    )
    return result.rowsAffected > 0
  }

  async setEncryptedData(
    id: string,
    owner: Address,
    encryptedData: string,
  ): Promise<boolean> {
    const result = await this.db.exec(
      'UPDATE todos SET encrypted_data = ?, updated_at = ? WHERE id = ? AND owner = ?',
      [encryptedData, Date.now(), id, owner.toLowerCase()],
    )
    return result.rowsAffected > 0
  }

  async setAttachmentCid(
    id: string,
    owner: Address,
    cid: string,
  ): Promise<boolean> {
    const result = await this.db.exec(
      'UPDATE todos SET attachment_cid = ?, updated_at = ? WHERE id = ? AND owner = ?',
      [cid, Date.now(), id, owner.toLowerCase()],
    )
    return result.rowsAffected > 0
  }

  async getStats(owner: Address): Promise<{
    total: number
    completed: number
    pending: number
    overdue: number
    byPriority: { low: number; medium: number; high: number }
  }> {
    const todos = await this.listByOwner(owner)
    const now = Date.now()

    return {
      total: todos.length,
      completed: todos.filter((t) => t.completed).length,
      pending: todos.filter((t) => !t.completed).length,
      overdue: todos.filter((t) => !t.completed && t.dueDate && t.dueDate < now)
        .length,
      byPriority: {
        low: todos.filter((t) => t.priority === 'low').length,
        medium: todos.filter((t) => t.priority === 'medium').length,
        high: todos.filter((t) => t.priority === 'high').length,
      },
    }
  }

  async bulkComplete(ids: string[], owner: Address): Promise<Todo[]> {
    const placeholders = ids.map(() => '?').join(', ')
    const now = Date.now()

    await this.db.exec(
      `UPDATE todos SET completed = 1, updated_at = ? WHERE id IN (${placeholders}) AND owner = ?`,
      [now, ...ids, owner.toLowerCase()],
    )

    const completed: Todo[] = []
    for (const id of ids) {
      const todo = await this.getById(id, owner)
      if (todo) completed.push(todo)
    }
    return completed
  }

  async bulkDelete(ids: string[], owner: Address): Promise<number> {
    const placeholders = ids.map(() => '?').join(', ')

    const result = await this.db.exec(
      `DELETE FROM todos WHERE id IN (${placeholders}) AND owner = ?`,
      [...ids, owner.toLowerCase()],
    )

    return result.rowsAffected
  }
}

let repository: TodoRepository | null = null

export function getTodoRepository(): TodoRepository {
  if (!repository) {
    repository = new TodoRepository()
  }
  return repository
}

// For testing: reset the repository
export function resetRepository(): void {
  repository = null
}
