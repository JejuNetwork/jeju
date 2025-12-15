/**
 * Todo Service - Main business logic
 * 
 * Orchestrates all services:
 * - Database (CQL)
 * - Cache (Compute Redis)
 * - Storage (IPFS)
 * - KMS (Encryption)
 */

import type { Address } from 'viem';
import type { Todo, CreateTodoInput, UpdateTodoInput } from '../types';
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
    // Skip cache if filtering
    if (options?.priority || options?.search || options?.completed !== undefined) {
      return this.repository.listByOwner(owner, options);
    }

    // Check cache
    const cacheKey = cacheKeys.todoList(owner);
    const cached = await this.cache.get<Todo[]>(cacheKey);
    if (cached) return cached;

    const todos = await this.repository.listByOwner(owner);
    await this.cache.set(cacheKey, todos, 60000); // 1 minute TTL
    return todos;
  }

  async getTodo(id: string, owner: Address): Promise<Todo | null> {
    const cacheKey = cacheKeys.todoItem(id);
    const cached = await this.cache.get<Todo>(cacheKey);
    if (cached && cached.owner.toLowerCase() === owner.toLowerCase()) {
      return cached;
    }

    const todo = await this.repository.getById(id, owner);
    if (todo) {
      await this.cache.set(cacheKey, todo, 60000);
    }
    return todo;
  }

  async createTodo(owner: Address, input: CreateTodoInput): Promise<Todo> {
    let todo = await this.repository.create(owner, input);

    // Handle encryption if requested
    if (input.encrypt) {
      const sensitiveData = JSON.stringify({
        title: todo.title,
        description: todo.description,
      });
      const encrypted = await this.kms.encrypt(sensitiveData, owner);
      await this.repository.setEncryptedData(todo.id, owner, encrypted);
      todo = (await this.repository.getById(todo.id, owner))!;
    }

    // Handle attachment if provided
    if (input.attachment) {
      const cid = await this.storage.upload(input.attachment, `${todo.id}-attachment`, owner);
      await this.repository.setAttachmentCid(todo.id, owner, cid);
      todo = (await this.repository.getById(todo.id, owner))!;
    }

    // Invalidate cache
    await this.invalidateOwnerCache(owner);

    return todo;
  }

  async updateTodo(id: string, owner: Address, input: UpdateTodoInput): Promise<Todo | null> {
    const todo = await this.repository.update(id, owner, input);
    if (!todo) return null;

    // Invalidate caches
    await this.cache.delete(cacheKeys.todoItem(id));
    await this.invalidateOwnerCache(owner);

    return todo;
  }

  async deleteTodo(id: string, owner: Address): Promise<boolean> {
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
    const data = JSON.parse(decrypted) as { title: string; description: string };

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
    const cacheKey = cacheKeys.todoStats(owner);
    const cached = await this.cache.get<ReturnType<typeof this.getStats>>(cacheKey);
    if (cached) return cached;

    const stats = await this.repository.getStats(owner);
    await this.cache.set(cacheKey, stats, 30000); // 30 second TTL
    return stats;
  }

  async bulkComplete(ids: string[], owner: Address): Promise<Todo[]> {
    const completed = await this.repository.bulkComplete(ids, owner);
    await this.invalidateOwnerCache(owner);
    for (const id of ids) {
      await this.cache.delete(cacheKeys.todoItem(id));
    }
    return completed;
  }

  async bulkDelete(ids: string[], owner: Address): Promise<number> {
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
