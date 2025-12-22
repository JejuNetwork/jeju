/**
 * Otto Integration Tests
 */

import { expect, test } from '@playwright/test'

test.describe('Otto Integration', () => {
  test.describe('Webhook Flow', () => {
    test('processes Telegram help command', async ({ request }) => {
      const response = await request.post('/webhooks/telegram', {
        data: {
          update_id: Date.now(),
          message: {
            message_id: 1,
            from: { id: 12345, username: 'testuser', first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            text: '/otto help',
            date: Math.floor(Date.now() / 1000),
          },
        },
      })

      expect(response.ok()).toBe(true)
    })

    test('processes Telegram balance command', async ({ request }) => {
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

    test('processes WhatsApp help command', async ({ request }) => {
      const response = await request.post('/webhooks/whatsapp', {
        form: {
          MessageSid: `SM${Date.now()}`,
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+0987654321',
          Body: 'otto help',
        },
      })

      expect(response.ok()).toBe(true)
    })

    test('processes WhatsApp price command', async ({ request }) => {
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

  test.describe('Auth Flow', () => {
    test('auth callback handles missing params', async ({ request }) => {
      const response = await request.get('/auth/callback')
      expect(response.ok()).toBe(true)

      const body = await response.text()
      expect(body).toContain('Failed')
    })

    test('auth callback with valid params shows success', async ({
      request,
    }) => {
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
})
