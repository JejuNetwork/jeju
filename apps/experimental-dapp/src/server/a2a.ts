/**
 * A2A (Agent-to-Agent) Server for AI agent integration
 */

import { Hono } from 'hono';
import { getNetworkName, getWebsiteUrl } from '@jejunetwork/config';
import { getTodoService } from '../services/todo';
import { getCronService } from '../services/cron';
import type { A2AAgentCard, A2AMessage, A2AResponse, A2ASkill } from '../types';
import type { Address } from 'viem';

const AGENT_CARD: A2AAgentCard = {
  protocolVersion: '0.3.0',
  name: 'Decentralized Todo Agent',
  description: 'AI-integrated todo management with full decentralization',
  url: '/a2a',
  preferredTransport: 'http',
  provider: { organization: getNetworkName(), url: getWebsiteUrl() },
  version: '1.0.0',
  capabilities: {
    streaming: false,
    pushNotifications: true,
    stateTransitionHistory: true,
  },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    {
      id: 'list-todos',
      name: 'List Todos',
      description: 'List all todos for a user',
      tags: ['query', 'todos'],
      examples: ['Show my todos', 'What do I need to do?', 'List incomplete tasks'],
    },
    {
      id: 'create-todo',
      name: 'Create Todo',
      description: 'Create a new todo item',
      tags: ['action', 'todos'],
      examples: ['Add a todo to buy groceries', 'Create task: finish report'],
    },
    {
      id: 'complete-todo',
      name: 'Complete Todo',
      description: 'Mark a todo as complete',
      tags: ['action', 'todos'],
      examples: ['Mark todo as done', 'Complete task #123'],
    },
    {
      id: 'delete-todo',
      name: 'Delete Todo',
      description: 'Delete a todo item',
      tags: ['action', 'todos'],
      examples: ['Delete todo #123', 'Remove that task'],
    },
    {
      id: 'get-summary',
      name: 'Get Summary',
      description: 'Get summary statistics of todos',
      tags: ['query', 'stats'],
      examples: ['How many tasks do I have?', 'Show todo summary'],
    },
    {
      id: 'set-reminder',
      name: 'Set Reminder',
      description: 'Schedule a reminder for a todo',
      tags: ['action', 'cron'],
      examples: ['Remind me about this tomorrow', 'Set reminder for 5pm'],
    },
    {
      id: 'prioritize',
      name: 'Prioritize Todos',
      description: 'Get AI-suggested prioritization of todos',
      tags: ['query', 'ai'],
      examples: ['What should I work on first?', 'Prioritize my tasks'],
    },
  ],
};

export function createA2AServer(): Hono {
  const app = new Hono();
  const todoService = getTodoService();
  const cronService = getCronService();

  // Agent card discovery
  app.get('/.well-known/agent-card.json', (c) => c.json(AGENT_CARD));

  // Main A2A endpoint
  app.post('/', async (c) => {
    const body = await c.req.json() as A2AMessage;
    const address = c.req.header('x-jeju-address') as Address;

    if (body.method !== 'message/send') {
      const response: A2AResponse = {
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: 'Method not found' },
      };
      return c.json(response);
    }

    if (!address) {
      const response: A2AResponse = {
        jsonrpc: '2.0',
        id: body.id,
        error: { code: 401, message: 'Authentication required' },
      };
      return c.json(response);
    }

    const dataPart = body.params?.message?.parts?.find(p => p.kind === 'data');
    const skillId = dataPart?.data?.skillId as string;
    const params = dataPart?.data ?? {};

    const result = await executeSkill(skillId, params, address, todoService, cronService);

    const response: A2AResponse = {
      jsonrpc: '2.0',
      id: body.id,
      result: {
        role: 'agent',
        parts: [
          { kind: 'text', text: result.message },
          { kind: 'data', data: result.data },
        ],
        messageId: body.params?.message?.messageId ?? `msg-${Date.now()}`,
        kind: 'message',
      },
    };

    return c.json(response);
  });

  return app;
}

interface SkillResult {
  message: string;
  data: Record<string, unknown>;
}

async function executeSkill(
  skillId: string,
  params: Record<string, unknown>,
  address: Address,
  todoService: ReturnType<typeof getTodoService>,
  cronService: ReturnType<typeof getCronService>
): Promise<SkillResult> {
  switch (skillId) {
    case 'list-todos': {
      const completed = params.completed as boolean | undefined;
      const priority = params.priority as 'low' | 'medium' | 'high' | undefined;
      const todos = await todoService.listTodos(address, { completed, priority });
      
      const incompleteCount = todos.filter(t => !t.completed).length;
      const message = todos.length === 0
        ? 'You have no todos.'
        : `You have ${todos.length} todo(s), ${incompleteCount} incomplete.`;
      
      return {
        message,
        data: { todos, count: todos.length, incomplete: incompleteCount },
      };
    }

    case 'create-todo': {
      const title = params.title as string;
      const description = params.description as string | undefined;
      const priority = params.priority as 'low' | 'medium' | 'high' | undefined;
      const dueDate = params.dueDate as number | undefined;

      if (!title) {
        return { message: 'Title is required to create a todo.', data: { error: true } };
      }

      const todo = await todoService.createTodo(address, { title, description, priority, dueDate });
      return {
        message: `Created todo: "${todo.title}"`,
        data: { todo, created: true },
      };
    }

    case 'complete-todo': {
      const id = params.id as string;
      if (!id) {
        return { message: 'Todo ID is required.', data: { error: true } };
      }

      const todo = await todoService.updateTodo(id, address, { completed: true });
      if (!todo) {
        return { message: `Todo ${id} not found.`, data: { error: true } };
      }

      return {
        message: `Completed: "${todo.title}"`,
        data: { todo, completed: true },
      };
    }

    case 'delete-todo': {
      const id = params.id as string;
      if (!id) {
        return { message: 'Todo ID is required.', data: { error: true } };
      }

      const deleted = await todoService.deleteTodo(id, address);
      if (!deleted) {
        return { message: `Todo ${id} not found.`, data: { error: true } };
      }

      return {
        message: 'Todo deleted.',
        data: { deleted: true, id },
      };
    }

    case 'get-summary': {
      const stats = await todoService.getStats(address);
      const message = `You have ${stats.total} todos: ${stats.completed} completed, ${stats.pending} pending. ${stats.overdue} overdue.`;
      
      return {
        message,
        data: { stats },
      };
    }

    case 'set-reminder': {
      const todoId = params.todoId as string;
      const reminderTime = params.reminderTime as number;

      if (!todoId || !reminderTime) {
        return { message: 'Todo ID and reminder time are required.', data: { error: true } };
      }

      const todo = await todoService.getTodo(todoId, address);
      if (!todo) {
        return { message: `Todo ${todoId} not found.`, data: { error: true } };
      }

      const reminder = await cronService.scheduleReminder(todoId, address, reminderTime);
      return {
        message: `Reminder set for "${todo.title}" at ${new Date(reminderTime).toISOString()}.`,
        data: { reminder, todo },
      };
    }

    case 'prioritize': {
      const todos = await todoService.listTodos(address, { completed: false });
      
      // Simple prioritization based on due date and priority level
      const prioritized = [...todos].sort((a, b) => {
        // Priority weight
        const priorityWeight = { high: 0, medium: 1, low: 2 };
        const aWeight = priorityWeight[a.priority];
        const bWeight = priorityWeight[b.priority];
        
        if (aWeight !== bWeight) return aWeight - bWeight;
        
        // Then by due date
        if (a.dueDate && b.dueDate) return a.dueDate - b.dueDate;
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        
        return 0;
      });

      const topTasks = prioritized.slice(0, 5);
      const message = topTasks.length === 0
        ? 'No pending tasks to prioritize.'
        : `Top priorities: ${topTasks.map((t, i) => `${i + 1}. ${t.title}`).join(', ')}`;

      return {
        message,
        data: { prioritized: topTasks, total: prioritized.length },
      };
    }

    default:
      return {
        message: `Unknown skill: ${skillId}`,
        data: { error: true, availableSkills: AGENT_CARD.skills.map(s => s.id) },
      };
  }
}
