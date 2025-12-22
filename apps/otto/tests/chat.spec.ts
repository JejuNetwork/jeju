/**
 * Otto Chat E2E Tests
 * Tests the complete user journey through the chat interface
 */

import { expect, test } from '@playwright/test'

const BASE_URL = process.env.OTTO_BASE_URL ?? 'http://localhost:4040'

test.describe('Otto Chat Flow', () => {
  let sessionId: string

  test.beforeEach(async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/chat/session`, {
      data: {},
    })
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    sessionId = data.sessionId
    expect(sessionId).toBeDefined()
  })

  test('greeting flow returns welcome message', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'hi' },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()

    expect(data.message).toBeDefined()
    expect(data.message.content).toContain('Otto')
    expect(data.message.role).toBe('assistant')
    expect(data.requiresAuth).toBe(false)
  })

  test('help command returns capabilities', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'help' },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()

    expect(data.message.content.toLowerCase()).toMatch(/swap|bridge|balance/i)
  })

  test('swap without wallet prompts connection', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'swap 1 ETH to USDC' },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()

    expect(data.requiresAuth).toBe(true)
    expect(data.message.content.toLowerCase()).toMatch(/connect|wallet/i)
  })

  test('connect command returns OAuth URL', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'connect wallet' },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()

    expect(data.message.content).toMatch(/http.*connect/i)
  })

  test('price query returns token info', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'price of ETH' },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()

    expect(data.message.content).toBeDefined()
    expect(data.message.role).toBe('assistant')
  })

  test('maintains conversation context', async ({ request }) => {
    await request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'hi' },
    })

    const response = await request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'what can you help me with' },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.sessionId).toBe(sessionId)
  })

  test('session retrieval includes history', async ({ request }) => {
    await request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'hello otto' },
    })

    const response = await request.get(
      `${BASE_URL}/api/chat/session/${sessionId}`,
    )
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.messages.length).toBeGreaterThanOrEqual(2)
  })
})

test.describe('Otto Auth', () => {
  test('auth message endpoint returns nonce', async ({ request }) => {
    const response = await request.get(
      `${BASE_URL}/api/chat/auth/message?address=0x1234567890123456789012345678901234567890`,
    )
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.message).toContain('0x1234567890123456789012345678901234567890')
    expect(data.nonce).toBeDefined()
  })

  test('auth message without address returns 400', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/chat/auth/message`)
    expect(response.status()).toBe(400)
  })
})
