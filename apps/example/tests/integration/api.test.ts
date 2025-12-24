import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const API_URL = process.env.API_URL || 'http://localhost:4500'
const TEST_WALLET = privateKeyToAccount(generatePrivateKey())

let serverRunning = false

interface HealthResponse {
  status: string
  services: Array<{ name: string; status: string }>
}

interface AppInfoResponse {
  name: string
  endpoints: Record<string, string>
}

interface TodoResponse {
  todo: { id: string; title: string; priority: string; completed: boolean }
}

interface TodoListResponse {
  todos: Array<{
    id: string
    title: string
    priority: string
    completed: boolean
  }>
  count: number
}

interface A2AAgentCard {
  protocolVersion: string
  name: string
  skills: Array<{ id: string }>
}

interface MCPInfoResponse {
  name: string
  tools: Array<{ name: string }>
}

interface MCPToolsResponse {
  tools: Array<{ name: string }>
}

interface X402InfoResponse {
  enabled: boolean
}

class TestApiClient {
  private baseUrl: string
  private headers: Record<string, string>

  constructor(baseUrl: string, headers: Record<string, string> = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.headers = {
      'Content-Type': 'application/json',
      ...headers,
    }
  }

  async fetch<T>(
    path: string,
    init?: RequestInit,
  ): Promise<{ data: T | null; status: number }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers, ...init?.headers },
    })

    if (!response.ok) {
      return { data: null, status: response.status }
    }

    // In tests, we trust the response shape matches the expected type.
    // The test itself will fail if the data doesn't match expectations.
    const data = (await response.json()) as T
    return { data, status: response.status }
  }

  async get<T>(path: string): Promise<{ data: T | null; status: number }> {
    return this.fetch<T>(path)
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<{ data: T | null; status: number }> {
    return this.fetch<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async patch<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ data: T | null; status: number }> {
    return this.fetch<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  }

  async delete<T>(path: string): Promise<{ data: T | null; status: number }> {
    return this.fetch<T>(path, { method: 'DELETE' })
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const timestamp = Date.now().toString()
  const message = `jeju-dapp:${timestamp}`
  const signature = await TEST_WALLET.signMessage({ message })

  return {
    'Content-Type': 'application/json',
    'x-jeju-address': TEST_WALLET.address,
    'x-jeju-timestamp': timestamp,
    'x-jeju-signature': signature,
  }
}

async function getAuthClient(): Promise<TestApiClient> {
  const headers = await getAuthHeaders()
  return new TestApiClient(API_URL, headers)
}

const baseClient = new TestApiClient(API_URL)

let databaseHealthy = false

async function checkServer(): Promise<boolean> {
  const { status } = await baseClient.get('/health')
  return status === 200
}

async function checkDatabase(): Promise<boolean> {
  const { data } = await baseClient.get<HealthResponse>('/health')
  const dbService = data?.services.find((s) => s.name.includes('database'))
  return dbService?.status === 'healthy'
}

function skipIfNoServer(): boolean {
  if (!serverRunning) {
    console.log('  [SKIP] Server not running')
    return true
  }
  return false
}

function skipIfNoDatabase(): boolean {
  if (skipIfNoServer()) return true
  if (!databaseHealthy) {
    console.log('  [SKIP] Database not available')
    return true
  }
  return false
}

beforeAll(async () => {
  serverRunning = await checkServer()
  if (!serverRunning) {
    console.log('\n⚠️  Server not running - E2E tests will be skipped')
    console.log('   Start the server with: bun run dev\n')
  } else {
    databaseHealthy = await checkDatabase()
    if (!databaseHealthy) {
      console.log(
        '\n⚠️  Database not available - DB-dependent tests will be skipped',
      )
      console.log('   Start full infrastructure with: jeju dev\n')
    }
  }
})

describe('Health Check', () => {
  test('should return healthy status', async () => {
    if (skipIfNoServer()) return

    const { data, status } = await baseClient.get<HealthResponse>('/health')
    expect(status).toBe(200)
    expect(data).toBeDefined()
    expect(data?.status).toBeDefined()
    expect(data?.services).toBeInstanceOf(Array)
    expect(data?.services.length).toBeGreaterThan(0)
  })

  test('should include all required services', async () => {
    if (skipIfNoServer()) return

    const { data } = await baseClient.get<HealthResponse>('/health')
    const serviceNames = data?.services.map((s) => s.name) ?? []
    expect(serviceNames.some((n) => n.includes('database'))).toBe(true)
    expect(serviceNames.some((n) => n.includes('cache'))).toBe(true)
  })
})

describe('Root Endpoint', () => {
  test('should return app info', async () => {
    if (skipIfNoServer()) return

    const { data, status } = await baseClient.get<AppInfoResponse>('/')
    expect(status).toBe(200)
    expect(data?.name).toBeDefined()
    expect(data?.endpoints).toBeDefined()
  })
})

describe('REST API', () => {
  let createdTodoId: string

  test('should reject unauthenticated requests', async () => {
    if (skipIfNoServer()) return

    const { status } = await baseClient.get('/api/v1/todos')
    // Missing auth headers return 400 (VALIDATION_ERROR)
    expect(status).toBe(400)
  })

  test('should create a todo', async () => {
    if (skipIfNoDatabase()) return

    const client = await getAuthClient()

    const { data, status } = await client.post<TodoResponse>('/api/v1/todos', {
      title: 'E2E Test Todo',
      description: 'Test description',
      priority: 'high',
    })

    expect(status).toBe(200)
    expect(data?.todo).toBeDefined()
    expect(data?.todo.title).toBe('E2E Test Todo')
    expect(data?.todo.priority).toBe('high')
    createdTodoId = data?.todo.id ?? ''
  })

  test('should list todos', async () => {
    if (skipIfNoDatabase()) return

    const client = await getAuthClient()

    const { data, status } = await client.get<TodoListResponse>('/api/v1/todos')
    expect(status).toBe(200)
    expect(data?.todos).toBeInstanceOf(Array)
  })

  test('should get a specific todo', async () => {
    if (skipIfNoDatabase() || !createdTodoId) return

    const client = await getAuthClient()

    const { data, status } = await client.get<TodoResponse>(
      `/api/v1/todos/${createdTodoId}`,
    )
    expect(status).toBe(200)
    expect(data?.todo.id).toBe(createdTodoId)
  })

  test('should update a todo', async () => {
    if (skipIfNoDatabase() || !createdTodoId) return

    const client = await getAuthClient()

    const { data, status } = await client.patch<TodoResponse>(
      `/api/v1/todos/${createdTodoId}`,
      { completed: true },
    )

    expect(status).toBe(200)
    expect(data?.todo.completed).toBe(true)
  })

  test('should get stats', async () => {
    if (skipIfNoDatabase()) return

    const client = await getAuthClient()

    const { status } = await client.get('/api/v1/stats')
    expect(status).toBe(200)
  })

  test('should delete a todo', async () => {
    if (skipIfNoDatabase() || !createdTodoId) return

    const client = await getAuthClient()

    const { status } = await client.delete(`/api/v1/todos/${createdTodoId}`)
    expect(status).toBe(200)
  })

  test('should return 404 for non-existent todo', async () => {
    if (skipIfNoDatabase()) return

    const client = await getAuthClient()

    const { status } = await client.get('/api/v1/todos/nonexistent-id')
    expect(status).toBe(404)
  })
})

describe('A2A Protocol', () => {
  test('should return agent card', async () => {
    if (skipIfNoServer()) return

    const { data, status } = await baseClient.get<A2AAgentCard>(
      '/a2a/.well-known/agent-card.json',
    )
    expect(status).toBe(200)
    expect(data?.protocolVersion).toBeDefined()
    expect(data?.name).toBeDefined()
    expect(data?.skills).toBeInstanceOf(Array)
  })

  test('should execute list-todos skill', async () => {
    if (skipIfNoDatabase()) return

    const client = await getAuthClient()

    const { status } = await client.post('/a2a', {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'e2e-1',
          parts: [{ kind: 'data', data: { skillId: 'list-todos' } }],
        },
      },
      id: 1,
    })

    expect(status).toBe(200)
  })

  test('should execute create-todo skill', async () => {
    if (skipIfNoDatabase()) return

    const client = await getAuthClient()

    const { status } = await client.post('/a2a', {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'e2e-2',
          parts: [
            {
              kind: 'data',
              data: {
                skillId: 'create-todo',
                title: 'A2A E2E Test',
                priority: 'medium',
              },
            },
          ],
        },
      },
      id: 2,
    })

    expect(status).toBe(200)
  })

  test('should execute get-summary skill', async () => {
    if (skipIfNoDatabase()) return

    const client = await getAuthClient()

    const { status } = await client.post('/a2a', {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'e2e-3',
          parts: [{ kind: 'data', data: { skillId: 'get-summary' } }],
        },
      },
      id: 3,
    })

    expect(status).toBe(200)
  })
})

describe('MCP Protocol', () => {
  test('should return MCP info', async () => {
    if (skipIfNoServer()) return

    const { data, status } = await baseClient.get<MCPInfoResponse>('/mcp')
    expect(status).toBe(200)
    expect(data?.name).toBeDefined()
  })

  test('should initialize MCP session', async () => {
    if (skipIfNoServer()) return

    const { status } = await baseClient.post('/mcp/initialize')
    expect(status).toBe(200)
  })

  test('should list MCP tools', async () => {
    if (skipIfNoServer()) return

    const { data, status } =
      await baseClient.post<MCPToolsResponse>('/mcp/tools/list')
    expect(status).toBe(200)
    expect(data?.tools).toBeInstanceOf(Array)
  })

  test('should call create_todo tool', async () => {
    if (skipIfNoDatabase()) return

    const client = await getAuthClient()

    const { status } = await client.post('/mcp/tools/call', {
      name: 'create_todo',
      arguments: {
        title: 'MCP E2E Test',
        priority: 'low',
      },
    })

    expect(status).toBe(200)
  })

  test('should list MCP resources', async () => {
    if (skipIfNoServer()) return

    const { status } = await baseClient.post('/mcp/resources/list')
    expect(status).toBe(200)
  })

  test('should read stats resource', async () => {
    if (skipIfNoDatabase()) return

    const client = await getAuthClient()

    const { status } = await client.post('/mcp/resources/read', {
      uri: 'todo://stats',
    })

    expect(status).toBe(200)
  })
})

describe('x402 Payment Protocol', () => {
  test('should return x402 info', async () => {
    if (skipIfNoServer()) return

    const { data, status } =
      await baseClient.get<X402InfoResponse>('/x402/info')
    expect(status).toBe(200)
    expect(typeof data?.enabled).toBe('boolean')
  })
})

describe('Authentication', () => {
  test('should reject requests without auth headers', async () => {
    if (skipIfNoServer()) return

    const { status } = await baseClient.get('/api/v1/todos')
    // Missing/invalid auth headers return 400 (VALIDATION_ERROR)
    expect(status).toBe(400)
  })

  test('should reject requests with invalid signature', async () => {
    if (skipIfNoServer()) return

    const client = new TestApiClient(API_URL, {
      'x-jeju-address': TEST_WALLET.address,
      'x-jeju-timestamp': Date.now().toString(),
      'x-jeju-signature': '0xinvalid',
    })

    const { status } = await client.get('/api/v1/todos')
    // Invalid signature returns 400 (VALIDATION_ERROR)
    expect(status).toBe(400)
  })

  test('should reject requests with expired timestamp', async () => {
    if (skipIfNoServer()) return

    const oldTimestamp = (Date.now() - 10 * 60 * 1000).toString()
    const message = `jeju-dapp:${oldTimestamp}`
    const signature = await TEST_WALLET.signMessage({ message })

    const client = new TestApiClient(API_URL, {
      'x-jeju-address': TEST_WALLET.address,
      'x-jeju-timestamp': oldTimestamp,
      'x-jeju-signature': signature,
    })

    const { status } = await client.get('/api/v1/todos')
    // Expired timestamp returns 400 (VALIDATION_ERROR)
    expect(status).toBe(400)
  })
})

describe('Bulk Operations', () => {
  const todoIds: string[] = []

  beforeAll(async () => {
    if (!serverRunning || !databaseHealthy) return

    const client = await getAuthClient()

    for (let i = 0; i < 3; i++) {
      const { data } = await client.post<TodoResponse>('/api/v1/todos', {
        title: `Bulk test ${i}`,
        priority: 'medium',
      })
      if (data?.todo) {
        todoIds.push(data.todo.id)
      }
    }
  })

  test('should bulk complete todos', async () => {
    if (skipIfNoDatabase() || todoIds.length === 0) return

    const client = await getAuthClient()

    const { status } = await client.post('/api/v1/todos/bulk/complete', {
      ids: todoIds,
    })

    expect(status).toBe(200)
  })

  test('should bulk delete todos', async () => {
    if (skipIfNoDatabase() || todoIds.length === 0) return

    const client = await getAuthClient()

    const { status } = await client.post('/api/v1/todos/bulk/delete', {
      ids: todoIds,
    })

    expect(status).toBe(200)
  })
})

afterAll(async () => {
  if (!serverRunning || !databaseHealthy) return

  const client = await getAuthClient()
  const { data } = await client.get<TodoListResponse>('/api/v1/todos')

  if (data?.todos) {
    for (const todo of data.todos) {
      await client.delete(`/api/v1/todos/${todo.id}`)
    }
  }
})
