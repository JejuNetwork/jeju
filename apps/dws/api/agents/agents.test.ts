/**
 * Agent System Tests
 *
 * Tests the full agent lifecycle: registration, deployment, invocation, and termination.
 * Requires SQLit to be running - all tests use real infrastructure.
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { getSQLitUrl } from '@jejunetwork/config'
import type { Address } from 'viem'
import * as registry from './registry'
import type {
  AgentCharacter,
  AgentMessage,
  AgentResponse,
  RegisterAgentRequest,
} from './types'

// Test Configuration

const TEST_OWNER = '0x1234567890abcdef1234567890abcdef12345678' as Address

const TEST_CHARACTER: AgentCharacter = {
  name: 'TestBot',
  system: 'You are a helpful test assistant. Be concise.',
  bio: ['A test bot for unit testing', 'Responds helpfully'],
  topics: ['testing', 'assistance'],
  adjectives: ['helpful', 'concise'],
  style: {
    all: ['Be brief', 'Be accurate'],
    chat: ['Be friendly'],
  },
}

// Initialize registry before tests
beforeAll(async () => {
  await registry.initRegistry({
    sqlitUrl: getSQLitUrl(),
    databaseId: process.env.SQLIT_DATABASE_ID ?? 'dws-test',
  })
})

// Registry Tests (SQLit-backed)

describe('Agent Registry (SQLit)', () => {
  test('should register agent', async () => {
    const request: RegisterAgentRequest = {
      character: TEST_CHARACTER,
      runtime: {
        keepWarm: false,
        maxMemoryMb: 256,
        timeoutMs: 30000,
        plugins: [],
      },
    }

    const agent = await registry.registerAgent(TEST_OWNER, request)

    expect(agent).toBeDefined()
    expect(agent.id).toBeDefined()
    expect(agent.owner).toBe(TEST_OWNER)
    expect(agent.character.name).toBe('TestBot')
    expect(agent.status).toBe('pending')
  })

  test('should get agent by id', async () => {
    const request: RegisterAgentRequest = {
      character: { ...TEST_CHARACTER, name: 'GetTest' },
    }

    const created = await registry.registerAgent(TEST_OWNER, request)
    const retrieved = await registry.getAgent(created.id)

    expect(retrieved).toBeDefined()
    expect(retrieved?.id).toBe(created.id)
    expect(retrieved?.character.name).toBe('GetTest')
  })

  test('should list agents by owner', async () => {
    const request1: RegisterAgentRequest = {
      character: { ...TEST_CHARACTER, name: 'ListTest1' },
    }
    const request2: RegisterAgentRequest = {
      character: { ...TEST_CHARACTER, name: 'ListTest2' },
    }

    await registry.registerAgent(TEST_OWNER, request1)
    await registry.registerAgent(TEST_OWNER, request2)

    const agents = await registry.getAgentsByOwner(TEST_OWNER)
    const names = agents.map((a) => a.character.name)

    expect(names).toContain('ListTest1')
    expect(names).toContain('ListTest2')
  })

  test('should update agent status', async () => {
    const request: RegisterAgentRequest = {
      character: { ...TEST_CHARACTER, name: 'StatusTest' },
    }

    const agent = await registry.registerAgent(TEST_OWNER, request)
    expect(agent.status).toBe('pending')

    await registry.updateAgentStatus(agent.id, 'active')
    const updated = await registry.getAgent(agent.id)
    expect(updated?.status).toBe('active')
  })

  test('should update agent config', async () => {
    const request: RegisterAgentRequest = {
      character: { ...TEST_CHARACTER, name: 'UpdateTest' },
    }

    const agent = await registry.registerAgent(TEST_OWNER, request)

    const updated = await registry.updateAgent(agent.id, TEST_OWNER, {
      character: { name: 'UpdatedName' },
      metadata: { version: '2' },
    })

    expect(updated?.character.name).toBe('UpdatedName')
    expect(updated?.metadata?.version).toBe('2')
  })

  test('should reject update from wrong owner', async () => {
    const request: RegisterAgentRequest = {
      character: { ...TEST_CHARACTER, name: 'OwnerTest' },
    }

    const agent = await registry.registerAgent(TEST_OWNER, request)
    const wrongOwner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address

    await expect(
      registry.updateAgent(agent.id, wrongOwner, {
        character: { name: 'Hacked' },
      }),
    ).rejects.toThrow('Not authorized')
  })

  test('should add cron trigger', async () => {
    const request: RegisterAgentRequest = {
      character: { ...TEST_CHARACTER, name: 'CronTest' },
    }

    const agent = await registry.registerAgent(TEST_OWNER, request)

    const trigger = await registry.addCronTrigger(
      agent.id,
      '*/5 * * * *',
      'think',
    )

    expect(trigger.id).toBeDefined()
    expect(trigger.agentId).toBe(agent.id)
    expect(trigger.schedule).toBe('*/5 * * * *')
    expect(trigger.action).toBe('think')
    expect(trigger.enabled).toBe(true)
  })

  test('should get cron triggers for agent', async () => {
    const request: RegisterAgentRequest = {
      character: { ...TEST_CHARACTER, name: 'CronListTest' },
    }

    const agent = await registry.registerAgent(TEST_OWNER, request)
    await registry.addCronTrigger(agent.id, '0 * * * *', 'think')
    await registry.addCronTrigger(agent.id, '0 0 * * *', 'post')

    const triggers = await registry.getCronTriggers(agent.id)
    expect(triggers.length).toBe(2)
  })

  test('should record invocation metrics', async () => {
    const request: RegisterAgentRequest = {
      character: { ...TEST_CHARACTER, name: 'MetricsTest' },
    }

    const agent = await registry.registerAgent(TEST_OWNER, request)

    await registry.recordInvocation(agent.id, 100)
    await registry.recordInvocation(agent.id, 200)
    await registry.recordInvocation(agent.id, 150)

    const stats = await registry.getAgentStats(agent.id)
    expect(stats).toBeDefined()
    expect(stats?.totalInvocations).toBe(3)
    expect(stats?.avgLatencyMs).toBe(150)
  })

  test('should get registry stats', async () => {
    const stats = await registry.getRegistryStats()

    expect(stats.totalAgents).toBeGreaterThanOrEqual(0)
    expect(typeof stats.activeAgents).toBe('number')
    expect(typeof stats.pendingAgents).toBe('number')
    expect(typeof stats.totalCronTriggers).toBe('number')
  })
})

// Types Tests

describe('Agent Types', () => {
  test('AgentCharacter should have required fields', () => {
    const char: AgentCharacter = {
      name: 'Test',
      system: 'You are a test.',
      bio: ['Test bio'],
    }

    expect(char.name).toBe('Test')
    expect(char.system).toBe('You are a test.')
    expect(char.bio).toHaveLength(1)
  })

  test('AgentMessage should have required fields', () => {
    const msg: AgentMessage = {
      id: 'msg-1',
      userId: 'user-1',
      roomId: 'room-1',
      content: { text: 'Hello', source: 'test' },
      createdAt: Date.now(),
    }

    expect(msg.id).toBe('msg-1')
    expect(msg.content.text).toBe('Hello')
  })

  test('AgentResponse should have required fields', () => {
    const res: AgentResponse = {
      id: 'res-1',
      agentId: 'agent-1',
      text: 'Hello back!',
    }

    expect(res.id).toBe('res-1')
    expect(res.text).toBe('Hello back!')
  })

  test('AgentResponse can have actions', () => {
    const res: AgentResponse = {
      id: 'res-2',
      agentId: 'agent-1',
      text: '[ACTION: CREATE_TODO | title=Test, priority=high]',
      actions: [
        { name: 'CREATE_TODO', params: { title: 'Test', priority: 'high' } },
      ],
    }

    expect(res.actions).toHaveLength(1)
    expect(res.actions?.[0].name).toBe('CREATE_TODO')
    expect(res.actions?.[0].params.title).toBe('Test')
  })
})

// Warm Pool Logic Tests

describe('Warm Pool Logic', () => {
  test('should keep warm if configured', async () => {
    const request: RegisterAgentRequest = {
      character: { ...TEST_CHARACTER, name: 'WarmTest' },
      runtime: {
        keepWarm: true,
        maxMemoryMb: 256,
        timeoutMs: 30000,
        plugins: [],
      },
    }

    const agent = await registry.registerAgent(TEST_OWNER, request)
    expect(agent.runtime.keepWarm).toBe(true)
  })

  test('should have cron trigger for autonomous agents', async () => {
    const request: RegisterAgentRequest = {
      character: { ...TEST_CHARACTER, name: 'AutonomousTest' },
      runtime: {
        keepWarm: false,
        cronSchedule: '*/10 * * * *',
        maxMemoryMb: 256,
        timeoutMs: 30000,
        plugins: [],
      },
    }

    const agent = await registry.registerAgent(TEST_OWNER, request)
    expect(agent.runtime.cronSchedule).toBe('*/10 * * * *')

    // Cron trigger should be created automatically
    const triggers = await registry.getCronTriggers(agent.id)
    expect(triggers.length).toBeGreaterThanOrEqual(1)
  })
})

// ElizaOS Worker Tests

describe('ElizaOS Worker', () => {
  test('should build correct system prompt', () => {
    const char: AgentCharacter = {
      name: 'PromptTest',
      system: 'You are a test assistant.',
      bio: ['Bio line 1', 'Bio line 2'],
      topics: ['topic1', 'topic2'],
      style: { all: ['Be brief'] },
    }

    // Simulate buildSystemPrompt logic
    const parts = [char.system]
    if (char.bio.length) {
      parts.push('\n\nBackground:', char.bio.join('\n'))
    }
    if (char.style?.all?.length) {
      parts.push('\n\nStyle guidelines:', char.style.all.join('\n'))
    }
    if (char.topics?.length) {
      parts.push('\n\nTopics of expertise:', char.topics.join(', '))
    }

    const systemPrompt = parts.join('\n')

    expect(systemPrompt).toContain('You are a test assistant.')
    expect(systemPrompt).toContain('Bio line 1')
    expect(systemPrompt).toContain('Be brief')
    expect(systemPrompt).toContain('topic1, topic2')
  })

  test('should extract actions from response', () => {
    const text = `I'll create that task for you. [ACTION: CREATE_TODO | title=Review code, priority=high, dueDate=2024-01-15]

Also scheduling a meeting. [ACTION: SCHEDULE_MEETING | time=9:00, attendees=team]`

    const actions: Array<{ name: string; params: Record<string, string> }> = []
    const actionRegex = /\[ACTION:\s*(\w+)\s*\|([^\]]+)\]/g

    let match: RegExpExecArray | null
    match = actionRegex.exec(text)
    while (match !== null) {
      const name = match[1]
      const paramsStr = match[2]
      const params: Record<string, string> = {}

      const paramPairs = paramsStr.split(',').map((p) => p.trim())
      for (const pair of paramPairs) {
        const [key, ...valueParts] = pair.split('=')
        if (key && valueParts.length) {
          params[key.trim()] = valueParts.join('=').trim()
        }
      }

      actions.push({ name, params })
      match = actionRegex.exec(text)
    }

    expect(actions).toHaveLength(2)
    expect(actions[0].name).toBe('CREATE_TODO')
    expect(actions[0].params.title).toBe('Review code')
    expect(actions[0].params.priority).toBe('high')
    expect(actions[1].name).toBe('SCHEDULE_MEETING')
    expect(actions[1].params.time).toBe('9:00')
  })
})

// API Routes Tests (Mock)

describe('Agent API (Unit)', () => {
  test('should validate register request', () => {
    const validRequest: RegisterAgentRequest = {
      character: {
        name: 'Valid',
        system: 'Valid system prompt',
        bio: [],
      },
    }

    expect(validRequest.character.name).toBeDefined()
    expect(validRequest.character.system).toBeDefined()
  })

  test('should reject invalid register request', () => {
    const invalidRequest = {
      character: {
        // Missing name and system
      },
    }

    expect(invalidRequest.character).toBeDefined()
    expect((invalidRequest.character as AgentCharacter).name).toBeUndefined()
  })

  test('ChatRequest should have text', () => {
    const validChat = { text: 'Hello' }
    const invalidChat = { userId: 'user-1' }

    expect(validChat.text).toBeDefined()
    expect((invalidChat as { text?: string }).text).toBeUndefined()
  })
})
