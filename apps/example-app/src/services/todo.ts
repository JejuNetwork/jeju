/**
 * Todo Service - Main business logic
 * 
 * Orchestrates all services:
 * - Database (CQL)
 * - Cache (Compute Redis)
 * - Storage (IPFS)
 * - KMS (Encryption)
 * 
 * Uses zod validation and expect/throw patterns throughout.
 */

import type { Address } from 'viem';
import type { Todo, CreateTodoInput, UpdateTodoInput } from '../types';
import {
  createTodoInputSchema,
  updateTodoInputSchema,
  todoSchema,
  todoStatsSchema,
  addressSchema,
  todoIdSchema,
  decryptedTodoDataSchema,
} from '../schemas';
import { expectValid, ValidationError } from '../utils/validation';
import { getTodoRepository } from '../db/client';
import { getCache, cacheKeys } from './cache';
import { getKMSService } from './kms';
import { getStorageService } from './storage';

interface TodoService {
  listTodos(owner: Address, options?: {
    completed?: boolean;
    priority?: 'low' | 'medium' | 'high';
    search?: string;
  }): Promise<Todo[]>;
  getTodo(id: string, owner: Address): Promise<Todo | null>;
  createTodo(owner: Address, input: CreateTodoInput): Promise<Todo>;
  updateTodo(id: string, owner: Address, input: UpdateTodoInput): Promise<Todo | null>;
  deleteTodo(id: string, owner: Address): Promise<boolean>;
  encryptTodo(id: string, owner: Address): Promise<Todo | null>;
  decryptTodo(id: string, owner: Address): Promise<Todo | null>;
  attachFile(id: string, owner: Address, data: Uint8Array): Promise<Todo | null>;
  getStats(owner: Address): Promise<{
    total: number;
    completed: number;
    pending: number;
    overdue: number;
    byPriority: { low: number; medium: number; high: number };
  }>;
  bulkComplete(ids: string[], owner: Address): Promise<Todo[]>;
  bulkDelete(ids: string[], owner: Address): Promise<number>;
}

class TodoServiceImpl implements TodoService {
  private repository = getTodoRepository();
  private cache = getCache();
  private kms = getKMSService();
  private storage = getStorageService();

  async listTodos(owner: Address, options?: {
    completed?: boolean;
    priority?: 'low' | 'medium' | 'high';
    search?: string;
  }): Promise<Todo[]> {
    expectValid(addressSchema, owner, 'Owner address');

    // Skip cache if filtering
    if (options?.priority || options?.search || options?.completed !== undefined) {
      const todos = await this.repository.listByOwner(owner, options);
      // Validate all todos
      return todos.map(todo => expectValid(todoSchema, todo, `Todo ${todo.id}`));
    }

    // Check cache
    const cacheKey = cacheKeys.todoList(owner);
    const cached = await this.cache.get<Todo[]>(cacheKey);
    if (cached) {
      return cached.map(todo => expectValid(todoSchema, todo, `Cached todo ${todo.id}`));
    }

    const todos = await this.repository.listByOwner(owner);
    const validatedTodos = todos.map(todo => expectValid(todoSchema, todo, `Todo ${todo.id}`));
    await this.cache.set(cacheKey, validatedTodos, 60000); // 1 minute TTL
    return validatedTodos;
  }

  async getTodo(id: string, owner: Address): Promise<Todo | null> {
    expectValid(todoIdSchema, id, 'Todo ID');
    expectValid(addressSchema, owner, 'Owner address');

    const cacheKey = cacheKeys.todoItem(id);
    const cached = await this.cache.get<Todo>(cacheKey);
    if (cached && cached.owner.toLowerCase() === owner.toLowerCase()) {
      return expectValid(todoSchema, cached, `Cached todo ${id}`);
    }

    const todo = await this.repository.getById(id, owner);
    if (todo) {
      const validatedTodo = expectValid(todoSchema, todo, `Todo ${id}`);
      await this.cache.set(cacheKey, validatedTodo, 60000);
      return validatedTodo;
    }
    return null;
  }

  async createTodo(owner: Address, input: CreateTodoInput): Promise<Todo> {
    expectValid(addressSchema, owner, 'Owner address');

    const validatedInput = expectValid(createTodoInputSchema, input, 'Create todo input');
    let todo = await this.repository.create(owner, validatedInput);
    todo = expectValid(todoSchema, todo, `Created todo ${todo.id}`);

    // Handle encryption if requested
    if (validatedInput.encrypt) {
      const sensitiveData = JSON.stringify({
        title: todo.title,
        description: todo.description,
      });
      const encrypted = await this.kms.encrypt(sensitiveData, owner);
      await this.repository.setEncryptedData(todo.id, owner, encrypted);
      const updated = await this.repository.getById(todo.id, owner);
      if (!updated) {
        throw new ValidationError(`Failed to retrieve todo ${todo.id} after encryption`);
      }
      todo = expectValid(todoSchema, updated, `Encrypted todo ${todo.id}`);
    }

    // Handle attachment if provided
    if (validatedInput.attachment) {
      const cid = await this.storage.upload(validatedInput.attachment, `${todo.id}-attachment`, owner);
      await this.repository.setAttachmentCid(todo.id, owner, cid);
      const updated = await this.repository.getById(todo.id, owner);
      if (!updated) {
        throw new ValidationError(`Failed to retrieve todo ${todo.id} after attachment`);
      }
      todo = expectValid(todoSchema, updated, `Todo with attachment ${todo.id}`);
    }

    // Invalidate cache
    await this.invalidateOwnerCache(owner);

    return todo;
  }

  async updateTodo(id: string, owner: Address, input: UpdateTodoInput): Promise<Todo | null> {
    expectValid(todoIdSchema, id, 'Todo ID');
    expectValid(addressSchema, owner, 'Owner address');

    const validatedInput = expectValid(updateTodoInputSchema, input, 'Update todo input');
    const todo = await this.repository.update(id, owner, validatedInput);
    if (!todo) return null;

    const validatedTodo = expectValid(todoSchema, todo, `Updated todo ${id}`);

    // Invalidate caches
    await this.cache.delete(cacheKeys.todoItem(id));
    await this.invalidateOwnerCache(owner);

    return validatedTodo;
  }

  async deleteTodo(id: string, owner: Address): Promise<boolean> {
    expectValid(todoIdSchema, id, 'Todo ID');
    expectValid(addressSchema, owner, 'Owner address');

    const deleted = await this.repository.delete(id, owner);
    if (deleted) {
      await this.cache.delete(cacheKeys.todoItem(id));
      await this.invalidateOwnerCache(owner);
    }
    return deleted;
  }

  async encryptTodo(id: string, owner: Address): Promise<Todo | null> {
    const todo = await this.repository.getById(id, owner);
    if (!todo) return null;

    // Already encrypted
    if (todo.encryptedData) return todo;

    const sensitiveData = JSON.stringify({
      title: todo.title,
      description: todo.description,
    });
    const encrypted = await this.kms.encrypt(sensitiveData, owner);
    await this.repository.setEncryptedData(id, owner, encrypted);

    // Invalidate cache
    await this.cache.delete(cacheKeys.todoItem(id));
    await this.invalidateOwnerCache(owner);

    return this.repository.getById(id, owner);
  }

  async decryptTodo(id: string, owner: Address): Promise<Todo | null> {
    const todo = await this.repository.getById(id, owner);
    if (!todo || !todo.encryptedData) return todo;

    const decrypted = await this.kms.decrypt(todo.encryptedData, owner);
    const parsed: unknown = JSON.parse(decrypted);
    const data = expectValid(decryptedTodoDataSchema, parsed, 'Decrypted todo data');

    // Return todo with decrypted data (but don't persist decryption)
    return {
      ...todo,
      title: data.title,
      description: data.description,
    };
  }

  async attachFile(id: string, owner: Address, data: Uint8Array): Promise<Todo | null> {
    const todo = await this.repository.getById(id, owner);
    if (!todo) return null;

    const cid = await this.storage.upload(data, `${id}-attachment-${Date.now()}`, owner);
    await this.repository.setAttachmentCid(id, owner, cid);

    // Invalidate cache
    await this.cache.delete(cacheKeys.todoItem(id));
    await this.invalidateOwnerCache(owner);

    return this.repository.getById(id, owner);
  }

  async getStats(owner: Address): Promise<{
    total: number;
    completed: number;
    pending: number;
    overdue: number;
    byPriority: { low: number; medium: number; high: number };
  }> {
    expectValid(addressSchema, owner, 'Owner address');

    const cacheKey = cacheKeys.todoStats(owner);
    const cached = await this.cache.get<ReturnType<typeof this.getStats>>(cacheKey);
    if (cached) {
      return expectValid(todoStatsSchema, cached, 'Cached todo stats');
    }

    const stats = await this.repository.getStats(owner);
    const validatedStats = expectValid(todoStatsSchema, stats, 'Todo stats');
    await this.cache.set(cacheKey, validatedStats, 30000); // 30 second TTL
    return validatedStats;
  }

  async bulkComplete(ids: string[], owner: Address): Promise<Todo[]> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new ValidationError('IDs array is required and cannot be empty');
    }
    expectValid(addressSchema, owner, 'Owner address');
    // Validate all IDs
    ids.forEach((id, i) => expectValid(todoIdSchema, id, `Todo ID at index ${i}`));

    const completed = await this.repository.bulkComplete(ids, owner);
    const validatedTodos = completed.map(todo => 
      expectValid(todoSchema, todo, `Bulk completed todo ${todo.id}`)
    );
    
    await this.invalidateOwnerCache(owner);
    for (const id of ids) {
      await this.cache.delete(cacheKeys.todoItem(id));
    }
    return validatedTodos;
  }

  async bulkDelete(ids: string[], owner: Address): Promise<number> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new ValidationError('IDs array is required and cannot be empty');
    }
    expectValid(addressSchema, owner, 'Owner address');
    // Validate all IDs
    ids.forEach((id, i) => expectValid(todoIdSchema, id, `Todo ID at index ${i}`));

    const count = await this.repository.bulkDelete(ids, owner);
    await this.invalidateOwnerCache(owner);
    for (const id of ids) {
      await this.cache.delete(cacheKeys.todoItem(id));
    }
    return count;
  }

  private async invalidateOwnerCache(owner: Address): Promise<void> {
    await this.cache.delete(cacheKeys.todoList(owner));
    await this.cache.delete(cacheKeys.todoStats(owner));
  }
}

let todoService: TodoService | null = null;

export function getTodoService(): TodoService {
  if (!todoService) {
    todoService = new TodoServiceImpl();
  }
  return todoService;
}
