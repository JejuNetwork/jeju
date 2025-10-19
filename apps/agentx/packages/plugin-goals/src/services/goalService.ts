import { asUUID, logger, Service, type IAgentRuntime, type UUID } from '@elizaos/core';
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { goalsTable, goalTagsTable } from '../schema';
import { GoalServiceType, type GoalData } from '../types';

/**
 * Service for managing goal data
 */
export class GoalDataManager {
  private runtime: IAgentRuntime;

  constructor(runtime: IAgentRuntime) {
    this.runtime = runtime;
  }

  /**
   * Create a new goal
   */
  async createGoal(params: {
    agentId: UUID;
    ownerType: 'agent' | 'entity';
    ownerId: UUID;
    name: string;
    description?: string;
    metadata?: Record<string, any>;
    tags?: string[];
  }): Promise<UUID | null> {
    const db = this.runtime.db;
    if (!db) {
      throw new Error('Database not available');
    }

    // Create the goal
    const goalId = asUUID(uuidv4());
    const values: any = {
      id: goalId,
      agentId: params.agentId,
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      name: params.name,
      metadata: params.metadata || {},
    };

    // Only include description if it's provided
    if (params.description !== undefined) {
      values.description = params.description;
    }

    const [goal] = await db.insert(goalsTable).values(values).returning();

    if (!goal) {
      return null;
    }

    // Add tags if provided
    if (params.tags && params.tags.length > 0) {
      const tagInserts = params.tags.map((tag) => ({
        id: asUUID(uuidv4()),
        goalId: goal.id,
        tag,
      }));

      await db.insert(goalTagsTable).values(tagInserts);
    }

    return goal.id;
  }

  /**
   * Get goals with optional filters
   */
  async getGoals(filters?: {
    ownerType?: 'agent' | 'entity';
    ownerId?: UUID;
    isCompleted?: boolean;
    tags?: string[];
  }): Promise<GoalData[]> {
    const db = this.runtime.db;
    if (!db) {
      throw new Error('Database not available');
    }

    const conditions: SQL[] = [];
    if (filters?.ownerType) {
      conditions.push(eq(goalsTable.ownerType, filters.ownerType));
    }
    if (filters?.ownerId) {
      conditions.push(eq(goalsTable.ownerId, filters.ownerId));
    }
    if (filters?.isCompleted !== undefined) {
      conditions.push(eq(goalsTable.isCompleted, filters.isCompleted));
    }

    const goals = await db
      .select()
      .from(goalsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(goalsTable.createdAt));

    // Get tags for all goals
    const goalIds = goals.map((goal: any) => goal.id);
    if (goalIds.length === 0) {
      return [];
    }

    const tags = await db
      .select()
      .from(goalTagsTable)
      .where(
        goalIds.length === 1
          ? eq(goalTagsTable.goalId, goalIds[0])
          : inArray(goalTagsTable.goalId, goalIds)
      );

    // Group tags by goal
    const tagsByGoal = tags.reduce(
      (acc: any, tag: any) => {
        if (!acc[tag.goalId]) {
          acc[tag.goalId] = [];
        }
        acc[tag.goalId].push(tag.tag);
        return acc;
      },
      {} as Record<string, string[]>
    );

    // Filter by tags if specified
    let filteredGoals = goals;
    if (filters?.tags && filters.tags.length > 0) {
      filteredGoals = goals.filter((goal: any) => {
        const goalTags = tagsByGoal[goal.id] || [];
        return filters.tags!.some((tag) => goalTags.includes(tag));
      });
    }

    return filteredGoals.map((goal: any) => ({
      ...goal,
      tags: tagsByGoal[goal.id] || [],
      createdAt: new Date(goal.createdAt),
      updatedAt: new Date(goal.updatedAt),
      completedAt: goal.completedAt ? new Date(goal.completedAt) : null,
    }));
  }

  /**
   * Get a single goal by ID
   */
  async getGoal(goalId: UUID): Promise<GoalData | null> {
    const db = this.runtime.db;
    if (!db) {
      throw new Error('Database not available');
    }

    const [goal] = await db.select().from(goalsTable).where(eq(goalsTable.id, goalId));

    if (!goal) {
      return null;
    }

    // Get tags
    const tags = await db.select().from(goalTagsTable).where(eq(goalTagsTable.goalId, goalId));

    return {
      ...goal,
      tags: tags.map((t: any) => t.tag),
      createdAt: new Date(goal.createdAt),
      updatedAt: new Date(goal.updatedAt),
      completedAt: goal.completedAt ? new Date(goal.completedAt) : null,
    };
  }

  /**
   * Update a goal
   */
  async updateGoal(
    goalId: UUID,
    updates: {
      name?: string;
      description?: string;
      isCompleted?: boolean;
      completedAt?: Date;
      metadata?: Record<string, any>;
      tags?: string[];
    }
  ): Promise<boolean> {
    const db = this.runtime.db;
    if (!db) {
      throw new Error('Database not available');
    }

    // Update goal fields
    const fieldsToUpdate: any = {
      updatedAt: new Date(),
    };

    if (updates.name !== undefined) {
      fieldsToUpdate.name = updates.name;
    }
    if (updates.description !== undefined) {
      fieldsToUpdate.description = updates.description;
    }
    if (updates.isCompleted !== undefined) {
      fieldsToUpdate.isCompleted = updates.isCompleted;
    }
    if (updates.completedAt !== undefined) {
      fieldsToUpdate.completedAt = updates.completedAt;
    }
    if (updates.metadata !== undefined) {
      fieldsToUpdate.metadata = updates.metadata;
    }

    await db.update(goalsTable).set(fieldsToUpdate).where(eq(goalsTable.id, goalId));

    // Update tags if provided
    if (updates.tags !== undefined) {
      // Delete existing tags
      await db.delete(goalTagsTable).where(eq(goalTagsTable.goalId, goalId));

      // Insert new tags
      if (updates.tags.length > 0) {
        const tagInserts = updates.tags.map((tag) => ({
          id: asUUID(uuidv4()),
          goalId,
          tag,
        }));

        await db.insert(goalTagsTable).values(tagInserts);
      }
    }

    return true;
  }

  /**
   * Delete a goal
   */
  async deleteGoal(goalId: UUID): Promise<boolean> {
    const db = this.runtime.db;
    if (!db) {
      throw new Error('Database not available');
    }

    await db.delete(goalsTable).where(eq(goalsTable.id, goalId));
    return true;
  }

  /**
   * Get uncompleted goals
   */
  async getUncompletedGoals(ownerType?: 'agent' | 'entity', ownerId?: UUID): Promise<GoalData[]> {
    const conditions = [eq(goalsTable.isCompleted, false)];

    if (ownerType) {
      conditions.push(eq(goalsTable.ownerType, ownerType));
    }
    if (ownerId) {
      conditions.push(eq(goalsTable.ownerId, ownerId));
    }

    return this.getGoals({
      isCompleted: false,
      ownerType,
      ownerId,
    });
  }

  /**
   * Get completed goals
   */
  async getCompletedGoals(ownerType?: 'agent' | 'entity', ownerId?: UUID): Promise<GoalData[]> {
    return this.getGoals({
      isCompleted: true,
      ownerType,
      ownerId,
    });
  }

  /**
   * Count goals with filters
   */
  async countGoals(
    ownerType: 'agent' | 'entity',
    ownerId: UUID,
    isCompleted?: boolean
  ): Promise<number> {
    const goals = await this.getGoals({
      ownerType,
      ownerId,
      isCompleted,
    });
    return goals.length;
  }

  /**
   * Get all goals for a specific owner (both completed and uncompleted)
   */
  async getAllGoalsForOwner(ownerType: 'agent' | 'entity', ownerId: UUID): Promise<GoalData[]> {
    return this.getGoals({
      ownerType,
      ownerId,
    });
  }
}

/**
 * Creates a GoalDataManager instance
 * @deprecated Use runtime.getService('goals') instead in production code.
 * This function is kept for test mocking purposes only.
 * @param runtime - The agent runtime
 * @returns A new GoalDataManager instance
 */
export function createGoalDataService(runtime: IAgentRuntime): GoalDataManager {
  return new GoalDataManager(runtime);
}

/**
 * Service wrapper for the GoalService to be registered with the plugin
 */
export class GoalService extends Service {
  static serviceType = GoalServiceType.GOALS;
  // serviceName will be automatically derived as "Goal" from class name

  private goalDataManager: GoalDataManager | null = null;

  capabilityDescription = 'Manages goal data storage and retrieval';

  async stop(): Promise<void> {
    // Cleanup if needed
    this.goalDataManager = null;
  }

  static async start(runtime: IAgentRuntime): Promise<GoalService> {
    logger.info('[GoalService] Starting service...');
    logger.info('[GoalService] Runtime ID:', runtime.agentId);

    const service = new GoalService();
    // Initialize the goal data manager
    service.goalDataManager = new GoalDataManager(runtime);

    // Log current services to debug registration
    const services = (runtime as any).services || new Map();
    logger.info('[GoalService] Services before registration:', Array.from(services.keys()));

    logger.info('[GoalService] Service started successfully');

    return service;
  }

  /**
   * Get the underlying GoalDataManager instance
   * @deprecated Use the service methods directly instead
   */
  getDataManager(): GoalDataManager | null {
    return this.goalDataManager;
  }

  // Proxy all GoalDataManager methods for easy access

  async createGoal(params: {
    agentId: UUID;
    ownerType: 'agent' | 'entity';
    ownerId: UUID;
    name: string;
    description?: string;
    metadata?: Record<string, any>;
    tags?: string[];
  }): Promise<UUID | null> {
    if (!this.goalDataManager) {
      throw new Error('GoalService not initialized');
    }
    return this.goalDataManager.createGoal(params);
  }

  async getGoals(filters?: {
    ownerType?: 'agent' | 'entity';
    ownerId?: UUID;
    isCompleted?: boolean;
    tags?: string[];
  }): Promise<GoalData[]> {
    if (!this.goalDataManager) {
      throw new Error('GoalService not initialized');
    }
    return this.goalDataManager.getGoals(filters);
  }

  async getGoal(goalId: UUID): Promise<GoalData | null> {
    if (!this.goalDataManager) {
      throw new Error('GoalService not initialized');
    }
    return this.goalDataManager.getGoal(goalId);
  }

  async updateGoal(
    goalId: UUID,
    updates: {
      name?: string;
      description?: string;
      isCompleted?: boolean;
      completedAt?: Date;
      metadata?: Record<string, any>;
      tags?: string[];
    }
  ): Promise<boolean> {
    if (!this.goalDataManager) {
      throw new Error('GoalService not initialized');
    }
    return this.goalDataManager.updateGoal(goalId, updates);
  }

  async deleteGoal(goalId: UUID): Promise<boolean> {
    if (!this.goalDataManager) {
      throw new Error('GoalService not initialized');
    }
    return this.goalDataManager.deleteGoal(goalId);
  }

  async getUncompletedGoals(ownerType?: 'agent' | 'entity', ownerId?: UUID): Promise<GoalData[]> {
    if (!this.goalDataManager) {
      throw new Error('GoalService not initialized');
    }
    return this.goalDataManager.getUncompletedGoals(ownerType, ownerId);
  }

  async getCompletedGoals(ownerType?: 'agent' | 'entity', ownerId?: UUID): Promise<GoalData[]> {
    if (!this.goalDataManager) {
      throw new Error('GoalService not initialized');
    }
    return this.goalDataManager.getCompletedGoals(ownerType, ownerId);
  }

  async countGoals(
    ownerType: 'agent' | 'entity',
    ownerId: UUID,
    isCompleted?: boolean
  ): Promise<number> {
    if (!this.goalDataManager) {
      throw new Error('GoalService not initialized');
    }
    return this.goalDataManager.countGoals(ownerType, ownerId, isCompleted);
  }

  async getAllGoalsForOwner(ownerType: 'agent' | 'entity', ownerId: UUID): Promise<GoalData[]> {
    if (!this.goalDataManager) {
      throw new Error('GoalService not initialized');
    }
    return this.goalDataManager.getAllGoalsForOwner(ownerType, ownerId);
  }
}
