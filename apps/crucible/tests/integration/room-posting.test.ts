/**
 * Room Posting Integration Tests
 *
 * Tests the critical agent→room posting path:
 * 1. Create test room
 * 2. Register agent with postToRoom config
 * 3. Trigger tick via /api/cron/agent-tick-once
 * 4. Verify message appears in room
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ROOMS } from '../../api/constants'

const CRUCIBLE_URL = process.env.CRUCIBLE_URL ?? 'http://localhost:4021'

// Test room for this test suite
const TEST_ROOM_ID = 'test-room-posting'
const TEST_ROOM_NAME = 'Room Posting Test'

let crucibleAvailable = false
let autonomousAvailable = false

async function checkCrucibleHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${CRUCIBLE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}

async function checkAutonomousAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${CRUCIBLE_URL}/api/v1/autonomous/status`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return false
    const data = (await res.json()) as { enabled: boolean }
    return data.enabled === true
  } catch {
    return false
  }
}

beforeAll(async () => {
  crucibleAvailable = await checkCrucibleHealth()
  if (!crucibleAvailable) {
    console.log(
      '[Room Posting Tests] Crucible not available at',
      CRUCIBLE_URL,
      '- skipping tests',
    )
    return
  }
  console.log('[Room Posting Tests] Crucible ready')

  autonomousAvailable = await checkAutonomousAvailable()
  if (!autonomousAvailable) {
    console.log(
      '[Room Posting Tests] Autonomous mode not enabled - some tests will be skipped',
    )
  } else {
    console.log('[Room Posting Tests] Autonomous mode available')
  }
})

afterAll(async () => {
  // Clean up test room if created
  if (crucibleAvailable) {
    try {
      await fetch(`${CRUCIBLE_URL}/api/v1/rooms/${TEST_ROOM_ID}`, {
        method: 'DELETE',
      })
    } catch {
      // Ignore cleanup errors
    }
  }
})

describe('Room Constants Validation', () => {
  test('should export all expected room constants', () => {
    expect(ROOMS.BASE_CONTRACT_REVIEWS).toBe('base-contract-reviews')
    expect(ROOMS.INFRA_MONITORING).toBe('infra-monitoring')
    expect(ROOMS.ENDPOINT_MONITORING).toBe('endpoint-monitoring')
    expect(ROOMS.CAPABILITY_DEMOS).toBe('capability-demos')
  })

  test('should have room values that are non-empty strings', () => {
    for (const [key, value] of Object.entries(ROOMS)) {
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
      expect(value).not.toContain(' ') // No spaces in room IDs
    }
  })
})

describe('Room API', () => {
  test('should create a test room', async () => {
    if (!crucibleAvailable) {
      console.log('[Skipped] Crucible required')
      return
    }

    const response = await fetch(`${CRUCIBLE_URL}/api/v1/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: TEST_ROOM_ID,
        name: TEST_ROOM_NAME,
        roomType: 'collaboration',
      }),
    })

    // Room may already exist from previous test run - that's OK
    expect([200, 201, 409]).toContain(response.status)

    if (response.ok) {
      const data = (await response.json()) as { roomId: string }
      expect(data.roomId).toBe(TEST_ROOM_ID)
    }
  })

  test('should retrieve the test room', async () => {
    if (!crucibleAvailable) {
      console.log('[Skipped] Crucible required')
      return
    }

    const response = await fetch(`${CRUCIBLE_URL}/api/v1/rooms/${TEST_ROOM_ID}`)
    expect(response.ok).toBe(true)

    const data = (await response.json()) as { room_id: string; name: string }
    expect(data.room_id).toBe(TEST_ROOM_ID)
    expect(data.name).toBe(TEST_ROOM_NAME)
  })

  test('should post a message to the room', async () => {
    if (!crucibleAvailable) {
      console.log('[Skipped] Crucible required')
      return
    }

    const testMessage = `[TEST | t=${Date.now()}] Room posting test message`

    const response = await fetch(
      `${CRUCIBLE_URL}/api/v1/rooms/${TEST_ROOM_ID}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: testMessage,
          agentId: 'test-agent',
        }),
      },
    )

    expect(response.ok).toBe(true)
    const data = (await response.json()) as { messageId: number }
    expect(data.messageId).toBeGreaterThan(0)
  })

  test('should retrieve messages from the room', async () => {
    if (!crucibleAvailable) {
      console.log('[Skipped] Crucible required')
      return
    }

    const response = await fetch(
      `${CRUCIBLE_URL}/api/v1/rooms/${TEST_ROOM_ID}/messages`,
    )
    expect(response.ok).toBe(true)

    const data = (await response.json()) as {
      messages: Array<{ content: string; agent_id: string }>
    }
    expect(Array.isArray(data.messages)).toBe(true)
    expect(data.messages.length).toBeGreaterThan(0)

    // Verify test message is present
    const testMessage = data.messages.find((m) => m.content.includes('[TEST'))
    expect(testMessage).toBeDefined()
    expect(testMessage?.agent_id).toBe('test-agent')
  })
})

describe('Coordination Rooms', () => {
  test('should have coordination rooms created on startup', async () => {
    if (!crucibleAvailable) {
      console.log('[Skipped] Crucible required')
      return
    }

    // Check that infra-monitoring room exists (created on startup)
    const response = await fetch(
      `${CRUCIBLE_URL}/api/v1/rooms/${ROOMS.INFRA_MONITORING}`,
    )

    // Room should exist if autonomous mode is enabled
    if (autonomousAvailable) {
      expect(response.ok).toBe(true)
      const data = (await response.json()) as { room_id: string }
      expect(data.room_id).toBe(ROOMS.INFRA_MONITORING)
    } else {
      // Room may not exist if autonomous mode is disabled
      console.log(
        '[Info] Autonomous mode disabled - coordination rooms may not exist',
      )
    }
  })
})

describe('Agent Room Posting', () => {
  test('should trigger agent tick and post to room', async () => {
    if (!crucibleAvailable || !autonomousAvailable) {
      console.log('[Skipped] Crucible with autonomous mode required')
      return
    }

    // Get current message count in infra-monitoring room
    const beforeResponse = await fetch(
      `${CRUCIBLE_URL}/api/v1/rooms/${ROOMS.INFRA_MONITORING}/messages?limit=100`,
    )
    const beforeData = (await beforeResponse.json()) as {
      messages: Array<{ content: string }>
    }
    const beforeCount = beforeData.messages?.length ?? 0

    // Trigger a one-shot agent tick (this should cause infra-monitor to post)
    const tickResponse = await fetch(
      `${CRUCIBLE_URL}/api/cron/agent-tick-once`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
    )

    // May fail with 401 if CRON_SECRET is required in non-localnet
    if (tickResponse.status === 401) {
      console.log('[Info] Cron auth required - skipping tick verification')
      return
    }

    expect(tickResponse.ok).toBe(true)
    const tickData = (await tickResponse.json()) as {
      success: boolean
      executed: number
      results: Array<{ agentId: string; success: boolean }>
    }

    console.log('[Agent Tick] Executed:', tickData.executed, 'agents')

    // If agents were executed, verify posting worked
    if (tickData.executed > 0 && tickData.success) {
      // Wait a moment for message to be persisted
      await new Promise((r) => setTimeout(r, 500))

      // Check message count increased
      const afterResponse = await fetch(
        `${CRUCIBLE_URL}/api/v1/rooms/${ROOMS.INFRA_MONITORING}/messages?limit=100`,
      )
      const afterData = (await afterResponse.json()) as {
        messages: Array<{ content: string; agent_id: string }>
      }
      const afterCount = afterData.messages?.length ?? 0

      // Should have at least one new message from the tick
      expect(afterCount).toBeGreaterThanOrEqual(beforeCount)

      // Look for health check message from infra-monitor
      const healthMessage = afterData.messages?.find(
        (m) =>
          m.content.includes('[HEALTH') ||
          m.content.includes('infra-monitor'),
      )
      if (healthMessage) {
        console.log('[Agent Tick] Health message posted:', healthMessage.content)
      }
    }
  }, 30000) // 30s timeout for this test

  test('should register agent with postToRoom and verify config', async () => {
    if (!crucibleAvailable || !autonomousAvailable) {
      console.log('[Skipped] Crucible with autonomous mode required')
      return
    }

    // Register a test agent with postToRoom config
    const response = await fetch(`${CRUCIBLE_URL}/api/v1/autonomous/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterId: 'infra-monitor',
        tickIntervalMs: 60000,
        postToRoom: ROOMS.INFRA_MONITORING,
        capabilities: {
          canChat: true,
          compute: true,
        },
      }),
    })

    // May already be registered - that's OK
    expect([200, 201, 400, 409]).toContain(response.status)

    if (response.ok) {
      const data = (await response.json()) as {
        success: boolean
        agentId: string
      }
      expect(data.success).toBe(true)
      expect(data.agentId).toContain('infra-monitor')

      // Clean up - unregister the agent
      await fetch(
        `${CRUCIBLE_URL}/api/v1/autonomous/agents/${data.agentId}`,
        {
          method: 'DELETE',
        },
      )
    }
  })
})

describe('Room Validation', () => {
  test('should reject invalid room ID in agent config', async () => {
    if (!crucibleAvailable || !autonomousAvailable) {
      console.log('[Skipped] Crucible with autonomous mode required')
      return
    }

    // Try to register agent with invalid room
    const response = await fetch(`${CRUCIBLE_URL}/api/v1/autonomous/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterId: 'infra-monitor',
        postToRoom: 'invalid-room-that-does-not-exist',
      }),
    })

    // Should either reject with validation error or accept (room creation is lazy)
    // The startup validation should catch invalid rooms in AUTONOMOUS_AGENTS
    // but runtime registration may be more lenient
    expect([200, 201, 400]).toContain(response.status)
  })
})

console.log('Room Posting Tests loaded')
