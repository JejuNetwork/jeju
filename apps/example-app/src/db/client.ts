/**
 * CQL Database Client for Todo storage
 *
 * Uses CovenantSQL for decentralized SQL storage with:
 * - BFT-Raft consensus
 * - Column-level ACL
 * - Strong consistency
 *
 * Falls back to in-memory storage in localnet when CQL is unavailable.
 */

import { getCQL, type CQLClient } from '@jeju/db';
import type { Address } from 'viem';
import type { Todo, CreateTodoInput, UpdateTodoInput } from '../types';

const DATABASE_ID = process.env.CQL_DATABASE_ID || 'todo-experimental';
const NETWORK = process.env.NETWORK || 'localnet';

let dbClient: CQLClient | null = null;
let useFallback = false;

// In-memory fallback store for development/testing
const memoryStore: Map<string, TodoRow> = new Map();

export function getDatabase(): CQLClient {
  if (!dbClient) {
    dbClient = getCQL({
      blockProducerEndpoint:
        process.env.CQL_BLOCK_PRODUCER_ENDPOINT || 'http://localhost:4300',
      databaseId: DATABASE_ID,
      timeout: 30000,
      debug: process.env.NODE_ENV !== 'production',
    });
  }
  return dbClient;
}

export interface TodoRow {
  id: string;
  title: string;
  description: string;
  completed: number;
  priority: string;
  due_date: number | null;
  created_at: number;
  updated_at: number;
  owner: string;
  encrypted_data: string | null;
  attachment_cid: string | null;
}

function rowToTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    completed: row.completed === 1,
    priority: row.priority as 'low' | 'medium' | 'high',
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    owner: row.owner as Address,
    encryptedData: row.encrypted_data,
    attachmentCid: row.attachment_cid,
  };
}

export class TodoRepository {
  private db: CQLClient;

  constructor() {
    this.db = getDatabase();
  }

  private async checkFallback(): Promise<void> {
    if (useFallback) return;

    // Check if CQL is available on first operation
    const healthy = await this.db.isHealthy();
    if (!healthy && (NETWORK === 'localnet' || NETWORK === 'Jeju')) {
      console.log('[DB] CQL unavailable, using in-memory fallback for localnet');
      useFallback = true;
    }
  }

  async listByOwner(
    owner: Address,
    options?: {
      completed?: boolean;
      priority?: 'low' | 'medium' | 'high';
      search?: string;
    },
  ): Promise<Todo[]> {
    await this.checkFallback();

    if (useFallback) {
      const todos = Array.from(memoryStore.values())
        .filter((row) => row.owner.toLowerCase() === owner.toLowerCase())
        .filter((row) => {
          if (options?.completed !== undefined) {
            if ((row.completed === 1) !== options.completed) return false;
          }
          if (options?.priority && row.priority !== options.priority) return false;
          if (options?.search) {
            const search = options.search.toLowerCase();
            if (
              !row.title.toLowerCase().includes(search) &&
              !row.description.toLowerCase().includes(search)
            )
              return false;
          }
          return true;
        })
        .sort((a, b) => b.created_at - a.created_at)
        .map(rowToTodo);
      return todos;
    }

    let sql = 'SELECT * FROM todos WHERE owner = ?';
    const params: Array<string | number> = [owner.toLowerCase()];

    if (options?.completed !== undefined) {
      sql += ' AND completed = ?';
      params.push(options.completed ? 1 : 0);
    }

    if (options?.priority) {
      sql += ' AND priority = ?';
      params.push(options.priority);
    }

    if (options?.search) {
      sql += ' AND (title LIKE ? OR description LIKE ?)';
      params.push(`%${options.search}%`, `%${options.search}%`);
    }

    sql += ' ORDER BY created_at DESC';

    const result = await this.db.query<TodoRow>(sql, params);
    return result.rows.map(rowToTodo);
  }

  async getById(id: string, owner: Address): Promise<Todo | null> {
    await this.checkFallback();

    if (useFallback) {
      const row = memoryStore.get(id);
      if (!row || row.owner.toLowerCase() !== owner.toLowerCase()) return null;
      return rowToTodo(row);
    }

    const result = await this.db.query<TodoRow>(
      'SELECT * FROM todos WHERE id = ? AND owner = ?',
      [id, owner.toLowerCase()],
    );

    if (result.rows.length === 0) return null;
    return rowToTodo(result.rows[0]);
  }

  async create(owner: Address, input: CreateTodoInput): Promise<Todo> {
    await this.checkFallback();

    const id = `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const row: TodoRow = {
      id,
      title: input.title,
      description: input.description || '',
      completed: 0,
      priority: input.priority || 'medium',
      due_date: input.dueDate || null,
      created_at: now,
      updated_at: now,
      owner: owner.toLowerCase(),
      encrypted_data: null,
      attachment_cid: null,
    };

    if (useFallback) {
      memoryStore.set(id, row);
    } else {
      await this.db.exec(
        `INSERT INTO todos (id, title, description, completed, priority, due_date, created_at, updated_at, owner, encrypted_data, attachment_cid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.title,
          input.description || '',
          0,
          input.priority || 'medium',
          input.dueDate || null,
          now,
          now,
          owner.toLowerCase(),
          null,
          null,
        ],
      );
    }

    return rowToTodo(row);
  }

  async update(
    id: string,
    owner: Address,
    input: UpdateTodoInput,
  ): Promise<Todo | null> {
    await this.checkFallback();

    const existing = await this.getById(id, owner);
    if (!existing) return null;

    if (useFallback) {
      const row = memoryStore.get(id);
      if (!row) return null;

      if (input.title !== undefined) row.title = input.title;
      if (input.description !== undefined) row.description = input.description;
      if (input.completed !== undefined) row.completed = input.completed ? 1 : 0;
      if (input.priority !== undefined) row.priority = input.priority;
      if (input.dueDate !== undefined) row.due_date = input.dueDate;
      row.updated_at = Date.now();

      memoryStore.set(id, row);
      return rowToTodo(row);
    }

    const updates: string[] = [];
    const params: Array<string | number | null> = [];

    if (input.title !== undefined) {
      updates.push('title = ?');
      params.push(input.title);
    }

    if (input.description !== undefined) {
      updates.push('description = ?');
      params.push(input.description);
    }

    if (input.completed !== undefined) {
      updates.push('completed = ?');
      params.push(input.completed ? 1 : 0);
    }

    if (input.priority !== undefined) {
      updates.push('priority = ?');
      params.push(input.priority);
    }

    if (input.dueDate !== undefined) {
      updates.push('due_date = ?');
      params.push(input.dueDate);
    }

    if (updates.length === 0) return existing;

    const now = Date.now();
    updates.push('updated_at = ?');
    params.push(now);

    params.push(id, owner.toLowerCase());

    await this.db.exec(
      `UPDATE todos SET ${updates.join(', ')} WHERE id = ? AND owner = ?`,
      params,
    );

    return this.getById(id, owner);
  }

  async delete(id: string, owner: Address): Promise<boolean> {
    await this.checkFallback();

    if (useFallback) {
      const row = memoryStore.get(id);
      if (!row || row.owner.toLowerCase() !== owner.toLowerCase()) return false;
      memoryStore.delete(id);
      return true;
    }

    const result = await this.db.exec(
      'DELETE FROM todos WHERE id = ? AND owner = ?',
      [id, owner.toLowerCase()],
    );
    return result.rowsAffected > 0;
  }

  async setEncryptedData(
    id: string,
    owner: Address,
    encryptedData: string,
  ): Promise<boolean> {
    await this.checkFallback();

    if (useFallback) {
      const row = memoryStore.get(id);
      if (!row || row.owner.toLowerCase() !== owner.toLowerCase()) return false;
      row.encrypted_data = encryptedData;
      row.updated_at = Date.now();
      memoryStore.set(id, row);
      return true;
    }

    const result = await this.db.exec(
      'UPDATE todos SET encrypted_data = ?, updated_at = ? WHERE id = ? AND owner = ?',
      [encryptedData, Date.now(), id, owner.toLowerCase()],
    );
    return result.rowsAffected > 0;
  }

  async setAttachmentCid(
    id: string,
    owner: Address,
    cid: string,
  ): Promise<boolean> {
    await this.checkFallback();

    if (useFallback) {
      const row = memoryStore.get(id);
      if (!row || row.owner.toLowerCase() !== owner.toLowerCase()) return false;
      row.attachment_cid = cid;
      row.updated_at = Date.now();
      memoryStore.set(id, row);
      return true;
    }

    const result = await this.db.exec(
      'UPDATE todos SET attachment_cid = ?, updated_at = ? WHERE id = ? AND owner = ?',
      [cid, Date.now(), id, owner.toLowerCase()],
    );
    return result.rowsAffected > 0;
  }

  async getStats(owner: Address): Promise<{
    total: number;
    completed: number;
    pending: number;
    overdue: number;
    byPriority: { low: number; medium: number; high: number };
  }> {
    const todos = await this.listByOwner(owner);
    const now = Date.now();

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
    };
  }

  async bulkComplete(ids: string[], owner: Address): Promise<Todo[]> {
    await this.checkFallback();

    if (useFallback) {
      const completed: Todo[] = [];
      for (const id of ids) {
        const row = memoryStore.get(id);
        if (row && row.owner.toLowerCase() === owner.toLowerCase()) {
          row.completed = 1;
          row.updated_at = Date.now();
          memoryStore.set(id, row);
          completed.push(rowToTodo(row));
        }
      }
      return completed;
    }

    const placeholders = ids.map(() => '?').join(', ');
    const now = Date.now();

    await this.db.exec(
      `UPDATE todos SET completed = 1, updated_at = ? WHERE id IN (${placeholders}) AND owner = ?`,
      [now, ...ids, owner.toLowerCase()],
    );

    const completed: Todo[] = [];
    for (const id of ids) {
      const todo = await this.getById(id, owner);
      if (todo) completed.push(todo);
    }
    return completed;
  }

  async bulkDelete(ids: string[], owner: Address): Promise<number> {
    await this.checkFallback();

    if (useFallback) {
      let count = 0;
      for (const id of ids) {
        const row = memoryStore.get(id);
        if (row && row.owner.toLowerCase() === owner.toLowerCase()) {
          memoryStore.delete(id);
          count++;
        }
      }
      return count;
    }

    const placeholders = ids.map(() => '?').join(', ');

    const result = await this.db.exec(
      `DELETE FROM todos WHERE id IN (${placeholders}) AND owner = ?`,
      [...ids, owner.toLowerCase()],
    );

    return result.rowsAffected;
  }
}

let repository: TodoRepository | null = null;

export function getTodoRepository(): TodoRepository {
  if (!repository) {
    repository = new TodoRepository();
  }
  return repository;
}

// For testing: reset the repository and memory store
export function resetRepository(): void {
  repository = null;
  memoryStore.clear();
  useFallback = false;
}
