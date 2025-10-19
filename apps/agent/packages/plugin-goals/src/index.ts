import type { Plugin } from '@elizaos/core';
import { type IAgentRuntime, logger } from '@elizaos/core';

import routes from './apis';

// Import actions
import { cancelGoalAction } from './actions/cancelGoal';
import { completeGoalAction } from './actions/completeGoal';
import { confirmGoalAction } from './actions/confirmGoal';
import { createGoalAction } from './actions/createGoal';
import { updateGoalAction } from './actions/updateGoal';

// Import providers
import { goalsProvider } from './providers/goals';

// Import services
import { GoalService, GoalDataManager } from './services/goalService';

// Import schema
import { goalSchemaExport } from './schema';

// Note: Table schemas are defined in schema.ts and will be automatically migrated

// Import tests
import { testSuites as e2eTestSuites } from './__tests__/e2e';

/**
 * The GoalsPlugin provides goal management functionality,
 * including creating, completing, updating, and canceling goals.
 */
export const GoalsPlugin: Plugin = {
  name: 'goals',
  description: 'Provides goal management functionality for tracking and achieving objectives.',
  providers: [goalsProvider],
  dependencies: ['@elizaos/plugin-sql'],
  testDependencies: ['@elizaos/plugin-sql'],
  actions: [
    createGoalAction,
    completeGoalAction,
    confirmGoalAction,
    updateGoalAction,
    cancelGoalAction,
  ],
  schema: goalSchemaExport,
  services: [GoalService],
  routes,
  tests: e2eTestSuites,

  async init(config: Record<string, string>, runtime: IAgentRuntime): Promise<void> {
    
      logger.info('[Goals Plugin] Initializing...');

      // Log current services to see what's registered
      const services = (runtime as any).services || new Map();
      logger.info('[Goals Plugin] Services at init start:', Array.from(services.keys()));

      // Goals tables will be created through the standard schema system
      // The tables are defined in schema.ts and will be migrated automatically
      // when the plugin schema is processed by the SQL plugin

      // Database migrations are handled by the SQL plugin
      if (runtime.db) {
        logger.info('[Goals Plugin] Database available, GoalsPlugin ready for operation');

        // Note: Initial goals creation will be deferred until after migrations
        // This is handled by a separate initialization service
      } else {
        logger.warn('[Goals Plugin] No database instance available, operations will be limited');
      }

      logger.info('[Goals Plugin] GoalsPlugin initialized successfully');

      // Log services again to see if anything changed
      logger.info('[Goals Plugin] Services at init end:', Array.from(services.keys()));
    
  },
};

export default GoalsPlugin;

// Export service types for use in other plugins/tests
export { GoalService } from './services/goalService';
export { type GoalData } from './types';

// Helper function to get the Goals service (handles case sensitivity)
export function getGoalsService(runtime: IAgentRuntime): GoalService | null {
  return (runtime.getService('goals') || runtime.getService('goals')) as GoalService;
}
