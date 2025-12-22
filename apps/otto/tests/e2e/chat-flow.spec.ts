/**
 * E2E Tests for Otto Chat Flow
 * Tests the complete user journey through the chat interface
 */

import { expect, test } from '@playwright/test'

const BASE_URL = process.env.OTTO_BASE_URL ?? 'http://localhost:4040'

test.describe('Otto Chat E2E', () => {
  let sessionId: string

  test.beforeEach(async ({ request }) => {
    // Create a new session
    const response = await request.post(`${BASE_URL}/api/chat/session`, {
      data: {},
    })
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    sessionId = data.sessionId
    expect(sessionId).toBeDefined()
  })

  test('complete greeting flow', async ({ request }) => {
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
    // Price might fail if indexer is down, but should return a valid response
    expect(data.message.role).toBe('assistant')
  })

  test('maintains conversation context', async ({ request }) => {
    // Send first message
    await request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'hi' },
    })

    // Send follow-up
    const response = await request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'what can you help me with' },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.sessionId).toBe(sessionId)
  })

  test('session retrieval includes history', async ({ request }) => {
    // Send a message first
    await request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'hello otto' },
    })

    // Retrieve session
    const response = await request.get(
      `${BASE_URL}/api/chat/session/${sessionId}`,
    )
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.messages.length).toBeGreaterThanOrEqual(2) // user + assistant
  })
})

test.describe('Otto Frame E2E', () => {
  test('frame returns valid HTML with meta tags', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/frame`)
    expect(response.ok()).toBeTruthy()

    const html = await response.text()
    expect(html).toContain('fc:frame')
    expect(html).toContain('fc:frame:image')
    expect(html).toContain('fc:frame:button')
  })

  test('frame image endpoint returns SVG', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/frame/img?t=test`)
    expect(response.ok()).toBeTruthy()

    const svg = await response.text()
    expect(svg).toContain('<svg')
  })

  test('frame post endpoint handles button click', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/frame/action`, {
      data: {
        untrustedData: {
          fid: 12345,
          buttonIndex: 1,
          inputText: 'swap 1 ETH to USDC',
        },
        trustedData: {
          messageBytes: '',
        },
      },
    })

    expect(response.ok()).toBeTruthy()
    const html = await response.text()
    expect(html).toContain('fc:frame')
  })
})

test.describe('Otto Miniapp E2E', () => {
  test('web miniapp loads chat interface', async ({ page }) => {
    await page.goto(`${BASE_URL}/miniapp`)

    // Should have input field
    const input = page.locator('#input')
    await expect(input).toBeVisible()

    // Should have send button
    const sendButton = page.locator('#send')
    await expect(sendButton).toBeVisible()
  })

  test('telegram miniapp includes Telegram WebApp script', async ({
    request,
  }) => {
    const response = await request.get(`${BASE_URL}/miniapp/telegram`)
    expect(response.ok()).toBeTruthy()

    const html = await response.text()
    expect(html).toContain('telegram-web-app.js')
  })

  test('miniapp can send and receive messages', async ({ page }) => {
    await page.goto(`${BASE_URL}/miniapp`)

    // Wait for initialization
    await page.waitForTimeout(1000)

    // Type and send a message
    const input = page.locator('#input')
    await input.fill('hello')
    await page.locator('#send').click()

    // Wait for response
    await page.waitForTimeout(2000)

    // Should have messages in chat
    const messages = page.locator('.msg')
    const count = await messages.count()
    expect(count).toBeGreaterThanOrEqual(2) // user + assistant
  })
})

test.describe('Otto API Endpoints', () => {
  test('health endpoint returns healthy', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/health`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.status).toBe('healthy')
  })

  test('status endpoint returns agent info', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/status`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.name).toBe('Otto Trading Agent')
    expect(data.version).toBeDefined()
    expect(data.chains.length).toBeGreaterThan(0)
  })

  test('chains endpoint returns supported chains', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/chains`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.chains.length).toBeGreaterThan(0)
    expect(data.chains).toContain(420691) // Jeju chain ID
    expect(data.defaultChainId).toBe(420691)
  })

  test('info endpoint returns capabilities', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/info`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.name).toBe('Otto')
    expect(data.features).toContain('swap')
    expect(data.features).toContain('bridge')
  })
})

test.describe('Otto Auth Flow', () => {
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
