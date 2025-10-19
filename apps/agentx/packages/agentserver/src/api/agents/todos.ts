import type { IAgentRuntime, UUID } from '@elizaos/core';
import { logger, validateUuid } from '@elizaos/core';
import express from 'express';
import type { AgentServer } from '../../server';
import { sendError, sendSuccess } from '../shared/response-utils';

interface Todo {
  id: string;
  task: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  dueDate?: string;
  createdAt: string;
  completedAt?: string;
}

/**
 * Agent todos management operations
 */
export function createAgentTodosRouter(
  agents: Map<UUID, IAgentRuntime>,
  _serverInstance: AgentServer
): express.Router {
  const router = express.Router();

  // Get all todos for an agent
  router.get('/:agentId/todos', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
    }

    const runtime = agents.get(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found or not running');
    }

    try {
      // Get the Todo service (uppercase 'TODO')
      const todoService = runtime.getService('TODO');
      if (!todoService) {
        logger.warn('[TODOS GET] Todo service not available');
        return sendSuccess(res, { todos: [] });
      }

      // Get all todos for this agent
      const todosData = await (todoService as any).getTodos({ agentId });

      // Transform to the expected format
      const todos: Todo[] = todosData.map((todo: any) => ({
        id: todo.id,
        task: todo.name,
        completed: todo.isCompleted || false,
        priority: todo.priority === 1 ? 'high' : todo.priority === 2 ? 'medium' : 'low',
        dueDate: todo.dueDate ? new Date(todo.dueDate).toISOString() : undefined,
        createdAt: todo.createdAt || new Date().toISOString(),
        completedAt: todo.completedAt ? new Date(todo.completedAt).toISOString() : undefined,
      }));

      sendSuccess(res, { todos });
    } catch (error) {
      logger.error('[TODOS GET] Error getting todos:', error);
      sendError(
        res,
        500,
        'TODOS_ERROR',
        'Error retrieving todos',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Create a new todo
  router.post('/:agentId/todos', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
    }

    const runtime = agents.get(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found or not running');
    }

    const { task, priority, dueDate } = req.body;

    if (!task) {
      return sendError(res, 400, 'MISSING_FIELDS', 'Task is required');
    }

    try {
      // Get the Todo service
      const todoService = runtime.getService('TODO');
      if (!todoService) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Todo service not available');
      }

      // Map priority string to number
      const priorityMap: Record<string, number> = { high: 1, medium: 2, low: 3 };
      const priorityNum = priorityMap[priority as string] || 2;

      // Create the todo using the service
      const todoId = await (todoService as any).createTodo({
        agentId,
        worldId: agentId, // Using agentId as worldId fallback
        roomId: agentId, // Using agentId as roomId fallback
        entityId: agentId,
        name: task,
        description: req.body.description || '',
        type: 'one-off' as const,
        priority: priorityNum,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        metadata: req.body.metadata || {},
        tags: req.body.tags || [],
      });

      if (!todoId) {
        return sendError(res, 500, 'TODO_CREATE_FAILED', 'Failed to create todo');
      }

      const todo: Todo = {
        id: todoId,
        task,
        completed: false,
        priority: priority || 'medium',
        dueDate,
        createdAt: new Date().toISOString(),
      };

      logger.info(`[TODOS CREATE] Created todo "${task}" for agent ${runtime.character.name}`);
      sendSuccess(res, { todo }, 201);
    } catch (error) {
      logger.error('[TODOS CREATE] Error creating todo:', error);
      sendError(
        res,
        500,
        'TODO_CREATE_ERROR',
        'Error creating todo',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Update a todo
  router.put('/:agentId/todos/:todoId', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
    }

    const runtime = agents.get(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found or not running');
    }

    const { todoId } = req.params;
    const updates = req.body;

    try {
      // Get the Todo service
      const todoService = runtime.getService('TODO');
      if (!todoService) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Todo service not available');
      }

      // Map priority string to number if provided
      let priorityNum = undefined;
      if (updates.priority) {
        const priorityMap: Record<string, number> = { high: 1, medium: 2, low: 3 };
        priorityNum = priorityMap[updates.priority as string];
      }

      // Update the todo using the service
      const success = await (todoService as any).updateTodo(todoId, {
        name: updates.task,
        description: updates.description,
        priority: priorityNum,
        dueDate: updates.dueDate ? new Date(updates.dueDate) : undefined,
        metadata: updates.metadata,
        tags: updates.tags,
      });

      if (!success) {
        return sendError(res, 500, 'TODO_UPDATE_FAILED', 'Failed to update todo');
      }

      // Handle completion status
      if (updates.completed === true) {
        await (todoService as any).completeTodo(todoId);
      }

      // Fetch the updated todo to return full details
      const todosData = await (todoService as any).getTodos({ agentId });
      const updatedTodoData = todosData.find((t: any) => t.id === todoId);

      if (!updatedTodoData) {
        return sendError(res, 404, 'TODO_NOT_FOUND', 'Todo not found');
      }

      const todo: Todo = {
        id: updatedTodoData.id,
        task: updatedTodoData.name,
        completed: updatedTodoData.isCompleted || false,
        priority:
          updatedTodoData.priority === 1
            ? 'high'
            : updatedTodoData.priority === 2
              ? 'medium'
              : 'low',
        dueDate: updatedTodoData.dueDate
          ? new Date(updatedTodoData.dueDate).toISOString()
          : undefined,
        createdAt: updatedTodoData.createdAt || new Date().toISOString(),
        completedAt: updatedTodoData.completedAt
          ? new Date(updatedTodoData.completedAt).toISOString()
          : undefined,
      };

      logger.info(`[TODOS UPDATE] Updated todo ${todoId} for agent ${runtime.character.name}`);
      sendSuccess(res, { todo });
    } catch (error) {
      logger.error('[TODOS UPDATE] Error updating todo:', error);
      sendError(
        res,
        500,
        'TODO_UPDATE_ERROR',
        'Error updating todo',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Delete a todo
  router.delete('/:agentId/todos/:todoId', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
    }

    const runtime = agents.get(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found or not running');
    }

    const { todoId } = req.params;

    try {
      // Get the Todo service
      const todoService = runtime.getService('TODO');
      if (!todoService) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Todo service not available');
      }

      // Cancel the todo using the service
      const success = await (todoService as any).cancelTodo(todoId);

      if (!success) {
        return sendError(res, 500, 'TODO_DELETE_FAILED', 'Failed to delete todo');
      }

      logger.info(`[TODOS DELETE] Deleted todo ${todoId} for agent ${runtime.character.name}`);
      sendSuccess(res, { message: 'Todo deleted successfully', todoId });
    } catch (error) {
      logger.error('[TODOS DELETE] Error deleting todo:', error);
      sendError(
        res,
        500,
        'TODO_DELETE_ERROR',
        'Error deleting todo',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  return router;
}
