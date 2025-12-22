/**
 * Otto API Tests
 * Tests API endpoints, webhooks, and authentication flows
 */

import { expect, test } from '@playwright/test'

test.describe('Otto API Health & Status', () => {
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
})

test.describe('Otto Webhook Endpoints', () => {
  test.describe('Telegram', () => {
    test('accepts message update', async ({ request }) => {
      const response = await request.post('/webhooks/telegram', {
        data: {
          update_id: Date.now(),
          message: {
            message_id: 1,
            from: { id: 12345, username: 'testuser', first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            text: 'otto help',
            date: Math.floor(Date.now() / 1000),
          },
        },
      })

      expect(response.ok()).toBe(true)
      const data = await response.json()
      expect(data.ok).toBe(true)
    })

    test('processes balance command', async ({ request }) => {
      const response = await request.post('/webhooks/telegram', {
        data: {
          update_id: Date.now(),
          message: {
            message_id: 2,
            from: { id: 12345, username: 'testuser', first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            text: 'otto balance',
            date: Math.floor(Date.now() / 1000),
          },
        },
      })

      expect(response.ok()).toBe(true)
    })
  })

  test.describe('WhatsApp', () => {
    test('returns TwiML response', async ({ request }) => {
      const response = await request.post('/webhooks/whatsapp', {
        form: {
          MessageSid: `SM${Date.now()}`,
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+0987654321',
          Body: 'otto help',
        },
      })

      expect(response.ok()).toBe(true)
      const body = await response.text()
      expect(body).toContain('Response')
    })

    test('processes price command', async ({ request }) => {
      const response = await request.post('/webhooks/whatsapp', {
        form: {
          MessageSid: `SM${Date.now()}`,
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+0987654321',
          Body: 'otto price ETH',
        },
      })

      expect(response.ok()).toBe(true)
    })
  })

  test.describe('Discord', () => {
    test('responds to ping', async ({ request }) => {
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

    test('accepts slash command interaction', async ({ request }) => {
      const response = await request.post('/webhooks/discord', {
        data: {
          type: 2, // APPLICATION_COMMAND
          token: 'test-token',
          member: {
            user: { id: '123456789', username: 'testuser' },
          },
          channel_id: 'channel123',
          data: {
            name: 'otto',
            options: [{ name: 'help', type: 1 }],
          },
        },
      })

      expect(response.ok()).toBe(true)
    })
  })
})

test.describe('Otto Auth Flow', () => {
  test('auth callback handles missing params', async ({ request }) => {
    const response = await request.get('/auth/callback')
    expect(response.ok()).toBe(true)

    const body = await response.text()
    expect(body).toContain('Failed')
  })

  test('auth callback with valid params shows success', async ({ request }) => {
    const response = await request.get('/auth/callback', {
      params: {
        address: '0x1234567890123456789012345678901234567890',
        signature: '0xabcdef',
        platform: 'discord',
        platformId: '123456',
        nonce: 'test-nonce',
      },
    })

    expect(response.ok()).toBe(true)
    const body = await response.text()
    expect(body).toContain('Connected')
  })
})
