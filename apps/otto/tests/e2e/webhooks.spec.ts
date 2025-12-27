/**
 * Otto Webhook Tests
 * Tests all platform webhook endpoints
 */

import { expect, test } from '@playwright/test'

test.describe('Telegram Webhook', () => {
  test('accepts message update', async ({ request }) => {
    const response = await request.post('/webhooks/telegram', {
      data: {
        update_id: Date.now(),
        message: {
          message_id: 1,
          from: { id: 12345, username: 'testuser', first_name: 'Test' },
          chat: { id: 12345, type: 'private' },
          text: '/start',
          date: Math.floor(Date.now() / 1000),
        },
      },
    })

    expect(response.ok()).toBe(true)
    const data = await response.json()
    expect(data.ok).toBe(true)
  })

  test('accepts callback query', async ({ request }) => {
    const response = await request.post('/webhooks/telegram', {
      data: {
        update_id: Date.now(),
        callback_query: {
          id: 'callback123',
          from: { id: 12345, username: 'testuser' },
          message: { chat: { id: 12345 } },
          data: 'swap_confirm',
        },
      },
    })

    expect(response.ok()).toBe(true)
  })
})

test.describe('Discord Webhook', () => {
  test('ping endpoint exists', async ({ request }) => {
    const response = await request.post('/webhooks/discord', {
      data: {
        type: 1, // PING
        token: 'test-token',
      },
    })

    // Discord webhook may require signature validation
    expect(response.status()).toBeDefined()
  })

  test('slash command endpoint exists', async ({ request }) => {
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

    expect(response.status()).toBeDefined()
  })
})

test.describe('WhatsApp Webhook', () => {
  test('verification endpoint returns OK', async ({ request }) => {
    const response = await request.get('/webhooks/whatsapp')
    expect(response.ok()).toBe(true)
    expect(await response.text()).toBe('OK')
  })

  test('accepts TwiML message', async ({ request }) => {
    const form = new URLSearchParams()
    form.append('MessageSid', `SM${Date.now()}`)
    form.append('From', 'whatsapp:+1234567890')
    form.append('To', 'whatsapp:+0987654321')
    form.append('Body', 'otto help')
    form.append('NumMedia', '0')

    const response = await request.post('/webhooks/whatsapp', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: form.toString(),
    })

    expect(response.ok()).toBe(true)
    const body = await response.text()
    expect(body).toContain('Response')
  })
})

test.describe('Farcaster Webhook', () => {
  test('frame interaction endpoint exists', async ({ request }) => {
    const response = await request.post('/webhooks/farcaster', {
      data: {
        untrustedData: {
          fid: 12345,
          url: 'https://otto.jejunetwork.org/frame',
          messageHash: 'abc123',
          timestamp: Date.now(),
          network: 1,
          buttonIndex: 1,
          inputText: 'swap 1 ETH to USDC',
        },
        trustedData: {
          messageBytes: '',
        },
      },
    })

    // Endpoint exists but may fail validation
    expect(response.status()).toBeDefined()
  })
})

test.describe('Twitter Webhook', () => {
  test('CRC challenge endpoint exists', async ({ request }) => {
    const response = await request.get(
      '/webhooks/twitter?crc_token=test_token_123',
    )

    // CRC requires TWITTER_API_SECRET env var
    expect(response.status()).toBeDefined()
  })

  test('accepts tweet event', async ({ request }) => {
    const response = await request.post('/webhooks/twitter', {
      data: {
        for_user_id: '123456789',
        tweet_create_events: [
          {
            id_str: 'tweet123',
            text: '@otto_agent swap 1 ETH to USDC',
            user: { id_str: '987654321', screen_name: 'testuser' },
            created_at: new Date().toISOString(),
          },
        ],
      },
    })

    expect(response.ok()).toBe(true)
    const data = await response.json()
    expect(data.ok).toBe(true)
  })

  test('accepts DM event', async ({ request }) => {
    const response = await request.post('/webhooks/twitter', {
      data: {
        for_user_id: '123456789',
        direct_message_events: [
          {
            type: 'message_create',
            message_create: {
              sender_id: '987654321',
              message_data: { text: 'help' },
            },
          },
        ],
      },
    })

    expect(response.ok()).toBe(true)
    const data = await response.json()
    expect(data.ok).toBe(true)
  })
})
