/**
 * Example App Worker - Full SQLit Database Support
 *
 * This worker uses SQLit for persistent storage.
 * Database is permissionlessly provisioned on first use.
 *
 * Environment variables:
 * - SQLIT_NODES: SQLit block producer endpoint (required)
 * - SQLIT_DATABASE_ID: Database ID for this app (required)
 * - SQLIT_PRIVATE_KEY: Private key for SQLit auth (required for testnet/mainnet)
 * - NETWORK: Current network (localnet/testnet/mainnet)
 */

import { cors } from '@elysiajs/cors'
import { createTable, getSQLit, type QueryParam, type SQLitClient } from '@jejunetwork/db'
import { Elysia } from 'elysia'
import { recoverMessageAddress, type Address } from 'viem'

// Well-known Anvil dev key - ONLY for localnet
const ANVIL_DEV_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// Auth utilities
const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

function constructAuthMessage(timestamp: number): string {
  return `jeju-dapp:${timestamp}`
}

async function verifyAuth(request: Request): Promise<Address> {
  const address = request.headers.get('x-jeju-address')
  const timestampStr = request.headers.get('x-jeju-timestamp')
  const signature = request.headers.get('x-jeju-signature')

  if (!address || !timestampStr || !signature) {
    throw new Error('Missing authentication headers')
  }

  const timestamp = parseInt(timestampStr, 10)
  if (isNaN(timestamp)) {
    throw new Error('Invalid timestamp')
  }

  const now = Date.now()
  const timeDiff = Math.abs(now - timestamp)
  if (timeDiff > TIMESTAMP_WINDOW_MS) {
    throw new Error('Timestamp expired')
  }

  const message = constructAuthMessage(timestamp)
  const recoveredAddress = await recoverMessageAddress({
    message,
    signature: signature as `0x${string}`,
  })

  if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
    throw new Error('Signature verification failed')
  }

  return address as Address
}

// Database Layer
let dbClient: SQLitClient | null = null
let dbInitialized = false

function getEnv() {
  return {
    NETWORK: process.env.NETWORK ?? 'localnet',
    SQLIT_NODES: process.env.SQLIT_NODES ?? process.env.SQLIT_URL ?? '',
    SQLIT_DATABASE_ID: process.env.SQLIT_DATABASE_ID ?? 'example-todos',
    SQLIT_PRIVATE_KEY: process.env.SQLIT_PRIVATE_KEY,
  }
}

function getDatabase(): SQLitClient | null {
  if (dbClient) return dbClient

  const env = getEnv()

  // Check for SQLit endpoint
  if (!env.SQLIT_NODES) {
    console.log('[Worker] SQLIT_NODES not configured')
    return null
  }

  // Determine private key - use Anvil dev key on localnet, require explicit key otherwise
  let privateKey = env.SQLIT_PRIVATE_KEY as `0x${string}` | undefined

  if (!privateKey) {
    if (env.NETWORK === 'localnet') {
      console.log('[Worker] Using Anvil dev key for localnet')
      privateKey = ANVIL_DEV_KEY
    } else {
      console.log('[Worker] SQLIT_PRIVATE_KEY not set - database unavailable')
      return null
    }
  }

  console.log('[Worker] Connecting to SQLit:', env.SQLIT_NODES)
  console.log('[Worker] Database ID:', env.SQLIT_DATABASE_ID)

  dbClient = getSQLit({
    blockProducerEndpoint: env.SQLIT_NODES.split(',')[0],
    databaseId: env.SQLIT_DATABASE_ID,
    privateKey,
    debug: env.NETWORK === 'localnet',
  })

  return dbClient
}

async function initializeDatabase(db: SQLitClient): Promise<void> {
  if (dbInitialized) return

  console.log('[Worker] Initializing database tables...')

  const todosTable = createTable('todos', [
    { name: 'id', type: 'TEXT', primaryKey: true, notNull: true },
    { name: 'owner', type: 'TEXT', notNull: true },
    { name: 'title', type: 'TEXT', notNull: true },
    { name: 'description', type: 'TEXT', default: "''" },
    { name: 'completed', type: 'INTEGER', default: '0' },
    { name: 'priority', type: 'TEXT', default: "'medium'" },
    { name: 'due_date', type: 'INTEGER' },
    { name: 'encrypted_data', type: 'TEXT' },
    { name: 'attachment_cid', type: 'TEXT' },
    { name: 'created_at', type: 'INTEGER', notNull: true },
    { name: 'updated_at', type: 'INTEGER', notNull: true },
  ])

  await db.exec(todosTable.up)
  await db.exec('CREATE INDEX IF NOT EXISTS idx_todos_owner ON todos(owner)')

  console.log('[Worker] Database tables initialized')
  dbInitialized = true
}

// Todo type
interface Todo {
  id: string
  title: string
  description: string
  completed: boolean
  priority: string
  dueDate: number | null
  owner: string
  encryptedData: string | null
  attachmentCid: string | null
  createdAt: number
  updatedAt: number
}

function rowToTodo(row: Record<string, unknown>): Todo {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) || '',
    completed: Boolean(row.completed),
    priority: (row.priority as string) || 'medium',
    dueDate: row.due_date as number | null,
    owner: row.owner as string,
    encryptedData: row.encrypted_data as string | null,
    attachmentCid: row.attachment_cid as string | null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

// Create Elysia App
const app = new Elysia()
  .use(
    cors({
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'x-jeju-address',
        'x-jeju-timestamp',
        'x-jeju-signature',
      ],
    }),
  )

  // Health check
  .get('/health', async () => {
    const env = getEnv()
    const db = getDatabase()
    let dbStatus = 'not configured'

    if (db) {
      try {
        await db.query('SELECT 1')
        dbStatus = 'connected'
      } catch (err) {
        dbStatus = `error: ${err instanceof Error ? err.message : 'unknown'}`
      }
    }

    return {
      status: 'ok',
      service: 'example-api',
      version: '1.0.0',
      network: env.NETWORK,
      runtime: 'workerd',
      database: dbStatus,
      databaseId: env.SQLIT_DATABASE_ID,
      timestamp: Date.now(),
      services: [
        { name: 'sqlit', status: dbStatus === 'connected' ? 'ok' : 'error' },
        { name: 'ipfs', status: 'ok' },
        { name: 'kms', status: 'ok' },
      ],
    }
  })


  // A2A Protocol - Agent Card
  .get('/a2a/.well-known/agent-card.json', () => ({
    protocolVersion: '0.1.0',
    name: 'Example Todo Agent',
    description: 'An agent that helps manage todo tasks',
    version: '1.0.0',
    skills: [
      {
        name: 'todo-management',
        description: 'Create, read, update, and delete todo items',
        actions: ['list', 'create', 'update', 'delete'],
      },
    ],
  }))

  // x402 Protocol - Payment Info
  .get('/x402/info', () => ({
    enabled: false,
    message: 'x402 payments not enabled for this app',
  }))

  // MCP Protocol - Info
  .get('/mcp', () => ({
    name: 'Example MCP Server',
    version: '1.0.0',
    protocolVersion: '0.1.0',
  }))

  // MCP Protocol - Tools List
  .post('/mcp/tools/list', () => ({
    tools: [
      {
        name: 'list_todos',
        description: 'List all todos for the current user',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'create_todo',
        description: 'Create a new todo item',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'The todo title' },
            priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          },
          required: ['title'],
        },
      },
    ],
  }))

  // MCP Protocol - Resources List
  .post('/mcp/resources/list', () => ({
    resources: [],
  }))

  // REST API
  .group('/api/v1', (api) =>
    api
      // API info
      .get('/', () => {
        const env = getEnv()
        return {
          name: 'Example App',
          version: '1.0.0',
          network: env.NETWORK,
          endpoints: {
            rest: '/api/v1',
            health: '/health',
            docs: '/api/v1/docs',
            a2a: '/a2a',
            mcp: '/mcp',
            x402: '/x402',
          },
        }
      })

      // API Documentation
      .get('/docs', () => ({
        title: 'Example App API',
        version: '1.0.0',
        description: 'A simple todo app demonstrating DWS integration',
        restEndpoints: [
          { method: 'GET', path: '/api/v1/todos', description: 'List todos' },
          { method: 'POST', path: '/api/v1/todos', description: 'Create todo' },
          { method: 'PATCH', path: '/api/v1/todos/:id', description: 'Update todo' },
          { method: 'DELETE', path: '/api/v1/todos/:id', description: 'Delete todo' },
        ],
      }))

      // List todos
      .get('/todos', async ({ request, set }) => {
        try {
          const address = await verifyAuth(request)
          const db = getDatabase()

          if (!db) {
            return { todos: [], count: 0, error: 'Database not configured' }
          }

          await initializeDatabase(db)
          const result = await db.query(
            'SELECT * FROM todos WHERE owner = ? ORDER BY created_at DESC',
            [address.toLowerCase()],
          )

          const todos = (result.rows as Record<string, unknown>[]).map(rowToTodo)
          return { todos, count: todos.length }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          if (
            msg.includes('Missing authentication') ||
            msg.includes('expired')
          ) {
            set.status = 401
            return { error: msg }
          }
          console.error('[API] Error listing todos:', err)
          set.status = 500
          return { error: msg }
        }
      })

      // Create todo
      .post('/todos', async ({ request, body, set }) => {
        try {
          const address = await verifyAuth(request)
          const db = getDatabase()

          if (!db) {
            set.status = 503
            return { error: 'Database not configured' }
          }

          await initializeDatabase(db)

          const input = body as {
            title: string
            priority?: string
            description?: string
          }
          if (!input.title || typeof input.title !== 'string') {
            set.status = 400
            return { error: 'Title is required' }
          }

          const id = crypto.randomUUID()
          const now = Date.now()

          await db.exec(
            `INSERT INTO todos (id, owner, title, description, completed, priority, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              address.toLowerCase(),
              input.title,
              input.description || '',
              0,
              input.priority || 'medium',
              now,
              now,
            ],
          )

          const todo: Todo = {
            id,
            title: input.title,
            description: input.description || '',
            completed: false,
            priority: input.priority || 'medium',
            dueDate: null,
            owner: address.toLowerCase(),
            encryptedData: null,
            attachmentCid: null,
            createdAt: now,
            updatedAt: now,
          }

          return { todo }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          if (
            msg.includes('Missing authentication') ||
            msg.includes('expired')
          ) {
            set.status = 401
            return { error: msg }
          }
          console.error('[API] Error creating todo:', err)
          set.status = 500
          return { error: msg }
        }
      })

      // Update todo
      .patch('/todos/:id', async ({ request, params, body, set }) => {
        try {
          const address = await verifyAuth(request)
          const db = getDatabase()

          if (!db) {
            set.status = 503
            return { error: 'Database not configured' }
          }

          await initializeDatabase(db)

          const input = body as {
            title?: string
            completed?: boolean
            priority?: string
          }
          const updates: string[] = []
          const values: QueryParam[] = []

          if (input.title !== undefined) {
            updates.push('title = ?')
            values.push(input.title)
          }
          if (input.completed !== undefined) {
            updates.push('completed = ?')
            values.push(input.completed ? 1 : 0)
          }
          if (input.priority !== undefined) {
            updates.push('priority = ?')
            values.push(input.priority)
          }

          if (updates.length === 0) {
            set.status = 400
            return { error: 'No fields to update' }
          }

          updates.push('updated_at = ?')
          values.push(Date.now())
          values.push(params.id, address.toLowerCase())

          await db.exec(
            `UPDATE todos SET ${updates.join(', ')} WHERE id = ? AND owner = ?`,
            values,
          )

          const result = await db.query(
            'SELECT * FROM todos WHERE id = ? AND owner = ?',
            [params.id, address.toLowerCase()],
          )

          if (result.rows.length === 0) {
            set.status = 404
            return { error: 'Todo not found' }
          }

          return { todo: rowToTodo(result.rows[0] as Record<string, unknown>) }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          if (
            msg.includes('Missing authentication') ||
            msg.includes('expired')
          ) {
            set.status = 401
            return { error: msg }
          }
          console.error('[API] Error updating todo:', err)
          set.status = 500
          return { error: msg }
        }
      })

      // Delete todo
      .delete('/todos/:id', async ({ request, params, set }) => {
        try {
          const address = await verifyAuth(request)
          const db = getDatabase()

          if (!db) {
            set.status = 503
            return { error: 'Database not configured' }
          }

          await initializeDatabase(db)

          const result = await db.query(
            'SELECT id FROM todos WHERE id = ? AND owner = ?',
            [params.id, address.toLowerCase()],
          )

          if (result.rows.length === 0) {
            set.status = 404
            return { error: 'Todo not found' }
          }

          await db.exec('DELETE FROM todos WHERE id = ? AND owner = ?', [
            params.id,
            address.toLowerCase(),
          ])

          return { success: true }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          if (
            msg.includes('Missing authentication') ||
            msg.includes('expired')
          ) {
            set.status = 401
            return { error: msg }
          }
          console.error('[API] Error deleting todo:', err)
          set.status = 500
          return { error: msg }
        }
      }),
  )

// Export for workerd
export default {
  fetch: app.fetch,
}
