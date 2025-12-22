/**
 * Otto API Tests
 */

import { expect, test } from '@playwright/test'

test.describe('Otto API', () => {
  test('health endpoint returns healthy status', async ({ request }) => {
    const response = await request.get('/health')
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.status).toBe('healthy')
    expect(data.agent).toBe('otto')
  })

  test('status endpoint returns platform info', async ({ request }) => {
    const response = await request.get('/status')
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.name).toBe('Otto Trading Agent')
    expect(data.platforms).toBeDefined()
    expect(data.platforms.discord).toBeDefined()
    expect(data.platforms.telegram).toBeDefined()
    expect(data.platforms.whatsapp).toBeDefined()
  })

  test('chains endpoint returns supported chains', async ({ request }) => {
    const response = await request.get('/api/chains')
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.chains).toBeInstanceOf(Array)
    expect(data.chains).toContain(420691) // Jeju
    expect(data.defaultChainId).toBe(420691)
  })

  test('info endpoint returns agent info', async ({ request }) => {
    const response = await request.get('/api/info')
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.name).toBe('Otto')
    expect(data.platforms).toContain('discord')
    expect(data.platforms).toContain('telegram')
    expect(data.platforms).toContain('whatsapp')
    expect(data.features).toContain('swap')
    expect(data.features).toContain('bridge')
    expect(data.features).toContain('launch')
  })

  test('telegram webhook returns ok', async ({ request }) => {
    const response = await request.post('/webhooks/telegram', {
      data: {
        update_id: 123,
        message: {
          message_id: 1,
          from: { id: 123, first_name: 'Test' },
          chat: { id: 123, type: 'private' },
          text: 'otto help',
          date: Math.floor(Date.now() / 1000),
        },
      },
    })

    expect(response.ok()).toBe(true)
    const data = await response.json()
    expect(data.ok).toBe(true)
  })

  test('whatsapp webhook returns TwiML', async ({ request }) => {
    const response = await request.post('/webhooks/whatsapp', {
      form: {
        MessageSid: 'SM123',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        Body: 'otto help',
      },
    })

    expect(response.ok()).toBe(true)
    const body = await response.text()
    expect(body).toContain('Response')
  })

  test('discord webhook responds to ping', async ({ request }) => {
    const response = await request.post('/webhooks/discord', {
      data: {
        type: 1, // PING
        token: 'test-token',
      },
    })

    expect(response.ok()).toBe(true)
    const data = await response.json()
    expect(data.type).toBe(1) // PONG
  })
})
