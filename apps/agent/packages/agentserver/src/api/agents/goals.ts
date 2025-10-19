import type { IAgentRuntime, UUID } from '@elizaos/core';
import { validateUuid, logger } from '@elizaos/core';
import express from 'express';
import type { AgentServer } from '../../server';
import { sendError, sendSuccess } from '../shared/response-utils';

interface Goal {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'completed' | 'paused';
  progress: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

/**
 * Agent goals management operations
 */
export function createAgentGoalsRouter(
  agents: Map<UUID, IAgentRuntime>,
  _serverInstance: AgentServer
): express.Router {
  const router = express.Router();

  // Get all goals for an agent
  router.get('/:agentId/goals', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
    }

    const runtime = agents.get(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found or not running');
    }

    try {
      // Get the Goals service (lowercase 'goals')
      const goalsService = runtime.getService('goals');
      if (!goalsService) {
        logger.warn('[GOALS GET] Goals service not available');
        return sendSuccess(res, { goals: [] });
      }

      // Get all goals for this agent
      const goalsData = await (goalsService as any).getAllGoalsForOwner('agent', agentId);

      // Transform to the expected format
      const goals: Goal[] = goalsData.map((goal: any) => ({
        id: goal.id,
        name: goal.name,
        description: goal.description || '',
        status: goal.isCompleted ? 'completed' : 'active',
        progress: goal.progress || 0,
        createdAt: goal.createdAt || new Date().toISOString(),
        updatedAt: goal.updatedAt || goal.createdAt || new Date().toISOString(),
        metadata: goal.metadata || {},
      }));

      sendSuccess(res, { goals });
    } catch (error) {
      logger.error('[GOALS GET] Error getting goals:', error);
      sendError(
        res,
        500,
        'GOALS_ERROR',
        'Error retrieving goals',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Create a new goal
  router.post('/:agentId/goals', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
    }

    const runtime = agents.get(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found or not running');
    }

    const { name, description, metadata, tags } = req.body;

    if (!name) {
      return sendError(res, 400, 'MISSING_FIELDS', 'Name is required');
    }

    try {
      // Get the Goals service
      const goalsService = runtime.getService('goals');
      if (!goalsService) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Goals service not available');
      }

      // Create the goal using the service
      const goalId = await (goalsService as any).createGoal({
        agentId,
        ownerType: 'agent',
        ownerId: agentId,
        name,
        description: description || '',
        metadata: metadata || {},
        tags: tags || [],
      });

      if (!goalId) {
        return sendError(res, 500, 'GOAL_CREATE_FAILED', 'Failed to create goal');
      }

      // Fetch the created goal to return full details
      const createdGoal = await (goalsService as any).getGoalById(goalId);

      const goal: Goal = {
        id: createdGoal.id,
        name: createdGoal.name,
        description: createdGoal.description || '',
        status: createdGoal.isCompleted ? 'completed' : 'active',
        progress: createdGoal.progress || 0,
        createdAt: createdGoal.createdAt || new Date().toISOString(),
        updatedAt: createdGoal.updatedAt || createdGoal.createdAt || new Date().toISOString(),
        metadata: createdGoal.metadata || {},
      };

      logger.info(`[GOALS CREATE] Created goal "${name}" for agent ${runtime.character.name}`);
      sendSuccess(res, { goal }, 201);
    } catch (error) {
      logger.error('[GOALS CREATE] Error creating goal:', error);
      sendError(
        res,
        500,
        'GOAL_CREATE_ERROR',
        'Error creating goal',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Update a goal
  router.put('/:agentId/goals/:goalId', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
    }

    const runtime = agents.get(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found or not running');
    }

    const { goalId } = req.params;
    const { name, description, progress, status, metadata, tags } = req.body;

    try {
      // Get the Goals service
      const goalsService = runtime.getService('goals');
      if (!goalsService) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Goals service not available');
      }

      // Get the existing goal first
      const existingGoal = await (goalsService as any).getGoalById(goalId);
      if (!existingGoal) {
        return sendError(res, 404, 'GOAL_NOT_FOUND', 'Goal not found');
      }

      // Update the goal using the service
      const success = await (goalsService as any).updateGoal(goalId, {
        name: name !== undefined ? name : undefined,
        description: description !== undefined ? description : undefined,
        progress: progress !== undefined ? progress : undefined,
        metadata: metadata !== undefined ? metadata : undefined,
        tags: tags !== undefined ? tags : undefined,
      });

      if (!success) {
        return sendError(res, 500, 'GOAL_UPDATE_FAILED', 'Failed to update goal');
      }

      // Handle status changes (completed/active)
      if (status === 'completed' && !existingGoal.isCompleted) {
        await (goalsService as any).completeGoal(goalId);
      } else if (status === 'active' && existingGoal.isCompleted) {
        // Reactivate goal by updating isCompleted to false
        await (goalsService as any).updateGoal(goalId, { isCompleted: false });
      }

      // Fetch the updated goal to return full details
      const updatedGoalData = await (goalsService as any).getGoalById(goalId);

      const goal: Goal = {
        id: updatedGoalData.id,
        name: updatedGoalData.name,
        description: updatedGoalData.description || '',
        status: updatedGoalData.isCompleted ? 'completed' : 'active',
        progress: updatedGoalData.progress || 0,
        createdAt: updatedGoalData.createdAt || new Date().toISOString(),
        updatedAt: updatedGoalData.updatedAt || new Date().toISOString(),
        metadata: updatedGoalData.metadata || {},
      };

      logger.info(`[GOALS UPDATE] Updated goal ${goalId} for agent ${runtime.character.name}`);
      sendSuccess(res, { goal });
    } catch (error) {
      logger.error('[GOALS UPDATE] Error updating goal:', error);
      sendError(
        res,
        500,
        'GOAL_UPDATE_ERROR',
        'Error updating goal',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Delete a goal
  router.delete('/:agentId/goals/:goalId', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
    }

    const runtime = agents.get(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found or not running');
    }

    const { goalId } = req.params;

    try {
      // Get the Goals service
      const goalsService = runtime.getService('goals');
      if (!goalsService) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Goals service not available');
      }

      // Check if goal exists
      const existingGoal = await (goalsService as any).getGoalById(goalId);
      if (!existingGoal) {
        return sendError(res, 404, 'GOAL_NOT_FOUND', 'Goal not found');
      }

      // Delete the goal using the service (cancel it)
      const success = await (goalsService as any).cancelGoal(goalId);

      if (!success) {
        return sendError(res, 500, 'GOAL_DELETE_FAILED', 'Failed to delete goal');
      }

      logger.info(`[GOALS DELETE] Deleted goal ${goalId} for agent ${runtime.character.name}`);
      sendSuccess(res, { message: 'Goal deleted successfully', goalId });
    } catch (error) {
      logger.error('[GOALS DELETE] Error deleting goal:', error);
      sendError(
        res,
        500,
        'GOAL_DELETE_ERROR',
        'Error deleting goal',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  return router;
}
