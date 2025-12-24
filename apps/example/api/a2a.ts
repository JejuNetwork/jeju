import { getNetworkName, getWebsiteUrl } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import type { A2AMessage, A2ASkillParams } from '../lib/schemas'
import {
  a2AAgentCardSchema,
  a2AMessageSchema,
  a2ASkillParamsSchema,
  addressSchema,
  todoIdSchema,
} from '../lib/schemas'
import type { A2AResponse, JsonRecord } from '../lib/types'
import { getTopPriorities, prioritizeTodos } from '../lib/utils'
import { getCronService } from './services/cron'
import { getTodoService } from './services/todo'
import {
  expectValid,
  sanitizeErrorMessage,
  ValidationError,
} from './utils/validation'

const AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: 'Decentralized Todo Agent',
  description: 'AI-integrated todo management with full decentralization',
  url: '/api/a2a',
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
      examples: [
        'Show my todos',
        'What do I need to do?',
        'List incomplete tasks',
      ],
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
}

const networkName = getNetworkName()
const isLocalnet = networkName === 'localnet' || networkName === 'Jeju'

export function createA2AServer() {
  const todoService = getTodoService()
  const cronService = getCronService()

  return new Elysia({ prefix: '/a2a' })
    .onError(({ error }) => {
      console.error('[A2A Error]', error)

      if (error instanceof ValidationError) {
        return {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32602, message: error.message },
        }
      }

      // Handle Error instances or extract message from other error types
      const errorObj = error instanceof Error ? error : new Error(String(error))
      const safeMessage = sanitizeErrorMessage(errorObj, isLocalnet)
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: safeMessage },
      }
    })
    .get('/.well-known/agent-card.json', () => {
      const validatedCard = expectValid(
        a2AAgentCardSchema,
        AGENT_CARD,
        'Agent card',
      )
      return validatedCard
    })
    .post('/', async ({ body, request }) => {
      const validatedMessage: A2AMessage = expectValid(
        a2AMessageSchema,
        body,
        'A2A message',
      )

      const addressHeader = request.headers.get('x-jeju-address')
      if (!addressHeader) {
        const response: A2AResponse = {
          jsonrpc: '2.0',
          id: validatedMessage.id,
          error: {
            code: 401,
            message: 'Authentication required: x-jeju-address header missing',
          },
        }
        return response
      }

      const address = expectValid(
        addressSchema,
        addressHeader,
        'x-jeju-address header',
      )

      if (validatedMessage.method !== 'message/send') {
        const response: A2AResponse = {
          jsonrpc: '2.0',
          id: validatedMessage.id,
          error: {
            code: -32601,
            message: `Method not found: ${validatedMessage.method}`,
          },
        }
        return response
      }

      const message = validatedMessage.params?.message
      if (!message) {
        const response: A2AResponse = {
          jsonrpc: '2.0',
          id: validatedMessage.id,
          error: { code: -32602, message: 'Message params required' },
        }
        return response
      }

      const dataPart = message.parts.find(
        (p: { kind: string }) => p.kind === 'data',
      )
      if (!dataPart || dataPart.kind !== 'data') {
        const response: A2AResponse = {
          jsonrpc: '2.0',
          id: validatedMessage.id,
          error: { code: -32602, message: 'Data part required in message' },
        }
        return response
      }

      const skillId = dataPart.data?.skillId
      if (!skillId || typeof skillId !== 'string') {
        const response: A2AResponse = {
          jsonrpc: '2.0',
          id: validatedMessage.id,
          error: { code: -32602, message: 'skillId required in data part' },
        }
        return response
      }

      const params = expectValid(
        a2ASkillParamsSchema,
        dataPart.data,
        `Skill params for ${skillId}`,
      )

      const result = await executeSkill(
        skillId,
        params,
        address,
        todoService,
        cronService,
      )

      const response: A2AResponse = {
        jsonrpc: '2.0',
        id: validatedMessage.id,
        result: {
          role: 'agent',
          parts: [
            { kind: 'text', text: result.message },
            { kind: 'data', data: result.data },
          ],
          messageId: message.messageId,
          kind: 'message',
        },
      }

      return response
    })
}

interface SkillResult {
  message: string
  data: JsonRecord
}

async function executeSkill(
  skillId: string,
  params: A2ASkillParams,
  address: Address,
  todoService: ReturnType<typeof getTodoService>,
  cronService: ReturnType<typeof getCronService>,
): Promise<SkillResult> {
  switch (skillId) {
    case 'list-todos': {
      const todos = await todoService.listTodos(address, {
        completed: params.completed,
        priority: params.priority,
      })

      const incompleteCount = todos.filter((t) => !t.completed).length
      const message =
        todos.length === 0
          ? 'You have no todos.'
          : `You have ${todos.length} todo(s), ${incompleteCount} incomplete.`

      return {
        message,
        data: { todos, count: todos.length, incomplete: incompleteCount },
      }
    }

    case 'create-todo': {
      if (!params.title) {
        throw new ValidationError('Title is required to create a todo')
      }

      const todo = await todoService.createTodo(address, {
        title: params.title,
        description: params.description,
        priority: params.priority,
        dueDate: params.dueDate,
      })

      return {
        message: `Created todo: "${todo.title}"`,
        data: { todo, created: true },
      }
    }

    case 'complete-todo': {
      const todoId = expectValid(todoIdSchema, params.id, 'Todo ID')
      const todo = await todoService.updateTodo(todoId, address, {
        completed: true,
      })
      if (!todo) {
        throw new ValidationError(`Todo ${params.id} not found`)
      }

      return {
        message: `Completed: "${todo.title}"`,
        data: { todo, completed: true },
      }
    }

    case 'delete-todo': {
      const todoId = expectValid(todoIdSchema, params.id, 'Todo ID')
      const deleted = await todoService.deleteTodo(todoId, address)
      if (!deleted) {
        throw new ValidationError(`Todo ${todoId} not found`)
      }

      return {
        message: 'Todo deleted.',
        data: { deleted: true, id: todoId },
      }
    }

    case 'get-summary': {
      const stats = await todoService.getStats(address)
      const message = `You have ${stats.total} todos: ${stats.completed} completed, ${stats.pending} pending. ${stats.overdue} overdue.`

      return {
        message,
        data: { stats },
      }
    }

    case 'set-reminder': {
      const todoId = expectValid(todoIdSchema, params.todoId, 'Todo ID')
      if (!params.reminderTime) {
        throw new ValidationError('Reminder time is required')
      }

      const todo = await todoService.getTodo(todoId, address)
      if (!todo) {
        throw new ValidationError(`Todo ${params.todoId} not found`)
      }

      const reminder = await cronService.scheduleReminder(
        todoId,
        address,
        params.reminderTime,
      )
      return {
        message: `Reminder set for "${todo.title}" at ${new Date(params.reminderTime).toISOString()}.`,
        data: { reminder: { ...reminder }, todo: { ...todo } },
      }
    }

    case 'prioritize': {
      const todos = await todoService.listTodos(address, { completed: false })

      // Use shared prioritization logic from utils
      const topTasks = getTopPriorities(todos, 5)
      const allPrioritized = prioritizeTodos(todos)

      const message =
        topTasks.length === 0
          ? 'No pending tasks to prioritize.'
          : `Top priorities: ${topTasks.map((t, i) => `${i + 1}. ${t.title}`).join(', ')}`

      return {
        message,
        data: { prioritized: topTasks, total: allPrioritized.length },
      }
    }

    default:
      throw new ValidationError(
        `Unknown skill: ${skillId}. Available: ${AGENT_CARD.skills.map((s) => s.id).join(', ')}`,
      )
  }
}
