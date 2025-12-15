/**
 * MCP (Model Context Protocol) Server for tool integrations
 */

import { Hono } from 'hono';
import type { Address } from 'viem';
import { getTodoService } from '../services/todo';
import { getCronService } from '../services/cron';
import type { MCPServerInfo, MCPResource, MCPTool, MCPPrompt } from '../types';

const MCP_SERVER_INFO: MCPServerInfo = {
  name: 'jeju-todo-mcp',
  version: '1.0.0',
  description: 'Decentralized Todo MCP Server - Manage todos with AI tools',
  capabilities: {
    resources: true,
    tools: true,
    prompts: true,
  },
};

const MCP_RESOURCES: MCPResource[] = [
  { uri: 'todo://todos', name: 'All Todos', description: 'List of all user todos', mimeType: 'application/json' },
  { uri: 'todo://pending', name: 'Pending Todos', description: 'List of incomplete todos', mimeType: 'application/json' },
  { uri: 'todo://completed', name: 'Completed Todos', description: 'List of completed todos', mimeType: 'application/json' },
  { uri: 'todo://stats', name: 'Statistics', description: 'Todo statistics', mimeType: 'application/json' },
  { uri: 'todo://overdue', name: 'Overdue Todos', description: 'List of overdue todos', mimeType: 'application/json' },
];

const MCP_TOOLS: MCPTool[] = [
  {
    name: 'list_todos',
    description: 'List todos with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        completed: { type: 'boolean', description: 'Filter by completion status' },
        priority: { type: 'string', description: 'Filter by priority', enum: ['low', 'medium', 'high'] },
        search: { type: 'string', description: 'Search in title and description' },
      },
    },
  },
  {
    name: 'create_todo',
    description: 'Create a new todo item',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Todo title' },
        description: { type: 'string', description: 'Todo description' },
        priority: { type: 'string', description: 'Priority level', enum: ['low', 'medium', 'high'] },
        dueDate: { type: 'number', description: 'Due date timestamp' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_todo',
    description: 'Update an existing todo',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Todo ID' },
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
        completed: { type: 'boolean', description: 'Completion status' },
        priority: { type: 'string', description: 'Priority level', enum: ['low', 'medium', 'high'] },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_todo',
    description: 'Delete a todo item',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Todo ID to delete' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_stats',
    description: 'Get todo statistics',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'schedule_reminder',
    description: 'Schedule a reminder for a todo',
    inputSchema: {
      type: 'object',
      properties: {
        todoId: { type: 'string', description: 'Todo ID' },
        reminderTime: { type: 'number', description: 'Reminder timestamp' },
      },
      required: ['todoId', 'reminderTime'],
    },
  },
  {
    name: 'bulk_complete',
    description: 'Mark multiple todos as complete',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', description: 'Array of todo IDs' },
      },
      required: ['ids'],
    },
  },
];

const MCP_PROMPTS: MCPPrompt[] = [
  {
    name: 'daily_summary',
    description: 'Generate a daily summary of todos',
    arguments: [
      { name: 'date', description: 'Date for summary (ISO string)', required: false },
    ],
  },
  {
    name: 'prioritize_tasks',
    description: 'Get AI-suggested task prioritization',
    arguments: [
      { name: 'count', description: 'Number of top tasks to return', required: false },
    ],
  },
  {
    name: 'weekly_report',
    description: 'Generate a weekly productivity report',
    arguments: [
      { name: 'weekStart', description: 'Start date of the week', required: false },
    ],
  },
];

export function createMCPServer(): Hono {
  const app = new Hono();
  const todoService = getTodoService();
  const cronService = getCronService();

  // Initialize
  app.post('/initialize', (c) => c.json({
    protocolVersion: '2024-11-05',
    serverInfo: MCP_SERVER_INFO,
    capabilities: MCP_SERVER_INFO.capabilities,
  }));

  // List resources
  app.post('/resources/list', (c) => c.json({ resources: MCP_RESOURCES }));

  // Read resource
  app.post('/resources/read', async (c) => {
    const { uri } = await c.req.json() as { uri: string };
    const address = c.req.header('x-jeju-address') as Address;

    if (!address) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    let contents: unknown;

    switch (uri) {
      case 'todo://todos': {
        const todos = await todoService.listTodos(address);
        contents = { todos, count: todos.length };
        break;
      }
      case 'todo://pending': {
        const todos = await todoService.listTodos(address, { completed: false });
        contents = { todos, count: todos.length };
        break;
      }
      case 'todo://completed': {
        const todos = await todoService.listTodos(address, { completed: true });
        contents = { todos, count: todos.length };
        break;
      }
      case 'todo://stats': {
        contents = await todoService.getStats(address);
        break;
      }
      case 'todo://overdue': {
        const todos = await todoService.listTodos(address, { completed: false });
        const now = Date.now();
        const overdue = todos.filter(t => t.dueDate && t.dueDate < now);
        contents = { todos: overdue, count: overdue.length };
        break;
      }
      default:
        return c.json({ error: 'Resource not found' }, 404);
    }

    return c.json({
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(contents) }],
    });
  });

  // List tools
  app.post('/tools/list', (c) => c.json({ tools: MCP_TOOLS }));

  // Call tool
  app.post('/tools/call', async (c) => {
    const { name, arguments: args } = await c.req.json() as { name: string; arguments: Record<string, unknown> };
    const address = c.req.header('x-jeju-address') as Address;

    if (!address) {
      return c.json({ content: [{ type: 'text', text: 'Authentication required' }], isError: true });
    }

    let result: unknown;
    let isError = false;

    switch (name) {
      case 'list_todos': {
        const todos = await todoService.listTodos(address, {
          completed: args.completed as boolean | undefined,
          priority: args.priority as 'low' | 'medium' | 'high' | undefined,
          search: args.search as string | undefined,
        });
        result = { todos, count: todos.length };
        break;
      }

      case 'create_todo': {
        const title = args.title as string;
        if (!title) {
          result = { error: 'Title is required' };
          isError = true;
          break;
        }
        const todo = await todoService.createTodo(address, {
          title,
          description: args.description as string | undefined,
          priority: args.priority as 'low' | 'medium' | 'high' | undefined,
          dueDate: args.dueDate as number | undefined,
        });
        result = { todo, created: true };
        break;
      }

      case 'update_todo': {
        const id = args.id as string;
        if (!id) {
          result = { error: 'ID is required' };
          isError = true;
          break;
        }
        const todo = await todoService.updateTodo(id, address, {
          title: args.title as string | undefined,
          description: args.description as string | undefined,
          completed: args.completed as boolean | undefined,
          priority: args.priority as 'low' | 'medium' | 'high' | undefined,
        });
        if (!todo) {
          result = { error: 'Todo not found' };
          isError = true;
        } else {
          result = { todo, updated: true };
        }
        break;
      }

      case 'delete_todo': {
        const id = args.id as string;
        if (!id) {
          result = { error: 'ID is required' };
          isError = true;
          break;
        }
        const deleted = await todoService.deleteTodo(id, address);
        if (!deleted) {
          result = { error: 'Todo not found' };
          isError = true;
        } else {
          result = { deleted: true, id };
        }
        break;
      }

      case 'get_stats': {
        result = await todoService.getStats(address);
        break;
      }

      case 'schedule_reminder': {
        const todoId = args.todoId as string;
        const reminderTime = args.reminderTime as number;
        if (!todoId || !reminderTime) {
          result = { error: 'todoId and reminderTime are required' };
          isError = true;
          break;
        }
        const reminder = await cronService.scheduleReminder(todoId, address, reminderTime);
        result = { reminder, scheduled: true };
        break;
      }

      case 'bulk_complete': {
        const ids = args.ids as string[];
        if (!Array.isArray(ids) || ids.length === 0) {
          result = { error: 'ids array is required' };
          isError = true;
          break;
        }
        const completed = await todoService.bulkComplete(ids, address);
        result = { completed: completed.length, todos: completed };
        break;
      }

      default:
        result = { error: `Unknown tool: ${name}` };
        isError = true;
    }

    return c.json({
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError,
    });
  });

  // List prompts
  app.post('/prompts/list', (c) => c.json({ prompts: MCP_PROMPTS }));

  // Get prompt
  app.post('/prompts/get', async (c) => {
    const { name, arguments: args } = await c.req.json() as { name: string; arguments: Record<string, string> };
    const address = c.req.header('x-jeju-address') as Address;

    if (!address) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    let messages: Array<{ role: string; content: { type: string; text: string } }> = [];

    switch (name) {
      case 'daily_summary': {
        const todos = await todoService.listTodos(address);
        const stats = await todoService.getStats(address);
        const date = args.date ?? new Date().toISOString().split('T')[0];
        
        messages = [{
          role: 'user',
          content: {
            type: 'text',
            text: `Generate a daily summary for ${date}. User has ${stats.total} total todos, ${stats.pending} pending, ${stats.completed} completed, ${stats.overdue} overdue. Pending todos: ${JSON.stringify(todos.filter(t => !t.completed).map(t => ({ title: t.title, priority: t.priority, dueDate: t.dueDate })))}`,
          },
        }];
        break;
      }

      case 'prioritize_tasks': {
        const todos = await todoService.listTodos(address, { completed: false });
        const count = parseInt(args.count || '5', 10);
        
        messages = [{
          role: 'user',
          content: {
            type: 'text',
            text: `Analyze and prioritize these tasks, returning the top ${count} items the user should focus on. Consider urgency (due dates) and importance (priority level). Tasks: ${JSON.stringify(todos.map(t => ({ id: t.id, title: t.title, priority: t.priority, dueDate: t.dueDate, description: t.description })))}`,
          },
        }];
        break;
      }

      case 'weekly_report': {
        const todos = await todoService.listTodos(address);
        const stats = await todoService.getStats(address);
        const weekStart = args.weekStart ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        messages = [{
          role: 'user',
          content: {
            type: 'text',
            text: `Generate a weekly productivity report starting from ${weekStart}. Stats: ${JSON.stringify(stats)}. Provide insights on productivity patterns and suggestions for improvement.`,
          },
        }];
        break;
      }

      default:
        return c.json({ error: 'Prompt not found' }, 404);
    }

    return c.json({ messages });
  });

  // Root info
  app.get('/', (c) => c.json({
    ...MCP_SERVER_INFO,
    resources: MCP_RESOURCES,
    tools: MCP_TOOLS,
    prompts: MCP_PROMPTS,
  }));

  return app;
}
