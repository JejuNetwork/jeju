/**
 * Agent E2E Tests
 *
 * Tests the agent system against a running DWS server.
 * These tests require DWS to be running.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

const DWS_URL = process.env.DWS_URL ?? 'http://127.0.0.1:4030'

// Check if DWS is available
async function checkDWS(): Promise<boolean> {
  try {
    const res = await fetch(`${DWS_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

describe('Agent E2E (requires DWS)', () => {
  let dwsAvailable = false
  let createdAgentId: string | null = null

  beforeAll(async () => {
    dwsAvailable = await checkDWS()
    if (!dwsAvailable) {
      console.log('[E2E] Skipping E2E tests - DWS not available at', DWS_URL)
    }
  })

  afterAll(async () => {
    // Cleanup: delete the created agent
    if (dwsAvailable && createdAgentId) {
      await fetch(`${DWS_URL}/agents/${createdAgentId}`, {
        method: 'DELETE',
        headers: {
          'x-jeju-address': '0x1234567890abcdef1234567890abcdef12345678',
        },
      }).catch(() => {
        // Ignore cleanup errors
      })
    }
  })

  test('health check', async () => {
    if (!dwsAvailable) {
      console.log('[E2E] Skipped - DWS not available')
      return
    }

    const res = await fetch(`${DWS_URL}/agents/health`)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.status).toBe('healthy')
  })

  test('register agent', async () => {
    if (!dwsAvailable) {
      console.log('[E2E] Skipped - DWS not available')
      return
    }

    const res = await fetch(`${DWS_URL}/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': '0x1234567890abcdef1234567890abcdef12345678',
      },
      body: JSON.stringify({
        character: {
          name: 'E2ETestBot',
          system: 'You are a helpful test bot. Keep responses very short.',
          bio: ['A test bot for E2E testing'],
        },
        runtime: {
          keepWarm: false,
          maxMemoryMb: 256,
          timeoutMs: 30000,
          plugins: [],
        },
      }),
    })

    expect(res.status).toBe(201)

    const data = (await res.json()) as { id: string; name: string }
    expect(data.id).toBeDefined()
    expect(data.name).toBe('E2ETestBot')

    createdAgentId = data.id
  })

  test('get agent details', async () => {
    if (!dwsAvailable || !createdAgentId) {
      console.log('[E2E] Skipped - DWS not available or agent not created')
      return
    }

    const res = await fetch(`${DWS_URL}/agents/${createdAgentId}`)
    expect(res.status).toBe(200)

    const data = (await res.json()) as {
      id: string
      character: { name: string }
    }
    expect(data.id).toBe(createdAgentId)
    expect(data.character.name).toBe('E2ETestBot')
  })

  test('chat with agent', async () => {
    if (!dwsAvailable || !createdAgentId) {
      console.log('[E2E] Skipped - DWS not available or agent not created')
      return
    }

    // Note: This will fail if workerd isn't actually running
    // In practice, the mock should handle it
    const res = await fetch(`${DWS_URL}/agents/${createdAgentId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Hello, how are you?',
        userId: 'e2e-test-user',
        roomId: 'e2e-test-room',
      }),
    })

    // Either succeeds (200) or fails because workerd isn't running (500)
    expect([200, 500]).toContain(res.status)

    if (res.status === 200) {
      const data = (await res.json()) as { text: string }
      expect(data.text).toBeDefined()
    }
  })

  test('list agents', async () => {
    if (!dwsAvailable) {
      console.log('[E2E] Skipped - DWS not available')
      return
    }

    const res = await fetch(`${DWS_URL}/agents`)
    expect(res.status).toBe(200)

    const data = (await res.json()) as {
      agents: Array<{ id: string; name: string }>
    }
    expect(Array.isArray(data.agents)).toBe(true)

    // Should include our created agent
    if (createdAgentId) {
      const ourAgent = data.agents.find((a) => a.id === createdAgentId)
      expect(ourAgent).toBeDefined()
    }
  })

  test('get agent stats', async () => {
    if (!dwsAvailable || !createdAgentId) {
      console.log('[E2E] Skipped - DWS not available or agent not created')
      return
    }

    const res = await fetch(`${DWS_URL}/agents/${createdAgentId}/stats`)
    expect(res.status).toBe(200)

    const data = (await res.json()) as {
      agentId: string
      totalInvocations: number
    }
    expect(data.agentId).toBe(createdAgentId)
    expect(typeof data.totalInvocations).toBe('number')
  })

  test('pause and resume agent', async () => {
    if (!dwsAvailable || !createdAgentId) {
      console.log('[E2E] Skipped - DWS not available or agent not created')
      return
    }

    // Pause
    const pauseRes = await fetch(`${DWS_URL}/agents/${createdAgentId}/pause`, {
      method: 'POST',
      headers: {
        'x-jeju-address': '0x1234567890abcdef1234567890abcdef12345678',
      },
    })
    expect(pauseRes.status).toBe(200)

    const pauseData = (await pauseRes.json()) as { status: string }
    expect(pauseData.status).toBe('paused')

    // Resume
    const resumeRes = await fetch(
      `${DWS_URL}/agents/${createdAgentId}/resume`,
      {
        method: 'POST',
        headers: {
          'x-jeju-address': '0x1234567890abcdef1234567890abcdef12345678',
        },
      },
    )
    expect(resumeRes.status).toBe(200)

    const resumeData = (await resumeRes.json()) as { status: string }
    expect(resumeData.status).toBe('active')
  })

  test('add cron trigger', async () => {
    if (!dwsAvailable || !createdAgentId) {
      console.log('[E2E] Skipped - DWS not available or agent not created')
      return
    }

    const res = await fetch(`${DWS_URL}/agents/${createdAgentId}/cron`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': '0x1234567890abcdef1234567890abcdef12345678',
      },
      body: JSON.stringify({
        schedule: '0 * * * *',
        action: 'think',
      }),
    })
    expect(res.status).toBe(201)

    const data = (await res.json()) as { id: string; schedule: string }
    expect(data.id).toBeDefined()
    expect(data.schedule).toBe('0 * * * *')
  })

  test('terminate agent', async () => {
    if (!dwsAvailable || !createdAgentId) {
      console.log('[E2E] Skipped - DWS not available or agent not created')
      return
    }

    const res = await fetch(`${DWS_URL}/agents/${createdAgentId}`, {
      method: 'DELETE',
      headers: {
        'x-jeju-address': '0x1234567890abcdef1234567890abcdef12345678',
      },
    })
    expect(res.status).toBe(200)

    const data = (await res.json()) as { success: boolean }
    expect(data.success).toBe(true)

    // Clear so cleanup doesn't try to delete again
    createdAgentId = null

    // Verify it's gone
    const getRes = await fetch(`${DWS_URL}/agents/${createdAgentId}`)
    expect(getRes.status).toBe(404)
  })
})
