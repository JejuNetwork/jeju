import type { IAgentRuntime, UUID } from '@elizaos/core';
import { logger, Service, ServiceTypeName } from '@elizaos/core';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { todosTable, todoTagsTable } from '../schema';
import type { TodoMetadata } from '../types';

/**
 * Core todo data structure
 */
export interface TodoData {
  id: UUID;
  agentId: UUID;
  worldId: UUID;
  roomId: UUID;
  entityId: UUID;
  name: string;
  description?: string | null;
  type: 'daily' | 'one-off' | 'aspirational';
  priority?: number | null;
  isUrgent: boolean;
  isCompleted: boolean;
  dueDate?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  metadata: TodoMetadata;
  tags?: string[];
}

/**
 * Manages todo data and database operations
 */
export class TodoDataManager {
  protected runtime: IAgentRuntime;

  constructor(runtime: IAgentRuntime) {
    this.runtime = runtime;
  }

  /**
   * Create a new todo
   */
  async createTodo(data: {
    agentId: UUID;
    worldId: UUID;
    roomId: UUID;
    entityId: UUID;
    name: string;
    description?: string;
    type: 'daily' | 'one-off' | 'aspirational';
    priority?: number;
    isUrgent?: boolean;
    dueDate?: Date;
    metadata?: TodoMetadata;
    tags?: string[];
  }): Promise<UUID> {
    if (!this.runtime.db) {
      throw new Error('Database not available in runtime');
    }

    const { db } = this.runtime;

    // Create the todo
    const [todo] = await db
      .insert(todosTable)
      .values({
        agentId: data.agentId,
        worldId: data.worldId,
        roomId: data.roomId,
        entityId: data.entityId,
        name: data.name,
        description: data.description,
        type: data.type,
        priority: data.priority,
        isUrgent: data.isUrgent,
        dueDate: data.dueDate,
        metadata: data.metadata || {},
      })
      .returning();

    if (!todo) {
      throw new Error('Failed to create todo');
    }

    // Add tags if provided
    if (data.tags && data.tags.length > 0) {
      await db.insert(todoTagsTable).values(
        data.tags.map((tag) => ({
          todoId: todo.id,
          tag,
        }))
      );
    }

    logger.info(`Created todo: ${todo.id} - ${todo.name}`);
    return todo.id;
  }

  /**
   * Get a single todo by ID
   */
  async getTodo(todoId: UUID): Promise<TodoData | null> {
    if (!this.runtime.db) {
      logger.warn('Database not available in runtime, returning null');
      return null;
    }

    const { db } = this.runtime;

    const [todo] = await db.select().from(todosTable).where(eq(todosTable.id, todoId)).limit(1);

    if (!todo) {
      return null;
    }

    // Fetch tags
    const tags = await db
      .select({ tag: todoTagsTable.tag })
      .from(todoTagsTable)
      .where(eq(todoTagsTable.todoId, todoId));

    return {
      ...todo,
      tags: tags.map((t: { tag: string }) => t.tag),
    } as TodoData;
  }

  /**
   * Get todos with optional filters
   */
  async getTodos(filters?: {
    agentId?: UUID;
    worldId?: UUID;
    roomId?: UUID;
    entityId?: UUID;
    type?: 'daily' | 'one-off' | 'aspirational';
    isCompleted?: boolean;
    tags?: string[];
    limit?: number;
  }): Promise<TodoData[]> {
    if (!this.runtime.db) {
      logger.warn('Database not available in runtime, returning empty array');
      return [];
    }

    const { db } = this.runtime;

    let query = db.select().from(todosTable);

    // Apply filters
    const conditions: Array<ReturnType<typeof eq>> = [];
    if (filters?.agentId) {
      conditions.push(eq(todosTable.agentId, filters.agentId));
    }
    if (filters?.worldId) {
      conditions.push(eq(todosTable.worldId, filters.worldId));
    }
    if (filters?.roomId) {
      conditions.push(eq(todosTable.roomId, filters.roomId));
    }
    if (filters?.entityId) {
      conditions.push(eq(todosTable.entityId, filters.entityId));
    }
    if (filters?.type) {
      conditions.push(eq(todosTable.type, filters.type));
    }
    if (filters?.isCompleted !== undefined) {
      conditions.push(eq(todosTable.isCompleted, filters.isCompleted));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    // Order by created date
    query = query.orderBy(desc(todosTable.createdAt));

    // Apply limit
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const todos = await query;

    // Fetch tags for each todo
    const todosWithTags = await Promise.all(
      todos.map(async (todo: (typeof todos)[0]) => {
        const tags = await db
          .select({ tag: todoTagsTable.tag })
          .from(todoTagsTable)
          .where(eq(todoTagsTable.todoId, todo.id));

        return {
          ...todo,
          tags: tags.map((t: { tag: string }) => t.tag),
        } as TodoData;
      })
    );

    // Filter by tags if specified
    if (filters?.tags && filters.tags.length > 0) {
      return todosWithTags.filter((todo) => filters.tags!.some((tag) => todo.tags?.includes(tag)));
    }

    return todosWithTags;
  }

  /**
   * Update a todo
   */
  async updateTodo(
    todoId: UUID,
    updates: {
      name?: string;
      description?: string;
      priority?: number;
      isUrgent?: boolean;
      isCompleted?: boolean;
      dueDate?: Date;
      completedAt?: Date;
      metadata?: TodoMetadata;
    }
  ): Promise<boolean> {
    if (!this.runtime.db) {
      logger.warn('Database not available in runtime, cannot update todo');
      return false;
    }

    const { db } = this.runtime;

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (updates.name !== undefined) {
      updateData.name = updates.name;
    }
    if (updates.description !== undefined) {
      updateData.description = updates.description;
    }
    if (updates.priority !== undefined) {
      updateData.priority = updates.priority;
    }
    if (updates.isUrgent !== undefined) {
      updateData.isUrgent = updates.isUrgent;
    }
    if (updates.isCompleted !== undefined) {
      updateData.isCompleted = updates.isCompleted;
    }
    if (updates.dueDate !== undefined) {
      updateData.dueDate = updates.dueDate;
    }
    if (updates.completedAt !== undefined) {
      updateData.completedAt = updates.completedAt;
    }
    if (updates.metadata !== undefined) {
      updateData.metadata = updates.metadata;
    }

    await db.update(todosTable).set(updateData).where(eq(todosTable.id, todoId));

    return true;
  }

  /**
   * Delete a todo
   */
  async deleteTodo(todoId: UUID): Promise<boolean> {
    if (!this.runtime.db) {
      logger.warn('Database not available in runtime, cannot delete todo');
      return false;
    }

    const { db } = this.runtime;

    await db.delete(todosTable).where(eq(todosTable.id, todoId));

    logger.info(`Deleted todo: ${todoId}`);
    return true;
  }

  /**
   * Add tags to a todo
   */
  async addTags(todoId: UUID, tags: string[]): Promise<boolean> {
    if (!this.runtime.db) {
      logger.warn('Database not available in runtime, cannot add tags');
      return false;
    }

    const { db } = this.runtime;

    // Filter out existing tags
    const existingTags = await db
      .select({ tag: todoTagsTable.tag })
      .from(todoTagsTable)
      .where(eq(todoTagsTable.todoId, todoId));

    const existingTagSet = new Set(existingTags.map((t: { tag: string }) => t.tag));
    const newTags = tags.filter((tag) => !existingTagSet.has(tag));

    if (newTags.length > 0) {
      await db.insert(todoTagsTable).values(
        newTags.map((tag) => ({
          todoId,
          tag,
        }))
      );
    }

    return true;
  }

  /**
   * Remove tags from a todo
   */
  async removeTags(todoId: UUID, tags: string[]): Promise<boolean> {
    if (!this.runtime.db) {
      logger.warn('Database not available in runtime, cannot remove tags');
      return false;
    }

    const { db } = this.runtime;

    await db
      .delete(todoTagsTable)
      .where(
        and(eq(todoTagsTable.todoId, todoId), or(...tags.map((tag) => eq(todoTagsTable.tag, tag))))
      );

    return true;
  }

  /**
   * Get overdue tasks
   */
  async getOverdueTodos(filters?: {
    agentId?: UUID;
    worldId?: UUID;
    roomId?: UUID;
    entityId?: UUID;
  }): Promise<TodoData[]> {
    if (!this.runtime.db) {
      logger.warn('Database not available in runtime, returning empty array');
      return [];
    }

    const { db } = this.runtime;

    const conditions: Array<ReturnType<typeof eq>> = [
      eq(todosTable.isCompleted, false),
      isNull(todosTable.completedAt),
    ];

    if (filters?.agentId) {
      conditions.push(eq(todosTable.agentId, filters.agentId));
    }
    if (filters?.worldId) {
      conditions.push(eq(todosTable.worldId, filters.worldId));
    }
    if (filters?.roomId) {
      conditions.push(eq(todosTable.roomId, filters.roomId));
    }
    if (filters?.entityId) {
      conditions.push(eq(todosTable.entityId, filters.entityId));
    }

    const todos = await db
      .select()
      .from(todosTable)
      .where(and(...conditions))
      .orderBy(todosTable.dueDate);

    // Filter overdue tasks in memory since SQL date comparison is complex
    const now = new Date();
    const overdueTodos = todos.filter(
      (todo: (typeof todos)[0]) => todo.dueDate && todo.dueDate < now
    );

    // Fetch tags
    const todosWithTags = await Promise.all(
      overdueTodos.map(async (todo: (typeof todos)[0]) => {
        const tags = await db
          .select({ tag: todoTagsTable.tag })
          .from(todoTagsTable)
          .where(eq(todoTagsTable.todoId, todo.id));

        return {
          ...todo,
          tags: tags.map((t: { tag: string }) => t.tag),
        } as TodoData;
      })
    );

    return todosWithTags;
  }

  /**
   * Reset daily todos for a new day
   */
  async resetDailyTodos(filters?: {
    agentId?: UUID;
    worldId?: UUID;
    roomId?: UUID;
    entityId?: UUID;
  }): Promise<number> {
    if (!this.runtime.db) {
      logger.warn('Database not available in runtime, cannot reset daily todos');
      return 0;
    }

    const { db } = this.runtime;

    const conditions: Array<ReturnType<typeof eq>> = [
      eq(todosTable.type, 'daily'),
      eq(todosTable.isCompleted, true),
    ];

    if (filters?.agentId) {
      conditions.push(eq(todosTable.agentId, filters.agentId));
    }
    if (filters?.worldId) {
      conditions.push(eq(todosTable.worldId, filters.worldId));
    }
    if (filters?.roomId) {
      conditions.push(eq(todosTable.roomId, filters.roomId));
    }
    if (filters?.entityId) {
      conditions.push(eq(todosTable.entityId, filters.entityId));
    }

    // Reset daily todos
    const result = await db
      .update(todosTable)
      .set({
        isCompleted: false,
        completedAt: null,
        metadata: {
          completedToday: false,
        },
        updatedAt: new Date(),
      })
      .where(and(...conditions));

    // Return the actual count of reset todos
    const resetCount = result?.rowCount || result?.changes || 0;
    logger.info(`Reset ${resetCount} daily todos`);
    return resetCount;
  }
}

/**
 * Create a new TodoService instance
 */
export function createTodoDataService(runtime: IAgentRuntime): TodoDataManager {
  return new TodoDataManager(runtime);
}

/**
 * Service wrapper for database operations
 */
export class TodoService extends Service {
  static readonly serviceType: ServiceTypeName = 'TODO' as ServiceTypeName;
  static readonly serviceName = 'Todo';

  private dataManager: TodoDataManager | null = null;

  capabilityDescription = 'Manages todo data storage and retrieval';

  async stop(): Promise<void> {
    this.dataManager = null;
  }

  static async start(runtime: IAgentRuntime): Promise<TodoService> {
    const service = new TodoService();

    if (!runtime.db) {
      logger.warn('Database not available, TodoService will be limited');
    } else {
      service.dataManager = new TodoDataManager(runtime);
    }

    return service;
  }

  /**
   * Get the underlying TodoService instance
   */
  getDataService(): TodoDataManager | null {
    return this.dataManager;
  }

  /**
   * Create a new todo (delegated to service)
   */
  async createTodo(params: {
    agentId: UUID;
    worldId: UUID;
    roomId: UUID;
    entityId: UUID;
    name: string;
    description?: string;
    type: 'daily' | 'one-off' | 'aspirational';
    priority?: number;
    isUrgent?: boolean;
    dueDate?: Date;
    metadata?: TodoMetadata;
    tags?: string[];
  }): Promise<UUID | null> {
    if (!this.dataManager) {
      throw new Error('TodoService not available');
    }
    return this.dataManager.createTodo(params);
  }

  /**
   * Get todos with optional filters (delegated to service)
   */
  async getTodos(filters?: {
    agentId?: UUID;
    worldId?: UUID;
    roomId?: UUID;
    entityId?: UUID;
    type?: 'daily' | 'one-off' | 'aspirational';
    isCompleted?: boolean;
    isUrgent?: boolean;
    tags?: string[];
    limit?: number;
  }): Promise<TodoData[]> {
    if (!this.dataManager) {
      return [];
    }
    return this.dataManager.getTodos(filters);
  }

  /**
   * Update a todo (delegated to service)
   */
  async updateTodo(
    todoId: UUID,
    updates: {
      name?: string;
      description?: string;
      type?: 'daily' | 'one-off' | 'aspirational';
      priority?: number;
      isUrgent?: boolean;
      isCompleted?: boolean;
      dueDate?: Date;
      completedAt?: Date;
      metadata?: TodoMetadata;
      tags?: string[];
    }
  ): Promise<boolean> {
    if (!this.dataManager) {
      throw new Error('TodoService not available');
    }
    return this.dataManager.updateTodo(todoId, updates);
  }

  /**
   * Delete a todo (delegated to service)
   */
  async deleteTodo(todoId: UUID): Promise<boolean> {
    if (!this.dataManager) {
      throw new Error('TodoService not available');
    }
    return this.dataManager.deleteTodo(todoId);
  }

  /**
   * Get a single todo by ID (delegated to service)
   */
  async getTodo(todoId: UUID): Promise<TodoData | null> {
    if (!this.dataManager) {
      return null;
    }
    return this.dataManager.getTodo(todoId);
  }

  /**
   * Add tags to a todo (delegated to service)
   */
  async addTags(todoId: UUID, tags: string[]): Promise<boolean> {
    if (!this.dataManager) {
      throw new Error('TodoService not available');
    }
    return this.dataManager.addTags(todoId, tags);
  }

  /**
   * Remove tags from a todo (delegated to service)
   */
  async removeTags(todoId: UUID, tags: string[]): Promise<boolean> {
    if (!this.dataManager) {
      throw new Error('TodoService not available');
    }
    return this.dataManager.removeTags(todoId, tags);
  }

  /**
   * Get overdue todos (delegated to service)
   */
  async getOverdueTodos(filters?: {
    agentId?: UUID;
    worldId?: UUID;
    roomId?: UUID;
    entityId?: UUID;
  }): Promise<TodoData[]> {
    if (!this.dataManager) {
      return [];
    }
    return this.dataManager.getOverdueTodos(filters);
  }

  /**
   * Reset daily todos (delegated to service)
   */
  async resetDailyTodos(filters?: {
    agentId?: UUID;
    worldId?: UUID;
    roomId?: UUID;
    entityId?: UUID;
  }): Promise<number> {
    if (!this.dataManager) {
      return 0;
    }
    return this.dataManager.resetDailyTodos(filters);
  }
}
