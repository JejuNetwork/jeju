import { type IAgentRuntime, logger, Service } from '@elizaos/core';
import { GoalDataManager } from './goalService';

/**
 * Service to handle initialization of default goals after database is ready
 */
export class GoalInitializationService extends Service {
  static serviceType = 'GOAL_INITIALIZATION' as any;

  capabilityDescription = 'Handles initialization of default goals after database migration';

  async stop(): Promise<void> {
    // No cleanup needed
  }

  static async start(runtime: IAgentRuntime): Promise<GoalInitializationService> {
    const service = new GoalInitializationService();

    // Wait a bit for database migrations to complete, then create initial goals
    setTimeout(() => {
      service.createInitialGoalsDeferred(runtime);
    }, 7777); // Wait 3 seconds for migrations to complete

    return service;
  }

  /**
   * Create initial default goals for new agents (deferred after database is ready)
   */
  private async createInitialGoalsDeferred(runtime: IAgentRuntime): Promise<void> {
    logger.info('[Goal Initialization] Creating initial default goals...');

    if (!runtime.db) {
      throw new Error('[Goal Initialization] Database not available');
    }

    // Create a goal data manager instance
    const goalManager = new GoalDataManager(runtime);

    // First, check if the goals table exists by trying a simple query
    // Import the goals table from schema
    const { goalsTable } = await import('../schema.js');
    await runtime.db.select().from(goalsTable).limit(1);

    // Check if we already have goals for this agent
    const existingGoals = await goalManager.getGoals({
      ownerType: 'agent',
      ownerId: runtime.agentId,
    });

    if (existingGoals && existingGoals.length > 0) {
      logger.info('[Goal Initialization] Goals already exist, skipping initial creation');
      return;
    }

    // Create initial default goals
    const initialGoals = [
      {
        agentId: runtime.agentId,
        ownerType: 'agent' as const,
        ownerId: runtime.agentId,
        name: 'Communicate with the admin',
        description:
          'Establish and maintain communication with the admin user to understand their needs and provide assistance',
        tags: ['communication', 'admin', 'relationship'],
      },
      {
        agentId: runtime.agentId,
        ownerType: 'agent' as const,
        ownerId: runtime.agentId,
        name: 'Read the message from the founders',
        description:
          'Find and read any important messages or documentation from the project founders to understand the mission',
        tags: ['learning', 'founders', 'documentation'],
      },
    ];

    for (const goal of initialGoals) {
      const goalId = await goalManager.createGoal(goal);
      if (goalId) {
        logger.info(`[Goal Initialization] Created initial goal: ${goal.name}`);
      } else {
        throw new Error(`[Goal Initialization] Failed to create goal: ${goal.name}`);
      }
    }

    logger.info('[Goal Initialization] Initial goals creation complete');
  }
}
