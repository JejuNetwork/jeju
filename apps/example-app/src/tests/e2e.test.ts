/**
 * End-to-End Tests for Example App
 *
 * Tests REST API, A2A Protocol, MCP Protocol, and x402 Payment Protocol.
 * Requires a running server: bun run dev
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const API_URL = process.env.API_URL || 'http://localhost:4500'
const TEST_WALLET = privateKeyToAccount(generatePrivateKey())

let serverRunning = false

async function checkServer(): Promise<boolean> {
  const response = await fetch(`${API_URL}/health`, {
    signal: AbortSignal.timeout(2000),
  }).catch(() => null)
  return response?.ok ?? false
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

function skipIfNoServer(): boolean {
  if (!serverRunning) {
    console.log('  [SKIP] Server not running')
    return true
  }
  return false
}

beforeAll(async () => {
  serverRunning = await checkServer()
  if (!serverRunning) {
    console.log('\n⚠️  Server not running - E2E tests will be skipped')
    console.log('   Start the server with: bun run dev\n')
  }
})

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
  todos: Array<{ id: string }>
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

describe('Health Check', () => {
  test('should return healthy status', async () => {
    if (skipIfNoServer()) return

    const response = await fetch(`${API_URL}/health`)
    expect(response.ok).toBe(true)

    const data = (await response.json()) as HealthResponse
    expect(data.status).toBeDefined()
    expect(data.services).toBeInstanceOf(Array)
    expect(data.services.length).toBeGreaterThan(0)
  })

  test('should include all required services', async () => {
    if (skipIfNoServer()) return

    const response = await fetch(`${API_URL}/health`)
    const data = (await response.json()) as HealthResponse

    const serviceNames = data.services.map((s) => s.name)
    expect(serviceNames.some((n) => n.includes('database'))).toBe(true)
    expect(serviceNames.some((n) => n.includes('cache'))).toBe(true)
  })
})

describe('Root Endpoint', () => {
  test('should return app info', async () => {
    if (skipIfNoServer()) return

    const response = await fetch(`${API_URL}/`)
    expect(response.ok).toBe(true)

    const data = (await response.json()) as AppInfoResponse
    expect(data.name).toBeDefined()
    expect(data.endpoints).toBeDefined()
  })
})

describe('REST API', () => {
  let createdTodoId: string

  test('should reject unauthenticated requests', async () => {
    if (skipIfNoServer()) return

    const response = await fetch(`${API_URL}/api/v1/todos`)
    expect(response.status).toBe(401)
  })

  test('should create a todo', async () => {
    if (skipIfNoServer()) return

    const headers = await getAuthHeaders()

    const response = await fetch(`${API_URL}/api/v1/todos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'E2E Test Todo',
        description: 'Test description',
        priority: 'high',
      }),
    })

    expect(response.ok).toBe(true)
    const data = (await response.json()) as TodoResponse
    expect(data.todo).toBeDefined()
    expect(data.todo.title).toBe('E2E Test Todo')
    expect(data.todo.priority).toBe('high')
    createdTodoId = data.todo.id
  })

  test('should list todos', async () => {
    if (skipIfNoServer()) return

    const headers = await getAuthHeaders()

    const response = await fetch(`${API_URL}/api/v1/todos`, { headers })
    expect(response.ok).toBe(true)

    const data = (await response.json()) as TodoListResponse
    expect(data.todos).toBeInstanceOf(Array)
  })

  test('should get a specific todo', async () => {
    if (skipIfNoServer() || !createdTodoId) return

    const headers = await getAuthHeaders()

    const response = await fetch(`${API_URL}/api/v1/todos/${createdTodoId}`, {
      headers,
    })
    expect(response.ok).toBe(true)

    const data = (await response.json()) as TodoResponse
    expect(data.todo.id).toBe(createdTodoId)
  })

  test('should update a todo', async () => {
    if (skipIfNoServer() || !createdTodoId) return

    const headers = await getAuthHeaders()

    const response = await fetch(`${API_URL}/api/v1/todos/${createdTodoId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ completed: true }),
    })

    expect(response.ok).toBe(true)
    const data = (await response.json()) as TodoResponse
    expect(data.todo.completed).toBe(true)
  })

  test('should get stats', async () => {
    if (skipIfNoServer()) return

    const headers = await getAuthHeaders()

    const response = await fetch(`${API_URL}/api/v1/stats`, { headers })
    expect(response.ok).toBe(true)
  })

  test('should delete a todo', async () => {
    if (skipIfNoServer() || !createdTodoId) return

    const headers = await getAuthHeaders()

    const response = await fetch(`${API_URL}/api/v1/todos/${createdTodoId}`, {
      method: 'DELETE',
      headers,
    })

    expect(response.ok).toBe(true)
  })

  test('should return 404 for non-existent todo', async () => {
    if (skipIfNoServer()) return

    const headers = await getAuthHeaders()

    const response = await fetch(`${API_URL}/api/v1/todos/nonexistent-id`, {
      headers,
    })
    expect(response.status).toBe(404)
  })
})

describe('A2A Protocol', () => {
  test('should return agent card', async () => {
    if (skipIfNoServer()) return

    const response = await fetch(`${API_URL}/a2a/.well-known/agent-card.json`)
    expect(response.ok).toBe(true)

    const card = (await response.json()) as A2AAgentCard
    expect(card.protocolVersion).toBeDefined()
    expect(card.name).toBeDefined()
    expect(card.skills).toBeInstanceOf(Array)
  })

  test('should execute list-todos skill', async () => {
    if (skipIfNoServer()) return

    const headers = await getAuthHeaders()

    const response = await fetch(`${API_URL}/a2a`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'e2e-1',
            parts: [{ kind: 'data', data: { skillId: 'list-todos' } }],
          },
        },
        id: 1,
      }),
    })

    expect(response.ok).toBe(true)
  })

  test('should execute create-todo skill', async () => {
    if (skipIfNoServer()) return

    const headers = await getAuthHeaders()

    const response = await fetch(`${API_URL}/a2a`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
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
      }),
    })

    expect(response.ok).toBe(true)
  })

  test('should execute get-summary skill', async () => {
    if (skipIfNoServer()) return

    const headers = await getAuthHeaders()

    const response = await fetch(`${API_URL}/a2a`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'e2e-3',
            parts: [{ kind: 'data', data: { skillId: 'get-summary' } }],
          },
        },
        id: 3,
      }),
    })

    expect(response.ok).toBe(true)
  })
})

describe('MCP Protocol', () => {
  test('should return MCP info', async () => {
    if (skipIfNoServer()) return

    const response = await fetch(`${API_URL}/mcp`)
    expect(response.ok).toBe(true)

    const info = (await response.json()) as MCPInfoResponse
    expect(info.name).toBeDefined()
  })

  test('should initialize MCP session', async () => {
    if (skipIfNoServer()) return

    const response = await fetch(`${API_URL}/mcp/initialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    expect(response.ok).toBe(true)
  })

  test('should list MCP tools', async () => {
    if (skipIfNoServer()) return

    const response = await fetch(`${API_URL}/mcp/tools/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    expect(response.ok).toBe(true)
    const data = (await response.json()) as MCPToolsResponse
    expect(data.tools).toBeInstanceOf(Array)
  })

  test('should call create_todo tool', async () => {
    if (skipIfNoServer()) return

    const headers = await getAuthHeaders()

    const response = await fetch(`${API_URL}/mcp/tools/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'create_todo',
        arguments: {
          title: 'MCP E2E Test',
          priority: 'low',
        },
      }),
    })

    expect(response.ok).toBe(true)
  })

  test('should list MCP resources', async () => {
    if (skipIfNoServer()) return

    const response = await fetch(`${API_URL}/mcp/resources/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    expect(response.ok).toBe(true)
  })

  test('should read stats resource', async () => {
    if (skipIfNoServer()) return

    const headers = await getAuthHeaders()

    const response = await fetch(`${API_URL}/mcp/resources/read`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ uri: 'todo://stats' }),
    })

    expect(response.ok).toBe(true)
  })
})

describe('x402 Payment Protocol', () => {
  test('should return x402 info', async () => {
    if (skipIfNoServer()) return

    const response = await fetch(`${API_URL}/x402/info`)
    expect(response.ok).toBe(true)

    const info = (await response.json()) as X402InfoResponse
    expect(typeof info.enabled).toBe('boolean')
  })
})

describe('Authentication', () => {
  test('should reject requests without auth headers', async () => {
    if (skipIfNoServer()) return

    const response = await fetch(`${API_URL}/api/v1/todos`)
    expect(response.status).toBe(401)
  })

  test('should reject requests with invalid signature', async () => {
    if (skipIfNoServer()) return

    const response = await fetch(`${API_URL}/api/v1/todos`, {
      headers: {
        'x-jeju-address': TEST_WALLET.address,
        'x-jeju-timestamp': Date.now().toString(),
        'x-jeju-signature': '0xinvalid',
      },
    })
    expect(response.status).toBe(401)
  })

  test('should reject requests with expired timestamp', async () => {
    if (skipIfNoServer()) return

    const oldTimestamp = (Date.now() - 10 * 60 * 1000).toString()
    const message = `jeju-dapp:${oldTimestamp}`
    const signature = await TEST_WALLET.signMessage({ message })

    const response = await fetch(`${API_URL}/api/v1/todos`, {
      headers: {
        'x-jeju-address': TEST_WALLET.address,
        'x-jeju-timestamp': oldTimestamp,
        'x-jeju-signature': signature,
      },
    })
    expect(response.status).toBe(401)
  })
})

describe('Bulk Operations', () => {
  const todoIds: string[] = []

  beforeAll(async () => {
    if (!serverRunning) return

    const headers = await getAuthHeaders()

    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${API_URL}/api/v1/todos`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: `Bulk test ${i}`, priority: 'medium' }),
      })
      const data = (await response.json()) as TodoResponse
      if (data.todo) {
        todoIds.push(data.todo.id)
      }
    }
  })

  test('should bulk complete todos', async () => {
    if (skipIfNoServer() || todoIds.length === 0) return

    const headers = await getAuthHeaders()

    const response = await fetch(`${API_URL}/api/v1/todos/bulk/complete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids: todoIds }),
    })

    expect(response.ok).toBe(true)
  })

  test('should bulk delete todos', async () => {
    if (skipIfNoServer() || todoIds.length === 0) return

    const headers = await getAuthHeaders()

    const response = await fetch(`${API_URL}/api/v1/todos/bulk/delete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids: todoIds }),
    })

    expect(response.ok).toBe(true)
  })
})

afterAll(async () => {
  if (!serverRunning) return

  const headers = await getAuthHeaders()
  const response = await fetch(`${API_URL}/api/v1/todos`, { headers })
  const data = (await response.json()) as TodoListResponse

  if (data.todos) {
    for (const todo of data.todos) {
      await fetch(`${API_URL}/api/v1/todos/${todo.id}`, {
        method: 'DELETE',
        headers,
      })
    }
  }
})
