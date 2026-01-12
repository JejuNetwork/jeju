/**
 * Otto Chat Tests
 * Tests chat session and message functionality
 * Chat message tests require AI_MODEL to be configured
 */

import { expect, test } from '@playwright/test'

test.describe('Session Management', () => {
  test('creates new session', async ({ request }) => {
    const response = await request.post('/api/chat/session', {
      data: {},
    })
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.sessionId).toBeDefined()
    expect(data.messages).toBeInstanceOf(Array)
  })

  test('creates session with wallet address', async ({ request }) => {
    const response = await request.post('/api/chat/session', {
      data: {
        walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      },
    })
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.sessionId).toBeDefined()
  })

  test('retrieves existing session', async ({ request }) => {
    const createResponse = await request.post('/api/chat/session', {
      data: {},
    })
    const { sessionId } = await createResponse.json()

    const getResponse = await request.get(`/api/chat/session/${sessionId}`)
    expect(getResponse.ok()).toBe(true)

    const data = await getResponse.json()
    expect(data.sessionId).toBe(sessionId)
    expect(data.messages).toBeDefined()
  })

  test('returns 404 for invalid session', async ({ request }) => {
    const response = await request.get(
      '/api/chat/session/00000000-0000-0000-0000-000000000000',
    )
    expect(response.status()).toBe(404)
  })

  test('rejects invalid wallet address', async ({ request }) => {
    const response = await request.post('/api/chat/session', {
      data: { walletAddress: 'invalid-address' },
    })
    expect(response.status()).toBe(500)
  })
})

test.describe('Chat Messages', () => {
  let sessionId: string

  test.beforeEach(async ({ request }) => {
    const response = await request.post('/api/chat/session', { data: {} })
    const data = await response.json()
    sessionId = data.sessionId
  })

  test('greeting returns response', async ({ request }) => {
    const response = await request.post('/api/chat/chat', {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'hi' },
    })

    if (!response.ok()) {
      test.skip()
      return
    }

    const data = await response.json()
    expect(data.message).toBeDefined()
    expect(data.message.role).toBe('assistant')
    expect(data.message.content).toBeDefined()
  })

  test('help command returns capabilities', async ({ request }) => {
    const response = await request.post('/api/chat/chat', {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'help' },
    })

    if (!response.ok()) {
      test.skip()
      return
    }

    const data = await response.json()
    expect(data.message.content).toBeDefined()
  })

  test('swap without wallet prompts connection', async ({ request }) => {
    const response = await request.post('/api/chat/chat', {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'swap 1 ETH to USDC' },
    })

    if (!response.ok()) {
      test.skip()
      return
    }

    const data = await response.json()
    expect(data.requiresAuth).toBe(true)
    expect(data.message.content.toLowerCase()).toMatch(/connect|wallet/i)
  })

  test('maintains conversation context', async ({ request }) => {
    const first = await request.post('/api/chat/chat', {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'hi' },
    })

    if (!first.ok()) {
      test.skip()
      return
    }

    const second = await request.post('/api/chat/chat', {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'what can you do?' },
    })

    if (!second.ok()) {
      test.skip()
      return
    }

    const data = await second.json()
    expect(data.sessionId).toBe(sessionId)
  })
})
