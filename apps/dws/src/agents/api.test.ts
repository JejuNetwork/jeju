/**
 * Agent API Integration Tests
 *
 * Tests the agent API routes via HTTP.
 */

import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import type {
  IWorkerdExecutor,
  WorkerdRequest,
  WorkerdResponse,
  WorkerdWorkerDefinition,
} from '../workers/workerd/types'
import { initExecutor } from './executor'
import { createAgentRouter } from './routes'
import type { RegisterAgentRequest } from './types'

// ============================================================================
// Test Setup
// ============================================================================

const TEST_OWNER = '0x1234567890abcdef1234567890abcdef12345678' as Address

// Create mock executor implementing IWorkerdExecutor
class MockWorkerdExecutor implements IWorkerdExecutor {
  private workers = new Map<
    string,
    { status: WorkerdWorkerDefinition['status'] }
  >()

  async initialize(): Promise<void> {
    // No-op for mock
  }

  async deployWorker(worker: WorkerdWorkerDefinition): Promise<void> {
    this.workers.set(worker.id, { status: 'active' })
  }

  async undeployWorker(workerId: string): Promise<void> {
    this.workers.delete(workerId)
  }

  getWorker(workerId: string): Pick<WorkerdWorkerDefinition, 'status'> | null {
    return this.workers.get(workerId) ?? null
  }

  getInstance(workerId: string):
    | (Pick<{ status: 'ready'; port: number }, 'status' | 'port'> & {
        endpoint: string
      })
    | null {
    if (!this.workers.has(workerId)) return null
    return {
      status: 'ready',
      endpoint: 'http://localhost:9999',
      port: 9999,
    }
  }

  async invoke(
    workerId: string,
    request: WorkerdRequest,
  ): Promise<WorkerdResponse> {
    const body = JSON.parse(request.body as string) as {
      message?: { content?: { text?: string } }
    }
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        success: true,
        response: {
          id: `resp-${Date.now()}`,
          agentId: workerId.replace('eliza-agent-', ''),
          text: `Mock response to: ${body.message?.content?.text ?? 'unknown'}`,
        },
      }),
    }
  }
}

// Create test app
const mockExecutor = new MockWorkerdExecutor()

// Initialize with mock
initExecutor(mockExecutor)

const app = new Elysia().use(createAgentRouter())

// Helper to make requests
async function request(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': TEST_OWNER,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return app.handle(req)
}

// ============================================================================
// API Tests
// ============================================================================

describe('Agent API Routes', () => {
  test('GET /agents/health returns healthy', async () => {
    const res = await request('GET', '/agents/health')
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.status).toBe('healthy')
    expect(data.service).toBe('dws-agents')
  })

  test('POST /agents creates new agent', async () => {
    const body: RegisterAgentRequest = {
      character: {
        name: 'APITestBot',
        system: 'You are a test bot.',
        bio: ['A test bot'],
      },
      runtime: {
        keepWarm: false,
        maxMemoryMb: 256,
        timeoutMs: 30000,
        plugins: [],
      },
    }

    const res = await request('POST', '/agents', body)
    expect(res.status).toBe(201)

    const data = (await res.json()) as {
      id: string
      name: string
      status: string
    }
    expect(data.id).toBeDefined()
    expect(data.name).toBe('APITestBot')
  })

  test('POST /agents rejects without character', async () => {
    const res = await request('POST', '/agents', {})
    // Elysia returns 422 for validation errors
    expect(res.status).toBe(422)
  })

  test('GET /agents lists agents', async () => {
    const res = await request('GET', '/agents')
    expect(res.status).toBe(200)

    const data = (await res.json()) as {
      agents: Array<{ id: string; name: string }>
    }
    expect(Array.isArray(data.agents)).toBe(true)
  })

  test('GET /agents/:id returns agent details', async () => {
    // First create an agent
    const createRes = await request('POST', '/agents', {
      character: { name: 'DetailTest', system: 'Test system', bio: [] },
    })
    const created = (await createRes.json()) as { id: string }

    const res = await request('GET', `/agents/${created.id}`)
    expect(res.status).toBe(200)

    const data = (await res.json()) as {
      id: string
      character: { name: string }
    }
    expect(data.id).toBe(created.id)
    expect(data.character.name).toBe('DetailTest')
  })

  test('GET /agents/:id returns 404 for unknown agent', async () => {
    const res = await request('GET', '/agents/unknown-id-12345')
    expect(res.status).toBe(404)
  })

  test('PUT /agents/:id updates agent', async () => {
    // Create agent
    const createRes = await request('POST', '/agents', {
      character: { name: 'UpdateAPITest', system: 'Test', bio: [] },
    })
    const created = (await createRes.json()) as { id: string }

    // Update agent
    const res = await request('PUT', `/agents/${created.id}`, {
      character: { name: 'UpdatedAPITest' },
      metadata: { version: '2' },
    })
    expect(res.status).toBe(200)

    const data = (await res.json()) as { name: string }
    expect(data.name).toBe('UpdatedAPITest')
  })

  test('PUT /agents/:id rejects wrong owner', async () => {
    // Create agent
    const createRes = await request('POST', '/agents', {
      character: { name: 'OwnerAPITest', system: 'Test', bio: [] },
    })
    const created = (await createRes.json()) as { id: string }

    // Try to update with wrong owner
    const res = await request(
      'PUT',
      `/agents/${created.id}`,
      { character: { name: 'Hacked' } },
      { 'x-jeju-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    )
    expect(res.status).toBe(403)
  })

  test('POST /agents/:id/chat sends message', async () => {
    // Create agent
    const createRes = await request('POST', '/agents', {
      character: { name: 'ChatAPITest', system: 'You are a test bot', bio: [] },
    })
    const created = (await createRes.json()) as { id: string }

    // Send chat message
    const res = await request('POST', `/agents/${created.id}/chat`, {
      text: 'Hello, how are you?',
      userId: 'test-user',
      roomId: 'test-room',
    })
    expect(res.status).toBe(200)

    const data = (await res.json()) as { text: string }
    expect(data.text).toBeDefined()
    expect(data.text).toContain('Mock response')
  })

  test('POST /agents/:id/chat rejects without text', async () => {
    // Create agent
    const createRes = await request('POST', '/agents', {
      character: { name: 'ChatValidTest', system: 'Test', bio: [] },
    })
    const created = (await createRes.json()) as { id: string }

    const res = await request('POST', `/agents/${created.id}/chat`, {
      userId: 'test-user',
    })
    // Elysia returns 422 for validation errors
    expect(res.status).toBe(422)
  })

  test('POST /agents/:id/pause pauses agent', async () => {
    // Create agent
    const createRes = await request('POST', '/agents', {
      character: { name: 'PauseTest', system: 'Test', bio: [] },
    })
    const created = (await createRes.json()) as { id: string }

    const res = await request('POST', `/agents/${created.id}/pause`)
    expect(res.status).toBe(200)

    const data = (await res.json()) as { status: string }
    expect(data.status).toBe('paused')
  })

  test('POST /agents/:id/resume resumes agent', async () => {
    // Create agent
    const createRes = await request('POST', '/agents', {
      character: { name: 'ResumeTest', system: 'Test', bio: [] },
    })
    const created = (await createRes.json()) as { id: string }

    // Pause first
    await request('POST', `/agents/${created.id}/pause`)

    // Resume
    const res = await request('POST', `/agents/${created.id}/resume`)
    expect(res.status).toBe(200)

    const data = (await res.json()) as { status: string }
    expect(data.status).toBe('active')
  })

  test('GET /agents/:id/cron lists triggers', async () => {
    // Create agent with cron
    const createRes = await request('POST', '/agents', {
      character: { name: 'CronListAPITest', system: 'Test', bio: [] },
      runtime: { cronSchedule: '*/5 * * * *' },
    })
    const created = (await createRes.json()) as { id: string }

    const res = await request('GET', `/agents/${created.id}/cron`)
    expect(res.status).toBe(200)

    const data = (await res.json()) as { triggers: Array<{ schedule: string }> }
    expect(Array.isArray(data.triggers)).toBe(true)
    expect(data.triggers.length).toBeGreaterThanOrEqual(1)
  })

  test('POST /agents/:id/cron adds trigger', async () => {
    // Create agent
    const createRes = await request('POST', '/agents', {
      character: { name: 'CronAddAPITest', system: 'Test', bio: [] },
    })
    const created = (await createRes.json()) as { id: string }

    const res = await request('POST', `/agents/${created.id}/cron`, {
      schedule: '0 0 * * *',
      action: 'post',
    })
    expect(res.status).toBe(201)

    const data = (await res.json()) as {
      id: string
      schedule: string
      action: string
    }
    expect(data.schedule).toBe('0 0 * * *')
    expect(data.action).toBe('post')
  })

  test('GET /agents/:id/stats returns stats', async () => {
    // Create agent
    const createRes = await request('POST', '/agents', {
      character: { name: 'StatsAPITest', system: 'Test', bio: [] },
    })
    const created = (await createRes.json()) as { id: string }

    const res = await request('GET', `/agents/${created.id}/stats`)
    expect(res.status).toBe(200)

    const data = (await res.json()) as {
      agentId: string
      totalInvocations: number
    }
    expect(data.agentId).toBe(created.id)
    expect(typeof data.totalInvocations).toBe('number')
  })

  test('DELETE /agents/:id terminates agent', async () => {
    // Create agent
    const createRes = await request('POST', '/agents', {
      character: { name: 'DeleteAPITest', system: 'Test', bio: [] },
    })
    const created = (await createRes.json()) as { id: string }

    const res = await request('DELETE', `/agents/${created.id}`)
    expect(res.status).toBe(200)

    const data = (await res.json()) as { success: boolean }
    expect(data.success).toBe(true)

    // Verify it's gone
    const getRes = await request('GET', `/agents/${created.id}`)
    expect(getRes.status).toBe(404)
  })
})
