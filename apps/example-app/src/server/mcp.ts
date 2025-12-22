import { getNetworkName } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import type {
  MCPResource,
  MCPServerInfo,
  MCPTool,
  Todo,
  TodoStats,
} from '../schemas'
import {
  addressSchema,
  bulkCompleteSchema,
  createTodoInputSchema,
  listTodosQuerySchema,
  mcpPromptGetSchema,
  mcpResourceReadSchema,
  mcpResourceSchema,
  mcpServerInfoSchema,
  mcpToolCallSchema,
  mcpToolSchema,
  todoIdSchema,
  updateTodoInputSchema,
} from '../schemas'
import { getCronService } from '../services/cron'
import { getTodoService } from '../services/todo'
import type { MCPPrompt } from '../types'
import {
  expectValid,
  sanitizeErrorMessage,
  ValidationError,
} from '../utils/validation'

const MCP_SERVER_INFO: MCPServerInfo = {
  name: 'jeju-todo-mcp',
  version: '1.0.0',
  description: 'Decentralized Todo MCP Server - Manage todos with AI tools',
  capabilities: {
    resources: true,
    tools: true,
    prompts: true,
  },
}

const MCP_RESOURCES: MCPResource[] = [
  {
    uri: 'todo://todos',
    name: 'All Todos',
    description: 'List of all user todos',
    mimeType: 'application/json',
  },
  {
    uri: 'todo://pending',
    name: 'Pending Todos',
    description: 'List of incomplete todos',
    mimeType: 'application/json',
  },
  {
    uri: 'todo://completed',
    name: 'Completed Todos',
    description: 'List of completed todos',
    mimeType: 'application/json',
  },
  {
    uri: 'todo://stats',
    name: 'Statistics',
    description: 'Todo statistics',
    mimeType: 'application/json',
  },
  {
    uri: 'todo://overdue',
    name: 'Overdue Todos',
    description: 'List of overdue todos',
    mimeType: 'application/json',
  },
]

const MCP_TOOLS: MCPTool[] = [
  {
    name: 'list_todos',
    description: 'List todos with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        completed: {
          type: 'boolean',
          description: 'Filter by completion status',
        },
        priority: {
          type: 'string',
          description: 'Filter by priority',
          enum: ['low', 'medium', 'high'],
        },
        search: {
          type: 'string',
          description: 'Search in title and description',
        },
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
        priority: {
          type: 'string',
          description: 'Priority level',
          enum: ['low', 'medium', 'high'],
        },
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
        priority: {
          type: 'string',
          description: 'Priority level',
          enum: ['low', 'medium', 'high'],
        },
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
]

const MCP_PROMPTS: MCPPrompt[] = [
  {
    name: 'daily_summary',
    description: 'Generate a daily summary of todos',
    arguments: [
      {
        name: 'date',
        description: 'Date for summary (ISO string)',
        required: false,
      },
    ],
  },
  {
    name: 'prioritize_tasks',
    description: 'Get AI-suggested task prioritization',
    arguments: [
      {
        name: 'count',
        description: 'Number of top tasks to return',
        required: false,
      },
    ],
  },
  {
    name: 'weekly_report',
    description: 'Generate a weekly productivity report',
    arguments: [
      {
        name: 'weekStart',
        description: 'Start date of the week',
        required: false,
      },
    ],
  },
]

const networkName = getNetworkName()
const isLocalnet = networkName === 'localnet' || networkName === 'Jeju'

export function createMCPServer() {
  const todoService = getTodoService()
  const cronService = getCronService()

  return new Elysia({ prefix: '/mcp' })
    .onError(({ error }) => {
      console.error('[MCP Error]', error)

      if (error instanceof ValidationError) {
        return {
          content: [
            { type: 'text', text: `Validation error: ${error.message}` },
          ],
          isError: true,
        }
      }

      const errorObj =
        error instanceof Error ? error : new Error(String(error))
      const safeMessage = sanitizeErrorMessage(errorObj, isLocalnet)
      return {
        content: [{ type: 'text', text: `Internal error: ${safeMessage}` }],
        isError: true,
      }
    })
    .post('/initialize', () => {
      const validatedInfo: MCPServerInfo = expectValid(
        mcpServerInfoSchema,
        MCP_SERVER_INFO,
        'MCP server info',
      )
      return {
        protocolVersion: '2024-11-05',
        serverInfo: validatedInfo,
        capabilities: validatedInfo.capabilities,
      }
    })
    .post('/resources/list', () => {
      const validatedResources = MCP_RESOURCES.map((r) =>
        expectValid(mcpResourceSchema, r, 'MCP resource'),
      )
      return { resources: validatedResources }
    })
    .post('/resources/read', async ({ body, request, set }) => {
      const validatedInput = expectValid(
        mcpResourceReadSchema,
        body,
        'Resource read input',
      )

      const addressHeader = request.headers.get('x-jeju-address')
      if (!addressHeader) {
        set.status = 401
        return {
          error: 'Authentication required: x-jeju-address header missing',
        }
      }

      const address = expectValid(
        addressSchema,
        addressHeader,
        'x-jeju-address header',
      )

      const uri = validatedInput.uri

      type ResourceContents = { todos: Todo[]; count: number } | TodoStats

      let contents: ResourceContents

      switch (uri) {
        case 'todo://todos': {
          const todos = await todoService.listTodos(address)
          contents = { todos, count: todos.length }
          break
        }
        case 'todo://pending': {
          const todos = await todoService.listTodos(address, {
            completed: false,
          })
          contents = { todos, count: todos.length }
          break
        }
        case 'todo://completed': {
          const todos = await todoService.listTodos(address, {
            completed: true,
          })
          contents = { todos, count: todos.length }
          break
        }
        case 'todo://stats': {
          contents = await todoService.getStats(address)
          break
        }
        case 'todo://overdue': {
          const todos = await todoService.listTodos(address, {
            completed: false,
          })
          const now = Date.now()
          const overdue = todos.filter((t) => t.dueDate && t.dueDate < now)
          contents = { todos: overdue, count: overdue.length }
          break
        }
        default:
          set.status = 404
          return { error: 'Resource not found' }
      }

      return {
        contents: [
          { uri, mimeType: 'application/json', text: JSON.stringify(contents) },
        ],
      }
    })
    .post('/tools/list', () => {
      const validatedTools = MCP_TOOLS.map((t) =>
        expectValid(mcpToolSchema, t, 'MCP tool'),
      )
      return { tools: validatedTools }
    })
    .post('/tools/call', async ({ body, request }) => {
      const validatedInput = expectValid(
        mcpToolCallSchema,
        body,
        'Tool call input',
      )

      const addressHeader = request.headers.get('x-jeju-address')
      if (!addressHeader) {
        return {
          content: [
            {
              type: 'text',
              text: 'Authentication required: x-jeju-address header missing',
            },
          ],
          isError: true,
        }
      }

      const address = expectValid(
        addressSchema,
        addressHeader,
        'x-jeju-address header',
      )

      type ToolResult =
        | { todos: Todo[]; count: number }
        | { todo: Todo; created: boolean }
        | { todo: Todo; updated: boolean }
        | { deleted: boolean; id: string }
        | TodoStats
        | {
            reminder: {
              id: string
              todoId: string
              owner: string
              reminderTime: number
              sent: boolean
              createdAt: number
            }
            scheduled: boolean
          }
        | { completed: number; todos: Todo[] }

      let result: ToolResult
      const isError = false

      switch (validatedInput.name) {
        case 'list_todos': {
          const queryParams = {
            completed: validatedInput.arguments.completed,
            priority: validatedInput.arguments.priority,
            search: validatedInput.arguments.search,
          }
          const validatedQuery = expectValid(
            listTodosQuerySchema,
            queryParams,
            'List todos query',
          )
          const todos = await todoService.listTodos(address, validatedQuery)
          result = { todos, count: todos.length }
          break
        }

        case 'create_todo': {
          const validatedCreateInput = expectValid(
            createTodoInputSchema,
            validatedInput.arguments,
            'Create todo input',
          )
          const todo = await todoService.createTodo(
            address,
            validatedCreateInput,
          )
          result = { todo, created: true }
          break
        }

        case 'update_todo': {
          const id = expectValid(
            todoIdSchema,
            validatedInput.arguments.id,
            'Todo ID',
          )

          const validatedUpdateInput = expectValid(
            updateTodoInputSchema,
            validatedInput.arguments,
            'Update todo input',
          )

          const todo = await todoService.updateTodo(
            id,
            address,
            validatedUpdateInput,
          )
          if (!todo) {
            throw new ValidationError(`Todo ${id} not found`)
          }
          result = { todo, updated: true }
          break
        }

        case 'delete_todo': {
          const id = expectValid(
            todoIdSchema,
            validatedInput.arguments.id,
            'Todo ID',
          )

          const deleted = await todoService.deleteTodo(id, address)
          if (!deleted) {
            throw new ValidationError(`Todo ${id} not found`)
          }
          result = { deleted: true, id }
          break
        }

        case 'get_stats': {
          result = await todoService.getStats(address)
          break
        }

        case 'schedule_reminder': {
          const todoId = expectValid(
            todoIdSchema,
            validatedInput.arguments.todoId,
            'Todo ID',
          )
          const reminderTime = validatedInput.arguments.reminderTime

          if (typeof reminderTime !== 'number' || reminderTime <= 0) {
            throw new ValidationError('reminderTime must be a positive number')
          }

          const reminder = await cronService.scheduleReminder(
            todoId,
            address,
            reminderTime,
          )
          result = { reminder, scheduled: true }
          break
        }

        case 'bulk_complete': {
          const validatedBulkInput = expectValid(
            bulkCompleteSchema,
            { ids: validatedInput.arguments.ids },
            'Bulk complete input',
          )
          const completed = await todoService.bulkComplete(
            validatedBulkInput.ids,
            address,
          )
          result = { completed: completed.length, todos: completed }
          break
        }

        default:
          throw new ValidationError(
            `Unknown tool: ${validatedInput.name}. Available: ${MCP_TOOLS.map((t) => t.name).join(', ')}`,
          )
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError,
      }
    })
    .post('/prompts/list', () => ({ prompts: MCP_PROMPTS }))
    .post('/prompts/get', async ({ body, request, set }) => {
      const validatedInput = expectValid(
        mcpPromptGetSchema,
        body,
        'Prompt get input',
      )

      const addressHeader = request.headers.get('x-jeju-address')
      if (!addressHeader) {
        set.status = 401
        return {
          error: 'Authentication required: x-jeju-address header missing',
        }
      }

      const address = expectValid(
        addressSchema,
        addressHeader,
        'x-jeju-address header',
      )

      let messages: Array<{
        role: string
        content: { type: string; text: string }
      }> = []

      switch (validatedInput.name) {
        case 'daily_summary': {
          const todos = await todoService.listTodos(address)
          const stats = await todoService.getStats(address)
          const date =
            validatedInput.arguments.date ??
            new Date().toISOString().split('T')[0]

          messages = [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Generate a daily summary for ${date}. User has ${stats.total} total todos, ${stats.pending} pending, ${stats.completed} completed, ${stats.overdue} overdue. Pending todos: ${JSON.stringify(todos.filter((t) => !t.completed).map((t) => ({ title: t.title, priority: t.priority, dueDate: t.dueDate })))}`,
              },
            },
          ]
          break
        }

        case 'prioritize_tasks': {
          const todos = await todoService.listTodos(address, {
            completed: false,
          })
          const countArg = validatedInput.arguments.count
          const count = countArg !== undefined ? parseInt(countArg, 10) : 5

          messages = [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Analyze and prioritize these tasks, returning the top ${count} items the user should focus on. Consider urgency (due dates) and importance (priority level). Tasks: ${JSON.stringify(todos.map((t) => ({ id: t.id, title: t.title, priority: t.priority, dueDate: t.dueDate, description: t.description })))}`,
              },
            },
          ]
          break
        }

        case 'weekly_report': {
          const stats = await todoService.getStats(address)
          const weekStart =
            validatedInput.arguments.weekStart ??
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
              .toISOString()
              .split('T')[0]

          messages = [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Generate a weekly productivity report starting from ${weekStart}. Stats: ${JSON.stringify(stats)}. Provide insights on productivity patterns and suggestions for improvement.`,
              },
            },
          ]
          break
        }

        default:
          set.status = 404
          return { error: 'Prompt not found' }
      }

      return { messages }
    })
    .get('/', () => {
      const validatedInfo = expectValid(
        mcpServerInfoSchema,
        MCP_SERVER_INFO,
        'MCP server info',
      )
      const validatedResources = MCP_RESOURCES.map((r) =>
        expectValid(mcpResourceSchema, r, 'MCP resource'),
      )
      const validatedTools = MCP_TOOLS.map((t) =>
        expectValid(mcpToolSchema, t, 'MCP tool'),
      )

      return {
        ...validatedInfo,
        resources: validatedResources,
        tools: validatedTools,
        prompts: MCP_PROMPTS,
      }
    })
}
