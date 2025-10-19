import {
  ChannelType,
  type IAgentRuntime,
  type Room,
  type Route,
  type UUID,
  type World,
  createUniqueUuid,
  logger,
} from '@elizaos/core';
import { sql } from 'drizzle-orm';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TodoService } from './services/todoService';
import type { TodoData } from './services/todoService';
import type { TodoMetadata } from './types';

// Define the equivalent of __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve the path to the frontend distribution directory, assuming it's in 'dist'
// relative to the package root (which is two levels up from src/plugin-todo)
const frontendDist = path.resolve(__dirname, '../dist');

const frontPagePath = path.resolve(frontendDist, 'index.html');
const assetsPath = path.resolve(frontendDist, 'assets');
console.log('*** frontPagePath', frontPagePath);
console.log('*** assetsPath', assetsPath);
/**
 * Definition of routes with type, path, and handler for each route.
 * Routes include fetching trending tokens, wallet information, tweets, sentiment analysis, and signals.
 */

export const routes: Route[] = [
  {
    type: 'GET',
    path: '/',
    handler: async (_req: unknown, res: TodoApiResponse, _runtime: IAgentRuntime) => {
      const indexPath = path.resolve(frontendDist, 'index.html');
      if (fs.existsSync(indexPath)) {
        const htmlContent = fs.readFileSync(indexPath, 'utf-8');
        // Set Content-Type header to text/html
        res.setHeader('Content-Type', 'text/html');
        res.send(htmlContent);
      } else {
        res.status(404).send('HTML file not found');
      }
    },
  },
  {
    type: 'GET',
    path: '/todos',
    handler: async (_req: unknown, res: TodoApiResponse, _runtime: IAgentRuntime) => {
      const todosHtmlPath = path.resolve(frontendDist, 'index.html');
      if (fs.existsSync(todosHtmlPath)) {
        const htmlContent = fs.readFileSync(todosHtmlPath, 'utf-8');
        // Set Content-Type header to text/html
        res.setHeader('Content-Type', 'text/html');
        res.send(htmlContent);
      } else {
        res.status(404).send('Todos HTML file not found');
      }
    },
  },
  // Route to serve JS files from frontendDist/assets
  {
    type: 'GET',
    path: '/assets/*',
    handler: async (
      req: { params?: Record<string, string> },
      res: TodoApiResponse,
      _runtime: IAgentRuntime
    ) => {
      // Extract the relative path after '/assets/'
      const assetRelativePath = req.params?.[0]; // This captures everything after '/assets/'
      if (!assetRelativePath) {
        return res.status(400).send('Invalid asset path');
      }
      // Construct the full path to the asset within the frontendDist/assets directory
      const filePath = path.resolve(assetsPath, assetRelativePath); // Corrected base path

      // Basic security check to prevent path traversal
      if (!filePath.startsWith(assetsPath)) {
        return res.status(403).send('Forbidden');
      }

      // Check if the file exists and serve it
      if (fs.existsSync(filePath)) {
        // Let express handle MIME types based on file extension
        res.sendFile(filePath);
      } else {
        res.status(404).send('Asset not found');
      }
    },
  },
  // API route to get all TODOs, structured by world and room
  {
    type: 'GET',
    path: '/api/todos',
    handler: async (_req: unknown, res: TodoApiResponse, runtime: IAgentRuntime) => {
      try {
        const dataService = runtime.getService('todo') as TodoService;
        if (!dataService) {
          logger.error('[API /api/todos] Todo service not available');
          return res.status(503).json({ error: 'Todo service not available' });
        }

        // 1. Get all room IDs the agent is a participant in
        const agentRoomIds = await runtime.getRoomsForParticipant(runtime.agentId);
        if (!agentRoomIds || agentRoomIds.length === 0) {
          logger.debug(
            `[API /api/todos] Agent ${runtime.agentId} is not a participant in any rooms.`
          );
          return res.json([]); // No rooms for this agent
        }
        logger.debug(
          `[API /api/todos] Agent ${runtime.agentId} is in rooms: ${agentRoomIds.join(', ')}`
        );

        // 2. Fetch details for these specific rooms
        const agentRooms: Room[] = [];
        // Fetch rooms in batches if needed, but likely fine for typical numbers
        for (const roomId of agentRoomIds) {
          const room = await runtime.getRoom(roomId);
          if (room) {
            agentRooms.push(room);
          } else {
            logger.warn(`[API /api/todos] Could not fetch details for room ID: ${roomId}`);
          }
        }
        if (agentRooms.length === 0) {
          logger.debug(
            "[API /api/todos] No valid room details found for agent's participated rooms."
          );
          return res.json([]);
        }

        // 3. Fetch all TODO tasks for these specific rooms using the data service
        const tasksByRoom = new Map<string, TodoData[]>();

        // Fetch tasks per room
        for (const roomId of agentRoomIds) {
          const todos = await dataService.getTodos({ roomId });
          tasksByRoom.set(roomId, todos || []);
        }

        // 4. Group rooms by World ID and fetch World details
        const roomsByWorld = new Map<string, Room[]>();
        const worldIds = new Set<UUID>();
        for (const room of agentRooms) {
          const worldId = room.worldId;
          if (worldId) {
            worldIds.add(worldId);
            if (!roomsByWorld.has(worldId)) {
              roomsByWorld.set(worldId, []);
            }
            roomsByWorld.get(worldId)?.push(room);
          } else {
            logger.warn(`[API /api/todos] Room ${room.id} is missing worldId.`);
            // Handle rooms without worldId (e.g., add to a default/unknown world)
            const unknownWorldId = 'unknown-world';
            if (!roomsByWorld.has(unknownWorldId)) {
              roomsByWorld.set(unknownWorldId, []);
            }
            roomsByWorld.get(unknownWorldId)?.push(room);
          }
        }

        const worldsMap = new Map<string, World>();
        for (const worldId of worldIds) {
          const world = await runtime.getWorld(worldId);
          if (world) {
            worldsMap.set(worldId, world);
          }
        }
        // Add placeholder for unknown world if needed
        if (roomsByWorld.has('unknown-world')) {
          worldsMap.set('unknown-world', {
            id: 'unknown-world' as UUID,
            name: 'Rooms without World',
          } as World);
        }

        // 5. Structure the final response
        const structuredResponse = Array.from(worldsMap.entries()).map(([worldId, world]) => {
          const rooms = roomsByWorld.get(worldId) || [];
          return {
            worldId: world.id,
            worldName: world.name || `World ${world.id.substring(0, 6)}`,
            rooms: rooms.map((room) => ({
              roomId: room.id,
              roomName: room.name || `Room ${room.id.substring(0, 6)}`,
              tasks: tasksByRoom.get(room.id) || [],
            })),
          };
        });

        res.json(structuredResponse);
      } catch (error) {
        console.error('Error fetching structured todos:', error);
        logger.error('[API /api/todos] Error fetching structured todos:', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        res.status(500).send('Error fetching todos');
      }
    },
  },
  // API route to get all tags
  {
    type: 'GET',
    path: '/api/tags',
    handler: async (_req: unknown, res: TodoApiResponse, runtime: IAgentRuntime) => {
      try {
        logger.debug('[API /api/tags] Fetching all distinct tags');

        // Use runtime.db which should be the Drizzle instance from the adapter
        if (!runtime.db || typeof runtime.db.execute !== 'function') {
          logger.error('[API /api/tags] runtime.db is not available or not a Drizzle instance.');
          return res.status(500).json({ error: 'Database not available' });
        }

        // Determine database type to handle PostgreSQL-specific features
        // Default to 'postgres' if not specified
        let dbType = 'postgres';
        try {
          // Check if runtime has a database type hint
          if ((runtime as IAgentRuntime & { databaseType?: string }).databaseType) {
            dbType =
              (runtime as IAgentRuntime & { databaseType?: string }).databaseType || 'postgres';
          } else {
            // Attempt to detect based on connection properties
            const conn = await runtime.getConnection();
            if (conn && typeof conn === 'object') {
              // Basic heuristic - PGLite or SQLite connections might have specific properties
              if ('constructor' in conn && conn.constructor.name.includes('PGlite')) {
                dbType = 'pglite';
              } else if ('constructor' in conn && conn.constructor.name.includes('SQLite')) {
                dbType = 'sqlite';
              }
            }
          }
        } catch (error) {
          logger.warn('Could not determine database type:', error);
        }

        interface TagRow {
          tag: string;
        }

        let result: TagRow[] | { rows: TagRow[] };

        if (dbType === 'postgres') {
          // PostgreSQL query using unnest
          const query = sql`SELECT DISTINCT unnest(tags) as tag FROM todo_tags WHERE tag IS NOT NULL;`;
          result = await runtime.db.execute(query);
        } else {
          // SQLite-compatible query
          const query = sql`
            SELECT DISTINCT tag 
            FROM todo_tags 
            WHERE tag IS NOT NULL
          `;
          result = await runtime.db.execute(query);
        }

        // Drizzle's execute might return results differently depending on the driver
        // Adapting for common patterns (e.g., pg driver returning 'rows')
        const tags = Array.isArray(result)
          ? result.map((row: TagRow) => row.tag)
          : 'rows' in result // Node-postgres likely returns object with 'rows'
            ? result.rows.map((row: TagRow) => row.tag)
            : [];

        logger.debug(`[API /api/tags] Found ${tags.length} distinct tags`);
        res.json(tags);
      } catch (error) {
        logger.error('[API /api/tags] Error fetching tags:', error);
        res.status(500).json({ error: 'Failed to fetch tags' });
      }
    },
  },
  // API route to create a new TODO
  {
    type: 'POST',
    path: '/api/todos',
    handler: async (req: TodoApiRequest, res: TodoApiResponse, runtime: IAgentRuntime) => {
      try {
        const { name, type, priority, dueDate, isUrgent, roomId } = req.body; // Assume roomId is passed in body

        if (!name || !type || !roomId) {
          return res.status(400).send('Missing required fields: name, type, roomId');
        }

        const dataService = runtime.getService('todo') as TodoService;
        if (!dataService) {
          logger.error('[API /api/todos] Todo service not available');
          return res.status(503).json({ error: 'Todo service not available' });
        }

        const tags = ['TODO'];
        const metadata: TodoMetadata = {};

        // --- Determine Task Type and Tags ---
        if (type === 'daily') {
          tags.push('daily', 'recurring-daily');
          metadata.completedToday = false;
        } else if (type === 'one-off') {
          tags.push('one-off');
          if (dueDate) {
            // Validate date format if necessary
            try {
              new Date(dueDate);
            } catch (_e) {
              return res.status(400).send('Invalid due date format');
            }
          }
          if (priority && priority >= 1 && priority <= 4) {
            tags.push(`priority-${priority}`);
          } else {
            tags.push('priority-4'); // Default priority
          }
          if (isUrgent) {
            tags.push('urgent');
          }
        } else if (type === 'aspirational') {
          tags.push('aspirational');
          // No specific metadata needed initially
        } else {
          return res.status(400).send('Invalid task type');
        }

        const worldId = createUniqueUuid(runtime, runtime.agentId);

        await runtime.ensureConnection({
          entityId: runtime.agentId,
          roomId,
          worldId,
          type: ChannelType.GROUP,
          name: name.trim(),
          source: 'the-system',
          worldName: 'The System',
        });

        const newTodoId = await dataService.createTodo({
          agentId: runtime.agentId,
          worldId: worldId as UUID,
          roomId,
          entityId: runtime.agentId,
          name,
          description: `User added TODO: ${name}`, // Simple description
          type: type as 'daily' | 'one-off' | 'aspirational',
          priority: type === 'one-off' ? priority || 4 : undefined,
          isUrgent: type === 'one-off' ? isUrgent || false : false,
          dueDate: dueDate ? new Date(dueDate) : undefined,
          metadata,
          tags,
        });

        if (!newTodoId) {
          return res.status(500).send('Failed to create todo');
        }

        const newTodo = await dataService.getTodo(newTodoId);
        res.status(201).json(newTodo);
      } catch (error) {
        console.error('Error creating todo:', error);
        res.status(500).send('Error creating todo');
      }
    },
  },
  // API route to complete a TODO
  {
    type: 'PUT',
    path: '/api/todos/:id/complete',
    handler: async (
      req: { params: { id: string } },
      res: TodoApiResponse,
      runtime: IAgentRuntime
    ) => {
      try {
        const taskId = req.params.id as UUID;

        // Task ID is required
        if (!taskId) {
          return res.status(400).send('Missing taskId');
        }

        const dataService = runtime.getService('todo') as TodoService;
        if (!dataService) {
          logger.error('[API /api/todos/:id/complete] Todo service not available');
          return res.status(503).send('Todo service not available');
        }
        const task = await dataService.getTodo(taskId);

        if (!task) {
          return res.status(404).send('Task not found');
        }

        // Check if already completed
        if (task.isCompleted) {
          return res.status(400).send('Task already completed');
        }

        const now = new Date();
        const metadataUpdate: Record<string, any> = {
          ...task.metadata,
          completedAt: now.toISOString(),
        };

        // Handle daily task metadata
        if (task.type === 'daily') {
          metadataUpdate.completedToday = true;
          metadataUpdate.lastCompletedDate = now.toISOString().split('T')[0];
        }

        // Update the task
        await dataService.updateTodo(taskId, {
          isCompleted: true,
          completedAt: now,
          metadata: metadataUpdate,
        });

        // Return the final task state
        const updatedTask = await dataService.getTodo(taskId);
        res.json({
          message: `Task ${taskId} completed.`,
          task: updatedTask,
        });
      } catch (error) {
        console.error(`Error completing todo ${req.params.id}:`, error);
        res.status(500).send('Error completing todo');
      }
    },
  },
  // API route to uncomplete a TODO
  {
    type: 'PUT',
    path: '/api/todos/:id/uncomplete',
    handler: async (
      req: { params: { id: string } },
      res: TodoApiResponse,
      runtime: IAgentRuntime
    ) => {
      try {
        const taskId = req.params.id as UUID;
        if (!taskId) {
          return res.status(400).send('Missing taskId');
        }

        const dataService = runtime.getService('todo') as TodoService;
        if (!dataService) {
          logger.error('[API /api/todos/:id/uncomplete] Todo service not available');
          return res.status(503).send('Todo service not available');
        }
        const task = await dataService.getTodo(taskId);

        if (!task) {
          return res.status(404).send('Task not found');
        }

        // Check if already incomplete
        if (!task.isCompleted) {
          return res.status(400).send('Task is already not completed');
        }

        // --- Logic to reverse completion ---
        const metadataUpdate = { ...task.metadata };
        delete metadataUpdate.completedAt;
        // Optionally handle daily task metadata
        if (task.type === 'daily' && metadataUpdate.completedToday) {
          delete metadataUpdate.completedToday;
        }

        await dataService.updateTodo(taskId, {
          isCompleted: false,
          completedAt: undefined,
          metadata: metadataUpdate,
        });

        const updatedTask = await dataService.getTodo(taskId);
        res.json({
          message: `Task ${taskId} marked as not completed.`,
          task: updatedTask,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error uncompleting todo ${req.params.id}:`, error);
        logger.error(`Error uncompleting todo ${req.params.id}:`, error);
        res.status(500).send(`Error uncompleting todo: ${errorMessage}`);
      }
    },
  },
  // API route to update an existing TODO
  {
    type: 'PUT',
    path: '/api/todos',
    handler: async (req: TodoApiRequest, res: TodoApiResponse, runtime: IAgentRuntime) => {
      try {
        const {
          id,
          name,
          description,
          type,
          priority,
          isUrgent,
          isCompleted,
          dueDate,
          completedAt,
          tags,
        } = req.body;

        if (!id) {
          return res.status(400).send('Missing task ID');
        }
        if (
          !name &&
          !description &&
          !priority &&
          isUrgent === undefined &&
          isCompleted === undefined &&
          dueDate === undefined &&
          completedAt === undefined &&
          tags === undefined
        ) {
          return res.status(400).send('Missing update data');
        }

        const dataService = runtime.getService('todo') as TodoService;
        if (!dataService) {
          logger.error('[API /api/todos] Todo service not available');
          return res.status(503).send('Todo service not available');
        }
        const task = await dataService.getTodo(id);

        if (!task) {
          return res.status(404).send('Task not found');
        }

        // --- Apply updates (similar logic to applyTaskUpdate in updateTodo.ts) ---
        const updatedTags = [...(task.tags || [])];
        const updatedMetadata = { ...(task.metadata || {}) };
        const updatedTaskData: Record<string, unknown> = {};

        if (name) {
          updatedTaskData.name = name;
        }
        if (description !== undefined) {
          updatedTaskData.description = description;
        }

        // Update priority (for one-off tasks)
        if (priority && task.type === 'one-off') {
          updatedTaskData.priority = priority;
          // Update priority tag
          const priorityIndex = updatedTags.findIndex((tag) => tag.startsWith('priority-'));
          if (priorityIndex !== -1) {
            updatedTags.splice(priorityIndex, 1);
          }
          updatedTags.push(`priority-${priority}`);
        }

        // Update urgency (for one-off tasks)
        if (isUrgent !== undefined && task.type === 'one-off') {
          updatedTaskData.isUrgent = isUrgent;
          const urgentIndex = updatedTags.indexOf('urgent');
          if (urgentIndex !== -1) {
            updatedTags.splice(urgentIndex, 1);
          }
          if (isUrgent) {
            updatedTags.push('urgent');
          }
        }

        // Update recurring pattern (for daily tasks)
        if (type === 'daily') {
          const recurringIndex = updatedTags.findIndex((tag) => tag.startsWith('recurring-'));
          if (recurringIndex !== -1) {
            updatedTags.splice(recurringIndex, 1);
          }
          updatedTags.push(`recurring-${type}`);
          updatedMetadata.recurring = type;
        }

        // Update due date (for one-off tasks)
        if (dueDate !== undefined) {
          if (dueDate === null) {
            updatedTaskData.dueDate = null;
          } else {
            updatedTaskData.dueDate = new Date(dueDate);
          }
        }

        // Update completion status
        if (isCompleted !== undefined) {
          updatedTaskData.isCompleted = isCompleted;
        }

        if (completedAt !== undefined) {
          if (completedAt === null) {
            updatedTaskData.completedAt = null;
          } else {
            updatedTaskData.completedAt = new Date(completedAt);
          }
        }

        // Apply all updates
        await dataService.updateTodo(id, {
          ...updatedTaskData,
          metadata: updatedMetadata,
        });

        const updatedTask = await dataService.getTodo(id);
        res.json({
          message: `Task ${id} updated successfully.`,
          task: updatedTask,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error updating todo ${req.body.id}:`, error);
        logger.error(`Error updating todo ${req.body.id}:`, error);
        res.status(500).send(`Error updating todo: ${errorMessage}`);
      }
    },
  },
  // API route to delete a TODO
  {
    type: 'DELETE',
    path: '/api/todos/:id',
    handler: async (
      req: { params: { id: string } },
      res: TodoApiResponse,
      runtime: IAgentRuntime
    ) => {
      try {
        const todoId = req.params?.id as UUID;
        if (!todoId) {
          return res.status(400).send('Missing todo ID');
        }

        const dataService = runtime.getService('todo') as TodoService;
        if (!dataService) {
          logger.error('[API /api/todos/:id] Todo service not available');
          return res.status(503).send('Todo service not available');
        }
        const task = await dataService.getTodo(todoId);

        if (!task) {
          return res.status(404).send('Task not found');
        }

        await dataService.deleteTodo(todoId);

        res.json({
          message: `Task ${todoId} deleted successfully.`,
        });
      } catch (error) {
        console.error(`Error deleting todo ${req.params.id}:`, error);
        logger.error(`Error deleting todo ${req.params.id}:`, error);
        res.status(500).send('Error deleting todo');
      }
    },
  },
  // API to get overdue TODOs
  {
    type: 'GET',
    path: '/api/todos/overdue',
    handler: async (_req: unknown, res: TodoApiResponse, runtime: IAgentRuntime) => {
      try {
        const dataService = runtime.getService('todo') as TodoService;
        if (!dataService) {
          logger.error('[API /api/todos/overdue] Todo service not available');
          return res.status(503).json({ error: 'Todo service not available' });
        }
        const overdueTodos = await dataService.getOverdueTodos();
        res.json(overdueTodos);
      } catch (error) {
        logger.error('[API /api/todos/overdue] Error fetching overdue todos:', error);
        res.status(500).json({ error: 'Failed to fetch overdue todos' });
      }
    },
  },
  // API to reset daily TODOs
  {
    type: 'POST',
    path: '/api/todos/reset-daily',
    handler: async (_req: unknown, res: TodoApiResponse, runtime: IAgentRuntime) => {
      try {
        const dataService = runtime.getService('todo') as TodoService;
        if (!dataService) {
          logger.error('[API /api/todos/reset-daily] Todo service not available');
          return res.status(503).json({ error: 'Todo service not available' });
        }
        const count = await dataService.resetDailyTodos();
        res.json({ success: true, resetCount: count });
      } catch (error) {
        logger.error('[API /api/todos/reset-daily] Error resetting daily todos:', error);
        res.status(500).json({ error: 'Failed to reset daily todos' });
      }
    },
  },
];

export default routes;

// Type definitions for API requests and responses
interface TodoApiRequest {
  body: {
    name?: string;
    type?: 'daily' | 'one-off' | 'aspirational';
    priority?: number;
    dueDate?: string;
    isUrgent?: boolean;
    roomId?: UUID;
    // For update operations
    id?: UUID;
    description?: string;
    isCompleted?: boolean;
    completedAt?: string;
    tags?: string[];
  };
  params?: Record<string, string>;
}

interface TodoApiResponse {
  status: (code: number) => TodoApiResponse;
  json: (data: unknown) => void;
  send: (data: string) => void;
  setHeader: (name: string, value: string) => void;
  sendFile: (path: string) => void;
}
