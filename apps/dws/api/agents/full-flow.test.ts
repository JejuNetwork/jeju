/**
 * Full Agent Flow E2E Test
 *
 * Verifies the complete agent lifecycle:
 * 1. DWS starts up
 * 2. Register an agent
 * 3. Send a message
 * 4. Receive a response
 * 5. Clean up
 */

import { afterAll, describe, expect, test } from 'bun:test'
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
import type {
  AgentCharacter,
  AgentMessage,
  AgentResponse,
  AgentStats,
} from './types'

// API Response Types
interface HealthResponse {
  status: string
  service: string
}

interface AgentCreateResponse {
  id: string
  name: string
  status: string
}

interface AgentDetailResponse {
  id: string
  character: AgentCharacter
  status: string
}

interface AgentChatResponse {
  id: string
  text: string
  metadata?: { model?: string }
}

interface AgentStatsResponse extends AgentStats {}

interface AgentStatusResponse {
  status: string
}

interface AgentCronCreateResponse {
  id: string
  schedule: string
  action: string
}

interface AgentDeleteResponse {
  success: boolean
}

interface AgentListResponse {
  agents: Array<{ id: string; name: string }>
}

// Mock Workerd Executor with Real Inference

class MockWorkerdWithInference implements IWorkerdExecutor {
  private workers = new Map<
    string,
    {
      status: WorkerdWorkerDefinition['status']
      character: AgentCharacter
    }
  >()

  async initialize(): Promise<void> {
    // No-op for mock
  }

  async deployWorker(worker: WorkerdWorkerDefinition): Promise<void> {
    // Extract character from bindings
    const characterBinding = worker.bindings?.find(
      (b) => b.name === 'AGENT_CHARACTER',
    )
    const character = characterBinding?.value
      ? (JSON.parse(characterBinding.value as string) as AgentCharacter)
      : { name: 'Default', system: 'You are a helpful assistant.', bio: [] }

    this.workers.set(worker.id, { status: 'active', character })
  }

  async undeployWorker(workerId: string): Promise<void> {
    this.workers.delete(workerId)
  }

  getWorker(workerId: string): Pick<WorkerdWorkerDefinition, 'status'> | null {
    const worker = this.workers.get(workerId)
    return worker ? { status: worker.status } : null
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
    const worker = this.workers.get(workerId)
    if (!worker) {
      return {
        status: 404,
        headers: {},
        body: JSON.stringify({ error: 'Worker not found' }),
      }
    }

    const body = JSON.parse(request.body as string) as {
      type: string
      message?: AgentMessage
    }

    // Generate response based on character
    const messageText = body.message?.content?.text ?? 'Hello'
    const response = this.generateResponse(worker.character, messageText)

    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        success: true,
        response: {
          id: `resp-${Date.now()}`,
          agentId: workerId.replace('eliza-agent-', ''),
          text: response,
          metadata: {
            model: 'mock-model',
            tokensUsed: response.length,
            latencyMs: 50,
          },
        } as AgentResponse,
      }),
    }
  }

  private generateResponse(
    character: AgentCharacter,
    userMessage: string,
  ): string {
    // Simple response generation based on character
    const lowerMessage = userMessage.toLowerCase()

    if (lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
      return `Hello! I'm ${character.name}. ${character.bio?.[0] ?? 'How can I help you today?'}`
    }

    if (lowerMessage.includes('help')) {
      return `I'm ${character.name}, and I'm here to help. ${character.system}`
    }

    if (
      lowerMessage.includes('who are you') ||
      lowerMessage.includes('what are you')
    ) {
      return `I'm ${character.name}. ${character.bio?.join(' ') ?? character.system}`
    }

    // Default response
    return `[${character.name}] I understood your message: "${userMessage}". How can I assist you further?`
  }
}

// Test Setup

const TEST_OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address

const mockExecutor = new MockWorkerdWithInference()

// Initialize
initExecutor(mockExecutor)
const app = new Elysia().use(createAgentRouter())

// Request helper
async function request(
  method: string,
  path: string,
  body?: Record<string, unknown>,
) {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': TEST_OWNER,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return app.handle(req)
}

// Full Flow Tests

describe('Full Agent Flow', () => {
  let agentId: string

  test('1. Health check passes', async () => {
    const res = await request('GET', '/agents/health')
    expect(res.status).toBe(200)

    const data: HealthResponse = await res.json()
    expect(data.status).toBe('healthy')
    expect(data.service).toBe('dws-agents')
  })

  test('2. Register a new agent', async () => {
    const res = await request('POST', '/agents', {
      character: {
        name: 'HelpfulBot',
        system: 'You are a helpful AI assistant that provides concise answers.',
        bio: [
          'I am HelpfulBot, your friendly AI assistant.',
          'I specialize in answering questions clearly and concisely.',
        ],
        topics: ['general assistance', 'Q&A'],
        adjectives: ['helpful', 'friendly', 'concise'],
      },
      runtime: {
        keepWarm: true,
        maxMemoryMb: 256,
        timeoutMs: 30000,
        plugins: [],
      },
    })

    expect(res.status).toBe(201)

    const data: AgentCreateResponse = await res.json()
    expect(data.id).toBeDefined()
    expect(data.name).toBe('HelpfulBot')
    expect(data.status).toBe('active') // Should be active with mock executor

    agentId = data.id
    console.log(`[Test] Registered agent: ${agentId}`)
  })

  test('3. Verify agent is in registry', async () => {
    const res = await request('GET', `/agents/${agentId}`)
    expect(res.status).toBe(200)

    const data: AgentDetailResponse = await res.json()
    expect(data.id).toBe(agentId)
    expect(data.character.name).toBe('HelpfulBot')
    expect(data.status).toBe('active')
  })

  test('4. Send "hello" message and receive response', async () => {
    const res = await request('POST', `/agents/${agentId}/chat`, {
      text: 'Hello!',
      userId: 'test-user-1',
      roomId: 'test-room-1',
    })

    expect(res.status).toBe(200)

    const data: AgentChatResponse = await res.json()
    expect(data.id).toBeDefined()
    expect(data.text).toBeDefined()
    expect(data.text.length).toBeGreaterThan(0)
    expect(data.text).toContain('HelpfulBot')

    console.log(`[Test] Response: ${data.text}`)
  })

  test('5. Send "help" message and receive contextual response', async () => {
    const res = await request('POST', `/agents/${agentId}/chat`, {
      text: 'Can you help me?',
      userId: 'test-user-1',
      roomId: 'test-room-1',
    })

    expect(res.status).toBe(200)

    const data: AgentChatResponse = await res.json()
    expect(data.text).toContain('help')

    console.log(`[Test] Help response: ${data.text}`)
  })

  test('6. Send "who are you" message', async () => {
    const res = await request('POST', `/agents/${agentId}/chat`, {
      text: 'Who are you?',
      userId: 'test-user-1',
      roomId: 'test-room-1',
    })

    expect(res.status).toBe(200)

    const data: AgentChatResponse = await res.json()
    expect(data.text).toContain('HelpfulBot')

    console.log(`[Test] Identity response: ${data.text}`)
  })

  test('7. Verify invocation stats increased', async () => {
    const res = await request('GET', `/agents/${agentId}/stats`)
    expect(res.status).toBe(200)

    const data: AgentStatsResponse = await res.json()
    expect(data.totalInvocations).toBe(3) // We sent 3 messages

    console.log(
      `[Test] Stats: ${data.totalInvocations} invocations, ${data.avgLatencyMs}ms avg latency`,
    )
  })

  test('8. Pause and resume agent', async () => {
    // Pause
    const pauseRes = await request('POST', `/agents/${agentId}/pause`)
    expect(pauseRes.status).toBe(200)

    let statusRes = await request('GET', `/agents/${agentId}`)
    let statusData: AgentStatusResponse = await statusRes.json()
    expect(statusData.status).toBe('paused')

    // Resume
    const resumeRes = await request('POST', `/agents/${agentId}/resume`)
    expect(resumeRes.status).toBe(200)

    statusRes = await request('GET', `/agents/${agentId}`)
    statusData = await statusRes.json()
    expect(statusData.status).toBe('active')
  })

  test('9. Add cron trigger for autonomous thinking', async () => {
    const res = await request('POST', `/agents/${agentId}/cron`, {
      schedule: '*/30 * * * *', // Every 30 minutes
      action: 'think',
    })
    expect(res.status).toBe(201)

    const data: AgentCronCreateResponse = await res.json()
    expect(data.schedule).toBe('*/30 * * * *')
    expect(data.action).toBe('think')
  })

  test('10. Terminate agent', async () => {
    const res = await request('DELETE', `/agents/${agentId}`)
    expect(res.status).toBe(200)

    const data: AgentDeleteResponse = await res.json()
    expect(data.success).toBe(true)

    // Verify it's gone
    const getRes = await request('GET', `/agents/${agentId}`)
    expect(getRes.status).toBe(404)

    console.log(`[Test] Agent terminated successfully`)
  })
})

// Multiple Agents Test

describe('Multiple Agents', () => {
  const agentIds: string[] = []

  afterAll(async () => {
    // Cleanup any remaining agents
    for (const id of agentIds) {
      await request('DELETE', `/agents/${id}`)
    }
  })

  test('can register multiple agents with different characters', async () => {
    const characters = [
      {
        name: 'SecurityBot',
        system: 'You are a security expert.',
        bio: ['Security specialist'],
      },
      {
        name: 'TradeBot',
        system: 'You are a trading assistant.',
        bio: ['Trading expert'],
      },
      {
        name: 'SupportBot',
        system: 'You provide customer support.',
        bio: ['Support agent'],
      },
    ]

    for (const character of characters) {
      const res = await request('POST', '/agents', { character })
      expect(res.status).toBe(201)

      const data: AgentCreateResponse = await res.json()
      agentIds.push(data.id)
      expect(data.name).toBe(character.name)
    }

    expect(agentIds.length).toBe(3)
  })

  test('each agent responds with their own character', async () => {
    for (let i = 0; i < agentIds.length; i++) {
      const res = await request('POST', `/agents/${agentIds[i]}/chat`, {
        text: 'Who are you?',
        userId: 'test-user',
        roomId: 'test-room',
      })
      expect(res.status).toBe(200)

      const data: AgentChatResponse = await res.json()
      // Each bot should identify with their name
      const expectedNames = ['SecurityBot', 'TradeBot', 'SupportBot']
      expect(data.text).toContain(expectedNames[i])
    }
  })

  test('agent list shows all agents', async () => {
    const res = await request('GET', '/agents')
    expect(res.status).toBe(200)

    const data: AgentListResponse = await res.json()

    for (const id of agentIds) {
      expect(data.agents.some((a) => a.id === id)).toBe(true)
    }
  })
})

// Error Handling Tests

describe('Error Handling', () => {
  test('returns 404 for non-existent agent', async () => {
    const res = await request('GET', '/agents/non-existent-id')
    expect(res.status).toBe(404)
  })

  test('returns 422 for chat without text', async () => {
    // First create an agent
    const createRes = await request('POST', '/agents', {
      character: { name: 'ErrorTest', system: 'Test', bio: [] },
    })
    const created: AgentCreateResponse = await createRes.json()

    const res = await request('POST', `/agents/${created.id}/chat`, {
      userId: 'test',
    })
    // Elysia returns 422 for validation errors
    expect(res.status).toBe(422)

    // Cleanup
    await request('DELETE', `/agents/${created.id}`)
  })

  test('returns 401 for missing owner header', async () => {
    const req = new Request('http://localhost/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character: { name: 'NoOwner', system: 'Test', bio: [] },
      }),
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(401)
  })

  test('returns 403 for wrong owner update', async () => {
    // Create agent
    const createRes = await request('POST', '/agents', {
      character: { name: 'OwnerTest', system: 'Test', bio: [] },
    })
    const created: AgentCreateResponse = await createRes.json()

    // Try to update with wrong owner
    const req = new Request(`http://localhost/agents/${created.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      body: JSON.stringify({ character: { name: 'Hacked' } }),
    })
    const res = await app.handle(req)
    expect(res.status).toBe(403)

    // Cleanup
    await request('DELETE', `/agents/${created.id}`)
  })
})
